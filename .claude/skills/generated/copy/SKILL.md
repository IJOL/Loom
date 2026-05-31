---
name: copy
description: "Skill for the Copy area of tb303-synth. 21 symbols across 6 files."
---

# Copy

21 symbols | 6 files | Cohesion: 95%

## When to Use

- Working with code in `src/`
- Understanding how wireSlotCopyPanel, $, clonePattern work
- Modifying copy-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/transport.ts` | $$, refreshLoopBtn, switchSlot, updateSlotButtons, refreshLoopBtnEl (+2) |
| `src/copy/lane-copy.ts` | listCopyEndpoints, writeNotesToEndpoint, refreshCopyTrackSelects, wireCopyNotesPanel, readEndpointAsNotes |
| `src/core/notes.ts` | notesToBassSteps, notesToPolySteps, stepsToNotes, bassStepsToNotes |
| `src/copy/slot-copy.ts` | wireSlotCopyPanel, $ |
| `src/main.ts` | setBassMode, updateBassModeButtons |
| `src/core/pattern.ts` | clonePattern |

## Entry Points

Start here when exploring this area:

- **`wireSlotCopyPanel`** (Function) — `src/copy/slot-copy.ts:16`
- **`$`** (Function) — `src/copy/slot-copy.ts:17`
- **`clonePattern`** (Function) — `src/core/pattern.ts:55`
- **`refreshLoopBtn`** (Function) — `src/core/transport.ts:27`
- **`switchSlot`** (Function) — `src/core/transport.ts:31`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `wireSlotCopyPanel` | Function | `src/copy/slot-copy.ts` | 16 |
| `$` | Function | `src/copy/slot-copy.ts` | 17 |
| `clonePattern` | Function | `src/core/pattern.ts` | 55 |
| `refreshLoopBtn` | Function | `src/core/transport.ts` | 27 |
| `switchSlot` | Function | `src/core/transport.ts` | 31 |
| `updateSlotButtons` | Function | `src/core/transport.ts` | 51 |
| `wireTransport` | Function | `src/core/transport.ts` | 71 |
| `listCopyEndpoints` | Function | `src/copy/lane-copy.ts` | 11 |
| `writeNotesToEndpoint` | Function | `src/copy/lane-copy.ts` | 36 |
| `refreshCopyTrackSelects` | Function | `src/copy/lane-copy.ts` | 51 |
| `wireCopyNotesPanel` | Function | `src/copy/lane-copy.ts` | 68 |
| `notesToBassSteps` | Function | `src/core/notes.ts` | 62 |
| `notesToPolySteps` | Function | `src/core/notes.ts` | 80 |
| `readEndpointAsNotes` | Function | `src/copy/lane-copy.ts` | 20 |
| `stepsToNotes` | Function | `src/core/notes.ts` | 26 |
| `bassStepsToNotes` | Function | `src/core/notes.ts` | 43 |
| `$$` | Function | `src/core/transport.ts` | 4 |
| `refreshLoopBtnEl` | Function | `src/core/transport.ts` | 59 |
| `refreshChainBtn` | Function | `src/core/transport.ts` | 66 |
| `setBassMode` | Function | `src/main.ts` | 210 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `WireTransport → $$` | intra_community | 4 |

## How to Explore

1. `gitnexus_context({name: "wireSlotCopyPanel"})` — see callers and callees
2. `gitnexus_query({query: "copy"})` — find related execution flows
3. Read key files listed above for implementation details
