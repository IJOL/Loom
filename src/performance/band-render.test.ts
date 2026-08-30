// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { peaksFor, clearPeaksCache } from './band-render';
import { sampleCache } from '../samples/sample-cache';

function fakeBuffer(fill: (i: number, n: number) => number, n = 2048): AudioBuffer {
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = fill(i, n);
  return {
    numberOfChannels: 1, length: n, sampleRate: 44100, duration: n / 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe('peaksFor', () => {
  beforeEach(() => { clearPeaksCache(); sampleCache.clear(); });

  it('is computed once and cached per sample+buckets (same array identity)', () => {
    sampleCache.put('s1', fakeBuffer(() => 0.5));
    const a = peaksFor('s1', 64);
    const b = peaksFor('s1', 64);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it('returns null while the buffer is not decoded yet', () => {
    expect(peaksFor('nope', 64)).toBeNull();
  });

  it('reflects the louder half of the buffer (relative)', () => {
    sampleCache.put('s2', fakeBuffer((i, n) => (i < n / 2 ? 0.1 : 0.9)));
    const peaks = peaksFor('s2', 64)!;
    const mean = (arr: Float32Array) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const first = peaks.slice(0, 32);
    const second = peaks.slice(32);
    expect(mean(second)).toBeGreaterThan(mean(first) * 3);
  });
});
