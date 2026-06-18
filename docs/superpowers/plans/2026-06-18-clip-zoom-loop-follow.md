# Clip Zoom + Viewport-Anchored Loop + Opt-out Follow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the loop region track zoom/scroll in the note editor (fix the drift/overflow bug), add horizontal zoom+scroll to the drum and audio clip editors, and add a session-global **Follow** toggle (ON by default) so the view stops chasing the playhead while editing long clips.

**Architecture:** The performance-style loop overlay stops measuring the DOM and instead takes an injected coordinate transform (`tickToX`, `tickFromClientX`, `contentHeight`) and mounts its amber column **inside** each editor's scrollable viewport, so scroll + clipping come for free. Each editor owns the mount (the editor is where the coordinate space lives). Drums and audio gain a horizontal-scroll viewport with a ruler-scrub zoom gesture (reusing the existing `pianoroll-zoom` math). A single session-global flag plus a pure `followScrollTarget()` function drive the playhead auto-scroll, gated by a per-editor Follow button.

**Tech Stack:** TypeScript, Web Audio, Vite, Vitest (unit), Playwright (e2e). Canvas 2D editors. No new dependencies.

## Global Constraints

- All UI strings/labels in **English** (project convention).
- Tests use **relative** assertions (ratios/ordering), never absolute magnitudes (project rule).
- Run vitest colour-free: `NO_COLOR=1 npx vitest run <file>`.
- `npm run test:e2e` / `npm test` serve `dist/` with **no build step** — always `npm run build` before e2e.
- `test:unit` can exit non-zero with `ERR_IPC_CHANNEL_CLOSED` on teardown **after passing** — re-run to confirm; but do NOT assume a real failure is "just teardown" (it can hide real failures — read the actual test output).
- **No saved-state schema change.** Zoom/scroll is in-memory per clip; Follow is in-memory session-global. Both reset on reload.
- Zoom is **horizontal only** for drums and audio. Notes keeps its existing X+Y zoom.
- Worktree: this plan runs in the existing `clip-zoom-loop-follow` worktree. Commit on the branch; rebase onto `main` often; ff-merge at the end (do not push, do not merge without explicit OK).

---

## File Structure

**New files:**
- `src/core/clip-follow.ts` — session-global Follow flag (get/set/toggle) + pure `followScrollTarget()`.
- `src/core/clip-follow.test.ts` — unit tests for the above.

**Modified files:**
- `src/core/clip-loop-overlay.ts` — replace DOM-measuring `contentBox()`/`gridInsetLeft` with injected `tickToX`/`tickFromClientX`/`contentHeight`/`contentTop`; mount the column in an injected `scrollHost`.
- `src/core/clip-editor-toolbar.ts` — add `createFollowToggle()` (a Follow on/off button bound to the global flag).
- `src/core/pianoroll.ts` — accept `opts.loop`, mount the overlay inside `gridVp` with zoom-aware coords; gate the playhead auto-scroll on the Follow flag; add the Follow button; refresh the overlay on zoom/scroll.
- `src/session/clip-editors/clip-editor-router.ts` — stop mounting the overlay externally; pass loop config into the piano-roll and drum-grid; (drums/audio per-clip zoom lives in the editors).
- `src/session/clip-editors/clip-editor-drum-grid.ts` — restructure to a fixed label column + a content canvas inside a horizontal-scroll viewport; ruler-scrub zoom; per-clip zoom/scroll; mount the loop overlay inside the viewport; Follow button + follow scroll.
- `src/session/clip-editors/clip-waveform-header.ts` — wrap waveform (+ warp) in a horizontal-scroll viewport; zoom-aware waveform width; ruler-scrub zoom; per-clip zoom/scroll; loop overlay inside the viewport; Follow button + follow scroll.
- `src/session/clip-editors/warp-marker-editor.ts` — accept a `contentWidth()` so marker x scales with zoom.

**Reused unchanged:** `src/core/pianoroll-zoom.ts` (`clampZoom`, `scrubToZoom`, `zoomAroundAnchor`, `maxZoomX`), `src/core/clip-loop-brace.ts` (`snapTick`, `clampLoopRegion`), `src/core/clip-loop.ts` (`effectiveClipLoop`).

---

## Task 1: Follow flag + `followScrollTarget` (pure, TDD)

**Files:**
- Create: `src/core/clip-follow.ts`
- Test: `src/core/clip-follow.test.ts`

**Interfaces:**
- Produces:
  - `isFollowEnabled(): boolean`
  - `setFollowEnabled(on: boolean): void`
  - `toggleFollow(): boolean` (returns the new state)
  - `followScrollTarget(playheadX: number, viewportWidth: number, contentWidth: number, currentScroll: number, threshold?: number): number | null` — the new `scrollLeft` that centers the playhead, clamped to `[0, contentWidth - viewportWidth]`; returns `null` when there's nothing to scroll (content fits) or the change is below `threshold` (default 2px).

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/clip-follow.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isFollowEnabled, setFollowEnabled, toggleFollow, followScrollTarget,
} from './clip-follow';

describe('Follow flag', () => {
  beforeEach(() => setFollowEnabled(true));

  it('defaults to enabled', () => {
    expect(isFollowEnabled()).toBe(true);
  });
  it('set + toggle update and report state', () => {
    setFollowEnabled(false);
    expect(isFollowEnabled()).toBe(false);
    expect(toggleFollow()).toBe(true);
    expect(isFollowEnabled()).toBe(true);
  });
});

describe('followScrollTarget', () => {
  it('returns null when the content fits the viewport', () => {
    expect(followScrollTarget(50, 400, 400, 0)).toBeNull();
    expect(followScrollTarget(50, 400, 300, 0)).toBeNull();
  });
  it('centers the playhead when zoomed (content wider than viewport)', () => {
    // playhead at 1000, viewport 400 -> target = 1000 - 200 = 800
    expect(followScrollTarget(1000, 400, 4000, 0)).toBe(800);
  });
  it('clamps to [0, contentWidth - viewportWidth]', () => {
    expect(followScrollTarget(50, 400, 4000, 1000)).toBe(0);      // near start
    expect(followScrollTarget(3990, 400, 4000, 0)).toBe(3600);    // near end
  });
  it('returns null when already within threshold of the target', () => {
    // target would be 800; current 799 -> delta 1 < 2 -> null
    expect(followScrollTarget(1000, 400, 4000, 799)).toBeNull();
    expect(followScrollTarget(1000, 400, 4000, 700)).toBe(800);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/core/clip-follow.test.ts`
Expected: FAIL (module `./clip-follow` not found).

- [ ] **Step 3: Implement**

```ts
// src/core/clip-follow.ts
// Session-global "Follow playhead" mode shared by all three clip editors, plus
// the pure scroll-target math. Follow is a working mode (like the draw/select
// tool), not a per-clip property: one flag, ON by default, reset on reload.

let _followEnabled = true;

export function isFollowEnabled(): boolean { return _followEnabled; }
export function setFollowEnabled(on: boolean): void { _followEnabled = on; }
export function toggleFollow(): boolean { _followEnabled = !_followEnabled; return _followEnabled; }

/** New scrollLeft that centers `playheadX` (content-space px) in the viewport,
 *  clamped to the scrollable range. Returns null when the content fits (nothing
 *  to scroll) or the move is below `threshold` (avoids per-frame jitter). */
export function followScrollTarget(
  playheadX: number, viewportWidth: number, contentWidth: number,
  currentScroll: number, threshold = 2,
): number | null {
  const maxScroll = contentWidth - viewportWidth;
  if (maxScroll <= 0) return null;
  const target = Math.max(0, Math.min(maxScroll, playheadX - viewportWidth / 2));
  return Math.abs(currentScroll - target) > threshold ? target : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/core/clip-follow.test.ts`
Expected: PASS (7 assertions across 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/clip-follow.ts src/core/clip-follow.test.ts
git commit -m "feat(clip): session-global Follow flag + pure followScrollTarget"
```

---

## Task 2: Loop overlay takes injected coords + relocates into the editors

This is the core fix. The overlay stops measuring the DOM; each editor injects its coordinate transform and the scrollable element to mount the column in. The note editor mounts it **inside `gridVp`** (fixing the drift/overflow bug). Drums and audio keep their current full-width behavior for now (their zoom comes in Tasks 4–5).

**Files:**
- Modify: `src/core/clip-loop-overlay.ts`
- Modify: `src/core/pianoroll.ts`
- Modify: `src/session/clip-editors/clip-editor-drum-grid.ts`
- Modify: `src/session/clip-editors/clip-editor-router.ts`
- Modify: `src/session/clip-editors/clip-waveform-header.ts`

**Interfaces:**
- Produces: new `ClipLoopOverlayDeps` (below). Consumed by all three editors.
- Consumes: `effectiveClipLoop`, `snapTick`, `clampLoopRegion` (unchanged).

- [ ] **Step 1: Rewrite the overlay API**

Replace the deps interface and the body of `mountClipLoopOverlay` in `src/core/clip-loop-overlay.ts`. Keep the toolbar (toggle / quantize / All channels) and the undo wiring exactly as they are; only the column geometry + drag change. Remove `contentBox`, `gridInsetLeft`, and the `pxToTick` import.

New interface (replaces the old `ClipLoopOverlayDeps`):

```ts
export interface ClipLoopOverlayDeps {
  /** Where the Loop toggle + quantize select (+ optional "All channels") mount. */
  toolbarHost: HTMLElement;
  /** Scrollable element the amber column is appended to. Its `overflow` clips the
   *  column and its scroll moves it. Made `position:relative` if static. */
  scrollHost: HTMLElement;
  clip: SessionClip;
  meter: TimeSignature;
  historyDeps?: HistoryDeps;
  onChange?: () => void;
  applyToAll?: (loopEnabled: boolean, startTick: number, endTick: number) => void;
  /** Content-space x (px) of a tick — i.e. `tick·pxPerTick` (+ any fixed gutter). */
  tickToX: (tick: number) => number;
  /** Inverse for the A/B drag: viewport client x → clip-axis tick in [0,total]. */
  tickFromClientX: (clientX: number) => number;
  /** Column height (the content/grid height) in px. */
  contentHeight: () => number;
  /** Column top within scrollHost; default 0. */
  contentTop?: () => number;
}
```

New body (the column + layout + drag — everything else in the function stays):

```ts
  // ── column overlay (mounted INSIDE the editor's scrollable content) ──
  const host = deps.scrollHost;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const col = document.createElement('div');
  col.className = 'clip-loop-col';
  const hL = document.createElement('span'); hL.className = 'clip-loop-edge l';
  const hR = document.createElement('span'); hR.className = 'clip-loop-edge r';
  col.append(hL, hR);
  host.appendChild(col);

  const layout = () => {
    const { startTick, endTick } = effectiveClipLoop(clip, meter);
    const x0 = deps.tickToX(startTick);
    const x1 = deps.tickToX(endTick);
    col.style.left = `${x0}px`;
    col.style.width = `${Math.max(0, x1 - x0)}px`;
    col.style.top = `${deps.contentTop?.() ?? 0}px`;
    col.style.height = `${deps.contentHeight()}px`;
    col.style.display = clip.loopEnabled ? '' : 'none';
    toggle.classList.toggle('on', !!clip.loopEnabled);
  };

  toggle.addEventListener('click', () => {
    historyDeps?.beginGesture?.();
    clip.loopEnabled = !clip.loopEnabled;
    if (clip.loopEnabled && clip.loopEndTick == null) { clip.loopStartTick = 0; clip.loopEndTick = total; }
    historyDeps?.endGesture?.();
    layout(); deps.onChange?.();
  });
  qsel.addEventListener('change', () => { quantize = (qsel.value as LoopQuantize) || 'bar'; });

  const startDrag = (which: 'l' | 'r') => (down: PointerEvent) => {
    down.preventDefault(); down.stopPropagation();
    if (!clip.loopEnabled) return;
    historyDeps?.beginGesture?.();
    const move = (e: PointerEvent) => {
      const step = snapFor();
      const tick = snapTick(deps.tickFromClientX(e.clientX), step);
      const cur = effectiveClipLoop(clip, meter);
      const next = which === 'l'
        ? clampLoopRegion(tick, cur.endTick, total, step)
        : clampLoopRegion(cur.startTick, tick, total, step);
      clip.loopStartTick = next.start; clip.loopEndTick = next.end;
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      historyDeps?.endGesture?.();
      deps.onChange?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  hL.addEventListener('pointerdown', startDrag('l'));
  hR.addEventListener('pointerdown', startDrag('r'));

  requestAnimationFrame(layout);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layout()).observe(host);
  }
  return { redraw: layout };
```

Update the import line at the top of the file from:
`import { pxToTick, tickToPx, snapTick, clampLoopRegion } from './clip-loop-brace';`
to:
`import { snapTick, clampLoopRegion } from './clip-loop-brace';`

- [ ] **Step 2: Add `loop` opts to the piano-roll and mount inside `gridVp`**

In `src/core/pianoroll.ts`:

Add imports near the top:
```ts
import type { SessionClip } from '../session/session';
import type { TimeSignature } from './meter';
import { mountClipLoopOverlay } from './clip-loop-overlay';
import { isFollowEnabled } from './clip-follow';
import type { HistoryDeps } from '../save/history-wiring';
```
(`HistoryDeps`/`isTextEditTarget` may already be imported from `history-wiring` — merge, don't duplicate.)

Add to `PianoRollOpts`:
```ts
  /** When present, mount the performance-style loop overlay INSIDE the grid
   *  viewport (so it tracks zoom + scroll) and put its toggle/quantize toolbar
   *  in `loop.toolbarHost`. */
  loop?: {
    toolbarHost: HTMLElement;
    clip: SessionClip;
    meter: TimeSignature;
    historyDeps?: HistoryDeps;
    onChange?: () => void;
  };
```

Declare the handle BEFORE `layoutAll` (so the closures see it) — add near the geometry vars (`let gridW = 0, ...`):
```ts
  let loopOverlay: { redraw: () => void } | null = null;
  const refreshLoop = () => loopOverlay?.redraw();
```

In `layoutAll()` add `refreshLoop();` as the last line. In the `f.gridVp` `scroll` listener add `refreshLoop();` after `syncStrips(); persist();`. In the ruler-scrub `pointermove` handler add `refreshLoop();` after `syncStrips(); persist();`. In the keyboard-scrub `pointermove` handler add `refreshLoop();` after `syncStrips(); persist();`.

After the initial mount block (`layoutAll(); f.gridVp.scrollLeft = ...; syncStrips();`), create the overlay:
```ts
  if (opts.loop) {
    loopOverlay = mountClipLoopOverlay({
      toolbarHost: opts.loop.toolbarHost,
      scrollHost: f.gridVp,
      clip: opts.loop.clip,
      meter: opts.loop.meter,
      historyDeps: opts.loop.historyDeps,
      onChange: opts.loop.onChange,
      tickToX: (t) => xForTick(t),
      tickFromClientX: (cx) => {
        const x = cx - f.gridCanvas.getBoundingClientRect().left;
        return pxPerTick > 0 ? Math.max(0, Math.min(opts.patternTicks, x / pxPerTick)) : 0;
      },
      contentHeight: () => gridH,
    });
  }
```

- [ ] **Step 3: Gate the playhead auto-scroll on the Follow flag (notes)**

In `drawGrid()` (`src/core/pianoroll.ts`), wrap the existing follow block:

```ts
      // Follow the playhead horizontally — only when Follow mode is on.
      if (isFollowEnabled() && gridW > f.gridVp.clientWidth) {
        const target = Math.max(0, x - f.gridVp.clientWidth / 2);
        if (Math.abs(f.gridVp.scrollLeft - target) > 2) f.gridVp.scrollLeft = target;
      }
```

(Only the `isFollowEnabled() &&` is added; the rest is the current code.)

- [ ] **Step 4: Add the Follow button helper + put it in the piano-roll toolbar**

In `src/core/clip-editor-toolbar.ts` add:
```ts
import { isFollowEnabled, toggleFollow } from './clip-follow';

/** A "Follow" on/off button bound to the session-global Follow flag. Reflects
 *  the shared state on every render so all editors agree. `onChange` lets the
 *  editor react (e.g. immediately re-evaluate scroll). */
export function createFollowToggle(onChange?: (on: boolean) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'clip-loop-toggle'; // reuse the on/off pill styling
  const refresh = () => {
    btn.textContent = 'Follow';
    btn.classList.toggle('on', isFollowEnabled());
    btn.title = isFollowEnabled() ? 'Follow playhead: ON (view scrolls to the playhead)' : 'Follow playhead: OFF';
  };
  btn.addEventListener('click', () => { const on = toggleFollow(); refresh(); onChange?.(on); });
  refresh();
  return btn;
}
```

In `src/core/pianoroll.ts`, import it and add to the toolbar. Change the import:
```ts
import {
  createToolToggle, createHelpButton, createGridControl, createResolutionSelect, createFollowToggle,
} from './clip-editor-toolbar';
```
And add the button to the toolbar append (currently `f.toolbar.append(drawBtn, selBtn, octCtl, resCtl, help.btn, lockBtn);`):
```ts
  const followBtn = createFollowToggle();
  f.toolbar.append(drawBtn, selBtn, followBtn, octCtl, resCtl, help.btn, lockBtn);
```

- [ ] **Step 5: Add `loop` opts to the drum-grid (full-width for now)**

In `src/session/clip-editors/clip-editor-drum-grid.ts`:

Add imports:
```ts
import { mountClipLoopOverlay } from '../../core/clip-loop-overlay';
```
Add to `DrumEditorDeps`:
```ts
  /** When present, mount the loop overlay over the grid (toolbar in loop.toolbarHost). */
  loop?: {
    toolbarHost: HTMLElement;
    historyDeps?: HistoryDeps;
    onChange?: () => void;
  };
```
After the `resize()` initial mount call near the bottom (after `resize();`), mount the overlay using the current single-canvas coords (preserves today's behavior incl. the LABEL_W gutter):
```ts
  if (deps.loop) {
    const total = patternTicks;
    mountClipLoopOverlay({
      toolbarHost: deps.loop.toolbarHost,
      scrollHost: wrap,
      clip, meter,
      historyDeps: deps.loop.historyDeps,
      onChange: deps.loop.onChange,
      tickToX: (t) => xForTick(t), // = LABEL_W + t·pxPerTick
      tickFromClientX: (cx) => {
        const x = cx - canvas.getBoundingClientRect().left - LABEL_W;
        return pxPerTick > 0 ? Math.max(0, Math.min(total, x / pxPerTick)) : 0;
      },
      contentHeight: () => FRAME_H,
      contentTop: () => canvas.offsetTop,
    });
  }
```
(`meter` is already a parameter of `renderDrumGridEditor`. `wrap` is the editor's root div; the column sits over the canvas. `contentTop` accounts for the toolbar above the canvas inside `wrap`.)

- [ ] **Step 6: Rewire the router — stop mounting externally, pass `loop` into each editor**

In `src/session/clip-editors/clip-editor-router.ts`:

Remove the external loop block (the current `const loopBar = document.createElement('div'); host.insertBefore(loopBar, bodyBox); mountClipLoopOverlay({...});` at lines ~241-249) and the now-unused `mountClipLoopOverlay` import.

Create the loop toolbar host once, above `bodyBox`, and pass it into the editors:
```ts
  const loopBar = document.createElement('div');
  host.insertBefore(loopBar, bodyBox);

  let bodyHandle: PianoRollHandle | null;
  if (editor === 'drum-grid') {
    // ...existing audition + getPlayheadTick + model...
    bodyHandle = renderDrumGridEditor(bodyBox, clip, deps.historyDeps, deps.seq.meter, {
      auditionNote: audition, getPlayheadTick,
      loop: { toolbarHost: loopBar, historyDeps: deps.historyDeps, onChange: () => {} },
    }, model);
  } else {
    bodyHandle = buildPianoRoll(bodyBox, lane, clip, deps, loopBar);
  }
  return combineEditorHandle(headerHandle, bodyHandle);
```

Update `buildPianoRoll` signature to accept the loop bar and pass it through:
```ts
function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  loopBar: HTMLElement,
): PianoRollHandle {
  // ...unchanged setup...
  return createPianoRoll({
    // ...all existing opts...
    loop: { toolbarHost: loopBar, clip, meter: seq.meter, historyDeps, onChange: () => {} },
  });
}
```

- [ ] **Step 7: Update the audio call site to the new API (full-width, unchanged behavior)**

In `src/session/clip-editors/clip-waveform-header.ts`, inside `renderAudioClipEditor`, replace the `mountClipLoopOverlay({ toolbarHost: toolbar, overlayHost: headerHost, ... })` call with:
```ts
  let loopHandle: { redraw: () => void } | undefined;
  if (deps.loop) {
    const total = clip.lengthBars * ticksPerBar(meter);
    const headerWidth = () => Math.max(320, headerHost.clientWidth || 600);
    loopHandle = mountClipLoopOverlay({
      toolbarHost: toolbar,
      scrollHost: headerHost,
      clip, meter,
      historyDeps: deps.loop.historyDeps,
      onChange: deps.loop.onChange,
      applyToAll: deps.loop.applyToAll,
      tickToX: (t) => (t / total) * headerWidth(),
      tickFromClientX: (cx) => {
        const r = headerHost.getBoundingClientRect();
        return Math.max(0, Math.min(total, ((cx - r.left) / Math.max(1, headerWidth())) * total));
      },
      contentHeight: () => RULER_H + WAVE_H,
    });
  }
```
(`ticksPerBar` is already imported in this file; `RULER_H`/`WAVE_H` are module constants.)

- [ ] **Step 8: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: builds to `dist/`.

- [ ] **Step 9: Manual verification (the bug)**

Run the dev server (`npm run dev`), open a **note** clip, drag the time-ruler to zoom in, scroll horizontally. Expected: the amber loop column stays glued to the same bars/notes at every zoom and scroll position, and is clipped to the grid (no overflow onto the keyboard or past the right edge). Drag the A/B edges while zoomed — they snap to the grid under the cursor. Open a **drum** clip and an **audio** clip — the loop column behaves exactly as before (no regression).

- [ ] **Step 10: Commit**

```bash
git add src/core/clip-loop-overlay.ts src/core/clip-editor-toolbar.ts src/core/pianoroll.ts \
  src/session/clip-editors/clip-editor-router.ts src/session/clip-editors/clip-editor-drum-grid.ts \
  src/session/clip-editors/clip-waveform-header.ts
git commit -m "fix(clip-loop): anchor loop overlay inside the editor viewport (zoom/scroll-aware); add Follow toggle to notes"
```

---

## Task 3: Drums — horizontal zoom + scroll + zoom-aware loop + Follow

Restructure the single full-width canvas into a **fixed label column** + a **content canvas inside a horizontal-scroll viewport**. Add a ruler-scrub zoom gesture, per-clip zoom/scroll persistence, the Follow button + follow scroll, and switch the loop overlay to the viewport's content coordinates.

**Files:**
- Modify: `src/session/clip-editors/clip-editor-drum-grid.ts`

**Interfaces:**
- Consumes: `clampZoom`, `scrubToZoom`, `zoomAroundAnchor`, `maxZoomX` (from `pianoroll-zoom`); `isFollowEnabled`, `followScrollTarget` (from `clip-follow`); `createFollowToggle` (from `clip-editor-toolbar`); the new `mountClipLoopOverlay` API.

- [ ] **Step 1: Add imports + module-level per-clip zoom store**

```ts
import { clampZoom, scrubToZoom, zoomAroundAnchor, maxZoomX } from '../../core/pianoroll-zoom';
import { isFollowEnabled, followScrollTarget } from '../../core/clip-follow';
import { createToolToggle, createHelpButton, createResolutionSelect, createFollowToggle } from '../../core/clip-editor-toolbar';

// In-memory horizontal zoom/scroll per clip (mirrors the piano-roll's
// viewStateByClip; resets on reload; no saved-state change).
const hViewByClip = new Map<string, { zoomX: number; scrollLeft: number }>();
```
(Merge the toolbar import with the existing one — don't duplicate.)

- [ ] **Step 2: Restructure the DOM (label column + scroll viewport)**

Replace the DOM-build block (currently `const canvas = ...; wrap.append(toolbar, helpPopover, canvas); host.appendChild(wrap);`) with two canvases and a viewport:

```ts
  const labelsCanvas = document.createElement('canvas');
  labelsCanvas.style.cssText = `display:block;flex:0 0 ${LABEL_W}px`;

  const viewport = document.createElement('div');
  viewport.className = 'drum-grid-vp';
  Object.assign(viewport.style, { flex: '1 1 auto', overflowX: 'auto', overflowY: 'hidden', position: 'relative' } as Partial<CSSStyleDeclaration>);
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block'; canvas.style.cursor = 'crosshair';
  viewport.appendChild(canvas);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:flex-start';
  row.append(labelsCanvas, viewport);

  wrap.append(toolbar, helpPopover, row);
  host.appendChild(wrap);

  const lctx = labelsCanvas.getContext('2d');
  if (!lctx) throw new Error('canvas 2d unavailable');
```
(Keep the existing `const c2d = canvas.getContext('2d'); ... const ctx = c2d;` for the content canvas.)

- [ ] **Step 3: Zoom state + content-space coordinates**

Replace the geometry vars + transforms. The content canvas no longer carries the `LABEL_W` gutter — labels live on `labelsCanvas`:

```ts
  const stored = hViewByClip.get(clip.id);
  let zoomX = stored?.zoomX ?? 1;
  let gridW = 600, pxPerTick = gridW / patternTicks;
  const xForTick = (t: number) => t * pxPerTick;                 // content space (no LABEL_W)
  const yForRow = (r: number) => RULER_H + r * ROW_H;
  const tickFromX = (x: number) => Math.max(0, Math.min(patternTicks - 1, x / pxPerTick));
  const rowFromY = (y: number) => Math.max(0, Math.min(ROWS_N - 1, Math.floor((y - RULER_H) / ROW_H)));
  const persist = () => hViewByClip.set(clip.id, { zoomX, scrollLeft: viewport.scrollLeft });
```

- [ ] **Step 4: `resize()` sizes both canvases; add `drawLabels()`**

Replace `resize()`:
```ts
  function resize(): void {
    const vpW = Math.max(120, viewport.clientWidth || ((wrap.clientWidth || host.clientWidth || 600) - LABEL_W));
    zoomX = clampZoom(zoomX, maxZoomX(vpW));
    gridW = Math.round(vpW * zoomX);
    pxPerTick = gridW / patternTicks;
    canvas.width = gridW; canvas.height = FRAME_H;
    canvas.style.width = `${gridW}px`; canvas.style.height = `${FRAME_H}px`;
    labelsCanvas.width = LABEL_W; labelsCanvas.height = FRAME_H;
    labelsCanvas.style.width = `${LABEL_W}px`; labelsCanvas.style.height = `${FRAME_H}px`;
    drawLabels(); draw();
  }
```

Add `drawLabels()` (the fixed gutter: corner, voice labels, velocity-lane gutter):
```ts
  function drawLabels(): void {
    lctx.fillStyle = '#0a0a0a'; lctx.fillRect(0, 0, LABEL_W, FRAME_H);
    for (let r = 0; r < ROWS_N; r++) {
      const y = yForRow(r);
      lctx.fillStyle = '#202020'; lctx.fillRect(0, y, LABEL_W, ROW_H);
      lctx.fillStyle = '#9a9a9a'; lctx.font = '10px ui-monospace, monospace'; lctx.textBaseline = 'middle';
      lctx.fillText(labels[r] ?? '', 4, y + ROW_H / 2);
    }
    const laneTop = RULER_H + ROW_H * ROWS_N;
    lctx.fillStyle = '#202020'; lctx.fillRect(0, laneTop, LABEL_W, VEL_LANE_H);
  }
```

- [ ] **Step 5: `draw()` paints content from x=0 (drop the LABEL_W offset)**

In `draw()`, change every `ctx.fillRect(LABEL_W, ..., gridW, ...)` / gridline / vel-lane drawing to start at `0` with width `gridW`, and remove the per-row label drawing (now in `drawLabels`). Specifically:
- Background rows: `ctx.fillRect(0, y, gridW, ROW_H);` (delete the `fillRect(0, y, LABEL_W, ROW_H)` label gutter + `fillText` lines).
- Gridlines, notes, marquee, playhead, velocity band: unchanged math but `xForTick` now returns content x (no LABEL_W). The vel-lane band: `ctx.fillRect(0, laneTop, gridW, VEL_LANE_H);` and delete its `fillRect(0, laneTop, LABEL_W, VEL_LANE_H)` gutter line and accent line should span `0..gridW`.
- The note clamp `const maxW = (LABEL_W + gridW) - x;` becomes `const maxW = gridW - x;`.

- [ ] **Step 6: Pointer `pos()` uses the content canvas rect; remove gutter checks**

Replace `pos()`:
```ts
  const pos = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();         // shifted by scroll → content x
    const x = e.clientX - rect.left;
    return { row: rowFromY(e.clientY - rect.top), x, tick: tickFromX(x), localY: e.clientY - rect.top };
  };
```
In the `pointerdown` handler, delete `if (p.x < LABEL_W) return;` (no gutter on the content canvas now), and compute `localY` from `p.localY` (or the canvas rect) consistently. Where the handler currently does `const localY = e.clientY - canvas.getBoundingClientRect().top;`, that still works.

- [ ] **Step 7: Ruler-scrub zoom + scroll listener + persistence**

Add a scrub branch at the very top of the content-canvas `pointerdown` handler (before the vel-lane / draw / select logic):
```ts
    if ((e.clientY - canvas.getBoundingClientRect().top) < RULER_H) {
      // Ruler scrub: ↕ zoom-H anchored at the cursor, ↔ pan-H.
      let lx = e.clientX, ly = e.clientY;
      canvas.setPointerCapture(e.pointerId); e.preventDefault();
      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - ly, dx = ev.clientX - lx; lx = ev.clientX; ly = ev.clientY;
        const oldGridW = gridW;
        zoomX = scrubToZoom(zoomX, dy);
        resize();
        const anchorPx = ev.clientX - viewport.getBoundingClientRect().left;
        viewport.scrollLeft = zoomAroundAnchor(viewport.scrollLeft, anchorPx, oldGridW, gridW) - dx;
        persist();
      };
      const onUp = (ev: PointerEvent) => {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        try { canvas.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      };
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      return;
    }
```
Add a viewport scroll listener (persist) after the handlers are wired:
```ts
  viewport.addEventListener('scroll', () => persist());
```

- [ ] **Step 8: Follow button + follow scroll in `redraw()`**

Add the Follow button to the toolbar append (currently `toolbar.append(drawBtn, selBtn, resCtl, help.btn);`):
```ts
  toolbar.append(drawBtn, selBtn, createFollowToggle(), resCtl, help.btn);
```
Restore stored scroll after the initial `resize()` (replace the `resize();` mount line):
```ts
  resize();
  if (stored) viewport.scrollLeft = stored.scrollLeft;
```
Update `redraw()` to follow the playhead when Follow is on:
```ts
  function redraw(): void {
    const w = viewport.clientWidth;
    if (w && w !== lastW) { lastW = w; resize(); if (stored) viewport.scrollLeft = Math.min(stored.scrollLeft, Math.max(0, gridW - w)); }
    const ph = deps.getPlayheadTick?.() ?? -1;
    if (ph !== playheadTick) { playheadTick = ph; draw(); }
    if (ph >= 0 && isFollowEnabled()) {
      const target = followScrollTarget(xForTick(ph), viewport.clientWidth, gridW, viewport.scrollLeft);
      if (target != null) viewport.scrollLeft = target;     // fires scroll → persist
    }
  }
  let lastW = viewport.clientWidth;
```
(Place the `let lastW` declaration where the old `let lastW = wrap.clientWidth;` was; it now reads `viewport.clientWidth`.)

- [ ] **Step 9: Switch the loop overlay to viewport content coords**

Replace the Task-2 drum loop mount with the zoom-aware version (column inside the viewport, content coords, no LABEL_W since the gutter is a separate canvas now):
```ts
  if (deps.loop) {
    const total = patternTicks;
    mountClipLoopOverlay({
      toolbarHost: deps.loop.toolbarHost,
      scrollHost: viewport,
      clip, meter,
      historyDeps: deps.loop.historyDeps,
      onChange: deps.loop.onChange,
      tickToX: (t) => xForTick(t),
      tickFromClientX: (cx) => {
        const x = cx - canvas.getBoundingClientRect().left;
        return pxPerTick > 0 ? Math.max(0, Math.min(total, x / pxPerTick)) : 0;
      },
      contentHeight: () => FRAME_H,
    });
  }
```

- [ ] **Step 10: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → builds.

- [ ] **Step 11: Manual verification (drums)**

`npm run dev`, open a **drum** clip. Expected: drag the ruler (top strip) vertically to zoom in; a horizontal scrollbar appears; the voice labels on the left stay pinned while the grid scrolls under them; notes/playhead/velocity bars all align; the loop column tracks the grid at any zoom/scroll; the Follow button toggles whether the view chases the playhead during playback. Reopen the clip → zoom/scroll restored.

- [ ] **Step 12: Commit**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts
git commit -m "feat(drum-grid): horizontal zoom + scroll, pinned labels, zoom-aware loop, Follow"
```

---

## Task 4: Audio — horizontal zoom + scroll + zoom-aware loop + Follow

Wrap the waveform header (and warp-marker editor) in a horizontal-scroll viewport; the waveform/ruler/warp grid draw across the zoomed content width; ruler-scrub zoom; per-clip persistence; loop overlay inside the viewport; Follow button + follow scroll.

**Files:**
- Modify: `src/session/clip-editors/clip-waveform-header.ts`
- Modify: `src/session/clip-editors/warp-marker-editor.ts`

**Interfaces:**
- Consumes: `clampZoom`, `scrubToZoom`, `zoomAroundAnchor`, `maxZoomX`; `isFollowEnabled`, `followScrollTarget`; `createFollowToggle`; the new `mountClipLoopOverlay` API.
- Produces: `mountWaveformHeader` gains an optional `contentWidth?: () => number` dep (the zoomed width); `mountWarpMarkerEditor` gains a `contentWidth?: () => number` dep.

- [ ] **Step 1: `mountWaveformHeader` draws across an injected content width**

In `src/session/clip-editors/clip-waveform-header.ts`, extend `WaveformHeaderDeps`:
```ts
export interface WaveformHeaderDeps {
  getPlayheadFrac?: () => number;
  /** Zoomed content width (px). Defaults to the host width (no zoom). */
  contentWidth?: () => number;
}
```
In `draw()` replace `const w = Math.max(320, host.clientWidth || 600);` with:
```ts
    const w = Math.max(320, deps.contentWidth?.() ?? host.clientWidth ?? 600);
```
In `redraw()` replace the width reads (`const w = Math.max(320, host.clientWidth || 600);` and the `lastW` init) with the same `deps.contentWidth?.() ?? host.clientWidth ?? 600` expression so a zoom change repaints. The canvas already sets `canvas.width = w` in `draw()`, so widening it is automatic; ensure `canvas.style.width` is set too:
```ts
    canvas.width = w; canvas.height = h;
    canvas.style.width = `${w}px`;     // add this line
    canvas.style.height = `${h}px`;
```

- [ ] **Step 2: `mountWarpMarkerEditor` scales marker x with content width**

In `src/session/clip-editors/warp-marker-editor.ts`, add to `WarpMarkerEditorDeps`:
```ts
  /** Zoomed content width (px). Defaults to host width (no zoom). */
  contentWidth?: () => number;
```
Replace `const width = () => Math.max(320, host.clientWidth || 600);` with:
```ts
  const width = () => Math.max(320, deps.contentWidth?.() ?? host.clientWidth ?? 600);
```
Set the layer width so the absolutely-positioned markers live in the scrollable content (add to the start of `draw()`, after `const w = width();`):
```ts
    layer.style.width = `${w}px`;
```

- [ ] **Step 3: Build the audio viewport + zoom state**

In `renderAudioClipEditor` (`clip-waveform-header.ts`), add imports:
```ts
import { clampZoom, scrubToZoom, zoomAroundAnchor, maxZoomX } from '../../core/pianoroll-zoom';
import { isFollowEnabled, followScrollTarget } from '../../core/clip-follow';
import { createFollowToggle } from '../../core/clip-editor-toolbar';

// Per-clip horizontal zoom/scroll (in-memory; resets on reload).
const audioHViewByClip = new Map<string, { zoomX: number; scrollLeft: number }>();
```
Replace the `headerHost` creation with a scroll viewport that holds the header + warp editor as its scrollable content:
```ts
  const stored = audioHViewByClip.get(clip.id);
  let zoomX = stored?.zoomX ?? 1;

  const viewport = document.createElement('div');
  viewport.className = 'audio-clip-vp';
  Object.assign(viewport.style, { overflowX: 'auto', overflowY: 'hidden', position: 'relative' } as Partial<CSSStyleDeclaration>);
  host.appendChild(viewport);

  const content = document.createElement('div');
  content.style.position = 'relative';
  viewport.appendChild(content);

  const viewportW = () => Math.max(320, viewport.clientWidth || 600);
  const contentW = () => Math.round(viewportW() * clampZoom(zoomX, maxZoomX(viewportW())));
  const persist = () => audioHViewByClip.set(clip.id, { zoomX, scrollLeft: viewport.scrollLeft });

  const headerHost = document.createElement('div');
  content.appendChild(headerHost);
  const header = mountWaveformHeader(headerHost, clip, meter, {
    getPlayheadFrac: deps.getPlayheadFrac, contentWidth: contentW,
  });
```
Set the content element's width so it drives the scroll range, and keep it in sync on zoom (define a `relayout()` used by the scrub + resize):
```ts
  const relayout = () => {
    const cw = contentW();
    content.style.width = `${cw}px`;
    header.redraw();
    markerHandle?.redraw();
    loopHandle?.redraw();
  };
```

- [ ] **Step 4: Ruler-scrub zoom on the waveform + scroll persistence**

Wire a scrub on the header canvas (the whole waveform strip is a zoom surface — there is no other pointer interaction on it; the loop column + warp markers sit on their own layers and stop propagation):
```ts
  headerHost.addEventListener('pointerdown', (e) => {
    let lx = e.clientX, ly = e.clientY;
    headerHost.setPointerCapture(e.pointerId); e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - ly, dx = ev.clientX - lx; lx = ev.clientX; ly = ev.clientY;
      const oldW = contentW();
      zoomX = clampZoom(scrubToZoom(zoomX, dy), maxZoomX(viewportW()));
      relayout();
      const anchorPx = ev.clientX - viewport.getBoundingClientRect().left;
      viewport.scrollLeft = zoomAroundAnchor(viewport.scrollLeft, anchorPx, oldW, contentW()) - dx;
      persist();
    };
    const onUp = (ev: PointerEvent) => {
      headerHost.removeEventListener('pointermove', onMove);
      headerHost.removeEventListener('pointerup', onUp);
      try { headerHost.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    };
    headerHost.addEventListener('pointermove', onMove);
    headerHost.addEventListener('pointerup', onUp);
  });
  viewport.addEventListener('scroll', () => persist());
```

- [ ] **Step 5: Loop overlay inside the viewport (zoom-aware)**

Replace the Task-2 audio loop mount with the viewport version:
```ts
  let loopHandle: { redraw: () => void } | undefined;
  if (deps.loop) {
    const total = clip.lengthBars * ticksPerBar(meter);
    loopHandle = mountClipLoopOverlay({
      toolbarHost: toolbar,
      scrollHost: viewport,
      clip, meter,
      historyDeps: deps.loop.historyDeps,
      onChange: deps.loop.onChange,
      applyToAll: deps.loop.applyToAll,
      tickToX: (t) => (t / total) * contentW(),
      tickFromClientX: (cx) => {
        const x = cx - content.getBoundingClientRect().left;  // shifted by scroll
        return Math.max(0, Math.min(total, (x / Math.max(1, contentW())) * total));
      },
      contentHeight: () => RULER_H + WAVE_H,
    });
  }
```
(Declare `loopHandle` before `relayout()` so the closure resolves; reorder so `relayout` is defined after `loopHandle`, or hoist `let loopHandle` above `relayout`.)

- [ ] **Step 6: Mount the warp editor into the scrollable content + wire contentWidth**

Where the warp editor is mounted (`const editorHost = document.createElement('div'); host.appendChild(editorHost);`), append it to `content` instead and pass `contentWidth`:
```ts
    const editorHost = document.createElement('div');
    content.appendChild(editorHost);
    // ...
    markerHandle = mountWarpMarkerEditor(editorHost, {
      // ...existing deps...
      contentWidth: contentW,
    });
```

- [ ] **Step 7: Follow button + follow scroll**

Add the Follow button to the audio toolbar (after the WARP controls):
```ts
  toolbar.append(createFollowToggle());
```
The audio editor's `redraw` runs from the host RAF (returned handle). Update the returned handle to follow the playhead:
```ts
  if (stored) { relayout(); viewport.scrollLeft = stored.scrollLeft; } else { relayout(); }
  return {
    redraw: () => {
      header.redraw(); markerHandle?.redraw(); loopHandle?.redraw();
      const f = deps.getPlayheadFrac?.() ?? -1;
      if (f >= 0 && isFollowEnabled()) {
        const target = followScrollTarget(f * contentW(), viewport.clientWidth, contentW(), viewport.scrollLeft);
        if (target != null) viewport.scrollLeft = target;
      }
    },
  };
```
(Remove the now-duplicated `return { redraw: ... }` at the bottom of the function.)

- [ ] **Step 8: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → builds.

- [ ] **Step 9: Manual verification (audio)**

`npm run dev`, open an **audio** clip. Expected: drag the waveform vertically to zoom in; a horizontal scrollbar appears; the waveform, bar/beat ruler, warp grid and warp markers all scale and scroll together; the loop column tracks the waveform at any zoom/scroll; dragging A/B edges + warp markers lands under the cursor; the Follow button toggles playhead-chasing. Reopen → zoom/scroll restored.

- [ ] **Step 10: Commit**

```bash
git add src/session/clip-editors/clip-waveform-header.ts src/session/clip-editors/warp-marker-editor.ts
git commit -m "feat(audio-clip): horizontal zoom + scroll for waveform/warp/loop, Follow"
```

---

## Task 5: Final verification + integration

**Files:** none (verification only), unless a fix is needed.

- [ ] **Step 1: Rebase onto main**

```bash
git rebase main
```
Resolve any conflicts immediately. (Per project convention, rebase often.)

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit`
Expected: green (re-run once if it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` on teardown — but read the output to confirm no real failure).

- [ ] **Step 3: Build + e2e**

Run: `npm run build` then `npm run test:e2e`
Expected: green. The existing `tests/e2e/clip-editor-inspector.spec.ts` covers the inspector/editor; confirm it still passes (loop + editor open). If a loop-alignment e2e assertion is feasible, add it here (open a clip, set loop, read the `.clip-loop-col` left/width vs a known tick→px at zoom 1) — but only as a relative check.

- [ ] **Step 4: Cross-editor manual smoke**

`npm run dev`. For each of notes / drums / audio: zoom in, scroll, confirm the loop column stays aligned and clipped; toggle Follow during playback of a long clip and confirm the view stops chasing when OFF and resumes when ON. Confirm Follow is shared (toggling it in one editor reflects when you open another).

- [ ] **Step 5: Final commit (if any fixes) + summary**

```bash
git add -A
git commit -m "test(clip): verify zoom/loop/follow across the three editors"   # only if changes were made
git log --oneline main..HEAD
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| Loop overlay inside viewport, injected coords | Task 2 (Step 1) |
| Notes loop bug fixed (tracks zoom/scroll, clipped) | Task 2 (Steps 2, 9) |
| Drums horizontal zoom + scroll, pinned labels | Task 3 |
| Drums loop tracks zoom/scroll | Task 3 (Step 9) |
| Audio horizontal zoom + scroll (waveform+warp+loop) | Task 4 |
| Follow toggle, ON by default, session-global | Task 1 + buttons in Tasks 2/3/4 |
| Follow gates playhead auto-scroll (all three) | Notes Task 2 (Step 3), Drums Task 3 (Step 8), Audio Task 4 (Step 7) |
| Per-clip zoom/scroll in memory, no schema change | Task 3 (Step 1), Task 4 (Step 3) |
| Pure-logic unit tests (follow decision) | Task 1 |
| Build clean + visual confirmation | Tasks 2/3/4 manual steps + Task 5 |
| Out of scope: vertical zoom drums/audio, persistence across reload, piano-roll refactor, minimap, Ctrl+wheel | honored (not in any task) |

No gaps.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every code step has concrete code. The only "if feasible" is the optional extra e2e assertion in Task 5 (the required check is that existing e2e stays green).

**3. Type consistency:** `followScrollTarget(playheadX, viewportWidth, contentWidth, currentScroll, threshold?)` — same signature in Task 1 (definition) and Tasks 3/4 (calls). `isFollowEnabled`/`toggleFollow`/`createFollowToggle` names consistent across tasks. `ClipLoopOverlayDeps` fields (`scrollHost`, `tickToX`, `tickFromClientX`, `contentHeight`, `contentTop?`) used identically in Tasks 2/3/4. `contentWidth?: () => number` consistent in `WaveformHeaderDeps` and `WarpMarkerEditorDeps`. `hViewByClip` (drums) and `audioHViewByClip` (audio) store `{ zoomX, scrollLeft }` consistently.

All consistent.
