// The wavetable primitives, driven sample by sample with no AudioContext.
// Assertions are relative where a measurement is involved; the few exact
// numbers below are the DEFINITION of the function under test (a normalised
// peak IS 1, halfway between 0 and 1 IS 0.5), not a calibrated threshold.
import { describe, it, expect } from 'vitest';
import { synthWaveTable, sampleTable, WavetableOsc } from './wavetable';

const SR = 48000;

const sineSpec = () => { const imag = new Float32Array(8); imag[1] = 1; return { imag }; };
const sawSpec = () => {
  const imag = new Float32Array(32);
  for (let k = 1; k < 32; k++) imag[k] = (2 / (Math.PI * k)) * (k % 2 === 0 ? 1 : -1);
  return { imag };
};
const peak = (b: ArrayLike<number>) => { let p = 0; for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p; };
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const zeroCrossings = (b: number[]) => { let n = 0; for (let i = 1; i < b.length; i++) if ((b[i] >= 0) !== (b[i - 1] >= 0)) n++; return n; };
const run = (osc: WavetableOsc, freq: number, morph: number, samples: number) => {
  const out: number[] = new Array(samples);
  for (let i = 0; i < samples; i++) out[i] = osc.update(freq, morph);
  return out;
};

describe('synthWaveTable', () => {
  it('peak-normalises every table to the same level whatever its harmonic content', () => {
    const sine = synthWaveTable(sineSpec());
    const saw = synthWaveTable(sawSpec());
    expect(peak(saw) / peak(sine)).toBeCloseTo(1, 6);
    expect(peak(sine)).toBeCloseTo(1, 6);   // definitional: that is what normalised means
  });

  it('a one-harmonic spec is a sine, sample for sample', () => {
    const t = synthWaveTable(sineSpec(), 256);
    let worst = 0;
    for (let i = 0; i < 256; i++) worst = Math.max(worst, Math.abs(t[i] - Math.sin((i / 256) * 2 * Math.PI)));
    expect(worst / peak(t)).toBeLessThan(1e-6);
  });
});

describe('sampleTable', () => {
  const t = new Float32Array([0, 1, 0, -1]);

  it('reads the grid exactly and interpolates halfway between neighbours', () => {
    expect(sampleTable(t, 0.25)).toBe(1);
    expect(sampleTable(t, 0.125)).toBeCloseTo(0.5, 6);
    // The last segment wraps to the first sample: between -1 and 0.
    expect(sampleTable(t, 0.875)).toBeCloseTo(-0.5, 6);
  });

  it('phase 1 reads as phase 0', () => {
    expect(sampleTable(t, 1)).toBe(sampleTable(t, 0));
  });
});

describe('WavetableOsc', () => {
  const sine = synthWaveTable(sineSpec());
  const saw = synthWaveTable(sawSpec());

  it('runs at the frequency it is given: a sine at 440 Hz crosses zero 880 times a second', () => {
    const out = run(new WavetableOsc(sine, saw, SR), 440, 0, SR);
    expect(zeroCrossings(out) / 880).toBeGreaterThan(0.98);
    expect(zeroCrossings(out) / 880).toBeLessThan(1.02);
  });

  it('morph 0 is table A alone and morph 1 is table B alone', () => {
    const a = run(new WavetableOsc(sine, saw, SR), 220, 0, 2000);
    const b = run(new WavetableOsc(sine, saw, SR), 220, 1, 2000);
    const onlySine = run(new WavetableOsc(sine, sine, SR), 220, 0, 2000);
    const onlySaw = run(new WavetableOsc(saw, saw, SR), 220, 0, 2000);
    expect(a).toEqual(onlySine);
    // cos(π/2) is not exactly 0 in floating point: compare to within rounding.
    for (let i = 0; i < b.length; i++) expect(Math.abs(b[i] - onlySaw[i])).toBeLessThan(1e-6);
  });

  it('the crossfade is equal-power: identical tables at morph ½ sum to √2 of one', () => {
    const one = rms(run(new WavetableOsc(sine, sine, SR), 220, 0, 4800));
    const half = rms(run(new WavetableOsc(sine, sine, SR), 220, 0.5, 4800));
    expect(half / one).toBeCloseTo(Math.SQRT2, 3);
  });

  it('is deterministic: two oscillators on the same inputs agree sample for sample', () => {
    expect(run(new WavetableOsc(sine, saw, SR), 330, 0.3, 1000))
      .toEqual(run(new WavetableOsc(sine, saw, SR), 330, 0.3, 1000));
  });
});
