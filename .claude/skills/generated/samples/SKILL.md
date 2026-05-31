---
name: samples
description: "Skill for the Samples area of tb303-synth. 17 symbols across 5 files."
---

# Samples

17 symbols | 5 files | Cohesion: 83%

## When to Use

- Working with code in `src/`
- Understanding how addSampleToKeymap, setEntryRoot, setEntryRange work
- Modifying samples-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/samples/sample-store.ts` | get, open, run, put, list (+2) |
| `src/samples/keymap-edit.ts` | clampNote, addSampleToKeymap, setEntryRoot, setEntryRange |
| `src/samples/sample-cache.ts` | get, ensureLoaded |
| `src/samples/sample-store-mem.ts` | get, MemSampleStore |
| `src/samples/types.ts` | get, SampleStore |

## Entry Points

Start here when exploring this area:

- **`addSampleToKeymap`** (Function) — `src/samples/keymap-edit.ts:7`
- **`setEntryRoot`** (Function) — `src/samples/keymap-edit.ts:20`
- **`setEntryRange`** (Function) — `src/samples/keymap-edit.ts:24`
- **`MemSampleStore`** (Class) — `src/samples/sample-store-mem.ts:6`
- **`IdbSampleStore`** (Class) — `src/samples/sample-store.ts:10`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `MemSampleStore` | Class | `src/samples/sample-store-mem.ts` | 6 |
| `IdbSampleStore` | Class | `src/samples/sample-store.ts` | 10 |
| `addSampleToKeymap` | Function | `src/samples/keymap-edit.ts` | 7 |
| `setEntryRoot` | Function | `src/samples/keymap-edit.ts` | 20 |
| `setEntryRange` | Function | `src/samples/keymap-edit.ts` | 24 |
| `SampleStore` | Interface | `src/samples/types.ts` | 31 |
| `get` | Method | `src/samples/sample-cache.ts` | 11 |
| `ensureLoaded` | Method | `src/samples/sample-cache.ts` | 17 |
| `get` | Method | `src/samples/sample-store-mem.ts` | 12 |
| `get` | Method | `src/samples/sample-store.ts` | 44 |
| `get` | Method | `src/samples/types.ts` | 33 |
| `open` | Method | `src/samples/sample-store.ts` | 13 |
| `run` | Method | `src/samples/sample-store.ts` | 27 |
| `put` | Method | `src/samples/sample-store.ts` | 41 |
| `list` | Method | `src/samples/sample-store.ts` | 47 |
| `delete` | Method | `src/samples/sample-store.ts` | 50 |
| `clampNote` | Function | `src/samples/keymap-edit.ts` | 4 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnCellDropAudio → Open` | cross_community | 4 |
| `EnsureLoaded → Open` | cross_community | 4 |
| `LoadFile → Open` | cross_community | 4 |

## How to Explore

1. `gitnexus_context({name: "addSampleToKeymap"})` — see callers and callees
2. `gitnexus_query({query: "samples"})` — find related execution flows
3. Read key files listed above for implementation details
