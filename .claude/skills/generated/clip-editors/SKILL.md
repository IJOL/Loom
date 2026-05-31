---
name: clip-editors
description: "Skill for the Clip-editors area of tb303-synth. 24 symbols across 4 files."
---

# Clip-editors

24 symbols | 4 files | Cohesion: 84%

## When to Use

- Working with code in `src/`
- Understanding how defaultViewState, scrubToZoom, zoomAroundAnchor work
- Modifying clip-editors-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/core/pianoroll.ts` | buildEditorFrame, mkWrap, mkCanvas, ctx2d, createPianoRoll (+6) |
| `src/session/clip-editors/clip-editor-drum-grid.ts` | buildCell, mutate, firstNoteInStep, currentRoll, removeAllHitsInStep (+3) |
| `src/core/pianoroll-zoom.ts` | defaultViewState, scrubToZoom, zoomAroundAnchor, resolveViewState |
| `src/session/clip-editors/clip-editor-router.ts` | buildPianoRoll |

## Entry Points

Start here when exploring this area:

- **`defaultViewState`** (Function) — `src/core/pianoroll-zoom.ts:16`
- **`scrubToZoom`** (Function) — `src/core/pianoroll-zoom.ts:37`
- **`zoomAroundAnchor`** (Function) — `src/core/pianoroll-zoom.ts:45`
- **`resolveViewState`** (Function) — `src/core/pianoroll-zoom.ts:51`
- **`buildEditorFrame`** (Function) — `src/core/pianoroll.ts:51`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `defaultViewState` | Function | `src/core/pianoroll-zoom.ts` | 16 |
| `scrubToZoom` | Function | `src/core/pianoroll-zoom.ts` | 37 |
| `zoomAroundAnchor` | Function | `src/core/pianoroll-zoom.ts` | 45 |
| `resolveViewState` | Function | `src/core/pianoroll-zoom.ts` | 51 |
| `buildEditorFrame` | Function | `src/core/pianoroll.ts` | 51 |
| `mkWrap` | Function | `src/core/pianoroll.ts` | 71 |
| `mkCanvas` | Function | `src/core/pianoroll.ts` | 77 |
| `createPianoRoll` | Function | `src/core/pianoroll.ts` | 119 |
| `tickFromX` | Function | `src/core/pianoroll.ts` | 137 |
| `midiFromY` | Function | `src/core/pianoroll.ts` | 138 |
| `persist` | Function | `src/core/pianoroll.ts` | 228 |
| `isResizeEdge` | Function | `src/core/pianoroll.ts` | 297 |
| `findNoteAt` | Function | `src/core/pianoroll.ts` | 301 |
| `pointerPos` | Function | `src/core/pianoroll.ts` | 309 |
| `ctx2d` | Function | `src/core/pianoroll.ts` | 108 |
| `buildPianoRoll` | Function | `src/session/clip-editors/clip-editor-router.ts` | 45 |
| `buildCell` | Function | `src/session/clip-editors/clip-editor-drum-grid.ts` | 52 |
| `mutate` | Function | `src/session/clip-editors/clip-editor-drum-grid.ts` | 62 |
| `firstNoteInStep` | Function | `src/session/clip-editors/clip-editor-drum-grid.ts` | 88 |
| `currentRoll` | Function | `src/session/clip-editors/clip-editor-drum-grid.ts` | 96 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RenderClipEditor → FirstNoteInStep` | cross_community | 7 |
| `RenderClipEditor → CurrentRoll` | cross_community | 6 |
| `RenderClipEditor → WithUndo` | cross_community | 5 |
| `RenderClipEditor → MkWrap` | cross_community | 5 |
| `RenderClipEditor → MkCanvas` | cross_community | 5 |
| `Mutate → RemoveAllHitsInStep` | intra_community | 4 |
| `RenderClipEditor → Ctx2d` | cross_community | 4 |
| `RenderClipEditor → DefaultViewState` | cross_community | 4 |
| `RenderClipEditor → SyncStrips` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_116 | 4 calls |
| Cluster_117 | 2 calls |
| Cluster_115 | 1 calls |
| Session | 1 calls |

## How to Explore

1. `gitnexus_context({name: "defaultViewState"})` — see callers and callees
2. `gitnexus_query({query: "clip-editors"})` — find related execution flows
3. Read key files listed above for implementation details
