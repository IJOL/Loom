// seedWarpMarkers chooses, per track, the grid (drift-following tracker vs constant
// tempo) that best lands the ground-truth KICKS on the beat. This test pins two
// guarantees on the user's real drum stems: the chosen grid (1) reaches the end of
// the audio, and (2) is never worse than either candidate — so picking can only
// help. It also logs the alignment so regressions in either grid are visible.
import { describe, it, expect } from 'vitest';
import bank from '../../test/fixtures/warp-stems/bank.json';
import { seedWarpMarkers, seedSparseWarpMarkers, seedConstantWarpMarkers } from './warp-seed-sparse';
import { warpQuality } from './warp-quality';
import { barCountFor } from '../core/slice-clip';
import { DEFAULT_METER } from '../core/meter';

interface Fixture { tag: string; bpm: number; duration: number; onsets: number[]; kicks: number[]; }
const FIXTURES = Object.values(bank as Record<string, Fixture>).filter((f) => Array.isArray(f.onsets));
const meter = DEFAULT_METER;

function anchorBars(fx: Fixture) {
  const first = fx.onsets.find((t) => t > 0);
  const anchor = first != null && first <= 2.0 ? first : 0;
  const clipBars = barCountFor(Math.max(0.001, fx.duration - anchor), fx.bpm, meter);
  return { anchor, clipBars };
}

describe('seedWarpMarkers picks the grid that best aligns the kicks', () => {
  for (const fx of FIXTURES) {
    it(`${fx.tag}`, () => {
      const { anchor, clipBars } = anchorBars(fx);
      const chosen = seedWarpMarkers(fx.onsets, fx.kicks, anchor, fx.bpm, fx.duration, meter, 4, clipBars);
      const tracked = seedSparseWarpMarkers(fx.onsets, anchor, fx.bpm, fx.duration, meter, 4, clipBars);
      const constant = seedConstantWarpMarkers(anchor, fx.bpm, fx.duration, meter, 4, clipBars);
      const qc = warpQuality(chosen, fx.kicks, fx.duration);
      const qt = warpQuality(tracked, fx.kicks, fx.duration);
      const qk = warpQuality(constant, fx.kicks, fx.duration);
      // eslint-disable-next-line no-console
      console.log(`${fx.tag.padEnd(14)} chosen=${qc.alignedFrac.toFixed(2)}  (tracker=${qt.alignedFrac.toFixed(2)} const=${qk.alignedFrac.toFixed(2)})  end=${(qc.coverage * 100).toFixed(0)}%`);

      expect(qc.coverage).toBeGreaterThanOrEqual(0.97);                  // reaches the end
      expect(qc.alignedFrac).toBeGreaterThanOrEqual(qt.alignedFrac - 1e-9); // never worse than tracker
      expect(qc.alignedFrac).toBeGreaterThanOrEqual(qk.alignedFrac - 1e-9); // ...nor than constant
    });
  }
});
