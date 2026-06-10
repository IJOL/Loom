// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { attachWheelZoom, type PerfUICallbacks } from './performance-ui';

function cbStub(over: Partial<PerfUICallbacks> = {}): PerfUICallbacks {
  return { pxPerBar: 80, onZoom: () => {}, ...over } as unknown as PerfUICallbacks;
}

const ctrlWheel = (deltaY: number) =>
  new WheelEvent('wheel', { ctrlKey: true, deltaY, cancelable: true });

describe('attachWheelZoom', () => {
  it('does not stack handlers across re-renders — one onZoom per wheel', () => {
    // Regression: renderPerformanceView calls attachWheelZoom every render on the
    // persistent host, so handlers stacked and each wheel fired N times → N
    // re-renders → +N handlers (exponential blow-up that froze the tab).
    const host = document.createElement('div');
    let calls = 0;
    const cb = cbStub({ onZoom: () => { calls++; } });
    attachWheelZoom(host, cb);
    attachWheelZoom(host, cb);
    attachWheelZoom(host, cb); // three re-renders
    host.dispatchEvent(ctrlWheel(-1));
    expect(calls).toBe(1); // was 3 before the fix
  });

  it('ignores a wheel without Ctrl (lets the page scroll)', () => {
    const host = document.createElement('div');
    let calls = 0;
    attachWheelZoom(host, cbStub({ onZoom: () => { calls++; } }));
    host.dispatchEvent(new WheelEvent('wheel', { ctrlKey: false, deltaY: -1 }));
    expect(calls).toBe(0);
  });

  it('clamps zoom to [16,400]', () => {
    const host = document.createElement('div');
    let last = -1;
    attachWheelZoom(host, cbStub({ pxPerBar: 400, onZoom: (v: number) => { last = v; } }));
    host.dispatchEvent(ctrlWheel(-1)); // zoom in past the max
    expect(last).toBe(400);

    const host2 = document.createElement('div');
    attachWheelZoom(host2, cbStub({ pxPerBar: 16, onZoom: (v: number) => { last = v; } }));
    host2.dispatchEvent(ctrlWheel(1)); // zoom out past the min
    expect(last).toBe(16);
  });
});
