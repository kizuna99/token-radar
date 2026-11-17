// Token Launch Radar — dashboard logic.
//
// The page never trusts the board's arithmetic: every row's implied value
// is recomputed here from the row's own printed inputs (TVL, the measured
// category multiple, the 7-day change, the age in days), and every farm
// plan is rebuilt from the row's fields by the same derivation the model
// used. If a recomputation ever disagrees with the printed value, the row
// is flagged as stale instead of being shown as fact.

// === farm-model:start ===
// Mirrored from lib/model.ts — the two copies must not drift.
function clampNum(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

function growthMult(change7d) {
  var pct = clampNum(change7d == null ? 0 : change7d, -60, 120);
  return 1 + (pct / 100) * 0.5;
}

function maturityMult(ageDays) {
  return 0.6 + (Math.min(ageDays, 1095) / 1095) * 0.4;
}

function impliedOf(row) {
  return Math.round(row.tvl_usd * row.category_multiple * growthMult(row.change_7d) * maturityMult(row.age_days));
}

var CAPITAL_BY_CATEGORY = {
  'Lending': 1000, 'Risk Curators': 1000, 'Yield Aggregator': 500, 'Yield': 500,
  'Dexs': 500, 'Perps': 750, 'Derivatives': 750, 'Options': 750, 'Leveraged Farming': 750
};
var HOLD_BY_CATEGORY = {
  'Lending': 84, 'Risk Curators': 84, 'Yield Aggregator': 70, 'Yield': 70,
  'Dexs': 56, 'Perps': 28, 'Derivatives': 28, 'Options': 42, 'Leveraged Farming': 42
};

function capitalFor(category) { return CAPITAL_BY_CATEGORY[category] || 250; }
function holdDaysFor(category) { return HOLD_BY_CATEGORY[category] || 42; }

function weeklyActionFor(category, name) {
  switch (category) {
    case 'Lending':
      return 'Every week, borrow a small amount against the supplied collateral in ' + name + ' and repay it in the same session, so the account shows genuine borrowing activity without carrying liquidation risk overnight.';
    case 'Dexs':
      return 'Every week, make a few small swaps through ' + name + ' and adjust the liquidity range once, so the wallet shows steady trading volume and an actively managed position.';
    case 'Perps':
    case 'Derivatives':
      return 'Every week, open one small hedged position on ' + name + ' and close it within the day, so the account builds a real trading history without leaving directional risk open.';
    case 'Yield Aggregator':
    case 'Yield':
      return 'Every week, claim the accrued yield in ' + name + ' and compound it straight back into the same vault, so the position grows and the wallet shows a consistent restaking pattern.';
    case 'Risk Curators':
      return 'Every week, top up the ' + name + ' vault allocation by a small fixed amount and review the curator\'s latest reallocation note, so deposits arrive steadily rather than in one lump.';
    case 'Options':
      return 'Every week, buy one small short-dated option on ' + name + ' and let it settle, so the account shows repeated, completed options activity across several expiries.';
    case 'Leveraged Farming':
      return 'Every week, rebalance the leveraged position in ' + name + ' back to its target ratio and harvest any accrued rewards, keeping the loop active without letting it drift.';
    case 'Gaming':
    case 'NFT Lending':
    case 'NFT Marketplace':
      return 'Every week, complete one small in-product action on ' + name + ' \u2014 a listing, a bid or a session \u2014 so the account keeps a steady activity streak instead of a single visit.';
    default:
      return 'Every week, repeat one small core action inside ' + name + ' and rebalance the position back to its starting size, so the wallet shows steady, deliberate use of the product.';
  }
}

function farmStepsFor(row) {
  var capital = capitalFor(row.category);
  var hold = holdDaysFor(row.category);
  var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
  return [
    'Open ' + row.name + ' on ' + chain + ' from a fresh wallet kept only for this farm, and read the product docs and fee schedule before depositing anything.',
    'Deposit the starter stake of $' + capital + ' into the core ' + row.category + ' position on ' + row.name + '; keep the rest of the budget back for gas, fees and later top-ups.',
    weeklyActionFor(row.category, row.name),
    'Once a week, check the ' + row.name + ' dashboard and any points or eligibility page, and save a screenshot of the balance so a later snapshot or claim can be matched to this wallet.',
    'Watch ' + row.name + '\'s TVL and announcements: if TVL falls sharply or the farming rules change, pause new deposits and keep only the position that is already earning.',
    'Hold the position for about ' + hold + ' days, then reassess it against the implied launch value; if a token launch is announced, exit in steps as liquidity opens rather than all at once.'
  ];
}
// === farm-model:end ===

// ---------------------------------------------------------------- rendering

function fmtUsd(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n;
}

function fmtPct(x) {
  if (x == null) return '—';
  var cls = x >= 0 ? 'pos' : 'neg';
  return '<span class="' + cls + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function parseHash() {
  var h = window.location.hash.replace(/^#/, '');
  var out = {};
  h.split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv.length === 2) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    else if (part) out[part] = '';
  });
  return out;
}

function render(data) {
  var rows = data.rows;
  var watch = rows.filter(function (r) { return r.watchlist; }).length;
  document.getElementById('lede').textContent =
    rows.length + ' pre-token protocols ranked by implied launch value: the ' + watch +
    ' protocols on the watchlist plus every clean pre-token protocol below the $' +
    (data.floor_usd / 1e6) + 'M TVL floor. Derivative products — bridges, liquid staking, ' +
    'wrapped or staked wrappers, versioned relaunches and exchange product lines — are ' +
    'excluded from the whole board, not just from the watchlist. Snapshot: ' + data.as_of + '.';

  var m = data.model;
  document.getElementById('model-text').textContent =
    'Each category\u2019s multiple is measured from this snapshot, not assumed: take the live, ' +
    'non-derivative protocols in the category, winsorise their market-cap/TVL ratios to ' +
    '[0.02, 8], take the median, then shrink it toward the all-category median with 10 ' +
    'phantom comps and clamp to [0.05, 2]. Implied value = TVL \u00d7 category multiple \u00d7 ' +
    'growth (7-day TVL change, clamped to [\u221260%, +120%], half weight) \u00d7 maturity ' +
    '(0.6 at birth, 1.0 at three years). A category with no live comps prices at the ' +
    'all-category median.';
  document.getElementById('model-chips').innerHTML =
    '<span class="chip">model ' + esc(m.version) + '</span>' +
    '<span class="chip">global multiple ' + m.global_multiple.toFixed(4) + '</span>' +
    '<span class="chip">' + m.comps_total + ' live comps</span>' +
    '<span class="chip">' + m.categories_with_comps + ' categories priced</span>';

  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var sel = document.getElementById('category-select');
  cats.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', function () {
    window.location.hash = sel.value ? 'category=' + encodeURIComponent(sel.value) : '';
  });

  document.getElementById('footer-note').textContent =
    'Source: ' + data.source + '. Every implied value on this page is recomputed in the ' +
    'browser from the row\u2019s printed inputs; a row whose recomputation disagrees with the ' +
    'board is flagged as stale.';

  route(data);
}

function show(view) {
  document.getElementById('board-view').hidden = view !== 'board';
  document.getElementById('live-view').hidden = view !== 'live';
  document.getElementById('detail-view').hidden = view !== 'detail';
  document.querySelectorAll('.views a').forEach(function (a) {
    a.classList.toggle('active', a.getAttribute('data-view') === view);
  });
}

function boardTable(data, category) {
  var rows = data.rows.filter(function (r) { return !category || r.category === category; });
  var body = document.getElementById('board-body');
  body.innerHTML = rows.map(function (r) {
    var stale = impliedOf(r) !== r.implied_usd;
    return '<tr><td class="num">' + r.rank + '</td>' +
      '<td><a href="#p=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>' +
      (r.watchlist ? '<span class="tag">watchlist</span>' : '') + '</td>' +
      '<td>' + esc(r.category) + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
      '<td class="num">' + r.category_multiple.toFixed(4) + '</td>' +
      '<td class="num">' + fmtUsd(r.implied_usd) +
      (stale ? ' <span class="stale">stale</span>' : '') + '</td></tr>';
  }).join('');
  document.getElementById('board-note').textContent = category
    ? rows.length + ' protocols in ' + category + '. Clear the filter to see the whole board.'
    : 'Select a protocol for its implied-value breakdown and farm plan.';
}

function liveTable(data) {
  var body = document.getElementById('live-body');
  body.innerHTML = data.live.map(function (r) {
    return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.category) + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
      '<td class="num">' + r.ratio.toFixed(4) + '</td></tr>';
  }).join('');
}

function detail(data, slug) {
  var row = null;
  data.rows.forEach(function (r) { if (r.slug === slug) row = r; });
  if (!row) { show('board'); boardTable(data, null); return; }
  show('detail');
  document.getElementById('detail-name').textContent = row.name;
  document.getElementById('detail-sub').textContent =
    row.category + ' · ' + row.chains.join(', ') + ' · rank #' + row.rank +
    (row.watchlist ? ' · watchlist' : ' · early (below the floor)');
  var recomputed = impliedOf(row);
  var items = [
    ['TVL', fmtUsd(row.tvl_usd)],
    ['Category multiple', row.category_multiple.toFixed(4) + ' (' + row.comps + ' live comps)'],
    ['Growth multiplier', growthMult(row.change_7d).toFixed(4)],
    ['Maturity multiplier', maturityMult(row.age_days).toFixed(4) + ' (' + row.age_days + ' days old)'],
    ['Board implied value', fmtUsd(row.implied_usd)],
    ['Recomputed here', fmtUsd(recomputed)]
  ];
  document.getElementById('detail-math').innerHTML = items.map(function (kv) {
    return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>';
  }).join('');
  var check = document.getElementById('detail-check');
  if (recomputed === row.implied_usd) {
    check.textContent = 'Page and board agree to the dollar.';
    check.className = 'note';
  } else {
    check.textContent = 'Page and board disagree — this row\u2019s data is stale.';
    check.className = 'note stale';
  }
  document.getElementById('farm-summary').textContent =
    'Starter capital $' + row.farm.capital_usd + ' · hold about ' + row.farm.hold_days + ' days.';
  document.getElementById('farm-steps').innerHTML = farmStepsFor(row).map(function (s) {
    return '<li>' + esc(s) + '</li>';
  }).join('');
}

function route(data) {
  var h = parseHash();
  if (h.p) { detail(data, h.p); return; }
  if (Object.prototype.hasOwnProperty.call(h, 'live')) { show('live'); liveTable(data); return; }
  show('board');
  var sel = document.getElementById('category-select');
  if (h.category) sel.value = h.category;
  boardTable(data, h.category || null);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  window.addEventListener('hashchange', function () { route(window.RADAR_DATA); });
  document.getElementById('back-link').addEventListener('click', function () {
    setTimeout(function () { route(window.RADAR_DATA); }, 0);
  });
  render(window.RADAR_DATA);
}
