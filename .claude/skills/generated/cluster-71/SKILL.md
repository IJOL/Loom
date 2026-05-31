---
name: cluster-71
description: "Skill for the Cluster_71 area of tb303-synth. 7 symbols across 3 files."
---

# Cluster_71

7 symbols | 3 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how CompBlock, constructor, constructor work
- Modifying cluster_71-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/comp-block.dsp.test.ts` | rms, renderSine, renderRaw, renderBypassed |
| `src/core/fx.ts` | constructor, constructor |
| `src/core/comp-block.ts` | CompBlock |

## Entry Points

Start here when exploring this area:

- **`CompBlock`** (Class) — `src/core/comp-block.ts:14`
- **`constructor`** (Method) — `src/core/fx.ts:120`
- **`constructor`** (Method) — `src/core/fx.ts:456`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `CompBlock` | Class | `src/core/comp-block.ts` | 14 |
| `constructor` | Method | `src/core/fx.ts` | 120 |
| `constructor` | Method | `src/core/fx.ts` | 456 |
| `rms` | Function | `src/core/comp-block.dsp.test.ts` | 5 |
| `renderSine` | Function | `src/core/comp-block.dsp.test.ts` | 11 |
| `renderRaw` | Function | `src/core/comp-block.dsp.test.ts` | 53 |
| `renderBypassed` | Function | `src/core/comp-block.dsp.test.ts` | 66 |

## How to Explore

1. `gitnexus_context({name: "CompBlock"})` — see callers and callees
2. `gitnexus_query({query: "cluster_71"})` — find related execution flows
3. Read key files listed above for implementation details
