// src/audio-dsp/comb.test.ts
// A comb is a delay summed back on itself, so it does not shape one corner --
// it shapes a whole series of evenly spaced peaks. Its three taps differ by
// WHERE those peaks land, which is what these tests measure.
import { describe, it, expect } from 'vitest';
import { CombFilter } from './comb';

const SR = 48000;
const TUNE = 200;   // peaks spaced 200 Hz apart

/** Level of a steady sine at `hz` through the comb, past the run-in. */
const passes = (tap: 'comb+' | 'comb-' | 'combff', hz: number, fb = 0.8): number => {
  const c = new CombFilter(SR);
  let acc = 0, n = 0;
  for (let i = 0; i < SR * 0.3; i++) {
    const y = c.update(Math.sin(2 * Math.PI * hz * i / SR), TUNE, fb, tap);
    if (i > SR * 0.15) { acc += y * y; n++; }   // long run-in: the loop has to settle
  }
  return Math.sqrt(acc / n);
};

describe('the positive comb', () => {
  it('reinforces every harmonic of its tuning', () => {
    // 200, 400 and 600 all sit on peaks; 300 sits between two of them.
    expect(passes('comb+', 400)).toBeGreaterThan(passes('comb+', 300) * 3);
    expect(passes('comb+', 600)).toBeGreaterThan(passes('comb+', 300) * 3);
  });
});

describe('the negative comb', () => {
  it('reinforces the ODD harmonics and cancels the even ones', () => {
    // This is the difference between a plucked string and a stopped pipe, and
    // it is the whole reason NEG is its own tap rather than a variant of POS.
    expect(passes('comb-', 300)).toBeGreaterThan(passes('comb-', 400) * 3);
  });

  it('is a different sound from the positive comb at the same tuning', () => {
    expect(passes('comb-', 400)).toBeLessThan(passes('comb+', 400) * 0.4);
  });
});

describe('the feed-forward comb', () => {
  it('notches instead of ringing', () => {
    // No feedback path, so the peaks do not grow; what it does is cut.
    expect(passes('combff', 300)).toBeLessThan(passes('combff', 400) * 0.5);
  });

  it('cannot ring however hard the feedback knob is pushed', () => {
    // Its peak level barely moves with feedback, because there is none.
    const soft = passes('combff', 400, 0.1);
    const hard = passes('combff', 400, 0.99);
    expect(hard).toBeLessThan(soft * 2);
  });
});

describe('every comb stays bounded', () => {
  it('does not run away at maximum feedback', () => {
    for (const tap of ['comb+', 'comb-', 'combff'] as const) {
      const c = new CombFilter(SR);
      let peak = 0;
      for (let i = 0; i < SR * 0.5; i++) {
        const y = c.update(Math.sin(2 * Math.PI * 200 * i / SR), TUNE, 1.5, tap);
        expect(Number.isFinite(y), `${tap} went non-finite`).toBe(true);
        const a = Math.abs(y); if (a > peak) peak = a;
      }
      // A resonant comb legitimately rings well above unity; what must not
      // happen is unbounded growth. 20x is a runaway detector, not a target.
      expect(peak, `${tap} blew up`).toBeLessThan(20);
    }
  });

  it('holds its tuning at the bottom of the knob', () => {
    // The delay line is sized once, so the lowest tuning is capped in the DSP
    // rather than left to the knob: a per-voice buffer times an uncapped poly
    // lane is real memory.
    const c = new CombFilter(SR);
    for (let i = 0; i < 100; i++) expect(Number.isFinite(c.update(1, 1, 0.9, 'comb+'))).toBe(true);
  });

  it('holds its tuning at the top of the knob too', () => {
    // Cutoff alone reaches ~13 kHz, and the filter envelope can add ~16 kHz
    // more on top of it -- a deep, fast envelope on a comb voice is a real
    // path past sr*0.45 (21.6 kHz at 48 kHz), straight into the top clamp.
    // Driving tuneHz at sr itself is well past that clamp on every tap.
    for (const tap of ['comb+', 'comb-', 'combff'] as const) {
      const c = new CombFilter(SR);
      let peak = 0;
      for (let i = 0; i < SR * 0.2; i++) {
        const y = c.update(Math.sin(2 * Math.PI * 200 * i / SR), SR, 0.9, tap);
        expect(Number.isFinite(y), `${tap} went non-finite above sr*0.45`).toBe(true);
        const a = Math.abs(y); if (a > peak) peak = a;
      }
      // Same runaway detector as the bottom-of-knob/max-feedback case above,
      // not a claim about the tone at that tuning.
      expect(peak, `${tap} blew up above sr*0.45`).toBeLessThan(20);
    }
  });
});
