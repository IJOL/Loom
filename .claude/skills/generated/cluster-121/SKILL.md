---
name: cluster-121
description: "Skill for the Cluster_121 area of tb303-synth. 8 symbols across 1 files."
---

# Cluster_121

8 symbols | 1 files | Cohesion: 84%

## When to Use

- Working with code in `src/`
- Understanding how quantiseSelectValue, normaliseSelectIndex, createSelectControl work
- Modifying cluster_121-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/select-control.ts` | quantiseSelectValue, normaliseSelectIndex, makeWaveformGlyph, createRadioStrip, refresh (+3) |

## Entry Points

Start here when exploring this area:

- **`quantiseSelectValue`** (Function) — `src/core/select-control.ts:21`
- **`normaliseSelectIndex`** (Function) — `src/core/select-control.ts:25`
- **`createSelectControl`** (Function) — `src/core/select-control.ts:171`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `quantiseSelectValue` | Function | `src/core/select-control.ts` | 21 |
| `normaliseSelectIndex` | Function | `src/core/select-control.ts` | 25 |
| `createSelectControl` | Function | `src/core/select-control.ts` | 171 |
| `makeWaveformGlyph` | Function | `src/core/select-control.ts` | 42 |
| `createRadioStrip` | Function | `src/core/select-control.ts` | 59 |
| `refresh` | Function | `src/core/select-control.ts` | 64 |
| `setValue` | Function | `src/core/select-control.ts` | 102 |
| `createNativeSelect` | Function | `src/core/select-control.ts` | 125 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnChange → MakeWaveformGlyph` | cross_community | 5 |
| `OnChange → Refresh` | cross_community | 5 |
| `OnChange → NormaliseSelectIndex` | cross_community | 5 |
| `RenderModCard → MakeWaveformGlyph` | cross_community | 5 |
| `RenderModCard → Refresh` | cross_community | 5 |
| `RenderModCard → NormaliseSelectIndex` | cross_community | 5 |

## How to Explore

1. `gitnexus_context({name: "quantiseSelectValue"})` — see callers and callees
2. `gitnexus_query({query: "cluster_121"})` — find related execution flows
3. Read key files listed above for implementation details
