// lib/model.ts — the radar-2 scoring model for token-radar-01.
//
// Idea in one paragraph: a pre-token protocol has no market price yet, so we
// estimate the value its token would plausibly launch at from the one hard
// number it does publish — its TVL — multiplied by the market-cap/TVL ratio
// that already-live protocols in the same category actually trade at. That
// category multiple is not a constant: it is measured from the sealed
// snapshot itself (median of the live, non-derivative protocols in the
// category, winsorised and shrunk toward the all-category median so a thin
// category cannot be priced by a single loud comp). Two starter-era
// adjustments stay: a growth multiplier from the 7-day TVL change and a
// maturity multiplier from the protocol's age.
//
// Everything here is a pure function of the snapshot: no clock, no network,
// no randomness, so two runs over the same snapshot agree byte for byte.

export const MODEL_VERSION = 'radar-2';

/** One protocol record, as the sealed snapshot carries it. */
export interface Protocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot file's shape. */
export interface Snapshot {
  as_of: string;
  floor_usd: number;
  source: string;
  watchlist: string[];
  protocols: Protocol[];
}

// ---------------------------------------------------------------- pre-token

/** A protocol is pre-token when its record carries no token at all. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// ------------------------------------------------------- derivative screen

/**
 * Categories that are always derivative product wrappers, never a fresh
 * token launch of their own.
 */
const DERIVATIVE_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange brands: a protocol whose name starts with one is an exchange's
 * own product line (a wrapped asset, a staking wrapper, a listing shell). */
const EXCHANGE_PREFIXES: readonly string[] = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

/** A trailing version marker: " Foo V2", " Foo v1.5", " Foo 2.0". A versioned
 * deployment is a relaunch of an existing product, not a new launch. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words only: "Wrapped Ether" is a wrapper; "Stakedao" is a name. */
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when the protocol is a derivative of something else's asset. */
export function isDerivative(p: Protocol): boolean {
  if (DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (VERSIONED_NAME.test(p.name)) return true;
  if (WRAPPER_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((brand) => p.name.startsWith(brand));
}

/** Rankable = pre-token and not a derivative. Applied to the whole board. */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && !isDerivative(p);
}

// -------------------------------------------------------- category pricing

const WINSOR_LO = 0.02;
const WINSOR_HI = 8;
const SHRINK_K = 10; // phantom comps pulling a category toward the median
const MULT_LO = 0.05;
const MULT_HI = 2;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10000) / 10000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** What one category's live protocols say about its launch multiple. */
export interface CategoryPrice {
  multiple: number;
  comps: number;
}

/** The measured pricing table for one snapshot. */
export interface Pricing {
  /** All-category median mcap/TVL, rounded to 4dp; the fallback multiple. */
  global_multiple: number;
  /** Live comps that fed the table (mcap > 0, non-derivative). */
  comps_total: number;
  /** Categories that have at least one live comp. */
  categories_with_comps: number;
  /** Per-category shrunk multiples; a missing category uses the global. */
  by_category: Map<string, CategoryPrice>;
}

/**
 * Measure the category multiples from the snapshot's live protocols.
 * A comp is a live-token, non-derivative protocol with a real market cap;
 * its ratio is winsorised to [0.02, 8] before any median is taken.
 */
export function measurePricing(protocols: Protocol[]): Pricing {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    if (isPreToken(p) || isDerivative(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, WINSOR_LO, WINSOR_HI);
    allRatios.push(ratio);
    const list = ratiosByCategory.get(p.category);
    if (list) list.push(ratio);
    else ratiosByCategory.set(p.category, [ratio]);
  }
  const global = round4(median(allRatios));
  const by_category = new Map<string, CategoryPrice>();
  for (const [category, ratios] of ratiosByCategory) {
    const shrunk = (ratios.length * median(ratios) + SHRINK_K * global) / (ratios.length + SHRINK_K);
    by_category.set(category, { multiple: round4(clamp(shrunk, MULT_LO, MULT_HI)), comps: ratios.length });
  }
  return {
    global_multiple: global,
    comps_total: allRatios.length,
    categories_with_comps: ratiosByCategory.size,
    by_category,
  };
}

/** The multiple a category prices at; the global median when it has no comps. */
export function multipleFor(pricing: Pricing, category: string): CategoryPrice {
  return pricing.by_category.get(category) ?? { multiple: pricing.global_multiple, comps: 0 };
}

// ------------------------------------------------------------- adjustments

/** Growth from the 7-day TVL change (percent units in the snapshot). */
export function growthMult(change7d: number | null): number {
  const pct = clamp(change7d ?? 0, -60, 120);
  return 1 + (pct / 100) * 0.5;
}

/** Whole days between the listing date and the snapshot date; 365 when the
 * listing date is unknown, never negative. */
export function ageDays(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 365;
  const ms = Date.parse(asOf) - Date.parse(listedAt);
  if (!Number.isFinite(ms) || ms < 0) return 365;
  return Math.floor(ms / 86_400_000);
}

/** Maturity: a brand-new protocol keeps 0.6, a three-year-old reaches 1.0. */
export function maturityMult(age: number): number {
  return 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
}

/** The launch value the model implies for one protocol, in whole dollars. */
export function impliedValue(tvl: number, multiple: number, change7d: number | null, age: number): number {
  return Math.round(tvl * multiple * growthMult(change7d) * maturityMult(age));
}

// -------------------------------------------------------------- farm plans

/**
 * Starter capital (USD) and hold (days) are derived from the category: a
 * lending farm needs real collateral, a perps farm needs margin, a DEX farm
 * needs a two-sided stake, and a light-touch farm needs only dust plus fees.
 */
const CAPITAL_BY_CATEGORY: Record<string, number> = {
  Lending: 1000,
  'Risk Curators': 1000,
  'Yield Aggregator': 500,
  Yield: 500,
  Dexs: 500,
  Perps: 750,
  Derivatives: 750,
  Options: 750,
  'Leveraged Farming': 750,
};

const HOLD_BY_CATEGORY: Record<string, number> = {
  Lending: 84,
  'Risk Curators': 84,
  'Yield Aggregator': 70,
  Yield: 70,
  Dexs: 56,
  Perps: 28,
  Derivatives: 28,
  Options: 42,
  'Leveraged Farming': 42,
};

export function capitalFor(category: string): number {
  return CAPITAL_BY_CATEGORY[category] ?? 250;
}

export function holdDaysFor(category: string): number {
  return HOLD_BY_CATEGORY[category] ?? 42;
}

/**
 * Step 3 of every plan: the weekly action that makes the farm look like a
 * real user of THIS kind of protocol, instead of one generic sentence.
 * dashboard/app.js carries the identical function; the two must not drift.
 */
export function weeklyActionFor(category: string, name: string): string {
  switch (category) {
    case 'Lending':
      return `Every week, borrow a small amount against the supplied collateral in ${name} and repay it in the same session, so the account shows genuine borrowing activity without carrying liquidation risk overnight.`;
    case 'Dexs':
      return `Every week, make a few small swaps through ${name} and adjust the liquidity range once, so the wallet shows steady trading volume and an actively managed position.`;
    case 'Perps':
    case 'Derivatives':
      return `Every week, open one small hedged position on ${name} and close it within the day, so the account builds a real trading history without leaving directional risk open.`;
    case 'Yield Aggregator':
    case 'Yield':
      return `Every week, claim the accrued yield in ${name} and compound it straight back into the same vault, so the position grows and the wallet shows a consistent restaking pattern.`;
    case 'Risk Curators':
      return `Every week, top up the ${name} vault allocation by a small fixed amount and review the curator's latest reallocation note, so deposits arrive steadily rather than in one lump.`;
    case 'Options':
      return `Every week, buy one small short-dated option on ${name} and let it settle, so the account shows repeated, completed options activity across several expiries.`;
    case 'Leveraged Farming':
      return `Every week, rebalance the leveraged position in ${name} back to its target ratio and harvest any accrued rewards, keeping the loop active without letting it drift.`;
    case 'Gaming':
    case 'NFT Lending':
    case 'NFT Marketplace':
      return `Every week, complete one small in-product action on ${name} — a listing, a bid or a session — so the account keeps a steady activity streak instead of a single visit.`;
    default:
      return `Every week, repeat one small core action inside ${name} and rebalance the position back to its starting size, so the wallet shows steady, deliberate use of the product.`;
  }
}

/** A six-step farm plan for one row. Deterministic in the row's own fields. */
export function farmPlan(p: Protocol, category: string): { capital_usd: number; hold_days: number; steps: string[] } {
  const capital = capitalFor(category);
  const hold = holdDaysFor(category);
  const chain = p.chains[0] ?? 'its main chain';
  const steps = [
    `Open ${p.name} on ${chain} from a fresh wallet kept only for this farm, and read the product docs and fee schedule before depositing anything.`,
    `Deposit the starter stake of $${capital} into the core ${category} position on ${p.name}; keep the rest of the budget back for gas, fees and later top-ups.`,
    weeklyActionFor(category, p.name),
    `Once a week, check the ${p.name} dashboard and any points or eligibility page, and save a screenshot of the balance so a later snapshot or claim can be matched to this wallet.`,
    `Watch ${p.name}'s TVL and announcements: if TVL falls sharply or the farming rules change, pause new deposits and keep only the position that is already earning.`,
    `Hold the position for about ${hold} days, then reassess it against the implied launch value; if a token launch is announced, exit in steps as liquidity opens rather than all at once.`,
  ];
  return { capital_usd: capital, hold_days: hold, steps };
}

// ------------------------------------------------------------------- board

/** One row of the ranked board (board.json) and of the dashboard data. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  watchlist: boolean;
  implied_usd: number;
  model: {
    version: string;
    category_multiple: number;
    comps: number;
    growth_mult: number;
    maturity_mult: number;
  };
  farm: { capital_usd: number; hold_days: number; steps: string[] };
}

/** A live-token protocol the dashboard sets aside in its own view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface Board {
  rows: BoardRow[];
  live: LiveRow[];
  pricing: Pricing;
}

/**
 * Build the board: every watchlist protocol, plus every rankable protocol
 * below the TVL floor (the early launches the radar exists to catch).
 * Above-floor rankable protocols that are not on the watchlist are left
 * out — the watchlist is the curated above-floor set. Rows are ranked by
 * implied value, ties broken by slug so the order never depends on the
 * snapshot's own ordering.
 */
export function buildBoard(snapshot: Snapshot): Board {
  const pricing = measurePricing(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const picked: Protocol[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    if (watch.has(p.slug) || p.tvl_usd < snapshot.floor_usd) picked.push(p);
  }
  const rows: BoardRow[] = picked.map((p) => {
    const price = multipleFor(pricing, p.category);
    const age = ageDays(p.listed_at, snapshot.as_of);
    return {
      rank: 0, // assigned after the sort
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      watchlist: watch.has(p.slug),
      implied_usd: impliedValue(p.tvl_usd, price.multiple, p.change_7d, age),
      model: {
        version: MODEL_VERSION,
        category_multiple: price.multiple,
        comps: price.comps,
        growth_mult: growthMult(p.change_7d),
        maturity_mult: maturityMult(age),
      },
      farm: farmPlan(p, p.category),
    };
  });
  rows.sort((a, b) => b.implied_usd - a.implied_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && !isDerivative(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= snapshot.floor_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: round4(clamp((p.mcap_usd as number) / p.tvl_usd, WINSOR_LO, WINSOR_HI)),
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { rows, live, pricing };
}
