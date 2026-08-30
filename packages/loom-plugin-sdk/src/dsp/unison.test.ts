import { describe, it, expect } from 'vitest';
import { UnisonStack, driftDepthFor, MAX_UNISON, UNISON_MODES } from './unison';
import { SineOsc } from './osc';

const SR = 48000;
const SAW = 0;

function rms(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

/** One second of a stack at 220 Hz with the given size and spread. */
function capture(count: number, spreadCents: number, n = SR): number[] {
  const s = new UnisonStack(SAW, count, SR);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(s.update(220, 0.5, 0, spreadCents, 0));
  return out;
}

describe('the unison stack', () => {
  it('one copy is exactly one oscillator — gain 1, no compensation', () => {
    // The degenerate case has to be free, or turning unison off would still
    // change the level of every patch. 1^0.3 === 1.
    expect(new UnisonStack(SAW, 1, SR).gain).toBe(1);
  });

  it('a detuned stack is fatter but not N times louder', () => {
    // A stack that summed N copies without compensating would blow the
    // headroom of every preset that raises the voice count. Relative: the wide
    // stack must stay within a small factor of one copy, nowhere near 7x.
    const ratio = rms(capture(MAX_UNISON, 20)) / rms(capture(1, 20));
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(3);
  });

  it('spread makes the copies beat; no spread leaves them coherent', () => {
    // Beating is amplitude variation over time. Relative: the spread stack's
    // envelope must move more between two windows than the coherent one's.
    const wander = (spreadCents: number): number => {
      const out = capture(MAX_UNISON, spreadCents);
      return Math.abs(rms(out.slice(0, SR / 8)) - rms(out.slice(SR / 2, SR / 2 + SR / 8)));
    };
    expect(wander(20)).toBeGreaterThan(wander(0));
  });

  it('the stack never exceeds MAX_UNISON copies however many are asked for', () => {
    // An unbounded count would allocate per voice on the audio thread.
    expect(new UnisonStack(SAW, 99, SR).gain)
      .toBeCloseTo(new UnisonStack(SAW, MAX_UNISON, SR).gain, 12);
  });

  it('drift depth is chosen by FREQUENCY, not by stack size', () => {
    // The same number of cents is far more Hz down low, so a drifting bass
    // just sounds out of tune. This also pins the argument's meaning, which
    // reads like a count and is not one.
    expect(driftDepthFor(400)).toBeGreaterThan(driftDepthFor(100));
  });
});

/** One second of a stack in a given MODE — no spread, no drift, so the only
 *  thing separating two captures is the mode's own interval table. */
function captureMode(mode: number, count: number, n = SR): number[] {
  const s = new UnisonStack(SAW, count, SR, mode);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(s.update(220, 0.5, 0, 0, 0));
  return out;
}

/** High-frequency content, relative: the mean step size of the waveform,
 *  normalised by its level. A copy an octave up doubles how often the saw
 *  jumps, so stacking intervals ABOVE the root must raise this. */
function brightness(xs: number[]): number {
  let d = 0;
  for (let i = 1; i < xs.length; i++) d += Math.abs(xs[i] - xs[i - 1]);
  return d / (xs.length - 1) / rms(xs);
}

describe('unison stack modes', () => {
  it('offers eight modes, each with a label', () => {
    expect(UNISON_MODES).toHaveLength(8);
    for (const m of UNISON_MODES) expect(m.label.length).toBeGreaterThan(0);
  });

  it('the default mode is the old stack, bit for bit', () => {
    // Passing no mode and passing mode 0 must be the same sound, or every
    // existing Subtractive patch changes under our feet.
    expect(captureMode(0, MAX_UNISON, 2048)).toEqual(
      (() => {
        const s = new UnisonStack(SAW, MAX_UNISON, SR);
        const out: number[] = [];
        for (let i = 0; i < 2048; i++) out.push(s.update(220, 0.5, 0, 0, 0));
        return out;
      })(),
    );
  });

  it('every mode at ONE copy is exactly the plain oscillator', () => {
    // Copy 0 sits at the root in every mode, so a mono patch cannot be
    // transposed by a mode it never hears.
    const plain = captureMode(0, 1, 2048);
    for (let mode = 1; mode < UNISON_MODES.length; mode++) {
      expect(captureMode(mode, 1, 2048)).toEqual(plain);
    }
  });

  it('a mode puts real energy at the interval it names', () => {
    // The measure is spectral, not a waveform proxy: 330 Hz (the fifth of 220)
    // is NOT a harmonic of 220, so a root-only stack has next to nothing
    // there, and the power chord's second copy has its whole fundamental.
    // Same shape for the octave, where 440 Hz exists in the root's spectrum
    // as a half-amplitude 2nd harmonic — the octave copy adds a full one.
    const mag = (xs: number[], freqHz: number): number => {
      let re = 0;
      let im = 0;
      const w = (2 * Math.PI * freqHz) / SR;
      for (let i = 0; i < xs.length; i++) {
        re += xs[i] * Math.cos(w * i);
        im += xs[i] * Math.sin(w * i);
      }
      return Math.hypot(re, im);
    };
    const idx = (label: string) => UNISON_MODES.findIndex(m => m.label === label);
    const unison = captureMode(0, 2);
    const fifth = captureMode(idx('Power Chord'), 2);
    const octave = captureMode(idx('Octave'), 2);
    // The fifth sits at 2^(7/12), equal temperament — measure THERE, not at
    // the just-intonation 330. Factor 5 is conservative: measured ~960x.
    const fifthHz = 220 * Math.pow(2, 7 / 12);
    expect(mag(fifth, fifthHz)).toBeGreaterThan(mag(unison, fifthHz) * 5);
    // Coherent phases make the octave ratio EXACTLY 1.5 (h2+h2 vs h2+h1), so
    // a 1.5 threshold sits on the value itself; 1.2 still proves added energy.
    expect(mag(octave, 440)).toBeGreaterThan(mag(unison, 440) * 1.2);
  });

  it('harmonics mode reaches above the octave mode across a full stack', () => {
    // The harmonic series climbs to the 7th partial by copy 7; octaves cap at
    // alternating 2x. Same size, no spread — only the tables differ.
    const idx = (label: string) => UNISON_MODES.findIndex(m => m.label === label);
    expect(brightness(captureMode(idx('Harmonics'), MAX_UNISON)))
      .toBeGreaterThan(brightness(captureMode(idx('Octave'), MAX_UNISON)));
  });

  it('accepts an oscillator FACTORY in place of a wave index', () => {
    // An engine whose wave table does not share makeOsc's numbering (Westcoast
    // maps 0 to sine, makeOsc maps 0 to saw) hands the stack its own factory
    // and keeps its meaning. Same factory, same sound as the equivalent index.
    const viaFactory = new UnisonStack((sr: number) => new SineOsc(sr), 1, SR);
    const viaIndex = new UnisonStack(3, 1, SR); // 3 = sine in makeOsc's table
    for (let i = 0; i < 512; i++) {
      expect(viaFactory.update(220, 0.5, 0, 0, 0)).toBe(viaIndex.update(220, 0.5, 0, 0, 0));
    }
  });

  it('chord modes never detune the root even under spread', () => {
    // Spread fans copies across cents; the mode adds semitones on top. The
    // ROOT copy must stay put in both dimensions, or the perceived pitch of
    // the patch moves when the mode does. A 2048-sample window of the n=1
    // stack is identical whatever the mode and spread ask for.
    const idx = UNISON_MODES.findIndex(m => m.label === 'Minor');
    const a = new UnisonStack(SAW, 1, SR, idx);
    const b = new UnisonStack(SAW, 1, SR, 0);
    for (let i = 0; i < 2048; i++) {
      expect(a.update(220, 0.5, 0, 30, 0)).toBe(b.update(220, 0.5, 0, 30, 0));
    }
  });

});
