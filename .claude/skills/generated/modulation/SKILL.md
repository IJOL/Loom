---
name: modulation
description: "Skill for the Modulation area of tb303-synth. 65 symbols across 20 files."
---

# Modulation

65 symbols | 20 files | Cohesion: 79%

## When to Use

- Working with code in `src/`
- Understanding how mountDrumMasterLaneKnobs, wireDrumMasterUI, mk work
- Modifying modulation-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modulation/modulation-ui.ts` | renderModCard, refreshEnableUI, renderLfoConfig, refreshSyncUI, refreshTrigVisibility (+9) |
| `src/modulation/lfo-voice.ts` | LFOVoice, constructor, createOsc, trigger, syncFromState (+3) |
| `src/modulation/modulation-host.ts` | modulatorInstanceAsVoice, spawnVoice, spawnVoiceFiltered, deserialize, trigger (+2) |
| `src/modulation/adsr-voice.ts` | ADSRVoice, trigger, release, currentValue, dispose |
| `src/plugins/modulators/adsr.ts` | create, trigger, release, dispose |
| `src/plugins/modulators/lfo.ts` | create, trigger, release, dispose |
| `src/modulation/types.ts` | ModulatorVoice, defaultScopeFor, normalizeModulator |
| `src/modulation/connection-binder.test.ts` | makeMockGain, createGain, makeMockVoice |
| `src/modulation/voice-mod-binding.test.ts` | makeMockGain, createGain, makeMockModulatorVoice |
| `src/plugins/types.ts` | trigger, release, dispose |

## Entry Points

Start here when exploring this area:

- **`mountDrumMasterLaneKnobs`** (Function) — `src/app/knob-mounting.ts:90`
- **`wireDrumMasterUI`** (Function) — `src/core/drum-master-ui.ts:30`
- **`mk`** (Function) — `src/core/drum-master-ui.ts:37`
- **`attachKnobUndo`** (Function) — `src/save/history-wiring.ts:57`
- **`formatParamIdForDisplay`** (Function) — `src/core/lane-display.ts:54`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ADSRVoice` | Class | `src/modulation/adsr-voice.ts` | 7 |
| `LFOVoice` | Class | `src/modulation/lfo-voice.ts` | 8 |
| `mountDrumMasterLaneKnobs` | Function | `src/app/knob-mounting.ts` | 90 |
| `wireDrumMasterUI` | Function | `src/core/drum-master-ui.ts` | 30 |
| `mk` | Function | `src/core/drum-master-ui.ts` | 37 |
| `attachKnobUndo` | Function | `src/save/history-wiring.ts` | 57 |
| `formatParamIdForDisplay` | Function | `src/core/lane-display.ts` | 54 |
| `trigger` | Function | `src/plugins/modulators/adsr.ts` | 23 |
| `release` | Function | `src/plugins/modulators/adsr.ts` | 24 |
| `trigger` | Function | `src/plugins/modulators/lfo.ts` | 23 |
| `effectiveRateHz` | Function | `src/modulation/rate-sync.ts` | 16 |
| `computeWaveform` | Function | `src/modulation/waveform.ts` | 11 |
| `run` | Function | `src/modulation/modulation-ui.ts` | 64 |
| `syncModulators` | Function | `src/session/session-engine-state.ts` | 13 |
| `defaultScopeFor` | Function | `src/modulation/types.ts` | 87 |
| `normalizeModulator` | Function | `src/modulation/types.ts` | 93 |
| `computeAdsrAt` | Function | `src/modulation/adsr-curve.ts` | 7 |
| `dispose` | Function | `src/plugins/modulators/adsr.ts` | 25 |
| `release` | Function | `src/plugins/modulators/lfo.ts` | 24 |
| `dispose` | Function | `src/plugins/modulators/lfo.ts` | 25 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `MountDrumMasterLaneKnobs → Polar` | cross_community | 8 |
| `MountDrumMasterLaneKnobs → Clamp` | cross_community | 7 |
| `OnEditLane → RefreshEnableUI` | cross_community | 7 |
| `OnChange → SyncModulators` | cross_community | 6 |
| `OnChange → SyncModulators` | cross_community | 6 |
| `RenderLfoConfig → Polar` | cross_community | 6 |
| `RenderModCard → Polar` | cross_community | 6 |
| `RenderModCard → Clamp` | cross_community | 6 |
| `MountLaneFxPanel → AttachKnobUndo` | cross_community | 5 |
| `InjectEngineModulatorPanel → WithUndo` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Session | 5 calls |
| Arp | 4 calls |
| Engines | 4 calls |
| Cluster_121 | 1 calls |
| Plugins | 1 calls |
| Cluster_101 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "mountDrumMasterLaneKnobs"})` — see callers and callees
2. `gitnexus_query({query: "modulation"})` — find related execution flows
3. Read key files listed above for implementation details
