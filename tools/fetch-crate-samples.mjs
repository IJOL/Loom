// tools/fetch-crate-samples.mjs
// ONE-SHOT. Downloads the nine samples the coastline patch actually plays from
// eddyflux/crate and registers them as a bundled drumkit.
//
// A sample kit is note-addressed and unbounded, and the drum grid labels each
// row from its NOTE, so the four sample VARIANTS the patch uses each get the GM
// note that describes them and no row label lies: two snares on 38 Snare and
// 40 Snare E, the three closed-hat samples on 42 CH / 44 Pedal HH / 46 OH, the
// two rides on 51 Ride 1 and 59 Ride 2.
//
//   node tools/fetch-crate-samples.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public');
const BASE = 'https://raw.githubusercontent.com/eddyflux/crate/main/';

// [voice, note, remote file] — the remote names come from the bank's own
// strudel.json, indexed exactly as the patch indexes them (sd:2, hh:3, rd:1 …).
const PADS = [
  ['kick',      36, 'crate_bd/kick-takecare-1.wav'],      // bd
  ['rimshot',   37, 'crate_rim/rimshot-fullcircle.wav'],  // rim
  ['snare',     38, 'crate_sd/snare-windowseat.wav'],     // sd:2
  ['snare2',    40, 'crate_sd/snare-trellis.wav'],        // sd:3
  ['closedHat', 42, 'crate_hh/closedhh-deepfind.wav'],    // hh:0
  ['pedalHat',  44, 'crate_hh/closedhh-lovesong-2.wav'],  // hh:1
  ['openHat',   46, 'crate_hh/closedhh-takecare.wav'],    // hh:3
  ['ride',      51, 'crate_rd/ride-reflections.wav'],     // rd:1
  ['ride2',     59, 'crate_rd/ride-lovesong.wav'],        // rd:2
];

mkdirSync(join(PUB, 'drumkits', 'crate'), { recursive: true });
const samples = [];
for (const [voice, note, remote] of PADS) {
  const res = await fetch(BASE + remote.split('/').map(encodeURIComponent).join('/'));
  if (!res.ok) throw new Error(`${remote}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = `crate/${voice}.wav`;
  writeFileSync(join(PUB, 'drumkits', file), bytes);
  samples.push({ voice, note, file });
  console.log(`  ${file}  ${(bytes.length / 1024).toFixed(0)} KB  <- ${remote}`);
}

writeFileSync(
  join(PUB, 'drumkits', 'crate.json'),
  JSON.stringify({ id: 'crate', name: 'Crate (Coastline)', samples }, null, 2) + '\n',
);

// Register in both indexes, idempotently.
const idxPath = join(PUB, 'drumkits', 'index.json');
const idx = JSON.parse(await readFile(idxPath, 'utf8'));
if (!idx.some((k) => k.id === 'crate')) idx.push({ id: 'crate', name: 'Crate (Coastline)' });
writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');

const presPath = join(PUB, 'presets', 'drum-kits.json');
const pres = JSON.parse(await readFile(presPath, 'utf8'));
if (!pres.presets.some((p) => p.drumkitId === 'crate')) {
  pres.presets.push({ name: 'Crate (Coastline)', group: 'Samples', kind: 'sample', drumkitId: 'crate' });
}
writeFileSync(presPath, JSON.stringify(pres, null, 2) + '\n');

console.log(`registered kit 'crate' with ${samples.length} pads`);
