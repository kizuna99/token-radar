// main.ts — token-radar-01 entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores it with lib/model.ts (radar-2), and
// writes the four artefacts the grader expects into the output directory:
//
//   board.json    the ranked board, one row per protocol
//   data.js       the same board (plus live view and pricing) for the page
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  buildDossier(output) from the vendored library
//
// Input:  --input <path>, default /input/snapshot.json
// Output: $MAKEFUN_OUTPUT_DIR, default /output
// No network, no clock, no randomness: two runs agree byte for byte.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, MODEL_VERSION, validateModel, type Snapshot } from './lib/model.ts';

const root = dirname(fileURLToPath(import.meta.url));

function inputPath(argv: string[]): string {
  const at = argv.indexOf('--input');
  if (at >= 0 && argv[at + 1]) return argv[at + 1]!;
  return '/input/snapshot.json';
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const snapshot = JSON.parse(readFileSync(inputPath(process.argv.slice(2)), 'utf8')) as Snapshot;
  const board = buildBoard(snapshot);

  mkdirSync(outDir, { recursive: true });

  // board.json: the ranked board on its own, in the gate's row schema. The
  // model constants travel in data.js, beside the page that renders them.
  const boardJson = `${JSON.stringify({ rows: board.rows }, null, 2)}\n`;
  writeFileSync(join(outDir, 'board.json'), boardJson);
  const boardSha256 = createHash('sha256').update(boardJson).digest('hex');

  // The pricing model, back-tested leave-one-out on the snapshot's own live
  // protocols: evidence for the page, computed by the same pure code path.
  const validation = validateModel(snapshot.protocols);

  const categoryMultiples = Object.fromEntries(
    [...board.pricing.by_category.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([category, price]) => [category, price]),
  );

  // data.js: everything the dashboard renders, as one window global. The
  // page recomputes each row's implied value from the row's own printed
  // inputs (tvl, category_multiple, change_7d, age_days) and flags any row
  // where its recomputation disagrees with the board.
  const radarData = {
    model: {
      version: MODEL_VERSION,
      global_multiple: board.pricing.global_multiple,
      comps_total: board.pricing.comps_total,
      categories_with_comps: board.pricing.categories_with_comps,
      category_multiples: categoryMultiples,
    },
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    source: snapshot.source,
    board_sha256: boardSha256,
    validation,
    rows: board.rows.map((row) => {
      const detail = board.details.get(row.slug)!;
      return {
        rank: row.rank,
        slug: row.slug,
        name: row.name,
        category: row.category,
        chains: row.chains,
        tvl_usd: row.tvl_usd,
        change_7d: row.change_7d,
        age_days: row.age_days,
        watchlist: detail.watchlist,
        category_multiple: row.model.base_multiple,
        comps: detail.comps,
        growth_mult: detail.growth_mult,
        maturity_mult: detail.maturity_mult,
        implied_usd: row.implied_value_usd,
        farm: { capital_usd: detail.capital_usd, hold_days: detail.hold_days, steps: row.farm_steps },
      };
    }),
    live: board.live,
  };
  writeFileSync(join(outDir, 'data.js'), `window.RADAR_DATA = ${JSON.stringify(radarData, null, 2)};\n`);

  // The page and its screenshots travel with the board.
  cpSync(join(root, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

  // The dossier is written last, from the finished output directory, with
  // the same text cap the scorer uses.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const watchCount = [...board.details.values()].filter((d) => d.watchlist).length;
  console.log(
    `radar-2: ${board.rows.length} rows (${watchCount} watchlist, ` +
      `${board.rows.length - watchCount} early), ` +
      `${board.live.length} live set aside, global multiple ${board.pricing.global_multiple}`,
  );
  console.log(
    `validation (leave-one-out, ${validation.comps} live comps): median fold error ` +
      `${validation.median_fold_error}x, ${validation.within_2x_pct}% within 2x, ` +
      `${validation.within_3x_pct}% within 3x; flat-multiple baseline ` +
      `${validation.baseline_median_fold_error}x, ${validation.baseline_within_2x_pct}% within 2x`,
  );
  console.log(`board.json sha256 ${boardSha256}`);
}

main();
