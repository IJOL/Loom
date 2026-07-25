import { describe, it, expect, beforeEach } from 'vitest';
import {
  ClipAxis, clipAxis, releaseClipAxis, followerGeometry, _resetClipAxesForTesting,
} from './clip-axis';
import { MAX_CANVAS_PX } from './pianoroll-zoom';

// 4 bars of 4/4 at the project's 96 ticks per quarter = 4 * 384.
const TOTAL = 4 * 384;

function axisAt(basis: number, total = TOTAL): ClipAxis {
  const a = new ClipAxis('clip-1', total);
  a.setBasisWidth(basis);
  return a;
}

describe('ClipAxis geometry', () => {
  it('starts fitted: content is exactly the basis width at zoom 1', () => {
    const a = axisAt(800);
    expect(a.zoomX).toBe(1);
    expect(a.scrollLeft).toBe(0);
    expect(a.contentWidth()).toBe(800);
  });

  it('maps ticks across the whole content width', () => {
    const a = axisAt(800);
    expect(a.tickToX(0)).toBe(0);
    expect(a.tickToX(TOTAL)).toBeCloseTo(a.contentWidth());
    // half the clip sits at half the width
    expect(a.tickToX(TOTAL / 2)).toBeCloseTo(a.contentWidth() / 2);
    expect(a.pxPerTick()).toBeCloseTo(a.contentWidth() / TOTAL);
  });

  it('tickFromContentX inverts tickToX', () => {
    const a = axisAt(800);
    a.setZoom(3);
    for (const tick of [0, 37, TOTAL / 3, TOTAL - 1]) {
      expect(a.tickFromContentX(a.tickToX(tick))).toBeCloseTo(tick);
    }
  });

  it('tickFromContentX clamps to the clip', () => {
    const a = axisAt(800);
    expect(a.tickFromContentX(-500)).toBe(0);
    expect(a.tickFromContentX(a.contentWidth() * 2)).toBe(TOTAL);
  });

  it('zooming scales the content width, not the tick range', () => {
    const a = axisAt(800);
    const fit = a.contentWidth();
    a.setZoom(4);
    expect(a.contentWidth()).toBeCloseTo(fit * 4);
    // the clip still spans exactly the content, whatever the zoom
    expect(a.tickToX(TOTAL)).toBeCloseTo(a.contentWidth());
  });

  it('clamps zoom to [1, maxZoomX(basis)]', () => {
    const a = axisAt(800);
    a.setZoom(0.25);
    expect(a.zoomX).toBe(1);
    a.setZoom(1e9);
    expect(a.zoomX).toBeCloseTo(MAX_CANVAS_PX / 800);
    // and the canvas therefore never exceeds the browser ceiling
    expect(a.contentWidth()).toBeLessThanOrEqual(MAX_CANVAS_PX);
  });

  it('scrub zooms in on a downward drag and out on an upward one', () => {
    const a = axisAt(800);
    const fit = a.contentWidth();
    a.scrub(120, 400);
    const zoomedIn = a.contentWidth();
    expect(zoomedIn).toBeGreaterThan(fit);
    a.scrub(-120, 400);
    expect(a.contentWidth()).toBeLessThan(zoomedIn);
  });

  it('scrub keeps the tick under the cursor stationary', () => {
    const a = axisAt(800);
    a.setZoom(2);
    a.setScrollLeft(300);
    const anchorPx = 250;                              // viewport-relative cursor
    const before = a.tickFromContentX(a.scrollLeft + anchorPx);
    a.scrub(90, anchorPx);
    const after = a.tickFromContentX(a.scrollLeft + anchorPx);
    // Same musical position under the cursor: within a tick of itself, and far
    // tighter than the ~100-tick shift an unanchored zoom would cause.
    expect(Math.abs(after - before)).toBeLessThan(1);
  });

  it('clamps scroll so the content never leaves the viewport', () => {
    const a = axisAt(800);
    a.setZoom(2);                                      // content 1600, viewport 800
    a.setScrollLeft(-100);
    expect(a.scrollLeft).toBe(0);
    a.setScrollLeft(99999);
    expect(a.scrollLeft).toBe(a.contentWidth() - 800);
  });

  it('re-clamps scroll when zooming back out', () => {
    const a = axisAt(800);
    a.setZoom(4);
    a.setScrollLeft(a.contentWidth() - 800);           // hard right
    a.setZoom(1);                                      // nothing left to scroll
    expect(a.scrollLeft).toBe(0);
  });

  it('a narrower basis re-clamps both zoom ceiling and scroll', () => {
    const a = axisAt(800);
    a.setZoom(3);
    a.setScrollLeft(a.contentWidth() - 800);
    a.setBasisWidth(400);
    expect(a.contentWidth()).toBeCloseTo(400 * a.zoomX);
    expect(a.scrollLeft).toBeLessThanOrEqual(a.contentWidth() - 400);
  });

  it('a longer clip keeps the zoom but shrinks px-per-tick', () => {
    const a = axisAt(800);
    const perTick = a.pxPerTick();
    a.setTotalTicks(TOTAL * 2);
    expect(a.zoomX).toBe(1);
    expect(a.contentWidth()).toBe(800);               // still fitted
    expect(a.pxPerTick()).toBeCloseTo(perTick / 2);
    expect(a.tickToX(TOTAL * 2)).toBeCloseTo(a.contentWidth());
  });

  it('survives an unlaid-out viewport without producing NaN', () => {
    const a = new ClipAxis('clip-x', TOTAL);           // no setBasisWidth yet
    expect(a.contentWidth()).toBe(0);
    expect(a.pxPerTick()).toBe(0);
    expect(a.tickToX(TOTAL)).toBe(0);
    expect(a.tickFromContentX(10)).toBe(0);
  });

  it('a zero-tick clip cannot divide by zero', () => {
    const a = axisAt(800, 0);
    expect(Number.isFinite(a.pxPerTick())).toBe(true);
    expect(Number.isFinite(a.tickFromContentX(400))).toBe(true);
  });
});

describe('ClipAxis subscription', () => {
  it('notifies on every geometry change and stops after unsubscribe', () => {
    const a = axisAt(800);
    let hits = 0;
    const off = a.subscribe(() => { hits++; });

    a.setBasisWidth(900);   // 1
    a.setZoom(2);           // 2
    a.setScrollLeft(50);    // 3
    a.setTotalTicks(768);   // 4
    a.scrub(30, 100);       // 5
    expect(hits).toBe(5);

    off();
    a.setZoom(3);
    expect(hits).toBe(5);
  });

  it('does not notify when a setter changes nothing', () => {
    const a = axisAt(800);
    let hits = 0;
    a.subscribe(() => { hits++; });
    a.setBasisWidth(800);
    a.setScrollLeft(0);
    a.setTotalTicks(TOTAL);
    a.setZoom(1);
    expect(hits).toBe(0);
  });

  it('hands the axis to the listener so followers can read it straight away', () => {
    const a = axisAt(800);
    let seen: ClipAxis | null = null;
    a.subscribe((axis) => { seen = axis; });
    a.setZoom(2);
    expect(seen).toBe(a);
  });
});

describe('clipAxis registry', () => {
  beforeEach(() => { _resetClipAxesForTesting(); });

  it('returns one shared axis per clip id', () => {
    const a = clipAxis('c1', TOTAL);
    expect(clipAxis('c1', TOTAL)).toBe(a);
    expect(clipAxis('c2', TOTAL)).not.toBe(a);
  });

  it('every view of a clip therefore agrees on the geometry', () => {
    // The primary editor publishes its viewport width; the followers only read.
    const primary = clipAxis('c1', TOTAL);
    primary.setBasisWidth(700);
    primary.setZoom(3);
    const follower = clipAxis('c1', TOTAL);
    expect(follower.contentWidth()).toBe(primary.contentWidth());
    expect(follower.pxPerTick()).toBe(primary.pxPerTick());
    expect(follower.scrollLeft).toBe(primary.scrollLeft);
  });

  it('re-getting an existing axis refreshes its clip length', () => {
    const a = clipAxis('c1', TOTAL);
    const same = clipAxis('c1', TOTAL * 2);           // clip grew (length / tempo edit)
    expect(same).toBe(a);
    expect(a.totalTicks).toBe(TOTAL * 2);
  });

  it('release drops the axis so a reopened clip starts fitted', () => {
    const a = clipAxis('c1', TOTAL);
    a.setBasisWidth(800);
    a.setZoom(5);
    releaseClipAxis('c1');
    const fresh = clipAxis('c1', TOTAL);
    expect(fresh).not.toBe(a);
    expect(fresh.zoomX).toBe(1);
  });
});

describe('followerGeometry', () => {
  it('lines a follower strip up with the primary viewport', () => {
    // Piano-roll: 42px key column + 1px border, viewport 758 wide.
    const geo = followerGeometry({ left: 100, width: 800 }, { left: 143, width: 758 });
    expect(geo.marginLeft).toBe(43);
    expect(geo.width).toBe(758);
  });

  it('works for every gutter without knowing what the gutter is', () => {
    const host = { left: 100, width: 800 };
    // audio editor: no gutter at all
    expect(followerGeometry(host, { left: 100, width: 800 }).marginLeft).toBe(0);
    // drum grid: a wider label column
    expect(followerGeometry(host, { left: 184, width: 616 }).marginLeft).toBe(84);
  });

  it('rounds to whole pixels so the canvas never lands on a half pixel', () => {
    const geo = followerGeometry({ left: 10.4, width: 800 }, { left: 52.9, width: 757.4 });
    expect(Number.isInteger(geo.marginLeft)).toBe(true);
    expect(Number.isInteger(geo.width)).toBe(true);
  });

  it('never indents a follower off to the left of its host', () => {
    expect(followerGeometry({ left: 200, width: 800 }, { left: 100, width: 700 }).marginLeft).toBe(0);
  });

  it('degrades to the host width when the primary has not been laid out', () => {
    // jsdom / pre-layout: every rect is zero. Falling back to the host width keeps
    // the follower visible instead of collapsing it to nothing.
    expect(followerGeometry({ left: 0, width: 640 }, { left: 0, width: 0 }))
      .toEqual({ marginLeft: 0, width: 640 });
  });
});
