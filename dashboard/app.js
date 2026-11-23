// radar-3 dashboard: renders window.RADAR (written by main.ts from the same
// board the gate scores) and recomputes the cover's claims from it, live.
(function () {
  var R = window.RADAR;
  var rows = R.rows;
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  $('asof').textContent = 'Snapshot as of ' + R.as_of + ' · ' + R.source + ' · model ' + R.model_version;

  // ---- integrity strip: recompute the claims from the data, do not trust them
  (function () {
    var c = R.census;
    var wl = rows.filter(function (r) { return r.watchlist; }).length;
    var sorted = rows.every(function (r, i) {
      return r.rank === i + 1 && (i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
    });
    var buckets = { ranked: 0, derivative: 0, token: 0 };
    R.census_lines.forEach(function (l) { buckets[l.bucket]++; });
    var checks = [
      ['census accounts for ' + c.total, buckets.ranked + buckets.derivative + buckets.token === c.total && R.census_lines.length === c.total],
      ['board rows ' + rows.length, buckets.ranked === rows.length && rows.length === c.ranked],
      ['watchlist covered ' + wl + '/40', wl === 40],
      ['ranks 1..N, value never rises', sorted],
      ['derivative screen named ' + c.derivative + ' reasons', buckets.derivative === c.derivative],
      ['implied = launch × odds on all rows', rows.every(function (r) {
        return r.implied_value_usd === Math.max(1, Math.round(r.launch_value_usd * r.launch_odds));
      })],
      ['every row carries its farm plan', rows.every(function (r) { return r.farm_steps.length >= 3; })]
    ];
    $('integrity').innerHTML = checks.map(function (ch) {
      return '<span class="chip">' + (ch[1] ? '<b>✓</b> ' : '<b>✗</b> ') + esc(ch[0]) + '</span>';
    }).join('');
  })();

  // ---- model panel: the fits and their held-out tests
  (function () {
    var vf = R.value_fit, of = R.odds_fit, v = R.validation;
    $('model').innerHTML =
      '<h2>The model — fitted here, tested held-out</h2>' +
      '<p class="eq">launch_value = 10^(' + vf.intercept + ' + ' + vf.slope + ' · log10 TVL) &nbsp;·&nbsp; ' +
      'launch_odds = σ(' + of.intercept + ' + ' + of.slope + ' · log10 age) &nbsp;·&nbsp; implied = launch_value × odds</p>' +
      '<div class="grid">' +
      '<div><div class="kv"><span>value fit comps (traded, non-derivative)</span><b>' + vf.comps + '</b></div>' +
      '<div class="kv"><span>LOO median fold error — radar-3</span><b>' + v.median_fold_error + '×</b></div>' +
      '<div class="kv"><span>LOO median fold error — previous model</span><b>' + v.baseline_median_fold_error + '×</b></div>' +
      '<div class="kv"><span>repeated 10-fold CV fold error</span><b>' + v.cv_median_fold_error + '×</b></div>' +
      '<div class="kv"><span>LOO on the ' + v.big_comps + ' comps ≥ $50M floor</span><b>' + v.big_median_fold_error + '×</b></div></div>' +
      '<div><div class="kv"><span>predictions within 2× / 3× (LOO)</span><b>' + v.within_2x_pct + '% / ' + v.within_3x_pct + '%</b></div>' +
      '<div class="kv"><span>previous model within 2× (LOO)</span><b>' + v.baseline_within_2x_pct + '%</b></div>' +
      '<div class="kv"><span>rank correlation (radar-3 vs previous)</span><b>' + v.rank_correlation + ' vs ' + v.baseline_rank_correlation + '</b></div>' +
      '<div class="kv"><span>odds fit rows / split-half AUC / calibration gap</span><b>' + of.rows + ' / ' + v.odds_auc + ' / ' + v.odds_calibration_gap + '</b></div></div>' +
      '</div>' +
      '<p>Terms the tests dropped: the 7-day TVL change, category intercepts and category multiples, and a TVL term in the odds fit — each was fitted, tested, and removed for failing to earn its place. The one number the old model wins is rank correlation; the trade is printed, not buried.</p>';
  })();

  // ---- census panel
  (function () {
    var c = R.census;
    $('census').innerHTML =
      '<h2>The census — all ' + c.total + ' protocols accounted for</h2>' +
      '<div class="grid">' +
      '<div class="kv"><span>ranked on the board</span><b>' + c.ranked + '</b></div>' +
      '<div class="kv"><span>set aside by the derivative screen</span><b>' + c.derivative + '</b></div>' +
      '<div class="kv"><span>already record a token</span><b>' + c.token + '</b></div>' +
      '<div class="kv"><span>of those, carrying a priced market cap</span><b>' + c.priced + '</b></div>' +
      '</div><p>The full ledger, one line per protocol with its bucket and reason, is at the foot of the page.</p>';
    $('ledger').innerHTML = '<h2>Census ledger</h2><div class="ledger">' + R.census_lines.map(function (l) {
      return '<div><span class="b-' + l.bucket + '">●</span> ' + esc(l.slug) + ' — ' + esc(l.reason) + '</div>';
    }).join('') + '</div>';
  })();

  // ---- board
  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; $('cat').appendChild(o);
  });

  function render() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value, ver = $('verdict').value, wl = $('wl').checked;
    var list = rows.filter(function (r) {
      return (!q || r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0) &&
        (!cat || r.category === cat) && (!ver || r.verdict === ver) && (!wl || r.watchlist);
    });
    $('shown').textContent = 'showing ' + list.length + ' of ' + rows.length + ' rows';
    var html = '<table class="board"><thead><tr>' +
      '<th class="l">#</th><th class="l">Protocol</th><th class="l">Category</th><th>TVL</th>' +
      '<th>Launch value</th><th>Odds</th><th>Implied</th><th>Verdict</th><th>$/hour</th></tr></thead><tbody>';
    list.forEach(function (r) {
      html += '<tr class="row" data-slug="' + esc(r.slug) + '"><td class="l num">' + r.rank + '</td>' +
        '<td class="l"><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="wl">watchlist</span>' : '') + '</td>' +
        '<td class="l">' + esc(r.category) + '</td><td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.launch_value_usd) + '</td><td class="num">' + (r.launch_odds * 100).toFixed(0) + '%</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="v' + r.verdict + '">' + r.verdict + '</td><td class="num">$' + r.usd_per_hour.toFixed(2) + '</td></tr>';
    });
    $('board').innerHTML = html + '</tbody></table>';
    Array.prototype.forEach.call(document.querySelectorAll('tr.row'), function (tr) {
      tr.addEventListener('click', function () { location.hash = 'p=' + tr.getAttribute('data-slug'); });
    });
  }

  function detail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var d = $('detail');
    if (!r) { d.hidden = true; return; }
    d.hidden = false;
    d.innerHTML = '<button class="back" id="back">← back to the board</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + ' <span class="v' + r.verdict + '">' + r.verdict + '</span></h2>' +
      '<div class="grid">' +
      '<div><div class="kv"><span>category</span><b>' + esc(r.category) + '</b></div>' +
      '<div class="kv"><span>chains</span><b>' + esc(r.chains.join(', ') || '—') + '</b></div>' +
      '<div class="kv"><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div class="kv"><span>7-day TVL change</span><b>' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(2) + '%') + '</b></div>' +
      '<div class="kv"><span>tracked since</span><b>' + (r.listed_at || 'unrecorded') + (r.age_days === null ? '' : ' (' + r.age_days + ' days)') + '</b></div></div>' +
      '<div><div class="kv"><span>launch value (fitted curve)</span><b>' + money(r.launch_value_usd) + '</b></div>' +
      '<div class="kv"><span>launch odds (peers’ record)</span><b>' + (r.launch_odds * 100).toFixed(1) + '%</b></div>' +
      '<div class="kv"><span>implied value</span><b>' + money(r.implied_value_usd) + '</b></div>' +
      '<div class="kv"><span>plan: cash / hours / expected reward</span><b>$' + r.plan_cash_usd + ' / ' + r.plan_hours + 'h / $' + r.expected_reward_usd + '</b></div>' +
      '<div class="kv"><span>plan nets to</span><b>$' + r.usd_per_hour.toFixed(2) + '/hour</b></div></div>' +
      '</div><h3>The farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('back').addEventListener('click', function () { location.hash = ''; });
    d.scrollIntoView();
  }

  function route() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('p=') === 0) { detail(h.slice(2)); return; }
    $('detail').hidden = true;
    if (h.indexOf('category=') === 0) { $('cat').value = decodeURIComponent(h.slice(9)); }
    render();
  }
  ['q', 'cat', 'verdict', 'wl'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  window.addEventListener('hashchange', route);
  route();
})();
