// src/core/clip-axis-primary.ts
// The PRIMARY side of a clip's shared time axis: the glue every mounted clip
// editor (piano-roll, drum grid, audio/waveform) needs to own that axis.
//
// It exists because the first cut of the ClipAxis refactor spelled the same
// block out three times — register the viewport, subscribe, guard against
// re-entering the handler (relayout republishes the basis width, which emits
// again), skip the expensive relayout when only the scroll moved, mirror
// axis.scrollLeft onto the DOM element, unsubscribe on teardown. Three copies of
// that is the very thing this whole change set is removing.
//
// The editor keeps everything that is actually its own: how to size its canvases
// and what to draw.

import type { ClipAxis } from './clip-axis';

export interface PrimaryAxisOpts {
  axis: ClipAxis;
  /** The editor's scrolling element. Followers align to its rect, and its
   *  scrollLeft is kept in sync with the axis. */
  viewport: HTMLElement;
  /** Re-measure + resize canvases + redraw. Called only when the axis content
   *  width actually changed (or after invalidate()), never on a plain scroll. */
  relayout: () => void;
  /** Cheap per-apply follow-up: re-pin strips, re-place the loop overlay. */
  afterApply?: () => void;
}

export interface PrimaryAxisHandle {
  /** Apply the axis to the DOM. Call after a gesture that moved it; the
   *  subscription calls it for changes that came from anywhere else. */
  apply: () => void;
  /** The viewport's own size changed, so the next apply must relayout even if
   *  the content width is unchanged. */
  invalidate: () => void;
  /** Unsubscribe and hand the primary role back (only if still ours). */
  dispose: () => void;
}

export function attachPrimaryAxis(o: PrimaryAxisOpts): PrimaryAxisHandle {
  const { axis, viewport } = o;
  axis.setPrimaryViewport(viewport);

  let applying = false;
  let lastWidth = -1;

  const apply = (): void => {
    // Re-entrancy: relayout() republishes the basis width, which emits.
    if (applying) return;
    applying = true;
    try {
      const w = axis.contentWidth();
      if (w !== lastWidth) {
        o.relayout();
        lastWidth = axis.contentWidth();   // relayout may have moved it again
      }
      // Rounded compare: a browser scrollLeft can be fractional, and assigning
      // it back on every frame would fight the user's own scrolling.
      if (Math.round(viewport.scrollLeft) !== axis.scrollLeft) viewport.scrollLeft = axis.scrollLeft;
      o.afterApply?.();
    } finally {
      applying = false;
    }
  };

  const off = axis.subscribe(() => apply());

  return {
    apply,
    invalidate: () => { lastWidth = -1; },
    dispose: () => {
      off();
      // Only release the role if a newer editor has not already claimed it.
      if (axis.primaryViewport === viewport) axis.setPrimaryViewport(null);
    },
  };
}
