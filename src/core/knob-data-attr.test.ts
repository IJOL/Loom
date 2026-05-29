/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { createKnob } from './knob';

describe('createKnob exposes current normalized value via data-value-norm', () => {
  it('initial render sets data-value-norm to (value - min) / (max - min)', () => {
    let captured = 0;
    const h = createKnob({
      min: 0, max: 100, value: 25,
      onChange: (v) => { captured = v; },
    });
    expect(h.el.getAttribute('data-value-norm')).toBe('0.25');
    expect(captured).toBe(0); // onChange not called for the initial paint
  });

  it('setValue updates data-value-norm', () => {
    const h = createKnob({
      min: 0, max: 100, value: 0,
      onChange: () => {},
    });
    h.setValue(75);
    expect(h.el.getAttribute('data-value-norm')).toBe('0.75');
  });
});
