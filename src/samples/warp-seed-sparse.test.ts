import { describe, it, expect } from 'vitest';
import { seedSparseWarpMarkers } from './warp-seed-sparse';
import { DEFAULT_METER } from '../core/meter';

// A drifting beat grid: spacing wobbles around 0.5 s (≈120 BPM nominal).
function driftingBeats(n: number): number[] {
  const t = [0];
  for (let i = 0; i < n; i++) t.push(t[i] + 0.5 * (1 + 0.1 * Math.sin(i)));
  return t;
}

describe('seedSparseWarpMarkers', () => {
  const beats = driftingBeats(64);          // 65 beat times (beats 0..64)
  const duration = beats[64];

  it('produces one marker per N bars with pinned endpoints', () => {
    const m = seedSparseWarpMarkers(beats, 0, 120, duration, DEFAULT_METER, 4, 16);
    // 16 bars / 4 bars-per-marker = markers at beats 0,16,32,48,64
    expect(m.map((x) => x.beat)).toEqual([0, 16, 32, 48, 64]);
    expect(m[0].beat).toBe(0);
    expect(m[m.length - 1].beat).toBe(16 * 4); // == clipBars*beatsPerBar (invariant)
  });

  it('latches markers to the drifted onsets, not the regular grid', () => {
    const m = seedSparseWarpMarkers(beats, 0, 120, duration, DEFAULT_METER, 4, 16);
    const period0 = 0.5;
    for (const mk of m) {
      const actual = beats[mk.beat];
      const regular = mk.beat * period0;
      // closer to where the beat actually is than to the regular grid
      expect(Math.abs(mk.srcSec - actual)).toBeLessThanOrEqual(Math.abs(actual - regular) + 1e-6);
    }
  });

  it('keeps srcSec strictly increasing', () => {
    const m = seedSparseWarpMarkers(beats, 0, 120, duration, DEFAULT_METER, 4, 16);
    for (let i = 1; i < m.length; i++) expect(m[i].srcSec).toBeGreaterThan(m[i - 1].srcSec);
  });

  it('returns [] when less than one bar is available', () => {
    expect(seedSparseWarpMarkers([0, 0.5], 0, 120, 0.6, DEFAULT_METER, 4, 16)).toEqual([]);
  });
});
