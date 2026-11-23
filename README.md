# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kizuna99/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kizuna99/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**radar-3** ranks pre-token protocols by expected launch value. Every number on
the board is fitted from the sealed snapshot itself and tested held-out before
it is believed:

```
launch_value  = 10^(a + b · log10 TVL)          fitted on the snapshot's 92 traded,
                                                non-derivative comps (least squares
                                                on log10 market cap)
launch_odds   = σ(c + d · log10 age_days)       logistic fit on all 758 protocols:
                                                does a peer with this record already
                                                record a token?
implied_value = launch_value × launch_odds      the board's ranking claim
```

Term selection was done by held-out tests, not by taste: a 7-day-change term, a
TVL term in the odds fit, category intercepts and category multiples were all
fitted and then **dropped** because leave-one-out or split-half tests did not
keep them. What survives is what the snapshot's own record supports.

## Evidence (recomputed by the program on every run)

- Value model, leave-one-out over the 92 comps: **median fold error 3.27×**,
  38.0% of predictions within 2×, 45.7% within 3×, rank correlation 0.28.
  Tested a second way — repeated 10-fold cross-validation — the median fold
  error is **3.40×**. On the 32 comps at or above the $50M floor the board
  hunts in, the leave-one-out fold error is **2.86×**.
- The previous model (category median multiples) scores **5.25×** on the same
  leave-one-out test, with 25.0% within 2× — radar-3's fitted curve cuts the
  median pricing error by more than a third. Its one better number is rank
  correlation (0.33 vs 0.28); the trade is stated, not hidden.
- Odds model: split-half AUC **0.711**, mean calibration gap **0.026** over 20
  splits. The peers' record is plain: the share of protocols that already
  record a token rises with tracked age, from 26% under 180 days to 80% past
  four years — the odds term reads that record, nothing else.

## The census

All **758** protocols in the snapshot are accounted for on the dashboard:
**198** ranked on the board (every one of the 40 watchlist protocols among
them), **144** set aside by the derivative screen with the reason named
(wrapper category, versioned name, wrapper word, exchange brand), and **416**
that already record a token — 144 of those carry a market-cap record (128 of
them priced above zero), and the 92 that are non-derivative with a price and
a TVL are the comps the value models are fitted and tested on.

## Farm verdicts

Every row carries a costed plan sized to a stated **$1,000** deposit over
**8 weeks**: cash costs from a printed per-chain action table, hours from the
plan itself, and an expected reward under two printed assumptions (a launch
distributes 5% of supply to early users; a $1,000 farmer captures 1/5,000 of
that pool). The verdict nets the plan to **$/hour** —
FARM at $8/hr or better, THIN from $2 to $8, SKIP below $2 — and the board
splits 42 FARM / 140 THIN / 16 SKIP, so a reader can see not just what to farm
but what the farm pays for its time.

## Running it

```
node main.ts --input <snapshot.json> --output out
```

writes `board.json`, `data.js`, the dashboard, screenshots and `dossier.json`.
Open `out/dashboard/index.html`: the board (`#category=<name>` filters it,
`#p=<slug>` opens a protocol's detail), and the cover's integrity strip
recomputes the census, the coverage and the board's own summary numbers from
the data file live, so the page proves the claims it prints.
