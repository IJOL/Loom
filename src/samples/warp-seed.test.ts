// src/samples/warp-seed.test.ts
import { describe, it, expect } from 'vitest';
import { seedWarpMarkers } from './warp-seed';

describe('seedWarpMarkers', () => {
  it('latches each beat to a nearby onset (absorbs drift)', () => {
    // 120 BPM → 0.5 s/beat, downbeat at 0. Onsets DRIFT late: beat 2 at 1.06 s
    // (not 1.00). Marker for beat 2 should take the onset, not the regular grid.
    const onsets = [0.0, 0.5, 1.06, 1.5, 2.0];
    const m = seedWarpMarkers(onsets, 0, 120, 2.1);
    const beat2 = m.find((x) => x.beat === 2)!;
    expect(beat2.srcSec).toBeCloseTo(1.06, 2);   // snapped to the drifted onset
    expect(beat2.srcSec).not.toBeCloseTo(1.0, 2); // NOT the regular-grid time
  });
  it('falls back to the regular grid when no onset is near', () => {
    const m = seedWarpMarkers([0.0], 0, 120, 1.1); // only a downbeat onset
    expect(m.find((x) => x.beat === 2)!.srcSec).toBeCloseTo(1.0, 2); // regular 2*0.5
  });
  it('keeps srcSec strictly increasing and starts at the downbeat', () => {
    const m = seedWarpMarkers([0.2, 0.5, 1.0], 0.2, 120, 1.3);
    expect(m[0]).toEqual({ srcSec: 0.2, beat: 0 });
    for (let i = 1; i < m.length; i++) expect(m[i].srcSec).toBeGreaterThan(m[i - 1].srcSec);
  });
});
