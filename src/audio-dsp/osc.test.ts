import { describe, it, expect } from 'vitest';
import { SawOsc, SquareOsc, TriOsc, SineOsc, WhiteNoise } from './osc';

const SR = 48000;
function rms(buf: number[]): number {
  return Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
}

describe('oscillators', () => {
  it('saw stays bounded and is non-silent at 440 Hz', () => {
    const o = new SawOsc(SR);
    const buf: number[] = [];
    for (let i = 0; i < SR / 10; i++) buf.push(o.update(440));
    expect(Math.max(...buf)).toBeLessThanOrEqual(1.001);
    expect(Math.min(...buf)).toBeGreaterThanOrEqual(-1.001);
    expect(rms(buf)).toBeGreaterThan(0.3);
  });

  it('sine completes ~N cycles in N/freq seconds (zero crossings)', () => {
    const o = new SineOsc(SR);
    let crossings = 0; let prev = 0;
    for (let i = 0; i < SR; i++) {            // 1 second @ 100 Hz → ~200 zero crossings
      const v = o.update(100);
      if (prev <= 0 && v > 0) crossings++;
      prev = v;
    }
    expect(crossings).toBeGreaterThan(95);
    expect(crossings).toBeLessThan(105);
  });

  it('white noise is broadband (high RMS, near-zero DC)', () => {
    const o = new WhiteNoise();
    const buf: number[] = [];
    for (let i = 0; i < SR / 10; i++) buf.push(o.update());
    const mean = buf.reduce((s, v) => s + v, 0) / buf.length;
    expect(rms(buf)).toBeGreaterThan(0.4);
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  it('square is bipolar with ~50% duty (mean near 0)', () => {
    const o = new SquareOsc(SR);
    const buf: number[] = [];
    for (let i = 0; i < SR / 10; i++) buf.push(o.update(220));
    const mean = buf.reduce((s, v) => s + v, 0) / buf.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });
});
