// src/core/pianoroll-templates.ts
// One-time lit-html scaffolding for the piano-roll editor frame. Only the DOM
// SCAFFOLDING lives here — canvas sizing/drawing and every interaction stay
// imperative in pianoroll.ts, which renders this once (detached) and pulls the
// element refs out. The inline styles are the exact frame geometry the old
// imperative builder assigned via Object.assign(el.style, …); they stay inline
// because they are per-frame geometry, not theme.

import { html, type TemplateResult } from 'lit-html';

export interface EditorFrameDims {
  keysW: number;
  rulerH: number;
  frameH: number;
  velLaneH: number;
}

// Shared strip style: ruler / keys / velocity wraps all clip their pinned
// canvas and zoom on pointer scrub (hence the ns-resize cursor).
const STRIP = 'overflow:hidden;position:relative;cursor:ns-resize;';
const ABS_CANVAS = 'position:absolute;top:0;left:0;display:block';

/** The 2×2 editor frame (corner / ruler / keyboard / grid-viewport) plus the
 *  velocity lane row, under a focusable wrap (tabindex, so the keyboard
 *  handler can target it) that also holds the toolbar. Ruler and keyboard live
 *  OUTSIDE the scroll viewport so they can be pinned (repositioned via
 *  transform) as the grid scrolls.
 *
 *  `.pr-grid-vp` reserves the scrollbar gutter so clientWidth/Height stay
 *  constant whether or not a scrollbar is showing. The grid sizes its canvas
 *  to clientWidth/Height (geom()), and redraw() relays out on any change — so
 *  a scrollbar appearing and disappearing drove a relayout feedback loop
 *  (rapid flicker + the loop brace looking duplicated) the moment the loop
 *  overlay column was shown.
 *
 *  MUST be `stable` (end-edge only), NOT `stable both-edges`: the grid canvas
 *  is the only in-flow child there, so a start-edge gutter would inset it
 *  ~15px to the right of the ruler/keys (which are left:0/top:0 absolute
 *  strips with no gutter), misaligning every bar line against the ruler.
 *  `stable` reserves only the inline-end gutter — enough to keep clientWidth
 *  constant — and leaves the grid origin flush with the strips.
 *
 *  That property is set via style.setProperty in buildEditorFrame, NOT here:
 *  jsdom (the unit-test DOM) discards an entire style attribute containing a
 *  property it doesn't know, which would silently wipe overflow/position too. */
export function editorFrameTemplate(d: EditorFrameDims): TemplateResult {
  return html`
    <div tabindex="0" style="outline:none">
      <div class="pr-toolbar" style="display:flex;gap:6px;align-items:center;padding:4px 2px"></div>
      <div
        class="pr-frame"
        style="display:grid;grid-template-columns:${d.keysW}px 1fr;grid-template-rows:${d.rulerH}px 1fr ${d.velLaneH}px;height:${d.frameH + d.velLaneH}px;background:#141414;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden"
      >
        <div class="pr-corner" style="background:#202020;border-right:1px solid #2a2a2a;border-bottom:1px solid #2a2a2a"></div>
        <div class="pr-ruler" style="${STRIP}border-bottom:1px solid #2a2a2a;background:#181818"><canvas style=${ABS_CANVAS}></canvas></div>
        <div class="pr-keys" style="${STRIP}border-right:1px solid #2a2a2a;background:#1a1a1a"><canvas style=${ABS_CANVAS}></canvas></div>
        <div class="pr-grid-vp" style="overflow:auto;position:relative;background:#0a0a0a"><canvas style="display:block"></canvas></div>
        <div class="pr-velcorner" style="background:#181818;border-right:1px solid #2a2a2a;border-top:1px solid #2a2a2a"></div>
        <div class="pr-vel" style="${STRIP}border-top:1px solid #2a2a2a;background:#0e0e0e"><canvas style=${ABS_CANVAS}></canvas></div>
      </div>
    </div>
  `;
}
