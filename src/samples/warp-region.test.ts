import { describe, it, expect } from 'vitest';
import { srcSecAtBeat, sliceMarkersToRegion } from './warp-region';
import type { WarpMarker } from '../session/session';

// beat→srcSec here is a clean 0.25 s/beat ramp (beat 0→0s, 16→4s, 32→8s).
const M: WarpMarker[] = [
  { srcSec: 0, beat: 0 }, { srcSec: 4, beat: 16 }, { srcSec: 8, beat: 32 },
];

describe('warp-region', () => {
  it('srcSecAtBeat interpolates linearly and clamps at the endpoints', () => {
    expect(srcSecAtBeat(M, 0)).toBe(0);
    expect(srcSecAtBeat(M, 8)).toBeCloseTo(2);    // halfway into the first segment
    expect(srcSecAtBeat(M, 24)).toBeCloseTo(6);   // halfway into the second
    expect(srcSecAtBeat(M, -5)).toBe(0);          // clamp low
    expect(srcSecAtBeat(M, 99)).toBe(8);          // clamp high
  });

  it('sliceMarkersToRegion rebases to beat 0 and keeps interior markers', () => {
    const out = sliceMarkersToRegion(M, 8, 24);
    expect(out).toEqual([
      { srcSec: 2, beat: 0 },   // startBeat 8 → 0
      { srcSec: 4, beat: 8 },   // interior marker at beat 16 → 16-8
      { srcSec: 6, beat: 16 },  // endBeat 24 → 24-8
    ]);
  });

  it('sub-region length in beats matches the request', () => {
    const out = sliceMarkersToRegion(M, 4, 20);
    expect(out[0].beat).toBe(0);
    expect(out[out.length - 1].beat).toBe(16); // 20 - 4
  });

  it('returns markers unchanged for a degenerate region', () => {
    expect(sliceMarkersToRegion(M, 16, 16)).toBe(M);
    expect(sliceMarkersToRegion(M, 20, 8)).toBe(M);
    expect(sliceMarkersToRegion([{ srcSec: 0, beat: 0 }], 0, 8)).toHaveLength(1);
  });
});
