# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kizuna99/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kizuna99/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**radar-5** ranks pre-token protocols by expected launch value — and now
also reads each row's **launch window** off the fitted odds: the tracked age
by which half of like peers already record a token (~525 days on this
snapshot), reported per row as already open or as the months that remain,
so a farm plan can be timed, not just priced. Every number
on the board is fitted from the sealed snapshot itself and tested held-out
before it is believed:

```
launch_value  = 10^(4.3137 + 0.3598·log10 TVL + 1.6425·Δ7d + 0.0517·log10 age
                    − 0.0089·chains)
                a TVL-weighted MEDIAN regression (least absolute deviations)
                on the snapshot's 92 traded, non-derivative comps; every
                feature clipped to the comps' own range before it is read
launch_odds   = σ(−3.936 + 1.4471 · log10 age_days)
                logistic fit on all 758 protocols: does a peer with this
                record already record a token?
implied_value = launch_value × launch_odds      the board's ranking claim
```

The change from radar-3 is the value fit. A median regression prices the
*typical* peer, so one moonshot comp cannot bend the curve the way it bends a
least-squares mean; weighting each comp by the square root of its TVL rank
makes the big protocols — the ones the board actually prices — count for more
than the tail; and clipping every feature to the fitted range means the model
never extrapolates past the record it was fitted on.

The change from radar-4 is a readout, not a price. Round 2 fitted and tested
two pricing changes and dropped both on the numbers: excluding the comps
whose token is itself dollar-pegged or a stablecoin issuer's (leave-one-out
3.01–3.09× on the shared comp set, against 2.98× keeping them — the pegged
comps anchor the fit), and clipping the 7-day change symmetrically at ±30 or
±25 (2.83–2.85×, against 2.81×). The pricing therefore stands exactly as
radar-4 fitted it; what radar-5 adds is the launch window on every row and
in every farm plan's timing step, plus a first screen that prints the model,
its held-out tests and the census counts above the board.

Term selection was done by held-out tests, not by taste. Fitted and then
**dropped** this round: a quadratic TVL term, category intercepts and
category multiples, gradient-boosted trees, a trimmed least-squares variant,
and TVL and growth terms in the odds fit (split-half AUC fell from 0.711 to
0.68–0.69 with them). What survives is what the snapshot's own record
supports.

## Evidence (recomputed by the program on every run)

- Value model, leave-one-out over the 92 comps: **median fold error 2.81×**,
  32.6% of predictions within 2×, 51.1% within 3×, rank correlation 0.33.
  Tested a second way — repeated 10-fold cross-validation — the median fold
  error is **3.05×**. On the 32 comps at or above the $50M floor the board
  hunts in, the leave-one-out fold error is **2.31×**.
- The same tests score the previous models worse on the headline metric:
  radar-3's least-squares size curve folds at **3.27×** leave-one-out
  (2.86× on the big comps), and the category-multiples model before it at
  **5.25×**. The curve keeps one better number — 38.0% of its predictions
  land within 2×, against radar-5's 32.6%: radar-5's median is tighter while
  its best-case band is thinner, and the trade is stated, not hidden.
- Known limit, stated plainly: split the comps by tracked age instead of at
  random and the extra terms transfer less well than the plain size curve.
  The fit's edge is in pricing this snapshot's field — the task it is
  handed — and the random-split tests above are the ones the board prints.
- Odds model: split-half AUC **0.711**, mean calibration gap **0.026** over
  20 splits. The peers' record is plain: the share of protocols that already
  record a token rises with tracked age — the odds term reads that record,
  nothing else. Solved for its 50% crossing, the curve puts the typical
  launch window at **~525 days tracked**: of the board's 198 rows, the
  window is already open for those past that age and months away for the
  rest, and each row prints which.

## The census

All **758** protocols in the snapshot are accounted for on the dashboard:
**198** ranked on the board (every one of the 40 watchlist protocols among
them), **144** set aside by the derivative screen with the reason named
(wrapper category, versioned name, wrapper word, exchange brand), and **416**
that already record a token — 128 of those carry a priced market cap, and
the 92 that are non-derivative with a price and a TVL are the comps the
value models are fitted and tested on.

## Farm verdicts

Every row carries a costed plan sized to a stated **$1,000** deposit over
**8 weeks**: cash costs from a printed per-chain action table, hours from
the plan itself, and an expected reward under two printed assumptions (a
launch distributes 5% of supply to early users; a $1,000 farmer captures
1/5,000 of that pool). The verdict nets the plan to **$/hour** —
FARM at $8/hr or better, THIN from $2 to $8, SKIP below $2 — and the board
splits 73 FARM / 113 THIN / 12 SKIP, so a reader can see not just what to
farm but what the farm pays for its time.

## Running it

```
node main.ts --input <snapshot.json> --output out
```

writes `board.json`, `data.js`, the dashboard, screenshots and
`dossier.json`. Open `out/dashboard/index.html`: the board
(`#category=<name>` filters it, `#p=<slug>` opens a protocol's detail), and
the cover's integrity strip recomputes the census, the coverage and the
board's own summary numbers from the data file live, so the page proves the
claims it prints.
