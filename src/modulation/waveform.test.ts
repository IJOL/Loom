import { describe, it, expect } from 'vitest';
import { computeWaveform } from './waveform';

describe('computeWaveform — sine', () => {
  it('phase 0 → 0 bipolar', () => {
    expect(computeWaveform('sine', 0, true)).toBeCloseTo(0, 5);
  });
  it('phase 0.25 → +1 bipolar', () => {
    expect(computeWaveform('sine', 0.25, true)).toBeCloseTo(1, 5);
  });
  it('phase 0.5 → 0 bipolar', () => {
    expect(computeWaveform('sine', 0.5, true)).toBeCloseTo(0, 5);
  });
  it('phase 0 → 0.5 unipolar', () => {
    expect(computeWaveform('sine', 0, false)).toBeCloseTo(0.5, 5);
  });
  it('phase 0.25 → 1 unipolar', () => {
    expect(computeWaveform('sine', 0.25, false)).toBeCloseTo(1, 5);
  });
});

describe('computeWaveform — triangle', () => {
  it('phase 0 → -1 bipolar (rising from bottom)', () => {
    expect(computeWaveform('triangle', 0, true)).toBeCloseTo(-1, 5);
  });
  it('phase 0.5 → +1 bipolar (peak)', () => {
    expect(computeWaveform('triangle', 0.5, true)).toBeCloseTo(1, 5);
  });
  it('phase 1 → -1 bipolar (back to bottom)', () => {
    expect(computeWaveform('triangle', 1, true)).toBeCloseTo(-1, 5);
  });
});

describe('computeWaveform — square', () => {
  it('phase 0..0.5 → +1 bipolar', () => {
    expect(computeWaveform('square', 0,    true)).toBe(1);
    expect(computeWaveform('square', 0.49, true)).toBe(1);
  });
  it('phase 0.5..1 → -1 bipolar', () => {
    expect(computeWaveform('square', 0.5,  true)).toBe(-1);
    expect(computeWaveform('square', 0.99, true)).toBe(-1);
  });
});

describe('computeWaveform — saw', () => {
  it('phase 0 → -1, phase 0.5 → 0, phase ~1 → +1 (bipolar ramp)', () => {
    expect(computeWaveform('saw', 0,    true)).toBeCloseTo(-1, 5);
    expect(computeWaveform('saw', 0.5,  true)).toBeCloseTo( 0, 5);
    expect(computeWaveform('saw', 0.99, true)).toBeCloseTo(0.98, 5);
  });
});
