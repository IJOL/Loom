// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachPerfGestures, type PerfGestureDeps } from './perf-gestures';

function buildDom() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="perf-row" data-lane-id="l1"><div class="perf-track"><div class="perf-clip-band">
      <div class="perf-clip" data-band-id="a"><span class="perf-clip-handle l"></span></div>
      <div class="perf-clip" data-band-id="b"></div>
    </div></div></div>
    <div class="perf-row" data-lane-id="l2"><div class="perf-track"><div class="perf-clip-band"></div></div></div>`;
  document.body.appendChild(root);
  return root;
}

function makeDeps(over: Partial<PerfGestureDeps> = {}): PerfGestureDeps & { sel: Set<string> } {
  const sel = new Set<string>();
  return {
    sel,
    pxPerBar: () => 80,
    barSec: () => 2,
    getSelection: () => sel,
    setSelection: (ids) => { sel.clear(); for (const id of ids) sel.add(id); },
    moveBands: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function pd(el: Element, x: number, y = 10, init: PointerEventInit = {}) {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, ...init }));
}
function wm(x: number, y = 10, init: PointerEventInit = {}) {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, buttons: 1, pointerId: 1, ...init }));
}
function wu(x: number, y = 10, init: PointerEventInit = {}) {
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, ...init }));
}

describe('perf-gestures', () => {
  let root: HTMLElement;
  let detach: () => void;
  afterEach(() => {
    detach?.(); document.body.innerHTML = ''; vi.restoreAllMocks();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });
  beforeEach(() => { root = buildDom(); });

  it('click selects exactly one band; shift-click adds and toggles', () => {
    const deps = makeDeps();
    detach = attachPerfGestures(root, deps);
    const a = root.querySelector('[data-band-id="a"]')!;
    const b = root.querySelector('[data-band-id="b"]')!;
    pd(a, 10); wu(10);
    expect([...deps.sel]).toEqual(['a']);
    pd(b, 30, 10, { shiftKey: true }); wu(30, 10, { shiftKey: true });
    expect([...deps.sel].sort()).toEqual(['a', 'b']);
    pd(a, 10, 10, { shiftKey: true }); wu(10, 10, { shiftKey: true });
    expect([...deps.sel]).toEqual(['b']); // shift-click toggles off
  });

  it('a drag below the movement threshold is a click, not a move', () => {
    const deps = makeDeps();
    detach = attachPerfGestures(root, deps);
    pd(root.querySelector('[data-band-id="a"]')!, 10);
    wm(12); wu(12);
    expect(deps.moveBands).not.toHaveBeenCalled();
    expect([...deps.sel]).toEqual(['a']);
  });

  it('dragging calls moveBands with clamp; Shift makes it ripple; Alt disables snap', () => {
    const deps = makeDeps();
    detach = attachPerfGestures(root, deps);
    const a = root.querySelector('[data-band-id="a"]')!;
    pd(a, 10); wm(90); wu(90);
    // 80px at 80px/bar over 2s bars → 2 seconds
    expect(deps.moveBands).toHaveBeenLastCalledWith(new Set(['a']), 2, null, 'clamp', true);
    pd(a, 10); wm(90, 10, { shiftKey: true }); wu(90, 10, { shiftKey: true, altKey: true });
    expect(deps.moveBands).toHaveBeenLastCalledWith(new Set(['a']), 2, null, 'ripple', false);
  });

  it('a vertical drag reports the lane row under the pointer as targetLaneId', () => {
    const deps = makeDeps();
    detach = attachPerfGestures(root, deps);
    const l2row = root.querySelectorAll('.perf-row')[1] as HTMLElement;
    // jsdom has no elementFromPoint — define one for this test, drop it after.
    (document as { elementFromPoint?: (x: number, y: number) => Element | null }).elementFromPoint = () => l2row;
    pd(root.querySelector('[data-band-id="a"]')!, 10, 10);
    wm(10, 80); wu(10, 80);
    expect(deps.moveBands).toHaveBeenLastCalledWith(new Set(['a']), 0, 'l2', 'clamp', true);
  });

  it('Escape mid-drag cancels: no op call, ghost removed', () => {
    const deps = makeDeps();
    detach = attachPerfGestures(root, deps);
    pd(root.querySelector('[data-band-id="a"]')!, 10);
    wm(90);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    wu(90);
    expect(deps.moveBands).not.toHaveBeenCalled();
    expect(document.querySelector('.perf-clip-ghost')).toBeNull();
  });

  it('marquee on empty track space selects the bands it covers; empty click clears', () => {
    const deps = makeDeps();
    detach = attachPerfGestures(root, deps);
    // give bands client rects (jsdom rects are all 0 by default)
    const rect = (l: number, w: number) => ({
      left: l, right: l + w, top: 5, bottom: 25, width: w, height: 20, x: l, y: 5, toJSON: () => ({}),
    } as DOMRect);
    const a = root.querySelector('[data-band-id="a"]') as HTMLElement;
    const b = root.querySelector('[data-band-id="b"]') as HTMLElement;
    vi.spyOn(a, 'getBoundingClientRect').mockReturnValue(rect(0, 40));
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue(rect(100, 40));
    const area = root.querySelector('.perf-clip-band')!;
    // drag [50..120] → covers b only
    pd(area, 50); wm(120); wu(120);
    expect([...deps.sel]).toEqual(['b']);
    // plain click on empty space clears
    pd(area, 60); wu(60);
    expect(deps.sel.size).toBe(0);
  });
});
