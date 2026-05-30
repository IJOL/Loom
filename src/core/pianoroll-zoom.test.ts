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
    // cursor at viewport px 100, scroll 0; content doubles (1000 -> 2000).
    const scroll = zoomAroundAnchor(0, 100, 1000, 2000);
    expect(scroll).toBe(100);
    // The content pixel under the cursor stays the same FRACTION of the whole
    // before and after the zoom (i.e. the cursor stays put):
    //   before = (scrollBefore + anchor) / oldDim = (0 + 100) / 1000 = 0.1
    //   after  = (scrollAfter  + anchor) / newDim = (100 + 100) / 2000 = 0.1
    expect((0 + 100) / 1000).toBeCloseTo((scroll + 100) / 2000);
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
