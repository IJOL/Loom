# Duplicate Lanes & Scenes + Capture Playing Clips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ableton-style "Duplicate track", "Duplicate scene", and "Capture currently-playing clips into a new scene" to the Session view, the last with a button (Scenes header + session toolbar) and a Ctrl+I hotkey.

**Architecture:** Pure mutation helpers in `session.ts` / `session-runtime.ts` (unit-tested, no DOM/audio); thin host callbacks wrap them in `withUndo`; UI surfaces (context menus, header button, toolbar button, hotkey) invoke callbacks. Duplicating a lane re-allocates its audio resource and rehydrates engine state via a helper factored out of the existing load path.

**Tech Stack:** TypeScript, Vite, Web Audio, Vitest (pure unit tests). No new dependencies.

## Global Constraints

- All user-visible strings in **English** (repo convention).
- Test commands run colour-free: `NO_COLOR=1 npx vitest run <file>`.
- Assertions in tests are **relative/structural** (ids differ, lengths grow) — never absolute DSP magnitudes (no DSP here).
- New scenes are ALWAYS appended at the end of `state.scenes` — never spliced mid-array (mid-insert silently re-maps row-index-fallback scenes).
- Duplicated lane clips ALWAYS receive fresh unique ids (reusing ids breaks `lp.playing.id === clip.id`, colour, and Performance lookups).
- Duplicating a lane must NOT stop or restart any currently-playing lane.
- No new npm dependencies.
- Spec: `docs/superpowers/specs/2026-06-17-duplicate-lanes-scenes-capture-design.md`.

---

### Task 1: `duplicateLane` pure helper

**Files:**
- Modify: `src/session/session.ts` (add export near `moveClip`/`copyClip`, ~line 360)
- Test: `src/session/session-duplicate.test.ts` (create)

**Interfaces:**
- Consumes: existing module-private `nextId(prefix)`, types `SessionState`, `SessionLane`, `SessionScene` (all already in `session.ts`).
- Produces: `duplicateLane(state: SessionState, srcLaneId: string, newId: string): SessionLane` — deep-clones the source lane, re-ids its clips, inserts the clone immediately to the right of the source in `state.lanes`, mirrors explicit `clipPerLane` entries from `srcLaneId` to `newId` in every scene, returns the clone.

- [ ] **Step 1: Write the failing test**

Create `src/session/session-duplicate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { duplicateLane, type SessionState } from './session';

function fixture(): SessionState {
  return {
    lanes: [
      {
        id: 'tb-303-1', engineId: 'tb303', name: 'Bass',
        enginePresetName: 'factory:Acid',
        engineState: { params: { cutoff: 0.4 } },
        clips: [
          { id: 'clipA', lengthBars: 1, notes: [] },
          null,
          { id: 'clipB', lengthBars: 2, notes: [] },
        ],
      },
      { id: 'drums-1', engineId: 'drums-machine', clips: [{ id: 'd1', lengthBars: 1, notes: [] }] },
    ],
    scenes: [
      { id: 's1', name: 'A', clipPerLane: { 'tb-303-1': 0, 'drums-1': 0 } },
      { id: 's2', name: 'B', clipPerLane: {} },
    ],
    globalQuantize: '1/1',
  };
}

describe('duplicateLane', () => {
  it('inserts the clone immediately to the right of the source', () => {
    const s = fixture();
    const clone = duplicateLane(s, 'tb-303-1', 'tb-303-2');
    expect(s.lanes.map((l) => l.id)).toEqual(['tb-303-1', 'tb-303-2', 'drums-1']);
    expect(clone.id).toBe('tb-303-2');
    expect(clone.engineId).toBe('tb303');
    expect(clone.name).toBe('Bass copy');
  });

  it('gives every cloned clip a fresh unique id and preserves null holes', () => {
    const s = fixture();
    const clone = duplicateLane(s, 'tb-303-1', 'tb-303-2');
    expect(clone.clips[1]).toBeNull();
    const ids = [clone.clips[0]!.id, clone.clips[2]!.id];
    expect(ids[0]).not.toBe('clipA');
    expect(ids[1]).not.toBe('clipB');
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('deep-clones engineState and clips (mutating the clone leaves the source intact)', () => {
    const s = fixture();
    const clone = duplicateLane(s, 'tb-303-1', 'tb-303-2');
    clone.engineState!.params!.cutoff = 0.9;
    clone.clips[0]!.notes.push({ note: 60, start: 0, dur: 1, vel: 1 } as never);
    expect(s.lanes[0].engineState!.params!.cutoff).toBe(0.4);
    expect(s.lanes[0].clips[0]!.notes).toHaveLength(0);
  });

  it('mirrors explicit clipPerLane entries to the new lane, leaving fallback scenes untouched', () => {
    const s = fixture();
    duplicateLane(s, 'tb-303-1', 'tb-303-2');
    expect(s.scenes[0].clipPerLane['tb-303-2']).toBe(0);
    expect('tb-303-2' in s.scenes[1].clipPerLane).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-duplicate.test.ts`
Expected: FAIL with `duplicateLane is not exported` / `not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/session/session.ts`, add after `copyClip` (after ~line 389):

```ts
/** Full-clone a lane (instrument + all clips) and insert it immediately to the
 *  right of the source. Clips get fresh ids (ids must be unique across the
 *  session). Explicit clipPerLane entries pointing at the source lane are
 *  mirrored onto the new lane in every scene; scenes that use row-index
 *  fallback need no change (the cloned clips sit at the same row indices). */
export function duplicateLane(state: SessionState, srcLaneId: string, newId: string): SessionLane {
  const srcIndex = state.lanes.findIndex((l) => l.id === srcLaneId);
  if (srcIndex < 0) throw new Error(`duplicateLane: no lane ${srcLaneId}`);
  const src = state.lanes[srcIndex];
  const clone: SessionLane = JSON.parse(JSON.stringify(src));
  clone.id = newId;
  clone.name = `${src.name ?? src.id} copy`;
  clone.clips = clone.clips.map((c) => (c ? { ...c, id: nextId('clip') } : null));
  state.lanes.splice(srcIndex + 1, 0, clone);
  for (const scene of state.scenes) {
    if (Object.prototype.hasOwnProperty.call(scene.clipPerLane, srcLaneId)) {
      scene.clipPerLane[newId] = scene.clipPerLane[srcLaneId];
    }
  }
  return clone;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-duplicate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/session-duplicate.test.ts
git commit -m "feat(session): duplicateLane — full lane clone with fresh clip ids"
```

---

### Task 2: `duplicateScene` pure helper

**Files:**
- Modify: `src/session/session.ts` (add export right after `duplicateLane`)
- Test: `src/session/session-duplicate.test.ts` (extend)

**Interfaces:**
- Consumes: `nextId`, types `SessionState`, `SessionScene` (in `session.ts`).
- Produces: `duplicateScene(state: SessionState, sceneIdx: number): SessionScene | null` — appends a clone of the scene at `sceneIdx` with a fully-resolved `clipPerLane` (explicit value, else fallback `sceneIdx`) for EVERY lane, name `"<src name|'Scene N'> copy"`. Returns `null` if `sceneIdx` is out of range.

- [ ] **Step 1: Write the failing test**

Append to `src/session/session-duplicate.test.ts`:

```ts
import { duplicateScene } from './session';

describe('duplicateScene', () => {
  it('appends a clone resolving explicit entries for all lanes', () => {
    const s = fixture();
    const sc = duplicateScene(s, 0);
    expect(s.scenes).toHaveLength(3);
    expect(s.scenes[2]).toBe(sc);
    expect(sc!.clipPerLane).toEqual({ 'tb-303-1': 0, 'drums-1': 0 });
    expect(sc!.name).toBe('A copy');
  });

  it('resolves row-index fallback to the source index for lanes with no explicit entry', () => {
    const s = fixture();
    const sc = duplicateScene(s, 1); // s2 has empty clipPerLane
    expect(sc!.clipPerLane).toEqual({ 'tb-303-1': 1, 'drums-1': 1 });
    expect(sc!.name).toBe('B copy');
  });

  it('returns null and mutates nothing when sceneIdx is out of range', () => {
    const s = fixture();
    expect(duplicateScene(s, 9)).toBeNull();
    expect(s.scenes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-duplicate.test.ts`
Expected: FAIL with `duplicateScene is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `src/session/session.ts`, add right after `duplicateLane`:

```ts
/** Clone a scene and append it at the end. clipPerLane is fully resolved for
 *  every lane (explicit value, else the source row index) so the clone launches
 *  exactly what the source launches regardless of its new row position. New
 *  scenes are appended (never spliced) so row-index-fallback scenes stay aligned. */
export function duplicateScene(state: SessionState, sceneIdx: number): SessionScene | null {
  const src = state.scenes[sceneIdx];
  if (!src) return null;
  const clipPerLane: Record<string, number | null> = {};
  for (const lane of state.lanes) {
    const explicit = Object.prototype.hasOwnProperty.call(src.clipPerLane, lane.id);
    clipPerLane[lane.id] = explicit ? src.clipPerLane[lane.id] : sceneIdx;
  }
  const scene: SessionScene = {
    id: nextId('scene'),
    name: `${src.name ?? `Scene ${sceneIdx + 1}`} copy`,
    clipPerLane,
  };
  state.scenes.push(scene);
  return scene;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-duplicate.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/session-duplicate.test.ts
git commit -m "feat(session): duplicateScene — append a resolved-clipPerLane clone"
```

---

### Task 3: `buildSceneFromPlaying` pure helper

**Files:**
- Modify: `src/session/session-runtime.ts` (add export; extend imports from `./session`)
- Test: `src/session/session-capture.test.ts` (create)

**Interfaces:**
- Consumes: `emptyScene` (value) + types `SessionState`, `SessionScene` from `./session`; existing `LanePlayState`, `emptyLanePlayState` in this file.
- Produces: `buildSceneFromPlaying(state: SessionState, laneStates: Map<string, LanePlayState>): SessionScene | null` — for each lane, the row index of its playing clip (matched by id) as an explicit entry, else explicit `null`. Returns `null` when no lane is playing. Name `"Scene <scenes.length + 1>"`. Caller appends it.

- [ ] **Step 1: Write the failing test**

Create `src/session/session-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionState } from './session';
import { buildSceneFromPlaying, emptyLanePlayState } from './session-runtime';

function fixture(): SessionState {
  return {
    lanes: [
      { id: 'tb-303-1', engineId: 'tb303', clips: [
        { id: 'clipA', lengthBars: 1, notes: [] },
        null,
        { id: 'clipB', lengthBars: 2, notes: [] },
      ] },
      { id: 'drums-1', engineId: 'drums-machine', clips: [{ id: 'd1', lengthBars: 1, notes: [] }] },
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}

describe('buildSceneFromPlaying', () => {
  it('captures each playing clip row index and marks idle lanes as explicit null', () => {
    const s = fixture();
    const ls = new Map<string, ReturnType<typeof emptyLanePlayState>>();
    const lp = emptyLanePlayState('tb-303-1');
    lp.playing = s.lanes[0].clips[2]; // clipB at row 2
    ls.set('tb-303-1', lp);
    ls.set('drums-1', emptyLanePlayState('drums-1')); // idle
    const sc = buildSceneFromPlaying(s, ls);
    expect(sc).not.toBeNull();
    expect(sc!.clipPerLane['tb-303-1']).toBe(2);
    expect(sc!.clipPerLane['drums-1']).toBeNull();
    expect(sc!.name).toBe('Scene 1');
  });

  it('returns null when nothing is playing', () => {
    const s = fixture();
    const ls = new Map<string, ReturnType<typeof emptyLanePlayState>>();
    ls.set('tb-303-1', emptyLanePlayState('tb-303-1'));
    ls.set('drums-1', emptyLanePlayState('drums-1'));
    expect(buildSceneFromPlaying(s, ls)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-capture.test.ts`
Expected: FAIL with `buildSceneFromPlaying is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `src/session/session-runtime.ts`:

1. Extend the type import on line 4 to include `SessionScene`:

```ts
import type { SessionClip, SessionState, LaunchQuantize, SessionLane, ClipSample, SessionScene } from './session';
```

2. Add a value import directly below it:

```ts
import { emptyScene } from './session';
```

3. Add the function (e.g. just below `emptyLanePlayState`):

```ts
/** Snapshot the currently-playing clip on each lane into a new scene. Lanes with
 *  no playing clip get an explicit `null` so launching the captured scene leaves
 *  them untouched (rather than falling back to a row index). Returns `null` when
 *  nothing is playing. The caller appends the scene to state.scenes. */
export function buildSceneFromPlaying(
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
): SessionScene | null {
  const clipPerLane: Record<string, number | null> = {};
  let any = false;
  for (const lane of state.lanes) {
    const playing = laneStates.get(lane.id)?.playing;
    if (playing) {
      const idx = lane.clips.findIndex((c) => c?.id === playing.id);
      if (idx >= 0) { clipPerLane[lane.id] = idx; any = true; continue; }
    }
    clipPerLane[lane.id] = null;
  }
  if (!any) return null;
  const scene = emptyScene(`Scene ${state.scenes.length + 1}`);
  scene.clipPerLane = clipPerLane;
  return scene;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-capture.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-runtime.ts src/session/session-capture.test.ts
git commit -m "feat(session): buildSceneFromPlaying — capture playing clips into a scene"
```

---

### Task 4: Per-lane rehydration helper (load-path extraction)

**Files:**
- Modify: `src/session/session-host-persistence.ts`

**Interfaces:**
- Consumes: `self.deps.ensureLaneResource`, `self.deps.laneResources`, `self.deps.applyPresetForLane`, `rehydrateInsertChain`, `applyLaneEngineState`, `loadNoteFxForLane`, `reloadDrumkit`, `reloadInstrument` (all already imported in this file); type `SessionLane`.
- Produces:
  - `applyEngineStateForLane(self: SessionHost, lane: SessionLane): void` — applies one lane's persisted engine state to its live engine (the body of the old per-lane loop in `applyEngineState`).
  - `rehydrateLane(self: SessionHost, lane: SessionLane): void` — `ensureLaneResource` → rehydrate inserts → apply preset → `applyEngineStateForLane`. Used by `onDuplicateLane`.

This is a pure refactor of existing behaviour plus one new composing helper. Verification is tsc + the existing persistence test staying green (no new unit test — host wiring is covered by the live check in Task 8, per the spec).

- [ ] **Step 1: Add `SessionLane` to the type import**

At the top of `src/session/session-host-persistence.ts`, change:

```ts
import type { SessionState } from './session';
```
to:
```ts
import type { SessionState, SessionLane } from './session';
```

- [ ] **Step 2: Extract `applyEngineStateForLane` and refactor `applyEngineState`**

Replace the existing `applyEngineState` function body with a per-lane delegate:

```ts
/** Push persisted engine state (params, modulators, note-FX, drumkit/instrument
 *  keymaps) onto every lane's live engine, self-healing bundled samples. */
export function applyEngineState(self: SessionHost): void {
  for (const lane of self.state.lanes) applyEngineStateForLane(self, lane);
}

/** Apply ONE lane's persisted engineState to its live engine. Extracted so the
 *  duplicate-lane path can rehydrate a single new lane without touching others. */
export function applyEngineStateForLane(self: SessionHost, lane: SessionLane): void {
  const engine = self.deps.laneResources?.get(lane.id)?.engine;
  if (!engine) return;
  void applyLaneEngineState(engine as never, lane, self.deps.ctx, {
    loadNoteFx: (laneId, state) => loadNoteFxForLane(laneId, state),
    reloadDrumkit: (laneId, kitId, eng) => { void reloadDrumkit(self, laneId, kitId, eng); },
    reloadInstrument: (laneId, id, eng) => { void reloadInstrument(self, laneId, id, eng); },
  });
}
```

- [ ] **Step 3: Add `rehydrateLane`**

Add below `applyEngineStateForLane`:

```ts
/** Allocate + configure the audio resource for a single (newly added) lane:
 *  fresh ChannelStrip + engine instance, persisted inserts, preset, and engine
 *  state. Mirrors the per-lane work `applyLoadedSessionState` does, for the
 *  duplicate-lane path which adds one lane without reloading the session. */
export function rehydrateLane(self: SessionHost, lane: SessionLane): void {
  self.deps.ensureLaneResource?.(lane.id, lane.engineId);
  if (lane.inserts && lane.inserts.length > 0) {
    const laneRes = self.deps.laneResources?.get(lane.id);
    if (laneRes?.inserts) rehydrateInsertChain(self.deps.ctx, laneRes.inserts, lane.inserts);
  }
  if (lane.enginePresetName) self.deps.applyPresetForLane?.(lane.id, lane.enginePresetName);
  applyEngineStateForLane(self, lane);
}
```

- [ ] **Step 4: Verify typecheck + existing persistence test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `NO_COLOR=1 npx vitest run src/session/session-host-presets.test.ts`
Expected: PASS (existing tests — confirms the `applyEngineState` extraction didn't regress the load path).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host-persistence.ts
git commit -m "refactor(session): extract applyEngineStateForLane + rehydrateLane"
```

---

### Task 5: Host callbacks + `captureScene` method + interface

**Files:**
- Modify: `src/session/session-ui.ts` (add 3 callbacks to `SessionUICallbacks`)
- Modify: `src/session/session-host-callbacks.ts` (implement the 3 callbacks)
- Modify: `src/session/session-host.ts` (public `captureScene()` method)

**Interfaces:**
- Consumes: `duplicateLane`, `duplicateScene` (from `./session`), `buildSceneFromPlaying` (from `./session-runtime`), `rehydrateLane` (from `./session-host-persistence`), `nextLaneSlug`, `emptyLanePlayState`, `withUndo` (already imported in callbacks).
- Produces: callbacks `onDuplicateLane(laneId: string)`, `onDuplicateScene(sceneIdx: number)`, `onCaptureScene()`; method `SessionHost.captureScene(): void`.

- [ ] **Step 1: Extend the `SessionUICallbacks` interface**

In `src/session/session-ui.ts`, in the `SessionUICallbacks` interface, add after `onAddScene` / `onAddLane` (near line 31):

```ts
  /** Full-clone a lane (instrument + clips); the new lane appears to the right. */
  onDuplicateLane: (laneId: string) => void;
  /** Append a clone of the scene at sceneIdx. */
  onDuplicateScene: (sceneIdx: number) => void;
  /** Append a new scene capturing the currently-playing clip on each lane. */
  onCaptureScene: () => void;
```

- [ ] **Step 2: Implement the callbacks**

In `src/session/session-host-callbacks.ts`:

1. Extend the `./session` import (currently `emptyLane, emptyClip, audioClip, emptyScene, moveClip, copyClip, …`) to add `duplicateLane, duplicateScene`:

```ts
import {
  emptyLane, emptyClip, audioClip, emptyScene,
  moveClip, copyClip, duplicateLane, duplicateScene,
  deleteClipAt, deleteLane, laneHasContent, sceneHasContent, deleteScene,
  type SessionState, type SessionLane, type SessionClip, type ClipSlot,
} from './session';
```

2. Extend the `./session-runtime` import to add `buildSceneFromPlaying`:

```ts
import {
  launchClip, launchScene, stopLane, stopAll, emptyLanePlayState, buildSceneFromPlaying,
} from './session-runtime';
```

3. Add a new import for the rehydration helper:

```ts
import { rehydrateLane } from './session-host-persistence';
```

4. Add the three callbacks to the returned object (e.g. right after `onAddLane`, before `onAddStemLanes`):

```ts
    onDuplicateLane(laneId: string) {
      const src = self.state.lanes.find((l) => l.id === laneId);
      if (!src) return;
      const hd = self.deps.historyDeps;
      const run = () => {
        const used = new Set(self.state.lanes.map((l) => l.id));
        const newId = nextLaneSlug(used, src.engineId);
        const clone = duplicateLane(self.state, laneId, newId);
        self.laneStates.set(newId, emptyLanePlayState(newId));
        rehydrateLane(self, clone); // allocate strip+engine, rehydrate inserts/preset/state
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onDuplicateScene(sceneIdx: number) {
      const hd = self.deps.historyDeps;
      const run = () => { duplicateScene(self.state, sceneIdx); self.renderWithMixer(); };
      if (hd) withUndo(hd, run); else run();
    },
    onCaptureScene() {
      // Build BEFORE withUndo so an empty capture (nothing playing) commits nothing.
      const scene = buildSceneFromPlaying(self.state, self.laneStates);
      if (!scene) return;
      const hd = self.deps.historyDeps;
      const run = () => { self.state.scenes.push(scene); self.renderWithMixer(); };
      if (hd) withUndo(hd, run); else run();
    },
```

- [ ] **Step 3: Add the public `captureScene()` method**

In `src/session/session-host.ts`, add a public method near `stopAllClips()` (around line 143):

```ts
  /** Append a scene capturing the currently-playing clips. Wired to the toolbar
   *  button and the Ctrl+I hotkey; same path as the Scenes-header button. */
  captureScene(): void {
    this.callbacks.onCaptureScene();
  }
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If tsc reports another full `SessionUICallbacks` object literal elsewhere missing the three keys, add them there as the same handlers / no-op stubs — search `: SessionUICallbacks` and `renderSessionGrid(`.)

- [ ] **Step 5: Commit**

```bash
git add src/session/session-ui.ts src/session/session-host-callbacks.ts src/session/session-host.ts
git commit -m "feat(session): duplicate-lane/scene + capture-scene host callbacks"
```

---

### Task 6: Context-menu items + Scenes-header Capture button

**Files:**
- Modify: `src/session/session-ui.ts` (`laneHeader`, `sceneLaunchCell`, `scenesHeader`)

**Interfaces:**
- Consumes: `cb.onDuplicateLane`, `cb.onDuplicateScene`, `cb.onCaptureScene` (Task 5), existing `openContextMenu`.
- Produces: UI only (no new exports).

- [ ] **Step 1: Add "Duplicate track" to the lane-header context menu**

In `laneHeader` (~line 178), change the `openContextMenu` items array to:

```ts
    openContextMenu(e, [
      { label: 'Edit instrument', onSelect: () => cb.onEditLane(lane.id) },
      { label: 'Duplicate track', onSelect: () => cb.onDuplicateLane(lane.id) },
      { label: 'Stop track', onSelect: () => cb.onStopLane(lane.id) },
      { label: 'Delete track', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteLane(lane.id) },
    ]),
```

- [ ] **Step 2: Add "Duplicate scene" + "Capture playing → scene" to the scene-cell context menu**

In `sceneLaunchCell` (~line 284), change the items array to:

```ts
      openContextMenu(e, [
        { label: 'Launch scene', onSelect: () => cb.onLaunchScene(idx) },
        { label: 'Duplicate scene', onSelect: () => cb.onDuplicateScene(idx) },
        { label: 'Capture playing → scene', onSelect: () => cb.onCaptureScene() },
        { label: 'Add scene', onSelect: () => cb.onAddScene() },
        { label: 'Delete scene', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteScene(idx) },
      ]),
```

- [ ] **Step 3: Add a Capture button to the Scenes column header**

In `scenesHeader()` (nested in `renderSessionGrid`, ~line 153), replace the function body so it appends a button alongside the label:

```ts
  function scenesHeader() {
    const d = document.createElement('div');
    d.className = 'session-scenes-header';
    const label = document.createElement('span');
    label.textContent = 'Scenes';
    d.appendChild(label);
    const cap = document.createElement('button');
    cap.className = 'session-capture-scene';
    cap.textContent = '⊙';
    cap.title = 'New scene from currently playing clips (Ctrl+I)';
    cap.addEventListener('click', cb.onCaptureScene);
    d.appendChild(cap);
    return d;
  }
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-ui.ts
git commit -m "feat(session-ui): duplicate-track/scene context items + Scenes Capture button"
```

---

### Task 7: Toolbar button + Ctrl+I hotkey

**Files:**
- Modify: `index.html` (add `#capture-scene` button to the session bar)
- Modify: `src/main.ts` (wire click + Ctrl+I; import `isTextEditTarget`)

**Interfaces:**
- Consumes: `sessionHost.captureScene()` (Task 5), `isTextEditTarget` (from `./save/history-wiring`).
- Produces: DOM wiring only.

- [ ] **Step 1: Add the toolbar button**

In `index.html`, in `<div class="row session-bar">`, add after the `#stems-open` button (line 129):

```html
        <button id="capture-scene" class="io" title="Capture playing clips into a new scene (Ctrl+I)">&#8857; Capture</button>
```

- [ ] **Step 2: Import `isTextEditTarget`**

In `src/main.ts`, the existing multi-line import from `./save/history-wiring` (ends at line 40) — add `isTextEditTarget` to its named imports. For example if it reads:

```ts
import {
  wireHistoryKeyboard, withUndo, attachKnobUndo,
} from './save/history-wiring';
```
make it:
```ts
import {
  wireHistoryKeyboard, withUndo, attachKnobUndo, isTextEditTarget,
} from './save/history-wiring';
```
(Keep whatever names are already there; just append `isTextEditTarget`.)

- [ ] **Step 3: Wire the button + hotkey**

In `src/main.ts`, near the existing `copyBtn` wiring (line 626-627), add:

```ts
document.getElementById('capture-scene')?.addEventListener('click', () => sessionHost.captureScene());

// Ctrl/Cmd+I — capture currently-playing clips into a new scene. Skip while
// typing in a text field so it never steals input from BPM / save-name inputs.
document.addEventListener('keydown', (e) => {
  if (isTextEditTarget(e.target)) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() !== 'i') return;
  e.preventDefault();
  sessionHost.captureScene();
});
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (tsc + bundle), no errors.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(transport): Capture-scene toolbar button + Ctrl+I hotkey"
```

---

### Task 8: Full verification + live check

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm run test:unit`
Expected: PASS. (If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` *after* all tests pass, that's the known flaky teardown — re-run to confirm green.)

- [ ] **Step 2: Production build (required before any e2e / live serve)**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Live visual check** (manual — required for UI per CLAUDE.md "load it and LOOK")

Start the dev server (`npm run dev`) and at <http://localhost:5173> verify EACH path independently (one check per user path):

1. **Duplicate track:** right-click a lane header → "Duplicate track". A new lane appears immediately to its right with the same name + " copy", the same instrument/preset, and copies of all its clips. Existing playback keeps going (nothing stops).
2. **Duplicate scene:** right-click a scene cell → "Duplicate scene". A new scene row appears at the bottom; launching it plays the same clips as the source scene.
3. **Capture (Scenes header button):** launch a couple of clips on different lanes, click the **⊙** button in the Scenes header. A new scene appears at the bottom; launching it relaunches exactly those clips; idle lanes are untouched.
4. **Capture (toolbar button):** same as #3 via the **⊙ Capture** button in the session bar.
5. **Capture (Ctrl+I):** same as #3 via the keyboard. Confirm Ctrl+I does NOT fire while focus is in the BPM input (type in BPM, press Ctrl+I → no scene added).
6. **Capture with nothing playing:** stop all, press Ctrl+I → no scene is added (silent no-op).
7. **Undo:** after each of the above, Ctrl+Z reverts it (the duplicated lane/scene disappears; for the lane, its audio resource is released).

- [ ] **Step 4: Report results** (no commit — verification task). If any path fails, fix it under the relevant task before finishing.

---

## Self-Review

**Spec coverage:**
- Duplicate lane (full clone, fresh ids, right-of-source, scene mirror) → Task 1 + Task 5 + Task 6 + Task 7(undo) ✓
- Duplicate scene (resolved clipPerLane, append) → Task 2 + Task 5 + Task 6 ✓
- Capture from playing (idle→null, nothing→null) → Task 3 + Task 5 ✓
- Capture button in Scenes header → Task 6 ✓; in session toolbar → Task 7 ✓; Ctrl+I → Task 7 ✓
- Context-menu items → Task 6 ✓
- Per-lane rehydration (ensureLaneResource + inserts + preset + engineState) → Task 4 + Task 5 ✓
- Undo for all three (no playback stop on duplicate) → withUndo in Task 5; verified Task 8 ✓
- English strings → Tasks 6, 7 ✓
- Pure Vitest tests → Tasks 1-3 ✓

**Placeholder scan:** none — every code step shows complete code; every run step shows the command + expected result.

**Type consistency:** `duplicateLane(state, srcLaneId, newId): SessionLane`, `duplicateScene(state, sceneIdx): SessionScene|null`, `buildSceneFromPlaying(state, laneStates): SessionScene|null`, `rehydrateLane(self, lane)`, `applyEngineStateForLane(self, lane)`, `SessionHost.captureScene()`, callbacks `onDuplicateLane/onDuplicateScene/onCaptureScene` — names and signatures are used identically across Tasks 1-7.
