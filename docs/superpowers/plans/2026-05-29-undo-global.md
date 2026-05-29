# Undo Global Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single global undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) that covers every persistent mutation in the app — pattern edits, knobs, presets, BPM, swing, kit, wave, lane/scene/clip ops — backed by a snapshot stack over the V3 save shape.

**Architecture:** Pure `HistoryController<T>` in `src/core/history.ts` holding `past`/`future` stacks of typed `SavedStateV3` snapshots. A wiring layer (`src/save/history-wiring.ts`) installs the global keyboard shortcut and provides two helpers — `withUndo` for discrete actions and `attachKnobUndo` for continuous knob drags. Mutation sites across the app wrap their existing handlers with these helpers. The save format module (`src/save/saved-state-v3.ts`) is extracted from `src/save/save-wiring.ts` so both the save manager and the history layer reuse one typed shape.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), Web Audio (existing). No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-05-28-undo-global-design.md](../specs/2026-05-28-undo-global-design.md)

---

## Phase A — Pure history controller

The history controller is generic over `T` and has zero coupling to the app. Build and test it in isolation first.

### Task 1: HistoryController core (commit / undo / redo)

**Files:**

- Create: `src/core/history.ts`
- Test: `src/core/history.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `src/core/history.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createHistory } from './history';

describe('history — commit / undo / redo basics', () => {
  it('starts empty: canUndo and canRedo are false', () => {
    const h = createHistory<number>();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo(42)).toBe(null);
    expect(h.redo(42)).toBe(null);
  });

  it('commit then undo restores the committed value', () => {
    const h = createHistory<number>();
    h.commit(1);
    expect(h.canUndo()).toBe(true);
    expect(h.undo(2)).toBe(1);
  });

  it('redo reverses undo exactly', () => {
    const h = createHistory<number>();
    h.commit(1);
    const restored = h.undo(2);
    expect(restored).toBe(1);
    expect(h.canRedo()).toBe(true);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo()).toBe(false);
    expect(h.canUndo()).toBe(true);
  });

  it('new commit after undo clears the redo stack', () => {
    const h = createHistory<number>();
    h.commit(1);
    h.undo(2);
    expect(h.canRedo()).toBe(true);
    h.commit(2);
    expect(h.canRedo()).toBe(false);
    expect(h.redo(3)).toBe(null);
  });

  it('clear empties both stacks', () => {
    const h = createHistory<number>();
    h.commit(1);
    h.commit(2);
    h.undo(3);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/core/history.test.ts`
Expected: FAIL — `createHistory` is not defined.

- [ ] **Step 3: Implement the minimal controller**

Create `src/core/history.ts`:

```typescript
// Generic snapshot-based history with past/future stacks. Pure: no DOM, no IO.

export interface HistoryController<T> {
  commit(prev: T): void;
  beginGesture(prev: T): void;
  commitGesture(): void;
  cancelGesture(): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export interface HistoryOptions {
  /** Max past entries. Older entries are discarded on overflow. Default 100. */
  maxSize?: number;
}

export function createHistory<T>(opts: HistoryOptions = {}): HistoryController<T> {
  const maxSize = opts.maxSize ?? 100;
  const past: T[] = [];
  const future: T[] = [];
  let pendingGesture: T | null = null;

  return {
    commit(prev) {
      past.push(prev);
      if (past.length > maxSize) past.shift();
      future.length = 0;
    },
    beginGesture(prev) {
      if (pendingGesture !== null) return;
      pendingGesture = prev;
    },
    commitGesture() {
      if (pendingGesture === null) return;
      past.push(pendingGesture);
      if (past.length > maxSize) past.shift();
      future.length = 0;
      pendingGesture = null;
    },
    cancelGesture() {
      pendingGesture = null;
    },
    undo(current) {
      pendingGesture = null;
      const prev = past.pop();
      if (prev === undefined) return null;
      future.push(current);
      return prev;
    },
    redo(current) {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(current);
      if (past.length > maxSize) past.shift();
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past.length = 0;
      future.length = 0;
      pendingGesture = null;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/core/history.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/core/history.ts src/core/history.test.ts
git commit -m "feat(history): pure controller with commit/undo/redo"
```

---

### Task 2: maxSize enforcement

**Files:**

- Modify: `src/core/history.test.ts` (append)

- [ ] **Step 1: Add the failing test**

Append to `src/core/history.test.ts`:

```typescript
describe('history — maxSize', () => {
  it('drops oldest past entry when commit overflows maxSize', () => {
    const h = createHistory<number>({ maxSize: 3 });
    h.commit(1);
    h.commit(2);
    h.commit(3);
    h.commit(4); // pushes out 1
    // 4 undos: 3 should succeed (returning 4,3,2), 4th returns null
    expect(h.undo(99)).toBe(4);
    expect(h.undo(99)).toBe(3);
    expect(h.undo(99)).toBe(2);
    expect(h.undo(99)).toBe(null);
  });

  it('default maxSize is 100', () => {
    const h = createHistory<number>();
    for (let i = 0; i < 150; i++) h.commit(i);
    // Undo 100 times returns the most recent 100 (149..50)
    let last: number | null = null;
    for (let i = 0; i < 100; i++) last = h.undo(999);
    expect(last).toBe(50);
    expect(h.undo(999)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/core/history.test.ts`
Expected: PASS (the implementation from Task 1 already enforces maxSize).

- [ ] **Step 3: Commit**

```bash
git add src/core/history.test.ts
git commit -m "test(history): maxSize enforcement"
```

---

### Task 3: Gesture API (begin / commit / cancel)

**Files:**

- Modify: `src/core/history.test.ts` (append)

- [ ] **Step 1: Add the failing tests**

Append:

```typescript
describe('history — gestures', () => {
  it('beginGesture does not push to past', () => {
    const h = createHistory<number>();
    h.beginGesture(1);
    expect(h.canUndo()).toBe(false);
  });

  it('commitGesture pushes exactly one entry', () => {
    const h = createHistory<number>();
    h.beginGesture(1);
    h.commitGesture();
    expect(h.canUndo()).toBe(true);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(2)).toBe(null);
  });

  it('repeated beginGesture during an active gesture is ignored', () => {
    const h = createHistory<number>();
    h.beginGesture(1);
    h.beginGesture(2); // ignored
    h.commitGesture();
    expect(h.undo(99)).toBe(1);
  });

  it('cancelGesture discards without pushing', () => {
    const h = createHistory<number>();
    h.beginGesture(1);
    h.cancelGesture();
    h.commitGesture(); // no-op now
    expect(h.canUndo()).toBe(false);
  });

  it('undo cancels any active gesture', () => {
    const h = createHistory<number>();
    h.commit(10);
    h.beginGesture(20);
    const restored = h.undo(30);
    expect(restored).toBe(10);
    h.commitGesture(); // no-op now
    expect(h.canUndo()).toBe(false);
  });

  it('commitGesture clears the redo stack', () => {
    const h = createHistory<number>();
    h.commit(1);
    h.undo(2);
    expect(h.canRedo()).toBe(true);
    h.beginGesture(3);
    h.commitGesture();
    expect(h.canRedo()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/core/history.test.ts`
Expected: PASS (the Task 1 implementation already supports these semantics).

- [ ] **Step 3: Commit**

```bash
git add src/core/history.test.ts
git commit -m "test(history): gesture semantics"
```

---

## Phase B — SavedStateV3 module extraction

`buildSavedStateV3` and `applyLoadedState` already exist as private functions inside `src/save/save-wiring.ts`. Lift them into a typed module so the history layer can reuse them with zero duplication.

### Task 4: Extract `saved-state-v3.ts`

**Files:**

- Create: `src/save/saved-state-v3.ts`
- Modify: `src/save/save-wiring.ts`

- [ ] **Step 1: Create the new module**

Create `src/save/saved-state-v3.ts`:

```typescript
import type { Sequencer } from '../core/sequencer';
import type { TB303, Wave } from '../core/synth';
import type { DrumMachine } from '../core/drums';
import type { SessionHost } from '../session/session-host';
import type { SessionState } from '../session/session';

export interface SavedStateV3 {
  schemaVersion: 3;
  bpm: number;
  swing: number;
  masterVol: number;
  kit: string;
  wave: Wave;
  synthParams: TB303['params'];
  sessionState: SessionState;
}

export interface SavedStateV3Deps {
  seq: Sequencer;
  synth: TB303;
  drums: DrumMachine;
  volInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  kitSel: HTMLSelectElement;
  waveSel: HTMLSelectElement;
  sessionHost: SessionHost;
  refreshKnobsFromSynth: () => void;
  renderLanes: () => void;
  fx: import('../core/fx').FxBus;
  filterChain: import('../core/fx').FilterChain;
  master: GainNode;
}

export function buildSavedStateV3(deps: SavedStateV3Deps): SavedStateV3 {
  const { seq, synth, drums, volInput, sessionHost } = deps;
  return {
    schemaVersion: 3,
    bpm: seq.bpm,
    swing: seq.swing,
    masterVol: parseFloat(volInput.value),
    kit: drums.kitId,
    wave: synth.params.wave,
    synthParams: { ...synth.params },
    sessionState: sessionHost.getStateForSave(),
  };
}

export function applyLoadedStateV3(s: SavedStateV3, deps: SavedStateV3Deps): void {
  const {
    seq, synth, drums, volInput, bpmInput, swingInput, kitSel, waveSel,
    sessionHost, refreshKnobsFromSynth, renderLanes, fx, filterChain, master,
  } = deps;

  if (typeof s.bpm === 'number') { seq.bpm = s.bpm; bpmInput.value = String(s.bpm); }
  if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }
  if (typeof s.masterVol === 'number') { master.gain.value = s.masterVol; volInput.value = String(s.masterVol); }
  if (typeof s.kit === 'string') { drums.setKit(s.kit); kitSel.value = s.kit; }
  if (s.wave) { synth.params.wave = s.wave; waveSel.value = String(s.wave); }
  if (s.synthParams) synth.params = { ...synth.params, ...s.synthParams };
  if (s.sessionState) sessionHost.applyLoadedSessionState(s.sessionState);
  refreshKnobsFromSynth();
  renderLanes();
  fx.setBpmSync(seq.bpm);
  filterChain.updateBpm(seq.bpm);
}

/** Runtime guard: untrusted JSON (file load, localStorage) → typed shape or null. */
export function parseSavedStateV3(raw: unknown): SavedStateV3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 3) return null;
  // We trust the field types past the schemaVersion check; legacy v1/v2 are
  // dropped here. The existing save-wiring did the same.
  return r as unknown as SavedStateV3;
}
```

- [ ] **Step 2: Replace the private functions in `save-wiring.ts`**

Open `src/save/save-wiring.ts`. Replace the import block, `buildSavedStateV3`, and `applyLoadedState` so the file uses the extracted module:

At the top, after existing imports, add:

```typescript
import {
  buildSavedStateV3, applyLoadedStateV3, parseSavedStateV3,
  type SavedStateV3, type SavedStateV3Deps,
} from './saved-state-v3';
```

Remove the local `function buildSavedStateV3(deps: SaveWiringDeps): Record<string, unknown> { … }` block entirely.

Replace `function applyLoadedState(data: unknown, deps: SaveWiringDeps): void { … }` with:

```typescript
function applyLoadedState(data: unknown, deps: SaveWiringDeps): void {
  const s = parseSavedStateV3(data);
  if (!s) {
    if (data && typeof data === 'object' && 'schemaVersion' in data) {
      console.warn('[SaveManager] Ignoring legacy save file (schemaVersion < 3). Classic mode no longer supported.');
    } else {
      alert('Invalid save data');
    }
    return;
  }
  applyLoadedStateV3(s, deps);
}
```

Note: `SaveWiringDeps` is a superset of `SavedStateV3Deps` (it also has `kitSel`, `waveSel`, `flashButton`). The `applyLoadedStateV3` call only reads fields it knows about — TypeScript will type-check the call directly. If TS complains, narrow with `applyLoadedStateV3(s, deps as SavedStateV3Deps)` — the structural subtyping should accept it.

- [ ] **Step 3: Typecheck and run existing tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `NO_COLOR=1 npm run test:fast`
Expected: PASS. No behaviour change; existing save tests (if any) still green.

- [ ] **Step 4: Manual smoke (5 sec)**

Start the dev server in the background: `npm run dev`. Open `http://localhost:5173`. Click Save, give it a name, then Load it back. Verify state loads identically. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/save/saved-state-v3.ts src/save/save-wiring.ts
git commit -m "refactor(save): extract SavedStateV3 type and helpers"
```

---

## Phase C — History wiring helpers

### Task 5: HistoryDeps, keyboard handler, withUndo

**Files:**

- Create: `src/save/history-wiring.ts`

- [ ] **Step 1: Write the module**

Create `src/save/history-wiring.ts`:

```typescript
import type { HistoryController } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';

export interface HistoryDeps {
  history: HistoryController<SavedStateV3>;
  snapshot: () => SavedStateV3;
  restore: (s: SavedStateV3) => void;
}

/** Install Ctrl+Z / Cmd+Z / Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y on `document`.
 *  Ignores the event when typing in text inputs / textareas / contentEditable so
 *  native undo inside save-name prompts etc. is preserved. */
export function wireHistoryKeyboard(d: HistoryDeps): void {
  document.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      if (!d.history.canUndo()) return;
      e.preventDefault();
      const prev = d.history.undo(d.snapshot());
      if (prev) d.restore(prev);
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      if (!d.history.canRedo()) return;
      e.preventDefault();
      const next = d.history.redo(d.snapshot());
      if (next) d.restore(next);
    }
  });
}

function isTextEditTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return type === 'text' || type === 'search' || type === 'email'
        || type === 'url' || type === 'tel' || type === 'password' || type === '';
  }
  return false;
}

/** Discrete-action helper: snapshot before, then mutate. */
export function withUndo<R>(d: HistoryDeps, fn: () => R): R {
  d.history.commit(d.snapshot());
  return fn();
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/save/history-wiring.ts
git commit -m "feat(history): wiring deps + keyboard shortcut + withUndo helper"
```

---

### Task 6: Extend Knob with gesture hooks and add `attachKnobUndo`

**Files:**

- Modify: `src/core/knob.ts`
- Modify: `src/save/history-wiring.ts`

- [ ] **Step 1: Extend `KnobOpts` with gesture callbacks**

In `src/core/knob.ts`, add two optional fields to `KnobOpts`:

```typescript
export interface KnobOpts {
  min: number;
  max: number;
  value: number;
  step?: number;
  defaultValue?: number;
  label?: string;
  color?: string;
  size?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  id?: string;
  /** Fired on pointerdown (drag start). Use to snapshot pre-drag state. */
  onGestureStart?: () => void;
  /** Fired on pointerup, pointercancel, or end of wheel/dblclick burst. */
  onGestureEnd?: () => void;
}
```

In the `pointerdown` handler (around line 154), call `opts.onGestureStart?.()` after `dragging = true;`. In the `release` function (around line 170), call `opts.onGestureEnd?.()` immediately before `wrap.classList.remove('dragging');`.

For `dblclick` (line 179): wrap the `setValue` call:

```typescript
svg.addEventListener('dblclick', () => {
  if (opts.defaultValue === undefined) return;
  opts.onGestureStart?.();
  setValue(opts.defaultValue, true, true);
  opts.onGestureEnd?.();
});
```

For `wheel` (line 183): use a small debounce to bracket bursts. Add at module scope or inside `createKnob`:

```typescript
let wheelGestureTimer: ReturnType<typeof setTimeout> | null = null;
let wheelGestureActive = false;
```

Then the wheel handler becomes:

```typescript
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!wheelGestureActive) {
    wheelGestureActive = true;
    opts.onGestureStart?.();
  }
  if (wheelGestureTimer) clearTimeout(wheelGestureTimer);
  const sens = e.shiftKey ? 0.0008 : 0.005;
  setValue(value + -e.deltaY * sens * (opts.max - opts.min), true, true);
  wheelGestureTimer = setTimeout(() => {
    wheelGestureActive = false;
    opts.onGestureEnd?.();
  }, 250);
}, { passive: false });
```

- [ ] **Step 2: Add `attachKnobUndo` to `history-wiring.ts`**

Append to `src/save/history-wiring.ts`:

```typescript
import type { KnobHandle } from '../core/knob';

/** Wire an existing knob handle so a drag (or wheel burst, or dblclick) is one
 *  undo entry. The knob must have been created with onGestureStart /
 *  onGestureEnd hooks bound through this helper — call attachKnobUndo at the
 *  same site that owns the createKnob call by passing the opts object before
 *  creation, or use the wrapper below. */
export function attachKnobUndo(d: HistoryDeps): {
  onGestureStart: () => void;
  onGestureEnd: () => void;
} {
  return {
    onGestureStart: () => d.history.beginGesture(d.snapshot()),
    onGestureEnd:   () => d.history.commitGesture(),
  };
}
```

Note: returning the two callbacks lets the site spread them into `createKnob({ …, ...attachKnobUndo(historyDeps) })`. Avoids needing a post-creation hook on `KnobHandle`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/knob.ts src/save/history-wiring.ts
git commit -m "feat(knob,history): gesture-bracket hooks + attachKnobUndo"
```

---

## Phase D — Bootstrap

### Task 7: Instantiate history in `main.ts`

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Add the imports**

Add to the imports block (near the existing `wireSaveManager` import):

```typescript
import { createHistory } from './core/history';
import {
  wireHistoryKeyboard, withUndo, attachKnobUndo, type HistoryDeps,
} from './save/history-wiring';
import {
  buildSavedStateV3, applyLoadedStateV3, type SavedStateV3, type SavedStateV3Deps,
} from './save/saved-state-v3';
```

- [ ] **Step 2: Bootstrap the controller**

Find the spot in `main.ts` where the `wireSaveManager(deps)` call sits (or right after the deps object that includes `seq`, `synth`, `drums`, `master`, `volInput`, `bpmInput`, `swingInput`, `kitSel`, `waveSel`, `sessionHost`, `fx`, `filterChain` is fully constructed). Right after that, add:

```typescript
const savedStateDeps: SavedStateV3Deps = {
  seq, synth, drums, volInput, bpmInput, swingInput, kitSel, waveSel,
  sessionHost, refreshKnobsFromSynth, renderLanes, fx, filterChain, master,
};
const history = createHistory<SavedStateV3>({ maxSize: 100 });
const historyDeps: HistoryDeps = {
  history,
  snapshot: () => buildSavedStateV3(savedStateDeps),
  restore: (s) => applyLoadedStateV3(s, savedStateDeps),
};
wireHistoryKeyboard(historyDeps);
```

If `refreshKnobsFromSynth` or `renderLanes` is declared further down the file, hoist the snippet to just after those declarations are in scope.

- [ ] **Step 3: Expose `historyDeps` for later phases**

The variable `historyDeps` will be referenced by mutation-site refactors in Phase E. No exports needed — same-file usage.

- [ ] **Step 4: Typecheck and dev-smoke**

Run: `npx tsc --noEmit`
Expected: no errors.

Run dev server in background: `npm run dev`. Open `http://localhost:5173`. Press `Ctrl+Z` — nothing should happen (no past entries yet) and no console error. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): bootstrap HistoryController + keyboard shortcuts"
```

---

## Phase E — Roll out to mutation sites

Each task wraps existing mutation handlers with `withUndo` (discrete) or `attachKnobUndo` (continuous). No new behaviour; one undo entry per gesture. Verification is per task; full E2E lands in Phase G.

### Task 8: Sequencer step toggle + Randomize/Clear pattern

**Files:**

- Modify: `src/main.ts` (sequencer cell click handler, randomize button, clear button)

- [ ] **Step 1: Find the sites**

Run: `grep -n "Randomize\|Random\|Clear\|onclick" src/main.ts | head -30` to locate the buttons. Also grep for the bass/drum cell click handlers (likely in `rebuildTracks` or similar).

- [ ] **Step 2: Wrap each handler**

For every site that mutates the sequencer pattern (step toggle, accent toggle, slide toggle, randomize-all, clear-pattern, randomize-mod, etc.), replace the body with:

```typescript
withUndo(historyDeps, () => {
  // ...original mutation code unchanged...
});
```

If the original handler does DOM work after the mutation (re-render cells), keep it inside the `withUndo` callback — the post-state matters for redo, the pre-state is what gets snapshotted.

- [ ] **Step 3: Smoke test**

Start dev. Toggle a step. Press `Ctrl+Z`. Step should toggle back. Press `Ctrl+Shift+Z`. Step should toggle forward.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(history): wrap sequencer toggles + randomize/clear"
```

---

### Task 9: Session-level discrete mutations

**Files:**

- Modify: `src/main.ts` (session UI callbacks)

- [ ] **Step 1: Find the session callbacks**

In `main.ts`, find the `SessionUICallbacks` object passed to `renderSessionGrid`. The relevant handlers are `onClipClick`, `onCellClick` (when it creates a clip), `onAddScene`, `onAddLane`, `onAddClipRow`, `onLaunchScene` (only the part that mutates state — launching itself is transport, do not wrap that).

- [ ] **Step 2: Wrap each handler that mutates `SessionState`**

Wrap the body of each mutation handler in `withUndo(historyDeps, () => { … })`. For `onLaunchScene`: do **not** wrap (transport-only).

For `onClipClick`: depends on what it does. If it only opens an editor, do not wrap. If it triggers a stop/launch (transport-only), do not wrap. If it mutates the clip, wrap.

- [ ] **Step 3: Smoke test**

Start dev. Add a scene. Press `Ctrl+Z`. Scene should disappear. Add a clip in an empty cell. Press `Ctrl+Z`. Clip should disappear. Add a lane. Press `Ctrl+Z`. Lane should disappear.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(history): wrap session add/remove mutations"
```

---

### Task 10: Discrete selectors (kit, wave, engine, preset)

**Files:**

- Modify: `src/main.ts` (kitSel, waveSel)
- Modify: `src/engines/engine-selector-ui.ts`
- Modify: `src/presets/preset-library-ui.ts` (load handler)
- Modify: `src/polysynth/polysynth-presets.ts` (`applyPresetByName`)

- [ ] **Step 1: Identify each `change` event handler**

Run: `grep -n "addEventListener('change'" src/main.ts src/engines/engine-selector-ui.ts src/presets/preset-library-ui.ts`. For each `change` handler whose body mutates persisted state (`drums.setKit`, `synth.params.wave = …`, switching engine on a lane, applying a preset), prepare to wrap.

- [ ] **Step 2: Inject `historyDeps` into selector UIs**

For each of the helper modules above, add a `historyDeps: HistoryDeps` field to their deps interface, threaded through from `main.ts`. Use the existing dependency-injection pattern in those files (look for how the deps are passed today).

- [ ] **Step 3: Wrap each handler**

Wrap the mutation body with `withUndo(deps.historyDeps, () => { … })`. Example for kit:

```typescript
kitSel.addEventListener('change', () => {
  withUndo(historyDeps, () => {
    drums.setKit(kitSel.value);
  });
});
```

For `applyPresetByName`: wrap its body in `withUndo` only when called from a user-facing UI handler — programmatic calls (initial load, save-restore) must not snapshot. Solution: keep `applyPresetByName` pure of history concerns; wrap at the **call site** that originates from a user click.

- [ ] **Step 4: Smoke test**

Change kit. `Ctrl+Z`. Kit reverts. Change wave. `Ctrl+Z`. Wave reverts. Change engine on a lane. `Ctrl+Z`. Engine reverts. Apply a preset. `Ctrl+Z`. Preset reverts.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/engines/engine-selector-ui.ts src/presets/preset-library-ui.ts src/polysynth/polysynth-presets.ts
git commit -m "feat(history): wrap discrete selectors (kit/wave/engine/preset)"
```

---

### Task 11: BPM / swing / master volume (continuous inputs)

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Find the handlers**

Run: `grep -n "bpmInput\|swingInput\|volInput" src/main.ts | head -30`. Find the `addEventListener('input', …)` and any `addEventListener('change', …)` for each.

- [ ] **Step 2: Add gesture brackets**

For each of `bpmInput`, `swingInput`, `volInput`:

```typescript
bpmInput.addEventListener('pointerdown', () => {
  historyDeps.history.beginGesture(historyDeps.snapshot());
});
bpmInput.addEventListener('pointerup', () => {
  historyDeps.history.commitGesture();
});
bpmInput.addEventListener('focus', () => {
  historyDeps.history.beginGesture(historyDeps.snapshot());
});
bpmInput.addEventListener('blur', () => {
  historyDeps.history.commitGesture();
});
```

`focus`/`blur` covers keyboard editing. `pointerdown`/`pointerup` covers slider drags (the existing handlers fire on `input` mid-drag — those stay as they are; do not snapshot mid-`input`).

Apply the same four-listener pattern to `swingInput` and `volInput`.

- [ ] **Step 3: Smoke test**

Drag BPM slider. Release. `Ctrl+Z`. BPM reverts to pre-drag value (one undo, not many). Same for swing and volume. Tab-focus BPM, type a value, press Tab to blur. `Ctrl+Z`. BPM reverts.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(history): gesture brackets for BPM/swing/volume"
```

---

### Task 12: Knobs — all eight call sites

**Files:**

- Modify: `src/modulation/modulation-ui.ts`
- Modify: `src/engines/subtractive.ts`
- Modify: `src/core/drum-master-ui.ts`
- Modify: `src/arp/arp-ui.ts`
- Modify: `src/engines/engine-ui.ts`
- Modify: `src/core/fx-ui.ts`
- Modify: `src/core/mixer.ts`

- [ ] **Step 1: Locate each `createKnob(` call**

Run: `grep -n "createKnob(" src/modulation/modulation-ui.ts src/engines/subtractive.ts src/core/drum-master-ui.ts src/arp/arp-ui.ts src/engines/engine-ui.ts src/core/fx-ui.ts src/core/mixer.ts`.

- [ ] **Step 2: Thread `historyDeps` through each UI module**

Each of these UI modules already takes a deps object. Add `historyDeps: HistoryDeps` to that deps interface, and pass it from `main.ts`.

`src/core/knob.ts` does not need to import `HistoryDeps` — the helper returns plain callbacks that go into `KnobOpts.onGestureStart` / `onGestureEnd`.

- [ ] **Step 3: Apply `attachKnobUndo` at each call site**

For every `createKnob(...)` call in the seven files, spread the helper into the opts:

Before:

```typescript
const knob = createKnob({
  min: 0, max: 1, value: 0.5,
  onChange: (v) => { /* ... */ },
});
```

After:

```typescript
const knob = createKnob({
  min: 0, max: 1, value: 0.5,
  onChange: (v) => { /* ... */ },
  ...attachKnobUndo(deps.historyDeps),
});
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke test**

Start dev. Drag any knob. Release. `Ctrl+Z`. Knob value reverts to pre-drag value as a single step.

- [ ] **Step 6: Commit**

```bash
git add src/modulation/modulation-ui.ts src/engines/subtractive.ts src/core/drum-master-ui.ts src/arp/arp-ui.ts src/engines/engine-ui.ts src/core/fx-ui.ts src/core/mixer.ts src/main.ts
git commit -m "feat(history): attachKnobUndo at every createKnob call site"
```

---

### Task 13: Modulation routing add/remove + modulation knobs

**Files:**

- Modify: `src/modulation/modulation-ui.ts`

- [ ] **Step 1: Find the mutation buttons**

Inside `modulation-ui.ts`, locate the buttons that add a modulator, remove a modulator, change a routing target, or toggle a routing's enabled state. Also find any `select.addEventListener('change')` that changes routing.

- [ ] **Step 2: Wrap each discrete handler with `withUndo`**

```typescript
addModBtn.addEventListener('click', () => {
  withUndo(deps.historyDeps, () => {
    // existing add-modulator code
  });
});
```

Modulation knobs (depth, rate) were already covered by Task 12's blanket pass through `attachKnobUndo`.

- [ ] **Step 3: Smoke test**

Add a modulator. `Ctrl+Z`. It disappears. Change a routing target. `Ctrl+Z`. It reverts.

- [ ] **Step 4: Commit**

```bash
git add src/modulation/modulation-ui.ts
git commit -m "feat(history): wrap modulation routing mutations"
```

---

### Task 14: Piano-roll note drag

**Files:**

- Modify: `src/core/pianoroll.ts`

- [ ] **Step 1: Identify the drag entry / exit points**

In `pianoroll.ts`, find the `pointerdown` and `pointerup` handlers that bracket a note edit (drag, resize, create-by-drag, delete-by-shift-click).

- [ ] **Step 2: Bracket each edit gesture**

Inject `historyDeps` into the pianoroll's deps interface. At gesture start (pointerdown that begins an edit), call:

```typescript
deps.historyDeps.history.beginGesture(deps.historyDeps.snapshot());
```

At gesture end (pointerup, cancellation, or escape), call:

```typescript
deps.historyDeps.history.commitGesture();
```

For one-shot edits (single click that mutates), use `withUndo(deps.historyDeps, () => { … })` instead.

- [ ] **Step 3: Smoke test**

Open a clip in the piano-roll. Drag a note to a new pitch. Release. `Ctrl+Z`. Note jumps back. Create a note by drag. `Ctrl+Z`. Note removed.

- [ ] **Step 4: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(history): gesture brackets in piano-roll edits"
```

---

## Phase F — Load callsites clear history

### Task 15: `history.clear()` after every load

**Files:**

- Modify: `src/save/save-wiring.ts`
- Modify: `src/save/save-wiring.ts` (bootRecoveryLoad path)
- Modify: `src/main.ts` (any other load paths, including demo loader)

- [ ] **Step 1: Expose `history` to load callsites**

`save-wiring.ts`'s `SaveWiringDeps` already gets the full set of runtime objects. Extend it with `history: HistoryController<SavedStateV3>` and pass it from `main.ts`.

- [ ] **Step 2: Clear after each `applyLoadedState` call**

Inside `applyLoadedState` in `save-wiring.ts`, after the function call to `applyLoadedStateV3(s, deps)` completes, call:

```typescript
deps.history.clear();
```

This covers the file-load handler, the autosave-load handler, and the per-entry-load handler — all three end up in `applyLoadedState`.

In `bootRecoveryLoad`: also call `deps.history.clear()` after the recovery succeeds.

In `main.ts`: locate the demo-loader call (`fetchDemoSession` / `setupInitialPattern`) and any other place that calls `sessionHost.applyLoadedSessionState` directly. After each, call `history.clear()`.

- [ ] **Step 3: Smoke test**

Make a change, observe `Ctrl+Z` reverts. Click Load and load a save. `Ctrl+Z` should now be a no-op (history was cleared) — no jumping back to pre-load state.

- [ ] **Step 4: Commit**

```bash
git add src/save/save-wiring.ts src/main.ts
git commit -m "feat(history): clear stack on every load path"
```

---

## Phase G — End-to-end

### Task 16: Playwright smoke test

**Files:**

- Create: `tests/e2e/undo.spec.ts`

- [ ] **Step 1: Write the smoke**

Create `tests/e2e/undo.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('Ctrl+Z reverts a sequencer step toggle', async ({ page }) => {
  await page.goto('/');

  // Find the first bass step cell. Selector follows existing rebuildTracks
  // structure: bass row, first step button.
  const firstStep = page.locator('.bass-cell button.step, .bass-cell .step').first();
  await expect(firstStep).toBeVisible();

  // Capture initial class state (on vs off).
  const initialClass = await firstStep.getAttribute('class');

  // Toggle the step on.
  await firstStep.click();
  const afterClickClass = await firstStep.getAttribute('class');
  expect(afterClickClass).not.toBe(initialClass);

  // Ctrl+Z to undo.
  await page.keyboard.press('Control+z');

  // The class should match the initial state.
  await expect(firstStep).toHaveAttribute('class', initialClass ?? '');
});

test('Ctrl+Shift+Z redoes a sequencer step toggle', async ({ page }) => {
  await page.goto('/');

  const firstStep = page.locator('.bass-cell button.step, .bass-cell .step').first();
  const initialClass = await firstStep.getAttribute('class');

  await firstStep.click();
  const afterClickClass = await firstStep.getAttribute('class');

  await page.keyboard.press('Control+z');
  await expect(firstStep).toHaveAttribute('class', initialClass ?? '');

  await page.keyboard.press('Control+Shift+z');
  await expect(firstStep).toHaveAttribute('class', afterClickClass ?? '');
});
```

If the selectors above do not match the actual DOM, replace with whatever existing e2e tests use to target bass cells.

- [ ] **Step 2: Run it**

Run: `NO_COLOR=1 npm run test:e2e -- undo.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/undo.spec.ts
git commit -m "test(e2e): undo/redo smoke for sequencer step"
```

---

## Phase H — Verification

### Task 17: Full test pass + manual exploratory

- [ ] **Step 1: Run the full suite**

Run: `NO_COLOR=1 npm test`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual exploratory pass**

Start dev: `npm run dev`. Walk every interaction class:

- Toggle a step → `Ctrl+Z` reverts.
- Drag a knob → `Ctrl+Z` reverts to pre-drag value as one step.
- Drag BPM → `Ctrl+Z` reverts as one step.
- Change kit → `Ctrl+Z` reverts.
- Apply a preset → `Ctrl+Z` reverts.
- Add a scene → `Ctrl+Z` removes it.
- Add a clip → `Ctrl+Z` removes it.
- Make several changes, hit `Ctrl+Z` repeatedly until the stack is empty, then `Ctrl+Shift+Z` repeatedly to redo every one.
- After 100+ changes, oldest entries silently drop (maxSize).
- Click Save then Load. After Load, `Ctrl+Z` is a no-op (history was cleared).
- Type into the save-name prompt. `Ctrl+Z` in the prompt does native undo of typing, not app undo.

Note any interaction where undo behaves wrong; file follow-up tickets but do not block merge unless it breaks data.

- [ ] **Step 4: Final commit if any cleanup**

```bash
git add -A
git commit -m "chore(history): exploratory polish"
```

(Skip if nothing to commit.)
