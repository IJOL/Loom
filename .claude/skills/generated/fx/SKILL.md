---
name: fx
description: "Skill for the Fx area of tb303-synth. 19 symbols across 5 files."
---

# Fx

19 symbols | 5 files | Cohesion: 85%

## When to Use

- Working with code in `src/`
- Understanding how applyInsertSlot, rehydrateInsertChain, setBaseValue work
- Modifying fx-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/plugins/fx/insert-chain.ts` | constructor, insert, remove, reorder, dispose (+3) |
| `src/plugins/fx/distortion.ts` | makeCurve, create, setBaseValue |
| `src/plugins/fx/insert-chain.test.ts` | FakeNode, connect, makeFx |
| `src/plugins/fx/reverb.ts` | makeImpulse, create, setBaseValue |
| `src/session/insert-slot.ts` | applyInsertSlot, rehydrateInsertChain |

## Entry Points

Start here when exploring this area:

- **`applyInsertSlot`** (Function) — `src/session/insert-slot.ts:14`
- **`rehydrateInsertChain`** (Function) — `src/session/insert-slot.ts:26`
- **`setBaseValue`** (Function) — `src/plugins/fx/distortion.ts:46`
- **`setBaseValue`** (Function) — `src/plugins/fx/reverb.ts:54`
- **`constructor`** (Method) — `src/plugins/fx/insert-chain.ts:11`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `applyInsertSlot` | Function | `src/session/insert-slot.ts` | 14 |
| `rehydrateInsertChain` | Function | `src/session/insert-slot.ts` | 26 |
| `setBaseValue` | Function | `src/plugins/fx/distortion.ts` | 46 |
| `setBaseValue` | Function | `src/plugins/fx/reverb.ts` | 54 |
| `constructor` | Method | `src/plugins/fx/insert-chain.ts` | 11 |
| `insert` | Method | `src/plugins/fx/insert-chain.ts` | 20 |
| `remove` | Method | `src/plugins/fx/insert-chain.ts` | 26 |
| `reorder` | Method | `src/plugins/fx/insert-chain.ts` | 40 |
| `dispose` | Method | `src/plugins/fx/insert-chain.ts` | 48 |
| `rewire` | Method | `src/plugins/fx/insert-chain.ts` | 54 |
| `size` | Method | `src/plugins/fx/insert-chain.ts` | 16 |
| `setBypass` | Method | `src/plugins/fx/insert-chain.ts` | 33 |
| `create` | Method | `src/plugins/fx/distortion.ts` | 27 |
| `create` | Method | `src/plugins/fx/reverb.ts` | 30 |
| `FakeNode` | Class | `src/plugins/fx/insert-chain.test.ts` | 5 |
| `makeCurve` | Function | `src/plugins/fx/distortion.ts` | 3 |
| `makeFx` | Function | `src/plugins/fx/insert-chain.test.ts` | 11 |
| `makeImpulse` | Function | `src/plugins/fx/reverb.ts` | 3 |
| `connect` | Method | `src/plugins/fx/insert-chain.test.ts` | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Plugins | 2 calls |

## How to Explore

1. `gitnexus_context({name: "applyInsertSlot"})` — see callers and callees
2. `gitnexus_query({query: "fx"})` — find related execution flows
3. Read key files listed above for implementation details
