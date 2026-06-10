import { describe, it, expect } from 'vitest';
import { xToFrac, pickHandle, applyHandle, type TrimState } from './sampler-waveform-edit';

const base: TrimState = { sampleStart: 0.1, sampleEnd: 0.9, loopStart: 0.3, loopEnd: 0.7, loop: true };

describe('xToFrac', () => {
  it('maps clientX to a 0..1 fraction honouring scroll + scaled width', () => {
    expect(xToFrac(100, 50, 0, 200)).toBeCloseTo(0.25);   // (100-50)/200
    expect(xToFrac(100, 50, 100, 400)).toBeCloseTo(0.375);// (100-50+100)/400
  });
  it('clamps out-of-range to [0,1]', () => {
    expect(xToFrac(0, 50, 0, 200)).toBe(0);
    expect(xToFrac(9999, 50, 0, 200)).toBe(1);
  });
});

describe('pickHandle', () => {
  it('picks the nearest handle within tolerance', () => {
    expect(pickHandle(0.11, base, 0.03)).toBe('start');
    expect(pickHandle(0.89, base, 0.03)).toBe('end');
    expect(pickHandle(0.31, base, 0.03)).toBe('loopStart');
  });
  it('ignores loop handles when loop is off', () => {
    expect(pickHandle(0.31, { ...base, loop: false }, 0.03)).toBeNull();
  });
  it('returns null when nothing is within tolerance', () => {
    expect(pickHandle(0.5, base, 0.03)).toBeNull();
  });
});

describe('applyHandle', () => {
  it('drags start but never past end', () => {
    expect(applyHandle('start', 0.95, base).sampleStart).toBeLessThan(base.sampleEnd);
  });
  it('keeps the loop region inside the trim', () => {
    const s = applyHandle('loopStart', 0.0, base);
    expect(s.loopStart).toBeGreaterThanOrEqual(s.sampleStart);
  });
  it('clamps to [0,1]', () => {
    expect(applyHandle('start', -1, base).sampleStart).toBe(0);
    expect(applyHandle('end', 2, base).sampleEnd).toBe(1);
  });
});
