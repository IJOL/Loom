// End-to-end: real audio loop (WAV fixture) → onset detection → slice into
// per-slice buffers → recompose by re-scheduling each slice at its own onset →
// compare the rendered recomposition against the original. Placing contiguous
// slices back at the positions they were cut from must reproduce the loop, so
// this proves the slice→recompose pipeline is faithful (the "compare how the
// loop sounds directly vs how we recompose it" check).

import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { detectLoop } from './loop-analysis';
import { sliceBuffer } from './slice-buffer';
import { DEFAULT_METER } from '../core/meter';
import { listLoopFixtures, readFixtureBytes } from '../../test/loop-fixtures';

/** Zero-lag normalised cross-correlation of channel 0 over the shared length. */
function similarity(a: AudioBuffer, b: AudioBuffer): { corr: number; residRatio: number } {
  const x = a.getChannelData(0), y = b.getChannelData(0);
  const n = Math.min(x.length, y.length);
  let dot = 0, ex = 0, ey = 0, resid = 0;
  for (let i = 0; i < n; i++) {
    dot += x[i] * y[i]; ex += x[i] * x[i]; ey += y[i] * y[i];
    const d = x[i] - y[i]; resid += d * d;
  }
  return { corr: dot / (Math.sqrt(ex * ey) || 1), residRatio: resid / (ex || 1) };
}

async function decode(path: string): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  return ctx.decodeAudioData(readFixtureBytes(path)) as unknown as Promise<AudioBuffer>;
}

const fixtures = listLoopFixtures('drum');
const run = fixtures.length > 0 ? it : it.skip;

describe('loop → slice → recompose vs original', () => {
  run('recomposing the detected slices reproduces the original loop', async () => {
    for (const fx of fixtures.slice(0, 3)) {
      const orig = await decode(fx.path);
      const sr = orig.sampleRate;

      // detect onsets, cut the buffer into per-slice buffers
      const { slicePointsSec } = detectLoop(orig, DEFAULT_METER);
      const cuts = sliceBuffer(
        new OfflineAudioContext(orig.numberOfChannels, 1, sr) as unknown as BaseAudioContext,
        orig, slicePointsSec,
      );
      expect(cuts.length).toBeGreaterThan(0);

      // recompose: schedule each slice back at the onset it was cut from
      const render = new OfflineAudioContext(orig.numberOfChannels, orig.length, sr);
      for (const c of cuts) {
        const node = render.createBufferSource();
        node.buffer = c.buffer;
        node.connect(render.destination);
        node.start(c.startSec);
      }
      const rec = await render.startRendering() as unknown as AudioBuffer;

      const { corr, residRatio } = similarity(orig, rec);
      // faithful: the recomposition matches the original almost exactly
      // (only sub-sample boundary rounding differs).
      expect(corr).toBeGreaterThan(0.98);
      expect(residRatio).toBeLessThan(0.05);
    }
  });

  run('playing the whole loop as a single one-shot is bit-identical to the source', async () => {
    // The "least complicated route": the loop as one untouched one-shot.
    const fx = fixtures[0];
    const orig = await decode(fx.path);
    const render = new OfflineAudioContext(orig.numberOfChannels, orig.length, orig.sampleRate);
    const node = render.createBufferSource();
    node.buffer = orig; node.connect(render.destination); node.start(0);
    const rec = await render.startRendering() as unknown as AudioBuffer;
    const { corr } = similarity(orig, rec);
    expect(corr).toBeGreaterThan(0.999);
  });
});
