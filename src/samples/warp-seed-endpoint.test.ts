// The objective bug, no theory required: a clip lasts `duration` seconds, so the
// LAST warp marker must land at (≈) the end of the audio. If it stops at 79% the
// warp leaves the tail un-mapped and shoves everything before it — "las marcas no
// llegan al final". This test pins that invariant on the user's real drum-stem
// onsets; it is expected to FAIL on the current seed and pass once it's fixed.
import { describe, it, expect } from 'vitest';
import bank from '../../test/fixtures/warp-stems/bank.json';
import { seedSparseWarpMarkers } from './warp-seed-sparse';
import { barCountFor } from '../core/slice-clip';
import { DEFAULT_METER } from '../core/meter';

interface Fx { tag: string; bpm: number; duration: number; onsets: number[]; }
const FX = Object.values(bank as Record<string, Fx>).filter((f) => Array.isArray(f.onsets));
const meter = DEFAULT_METER;

describe('warp seed: the last marker must reach the end of the audio', () => {
  for (const fx of FX) {
    it(`${fx.tag}: last marker ≈ end`, () => {
      const first = fx.onsets.find((t) => t > 0);
      const anchor = first != null && first <= 2.0 ? first : 0;
      const clipBars = barCountFor(Math.max(0.001, fx.duration - anchor), fx.bpm, meter);
      const markers = seedSparseWarpMarkers(fx.onsets, anchor, fx.bpm, fx.duration, meter, 4, clipBars);
      const last = markers[markers.length - 1];
      const coverage = last.srcSec / fx.duration;
      // eslint-disable-next-line no-console
      console.log(`${fx.tag.padEnd(16)} last=${last.srcSec.toFixed(1)}s / dur=${fx.duration.toFixed(1)}s = ${(coverage * 100).toFixed(0)}%`);
      expect(coverage).toBeGreaterThanOrEqual(0.97);
    });
  }
});
