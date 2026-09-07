/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { createKnob, formatKnobValue } from './knob';

const readout = (h: { el: HTMLElement }) => h.el.querySelector('.knob-value-text')!.textContent;

describe('the default readout follows the step', () => {
  // A knob whose step is a whole number holds a COUNT — voices, bars, a
  // divisor — and "10.00" on a count is the formatter lying about precision
  // the value cannot have. The manual's engine screenshots shipped with it.
  it('a whole-number step reads as a whole number', () => {
    const h = createKnob({ min: 1, max: 64, value: 10, step: 1, onChange: () => {} });
    expect(readout(h)).toBe('10');
    h.setValue(7);
    expect(readout(h)).toBe('7');
  });

  it('a fractional step keeps the two-decimal readout', () => {
    const h = createKnob({ min: 0, max: 1, value: 0.5, step: 0.01, onChange: () => {} });
    expect(readout(h)).toBe('0.50');
  });

  it('no step keeps the two-decimal readout', () => {
    const h = createKnob({ min: 0, max: 1, value: 0.5, onChange: () => {} });
    expect(readout(h)).toBe('0.50');
  });

  // `step: 0` is how some specs say "unquantised" (Number.isInteger(0) is
  // true) — it must not be read as "integer readout".
  it('a zero step is unquantised, not integer', () => {
    const h = createKnob({ min: 0, max: 1, value: 0.5, step: 0, onChange: () => {} });
    expect(readout(h)).toBe('0.50');
  });

  it('a custom format still wins', () => {
    const h = createKnob({ min: 1, max: 64, value: 10, step: 1, format: (v) => `${v}v`, onChange: () => {} });
    expect(readout(h)).toBe('10v');
  });
});

describe('formatKnobValue — the one readout rule, for callers that add a unit', () => {
  it('drops the decimals only for a positive whole-number step', () => {
    expect(formatKnobValue(10, 1)).toBe('10');
    expect(formatKnobValue(10, 2)).toBe('10');
    expect(formatKnobValue(10, 0.5)).toBe('10.00');
    expect(formatKnobValue(10, 0)).toBe('10.00');
    expect(formatKnobValue(10, undefined)).toBe('10.00');
  });
});
