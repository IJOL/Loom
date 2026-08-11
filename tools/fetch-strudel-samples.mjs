// tools/fetch-strudel-samples.mjs
// ONE-SHOT. Downloads exactly the sounds the ported tunes ask for, from the
// same banks Strudel loads, and writes them as Loom drumkits and instruments.
//
//   node tools/fetch-strudel-samples.mjs [--only <id>]
//
// Three sources, resolved the way Strudel resolves them:
//   • Dirt-Samples — `samples('github:tidalcycles/dirt-samples')` fetches
//     `strudel.json` from that repo, a folder -> file-list map. `bd:5` is index
//     5 of the `bd` list. NOTE: dough-samples' own Dirt-Samples.json holds only
//     ten folders and NOT bd/sd/hh, so it is the wrong manifest for this.
//   • VCSL — a mixed map: an array for percussion, a note -> file object for
//     the pitched instruments.
//   • Whatever a tune names inline, verbatim.
//
// Percussion becomes a KIT (one pad per sound, note-addressed). A pitched
// instrument becomes a melodic instrument with one zone per note it ships; a
// single-sample instrument gets one zone spanning the keyboard, rooted at the
// pitch the file actually sounds.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public');
const only = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1] : null; })();

const DIRT = 'https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json';
const VCSL = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json';
const UZU = 'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json';
// The Dirt-Samples repo as the tunes that spell their own file lists reach it.
const DIRT_RAW = 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/';

const banks = {};
async function bank(url) {
  if (!banks[url]) banks[url] = await fetch(url).then((r) => r.json());
  return banks[url];
}

/** `bd:5` -> the absolute URL of that file in its bank. */
async function dirtUrl(name, index) {
  const b = await bank(DIRT);
  const files = b[name];
  if (!files) throw new Error(`Dirt-Samples has no folder "${name}"`);
  return b._base + files[index % files.length];
}
/** A file a tune names by path, resolved through the Dirt-Samples index so the
 *  casing is the repo's own — half those files are `.WAV`. Three tunes point at
 *  loophole-letters for their copies of exactly these files, and that host now
 *  404s, so they come from the source repo instead. */
async function dirtFile(path) {
  const b = await bank(DIRT);
  const want = path.toLowerCase();
  for (const files of Object.values(b)) {
    if (!Array.isArray(files)) continue;
    const hit = files.find((f) => f.toLowerCase() === want);
    if (hit) return b._base + hit;
  }
  throw new Error(`Dirt-Samples has no file "${path}"`);
}

async function uzuUrl(name, index) {
  const b = await bank(UZU);
  const files = b[name];
  if (!files) throw new Error(`uzu-drumkit has no folder "${name}"`);
  return b._base + files[index % files.length];
}
async function vcslUrl(name, index) {
  const b = await bank(VCSL);
  const e = b[name];
  if (!e) throw new Error(`VCSL has no "${name}"`);
  const files = Array.isArray(e) ? e : Object.values(e);
  return b._base + files[index % files.length];
}
/** VCSL's pitched entries are note -> file. */
async function vcslZones(name) {
  const b = await bank(VCSL);
  const e = b[name];
  if (Array.isArray(e)) throw new Error(`VCSL "${name}" is percussion, not pitched`);
  return Object.entries(e).map(([note, file]) => ({ note, url: b._base + file }));
}

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** `A#4`, `Ds1`, `c5` — every spelling these banks use. */
function noteToMidi(name) {
  const m = /^([A-Ga-g])(#|s|b?)(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`not a note name: ${name}`);
  const acc = m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0;
  return PC[m[1].toUpperCase()] + acc + (Number(m[3]) + 1) * 12;
}

async function download(url, dest) {
  if (existsSync(dest)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

/** One kit: `pads` is [{ note, source }] where source resolves to a URL. */
async function buildKit({ id, name, pads }) {
  const dir = join(PUB, 'drumkits', id);
  const samples = [];
  for (const p of pads) {
    const url = await p.url();
    const file = `${id}/${p.voice}.${url.split('.').pop().toLowerCase()}`;
    const fresh = await download(url, join(PUB, 'drumkits', file));
    console.log(`  ${fresh ? '+' : '='} ${file}`);
    samples.push({ voice: p.voice, note: p.note, file });
  }
  void dir;
  writeFileSync(join(PUB, 'drumkits', `${id}.json`), JSON.stringify({ id, name, samples }, null, 2) + '\n');
  console.log(`kit ${id}: ${samples.length} pads`);
}

/** The notes one tune plays through one sound. Used to drop the zones of a
 *  multisample no demo ever reaches: Psaltery ships eleven notes from A#3 up and
 *  Sample Demo plays it two octaves BELOW the lowest of them, so ten of those
 *  files are 3.4 MB that can never sound. */
function notesPlayed({ tune, source }) {
  const haps = JSON.parse(readFileSync(join(HERE, 'data', `${tune}-haps.json`), 'utf8'));
  return haps.events.filter((e) => e.value.s === source && e.value.note !== undefined)
    .map((e) => Math.round(e.value.note));
}

/** One melodic instrument: `zones` is [{ note, url }]; ranges are filled in so
 *  neighbouring roots meet halfway and the extremes reach the ends. */
async function buildInstrument({ id, name, zones, covers }) {
  if (covers) {
    const notes = notesPlayed(covers);
    const lo = Math.min(...notes), hi = Math.max(...notes);
    const roots = zones.map((z) => (typeof z.note === 'number' ? z.note : noteToMidi(z.note)));
    // Keep every root inside the range, plus the nearest one on each side so the
    // edges are still repitched from a neighbour rather than from far away.
    const inside = roots.filter((r) => r >= lo && r <= hi);
    const below = roots.filter((r) => r < lo).sort((a, b) => b - a)[0];
    const above = roots.filter((r) => r > hi).sort((a, b) => a - b)[0];
    const keep = new Set([...inside, below, above].filter((r) => r !== undefined));
    const kept = zones.filter((z, i) => keep.has(roots[i]));
    if (kept.length !== zones.length) console.log(`  (keeping ${kept.length}/${zones.length} zones for MIDI ${lo}..${hi})`);
    zones = kept;
  }
  const entries = [];
  for (const z of zones) {
    const midi = typeof z.note === 'number' ? z.note : noteToMidi(z.note);
    const file = `${id}/${basename(z.url).replace(/%23/g, 'sharp').replace(/%20/g, '_')}`;
    const fresh = await download(z.url, join(PUB, 'instruments', file));
    console.log(`  ${fresh ? '+' : '='} ${file}`);
    entries.push({ midi, file });
  }
  entries.sort((a, b) => a.midi - b.midi);
  const out = entries.map((e, i) => ({
    file: e.file,
    rootNote: e.midi,
    loNote: i === 0 ? 0 : Math.floor((entries[i - 1].midi + e.midi) / 2) + 1,
    hiNote: i === entries.length - 1 ? 127 : Math.floor((e.midi + entries[i + 1].midi) / 2),
  }));
  writeFileSync(
    join(PUB, 'instruments', `${id}.json`),
    JSON.stringify({ id, name, family: 'melodic', zones: out }, null, 2) + '\n',
  );
  console.log(`instrument ${id}: ${out.length} zones`);

  const idxPath = join(PUB, 'instruments', 'index.json');
  const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
  if (!idx.some((e) => e.id === id)) {
    idx.push({ id, name, family: 'melodic' });
    writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');
  }
}

// ── What each tune needs ────────────────────────────────────────────────────
// The pad notes are General MIDI where GM has the instrument, and consecutive
// from 36 where it does not (a chopped break is not a GM anything).
//
// A BARE `bd` does not mean one fixed sound. Strudel's prebake loads six banks
// and the LAST one wins, so a tune that neither calls `samples()` nor names a
// `bank()` gets uzu-drumkit — not Dirt-Samples. A tune that spells out its own
// file list means THAT list, so `bd:1` in Bass Fuge and `bd:1` in Melting
// Submarine are different kicks. Hence one kit per source rather than one
// shared "tidal drums" kit.
const JOBS = [
  // The prebake default: what `s("bd sd hh")` plays when a tune says nothing.
  { id: 'strudel-uzu', kind: 'kit', name: 'Uzu (Strudel default)', pads: [
    { voice: 'kick',      note: 36, url: () => uzuUrl('bd', 0) },
    { voice: 'rimshot',   note: 37, url: () => uzuUrl('rim', 0) },
    { voice: 'snare',     note: 38, url: () => uzuUrl('sd', 0) },
    { voice: 'clap',      note: 39, url: () => uzuUrl('cp', 0) },
    { voice: 'tomLo',     note: 41, url: () => uzuUrl('lt', 0) },
    { voice: 'closedHat', note: 42, url: () => uzuUrl('hh', 0) },
    { voice: 'tom',       note: 45, url: () => uzuUrl('mt', 0) },
    { voice: 'openHat',   note: 46, url: () => uzuUrl('oh', 0) },
    { voice: 'tomHi',     note: 48, url: () => uzuUrl('ht', 0) },
    { voice: 'crash',     note: 49, url: () => uzuUrl('cr', 0) },
    { voice: 'ride',      note: 51, url: () => uzuUrl('rd', 0) },
    { voice: 'tamb',      note: 54, url: () => uzuUrl('tb', 0) },
    { voice: 'cowbell',   note: 56, url: () => uzuUrl('cb', 0) },
    { voice: 'shaker',    note: 82, url: () => uzuUrl('sh', 0) },
    // belldub's `misc:2`, which exists in no other bank.
    { voice: 'misc2',     note: 76, url: () => uzuUrl('misc', 2) },
  ] },
  // Blippy Rhodes, Sample Drums and Underground Plumber all name the same three
  // Dirt-Samples files, mirrored on loophole-letters.
  { id: 'strudel-tidal-lo', kind: 'kit', name: 'Tidal (Dirt)', pads: [
    { voice: 'kick',      note: 36, url: () => dirtFile('bd/BT0A0D0.wav') },
    { voice: 'snare',     note: 38, url: () => dirtFile('sn/ST0T0S3.wav') },
    { voice: 'clap',      note: 39, url: () => dirtFile('cp/HANDCLP0.wav') },
    { voice: 'closedHat', note: 42, url: () => dirtFile('hh/000_hh3closedhh.wav') },
  ] },
  // Melting Submarine, off the full 218-folder dirt map it loads itself.
  { id: 'strudel-melting', kind: 'kit', name: 'Melting Submarine Drums', pads: [
    { voice: 'kick',      note: 36, url: () => dirtUrl('bd', 5) },
    { voice: 'snare',     note: 38, url: () => dirtUrl('sd', 1) },
    { voice: 'closedHat', note: 42, url: () => dirtUrl('hh27', 0) },
  ] },
  // Bass Fuge spells its own lists, so these indices are ITS indices.
  { id: 'strudel-bassfuge', kind: 'kit', name: 'Bass Fuge Drums', pads: [
    { voice: 'kick',      note: 36, url: () => `${DIRT_RAW}bd/BT0AAD0.wav` },
    { voice: 'snare',     note: 38, url: () => `${DIRT_RAW}sd/rytm-01-classic.wav` },
    { voice: 'closedHat', note: 42, url: () => `${DIRT_RAW}hh27/000_hh27closedhh.wav` },
  ] },
  // `n("0 1 2 3 4 5 6 7").s("amencutup")` is the break in order, so the pads run
  // in order from 36 and the mapper adds `n` to that base. `breath` and `east`
  // ride along: they are the same tune's other one-shots.
  { id: 'strudel-amencutup', kind: 'kit', name: 'Amen Cutup', pads: [
    ...Array.from({ length: 8 }, (_, i) => ({ voice: `slice${i}`, note: 36 + i, url: () => dirtUrl('amencutup', i) })),
    { voice: 'breath', note: 60, url: () => dirtUrl('breath', 0) },
    { voice: 'east0',  note: 62, url: () => dirtUrl('east', 0) },
    { voice: 'east1',  note: 63, url: () => dirtUrl('east', 1) },
  ] },
  { id: 'strudel-vcsl-perc', kind: 'kit', name: 'VCSL Percussion', pads: [
    { voice: 'woodblock1', note: 76, url: () => vcslUrl('woodblock', 1) },
    { voice: 'woodblock2', note: 77, url: () => vcslUrl('woodblock', 2) },
    { voice: 'snare_rim',  note: 37, url: () => vcslUrl('snare_rim', 0) },
    { voice: 'gong',       note: 52, url: () => vcslUrl('gong', 0) },
    { voice: 'brakedrum1', note: 53, url: () => vcslUrl('brakedrum', 1) },
    { voice: 'cowbell3',   note: 56, url: () => vcslUrl('cowbell', 3) },
  ] },
  { id: 'strudel-clavisynth',    kind: 'inst', name: 'Clavisynth',     zones: () => vcslZones('clavisynth'),     covers: { tune: 'sample-demo', source: 'clavisynth' } },
  { id: 'strudel-psaltery',      kind: 'inst', name: 'Psaltery Pluck', zones: () => vcslZones('psaltery_pluck'), covers: { tune: 'sample-demo', source: 'psaltery_pluck' } },
  { id: 'strudel-ocarina',       kind: 'inst', name: 'Ocarina',        zones: () => vcslZones('ocarina_vib'),    covers: { tune: 'holyflute', source: 'ocarina_vib' } },
  // Inline in the tunes themselves.
  { id: 'strudel-flbass', kind: 'inst', name: 'Fingered Bass', zones: () =>
    // All seven are the same C2; only the first is used as the playable zone,
    // the rest are articulations this tune selects with `n`, which we do not.
    [{ note: 'C2', url: 'https://raw.githubusercontent.com/cleary/samples-flbass/main/00_c2_finger_long_neck.wav' }] },
  { id: 'strudel-kalimba', kind: 'inst', name: 'Kalimba', zones: () =>
    [{ note: 'C5', url: 'https://cdn.freesound.org/previews/536/536549_11935698-lq.mp3' }] },
  { id: 'strudel-handbell', kind: 'inst', name: 'Hand Bell', zones: () =>
    [{ note: 'B4', url: 'https://cdn.freesound.org/previews/339/339809_5121236-lq.mp3' }] },
  { id: 'strudel-dinobass', kind: 'inst', name: 'Dino Bass', zones: () =>
    [{ note: 'C2', url: 'https://cdn.freesound.org/previews/614/614637_2434927-hq.mp3' }] },
  { id: 'strudel-dino', kind: 'inst', name: 'Dino', zones: () =>
    [{ note: 'B4', url: 'https://cdn.freesound.org/previews/316/316403_5123851-hq.mp3' }] },
  { id: 'strudel-bells', kind: 'inst', name: 'Bells', zones: () =>
    [{ note: 'C6', url: 'https://cdn.freesound.org/previews/411/411089_5121236-lq.mp3' }] },
  { id: 'strudel-bells-bass', kind: 'inst', name: 'Bells Bass', zones: () =>
    [{ note: 'D2', url: 'https://cdn.freesound.org/previews/608/608286_13074022-lq.mp3' }] },
];

for (const job of JOBS) {
  if (only && only !== job.id) continue;
  console.log(`\n== ${job.id}`);
  if (job.kind === 'kit') await buildKit(job);
  else await buildInstrument({ id: job.id, name: job.name, zones: await job.zones(), covers: job.covers });
}
