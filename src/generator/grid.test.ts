import { describe, it, expect } from 'vitest';
import { clampGrid, patternBars, patternSteps, readHead, DEFAULT_GRID } from './grid';

describe('the grid', () => {
  it('takes as many bars as repeats × 2^pow2', () => {
    expect(patternBars({ repeats: 1, pow2: 0 })).toBe(1);
    expect(patternBars({ repeats: 3, pow2: 0 })).toBe(3);
    expect(patternBars({ repeats: 3, pow2: 2 })).toBe(12);
  });

  it('counts steps at whatever division it is handed', () => {
    const g = { repeats: 2, pow2: 1 };
    // Four bars either way; twice the steps at twice the division.
    expect(patternSteps(g, 8)).toBe(patternSteps(g, 4) * 2);
  });

  it('never has a length of zero', () => {
    // A zero divisor reaches every note start as NaN, and a voice whose start
    // is NaN can neither gate off nor be released by a stop.
    expect(patternSteps(DEFAULT_GRID, 0)).toBeGreaterThan(0);
    expect(patternSteps(DEFAULT_GRID, -4)).toBeGreaterThan(0);
    expect(patternSteps(DEFAULT_GRID, NaN)).toBeGreaterThan(0);
  });

  it('clamps a grid out of range instead of refusing it', () => {
    expect(clampGrid({ repeats: 999, pow2: 99 })).toEqual({ repeats: 16, pow2: 3 });
    expect(clampGrid({ repeats: 0, pow2: -5 })).toEqual({ repeats: 1, pow2: 0 });
    expect(clampGrid({ repeats: NaN, pow2: Infinity })).toEqual(DEFAULT_GRID);
    expect(clampGrid(null)).toEqual(DEFAULT_GRID);
  });

  it('folds a step to a position inside the pattern', () => {
    const g = { repeats: 1, pow2: 0 };
    const len = patternSteps(g, 4);
    for (let s = 0; s < 40; s++) {
      const h = readHead(s, g, 4);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(len);
    }
  });

  it('comes round again exactly one pattern later', () => {
    const g = { repeats: 3, pow2: 1 };
    const len = patternSteps(g, 4);
    for (let s = 0; s < 20; s++) {
      expect(readHead(s + len, g, 4)).toBe(readHead(s, g, 4));
    }
  });

  it('folds a NEGATIVE step to a real position, not a negative index', () => {
    // The look-ahead can genuinely ask for a step before the transport's zero.
    const g = { repeats: 2, pow2: 0 };
    expect(readHead(-1, g, 4)).toBe(patternSteps(g, 4) - 1);
    expect(readHead(-9, g, 4)).toBeGreaterThanOrEqual(0);
  });

  it('reads the same absolute step the same way whenever it is asked', () => {
    const g = { repeats: 5, pow2: 1 };
    expect(readHead(1234, g, 4)).toBe(readHead(1234, g, 4));
  });
});
