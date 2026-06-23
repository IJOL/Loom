// src/audio-dsp/filter.test.ts
import { describe, it, expect } from 'vitest';
import { Svf } from './filter';
import { SawOsc, SineOsc } from './osc';

const SR = 48000;
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('Svf lowpass', () => {
  it('passes a 100 Hz sine almost unchanged at a 5 kHz cutoff', () => {
    const f = new Svf(SR); const o = new SineOsc(SR);
    const out: number[] = [];
    for (let i = 0; i < SR; i++) { f.update(o.update(100), 5000, 0); out.push(f.lp); }
    expect(rms(out)).toBeGreaterThan(0.5);   // sine RMS ~0.707, barely attenuated
  });

  it('attenuates a bright saw more at a low cutoff than at a high cutoff', () => {
    const measure = (cut: number) => {
      const f = new Svf(SR); const o = new SawOsc(SR); const out: number[] = [];
      for (let i = 0; i < SR; i++) { f.update(o.update(880), cut, 0); out.push(f.lp); }
      return rms(out);
    };
    expect(measure(8000)).toBeGreaterThan(measure(300) * 1.5);
  });

  it('resonance boosts energy near the cutoff vs no resonance', () => {
    const measure = (res: number) => {
      const f = new Svf(SR); const o = new SawOsc(SR); const out: number[] = [];
      for (let i = 0; i < SR; i++) { f.update(o.update(110), 1200, res); out.push(f.lp); }
      return rms(out);
    };
    expect(measure(8)).toBeGreaterThan(measure(0));
  });
});
