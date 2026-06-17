# Duplicate lanes & scenes + Capture playing clips into a scene

**Date:** 2026-06-17
**Status:** Approved design (ready for implementation plan)

## Goal

Three related session-editing affordances, all in the **Session** view:

1. **Duplicate a track (lane)** — full clone: instrument *and* all clips.
2. **Duplicate a scene** — clone an existing scene row.
3. **Capture playing clips → new scene** — snapshot whatever is currently
   sounding across all lanes into a fresh scene. Triggerable from a button (in
   two places) and the **Ctrl+I** hotkey.

These mirror Ableton Live's `Cmd+D` (duplicate) and "Capture" behaviours.

## User decisions (locked)

- **Duplicate lane = full clone** (instrument + clips), not instrument-only.
- **Capture button placement = both** the *Scenes* column header and the
  session toolbar, plus the Ctrl+I hotkey.

## Background — how the model works today

- `SessionScene = { id, name?, clipPerLane: Record<laneId, number|null> }`.
  `launchScene` resolves, per lane: `clipPerLane[laneId]` when the key is present
  (`hasOwnProperty`), otherwise **falls back to the scene's row index**
  (`sceneIdx`). `null` = "this lane plays nothing / is left untouched".
  See [session-runtime.ts](../../../src/session/session-runtime.ts) `launchScene`.
- A scene's array index doubles as a clip-row index for lanes without an
  explicit entry. **Inserting a scene mid-array would silently re-map every
  fallback scene below it** → we always **append new scenes at the end**.
- "What is playing" lives in the runtime, not the model: `LanePlayState.playing`
  is the live `SessionClip` (matched by `id`). See
  [session-runtime.ts](../../../src/session/session-runtime.ts) `LanePlayState`.
- Clips carry a unique `id`; playing-state, clip colour, and the Performance
  view all match clips **by id**. Therefore a duplicated lane MUST get **fresh
  clip ids** — reusing them would break `lp.playing.id === clip.id` and colour
  resolution.
- A lane owns live audio nodes (`ChannelStrip` + engine instance + insert
  chain) via `LaneResourceMap`. Rehydrating a lane from persisted state is
  already done in
  [session-host-persistence.ts](../../../src/session/session-host-persistence.ts)
  `applyLoadedSessionState` (per-lane: `ensureLaneResource` →
  `rehydrateInsertChain` → `applyPresetForLane` → `applyLaneEngineState`).
- Reusable right-click menu: [context-menu.ts](../../../src/core/context-menu.ts)
  `openContextMenu(e, items)`, already wired on lane headers, clip cells and
  scene cells in [session-ui.ts](../../../src/session/session-ui.ts).
- Global keyboard shortcuts pattern: [history-wiring.ts](../../../src/save/history-wiring.ts)
  (`wireHistoryKeyboard`, `isTextEditTarget`, `withUndo` — all exported).

## Chosen approach

**Pure logic in `session.ts` / `session-runtime.ts`, thin callbacks in the host,
UI via callbacks.** This matches the repo's established pattern: pure,
unit-testable mutation helpers; host callbacks wrap them in `withUndo`; UI
surfaces invoke callbacks. (Rejected: doing everything inside the callbacks —
not unit-testable; and reusing `applyLoadedSessionState` to clone a lane — it
disposes/realloc​ates *all* lanes and clears `laneStates`, stopping playback,
which is unacceptable while the user is jamming.)

## Section A — Pure logic seams (no DOM, no audio)

### A1. `duplicateLane(state, srcLaneId, newId): SessionLane` — `session.ts`
- Deep-clone the source lane (`engineId`, `name`, `engineState`, `inserts`,
  `enginePresetName`, `launchQuantize`, `musicalityOverride`, all clips).
- **Remap every clip's `id`** to a fresh unique id (use the module's `nextId`
  generator); preserve clip array positions (incl. `null` holes).
- Set `id = newId`, `name = "<source name|id> copy"`.
- Insert the new lane **immediately to the right** of the source in
  `state.lanes`.
- For **every scene** that has an explicit entry for `srcLaneId`, mirror it:
  `scene.clipPerLane[newId] = scene.clipPerLane[srcLaneId]`. (Scenes that use
  row-index fallback need no change — the cloned clips sit at the same row
  indices, so the new lane falls back identically.)
- Return the new lane.

### A2. `duplicateScene(state, sceneIdx): SessionScene` — `session.ts`
- No-op-safe if `sceneIdx` out of range (return early / guard at call site).
- Build `clipPerLane` by **resolving the effective index for every lane**:
  `explicit = hasOwnProperty(src.clipPerLane, lane.id)`; value =
  `explicit ? src.clipPerLane[lane.id] : sceneIdx`. This freezes the clone to
  launch exactly what the source launches, independent of its new row position.
- `id` = fresh; `name = "<source name|'Scene N'> copy"`.
- **Append at the end** of `state.scenes`. Return the new scene.

### A3. `buildSceneFromPlaying(state, laneStates): SessionScene | null` — `session-runtime.ts`
- For each lane: if `laneStates.get(lane.id)?.playing` exists, find its row
  index in `lane.clips` (`clips[i]?.id === playing.id`) → explicit entry; else
  explicit `null` (so launching the captured scene leaves idle lanes untouched
  rather than falling back to a row index).
- If **no lane is playing**, return `null` (caller no-ops).
- `id` = fresh; `name = "Scene <state.scenes.length + 1>"` (matches the existing
  `onAddScene` naming). Caller appends it at the end.

## Section B — Host callbacks ([session-host-callbacks.ts](../../../src/session/session-host-callbacks.ts))

A small reusable helper factored from the load path:

`rehydrateLane(self, lane)` — for a single lane: `ensureLaneResource(id, engineId)`
→ if `lane.inserts?.length` `rehydrateInsertChain` → if `lane.enginePresetName`
`applyPresetForLane` → `applyLaneEngineState(...)` (the same call
`applyEngineState` makes per lane, with the `loadNoteFx`/`reloadDrumkit`/
`reloadInstrument` hooks). `applyLoadedSessionState` should be refactored to call
this helper per lane so there is one rehydration path.

- **`onDuplicateLane(laneId)`**: `withUndo` → `newId = nextLaneSlug(used, engineId)`
  → `duplicateLane(state, laneId, newId)` → `laneStates.set(newId, emptyLanePlayState(newId))`
  → `rehydrateLane(self, newLane)` → `renderWithMixer()`. **Does not stop**
  existing playback; the new lane is born idle.
- **`onDuplicateScene(sceneIdx)`**: `withUndo` → `duplicateScene(state, sceneIdx)`
  → `renderWithMixer()`.
- **`onCaptureScene()`**: `const sc = buildSceneFromPlaying(state, laneStates)`;
  if `null` → no-op (guard *before* `withUndo` so an empty capture commits
  nothing); else `withUndo(() => { state.scenes.push(sc); renderWithMixer(); })`.

Expose a public `SessionHost.captureScene()` that calls `this.callbacks.onCaptureScene()`,
used by the transport button and the hotkey. Add the three callbacks to the
`SessionUICallbacks` interface.

## Section C — UI surfaces

All visible strings in **English** (repo convention).

- **Lane-header context menu** ([session-ui.ts](../../../src/session/session-ui.ts) `laneHeader`):
  add **"Duplicate track"** → `cb.onDuplicateLane(lane.id)` (above the
  destructive "Delete track").
- **Scene-cell context menu** (`sceneLaunchCell`): add **"Duplicate scene"** →
  `cb.onDuplicateScene(idx)` and **"Capture playing → scene"** →
  `cb.onCaptureScene()`.
- **Scenes column header** (`scenesHeader`): add a small button **"⊙ Capture"**
  → `cb.onCaptureScene()` (title: "New scene from currently playing clips
  (Ctrl+I)").
- **Session toolbar** ([index.html](../../../index.html) `row session-bar`,
  near REC/New/Save): static `<button id="capture-scene" class="io"
  title="Capture playing clips into a new scene (Ctrl+I)">⊙ Capture</button>`,
  wired in `main.ts` to `sessionHost.captureScene()`.
- **Hotkey Ctrl+I**: a new global `keydown` listener (own small wiring function,
  e.g. `wireCaptureHotkey` or inline in `main.ts`) — skip if
  `isTextEditTarget(e.target)`, require `e.ctrlKey || e.metaKey`,
  `e.key.toLowerCase() === 'i'`, `preventDefault()`, call
  `sessionHost.captureScene()`.

## Section D — Edge cases & invariants

- Duplicated lane clips ALWAYS get fresh ids (covered by an A1 test).
- Capture with nothing playing → silent no-op (no toast system exists).
- New scenes ALWAYS appended at the end — never spliced mid-array.
- Undo of duplicate-lane: `restore` → `applyLoadedSessionState` disposes the
  orphan lane resource (same proven path as `onAddLane`'s undo).
- Duplicate lane must NOT stop or restart any currently-playing lane.
- Ctrl+I must not fire while typing in a text field (BPM input, save-name, etc.).

## Section E — Tests (Vitest, pure)

- `duplicateLane`: clip ids are all-new and unique; new lane sits immediately
  right of source; `clipPerLane` mirrored for scenes with explicit src entries;
  `engineState`/`enginePresetName`/`inserts` deep-cloned (mutating clone doesn't
  touch source); name is `"<src> copy"`.
- `duplicateScene`: `clipPerLane` resolves explicit + fallback indices; appended
  at end; name is copy; out-of-range guarded.
- `buildSceneFromPlaying`: captures each playing clip's row index; idle lanes →
  explicit `null`; nothing playing → `null`.

(Host-callback wiring and the hotkey are covered by the existing manual/live
check; no DSP renders are involved.)

## Out of scope

- No per-scene preset/automation changes (scenes remain pure clip launchers).
- No "duplicate clip" work — that already exists in the inspector.
- No reordering UI for the new lane/scene beyond the defined insert positions.
