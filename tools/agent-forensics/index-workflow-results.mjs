#!/usr/bin/env node
// Index a Workflow run's recovered results by JOINING the journal with the agent
// transcripts.
//
// WHY: the journal records only `{type, key, agentId, result}` — it never stores
// what an agent WAS. Recovered on its own it is 900 KB of anonymous JSON: 65
// results with no way to tell a repo audit from a scout from a fact-checker, let
// alone which of 13 research angles one belongs to. That identity survives in
// exactly one place: each agent's transcript, whose FIRST user message is the
// prompt it was given ("RESEARCH ANGLE: …", "CLAIM: …", "You are an adversarial
// fact-checker…"). This reads that first line per transcript and joins it to the
// journal on agentId, so `recover-workflow-journal.mjs`'s dump becomes navigable:
// what each result is, which angle, which verdict.
//
// It also answers what the journal structurally cannot (--all): which agents
// STARTED and never returned — i.e. exactly what a dead run lost, and where.
//
// Only the first line of each transcript is parsed; the rest is megabytes of
// fetched pages and is never read.
//
// Usage:
//   node tools/index-workflow-results.mjs <workflow-dir> [--role scout|verify|audit]
//                                          [--angle <re>] [--full] [--out <file>]
//
//   (default)  one line per result: role, angle, verdict, agentId
//   --full     print the whole result value for the selected agents
//   --compact  load-bearing fields only, dropping the long `reasoning` prose:
//              claim + verdict + correction + sources for a verify agent, and
//              summary + each finding for a scout. ~4x smaller than --full.
//   --role     only agents of this role
//   --angle    only agents whose angle matches this regex
//   --all      also list agents that STARTED but never returned a result — the
//              work a dead run lost, which the journal cannot show on its own

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const dir = positional[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const roleFilter = flag('role');
const angleRe = flag('angle') ? new RegExp(flag('angle'), 'i') : null;
const full = args.includes('--full');
const compact = args.includes('--compact');
const all = args.includes('--all');
const outPath = flag('out');

if (!dir) {
  console.error('usage: index-workflow-results.mjs <workflow-dir> [--role R] [--angle RE] [--full] [--out F]');
  process.exit(1);
}

// ---- journal: agentId -> result value
const journal = readFileSync(join(dir, 'journal.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim())
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const resultById = new Map();
for (const e of journal) if (e.type === 'result' && e.agentId) resultById.set(e.agentId, e.result);

// ---- transcripts: agentId -> prompt facts. Only the first user message is read;
// the rest of a transcript is megabytes of fetched pages and is not needed here.
function promptOf(file) {
  const raw = readFileSync(join(dir, file), 'utf8');
  const firstNl = raw.indexOf('\n');
  const head = raw.slice(0, firstNl > 0 ? firstNl : raw.length);
  try {
    const e = JSON.parse(head);
    const c = e.message?.content;
    return { agentId: e.agentId, text: typeof c === 'string' ? c : JSON.stringify(c) };
  } catch { return null; }
}

const rows = [];
for (const f of readdirSync(dir).filter((f) => /^agent-.*\.jsonl$/.test(f))) {
  const p = promptOf(f);
  if (!p) continue;
  if (!resultById.has(p.agentId) && !all) continue;
  const t = p.text;
  const grab = (re) => t.match(re)?.[1]?.trim() ?? '';
  const angle = grab(/RESEARCH ANGLE:\s*(.+)/);
  const claim = grab(/\nCLAIM:\s*([\s\S]*?)\n(?:SUPPORTING|SOURCES|STATED)/);
  const claimType = grab(/CLAIM TYPE:\s*(.+)/);
  const role = /adversarial fact-checker/i.test(t) ? 'verify'
    : /RESEARCH ANGLE:/.test(t) ? 'scout'
    : 'audit';
  const value = resultById.get(p.agentId);
  const verdict = value === undefined ? '(NO RESULT)'
    : value?.verdict ?? value?.angles?.[0]?.verified?.[0]?.verdict?.verdict ?? '';
  rows.push({ agentId: p.agentId, role, angle, claimType, claim, verdict, value,
    firstLine: (t.split('\n').find((l) => /^You are /.test(l)) ?? '').slice(0, 80) });
}

const sel = rows.filter((r) => (!roleFilter || r.role === roleFilter) && (!angleRe || angleRe.test(r.angle)));
sel.sort((a, b) => (a.role.localeCompare(b.role)) || a.angle.localeCompare(b.angle));

const out = [];
out.push(`${rows.length} results indexed in ${dir}`);
const byRole = {};
for (const r of rows) byRole[r.role] = (byRole[r.role] ?? 0) + 1;
out.push(`roles: ${JSON.stringify(byRole)}`);
out.push(`showing ${sel.length}\n`);

for (const r of sel) {
  if (full || compact) {
    out.push(`\n${'='.repeat(78)}\n## [${r.role}] ${r.angle || r.firstLine}  (${r.agentId})`);
    if (r.claim) out.push(`CLAIM (${r.claimType}): ${r.claim}`);
  }
  if (full) {
    out.push(JSON.stringify(r.value, null, 2));
  } else if (compact) {
    const v = r.value ?? {};
    if (v.verdict) {
      out.push(`VERDICT: ${v.verdict}`);
      if (v.correction) out.push(`CORRECTION: ${v.correction}`);
      if (v.sources) out.push(`SOURCES: ${JSON.stringify(v.sources)}`);
    } else {
      // scout: keep the summary + every finding, minus any long prose field.
      if (v.summary) out.push(`SUMMARY: ${v.summary}`);
      for (const f of v.findings ?? []) {
        const { reasoning, ...rest } = f;
        out.push(`\n--- FINDING\n${JSON.stringify(rest, null, 2)}`);
      }
    }
  } else {
    const keys = r.value && typeof r.value === 'object' ? Object.keys(r.value).join(',') : typeof r.value;
    out.push(`[${r.role.padEnd(6)}] ${(r.angle || '(repo audit)').padEnd(24)} ${(r.verdict || '').padEnd(16)} ${r.agentId}  {${keys}}`);
    if (r.claim) out.push(`         claim: ${r.claim.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}

const doc = out.join('\n');
if (outPath) { writeFileSync(outPath, doc, 'utf8'); console.log(`wrote ${doc.length} bytes → ${outPath}`); }
else console.log(doc);