import { describe, it, expect } from 'vitest';
import { bufferPeak, peakNormGain } from './sample-loudness';

function buf(peakAmp: number, n = 256, channels = 1): AudioBuffer {
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const d = new Float32Array(n);
    // a single positive spike + a negative one a bit smaller, rest a quiet bed
    d[10] = peakAmp;
    d[20] = -peakAmp * 0.8;
    for (let i = 30; i < n; i++) d[i] = Math.sin(i) * peakAmp * 0.05;
    chans.push(d);
  }
  return {
    numberOfChannels: channels, length: n, sampleRate: 48000, duration: n / 48000,
    getChannelData: (c: number) => chans[c],
  } as unknown as AudioBuffer;
}

describe('bufferPeak', () => {
  it('returns the max absolute sample across the buffer', () => {
    expect(bufferPeak(buf(0.5))).toBeCloseTo(0.5, 5);
  });
  it('scans every channel', () => {
    const b = {
      numberOfChannels: 2, length: 4, sampleRate: 48000, duration: 1,
      getChannelData: (c: number) => (c === 0 ? new Float32Array([0.1, 0.2, 0, 0]) : new Float32Array([0, 0, -0.9, 0.3])),
    } as unknown as AudioBuffer;
    expect(bufferPeak(b)).toBeCloseTo(0.9, 5);
  });
  it('is 0 for a silent buffer', () => {
    const b = { numberOfChannels: 1, length: 4, sampleRate: 48000, duration: 1, getChannelData: () => new Float32Array(4) } as unknown as AudioBuffer;
    expect(bufferPeak(b)).toBe(0);
  });
});

describe('peakNormGain', () => {
  const target = Math.pow(10, -1 / 20); // ~0.891 (-1 dBFS)

  it('lifts a quiet (sub-peak) sample toward the target', () => {
    // a -7 dB peak (~0.447) should be boosted to ~target
    const peak = Math.pow(10, -7 / 20);
    const g = peakNormGain(peak);
    expect(peak * g).toBeCloseTo(target, 3);
    expect(g).toBeGreaterThan(1);
  });

  it('leaves a sample already at/above the target untouched (boost-only)', () => {
    expect(peakNormGain(0.95)).toBe(1);     // above target → no change
    expect(peakNormGain(1.0)).toBe(1);
  });

  it('boost-only: never raises the peak above the target, never attenuates', () => {
    // sub-peak files land at-or-below target; files already louder are left as-is
    // (the master soft-clip handles those, exactly as before normalization).
    for (const peak of [0.05, 0.2, 0.447, 0.7, 0.891, 1.0]) {
      const out = peak * peakNormGain(peak);
      expect(out).toBeLessThanOrEqual(Math.max(peak, target) + 1e-6);
      expect(out).toBeGreaterThanOrEqual(peak - 1e-6); // boost-only
    }
  });

  it('caps the boost so a near-silent file is not amplified into hiss', () => {
    const tiny = Math.pow(10, -40 / 20); // -40 dB peak
    const g = peakNormGain(tiny, { maxBoostDb: 12 });
    expect(g).toBeCloseTo(Math.pow(10, 12 / 20), 5); // capped at +12 dB
  });

  it('returns 1 for a silent or invalid buffer', () => {
    expect(peakNormGain(0)).toBe(1);
    expect(peakNormGain(-1)).toBe(1);
    expect(peakNormGain(NaN)).toBe(1);
  });
});
