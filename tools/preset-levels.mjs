// What does a shipped preset actually PEAK at, and which ones are outliers?
//
// A level is only wrong relative to its neighbours: "too loud" means louder
// than the catalogue it sits in, not louder than some number. So this renders
// every preset of every engine through the real kernel and prints the
// distribution, then names the ones outside it.
//
// Usage: npx tsx tools/preset-levels.mjs   (needs the TS kernel — run via vitest
// instead if tsx is absent; see test/preset-stability.dsp.test.ts, which shares
// the same construction).
import { readFileSync } from 'node:fs';

const ENGINES = ['tb303', 'subtractive', 'fm', 'wavetable', 'karplus', 'westcoast'];

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Reported by test/preset-stability.dsp.test.ts — this file only summarises,
 *  so the measurement has exactly one owner. Pass it the JSON that test prints
 *  with PRESET_LEVELS=1. */
const peaks = JSON.parse(process.argv[2] ?? '{}');

const rows = [];
for (const id of ENGINES) {
  for (const p of read(`plugins/${id}/presets.json`).presets) {
    const key = `${id} · ${p.name}`;
    if (peaks[key] !== undefined) rows.push([key, peaks[key]]);
  }
}
if (rows.length === 0) {
  console.log('no measurements passed in — run the sweep with PRESET_LEVELS=1 and pipe its JSON here');
  process.exit(0);
}

const vals = rows.map(([, v]) => v).sort((a, b) => a - b);
const q = (f) => vals[Math.min(vals.length - 1, Math.floor(vals.length * f))];
console.log(`n=${vals.length}  min=${vals[0].toFixed(2)}  p25=${q(0.25).toFixed(2)}  median=${q(0.5).toFixed(2)}  p75=${q(0.75).toFixed(2)}  p95=${q(0.95).toFixed(2)}  max=${vals[vals.length - 1].toFixed(2)}`);

const median = q(0.5);
console.log(`\nfurthest from the median (${median.toFixed(2)}):`);
for (const [key, v] of rows.sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${v.toFixed(2)}  (${(v / median).toFixed(1)}x median)  ${key}`);
}
