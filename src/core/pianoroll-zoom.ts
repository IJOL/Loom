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
