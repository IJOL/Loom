---
name: app
description: "Skill for the App area of tb303-synth. 118 symbols across 24 files."
---

# App

118 symbols | 24 files | Cohesion: 90%

## When to Use

- Working with code in `src/`
- Understanding how slugFromExtraId, ensureExtraPoly, ensureLaneStrip work
- Modifying app-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/app/lane-allocator.ts` | getBpm, slugFromExtraId, ensureExtraPoly, ensureLaneStrip, stripFor (+20) |
| `src/app/lane-host-wiring.ts` | getLaneEngineId, setActiveEngineLane, getSeq, seq, getBank (+10) |
| `src/main.ts` | getSynthInstance, getInstance, getDrumsInstance, run, onEngineChangeUndoable (+6) |
| `src/app/knob-mounting.ts` | getHistoryDeps, pageForLane, historyDeps, mountLaneFxPanel, registerKnob (+5) |
| `src/plugins/types.ts` | getBaseValue, setBaseValue, trigger, release, connect (+5) |
| `src/app/performance-feature.ts` | refreshPerformanceView, onStop, onGoToSession, setMode, setArrangement (+3) |
| `src/core/lane-resources.ts` | get, set, dispose, dispose, replaceEngine (+1) |
| `src/app/automation-recording.ts` | getAutoAbsSubIdx, onLaneAdded, recordValue, registerKnob, registerKnob |
| `src/app/bpm-broadcast.ts` | getPolysynth, getExtraPolys, propagateToLaneEngines, broadcast, broadcast |
| `src/core/fx.ts` | ChannelStrip, FxBus, setMuted |

## Entry Points

Start here when exploring this area:

- **`slugFromExtraId`** (Function) — `src/app/lane-allocator.ts:153`
- **`ensureExtraPoly`** (Function) — `src/app/lane-allocator.ts:158`
- **`ensureLaneStrip`** (Function) — `src/app/lane-allocator.ts:178`
- **`stripFor`** (Function) — `src/app/lane-allocator.ts:200`
- **`ensureLaneVoice`** (Function) — `src/app/lane-allocator.ts:230`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ChannelStrip` | Class | `src/core/fx.ts` | 100 |
| `FxBus` | Class | `src/core/fx.ts` | 21 |
| `SidechainBus` | Class | `src/core/sidechain-bus.ts` | 14 |
| `InsertChain` | Class | `src/plugins/fx/insert-chain.ts` | 8 |
| `LaneResourceMap` | Class | `src/core/lane-resources.ts` | 14 |
| `slugFromExtraId` | Function | `src/app/lane-allocator.ts` | 153 |
| `ensureExtraPoly` | Function | `src/app/lane-allocator.ts` | 158 |
| `ensureLaneStrip` | Function | `src/app/lane-allocator.ts` | 178 |
| `stripFor` | Function | `src/app/lane-allocator.ts` | 200 |
| `ensureLaneVoice` | Function | `src/app/lane-allocator.ts` | 230 |
| `ensureLaneResource` | Function | `src/app/lane-allocator.ts` | 248 |
| `getLaneEngineInstance` | Function | `src/app/lane-allocator.ts` | 275 |
| `setCurrentLaneForVoice` | Function | `src/modulation/active-mods.ts` | 15 |
| `swapLaneEngineFlow` | Function | `src/app/engine-swap.ts` | 28 |
| `reconcileLaneEnvelopes` | Function | `src/session/session.ts` | 198 |
| `wireEngineIntoLane` | Function | `src/app/lane-allocator.ts` | 130 |
| `swapLaneEngine` | Function | `src/app/lane-allocator.ts` | 265 |
| `refreshPerformanceView` | Function | `src/app/performance-feature.ts` | 91 |
| `onStop` | Function | `src/app/performance-feature.ts` | 101 |
| `onGoToSession` | Function | `src/app/performance-feature.ts` | 102 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `MountLaneFxPanel → Polar` | cross_community | 8 |
| `MountLaneFxPanel → Clamp` | cross_community | 8 |
| `OnGoToSession → MakeLabel` | cross_community | 6 |
| `OnGoToSession → StepsPerSec` | cross_community | 6 |
| `EnsureLaneVoice → Dispose` | intra_community | 5 |
| `MountLaneFxPanel → AttachKnobUndo` | cross_community | 5 |
| `MountLaneFxPanel → Current` | cross_community | 5 |
| `EnsureLaneVoice → GetBpm` | intra_community | 4 |
| `EnsureLaneVoice → SlugFromExtraId` | intra_community | 4 |
| `EnsureLaneVoice → ChannelStrip` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Plugins | 3 calls |
| Session | 2 calls |
| Polysynth | 2 calls |
| Performance | 1 calls |
| Cluster_104 | 1 calls |
| Automation | 1 calls |
| Cluster_90 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "slugFromExtraId"})` — see callers and callees
2. `gitnexus_query({query: "app"})` — find related execution flows
3. Read key files listed above for implementation details
