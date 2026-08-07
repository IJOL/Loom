// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createQueueControl } from './queue-control';

const down = (el: HTMLElement, clientX: number) =>
  el.dispatchEvent(new MouseEvent('pointerdown', { clientX, bubbles: true }));

function mount(length: number, value: number, width = 600) {
  let got = -1;
  const q = createQueueControl({ length, value, onChange: (v) => { got = v; } });
  document.body.appendChild(q.el);
  q.el.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 26 }) as DOMRect;
  const cursorPct = () => parseFloat((q.el.querySelector('.queue-cursor') as HTMLElement).style.left);
  return { q, cursorPct, got: () => got };
}

describe('queue control', () => {
  it('puts the cursor on the centre of the first dot at value 0', () => {
    // Dot i is centred at (i + 0.5) / N of the box.
    expect(mount(6, 0).cursorPct()).toBeCloseTo(100 * 0.5 / 6, 3);
  });

  it('puts the cursor on the centre of the last dot at value 1', () => {
    expect(mount(6, 1).cursorPct()).toBeCloseTo(100 * 5.5 / 6, 3);
  });

  it('round-trips a click back to the value that would draw the cursor there', () => {
    const { q, got } = mount(6, 0);
    // Click exactly on the centre of dot index 3.
    down(q.el, 600 * 3.5 / 6);
    expect(got()).toBeCloseTo(3 / 5, 3);
  });

  it('draws the cursor back where it was clicked, after the round trip', () => {
    const { q, cursorPct } = mount(6, 0);
    const target = 600 * 3.5 / 6;
    down(q.el, target);
    expect(cursorPct()).toBeCloseTo(target / 600 * 100, 3);
  });

  it('marks the dots behind the cursor as past and the one ahead as next', () => {
    const { q } = mount(6, 0);
    down(q.el, 600 * 2.5 / 6);          // on dot index 2
    const dots = [...q.el.querySelectorAll('.queue-dot')];
    expect(dots[2].classList.contains('past')).toBe(true);
    expect(dots[3].classList.contains('next')).toBe(true);
    expect(dots[4].classList.contains('past')).toBe(false);
  });

  it('clamps a click past the last dot instead of running off the end', () => {
    const { q, got } = mount(6, 0);
    down(q.el, 5000);
    expect(got()).toBe(1);
  });

  it('handles a queue of one without dividing by zero', () => {
    const { q, cursorPct } = mount(1, 0.7);
    expect(Number.isFinite(cursorPct())).toBe(true);
    expect(cursorPct()).toBeCloseTo(50, 3);
    expect(q.el.querySelectorAll('.queue-dot')).toHaveLength(1);
  });
});
