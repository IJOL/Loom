---
name: presets
description: "Skill for the Presets area of tb303-synth. 9 symbols across 3 files."
---

# Presets

9 symbols | 3 files | Cohesion: 94%

## When to Use

- Working with code in `src/`
- Understanding how wirePresetLibrary, $, run work
- Modifying presets-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/presets/preset-library-ui.ts` | wirePresetLibrary, $, run |
| `src/presets/presets.ts` | loadDrumPreset, loadBassPreset, loadMelodyPreset |
| `src/presets/preset-loader.ts` | validatePresetEntry, loadEnginePresets, loadAllPresets |

## Entry Points

Start here when exploring this area:

- **`wirePresetLibrary`** (Function) — `src/presets/preset-library-ui.ts:14`
- **`$`** (Function) — `src/presets/preset-library-ui.ts:17`
- **`run`** (Function) — `src/presets/preset-library-ui.ts:45`
- **`loadDrumPreset`** (Function) — `src/presets/presets.ts:301`
- **`loadBassPreset`** (Function) — `src/presets/presets.ts:319`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `wirePresetLibrary` | Function | `src/presets/preset-library-ui.ts` | 14 |
| `$` | Function | `src/presets/preset-library-ui.ts` | 17 |
| `run` | Function | `src/presets/preset-library-ui.ts` | 45 |
| `loadDrumPreset` | Function | `src/presets/presets.ts` | 301 |
| `loadBassPreset` | Function | `src/presets/presets.ts` | 319 |
| `loadMelodyPreset` | Function | `src/presets/presets.ts` | 334 |
| `validatePresetEntry` | Function | `src/presets/preset-loader.ts` | 2 |
| `loadEnginePresets` | Function | `src/presets/preset-loader.ts` | 22 |
| `loadAllPresets` | Function | `src/presets/preset-loader.ts` | 46 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Session | 1 calls |

## How to Explore

1. `gitnexus_context({name: "wirePresetLibrary"})` — see callers and callees
2. `gitnexus_query({query: "presets"})` — find related execution flows
3. Read key files listed above for implementation details
