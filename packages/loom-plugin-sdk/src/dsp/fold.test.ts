import { describe, it, expect } from 'vitest';
import { fold } from './fold';

describe('the wavefolder', () => {
  it('a drive of zero silences it — it is not a bypass', () => {
    // sin(0) = 0. Worth pinning because "amount 0 = clean" is the intuition
    // every other FX in the tree obeys, and this one does not: the drive
    // multiplies the input BEFORE the sine, so zero drive is silence. The West
    // Coast renderer relies on that (its floor is 0.1, never 0).
    expect(fold(0.5, 0)).toBe(0);
  });

  it('folds back instead of clipping: more input, less output', () => {
    // THE property, and what separates a folder from a clipper. At drive 1 the
    // input 0.125 sits on the sine's first peak and 0.25 on its zero crossing,
    // so pushing HARDER gives LESS. A clipper can never do this.
    expect(Math.abs(fold(0.25, 1))).toBeLessThan(Math.abs(fold(0.125, 1)));
  });

  it('is odd-symmetric, so it adds no DC', () => {
    // A folder that is not odd-symmetric thumps the amp with an offset.
    for (const x of [0.2, 0.5, 0.8, 1.0]) {
      expect(fold(-x, 1)).toBeCloseTo(-fold(x, 1), 12);
    }
  });

  it('clamps before folding, so it never runs away', () => {
    // Input beyond ±1/drive is clamped, so an enormous input lands exactly
    // where the boundary does rather than spinning through more lobes.
    expect(fold(5, 1)).toBeCloseTo(fold(1, 1), 12);
    for (const x of [2, 5, 20]) expect(Math.abs(fold(x, 1))).toBeLessThanOrEqual(1);
  });
});
