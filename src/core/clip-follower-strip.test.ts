// @vitest-environment jsdom
// The follower strip is the piece that makes "aligned with the clip it belongs
// to" true. jsdom reports every rect as zero, so the tests stub
// getBoundingClientRect on the two elements whose geometry actually matters —
// which is also exactly what the production code reads.
import { describe, it, expect, vi } from 'vitest';
import { ClipAxis } from './clip-axis';
import { createFollowerStrip } from './clip-follower-strip';

const TOTAL = 4 * 384;

function rect(left: number, width: number): void {}

/** Force an element's measured rect (jsdom returns zeros otherwise). */
function stubRect(el: Element, left: number, width: number): void {
  el.getBoundingClientRect = () => ({
    left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
}

function setup(opts: { hostLeft?: number; hostWidth?: number; vpLeft?: number; vpWidth?: number } = {}) {
  const axis = new ClipAxis('c1', TOTAL);
  axis.setBasisWidth(opts.vpWidth ?? 758);

  const vp = document.createElement('div');
  stubRect(vp, opts.vpLeft ?? 143, opts.vpWidth ?? 758);
  document.body.appendChild(vp);
  axis.setPrimaryViewport(vp);

  const onLayout = vi.fn();
  const strip = createFollowerStrip({ axis, height: 80, className: 'test-strip', onLayout });
  document.body.appendChild(strip.root);
  stubRect(strip.root, opts.hostLeft ?? 100, opts.hostWidth ?? 800);
  strip.layout();                       // re-measure now the rects are stubbed
  return { axis, strip, vp, onLayout };
}

describe('createFollowerStrip', () => {
  it('reserves exactly the editor gutter and matches its visible width', () => {
    const { strip } = setup({ hostLeft: 100, vpLeft: 143, vpWidth: 758 });
    // 43px of gutter (42px key column + 1px border) — measured, not hardcoded
    expect(strip.label.style.flex).toBe('0 0 43px');
    expect(strip.window.style.width).toBe('758px');
  });

  it('adapts to a different editor gutter with no per-editor knowledge', () => {
    const drums = setup({ hostLeft: 100, vpLeft: 184, vpWidth: 616 });   // label column
    expect(drums.strip.label.style.flex).toBe('0 0 84px');
    const audio = setup({ hostLeft: 100, vpLeft: 100, vpWidth: 800 });   // no gutter
    expect(audio.strip.label.style.flex).toBe('0 0 0px');
  });

  it('sizes its content to the axis, so it shares the clip zoom', () => {
    const { axis, strip } = setup();
    const fit = axis.contentWidth();
    expect(strip.content.style.width).toBe(`${fit}px`);
    axis.setZoom(3);
    expect(strip.content.style.width).toBe(`${axis.contentWidth()}px`);
    expect(axis.contentWidth()).toBeGreaterThan(fit);
  });

  it('scrolls with the clip through a transform, not a second scrollbar', () => {
    const { axis, strip } = setup();
    axis.setZoom(2);
    axis.setScrollLeft(310);
    expect(strip.content.style.transform).toBe(`translateX(-${axis.scrollLeft}px)`);
    // no nested scroller: the window clips, it does not scroll
    expect(strip.window.style.overflow === 'scroll').toBe(false);
  });

  it('tells the caller to repaint only when the content width really changed', () => {
    const { axis, onLayout } = setup();
    const afterMount = onLayout.mock.calls.length;
    axis.setScrollLeft(0);              // no-op
    expect(onLayout.mock.calls.length).toBe(afterMount);
    axis.setZoom(2);                    // width changed -> repaint
    expect(onLayout.mock.calls.length).toBe(afterMount + 1);
    const [w, h] = onLayout.mock.calls[onLayout.mock.calls.length - 1];
    expect(w).toBe(axis.contentWidth());
    expect(h).toBe(80);
  });

  it('two followers of the same clip end up identical', () => {
    const axis = new ClipAxis('c1', TOTAL);
    axis.setBasisWidth(700);
    const vp = document.createElement('div');
    stubRect(vp, 150, 700);
    axis.setPrimaryViewport(vp);

    const a = createFollowerStrip({ axis, height: 60 });
    const b = createFollowerStrip({ axis, height: 80 });
    for (const s of [a, b]) { document.body.appendChild(s.root); stubRect(s.root, 100, 800); s.layout(); }
    axis.setZoom(2.5);
    axis.setScrollLeft(120);

    expect(a.label.style.flex).toBe(b.label.style.flex);
    expect(a.window.style.width).toBe(b.window.style.width);
    expect(a.content.style.width).toBe(b.content.style.width);
    expect(a.content.style.transform).toBe(b.content.style.transform);
  });

  it('stops following once disposed', () => {
    const { axis, strip } = setup();
    const before = strip.content.style.width;
    strip.dispose();
    axis.setZoom(4);
    expect(strip.content.style.width).toBe(before);
  });

  it('survives a primary that has not been laid out yet', () => {
    const axis = new ClipAxis('c1', TOTAL);
    const strip = createFollowerStrip({ axis, height: 80 });   // no viewport, no basis
    expect(() => strip.layout()).not.toThrow();
    expect(strip.label.style.flex).toBe('0 0 0px');
  });
});
