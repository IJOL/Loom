# Clip ops: move, copy, soft colors

Status: design approved · 2026-05-29
Depends on: `2026-05-28-undo-global-design.md`

## Goal

Direct-manipulation editing of the session grid: pick a clip with the mouse and drag it to another slot. Plain drag moves; `Ctrl`-drag copies. Cross-lane drops are allowed even between different engines — envelopes whose `paramId` is not exposed by the destination engine survive the move but get `enabled: false`. New clips get a random soft pastel color; copies inherit the source's color so visual lineage stays obvious. Every operation is a single undo step.

## Non-goals

- Multi-selection / band-select / drag a group of clips.
- Drag from the session grid to an arrangement timeline (no such view exists).
- Auto-shift / insert-and-push on drop to an occupied slot.
- Manual color picker.
- Engine-specific note remapping (e.g. translating drum pitches into melodic notes when moved onto a tb303 lane). Notes are carried verbatim — meaning is whatever the destination engine makes of them.

## Behaviour summary

| Gesture                          | Outcome                                                            |
|----------------------------------|--------------------------------------------------------------------|
| Drag clip A → empty cell         | A moves; source slot becomes `null`                                |
| Ctrl+drag clip A → empty cell    | Copy of A appears; source unchanged; copy has new `id`, same color |
| Drag clip A → occupied cell      | Drop rejected; `.drop-invalid` flash; nothing changes              |
| Ctrl+drag clip A → occupied cell | Drop rejected; same                                                |
| Drag/copy to same cell           | Drop rejected (no-op)                                              |
| Drag during playback             | Clip keeps `id`; runtime `playing.id` keeps tracking it            |
| Cross-lane, same engine          | All envelopes' `paramId`s match; stay enabled                      |
| Cross-lane, different engine     | Envelopes with unknown `paramId` → `enabled: false`, values kept   |
| Escape during drag               | Cancel; no mutation                                                |

## Components

### 1. Pure model — `src/session/session.ts`

Add the slot type and three pure functions:

```ts
export interface ClipSlot { laneId: string; clipIdx: number; }

export function canDropClip(
  s: SessionState,
  from: ClipSlot,
  to: ClipSlot,
): boolean;

export function moveClip(
  s: SessionState,
  from: ClipSlot,
  to: ClipSlot,
  destEngineParamIds: ReadonlySet<string>,
): SessionState;

export function copyClip(
  s: SessionState,
  from: ClipSlot,
  to: ClipSlot,
  destEngineParamIds: ReadonlySet<string>,
): SessionState;
```

Semantics:

- `canDropClip`: returns `false` if `from` and `to` reference the same slot, if `from.laneId` lane has no clip at `from.clipIdx`, or if the `to.laneId` lane already has a clip at `to.clipIdx`. `true` otherwise.
- `moveClip`: throws if `!canDropClip(s, from, to)`. Returns a new `SessionState` (no in-place mutation) where the source slot is set to `null` (the empty sentinel used by `clips: (SessionClip | null)[]`) and the clip is placed at `to`. If `from.laneId !== to.laneId`, each `envelope` in the moved clip is re-evaluated: `enabled = destEngineParamIds.has(envelope.paramId)`. `values` are never touched. The clip's `id` and `color` are preserved.
- `copyClip`: throws if `!canDropClip`. Returns a new state where `from` is unchanged and `to` holds a deep clone of the source clip. The clone gets a fresh `id` via the existing `nextId('clip')`; its `color` is preserved from the source. Cross-engine envelope re-evaluation is identical to `moveClip`.
- Lanes may need to grow: if `to.clipIdx >= lane.clips.length`, the destination lane's `clips` array is padded with `null` up to and including `to.clipIdx`. The runtime already tolerates sparse `clips` arrays (see `clipRowCount`).

Pure: no DOM, no audio, no import from `src/engines/registry.ts`. The `destEngineParamIds` set is injected by the caller, which keeps `session.ts` engine-agnostic and these functions trivially unit-testable.

Add the color palette and helper:

```ts
export const CLIP_COLOR_PALETTE: readonly string[] = [
  '#f4b8b8', '#f4c8a8', '#f4e0a8', '#d8e8a8',
  '#a8e8b8', '#a8e0d8', '#a8c8e8', '#b8b8e8',
  '#c8a8e0', '#e0a8d0', '#e0b8b8', '#c8c8a8',
];

export function pickRandomClipColor(rng: () => number = Math.random): string;
```

Modify `emptyClip(lengthBars)` to assign `color: pickRandomClipColor()` by default. Existing `SessionClip.color?` field stays optional in the type; only the constructor populates it.

### 2. Engine param resolution — `src/engines/registry.ts` (extension)

The drag handler needs the destination engine's allowed `paramId` set. Add (or use, if equivalent exists):

```ts
export function getEngineParamIds(engineId: string): ReadonlySet<string>;
```

Returns the set of `paramId`s the engine exposes for automation. Backed by the existing per-engine param metadata (the unified-param-system landed earlier — this is a thin read over what's already registered).

The clip-ops layer never imports this directly; the host (`main.ts`) calls it and forwards the set to the pure mutators.

### 3. Drag glue — `src/session/session-ui.ts`

Per-cell wiring, attached only to filled cells (`.session-cell-filled`):

- `cursor: grab` baseline; `grabbing` during drag.
- `pointerdown` (button 0):
  - Record source `ClipSlot` from `cell.dataset`.
  - Record initial pointer coordinates.
  - Do not enter drag yet.
- `pointermove` after a `pointerdown`:
  - If displacement < 4 px, do nothing.
  - On first crossing of the threshold, create a "ghost" element (a translucent clone of the source cell, absolutely positioned, `pointer-events: none`) and attach it to `<body>`. Add `.drop-source` class to the source cell.
  - Capture the pointer (`setPointerCapture`).
  - Each subsequent `pointermove`: move the ghost; query `document.elementFromPoint(e.clientX, e.clientY)`; walk up to find `.session-cell`; toggle `.drop-valid` / `.drop-invalid` based on `canDropClip` evaluated for current `from`/`to`. Also clear the classes from any previously-hovered cell.
- `keydown` / `keyup` during drag for `Control`: re-render the hovered cell's class — the drop validity does not change (it's `canDropClip`, which doesn't depend on copy vs move), but cursor and ghost outline change to signal intent. Implementation: `body.classList.toggle('drag-copy', e.ctrlKey)`; CSS draws a `+` badge on the ghost when `.drag-copy`.
- `Escape` keydown during drag: cancel — remove ghost, drop classes, release pointer.
- `pointerup`:
  - If currently dragging and target cell has `.drop-valid`: fire callback `cb.onMoveClip(from, to, copy: boolean)` where `copy = e.ctrlKey`.
  - Else: silently cancel.
  - Always tear down ghost + classes + release pointer capture.

New `SessionUICallbacks` member:

```ts
onMoveClip: (from: ClipSlot, to: ClipSlot, copy: boolean) => void;
```

The cell click handler stays: short clicks (no movement beyond threshold) still fire `onClipClick` / `onCellClick`. Drag and click are distinguished by movement threshold and pointer-up state.

### 4. Host wiring — `src/main.ts`

```ts
function onMoveClip(from: ClipSlot, to: ClipSlot, copy: boolean) {
  const destLane = state.lanes.find(l => l.id === to.laneId)!;
  const paramIds = getEngineParamIds(destLane.engineId);
  withUndo(historyDeps, () => {
    state = copy
      ? copyClip(state, from, to, paramIds)
      : moveClip(state, from, to, paramIds);
    renderSessionGrid(host, state, laneStates, callbacks);
  });
}
```

`withUndo` is the helper introduced in the undo spec. One drop = one undo entry.

### 5. CSS — `src/styles/_session-inspector.scss` (or sibling)

New classes:

- `.session-cell.drop-valid` — outline `2px solid var(--accent-ok)`, slight background lighten. Does not overwrite `background-color` (preserves clip color).
- `.session-cell.drop-invalid` — outline `2px dashed var(--accent-warn)`.
- `.session-cell.drop-source` — opacity `0.4` while dragging.
- `.session-ghost` — absolute, `pointer-events: none`, follows pointer; identical visual to the source cell minus interactions.
- `body.drag-copy .session-ghost::after { content: '+'; … }` — copy-mode badge.

## Testing

### `src/session/session-clip-ops.test.ts` (pure unit tests)

- `canDropClip`:
  - Empty destination on existing or new row → `true`.
  - Occupied destination → `false`.
  - `from === to` → `false`.
  - Source slot empty → `false`.
- `moveClip` intra-lane: clip ends up at `to`, source becomes `null`, length adjusted as needed.
- `moveClip` cross-lane, all `paramId`s in `destEngineParamIds`: every envelope's `enabled` stays `true` (or undefined — treat undefined as enabled).
- `moveClip` cross-lane, none of the envelope `paramId`s in set: every envelope ends with `enabled: false`; `values` arrays unchanged byte-for-byte.
- `moveClip` cross-lane, partial overlap: envelopes split between `enabled: true` and `enabled: false` per their `paramId`.
- `moveClip` throws on invalid drop (occupied destination).
- `copyClip`: source unchanged; destination has a new `id`; `color` matches source; same envelope re-evaluation rules apply.
- `pickRandomClipColor` with stub `rng`: returns the palette entry at the indexed position deterministically.
- `emptyClip()`: returned color is a member of `CLIP_COLOR_PALETTE`.

### E2E (`tests/e2e/clip-ops.spec.ts`)

One smoke flow:

1. Add a clip in lane 1.
2. Drag it to row 2 of lane 1 (empty). Assert it moved.
3. Hold `Ctrl` and drag the clip from row 2 to row 3. Assert both row 2 and row 3 have clips, same color, different ids in the DOM.
4. Drag the row 3 clip onto row 2 (occupied). Assert `.drop-invalid` flashed, no mutation.
5. Send `Ctrl+Z`. Assert previous state restored. (Covers the undo integration.)

Cross-engine envelope flipping is not E2E-tested — it's exercised by the pure tests.

### What does not get a test

DSP. Clip ops don't touch the audio graph; engine playback paths are covered by `*.dsp.test.ts` already.

## Memory and edge cases

- **Playing-clip move**: `playing.id` in `LanePlayState` is the clip's id, which doesn't change on move. The runtime keeps tracking the moved clip wherever it now lives. Acceptable — no special handling.
- **Playing-clip copy**: the copy has a new `id`, so it is not "the playing clip". Playback continues on the original. Acceptable.
- **Cross-lane move while clip is playing**: the moved clip is now under a different engine; the engine that was playing it keeps playing until its loop ends or the user stops the lane. The destination engine has its own scheduler. This is a minor inconsistency; deemed acceptable in this iteration — fix in a follow-up if it surfaces audibly. Documented as known limitation.
- **Sparse lanes**: `moveClip`/`copyClip` may pad `clips` with `null` to reach `to.clipIdx`. `clipRowCount` and `renderSessionGrid` already handle sparse arrays.
- **Undo of a move**: restoring the previous snapshot restores `playing.id` references implicitly because the runtime keys off ids and the runtime state is rebuilt on `restore`.

## File layout summary

New:

- `src/session/session-clip-ops.test.ts`
- `tests/e2e/clip-ops.spec.ts`

Modified:

- `src/session/session.ts` — add `ClipSlot`, `canDropClip`, `moveClip`, `copyClip`, `CLIP_COLOR_PALETTE`, `pickRandomClipColor`; update `emptyClip` to seed `color`.
- `src/session/session-ui.ts` — drag handlers, ghost, drop classes, `onMoveClip` callback.
- `src/engines/registry.ts` — export `getEngineParamIds` (or equivalent if already present under a different name).
- `src/main.ts` — wire `onMoveClip` with `withUndo` + `getEngineParamIds`.
- `src/styles/_session-inspector.scss` (or sibling) — drop/ghost CSS.

## Open implementation details

Decided at plan/implementation time:

- Whether `getEngineParamIds` already exists under another name in the registry; if so, reuse it instead of adding a duplicate.
- Whether the ghost element is a deep DOM clone of the source cell or a minimal `<div>` styled to match — the test "looks like the clip" is the bar.
- Exact pixel value of the drag-threshold (4 px is a starting point; may need to tune on touch devices, though touch is not the target).
