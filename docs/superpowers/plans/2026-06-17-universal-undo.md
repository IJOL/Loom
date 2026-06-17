# Universal Undo Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make undo/redo cover *every* session mutation automatically (notes, clips, scenes, lanes, knobs, …) and add Undo/Redo buttons to the header.

**Architecture:** A new `AutoHistory` layer wraps the existing full-state snapshot `HistoryController<SavedStateV3>`. It captures changes automatically by diffing a `baseline` snapshot against the live state after global interaction events (pointer/keyboard/change/drop/wheel/text-blur), coalescing drags and field edits into single undo steps. A `refreshAll()` callback repaints every state-dependent view after undo/redo so the change is visible in the open editor. The legacy per-site `withUndo`/gesture helpers become history no-ops, leaving `AutoHistory` the single source of truth.

**Tech Stack:** TypeScript, Vite, Vitest (`environment: node`; DOM tests opt in with `// @vitest-environment jsdom`), Playwright e2e.

## Global Constraints

- **State under undo = `SavedStateV3` only** (session). Performance/arrangement takes stay out, exactly as today.
- **All UI text / tooltips in English** (project convention).
- **Assertions in tests are relative** where they measure DSP; here they are structural/equality assertions (no DSP).
- **No linter**; `npx tsc --noEmit` must stay green.
- **`maxSize` of history stays 100.**
- Test colour-free: prefer `NO_COLOR=1 npx vitest run <file>` for single files.
- **Equality of snapshots = `JSON.stringify(a) === JSON.stringify(b)`** (the snapshot is a serialisable `SavedStateV3`). Use this everywhere a snapshot comparison is needed; do not hand-roll a second comparator.

---

### Task 1: `AutoHistory` core (pure logic, no DOM)

**Files:**
- Create: `src/save/auto-history.ts`
- Test: `src/save/auto-history.test.ts`

**Interfaces:**
- Consumes: `HistoryController<T>` from `src/core/history.ts` (`commit/undo/redo/canUndo/canRedo/clear`), `SavedStateV3` from `src/save/saved-state-v3.ts`.
- Produces (relied on by Tasks 2, 4, 5, 6, 7):
  ```ts
  export interface AutoHistoryDeps {
    history: HistoryController<SavedStateV3>;
    snapshot: () => SavedStateV3;
    restore: (s: SavedStateV3) => void;
    refreshAll: () => void;
  }
  export interface AutoHistory {
    checkpoint(): void;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    markClean(): void;
    beginGesture(): void;
    endGesture(): void;
    onChange(cb: () => void): () => void;   // returns an unsubscribe fn
    installGlobalListeners(doc: Document): () => void;  // implemented in Task 2; returns uninstaller
  }
  export function createAutoHistory(deps: AutoHistoryDeps): AutoHistory;
  ```

- [ ] **Step 1: Write the failing test**

`src/save/auto-history.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createHistory } from '../core/history';
import { createAutoHistory, type AutoHistory } from './auto-history';
import type { SavedStateV3 } from './saved-state-v3';

// A tiny fake "state": just a counter wrapped to look like SavedStateV3 for the
// purposes of snapshot equality (JSON.stringify). We only need a serialisable
// object that changes value, so cast through unknown.
function makeHarness() {
  let live = { n: 0 };
  const history = createHistory<SavedStateV3>({ maxSize: 100 });
  const restored: SavedStateV3[] = [];
  const refreshAll = vi.fn();
  const ah = createAutoHistory({
    history,
    snapshot: () => (JSON.parse(JSON.stringify(live)) as unknown) as SavedStateV3,
    restore: (s) => { live = (JSON.parse(JSON.stringify(s)) as unknown) as { n: number }; restored.push(s); },
    refreshAll,
  });
  return {
    ah, refreshAll, restored,
    set: (n: number) => { live = { n }; },
    get: () => live.n,
  };
}

describe('AutoHistory.checkpoint', () => {
  it('commits the pre-change baseline only when state changed', () => {
    const h = makeHarness();
    h.set(1); h.ah.checkpoint();          // 0 -> 1 : commits baseline 0
    expect(h.ah.canUndo()).toBe(true);
    h.ah.checkpoint();                    // no change : no-op
    h.ah.undo();
    expect(h.get()).toBe(0);              // restored the pre-change baseline
  });

  it('no-ops when the state is unchanged', () => {
    const h = makeHarness();
    h.ah.checkpoint();
    expect(h.ah.canUndo()).toBe(false);
  });
});

describe('AutoHistory gesture coalescing', () => {
  it('collapses many intermediate states between begin/end into ONE undo', () => {
    const h = makeHarness();
    h.ah.beginGesture();
    h.set(1); h.ah.checkpoint();          // suppressed mid-gesture
    h.set(2); h.ah.checkpoint();          // suppressed
    h.set(3);
    h.ah.endGesture();                    // single commit of baseline 0
    expect(h.ah.canUndo()).toBe(true);
    h.ah.undo();
    expect(h.get()).toBe(0);
    expect(h.ah.canUndo()).toBe(false);   // only ONE step existed
  });
});

describe('AutoHistory undo/redo + baseline resync', () => {
  it('round-trips and a checkpoint right after undo is a no-op', () => {
    const h = makeHarness();
    h.set(1); h.ah.checkpoint();
    h.set(2); h.ah.checkpoint();
    h.ah.undo();                          // -> 1
    expect(h.get()).toBe(1);
    h.ah.checkpoint();                    // baseline resynced to 1 -> no spurious commit
    h.ah.redo();                          // -> 2
    expect(h.get()).toBe(2);
    expect(h.refreshAll).toHaveBeenCalledTimes(3); // 1 undo + 1 redo ... see note
  });
});

describe('AutoHistory.markClean', () => {
  it('resets baseline without committing and clears history', () => {
    const h = makeHarness();
    h.set(1); h.ah.checkpoint();
    h.set(5);
    h.ah.markClean();                     // baseline = 5, history cleared
    expect(h.ah.canUndo()).toBe(false);
    h.ah.checkpoint();
    expect(h.ah.canUndo()).toBe(false);   // 5 == baseline, nothing to commit
  });
});

describe('AutoHistory.onChange', () => {
  it('fires on commit, undo and redo; unsubscribes', () => {
    const h = makeHarness();
    const cb = vi.fn();
    const off = h.ah.onChange(cb);
    h.set(1); h.ah.checkpoint();          // commit -> fire
    h.ah.undo();                          // fire
    off();
    h.ah.redo();                          // not counted
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

> Note on `refreshAll` count: `undo()` and `redo()` each call `refreshAll` once. Adjust the asserted count to match the calls actually made in the test body (the example makes 1 undo + 1 redo = 2; change `3` to `2`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/save/auto-history.test.ts`
Expected: FAIL — `createAutoHistory` is not defined.

- [ ] **Step 3: Implement `src/save/auto-history.ts`**

```ts
// Automatic undo capture: diff a baseline snapshot against live state after
// interactions, committing the PRE-change state. Coalesces gestures (drags,
// focused text fields) so a whole interaction is one undo step. The single
// source of truth for undo — legacy withUndo/gesture helpers are no-ops.

import type { HistoryController } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';

export interface AutoHistoryDeps {
  history: HistoryController<SavedStateV3>;
  snapshot: () => SavedStateV3;
  restore: (s: SavedStateV3) => void;
  refreshAll: () => void;
}

export interface AutoHistory {
  checkpoint(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  markClean(): void;
  beginGesture(): void;
  endGesture(): void;
  onChange(cb: () => void): () => void;
  installGlobalListeners(doc: Document): () => void;
}

const eq = (a: SavedStateV3, b: SavedStateV3): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function createAutoHistory(deps: AutoHistoryDeps): AutoHistory {
  let baseline: SavedStateV3 = deps.snapshot();
  let gestureDepth = 0;
  const listeners: Array<() => void> = [];
  const notify = () => { for (const l of listeners) l(); };

  const self: AutoHistory = {
    checkpoint() {
      if (gestureDepth > 0) return;
      const cur = deps.snapshot();
      if (eq(cur, baseline)) return;
      deps.history.commit(baseline);
      baseline = cur;
      notify();
    },
    undo() {
      if (!deps.history.canUndo()) return;
      const prev = deps.history.undo(baseline);
      if (!prev) return;
      deps.restore(prev);
      baseline = deps.snapshot();
      deps.refreshAll();
      notify();
    },
    redo() {
      if (!deps.history.canRedo()) return;
      const next = deps.history.redo(baseline);
      if (!next) return;
      deps.restore(next);
      baseline = deps.snapshot();
      deps.refreshAll();
      notify();
    },
    canUndo: () => deps.history.canUndo(),
    canRedo: () => deps.history.canRedo(),
    markClean() {
      deps.history.clear();
      baseline = deps.snapshot();
      notify();
    },
    beginGesture() { gestureDepth++; },
    endGesture() {
      if (gestureDepth > 0) gestureDepth--;
      self.checkpoint();
    },
    onChange(cb) {
      listeners.push(cb);
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
    // Implemented in Task 2.
    installGlobalListeners() { return () => {}; },
  };
  return self;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/save/auto-history.test.ts`
Expected: PASS (fix the `refreshAll` count to `2` per the note if it mismatches).

- [ ] **Step 5: Commit**

```bash
git add src/save/auto-history.ts src/save/auto-history.test.ts
git commit -m "feat(undo): AutoHistory core (snapshot-diff capture + gesture coalescing)"
```

---

### Task 2: Global interaction listeners (DOM)

**Files:**
- Modify: `src/save/auto-history.ts` (implement `installGlobalListeners`)
- Test: `src/save/auto-history-listeners.test.ts`

**Interfaces:**
- Consumes: `isTextEditTarget` from `src/save/history-wiring.ts`.
- Produces: `installGlobalListeners(doc)` wires the event→checkpoint policy; returns an uninstaller that removes every listener.

Behaviour to implement:
- `pointerdown` (capture) → `beginGesture()`.
- `pointerup` (capture) → `endGesture()` on a microtask (`queueMicrotask`) so the app's own click handler mutates state first.
- `keyup` (capture) → ignore Ctrl/Cmd-Z / Ctrl-Y / Ctrl/Cmd-Shift-Z (the keyboard handler owns those) and ignore when the target is a text-edit field (handled by focus/blur); otherwise `checkpoint()` on a microtask.
- `change` (capture) and `drop` (capture) → `checkpoint()` on a microtask.
- `wheel` (capture) → trailing-debounced `checkpoint()` (250 ms) so a wheel burst on a knob is one undo.
- `focusin` → if `isTextEditTarget(e.target)` then `beginGesture()`.
- `focusout` → if `isTextEditTarget(e.target)` then `endGesture()` on a microtask.

- [ ] **Step 1: Write the failing test**

`src/save/auto-history-listeners.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHistory } from '../core/history';
import { createAutoHistory } from './auto-history';
import type { SavedStateV3 } from './saved-state-v3';

function harness() {
  let live = { n: 0 };
  const history = createHistory<SavedStateV3>({ maxSize: 100 });
  const ah = createAutoHistory({
    history,
    snapshot: () => (JSON.parse(JSON.stringify(live)) as unknown) as SavedStateV3,
    restore: (s) => { live = (JSON.parse(JSON.stringify(s)) as unknown) as { n: number }; },
    refreshAll: vi.fn(),
  });
  const uninstall = ah.installGlobalListeners(document);
  return { ah, uninstall, set: (n: number) => { live = { n }; }, get: () => live.n };
}
const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe('global listeners', () => {
  it('a pointer gesture (down→up) over a mutation collapses to one undo', async () => {
    const h = harness();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    h.set(1);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true })); // nested move-ish
    h.set(2);
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await tick();
    expect(h.ah.canUndo()).toBe(true);
    h.ah.undo();
    expect(h.get()).toBe(0);
    expect(h.ah.canUndo()).toBe(false);
    h.uninstall();
  });

  it('a discrete keyup commits a checkpoint', async () => {
    const h = harness();
    h.set(5);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));
    await tick();
    expect(h.ah.canUndo()).toBe(true);
    h.uninstall();
  });

  it('Ctrl+Z keyup does NOT create a checkpoint', async () => {
    const h = harness();
    h.set(5);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', ctrlKey: true, bubbles: true }));
    await tick();
    expect(h.ah.canUndo()).toBe(false);
    h.uninstall();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/save/auto-history-listeners.test.ts`
Expected: FAIL — `installGlobalListeners` is a no-op (canUndo stays false).

- [ ] **Step 3: Implement `installGlobalListeners`**

Replace the stub in `src/save/auto-history.ts`. Add the import at the top:
```ts
import { isTextEditTarget } from './history-wiring';
```
Replace the `installGlobalListeners` stub with:
```ts
    installGlobalListeners(doc: Document) {
      let wheelTimer: ReturnType<typeof setTimeout> | null = null;
      const micro = (fn: () => void) => queueMicrotask(fn);

      const onPointerDown = () => self.beginGesture();
      const onPointerUp = () => micro(() => self.endGesture());
      const onKeyUp = (e: Event) => {
        const ke = e as KeyboardEvent;
        const cmd = ke.metaKey || ke.ctrlKey;
        const k = ke.key.toLowerCase();
        if (cmd && (k === 'z' || k === 'y')) return;      // undo/redo shortcut
        if (isTextEditTarget(ke.target)) return;          // text fields → focus/blur path
        micro(() => self.checkpoint());
      };
      const onChange = () => micro(() => self.checkpoint());
      const onDrop = () => micro(() => self.checkpoint());
      const onWheel = () => {
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelTimer = null; self.checkpoint(); }, 250);
      };
      const onFocusIn = (e: Event) => { if (isTextEditTarget((e as FocusEvent).target)) self.beginGesture(); };
      const onFocusOut = (e: Event) => { if (isTextEditTarget((e as FocusEvent).target)) micro(() => self.endGesture()); };

      const opts = { capture: true } as const;
      doc.addEventListener('pointerdown', onPointerDown, opts);
      doc.addEventListener('pointerup', onPointerUp, opts);
      doc.addEventListener('keyup', onKeyUp, opts);
      doc.addEventListener('change', onChange, opts);
      doc.addEventListener('drop', onDrop, opts);
      doc.addEventListener('wheel', onWheel, opts);
      doc.addEventListener('focusin', onFocusIn, opts);
      doc.addEventListener('focusout', onFocusOut, opts);

      return () => {
        doc.removeEventListener('pointerdown', onPointerDown, opts);
        doc.removeEventListener('pointerup', onPointerUp, opts);
        doc.removeEventListener('keyup', onKeyUp, opts);
        doc.removeEventListener('change', onChange, opts);
        doc.removeEventListener('drop', onDrop, opts);
        doc.removeEventListener('wheel', onWheel, opts);
        doc.removeEventListener('focusin', onFocusIn, opts);
        doc.removeEventListener('focusout', onFocusOut, opts);
        if (wheelTimer) clearTimeout(wheelTimer);
      };
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/save/auto-history-listeners.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/save/auto-history.ts src/save/auto-history-listeners.test.ts
git commit -m "feat(undo): global interaction listeners for AutoHistory capture"
```

---

### Task 3: Neutralise legacy helpers

**Files:**
- Modify: `src/save/history-wiring.ts`
- Test: `src/save/history-wiring.test.ts` (create)

**Interfaces:**
- `withUndo(d, fn)` keeps its signature but only runs `fn()` (no commit). `beginGesture`/`commitGesture`/`cancelGesture` exported as no-ops (kept so the ~45 callers and `attachKnobUndo` still compile). `isTextEditTarget` and `wireHistoryKeyboard` unchanged for now (the keyboard delegate is rewired in Task 5).

- [ ] **Step 1: Write the failing test**

`src/save/history-wiring.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { withUndo } from './history-wiring';
import { createHistory } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';

describe('withUndo (neutralised)', () => {
  it('runs fn and does NOT commit to history', () => {
    const history = createHistory<SavedStateV3>();
    const snapshot = vi.fn(() => ({} as SavedStateV3));
    const restore = vi.fn();
    const fn = vi.fn(() => 42);
    const r = withUndo({ history, snapshot, restore }, fn);
    expect(r).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
    expect(history.canUndo()).toBe(false);   // nothing committed
    expect(snapshot).not.toHaveBeenCalled(); // no snapshot taken
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/save/history-wiring.test.ts`
Expected: FAIL — current `withUndo` calls `commit(snapshot())`, so `canUndo()` is true and `snapshot` was called.

- [ ] **Step 3: Edit `src/save/history-wiring.ts`**

Replace `withUndo` and `attachKnobUndo` bodies:
```ts
/** Neutralised: AutoHistory (src/save/auto-history.ts) is now the single source
 *  of undo capture. This helper only runs the mutation; the resulting state
 *  change is captured automatically on the next interaction checkpoint. Kept so
 *  the existing call sites compile unchanged. */
export function withUndo<R>(_d: HistoryDeps, fn: () => R): R {
  return fn();
}

/** Neutralised gesture bracket — AutoHistory coalesces gestures via global
 *  pointer/focus listeners. Kept so createKnob opts still type-check. */
export function attachKnobUndo(_d: HistoryDeps): {
  onGestureStart: () => void;
  onGestureEnd: () => void;
} {
  return { onGestureStart: () => {}, onGestureEnd: () => {} };
}
```

> The piano-roll calls `historyDeps.history.beginGesture/commitGesture/cancelGesture` *directly* (not via these helpers). Those are methods on `HistoryController`; they keep working but are now redundant. Leave them — they no longer affect capture because `withUndo`-style commits are gone and `pendingGesture` is harmless. The AutoHistory global listeners do the real coalescing.

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/save/history-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (no broken callers)**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/save/history-wiring.ts src/save/history-wiring.test.ts
git commit -m "refactor(undo): neutralise legacy withUndo/attachKnobUndo to no-ops"
```

---

### Task 4: Universal post-restore refresh

**Files:**
- Modify: `src/session/session-inspector.ts` (add public `refreshOpenEditor()`)
- Modify: `src/session/session-host.ts` (add public `refreshAfterRestore()`)
- Test: `src/session/session-host-refresh.test.ts` (create)

**Interfaces:**
- Produces: `SessionInspector.refreshOpenEditor(): void` — if the `#session-inspector` panel is visible and a clip is selected, re-run `renderEditor()`. `SessionHost.refreshAfterRestore(): void` — `renderWithMixer()` + `inspector.refreshOpenEditor()` + re-show the active lane editor (`showLaneEditor(activeEditLane)`).
- Consumes (Task 5): `refreshAfterRestore` is passed to `createAutoHistory({ refreshAll })`.

- [ ] **Step 1: Write the failing test**

`src/session/session-host-refresh.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SessionInspector } from './session-inspector';

// renderEditor is canvas-bound; stub the router so refreshOpenEditor is observable.
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: vi.fn(() => null),
}));
vi.mock('./clip-automation-lanes', () => ({ renderClipAutomationLanes: () => {} }));

import { renderClipEditor } from './clip-editors/clip-editor-router';

describe('SessionInspector.refreshOpenEditor', () => {
  it('re-renders the editor when the panel is open and a clip is selected', () => {
    document.body.innerHTML = `<div id="session-inspector"></div><div id="insp-editor"></div>`;
    const panel = document.getElementById('session-inspector')!;
    panel.hidden = false;
    const state = { lanes: [{ id: 'l1', engineId: 'tb303', clips: [{ id: 'c1', lengthBars: 1, notes: [] }], name: 'L1' }], scenes: [] } as never;
    const insp = new SessionInspector({
      ctx: {} as never, seq: { meter: '4/4', bpm: 120 } as never, state,
      laneStates: new Map(), renderWithMixer: () => {}, midiLabel: (m: number) => String(m),
      automationRegistry: new Map(), getAutoAbsSubIdx: () => 0,
    } as never);
    insp.setSelectedClip({ laneId: 'l1', clipIdx: 0 });
    (renderClipEditor as ReturnType<typeof vi.fn>).mockClear();
    insp.refreshOpenEditor();
    expect(renderClipEditor).toHaveBeenCalledOnce();
  });

  it('does nothing when the panel is hidden', () => {
    document.body.innerHTML = `<div id="session-inspector" hidden></div><div id="insp-editor"></div>`;
    const state = { lanes: [], scenes: [] } as never;
    const insp = new SessionInspector({
      ctx: {} as never, seq: { meter: '4/4', bpm: 120 } as never, state,
      laneStates: new Map(), renderWithMixer: () => {}, midiLabel: (m: number) => String(m),
      automationRegistry: new Map(), getAutoAbsSubIdx: () => 0,
    } as never);
    (renderClipEditor as ReturnType<typeof vi.fn>).mockClear();
    insp.refreshOpenEditor();
    expect(renderClipEditor).not.toHaveBeenCalled();
  });
});
```

> If the inspector constructor needs more shape than the stub provides, copy the exact `InspectorDeps` fields from `src/session/session-inspector.test.ts`'s setup — that file already constructs a working inspector under jsdom.

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-refresh.test.ts`
Expected: FAIL — `refreshOpenEditor` is not a function.

- [ ] **Step 3: Add `refreshOpenEditor` to `SessionInspector`**

In `src/session/session-inspector.ts`, add a public method (next to `refreshContext`):
```ts
  /** Re-render the open clip editor against current state. Called after an
   *  undo/redo so the mounted piano-roll/drum-grid (which closes over the clip
   *  object) reflects the restored notes instead of the stale ones. No-op when
   *  the inspector panel is hidden or nothing is selected. */
  refreshOpenEditor(): void {
    const panel = document.getElementById('session-inspector');
    if (!panel || panel.hidden) return;
    if (!this.selectedClip) return;
    this.renderEditor();
  }
```

- [ ] **Step 4: Add `refreshAfterRestore` to `SessionHost`**

In `src/session/session-host.ts`, add a public method (next to `renderWithMixer`):
```ts
  /** Repaint EVERY state-dependent view after an undo/redo so the change is
   *  visible wherever the user is: the grid + mixer, the open clip editor, and
   *  the active lane editor (knobs/labels/preset). */
  refreshAfterRestore(): void {
    this.renderWithMixer();
    this.inspector.refreshOpenEditor();
    if (this.activeEditLane) this.showLaneEditor(this.activeEditLane);
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-refresh.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean), then:
```bash
git add src/session/session-inspector.ts src/session/session-host.ts src/session/session-host-refresh.test.ts
git commit -m "feat(undo): refreshAfterRestore repaints open editor + active lane after undo"
```

---

### Task 5: Wire AutoHistory into `main.ts`

**Files:**
- Modify: `src/main.ts`
- Modify: `src/save/history-wiring.ts` (rewire `wireHistoryKeyboard` to delegate)

**Interfaces:**
- Consumes: `createAutoHistory` (Task 1), `SessionHost.refreshAfterRestore` (Task 4).
- Produces: a module-scoped `autoHistory` used by Task 6 (buttons) and Task 7 (async checkpoints).
- `wireHistoryKeyboard` new signature:
  ```ts
  export function wireHistoryKeyboard(h: {
    canUndo(): boolean; canRedo(): boolean; undo(): void; redo(): void;
  }): void;
  ```

- [ ] **Step 1: Rewrite `wireHistoryKeyboard` in `src/save/history-wiring.ts`**

```ts
/** Install Ctrl+Z / Cmd+Z / Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y on `document`,
 *  delegating to an undo controller (AutoHistory). Skips text-edit targets so
 *  native field undo wins. */
export function wireHistoryKeyboard(h: {
  canUndo(): boolean; canRedo(): boolean; undo(): void; redo(): void;
}): void {
  document.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      if (!h.canUndo()) return;
      e.preventDefault();
      h.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      if (!h.canRedo()) return;
      e.preventDefault();
      h.redo();
    }
  });
}
```

- [ ] **Step 2: Edit `src/main.ts` — build AutoHistory**

Find (around line 1040):
```ts
const historyDeps: HistoryDeps = {
  history,
  snapshot: () => buildSavedStateV3(savedStateDeps),
  restore: (s) => applyLoadedStateV3(s, savedStateDeps),
};
wireHistoryKeyboard(historyDeps);
```
Replace with:
```ts
const historyDeps: HistoryDeps = {
  history,
  snapshot: () => buildSavedStateV3(savedStateDeps),
  restore: (s) => applyLoadedStateV3(s, savedStateDeps),
};
const autoHistory = createAutoHistory({
  history,
  snapshot: () => buildSavedStateV3(savedStateDeps),
  restore: (s) => applyLoadedStateV3(s, savedStateDeps),
  refreshAll: () => sessionHost.refreshAfterRestore(),
});
autoHistory.installGlobalListeners(document);
wireHistoryKeyboard(autoHistory);
```
Add the import near the other save imports:
```ts
import { createAutoHistory } from './save/auto-history';
```

- [ ] **Step 3: Edit `src/main.ts` — replace `history.clear()` with `autoHistory.markClean()`**

Three sites — boot demo (`.then(...)`), demo picker `onLoaded`, and the New button:
- Boot demo `.then`: replace `history.clear();` with `autoHistory.markClean();`
- `wireDemoPicker({ ..., onLoaded: () => history.clear() })` → `onLoaded: () => autoHistory.markClean()`
- New button handler: replace `history.clear();` with `autoHistory.markClean();`

Also: `applyLoadedState` in `src/save/save-wiring.ts` calls `deps.history.clear()` after a Load. Add a `markClean` hook so the baseline resyncs on Load too. In `SaveWiringDeps` add an optional `onAfterApply?: () => void;` and call it at the end of `applyLoadedState`; in `main.ts` set `onAfterApply: () => autoHistory.markClean()` on `saveWiringDeps`. (If wiring this through is awkward, instead expose `autoHistory` to save-wiring directly — but the callback keeps the dependency direction clean.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: clean. Then `npm run build` — expected: bundles without error.

- [ ] **Step 5: Manual smoke (browser)**

Run `npm run dev`, open `http://localhost:5173`. Edit notes in a clip, press Ctrl+Z → notes revert AND the editor repaints. Add a lane → Ctrl+Z removes it. Add a scene → Ctrl+Z removes it. Move a clip → Ctrl+Z reverts. (This is the visible-undo acceptance — do it for real.)

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/save/history-wiring.ts src/save/save-wiring.ts
git commit -m "feat(undo): wire AutoHistory in main (keyboard, listeners, markClean on load/demo/new)"
```

---

### Task 6: Header Undo/Redo buttons

**Files:**
- Modify: `index.html` (transport row)
- Modify: `src/main.ts` (button wiring)
- Modify: `src/styles/_*.scss` (disabled state — pick the stylesheet that styles `.row.transport button`)
- Test: `src/save/undo-buttons.test.ts` (create)

**Interfaces:**
- Consumes: the module-scoped `autoHistory` (Task 5), `autoHistory.onChange`.
- Produces: a small wiring function `wireUndoButtons(undo, redo)` testable under jsdom.

- [ ] **Step 1: Add the buttons to `index.html`**

After the `#stop` button (line ~99 in `.row.transport`):
```html
        <button id="undo-btn" title="Undo (Ctrl+Z)" disabled>&#8634;</button>
        <button id="redo-btn" title="Redo (Ctrl+Shift+Z)" disabled>&#8635;</button>
```

- [ ] **Step 2: Write the failing test**

`src/save/undo-buttons.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { wireUndoButtons } from './undo-buttons';

describe('wireUndoButtons', () => {
  it('clicks call undo/redo and disabled state tracks canUndo/canRedo', () => {
    document.body.innerHTML = `<button id="undo-btn" disabled></button><button id="redo-btn" disabled></button>`;
    let can = { undo: false, redo: false };
    const undo = vi.fn();
    const redo = vi.fn();
    const onChange = vi.fn((cb: () => void) => { (globalThis as never as { _fire: () => void })._fire = cb; return () => {}; });
    wireUndoButtons({
      undo, redo, canUndo: () => can.undo, canRedo: () => can.redo, onChange,
    });
    const u = document.getElementById('undo-btn') as HTMLButtonElement;
    const r = document.getElementById('redo-btn') as HTMLButtonElement;
    expect(u.disabled).toBe(true);
    can = { undo: true, redo: false };
    (globalThis as never as { _fire: () => void })._fire();   // simulate onChange
    expect(u.disabled).toBe(false);
    expect(r.disabled).toBe(true);
    u.click();
    expect(undo).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Implement `src/save/undo-buttons.ts`**

```ts
// Wire the header Undo/Redo buttons to an undo controller, keeping their
// enabled/disabled state in sync with the history stacks.
export interface UndoButtonDeps {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  onChange(cb: () => void): () => void;
}

export function wireUndoButtons(d: UndoButtonDeps): void {
  const u = document.getElementById('undo-btn') as HTMLButtonElement | null;
  const r = document.getElementById('redo-btn') as HTMLButtonElement | null;
  if (!u || !r) return;
  u.addEventListener('click', () => d.undo());
  r.addEventListener('click', () => d.redo());
  const sync = () => { u.disabled = !d.canUndo(); r.disabled = !d.canRedo(); };
  d.onChange(sync);
  sync();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/save/undo-buttons.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire in `main.ts`**

After `wireHistoryKeyboard(autoHistory);` add:
```ts
wireUndoButtons(autoHistory);
```
Import:
```ts
import { wireUndoButtons } from './save/undo-buttons';
```

- [ ] **Step 6: Disabled-state styling**

Find the stylesheet rule for `.row.transport button` (grep `_*.scss` for `.transport`). Add:
```scss
.row.transport #undo-btn[disabled],
.row.transport #redo-btn[disabled] { opacity: 0.35; cursor: default; }
```

- [ ] **Step 7: Build + manual look**

`npm run build`, then `npm run dev` → confirm the ↶/↷ buttons appear by Play/Stop, are greyed when there's nothing to undo, light up after an edit, and clicking them works (matches Ctrl+Z).

- [ ] **Step 8: Commit**

```bash
git add index.html src/main.ts src/save/undo-buttons.ts src/save/undo-buttons.test.ts src/styles
git commit -m "feat(undo): header Undo/Redo buttons wired to AutoHistory"
```

---

### Task 7: Explicit checkpoints for async/programmatic mutations

**Files:**
- Modify: `src/session/session-host-deps.ts` (add `checkpointHistory?: () => void`)
- Modify: `src/session/session-host.ts` + `src/session/session-host-callbacks.ts` (call it at async endpoints)
- Modify: `src/main.ts` (provide the dep)
- Test: covered by the behavioural matrix in Task 8 (these paths are async + audio-bound; a unit test would mostly assert the call site, which the e2e covers).

**Interfaces:**
- Consumes: `autoHistory.checkpoint` (Task 1).
- Produces: `SessionHostDeps.checkpointHistory?: () => void`, invoked after async mutations settle.

- [ ] **Step 1: Add the dep**

In `src/session/session-host-deps.ts`, add to the interface:
```ts
  /** Commit an undo checkpoint after an async/programmatic mutation that does
   *  not end in a user pointer/key event (stems, transcription, import). */
  checkpointHistory?: () => void;
```

- [ ] **Step 2: Call it at the async endpoints**

Add `this.deps.checkpointHistory?.();` (or `self.deps.checkpointHistory?.();` in callbacks) at the end of the success path of each:
- `SessionHost.addNoteLane` (after `this.renderWithMixer()` inside `run`).
- `SessionHost.installSamplerClip` (after `this.renderWithMixer()`).
- `session-host-callbacks.ts` `onAddStemLanes` `runAdd`/`runReplace` (after their render/apply).
- `session-host-audio-import.ts` endpoints: `addAudioChannel`, `loadAudioFileIntoCell`, `importLoopToSampler` (after the clip is installed). Grep these files for the final `renderWithMixer()`/`installSamplerClip` call in each async resolve and add the checkpoint right after.

> The synchronous callbacks (onAddScene/onAddLane/onMoveClip/onDeleteClip/onDeleteScene/etc.) do NOT need this — they end in a pointerup which the global listener already checkpoints. Only the async resolves need it.

- [ ] **Step 3: Provide the dep in `main.ts`**

Where `sessionHost` is constructed (its deps object), add:
```ts
  checkpointHistory: () => autoHistory.checkpoint(),
```
If `sessionHost` is constructed before `autoHistory` exists, use a late getter like the existing `get historyDeps()` pattern, or assign `sessionHost.deps.checkpointHistory = () => autoHistory.checkpoint();` right after `autoHistory` is created.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`. Expected: clean.

- [ ] **Step 5: Manual smoke**

`npm run dev`: import a loop / run a transcription → after it lands, Ctrl+Z removes the imported lane/clip in one step.

- [ ] **Step 6: Commit**

```bash
git add src/session/session-host-deps.ts src/session/session-host.ts src/session/session-host-callbacks.ts src/session/session-host-audio-import.ts src/main.ts
git commit -m "feat(undo): explicit checkpoints after async mutations (stems/transcribe/import)"
```

---

### Task 8: e2e + full verification

**Files:**
- Create: `tests/e2e/universal-undo.spec.ts`

**Interfaces:** none (black-box through the built app).

- [ ] **Step 1: Build first (e2e serves `dist/`)**

Run: `npm run build`
Expected: clean bundle. (Per CLAUDE.md, `test:e2e` serves the last build with NO build step — building first is mandatory.)

- [ ] **Step 2: Write the e2e**

`tests/e2e/universal-undo.spec.ts` — model it on an existing spec in `tests/e2e/`. One assertion per path:
```ts
import { test, expect } from '@playwright/test';

test('header Undo reverts note edits and repaints the open editor', async ({ page }) => {
  await page.goto('/');
  // Open a clip in the inspector (click a populated clip cell), add/toggle a note
  // in the editor, then click #undo-btn and assert the editor + grid reverted.
  // Use the data hooks the app exposes; mirror selectors from existing e2e specs.
  // ... concrete selectors copied from tests/e2e/<existing>.spec.ts ...
  await expect(page.locator('#undo-btn')).toBeEnabled();
  await page.locator('#undo-btn').click();
  await expect(page.locator('#redo-btn')).toBeEnabled();
});
```
> Fill the selectors from an existing e2e spec (grid cell, inspector, editor canvas). Keep it to: edit a note → Undo (button) → assert reverted; add a lane → Undo → assert lane count back.

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e`
Expected: the new spec passes.

- [ ] **Step 4: Full unit suite**

Run: `npm run test:unit`
Expected: green (re-run once if `ERR_IPC_CHANNEL_CLOSED` appears on teardown — known flake).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/universal-undo.spec.ts
git commit -m "test(undo): e2e for header undo reverting note edits + lane add"
```

---

## Self-Review

**Spec coverage:**
- Root cause 1 (capture) → Tasks 1, 2, 3, 5. ✓
- Root cause 2 (repaint) → Task 4. ✓
- §1 auto layer + coalescing → Tasks 1, 2. ✓
- §2 refreshAll → Task 4. ✓
- §3 neutralise opt-in → Task 3. ✓
- §4 async checkpoints + markClean → Tasks 5, 7. ✓
- §5 header buttons → Task 6. ✓
- Testing section → per-task tests + Task 8. ✓

**Placeholder scan:** e2e selectors in Task 8 are intentionally deferred to "copy from an existing spec" because they depend on the current DOM hooks — flagged explicitly, not silent. All code steps contain real code.

**Type consistency:** `AutoHistory` interface (Task 1) is the same shape consumed by `wireHistoryKeyboard` (Task 5, structural subset), `wireUndoButtons` (Task 6, structural subset), and `checkpointHistory` (Task 7). `refreshAll` ↔ `refreshAfterRestore` wired in Task 5. `markClean`/`checkpoint`/`onChange` names match across tasks.
