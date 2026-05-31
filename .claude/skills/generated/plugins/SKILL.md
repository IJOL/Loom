---
name: plugins
description: "Skill for the Plugins area of tb303-synth. 27 symbols across 7 files."
---

# Plugins

27 symbols | 7 files | Cohesion: 88%

## When to Use

- Working with code in `src/`
- Understanding how snapshotInsertSlot, createLaneEngine, bootstrapPlugins work
- Modifying plugins-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/fx.ts` | setReverbWet, setReverbPredelay, setReverbSize, setReverbDecay, setDelayTime (+11) |
| `src/plugins/registry.ts` | key, registerPlugin, getPlugin, createInstance |
| `src/plugins/types.ts` | setBaseValue, getBaseValue |
| `src/app/lane-allocator.ts` | pluginSynthAsEngine, createLaneEngine |
| `src/session/insert-slot.ts` | snapshotInsertSlot |
| `src/app/plugin-bootstrap.ts` | bootstrapPlugins |
| `src/engines/registry.ts` | createEngineInstance |

## Entry Points

Start here when exploring this area:

- **`snapshotInsertSlot`** (Function) — `src/session/insert-slot.ts:18`
- **`createLaneEngine`** (Function) — `src/app/lane-allocator.ts:116`
- **`bootstrapPlugins`** (Function) — `src/app/plugin-bootstrap.ts:59`
- **`createEngineInstance`** (Function) — `src/engines/registry.ts:39`
- **`registerPlugin`** (Function) — `src/plugins/registry.ts:7`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `snapshotInsertSlot` | Function | `src/session/insert-slot.ts` | 18 |
| `createLaneEngine` | Function | `src/app/lane-allocator.ts` | 116 |
| `bootstrapPlugins` | Function | `src/app/plugin-bootstrap.ts` | 59 |
| `createEngineInstance` | Function | `src/engines/registry.ts` | 39 |
| `registerPlugin` | Function | `src/plugins/registry.ts` | 7 |
| `getPlugin` | Function | `src/plugins/registry.ts` | 13 |
| `createInstance` | Function | `src/plugins/registry.ts` | 22 |
| `setReverbWet` | Method | `src/core/fx.ts` | 43 |
| `setReverbPredelay` | Method | `src/core/fx.ts` | 44 |
| `setReverbSize` | Method | `src/core/fx.ts` | 45 |
| `setReverbDecay` | Method | `src/core/fx.ts` | 49 |
| `setDelayTime` | Method | `src/core/fx.ts` | 56 |
| `setDelayFeedback` | Method | `src/core/fx.ts` | 57 |
| `setDelayWet` | Method | `src/core/fx.ts` | 58 |
| `setDelayDamping` | Method | `src/core/fx.ts` | 59 |
| `setBpmSync` | Method | `src/core/fx.ts` | 64 |
| `setBaseValue` | Method | `src/plugins/types.ts` | 46 |
| `getReverbWet` | Method | `src/core/fx.ts` | 50 |
| `getReverbSize` | Method | `src/core/fx.ts` | 51 |
| `getReverbDecay` | Method | `src/core/fx.ts` | 52 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `SwapLaneEngine → Key` | cross_community | 4 |
| `SwapLaneEngine → ModulationHostImpl` | cross_community | 4 |
| `SwapLaneEngine → CreateEngineInstance` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Engines | 1 calls |

## How to Explore

1. `gitnexus_context({name: "snapshotInsertSlot"})` — see callers and callees
2. `gitnexus_query({query: "plugins"})` — find related execution flows
3. Read key files listed above for implementation details
