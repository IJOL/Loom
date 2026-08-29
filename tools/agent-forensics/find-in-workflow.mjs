#!/usr/bin/env node
// Search a Workflow run's agent transcripts for a term, and report the page
// titles / URLs it appears in — the way to find "that interesting site" again
// when all you remember is a fragment of its name.
//
// Usage:
//   node tools/find-in-workflow.mjs <workflow-dir> <term> [--titles] [--context N]
//
//   --titles    only report search-result titles + their URLs (default: raw context)
//   --context   chars of context around each raw hit (default 400)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const [dir, term] = args.filter((a) => !a.startsWith('--'));
const titlesOnly = args.includes('--titles');
const ctxIdx = args.indexOf('--context');
const ctxN = ctxIdx >= 0 ? Number(args[ctxIdx + 1]) : 400;

if (!dir || !term) {
  console.error('usage: find-in-workflow.mjs <workflow-dir> <term> [--titles] [--context N]');
  process.exit(1);
}

const re = new RegExp(term, 'i');
const files = readdirSync(dir).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));

if (titlesOnly) {
  // Transcripts embed tool results as JSON-in-JSON, so titles appear both as
  // real fields and as escaped text. Match a window around the term and pull
  // any title/URL pair out of it, rather than trusting one exact shape.
  const hits = new Map(); // title -> Set<url>
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    let i = -1;
    while ((i = raw.toLowerCase().indexOf(term.toLowerCase(), i + 1)) !== -1) {
      const win = raw.slice(Math.max(0, i - 300), i + 300);
      // "title":"…"  /  \"title\":\"…\"  /  **Title**  /  | Title |
      const titleMatches = [
        ...win.matchAll(/\\?"title\\?":\\?"([^"\\]{3,150})/g),
        ...win.matchAll(/\*\*([^*\n]{3,150})\*\*/g),
      ];
      const urlMatch = win.match(/https?:\/\/[^\s"'`)\]<>,\\]+/);
      for (const t of titleMatches) {
        const title = t[1].trim();
        if (!re.test(title) && !re.test(urlMatch?.[0] ?? '')) continue;
        if (!hits.has(title)) hits.set(title, new Set());
        if (urlMatch) hits.get(title).add(urlMatch[0].replace(/[.,;:]+$/, ''));
      }
    }
  }
  if (!hits.size) { console.log(`(no titles matching /${term}/i)`); process.exit(0); }
  console.log(`${hits.size} titles matching /${term}/i\n`);
  for (const [title, urls] of hits) {
    console.log(`• ${title}`);
    for (const u of urls) console.log(`    ${u}`);
  }
  process.exit(0);
}

let n = 0;
for (const f of files) {
  const raw = readFileSync(join(dir, f), 'utf8');
  let i = -1;
  while ((i = raw.toLowerCase().indexOf(term.toLowerCase(), i + 1)) !== -1) {
    n++;
    console.log(`\n===== ${f.slice(6, 14)} @${i}`);
    console.log(raw.slice(Math.max(0, i - ctxN), i + ctxN).replace(/\\n/g, ' '));
  }
}
console.log(`\n${n} raw hits for /${term}/i across ${files.length} transcripts`);
