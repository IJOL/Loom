// tools/build-drumkits-from-tidal.mjs
//
// Generates Loom sample drumkits from the tidal-drum-machines collection
// (ritchse/tidal-drum-machines on GitHub — the same packs Strudel loads by
// default). For every drum machine in the vendored catalog we pick one wav per
// Loom drum voice (with fallbacks), download it into public/drumkits/<id>/, and
// write the kit manifest + index + drum-kits preset entries.
//
// Pure data output — no source/TS changes. Re-runnable: it replaces its own
// generated entries each run and never touches the hand-made kits.
//
//   node tools/build-drumkits-from-tidal.mjs
//
// Source samples: https://github.com/ritchse/tidal-drum-machines (no explicit
// license; community-distributed, used by Strudel's default prebake).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public', 'drumkits');
const PRESETS = path.join(ROOT, 'public', 'presets', 'drum-kits.json');
const CATALOG = path.join(__dirname, 'tidal-drum-machines.json');
const BASE = 'https://raw.githubusercontent.com/ritchse/tidal-drum-machines/main/machines/';
const PRESET_GROUP = 'Drum Machines';

// Loom's 8 drum voices -> GM note + ordered list of tidal-drum-machine voice
// suffixes to try (first hit wins). kick+snare are required to make a kit.
const VOICES = [
  { voice: 'kick', note: 36, from: ['bd'], required: true },
  { voice: 'snare', note: 38, from: ['sd'], required: true },
  { voice: 'closedHat', note: 42, from: ['hh', 'sh'] },
  { voice: 'openHat', note: 46, from: ['oh'] },
  { voice: 'clap', note: 39, from: ['cp', 'rim'] },
  { voice: 'tom', note: 45, from: ['mt', 'lt', 'ht'] },
  { voice: 'cowbell', note: 56, from: ['cb', 'rim'] },
  { voice: 'ride', note: 51, from: ['rd', 'cr'] },
];

const PROTECTED_IDS = new Set(['tr808', 'acoustic', 'dirt']); // hand-made kits, never touched

const pretty = (m) =>
  m
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .trim();

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (q.length) await fn(q.shift());
    }),
  );
}

const catalog = JSON.parse(await readFile(CATALOG, 'utf8'));

// group catalog keys "<Machine>_<suffix>" -> { suffix: [paths...] }
const machines = new Map();
for (const key of Object.keys(catalog)) {
  const i = key.indexOf('_');
  if (i < 0) continue;
  const m = key.slice(0, i);
  const suf = key.slice(i + 1);
  if (!machines.has(m)) machines.set(m, {});
  machines.get(m)[suf] = catalog[key];
}

// resolve voices per machine
const plan = [];
const skipped = [];
for (const [m, avail] of machines) {
  let id = m.toLowerCase();
  if (PROTECTED_IDS.has(id)) id = `${id}-machine`;
  const samples = [];
  for (const spec of VOICES) {
    let chosen = null;
    for (const suf of spec.from) {
      const arr = avail[suf];
      if (Array.isArray(arr) && arr.length) {
        chosen = arr[0];
        break;
      }
    }
    if (chosen) samples.push({ voice: spec.voice, note: spec.note, srcPath: chosen });
  }
  const hasKick = samples.some((s) => s.voice === 'kick');
  const hasSnare = samples.some((s) => s.voice === 'snare');
  if (!hasKick || !hasSnare) {
    skipped.push(`${m} (no ${!hasKick ? 'kick' : ''}${!hasKick && !hasSnare ? '/' : ''}${!hasSnare ? 'snare' : ''})`);
    continue;
  }
  plan.push({ machine: m, id, name: pretty(m), samples });
}

console.log(`Machines in catalog: ${machines.size}`);
console.log(`Kits to build:       ${plan.length}`);
console.log(`Skipped (no kick/snare): ${skipped.length}`);
skipped.forEach((s) => console.log(`   - ${s}`));
console.log('');

// download every resolved voice
let totalBytes = 0;
let totalFiles = 0;
const failures = [];
const tasks = plan.flatMap((kit) => kit.samples.map((s) => ({ kit, s })));
console.log(`Downloading ${tasks.length} wavs...`);
await pool(tasks, 12, async ({ kit, s }) => {
  const url = BASE + encPath(s.srcPath);
  const destDir = path.join(PUB, kit.id);
  const dest = path.join(destDir, `${s.voice}.wav`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(destDir, { recursive: true });
    await writeFile(dest, buf);
    s.file = `${kit.id}/${s.voice}.wav`;
    totalBytes += buf.length;
    totalFiles++;
  } catch (e) {
    s.failed = true;
    failures.push(`${String(e)}  ${url}`);
  }
});

// drop pads that failed to download; require kick+snare survive
const finalKits = [];
for (const kit of plan) {
  kit.samples = kit.samples.filter((s) => s.file && !s.failed);
  const ok = kit.samples.some((s) => s.voice === 'kick') && kit.samples.some((s) => s.voice === 'snare');
  if (!ok) {
    console.log(`   dropped ${kit.id}: lost kick/snare to download failure`);
    continue;
  }
  finalKits.push(kit);
}

// write manifests
for (const kit of finalKits) {
  const manifest = {
    id: kit.id,
    name: kit.name,
    samples: kit.samples.map((s) => ({ voice: s.voice, note: s.note, file: s.file })),
  };
  await writeFile(path.join(PUB, `${kit.id}.json`), JSON.stringify(manifest, null, 2) + '\n');
}

// update index.json: keep non-generated, replace generated
const indexPath = path.join(PUB, 'index.json');
let index = JSON.parse(await readFile(indexPath, 'utf8'));
const genIds = new Set(finalKits.map((k) => k.id));
index = index.filter((e) => !genIds.has(e.id));
for (const kit of finalKits) index.push({ id: kit.id, name: kit.name });
await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');

// update drum-kits.json presets: drop our group, re-add fresh
const doc = JSON.parse(await readFile(PRESETS, 'utf8'));
doc.presets = doc.presets.filter((p) => p.group !== PRESET_GROUP);
for (const kit of finalKits) {
  doc.presets.push({ name: kit.name, group: PRESET_GROUP, kind: 'sample', drumkitId: kit.id });
}
await writeFile(PRESETS, JSON.stringify(doc, null, 2) + '\n');

console.log('');
console.log(`DONE: ${finalKits.length} kits, ${totalFiles} files, ${(totalBytes / 1e6).toFixed(1)} MB`);
if (failures.length) {
  console.log(`Failures: ${failures.length}`);
  failures.slice(0, 30).forEach((f) => console.log('   ' + f));
}
