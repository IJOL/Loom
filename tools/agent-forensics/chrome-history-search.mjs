#!/usr/bin/env node
// Search a Chrome history DB by term and/or date — for recovering "that site I
// saw in one of the tabs" after an agent run opened hundreds of them.
//
// Chrome keeps History locked while running, so this copies the DB to a temp
// path before reading (read-only, never touches the original).
//
// Usage:
//   node tools/chrome-history-search.mjs [--db <path>] [--term <s>] [--day YYYY-MM-DD] [--limit N]
//
// Chrome stores time as microseconds since 1601-01-01 UTC.

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

const dbPath = arg('--db', join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/User Data/Default/History'));
const term = arg('--term', null);
const day = arg('--day', null);
const limit = Number(arg('--limit', 200));

const CHROME_EPOCH_OFFSET_MS = 11644473600000;
const toUnixMs = (chromeUs) => Number(chromeUs) / 1000 - CHROME_EPOCH_OFFSET_MS;
const toChromeUs = (unixMs) => (unixMs + CHROME_EPOCH_OFFSET_MS) * 1000;

// Copy: the live DB is locked by Chrome (and WAL-mode reads can be dirty).
const copyPath = join(tmpdir(), `chrome-history-copy-${process.pid}.sqlite`);
writeFileSync(copyPath, readFileSync(dbPath));

const db = new DatabaseSync(copyPath, { readOnly: true });

const where = [];
const params = {};
if (term) {
  where.push('(lower(u.url) LIKE :term OR lower(u.title) LIKE :term)');
  params.term = `%${term.toLowerCase()}%`;
}
if (day) {
  const start = Date.parse(`${day}T00:00:00`);
  const end = start + 24 * 3600 * 1000;
  where.push('v.visit_time >= :start AND v.visit_time < :end');
  params.start = toChromeUs(start);
  params.end = toChromeUs(end);
}
const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

const rows = db.prepare(`
  SELECT u.url AS url, u.title AS title, v.visit_time AS visit_time
  FROM visits v JOIN urls u ON u.id = v.url
  ${clause}
  ORDER BY v.visit_time DESC
  LIMIT ${limit}
`).all(params);

console.log(`db: ${dbPath}`);
console.log(`filters: term=${term ?? '(any)'} day=${day ?? '(any)'} → ${rows.length} visits\n`);

const seen = new Set();
for (const r of rows) {
  if (seen.has(r.url)) continue;
  seen.add(r.url);
  const when = new Date(toUnixMs(r.visit_time)).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`${when}  ${r.title || '(no title)'}`);
  console.log(`${' '.repeat(19)}  ${r.url}`);
}
console.log(`\n${seen.size} distinct URLs`);
db.close();
