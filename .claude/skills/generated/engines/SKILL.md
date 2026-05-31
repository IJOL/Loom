---
name: engines
description: "Skill for the Engines area of tb303-synth. 361 symbols across 55 files."
---

# Engines

361 symbols | 55 files | Cohesion: 81%

## When to Use

- Working with code in `src/`
- Understanding how createPeriodicWaves, mk, getCurrentLaneForVoice work
- Modifying engines-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/engines/fm.ts` | createVoice, getBaseValue, getBaseValue, FMEngine, create (+34) |
| `src/engines/wavetable.ts` | createVoice, mk, getBaseValue, getBaseValue, WavetableEngine (+33) |
| `src/engines/karplus.ts` | createVoice, getBaseValue, getBaseValue, KarplusEngine, create (+30) |
| `src/engines/subtractive.ts` | createVoice, readDotPath, getBaseValue, getBaseValue, SubtractiveEngine (+29) |
| `src/engines/tb303.ts` | TB303Voice, createVoice, getBaseValue, getBaseValue, buildParamUI (+25) |
| `src/engines/drums-engine.ts` | DrumsVoice, createVoice, getBaseValue, getBaseValue, DrumsEngine (+23) |
| `src/engines/sampler.ts` | SamplerVoice, getBaseValue, createVoice, SamplerEngine, dispose (+13) |
| `src/engines/engine-types.ts` | createVoice, getBaseValue, SynthEngine, buildParamUI, dispose (+11) |
| `src/modulation/voice-mod-binding.ts` | addInsertChainParams, applyBinder, rangeLookupForEngine, getOrCreateLane, bindEngineModulators (+7) |
| `src/core/drums.ts` | trigger, playKick, playSnare, playHat, playClap (+6) |

## Entry Points

Start here when exploring this area:

- **`createPeriodicWaves`** (Function) — `src/engines/wavetable-tables.ts:97`
- **`mk`** (Function) — `src/engines/wavetable.ts:390`
- **`getCurrentLaneForVoice`** (Function) — `src/modulation/active-mods.ts:19`
- **`setActiveModVoices`** (Function) — `src/modulation/active-mods.ts:25`
- **`recordVoiceMods`** (Function) — `src/modulation/active-mods.ts:42`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `TB303` | Class | `src/core/synth.ts` | 21 |
| `ConnectionBinder` | Class | `src/modulation/connection-binder.ts` | 16 |
| `DrumsEngine` | Class | `src/engines/drums-engine.ts` | 94 |
| `FMEngine` | Class | `src/engines/fm.ts` | 283 |
| `KarplusEngine` | Class | `src/engines/karplus.ts` | 310 |
| `SamplerEngine` | Class | `src/engines/sampler.ts` | 181 |
| `WavetableEngine` | Class | `src/engines/wavetable.ts` | 268 |
| `ModulationHostImpl` | Class | `src/modulation/modulation-host.ts` | 25 |
| `DrumMachine` | Class | `src/core/drums.ts` | 99 |
| `PendingBaseValues` | Class | `src/engines/pending-base-values.ts` | 6 |
| `TB303Engine` | Class | `src/engines/tb303.ts` | 112 |
| `createPeriodicWaves` | Function | `src/engines/wavetable-tables.ts` | 97 |
| `mk` | Function | `src/engines/wavetable.ts` | 390 |
| `getCurrentLaneForVoice` | Function | `src/modulation/active-mods.ts` | 19 |
| `setActiveModVoices` | Function | `src/modulation/active-mods.ts` | 25 |
| `recordVoiceMods` | Function | `src/modulation/active-mods.ts` | 42 |
| `bindEngineModulators` | Function | `src/modulation/voice-mod-binding.ts` | 173 |
| `bindVoiceModulators` | Function | `src/modulation/voice-mod-binding.ts` | 192 |
| `renderEngine` | Function | `test/render.ts` | 24 |
| `buildCtx` | Function | `src/app/knob-mounting.ts` | 54 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `WireEngineSelector → GetCachedPresets` | cross_community | 7 |
| `WireEngineSelector → FlatToPolyParams` | cross_community | 7 |
| `OnEditLane → RefreshEnableUI` | cross_community | 7 |
| `OnChange → SyncModulators` | cross_community | 6 |
| `OnChange → SyncModulators` | cross_community | 6 |
| `Create → List` | cross_community | 6 |
| `Create → List` | cross_community | 6 |
| `WireEngineSelector → LoadUserPolyPresets` | cross_community | 6 |
| `OnEditLane → MkAddButton` | intra_community | 6 |
| `OnEditLane → WithUndo` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Polysynth | 11 calls |
| Session | 5 calls |
| Modulation | 4 calls |
| App | 4 calls |
| Samples | 3 calls |
| Cluster_75 | 3 calls |
| Cluster_121 | 2 calls |
| Arp | 2 calls |

## How to Explore

1. `gitnexus_context({name: "createPeriodicWaves"})` — see callers and callees
2. `gitnexus_query({query: "engines"})` — find related execution flows
3. Read key files listed above for implementation details
