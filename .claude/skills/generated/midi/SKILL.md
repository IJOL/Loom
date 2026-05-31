---
name: midi
description: "Skill for the Midi area of tb303-synth. 23 symbols across 6 files."
---

# Midi

23 symbols | 6 files | Cohesion: 92%

## When to Use

- Working with code in `src/`
- Understanding how listEngines, findGMMatches, firstMatchForGM work
- Modifying midi-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/midi/gm-lookup.ts` | findGMMatches, firstMatchForGM, pickPresetForGM, isDrumsEngine, drumFallback (+4) |
| `src/midi/midi-import-ui.ts` | wireMidiImportUI, buildAllPresetsList, buildPresetSelect, addOption, buildAuditionButton |
| `src/midi/midi-parse.ts` | parseMidiFile, u8, u16, u32, vlq |
| `src/midi/midi-to-session.ts` | nextId, midiToSession |
| `src/engines/registry.ts` | listEngines |
| `src/presets/preset-loader.ts` | isPresetsReady |

## Entry Points

Start here when exploring this area:

- **`listEngines`** (Function) — `src/engines/registry.ts:45`
- **`findGMMatches`** (Function) — `src/midi/gm-lookup.ts:8`
- **`firstMatchForGM`** (Function) — `src/midi/gm-lookup.ts:18`
- **`pickPresetForGM`** (Function) — `src/midi/gm-lookup.ts:23`
- **`firstDrumKitForGM`** (Function) — `src/midi/gm-lookup.ts:42`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `listEngines` | Function | `src/engines/registry.ts` | 45 |
| `findGMMatches` | Function | `src/midi/gm-lookup.ts` | 8 |
| `firstMatchForGM` | Function | `src/midi/gm-lookup.ts` | 18 |
| `pickPresetForGM` | Function | `src/midi/gm-lookup.ts` | 23 |
| `firstDrumKitForGM` | Function | `src/midi/gm-lookup.ts` | 42 |
| `matches` | Function | `src/midi/gm-lookup.ts` | 43 |
| `pickDrumKitForGM` | Function | `src/midi/gm-lookup.ts` | 47 |
| `suggestDefaultMapping` | Function | `src/midi/gm-lookup.ts` | 53 |
| `wireMidiImportUI` | Function | `src/midi/midi-import-ui.ts` | 39 |
| `buildAllPresetsList` | Function | `src/midi/midi-import-ui.ts` | 52 |
| `buildPresetSelect` | Function | `src/midi/midi-import-ui.ts` | 60 |
| `addOption` | Function | `src/midi/midi-import-ui.ts` | 69 |
| `buildAuditionButton` | Function | `src/midi/midi-import-ui.ts` | 92 |
| `midiToSession` | Function | `src/midi/midi-to-session.ts` | 22 |
| `isPresetsReady` | Function | `src/presets/preset-loader.ts` | 54 |
| `parseMidiFile` | Function | `src/midi/midi-parse.ts` | 15 |
| `u8` | Function | `src/midi/midi-parse.ts` | 17 |
| `u16` | Function | `src/midi/midi-parse.ts` | 18 |
| `u32` | Function | `src/midi/midi-parse.ts` | 19 |
| `vlq` | Function | `src/midi/midi-parse.ts` | 20 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnClipPlayPause → ListEngines` | cross_community | 5 |
| `OnStopLane → ListEngines` | cross_community | 5 |
| `OnLaunchScene → ListEngines` | cross_community | 5 |
| `OnStopAll → ListEngines` | cross_community | 5 |
| `Loop → ListEngines` | cross_community | 5 |
| `LaunchSceneById → ListEngines` | cross_community | 5 |
| `OnClipClick → ListEngines` | cross_community | 5 |
| `Init → ListEngines` | cross_community | 4 |
| `WireMidiImportUI → ListEngines` | intra_community | 4 |
| `WireMidiImportUI → IsDrumsEngine` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Engines | 2 calls |

## How to Explore

1. `gitnexus_context({name: "listEngines"})` — see callers and callees
2. `gitnexus_query({query: "midi"})` — find related execution flows
3. Read key files listed above for implementation details
