// Cross-check every `#some-id` the manual cites against the ids that actually
// exist — in index.html, or created from code in src/.
//
// The manual names DOM ids constantly ("#instrument-preset-select", "#stems-open"),
// which is what makes it precise and also what makes it rot: a rename in the app
// leaves the prose pointing at something that no longer exists, and nothing
// fails. This is the cheap sweep that catches those.
//
//   node tools/manual/check-ids.mjs
//
// Exits non-zero when something is unaccounted for, so it can gate a manual build.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANUAL = join(ROOT, 'docs', 'manual');

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// Ids the app creates at runtime never appear in index.html, so fall back to
// "is this string anywhere in the source" before calling it missing.
const sources = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|scss)$/.test(entry.name)) sources.push(p);
  }
})(join(ROOT, 'src'));
const srcText = sources.map((f) => readFileSync(f, 'utf8')).join('\n');

const ID_IN_BACKTICKS = /`#([a-z][a-z0-9-]{2,})`/g;

let bad = 0;
for (const file of readdirSync(MANUAL).filter((f) => f.endsWith('.md')).sort()) {
  const md = readFileSync(join(MANUAL, file), 'utf8');
  const missing = new Set();
  for (const [, id] of md.matchAll(ID_IN_BACKTICKS)) {
    if (htmlIds.has(id)) continue;
    if (srcText.includes(`'${id}'`) || srcText.includes(`"${id}"`) || srcText.includes(`#${id}`)) continue;
    missing.add(id);
  }
  if (missing.size) {
    bad += missing.size;
    console.log(`${file}: ${[...missing].join(', ')}`);
  }
}

console.log(bad === 0 ? 'every #id the manual cites exists' : `${bad} id(s) unaccounted for`);
process.exit(bad === 0 ? 0 : 1);
