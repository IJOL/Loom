# Clip editors: coherent zoom, loop region that tracks zoom/scroll, and an opt‑out Follow

Date: 2026-06-18
Status: approved design (brainstorming) — pending implementation plan

## Problem

Three clip editors live under `src/session/clip-editors/`:

- **Notes** (piano-roll) — `src/core/pianoroll.ts`. Has horizontal (time) + vertical (pitch) zoom, a scrollable grid viewport (`gridVp`), and auto-scroll that follows the playhead.
- **Drums** (drum-grid) — `src/session/clip-editors/clip-editor-drum-grid.ts`. A single full-width canvas. **No zoom, no scroll.**
- **Audio** (waveform header + warp markers) — `src/session/clip-editors/clip-waveform-header.ts` + `src/session/clip-editors/warp-marker-editor.ts`. Full-width, **no zoom, no scroll.**

All three share the performance-style loop region (amber column + A/B edge handles + Loop toggle + quantize) via `mountClipLoopOverlay` in `src/core/clip-loop-overlay.ts`.

Three concrete problems:

1. **Loop region misaligns under zoom (the bug).** The loop overlay is mounted on the editor's *outer* box (`bodyBox`), outside the piano-roll's scroll viewport. It recomputes its position (`layout()`) only on mount (rAF) and on a `ResizeObserver` of that outer box. Zooming/scrolling the piano-roll changes the inner `gridCanvas` width and the viewport's `scrollLeft` but does **not** resize the outer box, so the `ResizeObserver` never fires and the column freezes where it was — drifting away from the notes. Worse, because the column lives outside the scroll viewport it is never clipped, so when zoomed it overflows onto the keyboard gutter and past the grid. See `src/core/clip-loop-overlay.ts:125-179` and `src/core/pianoroll.ts:261-270`.
2. **Drums and audio have no zoom.** Long drum patterns and long audio clips are cramped into the panel width with no way to zoom in.
3. **Follow is forced ON and cannot be turned off.** The piano-roll always auto-scrolls to keep the playhead centered (`src/core/pianoroll.ts:326-331`). On a long clip zoomed in, the view drifts during playback and editing becomes impossible. There is no way to disable it. Drums and audio have no follow at all (no scroll exists yet).

## Decisions (from brainstorming)

- **Loop approach:** *overlay inside the viewport*. The loop column moves **inside** each editor's scroll/zoom area and is positioned in **content coordinates** (`tick·pxPerTick`). Scroll and clipping then come for free from the viewport's `overflow`. The existing overlay DOM — Loop toggle, quantize select, draggable A/B handles, "All channels", and undo wiring — is **kept**; only *where* it mounts and *how* it computes x change.
- **Drums:** add zoom (horizontal only), matching notes — restructure the single canvas into a fixed label column + a scrollable content canvas.
- **Audio:** add zoom (horizontal only) — wrap waveform + warp markers in a scrollable viewport.
- **Zoom axis:** horizontal (time) only for drums and audio. Vertical zoom is out of scope there (waveform has no pitch axis; drum rows are few and fixed-height). Notes keeps its existing X+Y zoom.
- **Follow:** a per-editor **Follow** toggle button, **ON by default**, stored as **session-global** state (like the draw/select tool), so it is a working mode rather than a per-clip property. When OFF, the editor never auto-scrolls to the playhead.

## Architecture

### Shared: a viewport-anchored loop overlay

Today `mountClipLoopOverlay` *measures* the DOM (`contentBox()` walks canvases, reads `getBoundingClientRect()`) and assumes zoom-independence. Change it so the **editor supplies the coordinate transform** and the column mounts inside the editor's scrollable content element:

- New deps (replacing the DOM-measuring `contentBox`):
  - `scrollHost: HTMLElement` — the scrollable viewport (the column is appended here; `overflow` clips it, scroll moves it).
  - `tickToX(tick: number): number` — content-space x for a tick (i.e. `tick·pxPerTick`).
  - `tickFromClientX(clientX: number): number` — inverse, for the A/B drag (uses the content canvas's on-screen rect, which is already shifted by scroll).
  - `contentHeight(): number` — column height (the grid/content height).
- The column is positioned `left = tickToX(start)`, `width = tickToX(end) − tickToX(start)`, `top = 0`, `height = contentHeight()`.
- The editor calls `loop.redraw()` whenever it relayouts (zoom change) or scrolls; the existing `redraw` handle already exists and the router already chains editor redraws.
- Undo/quantize/clamp logic in `clip-loop-brace.ts` (`pxToTick`, `tickToPx`, `snapTick`, `clampLoopRegion`) is unchanged; the drag handler converts pointer→tick via `tickFromClientX` instead of measuring `cb.absLeft`.

This single change fixes the bug for notes and makes the loop correct-by-construction for drums and audio once they have viewports.

### A small shared zoom/scroll helper for drums + audio

Notes already has a mature, well-integrated zoom/scroll implementation (anchored scrub, `syncStrips`, persistence). It is **not** refactored — too risky for too little gain. Instead, drums and audio (which both gain scroll from scratch) share a small helper for the common pieces:

- Horizontal zoom state `{ zoomX, scrollLeft }`, clamped (reuse/extend `src/core/pianoroll-zoom.ts` helpers: `clampZoom`, `scrubToZoom`, `zoomAroundAnchor`, `maxZoomX`).
- A ruler-scrub gesture (↕ drag on the time ruler = zoom anchored at the cursor, ↔ drag = pan), matching the notes gesture.
- A follow decision: given playhead x, content width, viewport width and the global Follow flag, return the scroll target (or "don't scroll").

Keeping this as pure functions + a thin mount helper keeps each editor focused and the math unit-testable.

### Follow toggle

- Module-level session-global boolean (default `true`), exposed via a tiny shared accessor so all three editors read/write the same flag (mirror of how `currentTool` is shared inside each editor file today). A single source of truth so the button reflects the same state everywhere.
- Toolbar button (label `Follow`, on/off styling like the existing Loop toggle) added to each editor's toolbar next to Pencil/Select.
- The playhead auto-scroll runs only when the flag is ON. Notes: wrap the existing block at `src/core/pianoroll.ts:326-331`. Drums/audio: call the shared follow decision in their redraw, only when ON.
- The playhead is **always drawn**; Follow only governs whether the view chases it.

## Per-editor changes

### Notes (piano-roll) — fixes only

- Mount the loop overlay on `f.gridVp` (the viewport) instead of `bodyBox`, wired with `tickToX = xForTick`, `tickFromClientX` via the grid canvas rect, `contentHeight = gridH`.
- Call `loop.redraw()` from `layoutAll()` and on the viewport `scroll` listener (both already exist).
- Wrap the playhead auto-scroll in `if (followOn)`.
- The column covers the **grid** area (ruler + velocity lane sit outside the viewport, as the keyboard already does). Alignment with the notes is what matters.

### Drums (drum-grid) — add zoom

- Restructure the single canvas into: a **fixed label column** (`LABEL_W`, outside the viewport, draws the voice labels + velocity-lane gutter) + a **content canvas** inside a horizontal-scroll viewport, width `gridW = viewportWidth·zoomX`.
- Ruler, rows, notes, playhead and velocity bars draw on the content canvas in content coordinates (`xForTick(t) = t·pxPerTick`, no `LABEL_W` offset now that labels are a separate column).
- Ruler-scrub gesture for zoom; horizontal scrollbar for pan.
- Mount the loop overlay inside the viewport via the shared deps.
- Per-clip `{ zoomX, scrollLeft }` persisted in memory.

### Audio — add zoom

- Wrap the waveform header + warp-marker editor in a horizontal-scroll viewport; content width `gridW = viewportWidth·zoomX`.
- `mountWaveformHeader` draws the waveform/ruler/slices/warp grid across `gridW` (peaks sampled across the wider canvas); `warp-marker-editor` positions markers with `pxPerSec·zoom`.
- Ruler-scrub gesture for zoom; horizontal scrollbar for pan; loop overlay inside the viewport.
- Per-clip `{ zoomX, scrollLeft }` persisted in memory.

## State & persistence

- Zoom/scroll is **in-memory, per clip** (drums and audio reuse the `viewStateByClip` pattern from `clip-editor-router.ts:62`; drums/audio only need `{ zoomX, scrollLeft }`). Resets on reload. **No saved-state schema change.**
- Follow is **in-memory, session-global** (one boolean). Resets on reload.

## Testing

Per the project's "always relative" assertion rule and four-layer layout:

- **Pure logic (unit):**
  - Loop coordinate transform under zoom: `tickToX`/`tickFromClientX` round-trip; the column's `left`/`width` track `pxPerTick` (relative checks: doubling zoom doubles px-per-tick and the column's pixel span).
  - `clampLoopRegion`/`snapTick` unchanged behavior under the new drag path (pointer→tick→clamp).
  - Follow decision function: ON + playhead beyond half-viewport ⇒ scroll target follows; OFF ⇒ no scroll; playhead within view ⇒ no scroll.
  - Drums/audio horizontal zoom math (`gridW`, `pxPerTick`, anchored `zoomAroundAnchor`) — reuse existing `pianoroll-zoom` tests as the model.
- **Visual / e2e:** the loop column lines up with the grid at zoom = 1 and a zoomed-in level in each editor (the alignment is the user-visible acceptance criterion). The Follow button toggles auto-scroll. Build first (`npm run build`) since e2e serves `dist/`.

## Out of scope (YAGNI)

- Vertical zoom for drums and audio.
- Persisting zoom/scroll or Follow across reloads / in saved state.
- Refactoring the piano-roll's existing zoom internals onto the shared helper.
- Minimap / overview navigation.
- Ctrl+wheel zoom (the ruler-scrub gesture is the single, consistent control; wheel can be added later if wanted).

## Files touched (anticipated)

- `src/core/clip-loop-overlay.ts` — accept injected coordinate transform + scrollHost; mount inside the viewport.
- `src/core/clip-loop-brace.ts` — unchanged math, reused via the new drag path.
- `src/core/pianoroll.ts` — mount overlay in `gridVp`; wrap follow in the toggle; redraw the overlay on layout/scroll.
- `src/core/pianoroll-zoom.ts` — reuse/extend for the shared horizontal-zoom helper.
- `src/session/clip-editors/clip-editor-drum-grid.ts` — viewport + zoom + scrub + label column + overlay + follow.
- `src/session/clip-editors/clip-waveform-header.ts` — viewport + zoom + scrub + overlay + follow.
- `src/session/clip-editors/warp-marker-editor.ts` — zoom-aware marker x.
- `src/session/clip-editors/clip-editor-router.ts` — pass the new overlay deps; per-clip view state for drums/audio.
- New small module(s) for the shared zoom/scroll + follow helper and the session-global Follow flag.
- Tests alongside the pure logic (`*.test.ts`) + an e2e check.

## Acceptance criteria

1. In **notes**, the loop column stays aligned with the grid at any zoom and any scroll position, and never overflows past the grid.
2. **Drums** can be zoomed horizontally (ruler-scrub) and scrolled; the loop column tracks the grid under zoom/scroll; labels stay pinned.
3. **Audio** can be zoomed horizontally and scrolled; waveform, warp markers and the loop column all track under zoom/scroll.
4. A **Follow** button (ON by default) in each editor turns the playhead auto-scroll on/off; with it OFF, editing a long clip during playback is possible because the view stays put.
5. `npm run build` is clean; unit tests for the new pure logic pass; the alignment is confirmed by a human look in the real app.
