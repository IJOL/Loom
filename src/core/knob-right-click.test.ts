// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createKnob } from './knob';

function rightPointerDown(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointerdown', {
    button: 2, buttons: 2, bubbles: true, cancelable: true, pointerId: 1,
  }));
}

describe('knob mouse buttons', () => {
  it('does not start a drag on a right-press', () => {
    const onGestureStart = vi.fn();
    const onChange = vi.fn();
    const k = createKnob({
      min: 0, max: 1, value: 0.5, onChange, onGestureStart, label: 'CUTOFF',
    });
    const svg = k.el.querySelector('svg')!;
    // jsdom has no pointer capture; stub it so the handler can run either way.
    (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

    rightPointerDown(svg);

    expect(onGestureStart).not.toHaveBeenCalled();
    expect(k.el.classList.contains('dragging')).toBe(false);
  });

  it('still starts a drag on a left-press', () => {
    const onGestureStart = vi.fn();
    const k = createKnob({ min: 0, max: 1, value: 0.5, onChange: () => {}, onGestureStart });
    const svg = k.el.querySelector('svg')!;
    (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

    svg.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1,
    }));

    expect(onGestureStart).toHaveBeenCalledTimes(1);
  });
});
