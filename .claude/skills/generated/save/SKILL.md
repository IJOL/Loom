---
name: save
description: "Skill for the Save area of tb303-synth. 33 symbols across 6 files."
---

# Save

33 symbols | 6 files | Cohesion: 94%

## When to Use

- Working with code in `src/`
- Understanding how readIndex, saveNamedEntry, loadEntry work
- Modifying save-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/save/save-manager.ts` | ENTRY_KEY, readIndex, writeIndex, saveNamedEntry, loadEntry (+7) |
| `src/save/save-wiring.ts` | applyLoadedState, openSaveManager, closeSaveManager, wireSaveManager, applyLoaded (+5) |
| `src/save/saved-state-v3.ts` | parseSavedStateV3, getSynth, getDrums, buildSavedStateV3, applyLoadedStateV3 |
| `src/main.ts` | snapshot, restore |
| `src/save/history-wiring.ts` | wireHistoryKeyboard, isTextEditTarget |
| `src/session/session-inspector.ts` | constructor, wireKeyboardShortcuts |

## Entry Points

Start here when exploring this area:

- **`readIndex`** (Function) — `src/save/save-manager.ts:13`
- **`saveNamedEntry`** (Function) — `src/save/save-manager.ts:29`
- **`loadEntry`** (Function) — `src/save/save-manager.ts:42`
- **`loadAutosave`** (Function) — `src/save/save-manager.ts:51`
- **`deleteEntry`** (Function) — `src/save/save-manager.ts:60`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `readIndex` | Function | `src/save/save-manager.ts` | 13 |
| `saveNamedEntry` | Function | `src/save/save-manager.ts` | 29 |
| `loadEntry` | Function | `src/save/save-manager.ts` | 42 |
| `loadAutosave` | Function | `src/save/save-manager.ts` | 51 |
| `deleteEntry` | Function | `src/save/save-manager.ts` | 60 |
| `renameEntry` | Function | `src/save/save-manager.ts` | 66 |
| `clearAll` | Function | `src/save/save-manager.ts` | 72 |
| `totalStorageKB` | Function | `src/save/save-manager.ts` | 77 |
| `downloadAsJson` | Function | `src/save/save-manager.ts` | 83 |
| `loadFromFile` | Function | `src/save/save-manager.ts` | 96 |
| `wireSaveManager` | Function | `src/save/save-wiring.ts` | 114 |
| `applyLoaded` | Function | `src/save/save-wiring.ts` | 115 |
| `openManager` | Function | `src/save/save-wiring.ts` | 116 |
| `defaultName` | Function | `src/save/save-wiring.ts` | 150 |
| `commitSave` | Function | `src/save/save-wiring.ts` | 151 |
| `openManagerForSave` | Function | `src/save/save-wiring.ts` | 164 |
| `bootRecoveryLoad` | Function | `src/save/save-wiring.ts` | 184 |
| `parseSavedStateV3` | Function | `src/save/saved-state-v3.ts` | 103 |
| `buildSavedStateV3` | Function | `src/save/saved-state-v3.ts` | 50 |
| `applyLoadedStateV3` | Function | `src/save/saved-state-v3.ts` | 66 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OpenManagerForSave → GetSynth` | cross_community | 7 |
| `OpenManagerForSave → GetDrums` | cross_community | 7 |
| `CommitSave → GetSynth` | cross_community | 6 |
| `CommitSave → GetDrums` | cross_community | 6 |
| `OpenManagerForSave → ParseSavedStateV3` | intra_community | 6 |
| `WireSaveManager → GetSynth` | cross_community | 5 |
| `WireSaveManager → GetDrums` | cross_community | 5 |
| `CommitSave → ParseSavedStateV3` | intra_community | 5 |
| `WireSaveManager → ParseSavedStateV3` | intra_community | 4 |
| `OpenManagerForSave → LoadAutosave` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Session | 1 calls |

## How to Explore

1. `gitnexus_context({name: "readIndex"})` — see callers and callees
2. `gitnexus_query({query: "save"})` — find related execution flows
3. Read key files listed above for implementation details
