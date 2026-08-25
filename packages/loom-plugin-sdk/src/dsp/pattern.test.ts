import { describe, it, expect } from 'vitest';
import { patternValue, patternValueBipolar, GOLDEN_PATTERN } from './pattern';

describe('the pattern formula', () => {
  it('stays inside its range', () => {
    for (let n = 0; n < 200; n++) {
      const v = patternValue(n, 0.37, 0.1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const b = patternValueBipolar(n, 0.37, 0.1);
      expect(b).toBeGreaterThanOrEqual(-1);
      expect(b).toBeLessThan(1);
    }
  });

  it('alternates at a half and cycles by four at a quarter', () => {
    // The claim the knob's whole character rests on: a rational pattern has a
    // period, and it is the denominator.
    expect(patternValue(0, 0.5)).toBe(patternValue(2, 0.5));
    expect(patternValue(0, 0.5)).not.toBe(patternValue(1, 0.5));
    expect(patternValue(0, 0.25)).toBe(patternValue(4, 0.25));
    expect(patternValue(0, 0.25)).not.toBe(patternValue(2, 0.25));
  });

  it('never comes back to a value it has already given, at the default', () => {
    // 0.618 would cycle at 500 — it is 309/500, and every rational cycles. The
    // full-precision conjugate does not, which is why the default is not a
    // short decimal.
    const seen = new Set<number>();
    for (let n = 0; n < 2000; n++) seen.add(patternValue(n));
    expect(seen.size).toBe(2000);
  });

  it('gives the same answer for the same ordinal, every time it is asked', () => {
    // What separates it from a random value: the same take, every pass.
    expect(patternValue(1234, 0.618, 0.2)).toBe(patternValue(1234, 0.618, 0.2));
  });

  it('shifts the whole sequence when skewed, without changing its shape', () => {
    const a = [0, 1, 2, 3].map((n) => patternValue(n, 0.25, 0));
    const b = [0, 1, 2, 3].map((n) => patternValue(n, 0.25, 0.25));
    expect(b).toEqual([...a.slice(1), a[0]]);
  });

  it('folds a NEGATIVE ordinal the same way as a positive one', () => {
    // Bitwise truncation folds these towards zero and would put a negative
    // ordinal outside 0..1 entirely.
    expect(patternValue(-1, 0.25)).toBeGreaterThanOrEqual(0);
    expect(patternValue(-7, GOLDEN_PATTERN)).toBeLessThan(1);
  });

  it('survives an ordinal past what 32 bits can hold', () => {
    // A long session outruns them, and a truncating implementation wraps.
    const v = patternValue(5_000_000_000, GOLDEN_PATTERN);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('answers zero rather than NaN to numbers that are not numbers', () => {
    // NaN here reaches a param and then a voice, and a voice with a NaN
    // anywhere in it cannot be released by a stop.
    expect(patternValue(NaN)).toBe(0);
    expect(patternValue(0, NaN)).toBe(0);
    expect(patternValue(0, 0.5, Infinity)).toBe(0);
  });
});
