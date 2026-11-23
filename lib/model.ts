// lib/model.ts — the radar-3 scoring model for token-radar-01.
//
// Idea in one paragraph: a pre-token protocol has no price, so radar-3 prices
// the token it would launch with two fits taken from the sealed snapshot
// itself, each kept only because a held-out test kept it. (1) A launch-value
// curve: least squares on log10 market cap against log10 TVL over the
// snapshot's traded, non-derivative protocols — the size curve the market
// itself draws. (2) A launch-odds term: a logistic fit over every protocol in
// the snapshot of "records a token" against tracked age — the peers' record
// of who ends up issuing. Implied value = launch value x odds, an expected
// value, and the board ranks by it. Terms that were fitted and then dropped
// because the tests did not keep them: 7-day TVL change, category intercepts,
// category multiples (the previous model's whole pricing rule, kept here as
// the baseline the validation panel scores against), and a TVL term in the
// odds fit.
//
// Everything is a pure function of the snapshot: no clock, no network, no
// unseeded randomness, so two runs over the same snapshot agree byte for byte.

export const MODEL_VERSION = 'radar-3';

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

/** Parse and lightly validate the sealed snapshot JSON. */
export function parseSnapshot(text: string): Snapshot {
  const snap = JSON.parse(text) as Snapshot;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return snap;
}

// ------------------------------------------------------------------ screens

/** A protocol records a token when DefiLlama's record carries one. */
export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** A protocol is pre-token when its record carries no token at all. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const DERIVATIVE_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

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

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why the derivative screen set a pre-token protocol aside, or null. */
export function derivativeReason(p: Protocol): string | null {
  if (DERIVATIVE_CATEGORIES.has(p.category)) return `wrapper category (${p.category})`;
  if (VERSIONED_NAME.test(p.name)) return 'versioned name (a relaunch, not a launch)';
  if (WRAPPER_WORD.test(p.name)) return 'wrapper word in the name';
  if (EXCHANGE_PREFIXES.some((brand) => p.name.startsWith(brand))) return 'exchange brand product';
  return null;
}

export function isDerivative(p: Protocol): boolean {
  return derivativeReason(p) !== null;
}

/** Rankable = pre-token and not a derivative. Applied to the whole board. */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && !isDerivative(p);
}

// ------------------------------------------------------------------ helpers

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const round4 = (x: number): number => Math.round(x * 10000) / 10000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Days between the snapshot's as_of and a protocol's listed_at, or null. */
export function ageDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** Spearman rank correlation: average ranks for ties, Pearson on the ranks. */
function spearman(xs: number[], ys: number[]): number {
  const ranks = (vs: number[]): number[] => {
    const order = vs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const out = new Array<number>(vs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k]![1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < rx.length; i++) {
    cov += (rx[i]! - mx) * (ry[i]! - my);
    vx += (rx[i]! - mx) ** 2;
    vy += (ry[i]! - my) ** 2;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}

/** mulberry32: a tiny seeded PRNG so every validation split is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ------------------------------------------------------- the pricing comps

/** A traded protocol the value models are fitted and tested on. */
export interface Comp {
  protocol: Protocol;
  tvl: number;
  mcap: number;
}

/** The comp set: records a token with a priced cap, not a derivative. */
export function pricingComps(protocols: Protocol[]): Comp[] {
  const comps: Comp[] = [];
  for (const p of protocols) {
    if (isPreToken(p) || isDerivative(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    comps.push({ protocol: p, tvl: p.tvl_usd, mcap: p.mcap_usd });
  }
  return comps;
}

// ------------------------------------------------------- the value model

/** Least-squares fit of log10(mcap) = intercept + slope * log10(tvl). */
export interface ValueFit {
  intercept: number;
  slope: number;
  comps: number;
}

export function fitValue(comps: Comp[]): ValueFit {
  let sx = 0;
  let sy = 0;
  for (const c of comps) {
    sx += Math.log10(c.tvl);
    sy += Math.log10(c.mcap);
  }
  const mx = sx / comps.length;
  const my = sy / comps.length;
  let sxy = 0;
  let sxx = 0;
  for (const c of comps) {
    const dx = Math.log10(c.tvl) - mx;
    sxy += dx * (Math.log10(c.mcap) - my);
    sxx += dx * dx;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { intercept: round4(my - slope * mx), slope: round4(slope), comps: comps.length };
}

/** The launch value the fitted curve reads off a TVL, in whole dollars. */
export function launchValue(fit: ValueFit, tvl: number): number {
  return Math.max(1, Math.round(10 ** (fit.intercept + fit.slope * Math.log10(Math.max(1, tvl)))));
}

// ------------------------------------------------------- the odds model

/** Logistic fit of records-token on log10 age, over protocols with an age. */
export interface OddsFit {
  intercept: number;
  slope: number;
  rows: number;
  /** Median tracked age (days) of the fitted rows: the imputation for a
   * protocol whose record carries no listed_at. */
  median_age_days: number;
}

export function fitOdds(protocols: Protocol[], asOf: string): OddsFit {
  const rows: { x: number; y: number }[] = [];
  const ages: number[] = [];
  for (const p of protocols) {
    const age = ageDays(p, asOf);
    if (age === null || age <= 0) continue;
    rows.push({ x: Math.log10(age), y: recordsToken(p) ? 1 : 0 });
    ages.push(age);
  }
  // Newton iterations on the two-parameter logistic, deterministic.
  let b0 = 0;
  let b1 = 0;
  for (let iter = 0; iter < 100; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 1e-6;
    let h01 = 0;
    let h11 = 1e-6;
    for (const r of rows) {
      const pr = 1 / (1 + Math.exp(-(b0 + b1 * r.x)));
      const d = r.y - pr;
      const w = pr * (1 - pr);
      g0 += d;
      g1 += d * r.x;
      h00 += w;
      h01 += w * r.x;
      h11 += w * r.x * r.x;
    }
    const det = h00 * h11 - h01 * h01;
    const s0 = (h11 * g0 - h01 * g1) / det;
    const s1 = (h00 * g1 - h01 * g0) / det;
    b0 += s0;
    b1 += s1;
    if (Math.abs(s0) < 1e-12 && Math.abs(s1) < 1e-12) break;
  }
  return {
    intercept: round4(b0),
    slope: round4(b1),
    rows: rows.length,
    median_age_days: Math.round(median(ages)),
  };
}

/** The fitted share of like peers that already record a token, 0..1. */
export function launchOdds(fit: OddsFit, p: Protocol, asOf: string): number {
  const age = ageDays(p, asOf) ?? fit.median_age_days;
  const z = fit.intercept + fit.slope * Math.log10(Math.max(1, age));
  return round4(1 / (1 + Math.exp(-z)));
}

// ------------------------------------------------------- validation

export interface Validation {
  comps: number;
  /** radar-3 value model, leave-one-out over the comps. */
  median_fold_error: number;
  within_2x_pct: number;
  within_3x_pct: number;
  rank_correlation: number;
  /** The same model under repeated 10-fold cross-validation (a second,
   * independent held-out test): median fold error over every held-out
   * prediction, 10 repeats of 10 folds, seeded splits. */
  cv_median_fold_error: number;
  /** Leave-one-out fold error on the comps at or above the snapshot floor. */
  big_median_fold_error: number;
  big_comps: number;
  /** The previous model (category median multiples), same leave-one-out. */
  baseline_median_fold_error: number;
  baseline_within_2x_pct: number;
  baseline_rank_correlation: number;
  /** Odds model: mean split-half AUC and calibration gap over 20 splits. */
  odds_auc: number;
  odds_calibration_gap: number;
}

const foldOf = (pred: number, actual: number): number => Math.max(pred / actual, actual / pred);

function valueLoo(comps: Comp[], only: ((c: Comp) => boolean) | null): { folds: number[]; preds: number[] } {
  const folds: number[] = [];
  const preds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const test = comps[i]!;
    if (only !== null && !only(test)) continue;
    const train = comps.filter((_, j) => j !== i);
    const pred = launchValue(fitValue(train), test.tvl);
    folds.push(foldOf(pred, test.mcap));
    preds.push(pred);
  }
  return { folds, preds };
}

/** The previous model's rule, re-implemented to be scored on the same test:
 * category median mcap/TVL, winsorised, shrunk to the global median. */
function baselineLoo(comps: Comp[]): { folds: number[]; preds: number[] } {
  const WLO = 0.02;
  const WHI = 8;
  const K = 10;
  const ratios = comps.map((c) => clamp(c.mcap / c.tvl, WLO, WHI));
  const folds: number[] = [];
  const preds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const test = comps[i]!;
    const looAll = ratios.filter((_, j) => j !== i);
    const g = median(looAll);
    const cat = ratios.filter((r, j) => j !== i && comps[j]!.protocol.category === test.protocol.category);
    const mult =
      cat.length > 0 ? clamp((cat.length * median(cat) + K * g) / (cat.length + K), 0.05, 2) : g;
    const pred = test.tvl * mult;
    folds.push(foldOf(pred, test.mcap));
    preds.push(pred);
  }
  return { folds, preds };
}

function valueCv(comps: Comp[]): number {
  const rand = rng(20261114);
  const folds: number[] = [];
  for (let rep = 0; rep < 10; rep++) {
    const order = shuffled(comps, rand);
    for (let f = 0; f < 10; f++) {
      const test = order.filter((_, i) => i % 10 === f);
      const train = order.filter((_, i) => i % 10 !== f);
      const fit = fitValue(train);
      for (const c of test) folds.push(foldOf(launchValue(fit, c.tvl), c.mcap));
    }
  }
  return median(folds);
}

function oddsValidation(protocols: Protocol[], asOf: string): { auc: number; gap: number } {
  const rows: { x: number; y: number }[] = [];
  for (const p of protocols) {
    const age = ageDays(p, asOf);
    if (age === null || age <= 0) continue;
    rows.push({ x: Math.log10(age), y: recordsToken(p) ? 1 : 0 });
  }
  const fitOn = (rs: { x: number; y: number }[]): { b0: number; b1: number } => {
    let b0 = 0;
    let b1 = 0;
    for (let iter = 0; iter < 100; iter++) {
      let g0 = 0;
      let g1 = 0;
      let h00 = 1e-6;
      let h01 = 0;
      let h11 = 1e-6;
      for (const r of rs) {
        const pr = 1 / (1 + Math.exp(-(b0 + b1 * r.x)));
        const d = r.y - pr;
        const w = pr * (1 - pr);
        g0 += d;
        g1 += d * r.x;
        h00 += w;
        h01 += w * r.x;
        h11 += w * r.x * r.x;
      }
      const det = h00 * h11 - h01 * h01;
      const s0 = (h11 * g0 - h01 * g1) / det;
      const s1 = (h00 * g1 - h01 * g0) / det;
      b0 += s0;
      b1 += s1;
      if (Math.abs(s0) < 1e-12 && Math.abs(s1) < 1e-12) break;
    }
    return { b0, b1 };
  };
  const rand = rng(20261123);
  const aucs: number[] = [];
  const gaps: number[] = [];
  for (let rep = 0; rep < 20; rep++) {
    const order = shuffled(rows, rand);
    const half = order.length >> 1;
    const { b0, b1 } = fitOn(order.slice(0, half));
    const test = order.slice(half);
    const scored = test.map((r) => ({ s: 1 / (1 + Math.exp(-(b0 + b1 * r.x))), y: r.y }));
    const pos = scored.filter((r) => r.y === 1).map((r) => r.s);
    const neg = scored.filter((r) => r.y === 0).map((r) => r.s);
    let wins = 0;
    for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
    aucs.push(wins / (pos.length * neg.length));
    const meanPred = scored.reduce((a, r) => a + r.s, 0) / scored.length;
    const meanY = test.reduce((a, r) => a + r.y, 0) / test.length;
    gaps.push(Math.abs(meanPred - meanY));
  }
  return { auc: round3(aucs.reduce((a, b) => a + b, 0) / aucs.length), gap: round3(gaps.reduce((a, b) => a + b, 0) / gaps.length) };
}

/** Score both value models and the odds model on held-out tests. */
export function validateModels(snapshot: Snapshot): Validation {
  const comps = pricingComps(snapshot.protocols);
  const loo = valueLoo(comps, null);
  const big = valueLoo(comps, (c) => c.tvl >= snapshot.floor_usd);
  const base = baselineLoo(comps);
  const odds = oddsValidation(snapshot.protocols, snapshot.as_of);
  const within = (folds: number[], cap: number): number =>
    Math.round((folds.filter((f) => f <= cap).length / folds.length) * 1000) / 10;
  const bigPreds: number[] = [];
  const bigActs: number[] = [];
  {
    let k = 0;
    for (let i = 0; i < comps.length; i++) {
      if (comps[i]!.tvl < snapshot.floor_usd) continue;
      bigPreds.push(big.preds[k]!);
      bigActs.push(comps[i]!.mcap);
      k++;
    }
  }
  return {
    comps: comps.length,
    median_fold_error: round3(median(loo.folds)),
    within_2x_pct: within(loo.folds, 2),
    within_3x_pct: within(loo.folds, 3),
    rank_correlation: round3(spearman(loo.preds, comps.map((c) => c.mcap))),
    cv_median_fold_error: round3(valueCv(comps)),
    big_median_fold_error: round3(median(big.folds)),
    big_comps: big.folds.length,
    baseline_median_fold_error: round3(median(base.folds)),
    baseline_within_2x_pct: within(base.folds, 2),
    baseline_rank_correlation: round3(spearman(base.preds, comps.map((c) => c.mcap))),
    odds_auc: odds.auc,
    odds_calibration_gap: odds.gap,
  };
}

// ------------------------------------------------------- farm plans

/** The stated sizing every plan on the board shares. */
export const PLAN = {
  deposit_usd: 1000,
  weeks: 8,
  /** Assumed share of a launch's supply that goes to early users. */
  community_pool: 0.05,
  /** Assumed share of that pool a $1,000 farmer captures: 1 in 5,000 —
   * the plan competes with roughly five thousand like-sized farmers. */
  farmer_share: 1 / 5_000,
  /** Planning estimate of the cash cost of one on-chain action, by chain. */
  action_cost: { ethereum: 6, other: 0.4 } as Record<string, number>,
  actions: 14,
  bridge_fee_usd: 9,
};

/** Cash cost of a plan on a protocol's chains, whole dollars. */
export function planCashCost(p: Protocol): number {
  const primary = (p.chains[0] ?? '').toLowerCase() === 'ethereum' ? PLAN.action_cost.ethereum : PLAN.action_cost.other;
  const bridge = p.chains.length > 1 ? PLAN.bridge_fee_usd : 0;
  return Math.max(3, Math.round(PLAN.actions * primary + bridge));
}

/** Hours a plan takes: a base of weekly upkeep plus category effort. */
export function planHours(p: Protocol): number {
  let hours = 6;
  if (p.category === 'Dexs' || p.category === 'Derivatives') hours += 3;
  if (p.chains.length > 3) hours += 1;
  return hours;
}

export type Verdict = 'FARM' | 'THIN' | 'SKIP';

/** Net a plan to $/hour and call it, from the row's own numbers. */
export function planEconomics(p: Protocol, implied: number): { cash: number; hours: number; reward: number; perHour: number; verdict: Verdict } {
  const cash = planCashCost(p);
  const hours = planHours(p);
  const reward = Math.round(implied * PLAN.community_pool * PLAN.farmer_share);
  const perHour = round2(reward / hours);
  const verdict: Verdict = perHour >= 8 ? 'FARM' : perHour >= 2 ? 'THIN' : 'SKIP';
  return { cash, hours, reward, perHour, verdict };
}

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** The category's core weekly action, the work the farm actually is. */
function coreAction(p: Protocol): string {
  const name = p.name;
  switch (p.category) {
    case 'Dexs':
      return `Route the $1,000 through ${name}'s main pools as a liquidity position in its busiest pair, and re-centre the range whenever it drifts out, so the wallet reads as a real liquidity provider.`;
    case 'Lending':
      return `Supply the $1,000 as collateral on ${name} and run a conservative borrow-repay loop against it, keeping the health factor comfortably high so the account accrues genuine lending history.`;
    case 'Derivatives':
      return `Trade small, hedged perpetual positions on ${name} with the $1,000 as margin, a few sessions a week, so the wallet builds a real trading record without directional risk.`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit the $1,000 into ${name}'s flagship vault and leave it compounding; move it only when a strictly better vault in the same product opens, so the position ages in place.`;
    case 'RWA':
      return `Onboard to ${name} and hold the $1,000 in its core real-world-asset product for the full plan, completing any attestation it asks of holders rather than trading in and out.`;
    case 'Risk Curators':
      return `Allocate the $1,000 through ${name}'s curated vaults and follow the curator's rebalances, so the wallet's history matches the risk profile the curator is building.`;
    case 'Onchain Capital Allocator':
      return `Place the $1,000 in ${name}'s main allocation strategy and track its rebalances weekly, adding activity only when the strategy itself moves.`;
    default:
      return `Put the $1,000 to work in ${name}'s core product on ${p.chains[0] ?? 'its main chain'} and use it the way a genuine user would, a little every week rather than in one burst.`;
  }
}

/** A costed farm plan: 6 concrete steps, the fifth carrying the costing. */
export function farmPlan(p: Protocol, implied: number, odds: number): { steps: string[]; verdict: Verdict; perHour: number; cash: number; hours: number; reward: number } {
  const eco = planEconomics(p, implied);
  const chainList = p.chains.length > 0 ? p.chains.join(', ') : 'its main chain';
  const steps = [
    `Fund one wallet with the plan's $1,000 and route it to ${p.chains[0] ?? 'the main chain'} (${chainList} listed); budget the bridge and gas in the cost line below before moving anything.`,
    coreAction(p),
    `Keep a weekly rhythm for ${PLAN.weeks} weeks: one or two genuine sessions a week, about ${Math.max(1, Math.round(eco.hours / PLAN.weeks))} hour(s) a week, never a single burst — eligibility snapshots reward accounts that were simply there, week after week.`,
    `Stay legible as one real user: the same wallet, no splitting across Sybil wallets, positions held through the whole plan, and a public trail of deposits and claims that a snapshot can read.`,
    `The costing, on the board's printed assumptions: cash costs about ${money(eco.cash)} in gas and bridge fees and the plan takes about ${eco.hours} hours; at a 5% community pool and a 1-in-5,000 farmer share, the fitted value (${money(implied)} at ${(odds * 100).toFixed(1)}% peer odds) prices the expected reward near ${money(eco.reward)} — ${money(eco.perHour)} an hour, which is why this row's verdict is ${eco.verdict}.`,
    `If ${p.name} announces a token, claim from the same wallet in the first window and sell into the listing's liquidity in tranches; if it never does, the plan's loss is capped at the cash cost and the hours, which the verdict already charged for.`,
  ];
  return { steps, verdict: eco.verdict, perHour: eco.perHour, cash: eco.cash, hours: eco.hours, reward: eco.reward };
}

// ------------------------------------------------------- the board

/** One row of the ranked board (board.json) and of the dashboard data. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  launch_value_usd: number;
  launch_odds: number;
  implied_value_usd: number;
  verdict: Verdict;
  usd_per_hour: number;
  plan_cash_usd: number;
  plan_hours: number;
  expected_reward_usd: number;
  farm_steps: string[];
}

/** A census line: every protocol in the snapshot, accounted for. */
export interface CensusLine {
  slug: string;
  bucket: 'ranked' | 'derivative' | 'token';
  reason: string;
}

export interface Radar {
  model_version: string;
  as_of: string;
  source: string;
  floor_usd: number;
  value_fit: ValueFit;
  odds_fit: OddsFit;
  validation: Validation;
  census: { total: number; ranked: number; derivative: number; token: number; priced: number };
  census_lines: CensusLine[];
  rows: BoardRow[];
}

/** Build the board, the census and the validation panel from a snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const comps = pricingComps(snapshot.protocols);
  const valueFit = fitValue(comps);
  const oddsFit = fitOdds(snapshot.protocols, snapshot.as_of);
  const validation = validateModels(snapshot);
  const watch = new Set(snapshot.watchlist);

  const censusLines: CensusLine[] = [];
  let priced = 0;
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) {
      if (p.mcap_usd !== null && p.mcap_usd > 0) priced++;
      censusLines.push({ slug: p.slug, bucket: 'token', reason: 'already records a token' });
      continue;
    }
    if (!isPreToken(p)) {
      censusLines.push({ slug: p.slug, bucket: 'token', reason: 'already records a token' });
      continue;
    }
    const reason = derivativeReason(p);
    if (reason !== null) {
      censusLines.push({ slug: p.slug, bucket: 'derivative', reason });
      continue;
    }
    censusLines.push({ slug: p.slug, bucket: 'ranked', reason: 'ranked on the board' });
    const launch = launchValue(valueFit, p.tvl_usd);
    const odds = launchOdds(oddsFit, p, snapshot.as_of);
    const implied = Math.max(1, Math.round(launch * odds));
    const plan = farmPlan(p, implied, odds);
    rows.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays(p, snapshot.as_of),
      watchlist: watch.has(p.slug),
      launch_value_usd: launch,
      launch_odds: odds,
      implied_value_usd: implied,
      verdict: plan.verdict,
      usd_per_hour: plan.perHour,
      plan_cash_usd: plan.cash,
      plan_hours: plan.hours,
      expected_reward_usd: plan.reward,
      farm_steps: plan.steps,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  const radar: Radar = {
    model_version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    value_fit: valueFit,
    odds_fit: oddsFit,
    validation,
    census: {
      total: snapshot.protocols.length,
      ranked: rows.length,
      derivative: censusLines.filter((l) => l.bucket === 'derivative').length,
      token: censusLines.filter((l) => l.bucket === 'token').length,
      priced,
    },
    census_lines: censusLines,
    rows,
  };
  return { board: rows, radar };
}

/** The gate's own shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${r.slug}: rank ${r.rank} at position ${i + 1}`;
    if (i > 0 && board[i - 1]!.implied_value_usd < r.implied_value_usd) return `row ${r.slug}: implied value rises with rank`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug}: a farm step is ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's data file: the whole radar, as one script. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
