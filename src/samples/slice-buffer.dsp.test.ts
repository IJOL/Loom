import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { sliceBuffer, sliceBoundaries } from './slice-buffer';

describe('sliceBoundaries', () => {
  it('anchors 0, sorts, dedups, drops out-of-range', () => {
    expect(sliceBoundaries([0.5, 0.1, 0.1, 2.0], 1.0)).toEqual([0, 0.1, 0.5]);
  });
  it('falls back to [0] when there are no usable points', () => {
    expect(sliceBoundaries([], 1.0)).toEqual([0]);
    expect(sliceBoundaries([5, -1], 1.0)).toEqual([0]);
  });
});

describe('sliceBuffer', () => {
  it('partitions the buffer so the slices concatenate back to the original', () => {
    const sr = 8000;
    const ctx = new OfflineAudioContext(1, 1, sr);
    const n = sr; // 1.0s
    const src = ctx.createBuffer(1, n, sr);
    const d = src.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = i / n; // a ramp so every sample is identifiable
    const cuts = sliceBuffer(ctx as unknown as BaseAudioContext, src as unknown as AudioBuffer, [0.25, 0.5, 0.75]);
    expect(cuts.length).toBe(4);
    expect(cuts.map((c) => c.buffer.length)).toEqual([2000, 2000, 2000, 2000]);
    // concatenate and compare to the original
    let off = 0;
    for (const c of cuts) {
      const cd = c.buffer.getChannelData(0);
      for (let i = 0; i < cd.length; i++) {
        expect(cd[i]).toBeCloseTo(d[off + i], 6);
      }
      off += cd.length;
    }
    expect(off).toBe(n);
  });

  it('a single empty point list yields one whole-buffer slice', () => {
    const sr = 8000;
    const ctx = new OfflineAudioContext(1, 1, sr);
    const src = ctx.createBuffer(1, sr, sr);
    const cuts = sliceBuffer(ctx as unknown as BaseAudioContext, src as unknown as AudioBuffer, []);
    expect(cuts.length).toBe(1);
    expect(cuts[0].buffer.length).toBe(sr);
  });
});
