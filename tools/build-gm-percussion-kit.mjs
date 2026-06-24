// tools/build-gm-percussion-kit.mjs
// Builds the "GM Percussion" sample drumkit from VCSL (github:sgossner/VCSL,
// CC0). Maps each GM percussion note (35..87 + a few GM2 extras) to one VCSL
// sample, downloads it and transcodes to public/drumkits/gm-percussion/<note>.ogg (ffmpeg), and writes
// the manifest + index entry + drum-kits preset. Pure data output; re-runnable.
//
//   node tools/build-gm-percussion-kit.mjs            # download + write
//   node tools/build-gm-percussion-kit.mjs --dry      # resolve + report, no download
//   node tools/build-gm-percussion-kit.mjs --list KEY # print a VCSL key's files
//
// Source: https://github.com/sgossner/VCSL (CC0). Catalog vendored at tools/vcsl.json.
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public', 'drumkits');
const KIT_ID = 'gm-percussion';
const KIT_NAME = 'GM Percussion';
const BASE = 'https://raw.githubusercontent.com/sgossner/VCSL/master/';

// note → { voice, key (VCSL catalog key), pick (ordered filename substrings;
// first hit wins, else falls back to the key's first file) }. Each pad plays at
// its sample's native pitch (no repitch — repitch collided in the sampler's
// per-pad UI, which keys columns by rootNote). Substitutes are intentional where
// VCSL has no exact instrument (see spec). pick[] is best-effort; the report
// prints the actual chosen file so picks can be refined with --list.
const PADS = [
  // PERCUSSION ONLY — this is NOT a standard drum kit. Kick/snare/hi-hats/toms/
  // cymbals (GM notes 35..53) are covered by the 808/909/tidal/acoustic kits;
  // this kit only adds the GM auxiliary/Latin percussion (notes 54..87) those
  // kits lack, so it layers on top of a normal drum lane.
  { note: 54, voice: 'tamb',      key: 'tambourine',  pick: ['Hit', 'hit'] },
  { note: 56, voice: 'cowbell',   key: 'cowbell',     pick: ['Cowbell1_Hit', 'Hit'] },
  { note: 58, voice: 'vibraslap', key: 'vibraslap',   pick: [] },
  { note: 60, voice: 'bongoHi',   key: 'bongo',       pick: ['BongoH_Hit', 'BongoH'] },
  { note: 61, voice: 'bongoLo',   key: 'bongo',       pick: ['BongoL_Hit', 'BongoL'] },
  { note: 62, voice: 'congaMute', key: 'conga',       pick: ['Quinto_HitFM', 'HitFM'] },
  { note: 63, voice: 'congaOpen', key: 'conga',       pick: ['Quinto_HitN', 'Conga_HitN'] },
  { note: 64, voice: 'congaLo',   key: 'conga',       pick: ['Tumba_HitN_v4', 'Tumba_HitN_v3', 'Tumba_HitN'] }, // v1 was near-silent
  { note: 65, voice: 'timbaleHi', key: 'tom2_rim',    pick: [] },
  { note: 66, voice: 'timbaleLo', key: 'tom2_rim',    pick: [] },
  { note: 67, voice: 'agogoHi',   key: 'agogo',       pick: ['Agogo_High', 'High'] },
  { note: 68, voice: 'agogoLo',   key: 'agogo',       pick: ['Agogo_Low', 'Low'] },
  { note: 69, voice: 'cabasa',    key: 'cabasa',      pick: ['Cabasa1_Hit', 'Hit'] },
  { note: 70, voice: 'maracas',   key: 'shaker_small',pick: ['Slap', 'Hit'] },
  { note: 71, voice: 'whistleS',  key: 'ballwhistle', pick: ['Short'] },
  { note: 72, voice: 'whistleL',  key: 'ballwhistle', pick: ['Long'] },
  { note: 73, voice: 'guiroS',    key: 'guiro',       pick: ['Guiro_Hit', 'Fast'] },
  { note: 74, voice: 'guiroL',    key: 'guiro',       pick: ['Slow', 'Med'] },
  { note: 75, voice: 'claves',    key: 'clave',       pick: ['Claves1_Hit', 'Hit'] },
  { note: 76, voice: 'woodHi',    key: 'woodblock',   pick: ['wood_click_mp', 'click'] },
  { note: 77, voice: 'woodLo',    key: 'woodblock',   pick: ['wood_click_mp', 'click'] },
  { note: 78, voice: 'cuicaMute', key: 'darbuka',     pick: ['Darbuka_1'] }, // no mute/open variants; distinct hits + repitch substitute
  { note: 79, voice: 'cuicaOpen', key: 'darbuka',     pick: ['Darbuka_3'] },
  { note: 80, voice: 'triMute',   key: 'triangles',   pick: ['HitM', 'Hit_'] },
  { note: 81, voice: 'triOpen',   key: 'triangles',   pick: ['Triangle1_Hit_v1', 'Hit_'] },
  { note: 82, voice: 'shaker',    key: 'shaker_large',pick: ['LShaker_Hit', 'Hit'] },
  { note: 83, voice: 'jingle',    key: 'sleighbells', pick: [] },
  { note: 84, voice: 'belltree',  key: 'marktrees',   pick: [] },
  { note: 85, voice: 'castanet',  key: 'slapstick',   pick: [] },
  { note: 86, voice: 'surdoMute', key: 'framedrum',   pick: ['HitMuted', 'Muted'] },
  { note: 87, voice: 'surdoOpen', key: 'framedrum',   pick: ['HDrumL_Hit_v2', '_Hit_v'] },
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
  // Track the source extension (most VCSL files are .wav, a few are .mp3) for the
  // temp download; the committed asset is always transcoded to .ogg (see below).
  const srcExt = (src.split('.').pop() || 'wav').toLowerCase();
  resolved.push({ ...pad, src, srcExt, file: `${KIT_ID}/${pad.note}.ogg` });
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
// Download each VCSL file to a temp, peak-normalize, then transcode to OGG/Vorbis
// (q5 ≈ ~160kbps VBR). Normalize because raw VCSL levels span ~57dB (some pads
// near-silent next to a hot clap) — peak-boost each pad toward -1dB so nothing is
// inaudible; balance is then tuned per-pad with the rack LEVEL knobs. Only boost
// (never attenuate) and cap the gain so we don't amplify a near-silent file's
// noise floor. Vorbis has no encoder delay, so drum transients stay tight.
// Requires ffmpeg on PATH.
const TARGET_PEAK_DB = -1, MAX_BOOST_DB = 24;
await pool(resolved, 8, async (r) => {
  const url = BASE + r.src; // already %20-encoded
  const tmp = path.join(PUB, `${KIT_ID}/.tmp-${r.note}.${r.srcExt}`);
  const out = path.join(PUB, r.file);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
    const det = execSync(`ffmpeg -i "${tmp}" -af volumedetect -f null - 2>&1`).toString();
    const mm = det.match(/max_volume:\s*(-?[\d.]+) dB/);
    const peak = mm ? parseFloat(mm[1]) : 0;
    const gain = Math.max(0, Math.min(MAX_BOOST_DB, TARGET_PEAK_DB - peak));
    const af = gain > 0.1 ? `-af "volume=${gain.toFixed(1)}dB"` : '';
    execSync(`ffmpeg -y -loglevel error -i "${tmp}" ${af} -c:a libvorbis -q:a 5 "${out}"`);
    await unlink(tmp);
    bytes += (await readFile(out)).length;
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

// drum-kits.json — register the kit on the Drums page too (group "Percussion"),
// so it sits next to 808/909/tidal. It is a kind:'sample' entry; the Drums engine
// loads it in kitMode 'sample' (delegating to the embedded sampler) and the drum
// grid shows every pad. It is ALSO listed in index.json (above) for the Sampler.
const presetsPath = path.join(ROOT, 'public', 'presets', 'drum-kits.json');
const doc = JSON.parse(await readFile(presetsPath, 'utf8'));
doc.presets = doc.presets.filter((p) => !(p.kind === 'sample' && p.drumkitId === KIT_ID));
doc.presets.push({ name: KIT_NAME, group: 'Percussion', kind: 'sample', drumkitId: KIT_ID });
await writeFile(presetsPath, JSON.stringify(doc, null, 2) + '\n');

console.log(`DONE: ${ok.length} pads, ${(bytes / 1e6).toFixed(1)} MB`);
