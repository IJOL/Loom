// tools/dep-matrix.mjs
// Cross-subsystem import matrix for src/. Answers the question a framework must
// answer and this repo currently doesn't: which layer may depend on which.
// Reports edge counts between top-level folders under src/, plus every 2-cycle
// (A imports B AND B imports A) — the shape that makes layering impossible.
//
// IMPORTANT — an edge is not an edge. Every import is classified:
//   value : survives compilation; a real runtime dependency.
//   type  : `import type` / all-`type` specifiers / `import('x').T` in a type
//           position. ERASED by tsc — it constrains nothing at runtime and
//           cannot make a load-order cycle.
// A "cycle" made only of type edges is a naming problem, not a runtime one, and
// counting the two together is what made an earlier audit read as alarming.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';

const SRC = resolve('src');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e) && !/test-helpers/.test(e)) out.push(p);
  }
  return out;
}

const subsystemOf = (file) => {
  const rel = relative(SRC, file);
  const parts = rel.split(sep);
  return parts.length === 1 ? '(root)' : parts[0];
};

// One import statement (or inline type-position `import('x').T`) per match.
// g1 = whole statement head, g2 = specifier path.
const IMPORT_RE = /(?:^|\n)\s*import\s+([^;'"]*?)\s*from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)(\s*\.)?/g;

function classify(head, inlineTail) {
  if (inlineTail !== undefined) {
    // `import('../x').Thing` — a type query. A dynamic *value* import is
    // `await import(...)` / `import(...).then(...)`, i.e. no `.Identifier`.
    return inlineTail && !/\.\s*then/.test(inlineTail) ? 'type' : 'value';
  }
  const h = head ?? '';
  if (/^type\b/.test(h.trim())) return 'type';
  const braced = h.match(/\{([^}]*)\}/);
  const bare = h.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
  if (braced && !bare) {
    const specs = braced[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (specs.length && specs.every((s) => /^type\s/.test(s))) return 'type';
  }
  return 'value';
}

const files = walk(SRC);
const edges = new Map();          // "from->to" -> { value, type }
const examples = new Map();       // "from->to" -> [sample lines]

for (const file of files) {
  const from = subsystemOf(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[2] ?? m[3];
    const kind = classify(m[1], m[2] ? undefined : (m[4] ?? ''));
    const target = resolve(dirname(file), spec);
    if (!target.startsWith(SRC)) continue;
    const to = subsystemOf(target + '.ts');
    if (to === from) continue;
    const key = `${from}->${to}`;
    const cell = edges.get(key) ?? { value: 0, type: 0 };
    cell[kind]++;
    edges.set(key, cell);
    if (!examples.has(key)) examples.set(key, []);
    if (examples.get(key).length < 2) {
      examples.get(key).push(`[${kind}] ${relative(SRC, file)}  →  ${spec}`);
    }
  }
}

const total = (c) => c.value + c.type;
const sorted = [...edges.entries()].sort((a, b) => total(b[1]) - total(a[1]));

console.log('=== CROSS-SUBSYSTEM IMPORT EDGES (value + type = total) ===');
for (const [k, c] of sorted) {
  console.log(`${String(c.value).padStart(4)} value ${String(c.type).padStart(4)} type  ${k}`);
}

console.log('\n=== 2-CYCLES (A→B and B→A) ===');
const seen = new Set();
let cycles = 0;
let runtimeCycles = 0;
for (const [k] of sorted) {
  const [a, b] = k.split('->');
  const back = `${b}->${a}`;
  const id = [a, b].sort().join('|');
  if (!edges.has(back) || seen.has(id)) continue;
  seen.add(id);
  cycles++;
  const fwd = edges.get(k);
  const rev = edges.get(back);
  const runtime = fwd.value > 0 && rev.value > 0;
  if (runtime) runtimeCycles++;
  const tag = runtime ? 'RUNTIME' : 'type-only';
  console.log(`\n${a} <-> ${b}   (${total(fwd)} / ${total(rev)})   value ${fwd.value}/${rev.value}   [${tag}]`);
  for (const ex of examples.get(k) ?? []) console.log('   ', ex);
  for (const ex of examples.get(back) ?? []) console.log('   ', ex);
}
console.log(`\nTOTAL 2-cycles: ${cycles}   of which RUNTIME (value both ways): ${runtimeCycles}`);

const subsystems = new Set(files.map(subsystemOf));
console.log(`\nSubsystems: ${subsystems.size} — ${[...subsystems].sort().join(', ')}`);
console.log(`Files scanned: ${files.length}`);
