// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createCurveControl, type CurvePoint } from './curve-control';

const RAMP: CurvePoint[] = [{ x: 0, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }];

function mount(points = RAMP, grid?: { x: number; y: number }) {
  const onChange = vi.fn();
  const h = createCurveControl({ points, onChange, label: 'test curve', grid });
  document.body.appendChild(h.el);
  // jsdom has no layout: give the SVG a box so pointer math has a frame.
  const svg = h.el.querySelector('svg')!;
  (svg as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: 200, height: 100,
    right: 200, bottom: 100, toJSON: () => ({}),
  } as DOMRect);
  return { h, onChange, svg };
}

const pt = (el: Element, type: string, x: number, y: number) =>
  el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));

describe('createCurveControl', () => {
  it('renders one handle per point and an accessible label', () => {
    const { h } = mount();
    expect(h.el.querySelectorAll('.curve-point')).toHaveLength(2);
    expect(h.el.getAttribute('aria-label')).toBe('test curve');
  });

  it('dragging a handle moves the point and reports through onChange', () => {
    const { h, onChange } = mount();
    const handle = h.el.querySelectorAll<SVGElement>('.curve-point')[0];
    pt(handle, 'pointerdown', 0, 0);
    pt(handle, 'pointermove', 0, 50);   // down half the 100px height
    pt(handle, 'pointerup', 0, 50);
    const pts = onChange.mock.lastCall![0] as CurvePoint[];
    expect(pts[0].y).toBeLessThan(0.6); // moved down from y=1
    expect(pts[0].x).toBe(0);           // endpoint locked in x
  });

  it('double-click on empty space adds a point; double-click a point removes it', () => {
    const { h, onChange, svg } = mount();
    svg.dispatchEvent(new MouseEvent('dblclick', { clientX: 100, clientY: 20, bubbles: true }));
    expect((onChange.mock.lastCall![0] as CurvePoint[]).length).toBe(3);
    const mid = h.el.querySelectorAll<SVGElement>('.curve-point')[1];
    mid.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect((onChange.mock.lastCall![0] as CurvePoint[]).length).toBe(2);
  });

  it('never removes below 2 points', () => {
    const { h, onChange } = mount();
    for (const el of [...h.el.querySelectorAll<SVGElement>('.curve-point')]) {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }
    const last = onChange.mock.lastCall;
    if (last) expect((last[0] as CurvePoint[]).length).toBeGreaterThanOrEqual(2);
    expect(h.el.querySelectorAll('.curve-point').length).toBeGreaterThanOrEqual(2);
  });

  it('snaps to the grid when one is given', () => {
    const { h, onChange } = mount(RAMP, { x: 4, y: 4 });
    const handle = h.el.querySelectorAll<SVGElement>('.curve-point')[0];
    pt(handle, 'pointerdown', 0, 0);
    pt(handle, 'pointermove', 0, 30);   // 0.7 raw -> snaps to 0.75
    pt(handle, 'pointerup', 0, 30);
    const pts = onChange.mock.lastCall![0] as CurvePoint[];
    expect(Math.abs(pts[0].y * 4 - Math.round(pts[0].y * 4))).toBeLessThan(1e-9);
  });

  it('set() repaints from outside without replacing the element', () => {
    const { h } = mount();
    const before = h.el.querySelector('svg');
    h.set([{ x: 0, y: 0, c: 0 }, { x: 0.5, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }]);
    expect(h.el.querySelector('svg')).toBe(before);
    expect(h.el.querySelectorAll('.curve-point')).toHaveLength(3);
  });
});
