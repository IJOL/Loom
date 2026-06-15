import type { TB303 } from './synth';
import type { PolySynth } from '../polysynth/polysynth';

/** Randomize the TB-303 bass *sound* params (filter/env) to a musical-ish
 *  starting point. Notes are not touched here — only sound parameters
 *  (filter, envelope, accent) are affected. */
export function randomizeBassParams(synth: TB303): void {
  synth.params.cutoff    = 0.1 + Math.random() * 0.45;
  synth.params.resonance = 0.5 + Math.random() * 0.5;
  synth.params.envMod    = 0.3 + Math.random() * 0.6;
  synth.params.decay     = 0.2 + Math.random() * 0.6;
  synth.params.accent    = 0.4 + Math.random() * 0.5;
}

// Randomize the polysynth settings to a musically reasonable starting point.
// Biased to avoid extreme/unusable values: low resonance most of the time,
// moderate filter ranges. Modulation (LFOs/ADSRs) is handled by the
// ModulationHost and is not touched here.
const POLY_WAVES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomizePolySynth(poly: PolySynth) {
  const p = poly.params;

  p.master.tune = 0;

  p.osc1.wave   = pick(POLY_WAVES);
  p.osc1.level  = randRange(0.4, 0.8);
  p.osc1.octave = pick([-1, 0, 0, 0, 1]);
  p.osc1.semi   = pick([0, 0, 0, 0, -7, 7, -5, 5]);
  p.osc1.detune = Math.round(randRange(-10, 10));

  p.osc2.wave   = pick(POLY_WAVES);
  p.osc2.level  = randRange(0.2, 0.7);
  p.osc2.octave = pick([-1, 0, 0, 0, 1]);
  p.osc2.semi   = pick([0, 0, 7, -7, 12, -12]);
  p.osc2.detune = Math.round(randRange(-25, 25));

  p.sub.level   = Math.random() < 0.55 ? randRange(0.2, 0.5) : 0;
  p.sub.octave  = -1;

  p.noise.level = Math.random() < 0.3 ? randRange(0.05, 0.25) : 0;
  p.noise.color = randRange(0.3, 0.9);

  p.filter.type      = pick(['lowpass', 'lowpass', 'lowpass', 'highpass', 'bandpass']);
  p.filter.cutoff    = randRange(0.25, 0.8);
  p.filter.resonance = randRange(0.1, 0.65);
  p.filter.envAmount = randRange(0.2, 0.75);
  p.filter.keyTrack  = Math.random() < 0.4 ? randRange(0.1, 0.6) : 0;
  p.filter.drive     = Math.random() < 0.3 ? randRange(0.1, 0.45) : 0;
  p.filter.attack    = randRange(0.005, 0.08);
  p.filter.decay     = randRange(0.1, 0.8);
  p.filter.sustain   = randRange(0.2, 0.7);
  p.filter.release   = randRange(0.2, 1.5);

  p.amp.attack  = randRange(0.005, 0.1);
  p.amp.decay   = randRange(0.1, 0.5);
  p.amp.sustain = randRange(0.5, 0.9);
  p.amp.release = randRange(0.2, 1.5);
}
