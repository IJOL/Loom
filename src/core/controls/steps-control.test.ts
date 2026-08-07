// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createStepsControl } from './steps-control';

const down = (el: HTMLElement, clientX: number, clientY: number) =>
  el.dispatchEvent(new MouseEvent('pointerdown', { clientX, clientY, bubbles: true }));

function mount(values: number[], left = 0, width = 400) {
  const seen: Array<[number, number]> = [];
  const s = createStepsControl({ values, onChange: (i, v) => seen.push([i, v]) });
  document.body.appendChild(s.el);
  s.el.getBoundingClientRect = () => ({ left, top: 0, width, height: 100 }) as DOMRect;
  const bars = () => [...s.el.querySelectorAll('.step-bar')] as HTMLElement[];
  return { s, seen, bars };
}

describe('steps control', () => {
  it('draws one bar per value, at the height of that value', () => {
    const { bars } = mount([0.25, 0.5, 1]);
    expect(bars()).toHaveLength(3);
    expect(parseFloat(bars()[0].style.height)).toBeCloseTo(25);
    expect(parseFloat(bars()[2].style.height)).toBeCloseTo(100);
  });

  it('reports the step under the pointer and the height it was dragged to', () => {
    const { s, seen } = mount([0, 0, 0, 0]);
    // Third of four columns (x in [200,300)), three quarters up the box.
    down(s.el, 250, 25);
    expect(seen[0][0]).toBe(2);
    expect(seen[0][1]).toBeCloseTo(0.75);
  });

  it('ignores a pointer left of the first column instead of writing step -1', () => {
    const { s, seen } = mount([0, 0], 100, 200);
    down(s.el, 50, 50);
    expect(seen).toHaveLength(0);
  });

  it('ignores a pointer right of the last column', () => {
    const { s, seen } = mount([0, 0], 0, 200);
    down(s.el, 400, 50);
    expect(seen).toHaveLength(0);
  });

  it('keeps a sliver rather than letting a bar vanish at the bottom', () => {
    const { s, seen, bars } = mount([0.5]);
    down(s.el, 200, 999);
    expect(seen[0][1]).toBeGreaterThan(0);
    expect(parseFloat(bars()[0].style.height)).toBeGreaterThan(0);
  });

  it('accents every fourth bar, so the eye can count without a ruler', () => {
    const { bars } = mount(Array.from({ length: 8 }, () => 0.5));
    expect(bars()[0].classList.contains('accent')).toBe(true);
    expect(bars()[4].classList.contains('accent')).toBe(true);
    expect(bars()[1].classList.contains('accent')).toBe(false);
  });

  it('redraws every bar when set is called', () => {
    const { s, bars } = mount([0, 0, 0]);
    s.set([1, 0.5, 0.25]);
    expect(parseFloat(bars()[0].style.height)).toBeCloseTo(100);
    expect(parseFloat(bars()[2].style.height)).toBeCloseTo(25);
  });
});
