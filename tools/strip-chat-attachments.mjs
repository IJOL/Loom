#!/usr/bin/env node
// Strip pasted-file attachments out of a Claude Code transcript.
//
// A single user message carrying a couple of big JSON files can be larger than
// the whole rest of the conversation, and the session then refuses to resume or
// even to compact: "prompt too long". The conversation itself is fine -- only
// the payload is oversized.
//
// This replaces each `document` part of a user message with a one-line text
// stub naming the file it stood for. uuid / parentUuid / timestamp are left
// untouched, so the parent chain still walks and nothing after the message is
// lost. Every other line is copied through byte for byte.
//
//   node tools/strip-chat-attachments.mjs <transcript.jsonl>            # report
//   node tools/strip-chat-attachments.mjs <transcript.jsonl> --apply
//   ... [--min-bytes 200000] [--line 1506]
//
// Without --apply nothing is written. The rewrite goes to a sibling .tmp file
// and is renamed over the original only once it is complete, so an interrupted
// run cannot leave a half-transcript behind.

import { createReadStream, createWriteStream, renameSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const apply = args.includes('--apply')
const minBytes = Number(valueOf('--min-bytes') ?? 200_000)
const onlyLine = valueOf('--line') ? Number(valueOf('--line')) : null

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

if (!file) {
  console.error('usage: strip-chat-attachments.mjs <transcript.jsonl> [--apply] [--min-bytes N] [--line N]')
  process.exit(2)
}

const out = apply ? createWriteStream(`${file}.tmp`) : null
const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })

let lineNo = 0
let stripped = 0
let saved = 0

for await (const line of rl) {
  lineNo++
  const keep = () => out?.write(`${line}\n`)

  // Cheap gate first: only a big line can be worth parsing, and only a user
  // message can carry a document part.
  if (line.length < minBytes || (onlyLine !== null && lineNo !== onlyLine)) { keep(); continue }
  if (!line.includes('"type":"document"')) { keep(); continue }

  let obj
  try { obj = JSON.parse(line) } catch { keep(); continue }
  const content = obj?.message?.content
  if (!Array.isArray(content)) { keep(); continue }

  const before = line.length
  obj.message.content = content.map((part) => {
    if (part?.type !== 'document') return part
    const title = part.title ?? 'attachment'
    const bytes = part.source?.data?.length ?? 0
    return { type: 'text', text: `[attachment removed: ${title} — ${bytes} bytes]` }
  })
  const rewritten = JSON.stringify(obj)
  if (rewritten.length === before) { keep(); continue }

  stripped++
  saved += before - rewritten.length
  console.log(`line ${lineNo}: ${fmt(before)} -> ${fmt(rewritten.length)}`)
  for (const part of content) {
    if (part?.type === 'document') console.log(`    - ${part.title ?? 'attachment'} (${fmt(part.source?.data?.length ?? 0)})`)
  }
  out?.write(`${rewritten}\n`)
}

await new Promise((res) => (out ? out.end(res) : res()))

function fmt(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`
}

if (!stripped) {
  console.log(`nothing to strip (${lineNo} lines, threshold ${fmt(minBytes)}).`)
} else if (apply) {
  renameSync(`${file}.tmp`, file)
  console.log(`\n${stripped} message(s) stripped, ${fmt(saved)} removed. New size: ${fmt(statSync(file).size)}`)
} else {
  console.log(`\nDRY RUN — nothing written. ${stripped} message(s) would lose ${fmt(saved)}. Re-run with --apply.`)
}
