// src/engines/westcoast-fold.test.ts
import { describe, it, expect } from 'vitest';
import { makeFoldCurve, FOLD_STAGES } from './westcoast-fold';

describe('westcoast wavefolder curve', () => {
  it('returns a curve of the requested length', () => {
    const c = makeFoldCurve(FOLD_STAGES, 2048);
    expect(c).toBeInstanceOf(Float32Array);
    expect(c.length).toBe(2048);
  });

  it('passes through the origin (no DC at input 0)', () => {
    const c = makeFoldCurve();
    const mid = c[Math.floor(c.length / 2)];
    expect(Math.abs(mid)).toBeLessThan(0.05);
  });

  it('folds: the curve is non-monotonic with many sign changes', () => {
    const c = makeFoldCurve(4);
    let signChanges = 0;
    for (let i = 1; i < c.length; i++) {
      if (Math.sign(c[i]) !== Math.sign(c[i - 1]) && c[i] !== 0) signChanges++;
    }
    // sin(x·4·π) over [-1,1] crosses zero ~8 times → at least 7 sign changes.
    expect(signChanges).toBeGreaterThanOrEqual(7);
  });
});
