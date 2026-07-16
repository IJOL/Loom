// The two ladder filters. Assertions are relative: energy ratios between
// settings, never absolute magnitudes — except the blow-up ceilings, which are
// justified where they appear.

import { describe, it, expect } from 'vitest';
import { LadderFilter } from './ladder';

const SR = 48000;

/** Push a saw through a filter and report the RMS. */
function through(f: LadderFilter, cutoffHz: number, res: number, freq = 110, secs = 0.1): number {
  let phase = 0, sum = 0;
  const n = Math.floor(secs * SR);
  for (let i = 0; i < n; i++) {
    phase += freq / SR;
    if (phase >= 1) phase -= 1;
    const saw = 2 * phase - 1;
    const y = f.update(saw, cutoffHz, res);
    sum += y * y;
  }
  return Math.sqrt(sum / n);
}

describe('LadderFilter', () => {
  it('passes signal', () => {
    const f = new LadderFilter('moog', SR);
    expect(through(f, 8000, 0)).toBeGreaterThan(0);
  });

  it('cuts the highs: a closed cutoff is quieter than an open one', () => {
    const open = through(new LadderFilter('moog', SR), 12000, 0);
    const shut = through(new LadderFilter('moog', SR), 200, 0);
    expect(shut).toBeLessThan(open * 0.7);
  });

  it('resonates: after an impulse it rings, and rings more the higher the resonance', () => {
    // Measured as OSCILLATION, not level. A ladder subtracts its feedback from
    // the input, so more resonance actually makes it quieter overall (RMS 1.34
    // at res 0 down to 0.46 at res 1) while the cutoff peak grows. Counting the
    // ring's zero-crossings sees the resonance without the level confusing it.
    const ringCrossings = (res: number): number => {
      const f = new LadderFilter('moog', SR);
      f.update(1, 700, res);                       // one impulse…
      let zc = 0, prev = 0;
      for (let i = 0; i < SR * 0.05; i++) {        // …then silence: what is left is the ring
        const y = f.update(0, 700, res);
        if (prev < 0 && y >= 0) zc++;
        prev = y;
      }
      return zc;
    };
    expect(ringCrossings(0)).toBe(0);              // no resonance: it just decays
    expect(ringCrossings(0.5)).toBeGreaterThan(10);
    expect(ringCrossings(0.9)).toBeGreaterThan(ringCrossings(0.5));
  });

  it('stays bounded even at full resonance — no self-oscillating blow-up', () => {
    // Absolute ceiling, justified: a voice must stay near unity or the master
    // limiter downstream is permanently crushed. A runaway ladder is the classic
    // way that happens.
    const f = new LadderFilter('moog', SR);
    let phase = 0, peak = 0;
    for (let i = 0; i < SR; i++) {
      phase += 110 / SR; if (phase >= 1) phase -= 1;
      const y = f.update(2 * phase - 1, 600, 1);
      if (Math.abs(y) > peak) peak = Math.abs(y);
    }
    expect(peak).toBeLessThan(8);
    expect(Number.isFinite(peak)).toBe(true);
  });

  it('the diode ladder does not sound like the moog', () => {
    // Same input, same settings: the asymmetric clipping must make a difference,
    // or the model is a copy with a different name.
    const moog = through(new LadderFilter('moog', SR), 800, 0.7);
    const diode = through(new LadderFilter('diode', SR), 800, 0.7);
    expect(Math.abs(moog - diode) / Math.max(moog, diode)).toBeGreaterThan(0.02);
  });

  it('the diode ladder is asymmetric — it clips harder one way (that is the 303 bite)', () => {
    // A symmetric input through a symmetric nonlinearity averages to ~0. The
    // diode's clip is asymmetric, so its output sits off zero — and that offset
    // is the even harmonics a tanh ladder simply cannot make.
    // Driven hard, with the stages inside a resonant loop: that is where the
    // asymmetry compounds (measured ~6x the moog's residual).
    const meanOf = (model: 'moog' | 'diode'): number => {
      const f = new LadderFilter(model, SR);
      let phase = 0, sum = 0;
      const n = SR * 0.2;
      for (let i = 0; i < n; i++) {
        phase += 110 / SR; if (phase >= 1) phase -= 1;
        sum += f.update(2 * phase - 1, 700, 0.9);
      }
      return Math.abs(sum / n);
    };
    expect(meanOf('diode')).toBeGreaterThan(meanOf('moog') * 3);
  });

  it('tracks the cutoff above 0.30·sr instead of detuning (the clamped Huovilainen g)', () => {
    // The Huovilainen coefficient fit overshoots ~1.16 near 0.45·sr; unclamped,
    // the one-pole coefficient passes unity and the filter stops tracking.
    // Cutoff wide open must not be quieter than half-open.
    const half = through(new LadderFilter('moog', SR), SR * 0.15, 0);
    const wide = through(new LadderFilter('moog', SR), SR * 0.44, 0);
    expect(wide).toBeGreaterThan(half * 0.9);
    expect(Number.isFinite(wide)).toBe(true);
  });

  it('reset() clears the stages, so a reused voice does not inherit a tail', () => {
    const f = new LadderFilter('moog', SR);
    for (let i = 0; i < 1000; i++) f.update(1, 500, 0.9);
    f.reset();
    expect(f.update(0, 500, 0.9)).toBe(0);
  });
});
