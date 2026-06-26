import { describe, it, expect } from 'vitest';
import { effectiveGlobalLoop, globalLoopIteration, wrapSongBars } from './global-loop';

describe('global-loop', () => {
  it('effectiveGlobalLoop: disabled when unset', () => {
    expect(effectiveGlobalLoop({}).enabled).toBe(false);
  });
  it('effectiveGlobalLoop: disabled when endBar <= startBar', () => {
    expect(effectiveGlobalLoop({ globalLoopEnabled: true, globalLoopStartBar: 4, globalLoopEndBar: 4 }).enabled).toBe(false);
  });
  it('effectiveGlobalLoop: enabled with valid bounds', () => {
    expect(effectiveGlobalLoop({ globalLoopEnabled: true, globalLoopStartBar: 2, globalLoopEndBar: 6 }))
      .toEqual({ enabled: true, startBar: 2, endBar: 6 });
  });
  it('globalLoopIteration: 4-bar loop @120bpm 4/4 (8s) — iter & iterStart', () => {
    const loop = { enabled: true, startBar: 0, endBar: 4 };
    // anchor 10, now 27 → elapsed 17, lenSec 8 → iter 2, iterStart 26
    const r = globalLoopIteration(27, 10, loop, 120);
    expect(r.lenSec).toBeCloseTo(8, 6);
    expect(r.iter).toBe(2);
    expect(r.iterStartSec).toBeCloseTo(26, 6);
    expect(r.aSec).toBeCloseTo(0, 6);
  });
  it('globalLoopIteration: non-zero A offset feeds aSec', () => {
    const r = globalLoopIteration(10, 10, { enabled: true, startBar: 2, endBar: 4 }, 120);
    expect(r.aSec).toBeCloseTo(4, 6); // 2 bars * 2s
  });
  it('wrapSongBars: wraps within [A,B)', () => {
    const loop = { enabled: true, startBar: 2, endBar: 4 };
    expect(wrapSongBars(2, loop)).toBeCloseTo(2, 6);
    expect(wrapSongBars(5, loop)).toBeCloseTo(3, 6); // (5-2)%2=1 → 2+1
    expect(wrapSongBars(6, loop)).toBeCloseTo(2, 6); // (6-2)%2=0 → 2
  });
  it('wrapSongBars: identity when disabled', () => {
    expect(wrapSongBars(9, { enabled: false, startBar: 0, endBar: 0 })).toBe(9);
  });
});
