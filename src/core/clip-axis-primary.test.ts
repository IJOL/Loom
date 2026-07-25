// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ClipAxis } from './clip-axis';
import { attachPrimaryAxis } from './clip-axis-primary';

const TOTAL = 4 * 384;

function setup(relayout = vi.fn(), afterApply = vi.fn()) {
  const axis = new ClipAxis('c1', TOTAL);
  axis.setBasisWidth(800);
  const viewport = document.createElement('div');
  document.body.appendChild(viewport);
  const handle = attachPrimaryAxis({ axis, viewport, relayout, afterApply });
  return { axis, viewport, relayout, afterApply, handle };
}

describe('attachPrimaryAxis', () => {
  it('claims the primary role for its viewport', () => {
    const { axis, viewport } = setup();
    expect(axis.primaryViewport).toBe(viewport);
  });

  it('relayouts when the content width changes, not when only the scroll does', () => {
    const { axis, relayout, handle } = setup();
    handle.apply();
    const afterFirst = relayout.mock.calls.length;

    axis.setZoom(2);                      // width changed -> relayout
    expect(relayout.mock.calls.length).toBeGreaterThan(afterFirst);

    const afterZoom = relayout.mock.calls.length;
    axis.setScrollLeft(120);              // scroll only -> no relayout
    expect(relayout.mock.calls.length).toBe(afterZoom);
  });

  it('mirrors the axis scroll onto the viewport', () => {
    const { axis, viewport } = setup();
    axis.setZoom(2);
    axis.setScrollLeft(250);
    expect(viewport.scrollLeft).toBe(axis.scrollLeft);
  });

  it('runs afterApply on every apply, for the cheap follow-ups', () => {
    const { axis, afterApply } = setup();
    axis.setZoom(2);                      // make room to scroll (fit has none)
    const before = afterApply.mock.calls.length;
    axis.setScrollLeft(40);
    expect(afterApply.mock.calls.length).toBeGreaterThan(before);
  });

  it('does not re-enter when relayout republishes the basis width', () => {
    // The real editors call axis.setBasisWidth() inside relayout(), which emits.
    const axis = new ClipAxis('c1', TOTAL);
    axis.setBasisWidth(800);
    const viewport = document.createElement('div');
    let depth = 0, maxDepth = 0;
    const relayout = () => {
      depth++; maxDepth = Math.max(maxDepth, depth);
      axis.setBasisWidth(900 + depth);    // emits from inside the handler
      depth--;
    };
    const handle = attachPrimaryAxis({ axis, viewport, relayout });
    handle.apply();
    axis.setZoom(3);
    expect(maxDepth).toBe(1);             // never nested
  });

  it('invalidate forces the next apply to relayout', () => {
    const { relayout, handle } = setup();
    handle.apply();
    const before = relayout.mock.calls.length;
    handle.apply();                       // nothing changed
    expect(relayout.mock.calls.length).toBe(before);
    handle.invalidate();
    handle.apply();                       // viewport resized -> relayout anyway
    expect(relayout.mock.calls.length).toBe(before + 1);
  });

  it('stops applying and releases the role on dispose', () => {
    const { axis, viewport, relayout, handle } = setup();
    handle.apply();
    const before = relayout.mock.calls.length;
    handle.dispose();
    axis.setZoom(4);
    expect(relayout.mock.calls.length).toBe(before);
    expect(axis.primaryViewport).toBe(null);
  });

  it('does not steal the role back from a newer editor on dispose', () => {
    const { axis, handle } = setup();
    const newer = document.createElement('div');
    axis.setPrimaryViewport(newer);       // a second editor mounted
    handle.dispose();                     // the old one tears down late
    expect(axis.primaryViewport).toBe(newer);
  });
});
