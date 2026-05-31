---
name: arp
description: "Skill for the Arp area of tb303-synth. 22 symbols across 5 files."
---

# Arp

22 symbols | 5 files | Cohesion: 79%

## When to Use

- Working with code in `src/`
- Understanding how buildArpUI, mkSel, addScopeBox work
- Modifying arp-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/knob.ts` | createKnob, setValue, setModulationOffset, render, updateModArc (+3) |
| `src/core/fx.ts` | syncDivToHz, setLfo, updateBpm, rebuildLfo, updateBpm |
| `src/arp/arp.ts` | arpIntervalSec, buildPool, generateArpSequence, scheduleArpForNote |
| `src/arp/arp-ui.ts` | buildArpUI, mkSel, addScopeBox |
| `src/app/trigger-dispatch.ts` | createTriggerForLane, fire |

## Entry Points

Start here when exploring this area:

- **`buildArpUI`** (Function) — `src/arp/arp-ui.ts:18`
- **`mkSel`** (Function) — `src/arp/arp-ui.ts:44`
- **`addScopeBox`** (Function) — `src/arp/arp-ui.ts:80`
- **`createKnob`** (Function) — `src/core/knob.ts:45`
- **`setValue`** (Function) — `src/core/knob.ts:111`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `buildArpUI` | Function | `src/arp/arp-ui.ts` | 18 |
| `mkSel` | Function | `src/arp/arp-ui.ts` | 44 |
| `addScopeBox` | Function | `src/arp/arp-ui.ts` | 80 |
| `createKnob` | Function | `src/core/knob.ts` | 45 |
| `setValue` | Function | `src/core/knob.ts` | 111 |
| `setModulationOffset` | Function | `src/core/knob.ts` | 113 |
| `render` | Function | `src/core/knob.ts` | 119 |
| `updateModArc` | Function | `src/core/knob.ts` | 129 |
| `arpIntervalSec` | Function | `src/arp/arp.ts` | 101 |
| `syncDivToHz` | Function | `src/core/fx.ts` | 323 |
| `createTriggerForLane` | Function | `src/app/trigger-dispatch.ts` | 21 |
| `fire` | Function | `src/app/trigger-dispatch.ts` | 27 |
| `generateArpSequence` | Function | `src/arp/arp.ts` | 57 |
| `scheduleArpForNote` | Function | `src/arp/arp.ts` | 111 |
| `setLfo` | Method | `src/core/fx.ts` | 367 |
| `updateBpm` | Method | `src/core/fx.ts` | 373 |
| `rebuildLfo` | Method | `src/core/fx.ts` | 379 |
| `updateBpm` | Method | `src/core/fx.ts` | 427 |
| `arcPath` | Function | `src/core/knob.ts` | 214 |
| `polar` | Function | `src/core/knob.ts` | 226 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `MountLaneFxPanel → Polar` | cross_community | 8 |
| `MountLaneFxPanel → Clamp` | cross_community | 8 |
| `MountDrumMasterLaneKnobs → Polar` | cross_community | 8 |
| `OnStopAll → Polar` | cross_community | 7 |
| `OnStopAll → Clamp` | cross_community | 7 |
| `MountDrumMasterLaneKnobs → Clamp` | cross_community | 7 |
| `WireFxUI → Polar` | cross_community | 7 |
| `Loop → Polar` | cross_community | 7 |
| `BuildMixerColumn → Polar` | cross_community | 7 |
| `OnClipClick → Polar` | cross_community | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| App | 1 calls |
| Modulation | 1 calls |

## How to Explore

1. `gitnexus_context({name: "buildArpUI"})` — see callers and callees
2. `gitnexus_query({query: "arp"})` — find related execution flows
3. Read key files listed above for implementation details
