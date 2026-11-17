# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kizuna99/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kizuna99/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**radar-2** ranks pre-token protocols by implied launch value:

```
implied = TVL × category_multiple × growth_factor × maturity_factor
```

The category multiple is *measured*, not asserted: for every category it is the median market-cap/TVL of the snapshot's own live, non-derivative tokens in that category — winsorised to [0.02, 8], shrunk toward the all-category median (0.2293) with k=10 phantom comparables, and clamped to [0.05, 2]. Derivative products (bridges, liquid staking/restaking, wrapped/staked variants, exchange-issued listings) are excluded from the whole board. The growth factor reads the 7-day TVL change; the maturity factor reads protocol age.

The board carries all 40 watchlist protocols plus every clean pre-token protocol below the floor — **178 rows** on the frozen snapshot, implied values from $780K to $1.04B (Steakhouse Financial on top). Every row ships a 6-step farm plan whose third step is a category-specific weekly action. After a run, open the generated `dashboard/index.html` to explore the board: detail views (`#p=<slug>`) recompute each implied value from the row's printed inputs, and the category filter (`#category=<name>`) slices the board — page and board agree exactly.

Layout: `main.ts` is the entrypoint, `lib/model.ts` is the model, `dashboard/` is the static board UI, `vendor/` is make.fun's own dossier library, `screenshots/` shows the board, a detail view, and a filtered view.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22, standard library only, no network. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/`, and `dossier.json` into the output directory, byte-identical across runs.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
