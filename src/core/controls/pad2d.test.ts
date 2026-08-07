// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createPad2d } from './pad2d';

// jsdom has no PointerEvent, and the handlers only read clientX/clientY/buttons
// — all of which a MouseEvent carries. Same approach clip-loop-overlay.test.ts
// already takes.
const down = (el: HTMLElement, clientX: number, clientY: number) =>
  el.dispatchEvent(new MouseEvent('pointerdown', { clientX, clientY, bubbles: true }));
const move = (el: HTMLElement, clientX: number, clientY: number) =>
  el.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY, buttons: 1, bubbles: true }));

function mount(x = 0, y = 0) {
  const seen: Array<[number, number]> = [];
  const pad = createPad2d({ x, y, onChange: (px, py) => seen.push([px, py]) });
  document.body.appendChild(pad.el);
  pad.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
  return { pad, seen };
}

describe('pad2d', () => {
  it('reports the fraction of the box that was clicked', () => {
    const { pad, seen } = mount();
    down(pad.el, 100, 25);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBeCloseTo(0.5);
    expect(seen[0][1]).toBeCloseTo(0.25);
  });

  it('clamps a drag that leaves the box instead of reporting past a corner', () => {
    const { pad, seen } = mount(0.5, 0.5);
    down(pad.el, -50, 300);
    expect(seen[0][0]).toBe(0);
    expect(seen[0][1]).toBe(1);
  });

  it('keeps reporting while the button is held', () => {
    const { pad, seen } = mount();
    down(pad.el, 0, 0);
    move(pad.el, 200, 100);
    expect(seen).toHaveLength(2);
    expect(seen[1][0]).toBeCloseTo(1);
  });

  it('ignores a move with no button held', () => {
    const { pad, seen } = mount();
    pad.el.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 50, bubbles: true }));
    expect(seen).toHaveLength(0);
  });

  it('draws the dot where the value says, before any interaction', () => {
    const { pad } = mount(0.25, 0.75);
    const dot = pad.el.querySelector('.pad2d-dot') as HTMLElement;
    expect(parseFloat(dot.style.left)).toBeCloseTo(25);
    expect(parseFloat(dot.style.top)).toBeCloseTo(75);
  });
});
