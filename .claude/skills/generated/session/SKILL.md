---
name: session
description: "Skill for the Session area of tb303-synth. 116 symbols across 24 files."
---

# Session

116 symbols | 24 files | Cohesion: 73%

## When to Use

- Working with code in `src/`
- Understanding how getEngine, getEngineParamIds, withUndo work
- Modifying session-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/session/session-host.ts` | nextLaneSlug, onAddLane, onCellClick, run, onCellDropAudio (+28) |
| `src/session/session-ui.ts` | updateHover, clipCell, isFileDrag, wireClipDrag, finish (+9) |
| `src/session/session.ts` | cloneSessionState, canDropClip, padToIndex, reEvaluateEnvelopes, moveClip (+8) |
| `src/session/session-inspector.ts` | deleteSelectedClip, run, openInspector, renderEditor, pasteReplace (+6) |
| `src/session/session-runtime.ts` | stopAll, secPerTick, tickSession, emptyLanePlayState, nextBoundary (+4) |
| `src/session/clip-randomize.ts` | pickInScale, bassNotes, polyNotes, drumNotes, randomizeClipNotes |
| `src/session/session-migration.ts` | migrateLoadedSessionState, colorForClipId, guessEngineId, migrateClip |
| `src/main.ts` | getEngineEditor, onSessionChanged, showPolyEditorWrapper |
| `src/engines/registry.ts` | getEngine, getEngineParamIds |
| `src/session/clip-editors/clip-editor-drum-grid.ts` | renderDrumGridEditor, buildVoiceRow |

## Entry Points

Start here when exploring this area:

- **`getEngine`** (Function) — `src/engines/registry.ts:33`
- **`getEngineParamIds`** (Function) — `src/engines/registry.ts:54`
- **`withUndo`** (Function) — `src/save/history-wiring.ts:49`
- **`nextLaneSlug`** (Function) — `src/session/session-host.ts:25`
- **`onAddLane`** (Function) — `src/session/session-host.ts:348`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `SessionInspector` | Class | `src/session/session-inspector.ts` | 37 |
| `SessionHost` | Class | `src/session/session-host.ts` | 138 |
| `getEngine` | Function | `src/engines/registry.ts` | 33 |
| `getEngineParamIds` | Function | `src/engines/registry.ts` | 54 |
| `withUndo` | Function | `src/save/history-wiring.ts` | 49 |
| `nextLaneSlug` | Function | `src/session/session-host.ts` | 25 |
| `onAddLane` | Function | `src/session/session-host.ts` | 348 |
| `run` | Function | `src/session/session-host.ts` | 412 |
| `renderDrumGridEditor` | Function | `src/session/clip-editors/clip-editor-drum-grid.ts` | 17 |
| `renderClipEditor` | Function | `src/session/clip-editors/clip-editor-router.ts` | 27 |
| `run` | Function | `src/session/session-inspector.ts` | 64 |
| `cloneSessionState` | Function | `src/session/session.ts` | 150 |
| `canDropClip` | Function | `src/session/session.ts` | 162 |
| `moveClip` | Function | `src/session/session.ts` | 210 |
| `copyClip` | Function | `src/session/session.ts` | 231 |
| `renderWithMixer` | Function | `src/session/session-host.ts` | 179 |
| `loop` | Function | `src/session/session-host.ts` | 701 |
| `stopAll` | Function | `src/session/session-runtime.ts` | 140 |
| `renderSessionTabBar` | Function | `src/session/session-tab-bar.ts` | 13 |
| `getMasterSlots` | Function | `src/core/fx-ui.ts` | 192 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnStopLane → BuildGhost` | cross_community | 7 |
| `OnStopLane → PositionGhost` | cross_community | 7 |
| `OnLaunchScene → BuildGhost` | cross_community | 7 |
| `OnLaunchScene → PositionGhost` | cross_community | 7 |
| `OnStopAll → BuildGhost` | cross_community | 7 |
| `OnStopAll → PositionGhost` | cross_community | 7 |
| `OnStopAll → Polar` | cross_community | 7 |
| `OnStopAll → Clamp` | cross_community | 7 |
| `Loop → BuildGhost` | cross_community | 7 |
| `Loop → PositionGhost` | cross_community | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Engines | 2 calls |
| Clip-editors | 2 calls |
| Samples | 1 calls |
| Midi | 1 calls |
| Performance | 1 calls |
| Automation | 1 calls |
| Fx | 1 calls |
| Cluster_108 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "getEngine"})` — see callers and callees
2. `gitnexus_query({query: "session"})` — find related execution flows
3. Read key files listed above for implementation details
