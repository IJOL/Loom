#!/usr/bin/env node
// Inventory every URL a Workflow run touched, recovered from its agent transcripts.
//
// A research workflow opens hundreds of pages; the interesting one is often a
// site discovered *inside* a result rather than the one searched for. This
// walks agent-*.jsonl, pulls every URL out of prompts, tool calls and model
// text, and groups them by domain so a human can spot the one that mattered.
//
// Usage:
//   node tools/extract-workflow-urls.mjs <workflow-dir> [--domains] [--grep <re>] [--out <file>]
//
//   --domains  domain histogram only (default: full URL list per domain)
//   --grep     only URLs matching this regex (case-insensitive)
//   --out      write to a file instead of stdout

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const domainsOnly = args.includes('--domains');
const grepIdx = args.indexOf('--grep');
const grepRe = grepIdx >= 0 ? new RegExp(args[grepIdx + 1], 'i') : null;
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

if (!dir) {
  console.error('usage: extract-workflow-urls.mjs <workflow-dir> [--domains] [--grep <re>] [--out <file>]');
  process.exit(1);
}

// Agent label: the workflow journal only knows agentIds, but each transcript's
// first user message is the agent's prompt — its first imperative line names the
// angle well enough to identify it.
function labelFor(events) {
  const first = events.find((e) => e.type === 'user' && e.message?.content);
  if (!first) return '(unknown)';
  const c = first.message.content;
  const text = typeof c === 'string' ? c : JSON.stringify(c);
  const line = text.split('\n').find((l) => /^You are /.test(l));
  return (line ?? '(no angle line)').slice(0, 90);
}

const URL_RE = /https?:\/\/[^\s"'`)\]<>,\\]+/g;

const files = readdirSync(dir).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
const byDomain = new Map(); // domain -> Map<url, Set<label>>

for (const file of files) {
  let events;
  try {
    events = readFileSync(join(dir, file), 'utf8')
      .split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { continue; }

  const label = labelFor(events);

  for (const e of events) {
    const blob = JSON.stringify(e.message ?? e.toolUseResult ?? e);
    const found = blob.match(URL_RE);
    if (!found) continue;
    for (let url of found) {
      url = url.replace(/[.,;:]+$/, '').replace(/\\u[0-9a-f]{4}/gi, '');
      if (grepRe && !grepRe.test(url)) continue;
      let host;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
      if (!byDomain.has(host)) byDomain.set(host, new Map());
      const urls = byDomain.get(host);
      if (!urls.has(url)) urls.set(url, new Set());
      urls.get(url).add(label);
    }
  }
}

const ranked = [...byDomain.entries()].sort((a, b) => b[1].size - a[1].size);
const out = [];
out.push(`# URLs touched by ${files.length} agents in ${dir}\n`);
out.push(`${ranked.length} distinct domains, ${ranked.reduce((n, [, m]) => n + m.size, 0)} distinct URLs\n`);

out.push('\n## Domain histogram (distinct URLs per domain)\n');
for (const [host, urls] of ranked) out.push(`${String(urls.size).padStart(4)}  ${host}`);

if (!domainsOnly) {
  out.push('\n\n## URLs by domain\n');
  for (const [host, urls] of ranked) {
    out.push(`\n### ${host} (${urls.size})`);
    for (const [url, labels] of urls) out.push(`- ${url}\n  ↳ ${[...labels].join(' | ')}`);
  }
}

const doc = out.join('\n');
if (outPath) {
  writeFileSync(outPath, doc, 'utf8');
  console.log(`wrote ${doc.length} bytes → ${outPath}`);
} else {
  console.log(doc);
}
