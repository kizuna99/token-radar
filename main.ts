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

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, MODEL_VERSION, type Snapshot } from './lib/model.ts';

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

  // board.json: the ranked board on its own, with the model constants that
  // produced it, so a reader can recompute every implied value from the
  // printed inputs alone.
  const boardDoc = {
    model: MODEL_VERSION,
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    global_multiple: board.pricing.global_multiple,
    category_multiples: Object.fromEntries(
      [...board.pricing.by_category.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([category, price]) => [category, price]),
    ),
    rows: board.rows,
  };
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(boardDoc, null, 2)}\n`);

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
      category_multiples: boardDoc.category_multiples,
    },
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    source: snapshot.source,
    rows: board.rows.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      age_days: row.age_days,
      watchlist: row.watchlist,
      category_multiple: row.model.category_multiple,
      comps: row.model.comps,
      growth_mult: row.model.growth_mult,
      maturity_mult: row.model.maturity_mult,
      implied_usd: row.implied_usd,
      farm: row.farm,
    })),
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

  console.log(
    `radar-2: ${board.rows.length} rows (${board.rows.filter((r) => r.watchlist).length} watchlist, ` +
      `${board.rows.length - board.rows.filter((r) => r.watchlist).length} early), ` +
      `${board.live.length} live set aside, global multiple ${board.pricing.global_multiple}`,
  );
}

main();
