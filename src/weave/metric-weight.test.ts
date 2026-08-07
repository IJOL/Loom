import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP } from '../core/notes';
import { metricWeight, leavesAt, entersAt } from './metric-weight';

const BAR = TICKS_PER_STEP * 16;          // 384 ticks in 4/4
const step = (n: number) => n * TICKS_PER_STEP;

describe('metric weight', () => {
  it('ranks the downbeat above every other position in the bar', () => {
    const one = metricWeight(step(0), BAR);
    for (let s = 1; s < 16; s++) {
      expect(one).toBeGreaterThan(metricWeight(step(s), BAR));
    }
  });

  it('ranks beats above off-beats, and off-beats above sixteenths', () => {
    expect(metricWeight(step(4), BAR)).toBeGreaterThan(metricWeight(step(2), BAR));
    expect(metricWeight(step(2), BAR)).toBeGreaterThan(metricWeight(step(3), BAR));
  });

  it('ranks the middle of the bar above the other beats', () => {
    expect(metricWeight(step(8), BAR)).toBeGreaterThan(metricWeight(step(4), BAR));
    expect(metricWeight(step(8), BAR)).toBeGreaterThan(metricWeight(step(12), BAR));
  });

  it('repeats the pattern in the next bar', () => {
    expect(metricWeight(step(16), BAR)).toBeCloseTo(metricWeight(step(0), BAR));
    expect(metricWeight(step(20), BAR)).toBeCloseTo(metricWeight(step(4), BAR));
  });

  it('handles a negative tick as the bar before, not as an error', () => {
    expect(metricWeight(-BAR, BAR)).toBeCloseTo(metricWeight(0, BAR));
  });

  it('treats a position off the sixteenth grid as the weakest', () => {
    expect(metricWeight(step(4) + 7, BAR)).toBeLessThan(metricWeight(step(3), BAR) + 1e-9);
  });

  it('stays inside 0..1 everywhere in the bar', () => {
    for (let t = 0; t < BAR; t++) {
      const w = metricWeight(t, BAR);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

describe('hand-over thresholds', () => {
  it('keeps every A hit at x=0 and drops every one by x=1', () => {
    // This is a REQUIREMENT, not a taste: it is what makes x=0 exactly A and
    // x=1 exactly B. No hit may change state at either end.
    for (let s = 0; s < 16; s++) {
      expect(leavesAt(step(s), BAR)).toBeGreaterThan(0);
      expect(leavesAt(step(s), BAR)).toBeLessThan(1);
    }
  });

  it('lets no B hit in at x=0 and lets every one in by x=1', () => {
    for (let s = 0; s < 16; s++) {
      expect(entersAt(step(s), BAR)).toBeGreaterThan(0);
      expect(entersAt(step(s), BAR)).toBeLessThan(1);
    }
  });

  it('lets a strong hit of A outlast a weak one', () => {
    expect(leavesAt(step(0), BAR)).toBeGreaterThan(leavesAt(step(3), BAR));
    expect(leavesAt(step(4), BAR)).toBeGreaterThan(leavesAt(step(3), BAR));
  });

  it('lets a strong hit of B arrive before a weak one', () => {
    expect(entersAt(step(0), BAR)).toBeLessThan(entersAt(step(3), BAR));
    expect(entersAt(step(4), BAR)).toBeLessThan(entersAt(step(3), BAR));
  });

  it('mirrors the two: what leaves last is what arrives first', () => {
    for (let s = 0; s < 16; s++) {
      expect(leavesAt(step(s), BAR) + entersAt(step(s), BAR)).toBeCloseTo(1);
    }
  });
});
