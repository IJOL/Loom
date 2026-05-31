---
name: polysynth
description: "Skill for the Polysynth area of tb303-synth. 45 symbols across 7 files."
---

# Polysynth

45 symbols | 7 files | Cohesion: 79%

## When to Use

- Working with code in `src/`
- Understanding how randomizePolySynth, unregisterKnobsByPrefix, rebuildEngineParamUI work
- Modifying polysynth-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/polysynth/polysynth-presets.ts` | flatToPolyParams, getFactoryPolyPresets, loadUserPolyPresets, saveUserPolyPresets, applyPolyParams (+16) |
| `src/polysynth/polysynth.ts` | PolySynth, trigger, internalTrigger, releaseGate, stop (+7) |
| `src/core/randomize-ui.ts` | randomizeDrumsSound, randomizePolyLaneNotes, pickMidi, wireRandomizeUI, $btn |
| `src/core/random.ts` | randRange, pick, randomizePolySynth |
| `src/engines/engine-selector-ui.ts` | unregisterKnobsByPrefix, rebuildEngineParamUI |
| `src/polysynth/polysynth-builtin-env.dsp.test.ts` | renderPoly |
| `src/engines/subtractive.ts` | onChange |

## Entry Points

Start here when exploring this area:

- **`randomizePolySynth`** (Function) — `src/core/random.ts:116`
- **`unregisterKnobsByPrefix`** (Function) — `src/engines/engine-selector-ui.ts:49`
- **`rebuildEngineParamUI`** (Function) — `src/engines/engine-selector-ui.ts:55`
- **`loadUserPolyPresets`** (Function) — `src/polysynth/polysynth-presets.ts:53`
- **`saveUserPolyPresets`** (Function) — `src/polysynth/polysynth-presets.ts:59`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `PolySynth` | Class | `src/polysynth/polysynth.ts` | 71 |
| `randomizePolySynth` | Function | `src/core/random.ts` | 116 |
| `unregisterKnobsByPrefix` | Function | `src/engines/engine-selector-ui.ts` | 49 |
| `rebuildEngineParamUI` | Function | `src/engines/engine-selector-ui.ts` | 55 |
| `loadUserPolyPresets` | Function | `src/polysynth/polysynth-presets.ts` | 53 |
| `saveUserPolyPresets` | Function | `src/polysynth/polysynth-presets.ts` | 59 |
| `applyPolyParams` | Function | `src/polysynth/polysynth-presets.ts` | 81 |
| `applyPresetByName` | Function | `src/polysynth/polysynth-presets.ts` | 97 |
| `refreshPolyPresetSelect` | Function | `src/polysynth/polysynth-presets.ts` | 106 |
| `populatePolyPresetSelectForLane` | Function | `src/polysynth/polysynth-presets.ts` | 119 |
| `populatePolyPresetSelect` | Function | `src/polysynth/polysynth-presets.ts` | 177 |
| `markPolyPresetCustom` | Function | `src/polysynth/polysynth-presets.ts` | 331 |
| `wirePolyControls` | Function | `src/polysynth/polysynth-presets.ts` | 361 |
| `loadCurrentPreset` | Function | `src/polysynth/polysynth-presets.ts` | 393 |
| `releaseGate` | Function | `src/polysynth/polysynth.ts` | 332 |
| `stop` | Function | `src/polysynth/polysynth.ts` | 345 |
| `wireRandomizeUI` | Function | `src/core/randomize-ui.ts` | 128 |
| `$btn` | Function | `src/core/randomize-ui.ts` | 129 |
| `markPagePresetCustom` | Function | `src/polysynth/polysynth-presets.ts` | 323 |
| `populateEnginePresetSelectById` | Function | `src/polysynth/polysynth-presets.ts` | 230 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `WireEngineSelector → GetCachedPresets` | cross_community | 7 |
| `WireEngineSelector → FlatToPolyParams` | cross_community | 7 |
| `WireEngineSelector → LoadUserPolyPresets` | cross_community | 6 |
| `WirePolyControls → GetCachedPresets` | cross_community | 5 |
| `WirePolyControls → FlatToPolyParams` | intra_community | 5 |
| `OnChange → MakeWaveformGlyph` | cross_community | 5 |
| `OnChange → Refresh` | cross_community | 5 |
| `OnChange → NormaliseSelectIndex` | cross_community | 5 |
| `OnChange → Polar` | cross_community | 5 |
| `OnChange → Clamp` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Engines | 3 calls |
| Session | 3 calls |
| Cluster_118 | 3 calls |

## How to Explore

1. `gitnexus_context({name: "randomizePolySynth"})` — see callers and callees
2. `gitnexus_query({query: "polysynth"})` — find related execution flows
3. Read key files listed above for implementation details
