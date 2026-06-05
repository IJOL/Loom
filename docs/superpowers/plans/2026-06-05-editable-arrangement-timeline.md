# Editable arrangement timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user move, resize and delete clip bands directly on the Performance timeline (adjust existing only), with beat-snap, ripple, and undo.

**Architecture:** A new pure module `arrangement-edit.ts` does all the math on `ArrangementClipEvent[]` (move/resize/delete + snap + ripple), returning fresh arrays. `makeClipBand` gains drag-to-move (body), resize handles, and a delete button, updating the DOM imperatively during the gesture and applying the pure model on `pointerup`. A dedicated `HistoryController<ArrangementState>` in `performance-feature` gives the arrangement its own undo, with Ctrl+Z routed by mode. The runtime (`arrangement-runtime.ts`) and model (`performance.ts`) are unchanged.

**Tech Stack:** TypeScript, Web Audio, Vite, Vitest (pure logic), Playwright (e2e). Single test file colour-free: `NO_COLOR=1 npx vitest run <path>`. Build before any e2e (`npm run build`). Assertions relative.

**Reference:** spec at [docs/superpowers/specs/2026-06-05-editable-arrangement-timeline-design.md](../specs/2026-06-05-editable-arrangement-timeline-design.md).

---

## File Structure
- `src/performance/arrangement-edit.ts` *(new)* — pure `snapSecToBeat`, `moveEvent`, `resizeEvent`, `deleteEvent` over `ArrangementClipEvent[]`.
- `src/performance/arrangement-edit.test.ts` *(new)* — unit tests.
- `src/performance/performance-ui.ts` *(modify)* — `makeClipBand` interaction + `PerfUICallbacks` fields.
- `src/app/performance-feature.ts` *(modify)* — dedicated arrangement history, Ctrl+Z routing, callbacks wiring, `onPerformanceEdited`.
- `src/styles/_performance-view.scss` *(modify)* — handle/delete/grab cursors.
- `tests/e2e/arrangement-edit.spec.ts` *(new)* — drag/resize/delete/undo e2e.

---

### Task 1: Pure `snapSecToBeat` + `moveEvent` (ripple)

**Files:**
- Create: `src/performance/arrangement-edit.ts`
- Test: `src/performance/arrangement-edit.test.ts`

- [ ] **Step 1: Write the failing test**

`src/performance/arrangement-edit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { snapSecToBeat, moveEvent } from './arrangement-edit';
import type { ArrangementClipEvent } from './performance';

const E = (id: string, at: number, until: number): ArrangementClipEvent =>
  ({ clipId: id, laneId: 'L', atSec: at, untilSec: until });

describe('snapSecToBeat (120 bpm → 0.5s per beat)', () => {
  it('rounds to the nearest beat', () => {
    expect(snapSecToBeat(0.24, 120)).toBeCloseTo(0.0, 6);
    expect(snapSecToBeat(0.26, 120)).toBeCloseTo(0.5, 6);
    expect(snapSecToBeat(1.1, 120)).toBeCloseTo(1.0, 6);
  });
});

describe('moveEvent', () => {
  it('moves a band to a free slot, snapped, keeping its duration', () => {
    const events = [E('a', 0, 2), E('b', 4, 6)];
    const out = moveEvent(events, 1, 2.1, 120); // move b near 2.0
    const b = out.find((e) => e.clipId === 'b')!;
    expect(b.atSec).toBeCloseTo(2.0, 6);
    expect(b.untilSec - b.atSec).toBeCloseTo(2.0, 6); // duration preserved
  });
  it('does not mutate the input array', () => {
    const events = [E('a', 0, 2)];
    const copy = JSON.parse(JSON.stringify(events));
    moveEvent(events, 0, 4, 120);
    expect(events).toEqual(copy);
  });
  it('ripples following bands forward to avoid overlap', () => {
    const events = [E('a', 0, 2), E('b', 2, 4)];
    // drag a's right so it now spans [0,3]? No — move a to start at 1 → [1,3], collides with b[2,4]
    const out = moveEvent(events, 0, 1, 120).sort((x, y) => x.atSec - y.atSec);
    // a is at [1,3]; b must be pushed to start at 3 (a.untilSec), keeping its 2s duration → [3,5]
    const a = out.find((e) => e.clipId === 'a')!;
    const b = out.find((e) => e.clipId === 'b')!;
    expect(a.atSec).toBeCloseTo(1, 6);
    expect(b.atSec).toBeCloseTo(3, 6);
    expect(b.untilSec).toBeCloseTo(5, 6);
  });
  it('clamps atSec to >= 0', () => {
    const out = moveEvent([E('a', 2, 4)], 0, -1, 120);
    expect(out[0].atSec).toBe(0);
    expect(out[0].untilSec).toBeCloseTo(2, 6);
  });
});
```

(Delete the stray `ev` helper — keep only `E`. It's shown here so the engineer removes the misleading duplicate before running.)

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-edit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/performance/arrangement-edit.ts`**

```ts
// Pure editing math for the arrangement timeline. Operates on ArrangementClipEvent[]
// (one lane's bands), always returns a NEW array (never mutates input). Seconds in,
// seconds out; bpm drives the beat snap. Ripple pushes overlapping bands forward so a
// lane stays ordered by atSec with no overlaps.
import type { ArrangementClipEvent } from './performance';

export function snapSecToBeat(sec: number, bpm: number): number {
  const beat = 60 / bpm;
  return Math.round(sec / beat) * beat;
}

/** Sort by atSec and push any band that overlaps its predecessor forward to the
 *  predecessor's untilSec (keeping its own duration), cascading. Pure. */
function rippleForward(events: ArrangementClipEvent[]): ArrangementClipEvent[] {
  const out = [...events].sort((a, b) => a.atSec - b.atSec);
  for (let i = 1; i < out.length; i++) {
    if (out[i].atSec < out[i - 1].untilSec) {
      const dur = out[i].untilSec - out[i].atSec;
      const at = out[i - 1].untilSec;
      out[i] = { ...out[i], atSec: at, untilSec: at + dur };
    }
  }
  return out;
}

export function moveEvent(
  events: ArrangementClipEvent[], index: number, newAtSec: number, bpm: number,
): ArrangementClipEvent[] {
  const cur = events[index];
  if (!cur) return events;
  const dur = cur.untilSec - cur.atSec;
  const at = Math.max(0, snapSecToBeat(newAtSec, bpm));
  const moved = { ...cur, atSec: at, untilSec: at + dur };
  const next = events.map((e, i) => (i === index ? moved : e));
  return rippleForward(next);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-edit.ts src/performance/arrangement-edit.test.ts
git commit -m "feat(arrangement-edit): pure snapSecToBeat + moveEvent with ripple"
```

---

### Task 2: `resizeEvent` + `deleteEvent`

**Files:**
- Modify: `src/performance/arrangement-edit.ts`
- Test: `src/performance/arrangement-edit.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append:

```ts
import { resizeEvent, deleteEvent } from './arrangement-edit';

describe('resizeEvent', () => {
  it('end edge extends untilSec (snapped) and ripples the next band', () => {
    const events = [E('a', 0, 2), E('b', 2, 4)];
    const out = resizeEvent(events, 0, 'end', 3.1, 120); // a → [0,3]
    const a = out.find((e) => e.clipId === 'a')!;
    const b = out.find((e) => e.clipId === 'b')!;
    expect(a.untilSec).toBeCloseTo(3, 6);
    expect(b.atSec).toBeCloseTo(3, 6); // pushed
  });
  it('start edge moves atSec (snapped), keeping at least one beat', () => {
    const out = resizeEvent([E('a', 0, 2)], 0, 'start', 1.1, 120); // → [1,2]
    expect(out[0].atSec).toBeCloseTo(1, 6);
    expect(out[0].untilSec).toBeCloseTo(2, 6);
  });
  it('enforces a 1-beat minimum width on the end edge', () => {
    const out = resizeEvent([E('a', 0, 2)], 0, 'end', 0.1, 120); // try to shrink below a beat
    expect(out[0].untilSec - out[0].atSec).toBeGreaterThanOrEqual(0.5 - 1e-9); // 1 beat at 120
  });
  it('enforces a 1-beat minimum width on the start edge', () => {
    const out = resizeEvent([E('a', 0, 2)], 0, 'start', 1.9, 120); // try to push start past end-beat
    expect(out[0].untilSec - out[0].atSec).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });
});

describe('deleteEvent', () => {
  it('removes the band and leaves the gap (others unchanged)', () => {
    const events = [E('a', 0, 2), E('b', 4, 6)];
    const out = deleteEvent(events, 0);
    expect(out).toHaveLength(1);
    expect(out[0].clipId).toBe('b');
    expect(out[0].atSec).toBe(4); // not rippled
  });
  it('does not mutate the input', () => {
    const events = [E('a', 0, 2)];
    deleteEvent(events, 0);
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-edit.test.ts`
Expected: FAIL — `resizeEvent`/`deleteEvent` not exported.

- [ ] **Step 3: Implement (append to `arrangement-edit.ts`)**

```ts
export function resizeEvent(
  events: ArrangementClipEvent[], index: number, edge: 'start' | 'end', newSec: number, bpm: number,
): ArrangementClipEvent[] {
  const cur = events[index];
  if (!cur) return events;
  const beat = 60 / bpm;
  const snapped = snapSecToBeat(newSec, bpm);
  let resized: ArrangementClipEvent;
  if (edge === 'start') {
    const at = Math.max(0, Math.min(snapped, cur.untilSec - beat));
    resized = { ...cur, atSec: at };
  } else {
    const until = Math.max(cur.atSec + beat, snapped);
    resized = { ...cur, untilSec: until };
  }
  const next = events.map((e, i) => (i === index ? resized : e));
  return rippleForward(next);
}

export function deleteEvent(
  events: ArrangementClipEvent[], index: number,
): ArrangementClipEvent[] {
  return events.filter((_, i) => i !== index);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-edit.test.ts`
Expected: PASS (all of Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-edit.ts src/performance/arrangement-edit.test.ts
git commit -m "feat(arrangement-edit): resizeEvent (1-beat min, ripple) + deleteEvent (keeps gap)"
```

---

### Task 3: Dedicated arrangement undo + Ctrl+Z routing

**Files:**
- Modify: `src/app/performance-feature.ts`

- [ ] **Step 1: Add a dedicated history + edit-commit helpers**

In `src/app/performance-feature.ts`, import `createHistory` and the editors at the top:

```ts
import { createHistory } from '../core/history';
import { moveEvent, resizeEvent, deleteEvent } from '../performance/arrangement-edit';
```

Inside `createPerformanceFeature`, after `const arrangementPlayState = ...`:

```ts
  // The session history deliberately excludes the arrangement; give the arrangement
  // its OWN undo stack so timeline edits (and length/brace) are undoable without
  // coupling to session undo.
  const arrHistory = createHistory<ArrangementState>({ maxSize: 100 });
  const snapArr = (): ArrangementState => JSON.parse(JSON.stringify(arrangement));
  const restoreArr = (s: ArrangementState) => { setArrangement(s); };
  /** Snapshot before a discrete arrangement edit. */
  const commitArrUndo = () => arrHistory.commit(snapArr());
```

- [ ] **Step 2: Wire `onPerformanceEdited` to the arrangement history**

`onPerformanceEdited` is currently undefined (length/brace/curves edits aren't undoable). Replace the `onPerformanceEdited?.()` call sites' dependency by making the feature snapshot before those edits. Concretely, in `refreshPerformanceView`, the `onSetLengthBars`/`onSetLoop`/`onAddCurve`/`onRemoveCurve` callbacks already call `onPerformanceEdited?.()` AFTER mutating. Change them to snapshot BEFORE mutating via a local `beforeEdit()`:

```ts
  const beforeEdit = () => commitArrUndo();
```

Then in the `renderPerformanceView({...})` options, prefix the mutating callbacks with `beforeEdit()`. For example change:

```ts
      onSetLoop: (enabled, startBar, endBar) => {
        beforeEdit();
        arrangement.loopEnabled = enabled; arrangement.loopStartBar = startBar; arrangement.loopEndBar = endBar;
        refreshPerformanceView();
      },
      onSetLengthBars: (bars) => { beforeEdit(); setArrangementLengthBars(arrangement, bars); refreshPerformanceView(); },
      onAddCurve: (paramId) => { beforeEdit(); addAutomationCurve(arrangement, paramId, laneIds()); refreshPerformanceView(); },
      onRemoveCurve: (paramId) => { beforeEdit(); removeAutomationCurve(arrangement, paramId, laneIds()); refreshPerformanceView(); },
```

(Keep `onEdited: () => { onPerformanceEdited?.(); }` for the automation painter; that path stays as-is.)

- [ ] **Step 3: Route Ctrl+Z / Ctrl+Shift+Z by mode**

Add a keydown listener inside `createPerformanceFeature` (after `setMode` is defined). It only acts in Performance mode; otherwise it lets the session handler run:

```ts
  document.addEventListener('keydown', (e) => {
    if (mode !== 'performance') return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      const prev = arrHistory.undo(snapArr());
      if (prev) { e.preventDefault(); e.stopPropagation(); restoreArr(prev); }
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      const next = arrHistory.redo(snapArr());
      if (next) { e.preventDefault(); e.stopPropagation(); restoreArr(next); }
    }
  }, true); // capture phase so it beats the session handler
```

(`stopPropagation` + capture phase ensures the session `wireHistoryKeyboard` handler doesn't ALSO fire in Performance mode.)

- [ ] **Step 4: Expose band-edit callbacks (used by Task 4)**

Still inside `createPerformanceFeature`, add helpers that the UI will call (one snapshot per gesture). Add them so Task 4's `renderPerformanceView` wiring can reference them:

```ts
  function editBands(laneId: string, fn: (events: import('../performance/performance').ArrangementClipEvent[]) => import('../performance/performance').ArrangementClipEvent[]) {
    const lane = arrangement.lanes.find((l) => l.laneId === laneId);
    if (!lane) return;
    lane.clipEvents = fn(lane.clipEvents);
    refreshPerformanceView();
  }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (the new code compiles; `ArrangementState`/`ArrangementClipEvent` are imported types).

- [ ] **Step 6: Commit**

```bash
git add src/app/performance-feature.ts
git commit -m "feat(arrangement): dedicated undo stack + Ctrl+Z routed by mode; length/brace now undoable"
```

---

### Task 4: Band move/resize/delete UI + wiring + e2e

**Files:**
- Modify: `src/performance/performance-ui.ts` (`makeClipBand`, `PerfUICallbacks`, `renderPerformanceView`)
- Modify: `src/app/performance-feature.ts` (`refreshPerformanceView` wiring)
- Modify: `src/styles/_performance-view.scss`
- Create: `tests/e2e/arrangement-edit.spec.ts`

- [ ] **Step 1: Extend `PerfUICallbacks`** — in `performance-ui.ts`, add:

```ts
  onMoveBand: (laneId: string, index: number, newAtSec: number) => void;
  onResizeBand: (laneId: string, index: number, edge: 'start' | 'end', newSec: number) => void;
  onDeleteBand: (laneId: string, index: number) => void;
```

- [ ] **Step 2: Add interaction in `makeClipBand`** — it needs `laneId`, `bpm`, `pxPerBar` and the callbacks. `makeClipBand` already receives `laneRec` (has `laneId`), `bpm`, `pxPerBar`. Pass `cb: PerfUICallbacks` too. For each band element `el` (index `i` in `laneRec.clipEvents`), after setting its left/width/colour/text, add handles + delete + body drag:

```ts
    const secPerPx = barSec / pxPerBar; // inverse of the draw scale
    // resize handles
    const hL = document.createElement('span'); hL.className = 'perf-clip-handle l';
    const hR = document.createElement('span'); hR.className = 'perf-clip-handle r';
    // delete button
    const del = document.createElement('button'); del.className = 'perf-clip-del'; del.textContent = '×';
    del.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    del.addEventListener('click', (e) => { e.stopPropagation(); cb.onDeleteBand(laneRec.laneId, i); });
    // body drag = move
    el.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const baseAt = ev.atSec;
      const move = (e: PointerEvent) => {
        const dxSec = (e.clientX - startX) * secPerPx;
        el.style.left = `${((baseAt + dxSec) / barSec) * pxPerBar}px`;
      };
      const up = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const dxSec = (e.clientX - startX) * secPerPx;
        cb.onMoveBand(laneRec.laneId, i, baseAt + dxSec);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    const resize = (edge: 'start' | 'end') => (down: PointerEvent) => {
      down.preventDefault(); down.stopPropagation();
      const move = (e: PointerEvent) => {
        const rect = track.getBoundingClientRect();
        const sec = ((e.clientX - rect.left) / pxPerBar) * barSec;
        if (edge === 'start') el.style.left = `${(sec / barSec) * pxPerBar}px`;
        else el.style.width = `${Math.max(8, (sec - ev.atSec) / barSec * pxPerBar)}px`;
      };
      const up = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const rect = track.getBoundingClientRect();
        const sec = ((e.clientX - rect.left) / pxPerBar) * barSec;
        cb.onResizeBand(laneRec.laneId, i, edge, sec);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    hL.addEventListener('pointerdown', resize('start'));
    hR.addEventListener('pointerdown', resize('end'));
    el.append(hL, hR, del);
```

`ev` is the loop variable (`for (const ev of laneRec.clipEvents)`); change it to an indexed loop so `i` exists: `laneRec.clipEvents.forEach((ev, i) => { ... })`. `track` is the `.perf-track` div created in `makeClipBand`. Pass `cb` into `makeClipBand` and update its call in `renderPerformanceView` (`makeClipBand(lane, dur, state.bpm, cb.pxPerBar, cb.resolveClipColor, cb.resolveClipName, cb)`).

- [ ] **Step 3: Add styles** — in `_performance-view.scss`, inside `.performance-view`:

```scss
  .perf-clip { cursor: grab; }
  .perf-clip:active { cursor: grabbing; }
  .perf-clip-handle { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; opacity: 0; }
  .perf-clip-handle.l { left: 0; } .perf-clip-handle.r { right: 0; }
  .perf-clip:hover .perf-clip-handle { opacity: 1; background: rgba(0,0,0,0.25); }
  .perf-clip-del {
    position: absolute; top: 1px; right: 2px; width: 14px; height: 14px; line-height: 12px;
    padding: 0; border: none; border-radius: 3px; background: rgba(0,0,0,0.35); color: #fff;
    font-size: 11px; cursor: pointer; opacity: 0;
  }
  .perf-clip:hover .perf-clip-del { opacity: 1; }
```

- [ ] **Step 4: Wire callbacks in `performance-feature.ts`** — in the `renderPerformanceView({...})` options (using `editBands` + the pure editors + `commitArrUndo` from Task 3):

```ts
      onMoveBand: (laneId, index, newAtSec) => { commitArrUndo(); editBands(laneId, (evs) => moveEvent(evs, index, newAtSec, arrangement.bpm)); },
      onResizeBand: (laneId, index, edge, newSec) => { commitArrUndo(); editBands(laneId, (evs) => resizeEvent(evs, index, edge, newSec, arrangement.bpm)); },
      onDeleteBand: (laneId, index) => { commitArrUndo(); editBands(laneId, (evs) => deleteEvent(evs, index)); },
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 6: Write the e2e** — `tests/e2e/arrangement-edit.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0, { timeout: 10_000 });
}
async function openPerf(page: Page): Promise<void> {
  await page.goto('/'); await waitForBoot(page);
  await page.locator('#copy-to-performance').click();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
}
const firstBand = (page: Page) => page.locator('#performance-view-root .perf-clip').first();

test('dragging a band moves it right', async ({ page }) => {
  await openPerf(page);
  const before = await firstBand(page).boundingBox();
  const box = before!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await firstBand(page).boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 20);
});

test('the × button deletes a band', async ({ page }) => {
  await openPerf(page);
  const count0 = await page.locator('#performance-view-root .perf-clip').count();
  await firstBand(page).hover();
  await firstBand(page).locator('.perf-clip-del').click();
  const count1 = await page.locator('#performance-view-root .perf-clip').count();
  expect(count1).toBe(count0 - 1);
});

test('Ctrl+Z restores a deleted band', async ({ page }) => {
  await openPerf(page);
  const count0 = await page.locator('#performance-view-root .perf-clip').count();
  await firstBand(page).hover();
  await firstBand(page).locator('.perf-clip-del').click();
  expect(await page.locator('#performance-view-root .perf-clip').count()).toBe(count0 - 1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#performance-view-root .perf-clip')).toHaveCount(count0);
});
```

- [ ] **Step 7: Build then run e2e**

Run: `npm run build`
Run: `npm run test:e2e -- arrangement-edit`
Expected: PASS (3 tests). If the default session yields a single 1-band lane and the drag test's ripple makes assertions flaky, adjust the drag distance; do not weaken the move assertion below "moved right".

- [ ] **Step 8: Commit**

```bash
git add src/performance/performance-ui.ts src/app/performance-feature.ts src/styles/_performance-view.scss tests/e2e/arrangement-edit.spec.ts
git commit -m "feat(arrangement): move/resize/delete clip bands on the timeline + e2e"
```

---

## Final verification
- [ ] `npm run build` then `npm test` — unit + e2e green (re-run `test:unit` once if it exits on the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown).
- [ ] Audible/visual browser smoke (`npm run dev`): drag a band (snaps to beat, ripples the next), resize from either edge, delete with ×, Ctrl+Z undoes each — only in Performance mode; Session undo unaffected.
