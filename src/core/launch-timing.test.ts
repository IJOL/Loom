import { describe, it, expect } from 'vitest';
import { governingLoopSec, clipLoopSec, nextLoopEnd, sceneSwitchBoundary } from './launch-timing';
import type { SessionClip } from '../session/session';

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

describe('clipLoopSec', () => {
  it('matches the scheduler: 2-bar clip at 120bpm in 4/4 = 4s', () => {
    const clip = { id: 'c', lengthBars: 2, notes: [] } as SessionClip;
    expect(clipLoopSec(clip, 120)).toBeCloseTo(4, 9); // 2 bars × 2 s/bar
  });
  it('1-bar clip at 120bpm = 2s', () => {
    const clip = { id: 'c', lengthBars: 1, notes: [] } as SessionClip;
    expect(clipLoopSec(clip, 120)).toBeCloseTo(2, 9);
  });
});

describe('nextLoopEnd', () => {
  it('mid-loop → next boundary', () => {
    expect(nextLoopEnd(0, 2, 3)).toBeCloseTo(4, 9);   // 3s into 2s loops → 4s
  });
  it('just started → first loop end', () => {
    expect(nextLoopEnd(10, 2, 10)).toBeCloseTo(12, 9);
  });
  it('exactly on a boundary → that boundary', () => {
    expect(nextLoopEnd(0, 2, 4)).toBeCloseTo(4, 9);
  });
  it('now before start → first loop end after start', () => {
    expect(nextLoopEnd(10, 2, 5)).toBeCloseTo(12, 9);
  });
  it('degenerate loopSec → now', () => {
    expect(nextLoopEnd(0, 0, 7)).toBe(7);
  });
});

describe('sceneSwitchBoundary', () => {
  it('single playing clip → its own next loop end', () => {
    expect(sceneSwitchBoundary([{ loopStartedAt: 0, loopSec: 2 }], 3)).toBeCloseTo(4, 9);
  });
  it('equal-length aligned clips → shared boundary', () => {
    const p = [{ loopStartedAt: 0, loopSec: 2 }, { loopStartedAt: 0, loopSec: 2 }];
    expect(sceneSwitchBoundary(p, 3)).toBeCloseTo(4, 9);
  });
  it('mixed lengths, no outlier → governed by the longest (4s loop)', () => {
    // lengths 2s & 4s; 4 > 2·2? no → governs 4s; aligned at 0 → next end 8s when now=5
    const p = [{ loopStartedAt: 0, loopSec: 2 }, { loopStartedAt: 0, loopSec: 4 }];
    expect(sceneSwitchBoundary(p, 5)).toBeCloseTo(8, 9);
  });
  it('giant outlier dropped → governed by the 2s loop', () => {
    // lengths 2s & 16s; 16 > 2·2 → drop → governs 2s; now=5 → next 2s end is 6s
    const p = [{ loopStartedAt: 0, loopSec: 2 }, { loopStartedAt: 0, loopSec: 16 }];
    expect(sceneSwitchBoundary(p, 5)).toBeCloseTo(6, 9);
  });
  it('empty → now', () => {
    expect(sceneSwitchBoundary([], 5)).toBe(5);
  });
});
