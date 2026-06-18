import { describe, it, expect } from 'vitest';
import { governingLoopSec } from './launch-timing';

describe('governingLoopSec — iterative outlier cap (multiset)', () => {
  const cases: Array<[number[], number]> = [
    [[1, 2, 4], 4],          // 4 > 2·2? no → keep 4
    [[2, 2, 4], 4],          // 4 > 2·2? no → keep 4
    [[4, 4, 1], 4],          // duplicated longest: 4 > 2·4? no → keep 4 (NOT distinct)
    [[1, 1, 8], 1],          // 8 > 2·1 → drop 8; 1 > 2·1? no → 1
    [[1, 2, 16], 2],         // 16 > 2·2 → drop; 2 > 2·1? no → 2
    [[1, 16, 40], 1],        // 40 > 2·16 → drop; 16 > 2·1 → drop; 1
    [[1, 2, 4, 16], 4],      // drop 16; 4 > 2·2? no → 4
    [[5], 5],                // single
    [[], 0],                 // empty
    [[0, -3, 2], 2],         // non-positive filtered out
  ];
  it.each(cases)('governingLoopSec(%j) === %d', (lengths, expected) => {
    expect(governingLoopSec(lengths)).toBe(expected);
  });
});
