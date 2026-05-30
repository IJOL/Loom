# Clip-editor Zoom (Ableton-style scrub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add horizontal (time) and vertical (pitch) zoom to the piano-roll clip editor, driven by Ableton-style scrub gestures (drag the time ruler to zoom time, drag the piano keyboard to zoom pitch; native scrollbars pan).

**Architecture:** Approach A from the spec — the editor frame becomes a 2×2 CSS grid of three canvases (top **ruler**, left **keyboard**, and an oversized **grid** inside a scroll viewport). Zoom is expressed relative to "fit" (`zoom=1` ⇒ whole clip fits the viewport), and the grid canvas is capped at 32 000 px so any clip length works. The grid canvas keeps the existing note-editing pointer logic almost verbatim (it only loses the in-canvas keyboard column). Zoom math lives in a separate pure module; per-clip zoom/scroll persists in an in-memory `Map` keyed by `clip.id` (no saved-state schema change). Drum-grid editor is untouched.

**Tech Stack:** TypeScript, Canvas 2D, Vite, Vitest (node env; jsdom available per-file via docblock). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-30-clip-editor-zoom-design.md`

---

## Scope Check

Single subsystem (one editor surface). One plan, one branch (`clip-editor-zoom` worktree, already created). No decomposition needed.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/pianoroll-zoom.ts` *(new)* | Pure zoom math + `ViewState` type + per-clip default/resolve helpers. No DOM. |
| `src/core/pianoroll-zoom.test.ts` *(new)* | Unit tests for the pure math (node env). |
| `src/core/pianoroll-frame.test.ts` *(new)* | jsdom structural test that `buildEditorFrame` creates the three surfaces. |
| `src/core/pianoroll.ts` *(rewrite)* | Builds the 2×2 frame (`buildEditorFrame`), draws grid/ruler/keys, wires scrub-zoom + scroll sync, keeps note-editing pointer logic. Exposes `createPianoRoll` + `buildEditorFrame` + `PianoRollHandle`. |
| `src/session/clip-editors/clip-editor-router.ts` *(modify)* | Mounts the editor into the host, owns the `viewStateByClip` map, passes data + view-state callbacks. |

No CSS-file edits: piano-roll styling is inline in JS today; the new frame keeps that convention.

**Type/name contract used across tasks (define once, reuse exactly):**

```ts
// pianoroll-zoom.ts
export interface ViewState { zoomX: number; zoomY: number; scrollLeft: number; scrollTop: number; }
export const MAX_CANVAS_PX = 32000;
export const MAX_ROW_PX = 28;
export function defaultViewState(): ViewState
export function maxZoomX(viewportWidth: number): number
export function maxZoomY(viewportHeight: number, noteCount: number): number
export function clampZoom(zoom: number, max: number): number
export function scrubToZoom(zoom: number, dyPx: number, k?: number): number
export function zoomAroundAnchor(scroll: number, anchorPx: number, oldDim: number, newDim: number): number
export function resolveViewState(map: Map<string, ViewState>, clipId: string): ViewState

// pianoroll.ts
export interface PianoRollHandle { redraw: () => void }
export interface PianoRollFrame {
  frame: HTMLDivElement; rulerWrap: HTMLDivElement; keysWrap: HTMLDivElement; gridVp: HTMLDivElement;
  rulerCanvas: HTMLCanvasElement; keysCanvas: HTMLCanvasElement; gridCanvas: HTMLCanvasElement;
}
export function buildEditorFrame(host: HTMLElement): PianoRollFrame
export function createPianoRoll(opts: PianoRollOpts): PianoRollHandle
```

> **Commit convention:** this repo uses Conventional Commits (`feat`, `test`, `refactor`, `docs`). Every commit message must end with the trailer:
> `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
> Run all commands from the worktree root: `C:\Users\nacho\git\tb303-synth\.claude\worktrees\clip-editor-zoom`.

---

## Task 1: Pure zoom math module

**Files:**
- Create: `src/core/pianoroll-zoom.ts`
- Test: `src/core/pianoroll-zoom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/pianoroll-zoom.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  defaultViewState, maxZoomX, maxZoomY, clampZoom, scrubToZoom,
  zoomAroundAnchor, resolveViewState, MAX_CANVAS_PX, MAX_ROW_PX,
  type ViewState,
} from './pianoroll-zoom';

describe('pianoroll-zoom math', () => {
  it('defaultViewState is the fit view (1×, no scroll)', () => {
    expect(defaultViewState()).toEqual({ zoomX: 1, zoomY: 1, scrollLeft: 0, scrollTop: 0 });
  });

  it('maxZoomX bounds the grid canvas to MAX_CANVAS_PX', () => {
    expect(maxZoomX(800)).toBeCloseTo(MAX_CANVAS_PX / 800);
    // never below fit, even for a viewport wider than the cap
    expect(maxZoomX(MAX_CANVAS_PX * 2)).toBe(1);
  });

  it('maxZoomY bounds rows to MAX_ROW_PX tall', () => {
    // 61 rows fitted in 300px -> can zoom in until each row is MAX_ROW_PX
    expect(maxZoomY(300, 61)).toBeCloseTo((MAX_ROW_PX * 61) / 300);
    expect(maxZoomY(10000, 4)).toBe(1); // already taller-than-cap -> no zoom-in
  });

  it('clampZoom keeps zoom within [1, max]', () => {
    expect(clampZoom(0.3, 40)).toBe(1);
    expect(clampZoom(100, 40)).toBe(40);
    expect(clampZoom(5, 40)).toBe(5);
  });

  it('scrubToZoom: drag down zooms in, drag up zooms out, monotonic', () => {
    expect(scrubToZoom(1, 100)).toBeGreaterThan(1);
    expect(scrubToZoom(2, -100)).toBeLessThan(2);
    expect(scrubToZoom(1, 0)).toBe(1);
    expect(scrubToZoom(1, 200)).toBeGreaterThan(scrubToZoom(1, 100));
  });

  it('zoomAroundAnchor keeps the point under the cursor fixed', () => {
    // cursor at viewport px 100; content doubles in size -> scroll so the
    // same content point stays under px 100.
    const scroll = zoomAroundAnchor(0, 100, 1000, 2000);
    expect(scroll).toBe(100);
    // content point under cursor before: (0+100)=100px of 1000 -> 10%.
    // after: 10% of 2000 = 200px content; 200 - scroll(100) = 100 viewport px. fixed.
    expect((100 - 0) / 1000).toBeCloseTo((200 - scroll) / 2000);
  });

  it('zoomAroundAnchor never returns a negative scroll', () => {
    expect(zoomAroundAnchor(0, 50, 2000, 1000)).toBe(0);
  });

  it('resolveViewState returns stored state or the fit default', () => {
    const map = new Map<string, ViewState>();
    expect(resolveViewState(map, 'a')).toEqual(defaultViewState());
    const v: ViewState = { zoomX: 3, zoomY: 2, scrollLeft: 40, scrollTop: 10 };
    map.set('a', v);
    expect(resolveViewState(map, 'a')).toBe(v);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/pianoroll-zoom.test.ts`
Expected: FAIL — `Failed to resolve import "./pianoroll-zoom"` / module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/pianoroll-zoom.ts`:

```ts
// Pure zoom/scroll math for the piano-roll clip editor. No DOM access — all
// functions are deterministic and unit-tested. Zoom is expressed relative to
// "fit": zoom === 1 means the whole clip fits the viewport on that axis.

export interface ViewState {
  zoomX: number;      // horizontal zoom, >= 1 (1 = fit clip width)
  zoomY: number;      // vertical zoom, >= 1 (1 = fit all pitch rows)
  scrollLeft: number; // px
  scrollTop: number;  // px
}

/** Browser canvas dimension ceiling (Chrome/Firefox ~32767). Keep margin. */
export const MAX_CANVAS_PX = 32000;
/** Tallest a single pitch row may get when zoomed in. */
export const MAX_ROW_PX = 28;

export function defaultViewState(): ViewState {
  return { zoomX: 1, zoomY: 1, scrollLeft: 0, scrollTop: 0 };
}

/** Max horizontal zoom so the grid canvas never exceeds MAX_CANVAS_PX. */
export function maxZoomX(viewportWidth: number): number {
  return Math.max(1, MAX_CANVAS_PX / Math.max(1, viewportWidth));
}

/** Max vertical zoom so a row never exceeds MAX_ROW_PX. */
export function maxZoomY(viewportHeight: number, noteCount: number): number {
  return Math.max(1, (MAX_ROW_PX * noteCount) / Math.max(1, viewportHeight));
}

/** Clamp a zoom factor to [1, max]. */
export function clampZoom(zoom: number, max: number): number {
  return Math.min(Math.max(zoom, 1), max);
}

/** Map a vertical scrub delta (px) to a multiplicative zoom change.
 *  Dragging down (positive dy) zooms in. Caller clamps the result. */
export function scrubToZoom(zoom: number, dyPx: number, k = 0.006): number {
  return zoom * Math.exp(dyPx * k);
}

/** New scroll offset that keeps the content point under `anchorPx`
 *  (a viewport-relative pixel) stationary when a dimension changes from
 *  `oldDim` to `newDim`. Result is clamped to >= 0 (upper bound is left to
 *  the scroll container, which clamps on assignment). */
export function zoomAroundAnchor(scroll: number, anchorPx: number, oldDim: number, newDim: number): number {
  const ratio = newDim / Math.max(1, oldDim);
  return Math.max(0, (scroll + anchorPx) * ratio - anchorPx);
}

/** Stored view-state for a clip, or the fit default. */
export function resolveViewState(map: Map<string, ViewState>, clipId: string): ViewState {
  return map.get(clipId) ?? defaultViewState();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/pianoroll-zoom.test.ts`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/pianoroll-zoom.ts src/core/pianoroll-zoom.test.ts
git commit -m "$(cat <<'EOF'
feat(pianoroll): pure zoom/scroll math module

Fit-relative zoom helpers (clamp, scrub→zoom, anchor, caps) + ViewState
type and per-clip resolve/default. No DOM; fully unit-tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Editor-frame builder (+ jsdom structural test)

Adds `buildEditorFrame` to `pianoroll.ts` **alongside** the existing (old) `createPianoRoll`, so the app keeps compiling. Task 3 will consume it.

**Files:**
- Modify: `src/core/pianoroll.ts` (add export, keep everything else)
- Test: `src/core/pianoroll-frame.test.ts` (new, jsdom)

- [ ] **Step 1: Write the failing test**

Create `src/core/pianoroll-frame.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { buildEditorFrame } from './pianoroll';

describe('buildEditorFrame', () => {
  it('builds the three editor surfaces inside the host', () => {
    const host = document.createElement('div');
    const f = buildEditorFrame(host);

    expect(host.querySelector('.pr-frame')).not.toBeNull();
    expect(f.rulerCanvas.tagName).toBe('CANVAS');
    expect(f.keysCanvas.tagName).toBe('CANVAS');
    expect(f.gridCanvas.tagName).toBe('CANVAS');
    // the grid viewport is the only scroller (both axes)
    expect(f.gridVp.style.overflow).toBe('auto');
    // ruler/keys live outside the scroller so they can stay pinned
    expect(f.rulerWrap.contains(f.gridVp)).toBe(false);
  });

  it('clears the host before building (idempotent re-render)', () => {
    const host = document.createElement('div');
    host.innerHTML = '<span class="stale"></span>';
    buildEditorFrame(host);
    expect(host.querySelector('.stale')).toBeNull();
    expect(host.querySelectorAll('.pr-frame').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/pianoroll-frame.test.ts`
Expected: FAIL — `buildEditorFrame` is not exported.

- [ ] **Step 3: Add the frame builder**

In `src/core/pianoroll.ts`, add these constants near the top (below the existing `BLACK_KEY_PCS` line) and the exported function + interface (place the interface near `PianoRollHandle`). Do **not** modify the existing `createPianoRoll` in this task.

```ts
// Frame geometry (CSS px).
const KEYS_W = 42;
const RULER_H = 26;
const FRAME_H = 320; // total editor height; grid viewport gets FRAME_H - RULER_H

export interface PianoRollFrame {
  frame: HTMLDivElement;
  rulerWrap: HTMLDivElement; keysWrap: HTMLDivElement; gridVp: HTMLDivElement;
  rulerCanvas: HTMLCanvasElement; keysCanvas: HTMLCanvasElement; gridCanvas: HTMLCanvasElement;
}

/** Build the 2×2 editor frame (corner / ruler / keyboard / grid-viewport)
 *  inside `host`. Ruler and keyboard live OUTSIDE the scroll viewport so they
 *  can be pinned (repositioned via transform) as the grid scrolls. */
export function buildEditorFrame(host: HTMLElement): PianoRollFrame {
  host.innerHTML = '';

  const frame = document.createElement('div');
  frame.className = 'pr-frame';
  Object.assign(frame.style, {
    display: 'grid',
    gridTemplateColumns: `${KEYS_W}px 1fr`,
    gridTemplateRows: `${RULER_H}px 1fr`,
    height: `${FRAME_H}px`,
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const corner = document.createElement('div');
  corner.className = 'pr-corner';
  Object.assign(corner.style, { background: '#202020', borderRight: '1px solid #2a2a2a', borderBottom: '1px solid #2a2a2a' } as Partial<CSSStyleDeclaration>);

  const mkWrap = (cls: string, cursor: string): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, { overflow: 'hidden', position: 'relative', cursor } as Partial<CSSStyleDeclaration>);
    return d;
  };
  const mkCanvas = (absolute: boolean): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    if (absolute) Object.assign(c.style, { position: 'absolute', top: '0', left: '0', display: 'block' } as Partial<CSSStyleDeclaration>);
    else c.style.display = 'block';
    return c;
  };

  const rulerWrap = mkWrap('pr-ruler', 'ns-resize');
  rulerWrap.style.borderBottom = '1px solid #2a2a2a';
  rulerWrap.style.background = '#181818';
  const rulerCanvas = mkCanvas(true);
  rulerWrap.appendChild(rulerCanvas);

  const keysWrap = mkWrap('pr-keys', 'ns-resize');
  keysWrap.style.borderRight = '1px solid #2a2a2a';
  keysWrap.style.background = '#1a1a1a';
  const keysCanvas = mkCanvas(true);
  keysWrap.appendChild(keysCanvas);

  const gridVp = document.createElement('div');
  gridVp.className = 'pr-grid-vp';
  Object.assign(gridVp.style, { overflow: 'auto', position: 'relative', background: '#0a0a0a' } as Partial<CSSStyleDeclaration>);
  const gridCanvas = mkCanvas(false);
  gridVp.appendChild(gridCanvas);

  // Auto-placement fills the grid row-major: corner, ruler, keys, grid.
  frame.append(corner, rulerWrap, keysWrap, gridVp);
  host.appendChild(frame);

  return { frame, rulerWrap, keysWrap, gridVp, rulerCanvas, keysCanvas, gridCanvas };
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/pianoroll-frame.test.ts`
Expected: PASS — 2 tests pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/pianoroll.ts src/core/pianoroll-frame.test.ts
git commit -m "$(cat <<'EOF'
feat(pianoroll): editor-frame builder (ruler/keys/grid)

Adds buildEditorFrame: 2×2 grid with the ruler and keyboard outside the
scroll viewport so they can be pinned. jsdom structural test. createPianoRoll
unchanged for now.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rewrite `createPianoRoll` for zoom + rewire the router

This single task changes `PianoRollOpts` (drops `canvas`/`scrollContainer`, adds `host`/`viewState`/`onViewChange`) **and** the only caller (the router), committed together so the project always compiles.

**Files:**
- Modify (rewrite body): `src/core/pianoroll.ts`
- Modify: `src/session/clip-editors/clip-editor-router.ts`

- [ ] **Step 1: Replace `pianoroll.ts` with the zoom-aware implementation**

Overwrite `src/core/pianoroll.ts` with the following. (Keep `buildEditorFrame`, `KEYS_W`, `RULER_H`, `FRAME_H`, and `PianoRollFrame` from Task 2 — they are included below so the file is complete.)

```ts
// Piano-roll editor for a NoteEvent[] array. Drag-create, drag-move,
// drag-resize from the right edge, alt-click / right-click to delete.
// Ableton-style zoom: scrub the time ruler (↕ zoom time, ↔ pan) and the piano
// keyboard (↕ zoom pitch); native scrollbars pan. Snap defaults to 16th notes.

import { TICKS_PER_STEP, type NoteEvent } from './notes';
import {
  clampZoom, scrubToZoom, zoomAroundAnchor, maxZoomX, maxZoomY,
  defaultViewState, type ViewState,
} from './pianoroll-zoom';

export interface PianoRollOpts {
  /** Host element; the editor frame is built inside it. */
  host: HTMLElement;
  getNotes: () => NoteEvent[];
  setNotes: (notes: NoteEvent[]) => void;
  patternTicks: number;
  minMidi?: number;
  maxMidi?: number;
  snapTicks?: number;
  onChange?: () => void;
  getPlayheadTick?: () => number; // -1 when not playing
  /** Initial zoom/scroll for this clip (defaults to fit). */
  viewState?: ViewState;
  /** Called on every zoom/scroll so the caller can persist per-clip state. */
  onViewChange?: (v: ViewState) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  onGestureCancel?: () => void;
}

export interface PianoRollHandle {
  redraw: () => void;
}

const BLACK_KEY_PCS = [1, 3, 6, 8, 10];

// Frame geometry (CSS px).
const KEYS_W = 42;
const RULER_H = 26;
const FRAME_H = 320; // total editor height; grid viewport gets FRAME_H - RULER_H

export interface PianoRollFrame {
  frame: HTMLDivElement;
  rulerWrap: HTMLDivElement; keysWrap: HTMLDivElement; gridVp: HTMLDivElement;
  rulerCanvas: HTMLCanvasElement; keysCanvas: HTMLCanvasElement; gridCanvas: HTMLCanvasElement;
}

/** Build the 2×2 editor frame (corner / ruler / keyboard / grid-viewport)
 *  inside `host`. Ruler and keyboard live OUTSIDE the scroll viewport so they
 *  can be pinned (repositioned via transform) as the grid scrolls. */
export function buildEditorFrame(host: HTMLElement): PianoRollFrame {
  host.innerHTML = '';

  const frame = document.createElement('div');
  frame.className = 'pr-frame';
  Object.assign(frame.style, {
    display: 'grid',
    gridTemplateColumns: `${KEYS_W}px 1fr`,
    gridTemplateRows: `${RULER_H}px 1fr`,
    height: `${FRAME_H}px`,
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const corner = document.createElement('div');
  corner.className = 'pr-corner';
  Object.assign(corner.style, { background: '#202020', borderRight: '1px solid #2a2a2a', borderBottom: '1px solid #2a2a2a' } as Partial<CSSStyleDeclaration>);

  const mkWrap = (cls: string, cursor: string): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, { overflow: 'hidden', position: 'relative', cursor } as Partial<CSSStyleDeclaration>);
    return d;
  };
  const mkCanvas = (absolute: boolean): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    if (absolute) Object.assign(c.style, { position: 'absolute', top: '0', left: '0', display: 'block' } as Partial<CSSStyleDeclaration>);
    else c.style.display = 'block';
    return c;
  };

  const rulerWrap = mkWrap('pr-ruler', 'ns-resize');
  rulerWrap.style.borderBottom = '1px solid #2a2a2a';
  rulerWrap.style.background = '#181818';
  const rulerCanvas = mkCanvas(true);
  rulerWrap.appendChild(rulerCanvas);

  const keysWrap = mkWrap('pr-keys', 'ns-resize');
  keysWrap.style.borderRight = '1px solid #2a2a2a';
  keysWrap.style.background = '#1a1a1a';
  const keysCanvas = mkCanvas(true);
  keysWrap.appendChild(keysCanvas);

  const gridVp = document.createElement('div');
  gridVp.className = 'pr-grid-vp';
  Object.assign(gridVp.style, { overflow: 'auto', position: 'relative', background: '#0a0a0a' } as Partial<CSSStyleDeclaration>);
  const gridCanvas = mkCanvas(false);
  gridVp.appendChild(gridCanvas);

  frame.append(corner, rulerWrap, keysWrap, gridVp);
  host.appendChild(frame);

  return { frame, rulerWrap, keysWrap, gridVp, rulerCanvas, keysCanvas, gridCanvas };
}

function ctx2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = cv.getContext('2d');
  if (!c) throw new Error('canvas 2d context unavailable');
  return c;
}

function setSize(cv: HTMLCanvasElement, w: number, h: number): void {
  cv.width = w; cv.height = h;
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
}

export function createPianoRoll(opts: PianoRollOpts): PianoRollHandle {
  const minMidi = opts.minMidi ?? 36;
  const maxMidi = opts.maxMidi ?? 96;
  const snap = opts.snapTicks ?? TICKS_PER_STEP;
  const noteCount = maxMidi - minMidi + 1;

  const f = buildEditorFrame(opts.host);
  const gctx = ctx2d(f.gridCanvas);
  const rctx = ctx2d(f.rulerCanvas);
  const kctx = ctx2d(f.keysCanvas);

  // View state (mutable). Initialised from the caller, defaults to fit.
  let { zoomX, zoomY, scrollLeft, scrollTop } = opts.viewState ?? defaultViewState();
  // Geometry derived from zoom + viewport (recomputed in geom()).
  let gridW = 0, gridH = 0, pxPerTick = 0, rowHeight = 0;

  const xForTick = (t: number) => t * pxPerTick;
  const yForMidi = (m: number) => (maxMidi - m) * rowHeight;
  const tickFromX = (x: number) => Math.max(0, Math.min(opts.patternTicks - 1, pxPerTick > 0 ? x / pxPerTick : 0));
  const midiFromY = (y: number) => maxMidi - Math.max(0, Math.min(noteCount - 1, Math.floor(rowHeight > 0 ? y / rowHeight : 0)));

  function geom(): void {
    const vw = f.gridVp.clientWidth || 1;
    const vh = f.gridVp.clientHeight || 1;
    zoomX = clampZoom(zoomX, maxZoomX(vw));
    zoomY = clampZoom(zoomY, maxZoomY(vh, noteCount));
    gridW = Math.round(vw * zoomX);
    gridH = Math.round(vh * zoomY);
    pxPerTick = gridW / opts.patternTicks;
    rowHeight = gridH / noteCount;
  }

  function drawGrid(): void {
    const w = gridW, h = gridH;
    gctx.fillStyle = '#0a0a0a'; gctx.fillRect(0, 0, w, h);
    for (let i = 0; i < noteCount; i++) {
      const midi = maxMidi - i;
      if (BLACK_KEY_PCS.includes(((midi % 12) + 12) % 12)) {
        gctx.fillStyle = '#161616'; gctx.fillRect(0, i * rowHeight, w, rowHeight);
      }
      if (midi % 12 === 0) {
        gctx.strokeStyle = '#2a2a2a';
        gctx.beginPath(); gctx.moveTo(0, i * rowHeight); gctx.lineTo(w, i * rowHeight); gctx.stroke();
      }
    }
    const steps = opts.patternTicks / TICKS_PER_STEP;
    for (let s = 0; s <= steps; s++) {
      const x = s * TICKS_PER_STEP * pxPerTick;
      if (s % 16 === 0) gctx.strokeStyle = '#555';
      else if (s % 4 === 0) gctx.strokeStyle = '#2f2f2f';
      else gctx.strokeStyle = '#1c1c1c';
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, h); gctx.stroke();
    }
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const x = xForTick(n.start), x2 = xForTick(n.start + n.duration), y = yForMidi(n.midi);
      gctx.fillStyle = n.velocity >= 100 ? '#ffaa44' : '#3498db';
      gctx.fillRect(x + 1, y + 1, Math.max(2, x2 - x - 2), rowHeight - 2);
      gctx.strokeStyle = '#0a0a0a'; gctx.strokeRect(x + 0.5, y + 0.5, x2 - x - 1, rowHeight - 1);
    }
    const ph = opts.getPlayheadTick?.() ?? -1;
    if (ph >= 0) {
      const x = xForTick(ph);
      gctx.strokeStyle = '#f7d000'; gctx.lineWidth = 1;
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, h); gctx.stroke();
      // Follow the playhead horizontally (assignment triggers the scroll
      // listener, which re-pins the strips and persists).
      if (gridW > f.gridVp.clientWidth) {
        const target = Math.max(0, x - f.gridVp.clientWidth / 2);
        if (Math.abs(f.gridVp.scrollLeft - target) > 2) f.gridVp.scrollLeft = target;
      }
    }
  }

  function drawRuler(): void {
    rctx.fillStyle = '#181818'; rctx.fillRect(0, 0, gridW, RULER_H);
    const steps = opts.patternTicks / TICKS_PER_STEP;
    for (let s = 0; s <= steps; s++) {
      const x = s * TICKS_PER_STEP * pxPerTick;
      if (s % 16 === 0) {
        rctx.strokeStyle = '#6a6a6a';
        rctx.beginPath(); rctx.moveTo(x, 4); rctx.lineTo(x, RULER_H); rctx.stroke();
        rctx.fillStyle = '#c8c8c8'; rctx.font = '11px ui-monospace, monospace'; rctx.textBaseline = 'middle';
        rctx.fillText(String(s / 16 + 1), x + 4, RULER_H / 2);
      } else if (s % 4 === 0) {
        rctx.strokeStyle = '#333';
        rctx.beginPath(); rctx.moveTo(x, RULER_H - 8); rctx.lineTo(x, RULER_H); rctx.stroke();
      }
    }
  }

  function drawKeys(): void {
    kctx.fillStyle = '#1a1a1a'; kctx.fillRect(0, 0, KEYS_W, gridH);
    for (let i = 0; i < noteCount; i++) {
      const midi = maxMidi - i, pc = ((midi % 12) + 12) % 12;
      kctx.fillStyle = BLACK_KEY_PCS.includes(pc) ? '#0e0e0e' : '#1f1f1f';
      kctx.fillRect(0, i * rowHeight, KEYS_W - 1, rowHeight);
      kctx.strokeStyle = '#070707'; kctx.strokeRect(0, i * rowHeight + 0.5, KEYS_W - 1, rowHeight);
      if (pc === 0 && rowHeight >= 9) {
        kctx.fillStyle = '#9a9a9a'; kctx.font = '9px ui-monospace, monospace'; kctx.textBaseline = 'middle';
        kctx.fillText(`C${Math.floor(midi / 12) - 1}`, 4, i * rowHeight + rowHeight / 2);
      }
    }
  }

  function syncStrips(): void {
    f.rulerCanvas.style.transform = `translateX(${-f.gridVp.scrollLeft}px)`;
    f.keysCanvas.style.transform = `translateY(${-f.gridVp.scrollTop}px)`;
  }
  function persist(): void {
    opts.onViewChange?.({ zoomX, zoomY, scrollLeft: f.gridVp.scrollLeft, scrollTop: f.gridVp.scrollTop });
  }

  /** Full relayout: resize all canvases, redraw all three surfaces. */
  function layoutAll(): void {
    geom();
    setSize(f.gridCanvas, gridW, gridH);
    setSize(f.rulerCanvas, gridW, RULER_H);
    setSize(f.keysCanvas, KEYS_W, gridH);
    drawGrid(); drawRuler(); drawKeys();
  }

  // ── Scroll: re-pin strips + persist ───────────────────────────────────────
  f.gridVp.addEventListener('scroll', () => {
    scrollLeft = f.gridVp.scrollLeft; scrollTop = f.gridVp.scrollTop;
    syncStrips(); persist();
  });

  // ── Ruler scrub: ↕ zoom-H (anchored), ↔ pan-H ─────────────────────────────
  let rulerDrag = false, rLastX = 0, rLastY = 0;
  f.rulerWrap.addEventListener('pointerdown', (e) => {
    rulerDrag = true; rLastX = e.clientX; rLastY = e.clientY;
    f.rulerWrap.setPointerCapture(e.pointerId); e.preventDefault();
  });
  f.rulerWrap.addEventListener('pointermove', (e) => {
    if (!rulerDrag) return;
    const dy = e.clientY - rLastY, dx = e.clientX - rLastX;
    rLastX = e.clientX; rLastY = e.clientY;
    const oldGridW = gridW;
    zoomX = scrubToZoom(zoomX, dy);
    geom();
    setSize(f.gridCanvas, gridW, gridH); setSize(f.rulerCanvas, gridW, RULER_H);
    drawGrid(); drawRuler();
    const anchorPx = e.clientX - f.rulerWrap.getBoundingClientRect().left;
    f.gridVp.scrollLeft = zoomAroundAnchor(f.gridVp.scrollLeft, anchorPx, oldGridW, gridW) - dx;
    syncStrips(); persist();
  });
  const rulerEnd = (e: PointerEvent) => { rulerDrag = false; try { f.rulerWrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  f.rulerWrap.addEventListener('pointerup', rulerEnd);
  f.rulerWrap.addEventListener('pointercancel', rulerEnd);

  // ── Keyboard scrub: ↕ zoom-V (anchored) ───────────────────────────────────
  let keysDrag = false, kLastY = 0;
  f.keysWrap.addEventListener('pointerdown', (e) => {
    keysDrag = true; kLastY = e.clientY;
    f.keysWrap.setPointerCapture(e.pointerId); e.preventDefault();
  });
  f.keysWrap.addEventListener('pointermove', (e) => {
    if (!keysDrag) return;
    const dy = e.clientY - kLastY; kLastY = e.clientY;
    const oldGridH = gridH;
    zoomY = scrubToZoom(zoomY, dy);
    geom();
    setSize(f.gridCanvas, gridW, gridH); setSize(f.keysCanvas, KEYS_W, gridH);
    drawGrid(); drawKeys();
    const anchorPy = e.clientY - f.keysWrap.getBoundingClientRect().top;
    f.gridVp.scrollTop = zoomAroundAnchor(f.gridVp.scrollTop, anchorPy, oldGridH, gridH);
    syncStrips(); persist();
  });
  const keysEnd = (e: PointerEvent) => { keysDrag = false; try { f.keysWrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  f.keysWrap.addEventListener('pointerup', keysEnd);
  f.keysWrap.addEventListener('pointercancel', keysEnd);

  // ── Note editing on the grid (unchanged logic, sans keyboard column) ──────
  type Interaction = { type: 'move' | 'resize'; note: NoteEvent; offsetTick: number };
  let interaction: Interaction | null = null;
  let gestureMutated = false;

  const isResizeEdge = (n: NoteEvent, tick: number) => {
    const edgeRange = Math.max(snap / 3, 6);
    return tick >= n.start + n.duration - edgeRange && tick <= n.start + n.duration + edgeRange / 2;
  };
  const findNoteAt = (tick: number, midi: number): NoteEvent | null => {
    const notes = opts.getNotes();
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.midi === midi && tick >= n.start && tick < n.start + n.duration) return n;
    }
    return null;
  };
  const pointerPos = (e: PointerEvent) => {
    const rect = f.gridCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return { tick: tickFromX(x), midi: midiFromY(y) };
  };

  f.gridCanvas.addEventListener('pointerdown', (e) => {
    const { tick, midi } = pointerPos(e);

    if (e.altKey || e.button === 2) {
      const hit = findNoteAt(tick, midi);
      if (hit) {
        opts.onGestureStart?.();
        opts.setNotes(opts.getNotes().filter((n) => n !== hit));
        opts.onChange?.();
        drawGrid();
        opts.onGestureEnd?.();
      }
      e.preventDefault();
      return;
    }

    opts.onGestureStart?.();
    gestureMutated = false;

    const hit = findNoteAt(tick, midi);
    if (hit) {
      if (isResizeEdge(hit, tick)) interaction = { type: 'resize', note: hit, offsetTick: 0 };
      else interaction = { type: 'move', note: hit, offsetTick: tick - hit.start };
    } else {
      const snappedStart = Math.floor(tick / snap) * snap;
      const newNote: NoteEvent = { start: snappedStart, duration: snap, midi, velocity: 80 };
      opts.getNotes().push(newNote);
      interaction = { type: 'resize', note: newNote, offsetTick: 0 };
      gestureMutated = true;
      opts.onChange?.();
    }
    f.gridCanvas.setPointerCapture(e.pointerId);
    drawGrid();
    e.preventDefault();
  });

  f.gridCanvas.addEventListener('pointermove', (e) => {
    const { tick, midi } = pointerPos(e);
    if (!interaction) {
      const hit = findNoteAt(tick, midi);
      f.gridCanvas.style.cursor = hit ? (isResizeEdge(hit, tick) ? 'ew-resize' : 'move') : 'crosshair';
      return;
    }
    if (interaction.type === 'move') {
      const newStart = Math.max(0, Math.floor((tick - interaction.offsetTick) / snap) * snap);
      const maxStart = opts.patternTicks - interaction.note.duration;
      interaction.note.start = Math.min(maxStart, newStart);
      interaction.note.midi = Math.max(minMidi, Math.min(maxMidi, midi));
    } else {
      const newDur = Math.max(snap, Math.ceil((tick - interaction.note.start) / snap) * snap);
      interaction.note.duration = Math.min(opts.patternTicks - interaction.note.start, newDur);
    }
    gestureMutated = true;
    drawGrid();
    opts.onChange?.();
  });

  const endDrag = (e: PointerEvent) => {
    if (!interaction) return;
    interaction = null;
    try { f.gridCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (gestureMutated) opts.onGestureEnd?.();
    else opts.onGestureCancel?.();
  };
  f.gridCanvas.addEventListener('pointerup', endDrag);
  f.gridCanvas.addEventListener('pointercancel', endDrag);
  f.gridCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Initial mount ─────────────────────────────────────────────────────────
  let lastVW = f.gridVp.clientWidth, lastVH = f.gridVp.clientHeight;
  layoutAll();
  f.gridVp.scrollLeft = scrollLeft;
  f.gridVp.scrollTop = scrollTop;
  syncStrips();

  // redraw() runs every animation frame (driven by session-host's RAF loop) to
  // animate the playhead. It also cheaply detects a viewport resize and does a
  // full relayout when needed — so there is NO window 'resize' listener to leak
  // across clip re-renders.
  function redraw(): void {
    const vw = f.gridVp.clientWidth, vh = f.gridVp.clientHeight;
    if (vw !== lastVW || vh !== lastVH) {
      lastVW = vw; lastVH = vh;
      layoutAll();
      f.gridVp.scrollLeft = scrollLeft; f.gridVp.scrollTop = scrollTop;
      syncStrips();
    } else {
      drawGrid();
    }
  }

  return { redraw };
}
```

> **Note on the `window` resize listener:** the editor is re-rendered (`host.innerHTML = ''`) whenever a clip opens, so a new `createPianoRoll` adds a fresh `resize` listener while the old DOM is discarded. This is a small known leak in the same spirit as the existing visualizer/listener hygiene debt; it is bounded (one per clip-open) and acceptable for this change. (All other listeners are on elements that are discarded on re-render, so they do not leak.)

- [ ] **Step 2: Rewire the router**

Overwrite `src/session/clip-editors/clip-editor-router.ts` with:

```ts
// src/session/clip-editors/clip-editor-router.ts
// Detects the engine assigned to the lane and dispatches to the matching
// editor (piano-roll or drum-grid). Falls back to piano-roll if engine has
// no explicit preference.

import type { SessionClip, SessionLane } from '../session';
import type { Sequencer } from '../../core/sequencer';
import type { LanePlayState } from '../session-runtime';
import { createPianoRoll, type PianoRollHandle } from '../../core/pianoroll';
import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';
import { resolveViewState, type ViewState } from '../../core/pianoroll-zoom';
import { getEngine } from '../../engines/registry';
import { renderDrumGridEditor } from './clip-editor-drum-grid';
import type { HistoryDeps } from '../../save/history-wiring';

export interface ClipEditorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  laneStates: Map<string, LanePlayState>;
  midiLabel: (m: number) => string;
  historyDeps?: HistoryDeps;
}

// In-memory per-clip zoom/scroll. Mirrors the editorOverride map: persists for
// the session, resets on reload. No saved-state schema change.
const viewStateByClip = new Map<string, ViewState>();

export function renderClipEditor(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  override?: 'piano-roll' | 'drum-grid',
): PianoRollHandle | null {
  host.innerHTML = '';
  const engine = getEngine(lane.engineId);
  const editor = override ?? engine?.editor ?? 'piano-roll';

  if (editor === 'drum-grid') {
    renderDrumGridEditor(host, clip, deps.historyDeps);
    return null;
  }
  return buildPianoRoll(host, lane, clip, deps);
}

function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
): PianoRollHandle {
  const getNotes = (): NoteEvent[] => clip.notes ?? [];
  const setNotes = (notes: NoteEvent[]) => { clip.notes = notes; };

  const isBassLikeEngine = lane.engineId === 'tb303';
  const { ctx, seq, laneStates, historyDeps } = deps;
  return createPianoRoll({
    host,
    getNotes,
    setNotes,
    patternTicks: clip.lengthBars * 16 * TICKS_PER_STEP,
    minMidi: isBassLikeEngine ? 24 : 36,
    maxMidi: isBassLikeEngine ? 60 : 96,
    onChange: () => {},
    getPlayheadTick: () => {
      const lp = laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const now = ctx.currentTime;
      const stepDur = 60 / seq.bpm / 4;
      const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * 16;
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    },
    viewState: resolveViewState(viewStateByClip, clip.id),
    onViewChange: (v) => { viewStateByClip.set(clip.id, v); },
    ...(historyDeps ? {
      onGestureStart:  () => historyDeps.history.beginGesture(historyDeps.snapshot()),
      onGestureEnd:    () => historyDeps.history.commitGesture(),
      onGestureCancel: () => historyDeps.history.cancelGesture(),
    } : {}),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms `PianoRollOpts` no longer has `canvas`/`scrollContainer` and the router compiles against the new shape; `session-inspector.ts` and `randomize-ui.ts` only use the `PianoRollHandle` type and `.redraw()`, which are unchanged.)

- [ ] **Step 4: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS — all existing tests plus the two new ones (`pianoroll-zoom`, `pianoroll-frame`).

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev` and open <http://localhost:5173>. Then:
1. Load/keep a session that has a melodic (piano-roll) lane — e.g. a `tb303` or `subtractive` lane with a clip that has notes (the demo loader provides these). Click the clip so the inspector editor renders.
2. **Layout:** ruler strip on top, piano keyboard on the left, note grid in between; the whole clip fits at first (fit = `zoom 1×`).
3. **Time zoom:** drag **↕ on the ruler** → grid zooms horizontally, anchored under the cursor; drag **↔ on the ruler** → pans horizontally.
4. **Pitch zoom:** drag **↕ on the keyboard** → grid zooms vertically, anchored under the cursor.
5. **Pan:** the viewport scrollbars pan both axes; the ruler and keyboard stay pinned and aligned.
6. **Note editing still works:** click-drag to create, drag to move, drag the right edge to resize, alt-click / right-click to delete. Undo/redo (if wired) still brackets each gesture.
7. **Playhead:** play the clip → the yellow playhead animates and the view follows it horizontally when zoomed in.
8. **Persistence:** zoom in, switch to another clip and back → zoom/scroll restored. Reload the page → resets to fit.
9. **Long clip (optional):** a many-bar clip fits at `1×` and zooms in without a blank/broken canvas.

Confirm each behaves as described before committing.

- [ ] **Step 6: Commit**

```bash
git add src/core/pianoroll.ts src/session/clip-editors/clip-editor-router.ts
git commit -m "$(cat <<'EOF'
feat(pianoroll): Ableton-style scrub zoom (both axes)

createPianoRoll now builds the 2×2 frame and zooms: scrub the time ruler
for time zoom (↕) / pan (↔), scrub the keyboard for pitch zoom (↕); native
scrollbars pan. Per-clip zoom/scroll persists in memory in the router.
Note-editing logic preserved (grid drops only the in-canvas keyboard column).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full regression + production build

**Files:** none (verification only; commit only if a fix is needed).

- [ ] **Step 1: Production build (typecheck + bundle)**

Run: `npm run build`
Expected: `tsc` passes and `vite build` writes `dist/` with no errors.

- [ ] **Step 2: Fast test layer (non-DSP)**

Run: `npm run test:fast`
Expected: PASS. (DSP renders are unaffected by this UI change; skipping them here keeps the loop fast. Run `npm run test:unit` already done in Task 3.)

- [ ] **Step 3: Commit only if Step 1/2 required a fix**

If a typecheck/build error forced a change, commit it:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(pianoroll): resolve build/typecheck issue from zoom rewrite

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Otherwise there is nothing to commit — note "build clean, no changes" and finish.

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Piano-roll only; drum-grid untouched | Task 3 (router still dispatches `drum-grid` to `renderDrumGridEditor`) |
| Both axes zoom | Task 3 (ruler ↕ = zoomX, keyboard ↕ = zoomY) |
| Scrub on time ruler (↕ zoom, ↔ pan) | Task 3 (ruler handlers) |
| Scrub on keyboard (↕ zoom pitch) | Task 3 (keys handlers) |
| Native scrollbars pan; scrub never pans (except ruler ↔) | Task 3 (`gridVp` overflow auto + scroll listener) |
| Fit-relative zoom, 32k cap, row cap | Task 1 (`maxZoomX`/`maxZoomY`) + Task 3 (`geom`) |
| Pure helpers `fit`/`clamp`/`anchor`/`scrub` | Task 1 + tests |
| Three pinned surfaces (ruler/keys/grid) | Task 2 (`buildEditorFrame`) + Task 3 (`syncStrips`) |
| Grid drops `KEYS_W` offset; note editing intact | Task 3 (`pointerPos`, no `rawX<KEYS_W` guard) |
| Playhead-follow preserved, retargeted to `gridVp` | Task 3 (`drawGrid` follow block) |
| In-memory per-clip persistence; no schema change | Task 3 (`viewStateByClip` in router) |
| API gains `viewState` + `onViewChange` | Task 3 (`PianoRollOpts`) |
| Tests: pure math (layer 1) + DOM-light sanity | Task 1 (`pianoroll-zoom.test.ts`) + Task 2 (`pianoroll-frame.test.ts`, jsdom) |

No gaps.

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to". Every code step shows full code; every run step shows the command and expected result.

**3. Type/name consistency:** `ViewState`, `PianoRollFrame`, `PianoRollHandle`, `buildEditorFrame`, `createPianoRoll`, `viewStateByClip`, `resolveViewState`, `zoomAroundAnchor`, `scrubToZoom`, `maxZoomX`, `maxZoomY`, `clampZoom`, `defaultViewState` are used identically across Tasks 1–3. `createPianoRoll` opts (`host`, `getNotes`, `setNotes`, `patternTicks`, `minMidi`, `maxMidi`, `getPlayheadTick`, `viewState`, `onViewChange`, gesture callbacks) match exactly between the `pianoroll.ts` definition (Task 3 Step 1) and the router call (Task 3 Step 2). `redraw` is the sole `PianoRollHandle` member, matching the RAF caller in `session-host.ts:664` and `randomize-ui.ts:49`.
