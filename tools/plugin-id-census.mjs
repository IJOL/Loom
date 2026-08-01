// Census of hardcoded engine-id mentions in src/.
//
// The plugin migration's whole point is that the core stops KNOWING engine
// names. This counts what is left, so "we removed some" can be a number rather
// than an impression. Run it before and after each sweep.
//
//   node tools/plugin-id-census.mjs            # summary by file
//   node tools/plugin-id-census.mjs --lines    # every matching line
//   node tools/plugin-id-census.mjs --json out.json
import fs from 'node:fs';
import path from 'node:path';

// Every component the plugin boundary claims: "todo lo que suena es plugin".
// Engines are the default group; --group fx|modulator|notefx measures the other
// three, which trozo 3 turns into drop-in plugins too.
const GROUPS = {
  engine: [
    'tb303', 'subtractive', 'fm', 'wavetable', 'karplus',
    'westcoast', 'sampler', 'audio', 'drums-machine',
  ],
  fx: [
    'multifilter', 'distortion', 'reverb', 'delay', 'compressor',
    'limiter', 'tremolo', 'chorus', 'flanger', 'phaser', 'bitcrusher',
  ],
  modulator: ['lfo', 'adsr'],
  notefx: ['arp', 'chord'],
};

const groupAt = process.argv.indexOf('--group');
const group = groupAt !== -1 ? process.argv[groupAt + 1] : 'engine';
const IDS = GROUPS[group];
if (!IDS) {
  console.error(`--group must be one of: ${Object.keys(GROUPS).join(', ')}`);
  process.exit(1);
}
console.log(`grupo: ${group}\n`);

// 'audio' and 'fm' are short enough to hit unrelated words, so a mention only
// counts when the id is a whole quoted string.
const patterns = IDS.map((id) => ({
  id,
  re: new RegExp(`['"\`]${id}['"\`]`),
}));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

// A mention is only a DEFECT when the core is deciding behaviour from a name.
// Three kinds are not:
//   comment  — prose that happens to name an engine
//   own-file — a plugin's own file declaring its own id (leaves in trozo 3)
//   test     — a test naming the id it exercises, which is correct
const isComment = (t) => /^(\/\/|\/\*|\*)/.test(t.trim());
const ownsId = (rel, id) => path.basename(rel).replace(/\.ts$/, '').includes(id);

const hits = [];
for (const file of walk('src')) {
  const rel = file.split(path.sep).join('/');
  const isTest = rel.endsWith('.test.ts') || rel.includes('.test-helpers');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((text, i) => {
    const matched = patterns.filter((p) => p.re.test(text)).map((p) => p.id);
    if (!matched.length) return;
    const kind = isTest ? 'test'
      : isComment(text) ? 'comment'
      : matched.every((id) => ownsId(rel, id)) ? 'own-file'
      : 'core-decides';
    hits.push({ file: rel, isTest, kind, line: i + 1, ids: matched, text: text.trim() });
  });
}

const kinds = new Map();
for (const h of hits) kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
console.log('--- clasificacion ---');
for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), k);
console.log();

const prod = hits.filter((h) => h.kind === 'core-decides');
const byFile = new Map();
for (const h of prod) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
const byId = new Map();
for (const h of prod) for (const id of h.ids) byId.set(id, (byId.get(id) ?? 0) + 1);

console.log(`lineas con un id de motor: ${hits.length} (produccion ${prod.length}, tests ${hits.length - prod.length})`);
console.log(`ficheros de produccion afectados: ${byFile.size}`);
console.log('\n--- por id (solo produccion) ---');
for (const [id, n] of [...byId].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), id);
console.log('\n--- por fichero (solo produccion) ---');
for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), f);

if (process.argv.includes('--lines')) {
  console.log('\n--- todas las lineas de produccion ---');
  for (const h of prod) console.log(`${h.file}:${h.line}  ${h.text}`);
}
const jsonAt = process.argv.indexOf('--json');
if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(hits, null, 1));
  console.log(`\njson -> ${process.argv[jsonAt + 1]}`);
}
