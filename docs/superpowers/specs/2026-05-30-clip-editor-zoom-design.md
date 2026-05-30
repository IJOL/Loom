# Clip-editor zoom (Ableton-style scrub) — Design

**Date:** 2026-05-30
**Status:** Approved (design); pending implementation plan
**Scope:** Piano-roll clip editor only. The drum-grid editor is explicitly out of scope.

## Goal

Add horizontal (time) and vertical (pitch) zoom to the piano-roll clip editor,
driven by Ableton-style **scrub gestures**: dragging on a time ruler zooms time,
dragging on the piano keyboard zooms pitch. Today the piano-roll has no zoom — it
renders a fixed `lengthBars × 240px` canvas inside a horizontal scroller, which
both squashes pitch (up to 61 rows in 240px ≈ 4px/row) and breaks on long clips
(a 152-bar import is 36,480px wide, past the browser's ~32k canvas ceiling).

## Decisions (locked during brainstorming)

| Question | Decision |
| --- | --- |
| Which editors? | **Piano-roll only.** Drum-grid untouched. |
| Which axes? | **Both** horizontal (time) and vertical (pitch). |
| Gestures | **Scrub on the time ruler** (↕ = zoom time, ↔ = pan time) and **scrub on the piano keyboard** (↕ = zoom pitch). No modifier+wheel, no toolbar buttons. |
| Panning | **Native scrollbars** on the viewport, both axes. Scrub is never used to pan. |
| Persistence | **In-memory, per clip** — a module-level `Map<clipId, ViewState>`, mirroring the existing `editorOverride` map. Resets on page reload. **No saved-state schema change.** |
| Architecture | **Approach A** — oversized grid canvas in a scroll viewport, with sticky ruler/keyboard canvases. (Rejected: Approach B viewport-transform rewrite — higher regression risk against untested interaction code.) |

## Background — current state

- `src/core/pianoroll.ts` — `createPianoRoll()` draws keyboard column + grid +
  notes + playhead into **one** canvas sized `bars·240 × 240`. Pointer
  interactions (create/move/resize/delete) map screen↔(tick,midi) via
  `xForTick`/`tickFromX`/`yForMidi`/`midiFromY`, all derived from
  `canvas.width/height`. **No unit tests cover these interactions.**
- `src/session/clip-editors/clip-editor-router.ts` — `buildPianoRoll()` sets the
  canvas size and wraps it in a `.piano-roll-scroll` div (overflowX auto,
  overflowY hidden) used for playhead-follow.
- `src/session/session-inspector.ts` — `renderEditor()` mounts the editor into
  `#insp-roll-host` (`.insp-editor-box`) with automation lanes below.
- Piano-roll styling is mostly inline in JS; little CSS to coordinate.

## Design

### Layout — three canvases around one viewport

The editor frame becomes a 2×2 CSS grid:

```text
┌────────┬──────────────────────────────┐
│ corner │  RULER canvas (bars/beats)    │   top strip — scrub ↕ zoom-H, ↔ pan-H
├────────┼──────────────────────────────┤
│  KEYS  │   ┌──────────────────────┐    │
│ canvas │   │  GRID canvas (notes) │    │   viewport: overflow:auto (only scroller)
│ scrub↕ │   │  in scroll viewport  │    │   grid = base·zoomX × base·zoomY
└────────┴───┴──────────────────────┘────┘
```

- `grid-template-columns: <KEYS_W>px 1fr`, `grid-template-rows: <RULER_H>px 1fr`.
- **Grid canvas** lives inside `.pr-grid-vp` (`overflow:auto`) — the only scroller.
  It no longer draws the keyboard column; that moves to the keys strip.
- **Ruler canvas** (full grid width, `RULER_H` tall) and **keyboard canvas**
  (`KEYS_W` wide, full grid height) live in `overflow:hidden` wrappers **outside**
  the scroller. On the viewport's `scroll` event they reposition via
  `style.transform = translateX(−scrollLeft)` / `translateY(−scrollTop)` — pinned,
  always visible, no redraw (cheap).
- A static **corner** cell fills the top-left.

Suggested constants: `KEYS_W = 42`, `RULER_H = 26` (tunable).

### Zoom model — relative to fit

Zoom is expressed relative to "fit", so the default needs no special case:

- `zoomX = 1` ⇒ the whole clip fits the viewport width. `> 1` zooms in.
- `zoomY = 1` ⇒ all pitch rows fit the viewport height. `> 1` zooms in.
- `gridWidth  = viewportWidth  · zoomX`, capped at `MAX_CANVAS_PX = 32000`
  ⇒ `maxZoomX = MAX_CANVAS_PX / viewportWidth`.
- `gridHeight = viewportHeight · zoomY`; `pxPerRow = gridHeight / noteCount`
  clamped to a max (`MAX_ROW_PX ≈ 28`) ⇒ `maxZoomY = MAX_ROW_PX · noteCount / viewportHeight`.
- `pxPerTick = gridWidth / patternTicks`.

Because zoom is fit-relative and the canvas is capped (not `bars·240`), **every
clip length works** — a 152-bar clip fits at `zoomX=1` and zooms in up to the cap
(fully editable). This resolves the current long-clip rendering bug as a
side-effect.

### Pure, testable helpers (new module)

A new `src/core/pianoroll-zoom.ts` holds the math as pure functions:

- `fitZoom() → { zoomX: 1, zoomY: 1 }` — the default view.
- `clampZoom(zoom, max) → number` — clamp to `[1, max]`.
- `zoomAroundAnchor(scroll, anchorViewportPx, oldPxPer, newPxPer) → newScroll` —
  keep the content point under the cursor stationary across a zoom step.
  `newScroll = (scroll + anchorViewportPx)·(newPxPer/oldPxPer) − anchorViewportPx`.
- `scrubToZoom(zoom, dyPx, k = 0.006) → number` — `zoom · exp(dyPx·k)`
  (drag down ⇒ zoom in). Caller clamps the result.

### Interactions

- **Ruler** `pointerdown` captures and records the anchor tick under the cursor.
  On `pointermove`: `dy` drives `zoomX` (via `scrubToZoom` + `clampZoom`), then
  `scrollLeft` is recomputed via `zoomAroundAnchor`; `dx` additionally pans
  (`scrollLeft −= dx`). Redraw grid + ruler.
- **Keyboard** `pointerdown` captures and records the anchor row (midi) under the
  cursor. On `pointermove`: `dy` drives `zoomY`, then `scrollTop` via
  `zoomAroundAnchor`. Redraw grid + keyboard.
- **Native scrollbars** pan both axes. On `scroll`, reposition ruler/keyboard
  transforms and persist the view state.
- **Note editing** (create/move/resize/delete) is unchanged. The only adjustment:
  the grid canvas no longer has the `KEYS_W` offset, so `tickFromX` drops the
  `−KEYS_W` term and `xForTick` drops the `+KEYS_W` term. Everything else in the
  interaction code stays.
- **Playhead-follow** is preserved, retargeted to the new `.pr-grid-vp` viewport
  (same logic as today's `scrollContainer` centering).

### Persistence

Module-level in `clip-editor-router.ts` (next to where the editor mounts):

```ts
interface ViewState { zoomX: number; zoomY: number; scrollLeft: number; scrollTop: number; }
const viewStateByClip = new Map<string, ViewState>();
```

- On render, read `viewStateByClip.get(clip.id)` or default to
  `{ zoomX:1, zoomY:1, scrollLeft:0, scrollTop:0 }` (fit).
- On every zoom/scroll, write the current state back keyed by `clip.id`.
- Cleared naturally on page reload. No `SessionClip` / saved-state fields added,
  no migration.

### API change

`createPianoRoll(opts)` gains an optional initial `viewState?: ViewState` plus an
`onViewChange?(v: ViewState)` callback. The component applies the initial state on
mount and calls `onViewChange` on every zoom/scroll; the router owns the
`viewStateByClip` map and is the single source of persistence. The component
itself stays storage-agnostic.

## Files touched

| File | Change |
| --- | --- |
| `src/core/pianoroll-zoom.ts` (new) | Pure zoom math: `fitZoom`, `clampZoom`, `zoomAroundAnchor`, `scrubToZoom`. |
| `src/core/pianoroll.ts` | Three-surface rendering (grid/ruler/keys), scrub handlers, scroll sync, view-state callbacks, drop `KEYS_W` offset from grid math, retarget playhead-follow. |
| `src/session/clip-editors/clip-editor-router.ts` | Build the 2×2 frame instead of a single sized canvas; own the `viewStateByClip` map keyed by `clip.id`. |
| `src/session/session-inspector.ts` | No logic change; ensure the editor fills `.insp-editor-box`. |
| `src/style.css` (or inline) | `.pr-frame / .pr-corner / .pr-ruler / .pr-keys / .pr-grid-vp` + thin scrollbar styling. |

The drum-grid editor and `SessionClip`/saved-state schema are **not** touched.

## Testing

Aligned with the repo's four-layer convention:

- **Layer 1 (pure, Vitest)** — `src/core/pianoroll-zoom.test.ts`:
  - `clampZoom` respects `[1, max]` bounds.
  - `zoomAroundAnchor` keeps the point under the cursor fixed (in/out).
  - `scrubToZoom` is monotonic; drag-down increases zoom.
  - Fit yields the whole clip; the 32k px cap bounds `maxZoomX`.
  Relative assertions only (per the repo rule).
- **DOM-light sanity** — after `renderClipEditor`, the three surfaces
  (ruler/keys/grid) exist, and the same `clip.id` re-render restores persisted
  zoom from the map.
- **No new DSP tests** (UI-only change). Pointer-drag interactions remain without
  automated coverage (as today); validated via the live prototype and manual use.

## Edge cases

- **Empty clip** (no notes): fit + default zoom still render the grid/keyboard.
- **Very long clip** (e.g. 152 bars): fits at `zoomX=1`; zoom-in capped at the
  32k-px canvas limit (≈ several bars visible) — fully editable, no broken render.
- **Tiny viewport / panel resize**: recompute `maxZoomX/maxZoomY` on resize and
  re-clamp current zoom so it never exceeds the cap.
- **High-DPI**: size canvases by `devicePixelRatio` (clamped, e.g. ≤2) and scale
  the 2D context, matching the prototype.

## Out of scope / future

- Drum-grid zoom (different DOM-cell model).
- Persisting zoom/scroll into saved sessions (would need optional schema fields +
  migration).
- Modifier+wheel zoom, toolbar +/− buttons, "zoom to selection", pitch "fold".
