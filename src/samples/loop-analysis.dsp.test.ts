import { describe, it, expect } from 'vitest';
import { detectLoop } from './loop-analysis';
import { DEFAULT_METER } from '../core/meter';
import { listLoopFixtures, readFixtureBytes } from '../../test/loop-fixtures';

// Build a mono click-train AudioBuffer: `beats` impulses over `durationSec`.
function clickTrain(durationSec: number, beats: number, sr = 44100): AudioBuffer {
  const ctx = new OfflineAudioContext(1, Math.ceil(durationSec * sr), sr);
  const buf = ctx.createBuffer(1, Math.ceil(durationSec * sr), sr);
  const data = buf.getChannelData(0);
  for (let b = 0; b < beats; b++) {
    const at = Math.floor((b / beats) * data.length);
    for (let i = 0; i < 200 && at + i < data.length; i++) {
      data[at + i] = Math.exp(-i / 30) * (i % 2 ? 1 : -1);
    }
  }
  return buf;
}

describe('detectLoop (synthetic)', () => {
  it('detects the tempo of a 2-bar 4/4 click train within 3%', () => {
    const buf = clickTrain(4.0, 8); // 8 beats over 4s = 120 bpm
    const r = detectLoop(buf, DEFAULT_METER);
    expect(r.originalBpm).toBeGreaterThan(120 * 0.97);
    expect(r.originalBpm).toBeLessThan(120 * 1.03);
  });

  it('finds roughly the right number of onsets', () => {
    const buf = clickTrain(4.0, 8);
    const r = detectLoop(buf, DEFAULT_METER);
    expect(r.slicePointsSec.length).toBeGreaterThanOrEqual(6);
    expect(r.slicePointsSec.length).toBeLessThanOrEqual(12);
  });
});

// Octave-equivalent within tolerance (tempo detection commonly returns half/double).
function octaveClose(detected: number, truth: number, tol = 0.06): boolean {
  for (const k of [0.25, 0.5, 1, 2, 4]) {
    if (Math.abs(detected - truth * k) / (truth * k) < tol) return true;
  }
  return false;
}

describe('detectLoop (real loop corpus)', () => {
  const fixtures = listLoopFixtures('drum').filter((f) => f.bpm != null);
  const run = fixtures.length > 0 ? it : it.skip;

  run('decodes every fixture and returns a sane in-range tempo + onsets', async () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    let octaveCorrect = 0;
    for (const fx of fixtures) {
      const buf = await ctx.decodeAudioData(readFixtureBytes(fx.path));
      const r = detectLoop(buf, DEFAULT_METER);
      // sane output for every real loop (no throw, in musical range, has onsets)
      expect(r.originalBpm).toBeGreaterThanOrEqual(70);
      expect(r.originalBpm).toBeLessThanOrEqual(180);
      expect(r.slicePointsSec.length).toBeGreaterThan(0);
      if (octaveClose(r.originalBpm, fx.bpm!)) octaveCorrect++;
    }
    // The detector should land octave-equivalent to the filename BPM on a
    // majority of the corpus (relative assertion; not every loop is easy).
    expect(octaveCorrect).toBeGreaterThanOrEqual(Math.ceil(fixtures.length / 2));
  });
});
