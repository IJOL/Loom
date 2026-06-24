// tools/build-gm-percussion-kit.mjs
// Builds the "GM Percussion" sample drumkit from VCSL (github:sgossner/VCSL,
// CC0). Maps each GM percussion note (35..87 + a few GM2 extras) to one VCSL
// sample, downloads it into public/drumkits/gm-percussion/<note>.wav, and writes
// the manifest + index entry + drum-kits preset. Pure data output; re-runnable.
//
//   node tools/build-gm-percussion-kit.mjs            # download + write
//   node tools/build-gm-percussion-kit.mjs --dry      # resolve + report, no download
//   node tools/build-gm-percussion-kit.mjs --list KEY # print a VCSL key's files
//
// Source: https://github.com/sgossner/VCSL (CC0). Catalog vendored at tools/vcsl.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public', 'drumkits');
const KIT_ID = 'gm-percussion';
const KIT_NAME = 'GM Percussion';
const BASE = 'https://raw.githubusercontent.com/sgossner/VCSL/master/';

// note → { voice, key (VCSL catalog key), pick (ordered filename substrings;
// first hit wins, else falls back to the key's first file), root (optional
// repitch home; absent = native pitch) }. Substitutes are intentional where VCSL
// has no exact instrument (see spec). pick[] is best-effort; the report prints
// the actual chosen file so picks can be refined with --list.
const PADS = [
  { note: 35, voice: 'kickA',     key: 'bassdrum2',   pick: [] },
  { note: 36, voice: 'kick',      key: 'bassdrum1',   pick: [] },
  { note: 37, voice: 'sideStick', key: 'snare_rim',   pick: [] },
  { note: 38, voice: 'snare',     key: 'snare_modern',pick: ['Hit', 'hit'] },
  { note: 39, voice: 'clap',      key: 'clap',        pick: [] },
  { note: 40, voice: 'snareE',    key: 'snare_hi',    pick: [] },
  { note: 41, voice: 'tomLoFloor',key: 'tom2_mallet', pick: [], root: 43 },
  { note: 43, voice: 'tomHiFloor',key: 'tom2_mallet', pick: [] },
  { note: 45, voice: 'tomLo',     key: 'tom2_mallet', pick: [], root: 43 },
  // Tom 1 (tom_mallet) is gone from VCSL master (all files 404); use Tom 2
  // repitched up from its native note (43) for the mid/high toms.
  { note: 47, voice: 'tomLoMid',  key: 'tom2_mallet', pick: [], root: 43 },
  { note: 48, voice: 'tomHiMid',  key: 'tom2_mallet', pick: [], root: 43 },
  { note: 50, voice: 'tomHi',     key: 'tom2_mallet', pick: [], root: 43 },
  { note: 42, voice: 'closedHat', key: 'hihat',       pick: ['Close', 'HitC'] },
  { note: 44, voice: 'pedalHat',  key: 'hihat',       pick: ['Close', 'HitC'] }, // VCSL has no pedal hat; closed is the substitute
  { note: 46, voice: 'openHat',   key: 'hihat',       pick: ['HitO_', 'HitO'] },
  { note: 49, voice: 'crash1',    key: 'clash',       pick: [] },
  { note: 51, voice: 'ride1',     key: 'sus_cymbal',  pick: [] },
  { note: 52, voice: 'china',     key: 'gong2',       pick: [] },
  { note: 53, voice: 'rideBell',  key: 'fingercymbal',pick: [] },
  { note: 55, voice: 'splash',    key: 'clash2',      pick: [] },
  { note: 57, voice: 'crash2',    key: 'clash2',      pick: [] },
  { note: 59, voice: 'ride2',     key: 'sus_cymbal2', pick: [] },
  { note: 54, voice: 'tamb',      key: 'tambourine',  pick: ['Hit', 'hit'] },
  { note: 56, voice: 'cowbell',   key: 'cowbell',     pick: ['Cowbell1_Hit', 'Hit'] },
  { note: 58, voice: 'vibraslap', key: 'vibraslap',   pick: [] },
  { note: 60, voice: 'bongoHi',   key: 'bongo',       pick: ['BongoH_Hit', 'BongoH'] },
  { note: 61, voice: 'bongoLo',   key: 'bongo',       pick: ['BongoL_Hit', 'BongoL'] },
  { note: 62, voice: 'congaMute', key: 'conga',       pick: ['Quinto_HitFM', 'HitFM'] },
  { note: 63, voice: 'congaOpen', key: 'conga',       pick: ['Quinto_HitN', 'Conga_HitN'] },
  { note: 64, voice: 'congaLo',   key: 'conga',       pick: ['Tumba_HitN', 'Tumba'] },
  { note: 65, voice: 'timbaleHi', key: 'tom2_rim',    pick: [], root: 60 },
  { note: 66, voice: 'timbaleLo', key: 'tom2_rim',    pick: [], root: 64 },
  { note: 67, voice: 'agogoHi',   key: 'agogo',       pick: ['Agogo_High', 'High'] },
  { note: 68, voice: 'agogoLo',   key: 'agogo',       pick: ['Agogo_Low', 'Low'] },
  { note: 69, voice: 'cabasa',    key: 'cabasa',      pick: ['Cabasa1_Hit', 'Hit'] },
  { note: 70, voice: 'maracas',   key: 'shaker_small',pick: ['Slap', 'Hit'] },
  { note: 71, voice: 'whistleS',  key: 'ballwhistle', pick: ['Short'] },
  { note: 72, voice: 'whistleL',  key: 'ballwhistle', pick: ['Long'] },
  { note: 73, voice: 'guiroS',    key: 'guiro',       pick: ['Guiro_Hit', 'Fast'] },
  { note: 74, voice: 'guiroL',    key: 'guiro',       pick: ['Slow', 'Med'] },
  { note: 75, voice: 'claves',    key: 'clave',       pick: ['Claves1_Hit', 'Hit'] },
  { note: 76, voice: 'woodHi',    key: 'woodblock',   pick: ['wood_click_mp', 'click'], root: 72 },
  { note: 77, voice: 'woodLo',    key: 'woodblock',   pick: ['wood_click_mp', 'click'] },
  { note: 78, voice: 'cuicaMute', key: 'darbuka',     pick: ['Darbuka_1'], root: 64 }, // no mute/open variants; distinct hits + repitch substitute
  { note: 79, voice: 'cuicaOpen', key: 'darbuka',     pick: ['Darbuka_3'], root: 60 },
  { note: 80, voice: 'triMute',   key: 'triangles',   pick: ['HitM', 'Hit_'] },
  { note: 81, voice: 'triOpen',   key: 'triangles',   pick: ['Triangle1_Hit_v1', 'Hit_'] },
  { note: 82, voice: 'shaker',    key: 'shaker_large',pick: ['LShaker_Hit', 'Hit'] },
  { note: 83, voice: 'jingle',    key: 'sleighbells', pick: [] },
  { note: 84, voice: 'belltree',  key: 'marktrees',   pick: [] },
  { note: 85, voice: 'castanet',  key: 'slapstick',   pick: [] },
  { note: 86, voice: 'surdoMute', key: 'framedrum',   pick: ['HitMuted', 'Muted'], root: 43 },
  { note: 87, voice: 'surdoOpen', key: 'framedrum',   pick: ['HDrumL_Hit_v2', '_Hit_v'], root: 41 },
];

function pickFile(catalog, pad) {
  const arr = catalog[pad.key];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  for (const sub of pad.pick) {
    const hit = arr.find((p) => p.toLowerCase().includes(sub.toLowerCase()));
    if (hit) return hit;
  }
  return arr[0]; // fallback: first file for the key
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

const catalog = JSON.parse(await readFile(path.join(__dirname, 'vcsl.json'), 'utf8'));

// --list KEY
const listIdx = process.argv.indexOf('--list');
if (listIdx >= 0) {
  const key = process.argv[listIdx + 1];
  console.log((catalog[key] ?? [`(no key '${key}')`]).join('\n'));
  process.exit(0);
}
const DRY = process.argv.includes('--dry');

// resolve every pad
const resolved = [];
const missing = [];
for (const pad of PADS) {
  const src = pickFile(catalog, pad);
  if (!src) { missing.push(pad); continue; }
  // preserve the source extension (most VCSL files are .wav, a few are .mp3) so
  // we never write mp3 bytes into a .wav-named file.
  const ext = (src.split('.').pop() || 'wav').toLowerCase();
  resolved.push({ ...pad, src, file: `${KIT_ID}/${pad.note}.${ext}` });
}

console.log(`Pads: ${PADS.length} | resolved: ${resolved.length} | missing key: ${missing.length}`);
for (const r of resolved) console.log(`  ${String(r.note).padStart(3)} ${r.voice.padEnd(11)} ${r.key.padEnd(14)} -> ${decodeURIComponent(r.src.split('/').pop())}`);
if (missing.length) { console.log('MISSING KEYS:'); missing.forEach((m) => console.log(`  ${m.note} ${m.voice} (${m.key})`)); }

if (DRY) process.exit(missing.length ? 1 : 0);
if (missing.length) { console.error('Refusing to build with missing keys — fix PADS.'); process.exit(1); }

// download
const destDir = path.join(PUB, KIT_ID);
await mkdir(destDir, { recursive: true });
let bytes = 0; const failures = [];
await pool(resolved, 12, async (r) => {
  const url = BASE + r.src; // already %20-encoded
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(path.join(PUB, r.file), buf);
    bytes += buf.length;
  } catch (e) { r.failed = true; failures.push(`${String(e)}  ${url}`); }
});

const ok = resolved.filter((r) => !r.failed);
if (ok.length < resolved.length) { console.log(`Download failures: ${failures.length}`); failures.forEach((f) => console.log('  ' + f)); }

// manifest
const manifest = {
  id: KIT_ID, name: KIT_NAME,
  samples: ok.map((r) => ({ voice: r.voice, note: r.note, file: r.file, ...(r.root != null ? { root: r.root } : {}) })),
};
await writeFile(path.join(PUB, `${KIT_ID}.json`), JSON.stringify(manifest, null, 2) + '\n');

// index.json — replace our entry
const indexPath = path.join(PUB, 'index.json');
let index = JSON.parse(await readFile(indexPath, 'utf8'));
index = index.filter((e) => e.id !== KIT_ID);
index.push({ id: KIT_ID, name: KIT_NAME });
await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');

// NOTE: we deliberately do NOT touch public/presets/drum-kits.json. That file is
// the Drums-page kit list (engineId 'drums'); the GM kit is a Sampler drumkit
// (engineId 'sampler') and surfaces via index.json in the Sampler selector,
// where the drum grid renders all ~52 pads (a Drums lane would show only 8).

console.log(`DONE: ${ok.length} pads, ${(bytes / 1e6).toFixed(1)} MB`);
