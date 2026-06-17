# Clip Context Breadcrumb + In-Place Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the open clip's identity unmistakable in the bottom editor (Track ▸ Scene ▸ Clip breadcrumb) and make track/scene/clip names editable in place everywhere they appear, with the open clip ringed in the session grid.

**Architecture:** A pure `resolveClipContext` helper derives the breadcrumb text from a `(laneId, clipIdx)` selection. A small DOM helper `beginInlineRename` powers in-place editing for track, scene, and clip names. The session grid (`session-ui.ts`) gains optional rename callbacks + an `openClip` highlight; the inspector (`session-inspector.ts` + `index.html`) gains a context header above the existing controls; the host (`session-host*.ts`) implements the rename callbacks and feeds the open selection to the grid.

**Tech Stack:** TypeScript, Web Audio, Vite, Vitest (env `node` by default; DOM tests opt into `jsdom` via a `// @vitest-environment jsdom` header), SCSS.

**Spec:** [docs/superpowers/specs/2026-06-17-clip-context-breadcrumb-design.md](../specs/2026-06-17-clip-context-breadcrumb-design.md)
**Mockup:** [docs/superpowers/specs/2026-06-17-clip-context-breadcrumb-mockup.html](../specs/2026-06-17-clip-context-breadcrumb-mockup.html)

## Global Constraints

- **No saved-state schema change.** `clip.name`, `lane.name`, `scene.name` already exist and persist.
- **UI strings in English** (project convention): "Rename track", "Rename scene", "editing", "Track", "Scene", "Clip", fallbacks `Clip {N}` / `Scene {N}`.
- **Test assertions are relative / structural** — assert classes, fired callbacks, and exact name strings; never DSP magnitudes (no DSP here).
- **Work happens in the worktree** `.claude/worktrees/clip-context-breadcrumb` on branch `feat/clip-context-breadcrumb` (already created from `main` HEAD). Rebase onto `main` around each commit.
- **Commit message footer** (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run single-file tests as `NO_COLOR=1 npx vitest run <path>`; the full unit suite as `npm run test:unit`.

---

### Task 1: `resolveClipContext` pure helper

Derives the breadcrumb's display strings from a selection. Lives in `session.ts` (home of the other pure session helpers like `deleteScene`, `canDropClip`).

**Files:**
- Modify: `src/session/session.ts` (add the exported function near the other helpers, after `deleteScene`)
- Test: `src/session/clip-context.test.ts` (create)

**Interfaces:**
- Produces: `resolveClipContext(state: SessionState, laneId: string, clipIdx: number): { lane: SessionLane; clip: SessionClip; trackName: string; sceneName: string; rowNumber: number; clipName: string } | null`

- [ ] **Step 1: Write the failing test**

Create `src/session/clip-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveClipContext, type SessionState } from './session';

function makeState(): SessionState {
  return {
    lanes: [
      { id: 'bass', engineId: 'tb303', name: 'BASS', clips: [
        { id: 'c0', lengthBars: 1, notes: [] },
        { id: 'c1', name: 'Acid line', lengthBars: 1, notes: [] },
      ] },
      { id: 'lead', engineId: 'subtractive', clips: [] },
    ],
    scenes: [
      { id: 's0', name: 'Intro', clipPerLane: {} },
      { id: 's1', clipPerLane: {} }, // unnamed → falls back to "Scene 2"
    ],
    globalQuantize: '1/1',
  };
}

describe('resolveClipContext', () => {
  it('resolves track name, scene fallback, row number, and clip name', () => {
    const ctx = resolveClipContext(makeState(), 'bass', 1)!;
    expect(ctx.trackName).toBe('BASS');
    expect(ctx.sceneName).toBe('Scene 2');
    expect(ctx.rowNumber).toBe(2);
    expect(ctx.clipName).toBe('Acid line');
  });

  it('falls back: track→ID upper-cased, clip→"Clip N"; named scene kept', () => {
    const st = makeState();
    st.lanes[1].clips = [{ id: 'lc0', lengthBars: 1, notes: [] }];
    const ctx = resolveClipContext(st, 'lead', 0)!;
    expect(ctx.trackName).toBe('LEAD');
    expect(ctx.clipName).toBe('Clip 1');
    expect(ctx.sceneName).toBe('Intro');
  });

  it('returns null when the lane or clip is missing', () => {
    expect(resolveClipContext(makeState(), 'nope', 0)).toBeNull();
    expect(resolveClipContext(makeState(), 'lead', 0)).toBeNull(); // lane exists, no clip
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/clip-context.test.ts`
Expected: FAIL — `resolveClipContext is not a function` (not exported yet).

- [ ] **Step 3: Implement the helper**

In `src/session/session.ts`, add after the `deleteScene` helper (search for `export function deleteScene`):

```ts
/** Resolve the display context for a clip at (laneId, clipIdx): the track,
 *  scene (the scene on the clip's OWN row — matches default scene launch), row
 *  number, and the three display names with their fallbacks. Pure; returns null
 *  when the lane or clip is absent. Used by the inspector's context breadcrumb. */
export function resolveClipContext(
  state: SessionState,
  laneId: string,
  clipIdx: number,
): {
  lane: SessionLane;
  clip: SessionClip;
  trackName: string;
  sceneName: string;
  rowNumber: number;
  clipName: string;
} | null {
  const lane = state.lanes.find((l) => l.id === laneId);
  const clip = lane?.clips[clipIdx];
  if (!lane || !clip) return null;
  // `?.` guards against test fixtures that omit `scenes`; production always has it.
  const scene = state.scenes?.[clipIdx];
  return {
    lane,
    clip,
    trackName: lane.name ?? lane.id.toUpperCase(),
    sceneName: scene?.name ?? `Scene ${clipIdx + 1}`,
    rowNumber: clipIdx + 1,
    clipName: clip.name ?? `Clip ${clipIdx + 1}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/clip-context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/clip-context.test.ts
git commit -m "feat(session): resolveClipContext helper for clip breadcrumb

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `beginInlineRename` DOM helper

Shared in-place editor: swap a label element for an `<input>`, commit on Enter/blur, cancel on Escape. Used by the grid (track/scene) and the inspector (track/scene from the breadcrumb).

**Files:**
- Create: `src/session/inline-rename.ts`
- Test: `src/session/inline-rename.test.ts`

**Interfaces:**
- Produces: `beginInlineRename(labelEl: HTMLElement, currentValue: string, opts: { commit: (value: string) => void; placeholder?: string }): HTMLInputElement` — inserts `<input class="inline-rename-input">` after `labelEl`, hides the label, focuses+selects. Commits the trimmed value (only when non-empty AND changed) on Enter/blur; Escape cancels. The input stops `pointerdown`/`click` propagation so it never triggers an underlying drag/launch.

- [ ] **Step 1: Write the failing test**

Create `src/session/inline-rename.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { beginInlineRename } from './inline-rename';

function mountLabel(text: string): HTMLElement {
  document.body.innerHTML = `<div class="parent"><span class="lbl">${text}</span></div>`;
  return document.querySelector('.lbl') as HTMLElement;
}

describe('beginInlineRename', () => {
  it('Enter commits the trimmed new value and removes the input', () => {
    const label = mountLabel('Old');
    const commit = vi.fn();
    const input = beginInlineRename(label, 'Old', { commit });
    input.value = '  New  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(commit).toHaveBeenCalledWith('New');
    expect(document.querySelector('.inline-rename-input')).toBeNull();
    expect(label.style.display).toBe('');
  });

  it('Escape cancels without committing', () => {
    const label = mountLabel('Old');
    const commit = vi.fn();
    const input = beginInlineRename(label, 'Old', { commit });
    input.value = 'New';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector('.inline-rename-input')).toBeNull();
  });

  it('blur commits the changed value', () => {
    const label = mountLabel('Old');
    const commit = vi.fn();
    const input = beginInlineRename(label, 'Old', { commit });
    input.value = 'Changed';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(commit).toHaveBeenCalledWith('Changed');
  });

  it('does not commit an unchanged or empty value', () => {
    const label = mountLabel('Same');
    const c1 = vi.fn();
    beginInlineRename(label, 'Same', { commit: c1 })
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c1).not.toHaveBeenCalled();

    const label2 = mountLabel('X');
    const c2 = vi.fn();
    const input2 = beginInlineRename(label2, 'X', { commit: c2 });
    input2.value = '   ';
    input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c2).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/inline-rename.test.ts`
Expected: FAIL — cannot find module `./inline-rename`.

- [ ] **Step 3: Implement the helper**

Create `src/session/inline-rename.ts`:

```ts
// Shared in-place rename: replace a label element with a text <input>, commit on
// Enter/blur, cancel on Escape. Used by the session grid (track/scene names) and
// the clip inspector's context breadcrumb. The caller's `commit` is expected to
// mutate state + re-render (which rebuilds the label); on cancel/no-change the
// original label is simply re-shown.

export interface InlineRenameOptions {
  /** Fired with the trimmed value on Enter/blur — only when non-empty AND
   *  different from `currentValue`. */
  commit: (value: string) => void;
  placeholder?: string;
}

export function beginInlineRename(
  labelEl: HTMLElement,
  currentValue: string,
  opts: InlineRenameOptions,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename-input';
  input.value = currentValue;
  if (opts.placeholder) input.placeholder = opts.placeholder;

  const parent = labelEl.parentElement;
  labelEl.style.display = 'none';
  // Insert right after the hidden label so it occupies the same slot.
  if (parent) parent.insertBefore(input, labelEl.nextSibling);
  else labelEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    labelEl.style.display = '';
    if (commit && v && v !== currentValue) opts.commit(v);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    // Keep typing from reaching global shortcuts (e.g. clip Delete/Backspace).
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  // Never let the editor's pointer events bubble to an underlying drag/launch.
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());

  return input;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/inline-rename.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/inline-rename.ts src/session/inline-rename.test.ts
git commit -m "feat(session): beginInlineRename in-place editor helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Grid `openClip` highlight + rename callback types

Add the optional rename callbacks to the grid's callback interface and an optional `openClip` param to `renderSessionGrid`; ring the open clip's cell and tint its row. (The dblclick/menu wiring is Task 4; making the callbacks optional keeps `buildSessionCallbacks` compiling until Task 5.)

**Files:**
- Modify: `src/session/session-ui.ts` (the `SessionUICallbacks` interface; `renderSessionGrid` signature + row/cell loop; `clipCell` signature)
- Test: `src/session/session-ui-rename.test.ts` (create — extended in Task 4)

**Interfaces:**
- Consumes: `ClipSlot` (already imported from `./session`).
- Produces:
  - `SessionUICallbacks.onRenameLane?: (laneId: string, name: string) => void`
  - `SessionUICallbacks.onRenameScene?: (sceneIdx: number, name: string) => void`
  - `renderSessionGrid(host, state, laneStates, cb, openClip?: ClipSlot)`
  - Cell matching `openClip` gets class `session-cell-editing`; its row gets `session-row-editing`.

- [ ] **Step 1: Write the failing test**

Create `src/session/session-ui-rename.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderSessionGrid, type SessionUICallbacks } from './session-ui';
import type { SessionState } from './session';
import type { LanePlayState } from './session-runtime';

export function makeState(): SessionState {
  return {
    lanes: [{ id: 'bass', engineId: 'tb303', name: 'BASS', clips: [{ id: 'c0', lengthBars: 1, notes: [] }] }],
    scenes: [{ id: 's0', name: 'Intro', clipPerLane: {} }],
    globalQuantize: '1/1',
  };
}

export function noopCallbacks(over: Partial<SessionUICallbacks> = {}): SessionUICallbacks {
  return {
    onClipClick() {}, onClipPlayPause() {}, onCellClick() {}, onMoveClip() {},
    onStopLane() {}, onLaunchScene() {}, onStopAll() {}, onAddScene() {}, onAddLane() {},
    onAddStemLanes() {}, onAddClipRow() {}, onEditLane() {}, onDeleteClip() {},
    onDeleteLane() {}, onDeleteScene() {}, onToggleDrumsExpanded() {},
    ...over,
  };
}

describe('open-clip highlight', () => {
  it('rings exactly the open clip cell and tints its row', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map<string, LanePlayState>(), noopCallbacks(), { laneId: 'bass', clipIdx: 0 });
    const cell = host.querySelector('.session-cell[data-lane-id="bass"][data-clip-idx="0"]');
    expect(cell?.classList.contains('session-cell-editing')).toBe(true);
    expect(host.querySelectorAll('.session-cell-editing').length).toBe(1);
    expect(host.querySelectorAll('.session-row-editing').length).toBe(1);
  });

  it('rings nothing when no clip is open', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map<string, LanePlayState>(), noopCallbacks());
    expect(host.querySelectorAll('.session-cell-editing').length).toBe(0);
    expect(host.querySelectorAll('.session-row-editing').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-rename.test.ts`
Expected: FAIL — `renderSessionGrid` ignores the 5th arg / no `session-cell-editing` class.

- [ ] **Step 3: Add the interface fields + signature + highlight**

In `src/session/session-ui.ts`:

3a. Add the optional callbacks to the `SessionUICallbacks` interface (next to `onDeleteScene`):

```ts
  onDeleteScene: (sceneIdx: number) => void;
  /** Rename a track / scene in place. Optional so test fixtures + the host
   *  (which wires them in a later task) compile independently. */
  onRenameLane?: (laneId: string, name: string) => void;
  onRenameScene?: (sceneIdx: number, name: string) => void;
```

3b. Add the `openClip` param to `renderSessionGrid` (the signature currently ends with `cb: SessionUICallbacks,`):

```ts
export function renderSessionGrid(
  host: HTMLElement,
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  openClip?: ClipSlot,
): void {
```

3c. In the row loop (currently `for (let r = 0; r < rowCount; r++) { ... }`), tag the open row and pass `openClip` into `clipCell`:

```ts
  for (let r = 0; r < rowCount; r++) {
    const row = document.createElement('div');
    row.className = 'session-row';
    if (openClip && openClip.clipIdx === r) row.classList.add('session-row-editing');
    const rowLabel = document.createElement('div');
    rowLabel.className = 'session-row-label';
    rowLabel.textContent = String(r + 1);
    row.appendChild(rowLabel);
    for (const lane of state.lanes) row.appendChild(clipCell(lane, r, laneStates, cb, state, openClip));
    row.appendChild(sceneLaunchCell(state.scenes[r], r, cb));
    table.appendChild(row);
  }
```

3d. Extend `clipCell`'s signature + ring the matching cell. Change its declaration to accept `openClip` and, inside the `if (clip) { ... }` block (right after `cell.classList.add('session-cell-filled');`), add the editing class:

```ts
function clipCell(
  lane: SessionLane,
  rowIdx: number,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  state: SessionState,
  openClip?: ClipSlot,
): HTMLElement {
```

and inside the filled branch:

```ts
  if (clip) {
    cell.classList.add('session-cell-filled');
    if (openClip && openClip.laneId === lane.id && openClip.clipIdx === rowIdx) {
      cell.classList.add('session-cell-editing');
    }
    if (isPlaying) cell.classList.add('session-cell-playing');
    // ...rest unchanged...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-rename.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck (no regressions from the signature change)**

Run: `npx tsc --noEmit`
Expected: no errors (the existing `renderSessionGrid(...)` call in `session-host.ts` omits the new optional arg; `buildSessionCallbacks` is unaffected because the new callbacks are optional).

- [ ] **Step 6: Commit**

```bash
git add src/session/session-ui.ts src/session/session-ui-rename.test.ts
git commit -m "feat(session-ui): ring the open clip + optional rename callbacks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: In-place rename of tracks & scenes in the grid

Wire double-click + context-menu rename onto the lane header name and the scene button name, using `beginInlineRename`. Restructure the scene button so the name is a dedicated span (the `▶` stays the launch affordance; clicking the name no longer launches).

**Files:**
- Modify: `src/session/session-ui.ts` (`laneHeader`, `sceneLaunchCell`; import `beginInlineRename`)
- Test: `src/session/session-ui-rename.test.ts` (append)

**Interfaces:**
- Consumes: `beginInlineRename` (Task 2); `cb.onRenameLane` / `cb.onRenameScene` (Task 3).
- Produces: lane name element class `session-lane-name`; scene name element class `session-scene-name`; scene launch icon class `session-scene-play`.

- [ ] **Step 1: Write the failing tests (append to the file)**

Append to `src/session/session-ui-rename.test.ts` (`vi`, `makeState`, `noopCallbacks`, and `renderSessionGrid` are already in scope from the top of the file):

```ts
describe('grid in-place rename', () => {
  it('double-clicking the lane name commits via onRenameLane', () => {
    const host = document.createElement('div');
    const onRenameLane = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onRenameLane }));
    const nameEl = host.querySelector('.session-lane-name') as HTMLElement;
    nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = host.querySelector('.inline-rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'Reese';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRenameLane).toHaveBeenCalledWith('bass', 'Reese');
  });

  it('double-clicking the scene name commits via onRenameScene', () => {
    const host = document.createElement('div');
    const onRenameScene = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onRenameScene }));
    const nameEl = host.querySelector('.session-scene-name') as HTMLElement;
    nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = host.querySelector('.inline-rename-input') as HTMLInputElement;
    input.value = 'Drop';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRenameScene).toHaveBeenCalledWith(0, 'Drop');
  });

  it('clicking the scene name does NOT launch the scene', () => {
    const host = document.createElement('div');
    const onLaunchScene = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onLaunchScene }));
    const nameEl = host.querySelector('.session-scene-name') as HTMLElement;
    nameEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onLaunchScene).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-rename.test.ts`
Expected: FAIL — `.session-scene-name` does not exist; dblclick does nothing.

- [ ] **Step 3: Import the helper**

At the top of `src/session/session-ui.ts`, add to the imports:

```ts
import { beginInlineRename } from './inline-rename';
```

- [ ] **Step 4: Add rename to `laneHeader`**

In `laneHeader`, the name element is created as:

```ts
  const name = document.createElement('div');
  name.className = 'session-lane-name';
  name.textContent = lane.name ?? lane.id.toUpperCase();
  el.appendChild(name);
```

Add a double-click handler immediately after appending it:

```ts
  name.title = 'Double-click to rename';
  name.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    beginInlineRename(name, lane.name ?? lane.id.toUpperCase(), {
      commit: (v) => cb.onRenameLane?.(lane.id, v),
    });
  });
```

And add a "Rename track" item to the existing lane `contextmenu` (first item, before "Edit instrument"):

```ts
  el.addEventListener('contextmenu', (e) =>
    openContextMenu(e, [
      { label: 'Rename track', onSelect: () => beginInlineRename(name, lane.name ?? lane.id.toUpperCase(), { commit: (v) => cb.onRenameLane?.(lane.id, v) }) },
      { label: 'Edit instrument', onSelect: () => cb.onEditLane(lane.id) },
      { label: 'Stop track', onSelect: () => cb.onStopLane(lane.id) },
      { label: 'Delete track', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteLane(lane.id) },
    ]),
  );
```

- [ ] **Step 5: Restructure `sceneLaunchCell` with a name span + rename**

Replace the body of `sceneLaunchCell` (the `if (scene) { ... }` block that builds the `btn`) so the button holds a `▶` icon span and a `.session-scene-name` span, the name carries the rename, and clicking the name does not launch:

```ts
function sceneLaunchCell(scene: { name?: string } | undefined, idx: number, cb: SessionUICallbacks): HTMLElement {
  const el = document.createElement('div');
  el.className = 'session-scene-cell';
  if (scene) {
    el.appendChild(deleteCross('Delete scene', () => cb.onDeleteScene(idx)));
    const btn = document.createElement('button');
    btn.className = 'session-scene-launch';
    btn.addEventListener('click', () => cb.onLaunchScene(idx));

    const play = document.createElement('span');
    play.className = 'session-scene-play';
    play.textContent = '▶';
    btn.appendChild(play);

    const name = document.createElement('span');
    name.className = 'session-scene-name';
    name.textContent = scene.name ?? `Scene ${idx + 1}`;
    name.title = 'Double-click to rename';
    // The name area is a rename target, not a launch target: swallow its click
    // so single-clicking the name never launches the scene (launch via ▶).
    name.addEventListener('click', (e) => e.stopPropagation());
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      beginInlineRename(name, scene.name ?? `Scene ${idx + 1}`, {
        commit: (v) => cb.onRenameScene?.(idx, v),
      });
    });
    btn.appendChild(name);
    el.appendChild(btn);

    el.addEventListener('contextmenu', (e) =>
      openContextMenu(e, [
        { label: 'Rename scene', onSelect: () => beginInlineRename(name, scene.name ?? `Scene ${idx + 1}`, { commit: (v) => cb.onRenameScene?.(idx, v) }) },
        { label: 'Launch scene', onSelect: () => cb.onLaunchScene(idx) },
        { label: 'Add scene', onSelect: () => cb.onAddScene() },
        { label: 'Delete scene', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteScene(idx) },
      ]),
    );
  } else {
    el.classList.add('session-scene-cell-empty');
  }
  return el;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-rename.test.ts`
Expected: PASS (all tests, incl. Task 3's).

- [ ] **Step 7: Commit**

```bash
git add src/session/session-ui.ts src/session/session-ui-rename.test.ts
git commit -m "feat(session-ui): double-click + context-menu rename for tracks & scenes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Host wiring — rename callback impls + feed open clip to the grid

Implement `onRenameLane` / `onRenameScene` (undoable) in the callbacks factory, and make `SessionHost.render()` pass the inspector's open selection to the grid.

**Files:**
- Modify: `src/session/session-host-callbacks.ts` (add the two handlers to the returned object)
- Modify: `src/session/session-host.ts` (`render()` passes `openClip`)
- Test: `src/session/session-host-rename.test.ts` (create)

**Interfaces:**
- Consumes: `SessionUICallbacks.onRenameLane/onRenameScene` (Task 3); `SessionInspector.getSelectedClip()` (exists).
- Produces: `cb.onRenameLane(laneId, name)` sets `lane.name = name || undefined`; `cb.onRenameScene(idx, name)` sets `scene.name = name || undefined`; both wrapped in `withUndo` and call `self.renderWithMixer()`.

- [ ] **Step 1: Write the failing test**

Create `src/session/session-host-rename.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildSessionCallbacks } from './session-host-callbacks';
import type { SessionState } from './session';

function makeSelf() {
  const state: SessionState = {
    lanes: [{ id: 'bass', engineId: 'tb303', name: 'BASS', clips: [] }],
    scenes: [{ id: 's0', name: 'Intro', clipPerLane: {} }],
    globalQuantize: '1/1',
  };
  const renderWithMixer = vi.fn();
  // buildSessionCallbacks only destructures these four from deps at the top and,
  // for the rename handlers, reads self.state / self.deps.historyDeps /
  // self.renderWithMixer — so a minimal fake suffices.
  const self = {
    deps: { ctx: {}, seq: {}, playBtn: null, resetAutomationPosition: () => {}, historyDeps: undefined },
    state,
    laneStates: new Map(),
    renderWithMixer,
  } as unknown as import('./session-host').SessionHost;
  return { self, state, renderWithMixer };
}

describe('rename callbacks', () => {
  it('onRenameScene sets the scene name and re-renders', () => {
    const { self, state, renderWithMixer } = makeSelf();
    buildSessionCallbacks(self).onRenameScene!(0, 'Drop');
    expect(state.scenes[0].name).toBe('Drop');
    expect(renderWithMixer).toHaveBeenCalled();
  });

  it('onRenameLane sets the lane name and re-renders', () => {
    const { self, state, renderWithMixer } = makeSelf();
    buildSessionCallbacks(self).onRenameLane!('bass', 'Reese');
    expect(state.lanes[0].name).toBe('Reese');
    expect(renderWithMixer).toHaveBeenCalled();
  });

  it('an empty name clears back to undefined', () => {
    const { self, state } = makeSelf();
    buildSessionCallbacks(self).onRenameLane!('bass', '');
    expect(state.lanes[0].name).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-rename.test.ts`
Expected: FAIL — `onRenameScene` / `onRenameLane` is undefined on the returned callbacks.

- [ ] **Step 3: Implement the handlers in `buildSessionCallbacks`**

In `src/session/session-host-callbacks.ts`, add these two handlers to the returned object (e.g. right after the `onDeleteScene` handler):

```ts
    onRenameLane(laneId, name) {
      const hd = self.deps.historyDeps;
      const run = () => {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane) return;
        lane.name = name || undefined;
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onRenameScene(sceneIdx, name) {
      const hd = self.deps.historyDeps;
      const run = () => {
        const scene = self.state.scenes[sceneIdx];
        if (!scene) return;
        scene.name = name || undefined;
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
```

(`withUndo` is already imported in this file.)

- [ ] **Step 4: Feed the open clip into the grid**

In `src/session/session-host.ts`, replace `private render()`:

```ts
  private render(): void {
    const hostEl = document.getElementById('session-grid');
    if (!hostEl) return;
    // Ring the clip currently open in the inspector (only while its panel is shown).
    const panel = document.getElementById('session-inspector');
    const openClip = (panel && !panel.hidden)
      ? (this.inspector.getSelectedClip() ?? undefined)
      : undefined;
    renderSessionGrid(hostEl, this.state, this.laneStates, this.callbacks, openClip);
  }
```

- [ ] **Step 5: Run the test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-rename.test.ts`
Expected: PASS (3 tests).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/session/session-host-callbacks.ts src/session/session-host.ts src/session/session-host-rename.test.ts
git commit -m "feat(session-host): wire track/scene rename + feed open clip to the grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Inspector context breadcrumb (HTML + render + header rename)

Add the context header markup to `index.html`, relocate the clip-name input into it, and render Track ▸ Scene ▸ Clip with inline rename of track/scene from the header.

**Files:**
- Modify: `index.html` (`#session-inspector` block)
- Modify: `src/session/session-inspector.ts` (import `beginInlineRename` + `resolveClipContext`; add `renderContextHeader` + `refreshContextHeader` + `commitTrackName`/`commitSceneName`; call from `openInspector`)
- Test: `src/session/session-inspector-context.test.ts` (create)

**Interfaces:**
- Consumes: `resolveClipContext` (Task 1), `beginInlineRename` (Task 2), `SessionScene`/`SessionLane` (exist).
- DOM ids added: `insp-context`, `insp-context-swatch`, `insp-context-track`, `insp-context-scene`, `insp-context-row`. The clip-name input keeps id `insp-name` (now inside the breadcrumb).

- [ ] **Step 1: Restructure the inspector markup**

In `index.html`, replace the current `#insp-transport-row` (the `<div id="insp-transport-row" ...>` … `</div>` that contains the Name/Length/Launch/Duplicate/Delete) with the breadcrumb header FOLLOWED by the transport row WITHOUT the Name field:

```html
          <div id="insp-context" class="clip-context">
            <div class="ctx-seg">
              <span class="ctx-kind">Track</span>
              <span id="insp-context-swatch" class="ctx-swatch"></span>
              <span id="insp-context-track" class="ctx-track-name" title="Double-click to rename"></span>
            </div>
            <span class="ctx-sep">▸</span>
            <div class="ctx-seg">
              <span class="ctx-kind">Scene</span>
              <span id="insp-context-scene" class="ctx-scene-name" title="Double-click to rename"></span>
              <span id="insp-context-row" class="ctx-row"></span>
            </div>
            <span class="ctx-sep">▸</span>
            <div class="ctx-seg ctx-clip-seg">
              <span class="ctx-kind">Clip</span>
              <input id="insp-name" type="text" class="ctx-clip-name" placeholder="Clip name" />
              <span class="ctx-editing">editing</span>
            </div>
          </div>
          <div id="insp-transport-row" class="clip-transport-row">
            <label>Length (bars) <input id="insp-length" type="number" min="1" step="1" /></label>
            <label>Launch
              <select id="insp-quantize">
                <option value="">Default (lane/global)</option>
                <option value="immediate">Immediate</option>
                <option value="1/4">1/4</option>
                <option value="1/2">1/2</option>
                <option value="1/1">1 bar</option>
                <option value="2/1">2 bars</option>
                <option value="4/1">4 bars</option>
              </select>
            </label>
            <button class="rnd" id="insp-duplicate">Duplicate</button>
            <button class="rnd" id="insp-delete">Delete</button>
          </div>
```

(The `#insp-edit-row` and `#insp-roll-host` blocks below are unchanged.)

- [ ] **Step 2: Write the failing test**

Create `src/session/session-inspector-context.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same stubs as session-inspector.test.ts: the canvas editor + automation lanes
// are unsafe under jsdom; examples must not fetch.
const rollMock = vi.hoisted(() => ({ redraw: () => {}, getOctaveBase: () => 60, setOctaveBase: vi.fn() }));
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: () => rollMock,
}));
vi.mock('./clip-automation-lanes', () => ({ renderClipAutomationLanes: () => {} }));
vi.mock('./example-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./example-loader')>()),
  loadAllExamples: async () => [],
}));

import { SessionInspector } from './session-inspector';
import type { SessionState, SessionClip, SessionLane } from './session';

function mountDom(): void {
  document.body.innerHTML = `
    <div id="session-inspector" hidden>
      <div id="insp-context">
        <span id="insp-context-swatch"></span>
        <span id="insp-context-track"></span>
        <span id="insp-context-scene"></span>
        <span id="insp-context-row"></span>
      </div>
      <input id="insp-name" type="text" />
      <input id="insp-length" type="number" />
      <select id="insp-quantize"><option value=""></option></select>
      <button id="insp-duplicate"></button><button id="insp-delete"></button>
      <button id="insp-copy"></button>
      <button id="insp-paste-replace" disabled></button>
      <button id="insp-paste-layer" disabled></button>
      <button id="insp-random-notes"></button><button id="insp-variate"></button>
      <button id="insp-invert-melodic"></button><button id="insp-retrograde"></button>
      <button id="insp-chords"></button>
      <select id="insp-examples-select"></select>
      <button id="insp-save-example"></button><button id="insp-export-example"></button>
      <button id="insp-toggle-editor"></button>
      <div id="insp-tonality"></div>
      <div id="insp-roll-host"></div>
    </div>`;
}

function makeInspector(over: { renderWithMixer?: () => void } = {}): { state: SessionState; lane: SessionLane } {
  const clip: SessionClip = { id: 'c0', name: 'Acid line', lengthBars: 2, notes: [] } as unknown as SessionClip;
  const lane: SessionLane = { id: 'bass', engineId: 'tb303', name: 'BASS', clips: [clip] } as unknown as SessionLane;
  const state = { lanes: [lane], scenes: [{ id: 's0', name: 'Drop', clipPerLane: {} }] } as unknown as SessionState;
  const insp = new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: over.renderWithMixer ?? (() => {}),
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
  });
  insp.setSelectedClip({ laneId: 'bass', clipIdx: 0 });
  insp.openInspector();
  return { state, lane };
}

describe('inspector context breadcrumb', () => {
  beforeEach(() => mountDom());

  it('shows the track, scene, row, and clip name', () => {
    makeInspector();
    expect(document.getElementById('insp-context-track')!.textContent).toBe('BASS');
    expect(document.getElementById('insp-context-scene')!.textContent).toBe('Drop');
    expect(document.getElementById('insp-context-row')!.textContent).toBe('(row 1)');
    expect((document.getElementById('insp-name') as HTMLInputElement).value).toBe('Acid line');
  });

  it('double-clicking the track name renames the lane', () => {
    const renderWithMixer = vi.fn();
    const { state } = makeInspector({ renderWithMixer });
    const trackEl = document.getElementById('insp-context-track')!;
    trackEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.inline-rename-input') as HTMLInputElement;
    input.value = 'Reese';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(state.lanes[0].name).toBe('Reese');
    expect(renderWithMixer).toHaveBeenCalled();
  });

  it('double-clicking the scene name renames the scene on the clip row', () => {
    const { state } = makeInspector();
    const sceneEl = document.getElementById('insp-context-scene')!;
    sceneEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.inline-rename-input') as HTMLInputElement;
    input.value = 'Verse';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(state.scenes[0].name).toBe('Verse');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-inspector-context.test.ts`
Expected: FAIL — context fields stay empty (no `renderContextHeader` yet).

- [ ] **Step 4: Implement the breadcrumb in `session-inspector.ts`**

4a. Add imports near the top (the file already imports `resolveTonality, DEFAULT_MUSICALITY` from `./session` and `withUndo` from `../save/history-wiring`):

```ts
import { resolveTonality, DEFAULT_MUSICALITY, resolveClipContext } from './session';
import { beginInlineRename } from './inline-rename';
```

(Adjust the existing `./session` import line to add `resolveClipContext`.)

4b. In `openInspector()`, after `this.renderTonalityOverride(lane!);` and before `// Auto-render editor`, add:

```ts
    this.renderContextHeader(lane, clip);
```

4c. Add these private methods to the `SessionInspector` class (e.g. just before `renderEditor`):

```ts
  /** Populate the editor context breadcrumb (Track ▸ Scene ▸ Clip). The clip
   *  name is the relocated #insp-name input (wired in openInspector); here we
   *  fill the track swatch + track/scene labels and wire their inline rename. */
  private renderContextHeader(lane: SessionLane, clip: SessionClip): void {
    if (!this.selectedClip) return;
    const ctx = resolveClipContext(this.deps.state, lane.id, this.selectedClip.clipIdx);
    if (!ctx) return;

    const swatch = document.getElementById('insp-context-swatch');
    if (swatch) swatch.style.background = clip.color ?? '#8a8278';

    const trackEl = document.getElementById('insp-context-track');
    if (trackEl) {
      trackEl.textContent = ctx.trackName;
      trackEl.ondblclick = (e) => {
        e.preventDefault();
        beginInlineRename(trackEl, ctx.trackName, { commit: (v) => this.commitTrackName(lane.id, v) });
      };
    }

    const sceneEl = document.getElementById('insp-context-scene');
    if (sceneEl) {
      sceneEl.textContent = ctx.sceneName;
      sceneEl.ondblclick = (e) => {
        e.preventDefault();
        beginInlineRename(sceneEl, ctx.sceneName, { commit: (v) => this.commitSceneName(this.selectedClip!.clipIdx, v) });
      };
    }

    const rowEl = document.getElementById('insp-context-row');
    if (rowEl) rowEl.textContent = `(row ${ctx.rowNumber})`;
  }

  /** Re-fill the breadcrumb from the current selection (after a rename). */
  private refreshContextHeader(): void {
    if (!this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (lane && clip) this.renderContextHeader(lane, clip);
  }

  private commitTrackName(laneId: string, name: string): void {
    const d = this.deps.historyDeps;
    const run = () => {
      const lane = this.deps.state.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      lane.name = name || undefined;
      this.deps.renderWithMixer();
      this.refreshContextHeader();
    };
    if (d) withUndo(d, run); else run();
  }

  private commitSceneName(sceneIdx: number, name: string): void {
    const d = this.deps.historyDeps;
    const run = () => {
      const scene = this.deps.state.scenes[sceneIdx];
      if (!scene) return;
      scene.name = name || undefined;
      this.deps.renderWithMixer();
      this.refreshContextHeader();
    };
    if (d) withUndo(d, run); else run();
  }
```

- [ ] **Step 5: Run the new test + the existing inspector test (no regression)**

Run: `NO_COLOR=1 npx vitest run src/session/session-inspector-context.test.ts src/session/session-inspector.test.ts`
Expected: PASS (new file 3 tests; existing inspector tests still green — `resolveClipContext` tolerates the existing fixtures' missing `scenes` via `?.`, and the breadcrumb getters are guarded).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add index.html src/session/session-inspector.ts src/session/session-inspector-context.test.ts
git commit -m "feat(inspector): clip context breadcrumb with in-place track/scene rename

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Styles, full build, and visual parity

Style the breadcrumb + grid highlight + inline-rename input, then build, run the whole suite, and confirm visual parity against the mockup.

**Files:**
- Modify: `src/styles/_session-inspector.scss` (breadcrumb)
- Modify: `src/styles/_session-grid.scss` (open-clip ring, row tint, scene name/▶ layout, `.inline-rename-input`)

- [ ] **Step 1: Breadcrumb styles**

Append to `src/styles/_session-inspector.scss`:

```scss
/* ── Clip context breadcrumb (Track ▸ Scene ▸ Clip) ──────────────────────── */
.clip-context {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 2px 2px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 10px;
}
.ctx-seg { display: flex; align-items: center; gap: 7px; }
.ctx-clip-seg { flex: 1; min-width: 220px; }
.ctx-sep { color: var(--text-faint); }
.ctx-kind {
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-faint);
}
.ctx-swatch {
  width: 11px; height: 11px; border-radius: 2px; flex: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}
.ctx-track-name, .ctx-scene-name {
  font-size: 12px; color: var(--text-dim); letter-spacing: 0.06em;
  cursor: text; border: 1px solid transparent; border-radius: 2px; padding: 2px 5px;
}
.ctx-track-name:hover, .ctx-scene-name:hover { border-color: var(--border); color: var(--text); }
.ctx-row { color: var(--text-faint); font-size: 10px; }
.ctx-clip-name {
  flex: 1;
  background: var(--surface-3); border: 1px solid var(--border); border-radius: 2px;
  color: var(--text); font-family: var(--mono); font-size: 14px; padding: 5px 8px; letter-spacing: 0.04em;
}
.ctx-clip-name:focus { outline: none; border-color: var(--amber); }
.ctx-editing {
  font-size: 9px; color: var(--amber); border: 1px solid var(--amber); border-radius: 2px;
  padding: 2px 6px; letter-spacing: 0.1em; text-transform: uppercase;
}
```

- [ ] **Step 2: Grid highlight + scene name layout + inline input**

In `src/styles/_session-grid.scss`, add the open-clip ring **immediately before** the `.session-cell-playing` rule (so the red playing outline overrides it when a clip is both open and playing):

```scss
.session-cell-editing {
  outline: 2px solid var(--amber);
  outline-offset: -2px;
  box-shadow: 0 0 10px var(--amber-glow);
}
```

Add the row tint near the other `.session-row*` rules:

```scss
.session-row-editing { background: var(--amber-glow); }
```

Update the scene launch button to lay out the ▶ + name, replacing the `.session-scene-launch` rule's interior is not needed — just add:

```scss
.session-scene-launch { display: flex; align-items: center; gap: 6px; text-align: left; }
.session-scene-play { opacity: 0.85; flex: none; }
.session-scene-name { flex: 1; }
.session-scene-name:hover { color: var(--amber); }
```

Add the shared inline-rename input (used by grid + breadcrumb):

```scss
.inline-rename-input {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--amber);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: inherit;
  padding: 1px 4px;
  min-width: 60px;
  max-width: 100%;
}
```

- [ ] **Step 3: Build (typecheck + bundle + sass compile)**

Run: `npm run build`
Expected: succeeds — `tsc` clean, Vite bundles, SCSS compiles with no errors.

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:unit`
Expected: all green. (If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` AFTER all tests pass, that's the known flaky teardown — re-run to confirm green.)

- [ ] **Step 5: Visual parity check (mandatory — per the mockup-parity rule)**

Start the dev server and look at the real screen:

```bash
npm run dev
```

Then, against `http://localhost:5173`: switch to the Session view, click a clip to open the editor, and verify against [the mockup](../specs/2026-06-17-clip-context-breadcrumb-mockup.html):
1. The breadcrumb reads `Track ▸ Scene ▸ Clip` with the swatch, names, `(row N)`, the prominent clip-name input, and the `editing` badge.
2. The open clip's cell is ringed in amber and its scene row is tinted.
3. Double-clicking a track name (grid header AND breadcrumb), a scene name (grid AND breadcrumb), and editing the clip name all persist and update everywhere.
4. Right-click → "Rename track" / "Rename scene" enters the same inline edit.
5. Clicking a scene's ▶ still launches it; clicking its name does not.

Capture a screenshot and compare side-by-side. Fix any visual gaps before committing.

- [ ] **Step 6: Commit**

```bash
git add src/styles/_session-inspector.scss src/styles/_session-grid.scss
git commit -m "style(session): breadcrumb + open-clip ring + scene-name layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Editor context header (Track ▸ Scene ▸ Clip) → Task 6 (markup + render) + Task 1 (data) + Task 7 (style). ✓
- Clip name promoted, single input → Task 6 (relocated `#insp-name`). ✓
- Secondary controls below → Task 6 (transport row after breadcrumb). ✓
- Rename track (double-click + context menu) in grid → Task 4; from breadcrumb → Task 6; persistence/undo → Task 5 (grid) + Task 6 (breadcrumb). ✓
- Rename scene (double-click + context menu) in grid → Task 4; from breadcrumb → Task 6; persistence/undo → Task 5 + Task 6. ✓
- Open-clip ring + row tint → Task 3 (grid) + Task 5 (host feeds selection) + Task 7 (style). ✓
- "Which scene" mapping (`scenes[clipIdx]`, row N) → Task 1. ✓
- No schema change → confirmed; only name fields used. ✓
- English UI strings → all literals are English. ✓
- Undo via existing machinery → Tasks 5 & 6 use `withUndo`; clip-name keeps its existing gesture wiring (unchanged). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertions. ✓

**3. Type consistency:**
- `resolveClipContext` return shape used identically in Task 1 (def) and Task 6 (`ctx.trackName/sceneName/rowNumber`). ✓
- `beginInlineRename(labelEl, currentValue, { commit })` signature identical across Tasks 2, 4, 6. ✓
- `onRenameLane(laneId, name)` / `onRenameScene(sceneIdx, name)` signatures identical in Task 3 (interface), Task 4 (call sites `cb.onRename*?.(...)`), Task 5 (impl). ✓
- `renderSessionGrid(..., openClip?: ClipSlot)` consistent in Task 3 (def) and Task 5 (call). ✓
- Class names `session-cell-editing` / `session-row-editing` / `session-scene-name` / `session-scene-play` / `inline-rename-input` consistent across Tasks 3/4 (set) and Task 7 (style). ✓
