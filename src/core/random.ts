import type { TB303 } from './synth';
import { DRUM_LANES, type DrumVoice } from './drums';
import type { Sequencer } from './sequencer';
import type { PolySynth, LfoTarget } from '../polysynth/polysynth';

export const SCALES = {
  pentMinor: [0, 3, 5, 7, 10],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const;
export type ScaleName = keyof typeof SCALES;

const DRUM_DENSITY: Record<DrumVoice, number> = {
  kick: 0.35, snare: 0.2, closedHat: 0.6, openHat: 0.12,
  clap: 0.12, cowbell: 0.1, tom: 0.1, ride: 0.15,
};

export interface RandomizeOptions {
  bassNotes?: boolean;   // bass pitches + on/off
  melodyNotes?: boolean; // melody pitches + on/off
  accents?: boolean;     // accents on bass, drums, melody
  slides?: boolean;      // bass slide flags + melody tie
  drums?: boolean;
  mod?: boolean;         // TB-303 filter/env params
  scale?: ScaleName;
  rootNote?: number;
  noteDensity?: number;
}

export function randomize(seq: Sequencer, synth: TB303, opts: RandomizeOptions) {
  const scale = SCALES[opts.scale ?? 'pentMinor'];
  const root = opts.rootNote ?? 36;
  const density = opts.noteDensity ?? 0.55;

  if (opts.bassNotes) {
    for (const step of seq.bass) {
      step.on = Math.random() < density;
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const octRoll = Math.random();
      const octave = octRoll < 0.7 ? 0 : (octRoll < 0.92 ? 12 : 24);
      step.note = root + interval + octave;
    }
  }

  if (opts.melodyNotes) {
    const melRoot = root + 24;
    for (const step of seq.melody) {
      step.on = Math.random() < density * 0.7;
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const octRoll = Math.random();
      const octave = octRoll < 0.6 ? 0 : (octRoll < 0.9 ? 12 : -12);
      const root = melRoot + interval + octave;
      // Preserve chord shape: shift all notes by the new root delta
      if (step.notes.length === 0) step.notes = [root];
      else {
        const oldRoot = step.notes[0];
        const delta = root - oldRoot;
        step.notes = step.notes.map((n) => n + delta);
      }
    }
  }

  if (opts.accents) {
    for (const step of seq.bass)   step.accent = step.on && Math.random() < 0.25;
    for (const step of seq.melody) step.accent = step.on && Math.random() < 0.2;
    for (const lane of DRUM_LANES) {
      for (const step of seq.drums[lane]) step.accent = step.on && Math.random() < 0.2;
    }
  }

  if (opts.slides) {
    for (const step of seq.bass)   step.slide = step.on && Math.random() < 0.2;
    for (const step of seq.melody) step.tie   = step.on && Math.random() < 0.15;
  }

  if (opts.drums) {
    for (const lane of DRUM_LANES) {
      const baseP = DRUM_DENSITY[lane];
      const steps = seq.drums[lane];
      for (let i = 0; i < steps.length; i++) {
        const onBeat   = i % 4 === 0;
        const backbeat = i % 8 === 4;
        let p = baseP;
        if (lane === 'kick'      && onBeat)       p = 0.85;
        if (lane === 'snare'     && backbeat)     p = 0.9;
        if (lane === 'closedHat')                  p = 0.7;
        if (lane === 'openHat'   && i % 8 === 6)  p = 0.5;
        if (lane === 'ride'      && i % 2 === 0)  p = 0.6;
        steps[i].on = Math.random() < p;
        steps[i].accent = steps[i].on && Math.random() < 0.18;
      }
    }
  }

  if (opts.mod) {
    synth.params.cutoff    = 0.1 + Math.random() * 0.45;
    synth.params.resonance = 0.5 + Math.random() * 0.5;
    synth.params.envMod    = 0.3 + Math.random() * 0.6;
    synth.params.decay     = 0.2 + Math.random() * 0.6;
    synth.params.accent    = 0.4 + Math.random() * 0.5;
  }
}

// Randomize the polysynth settings to a musically reasonable starting point.
// Biased to avoid extreme/unusable values: low resonance most of the time,
// moderate filter ranges, LFOs usually 'off' (sometimes pitch/cutoff/amp).
const POLY_WAVES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
const LFO_TARGET_POOL: LfoTarget[] = ['off', 'off', 'off', 'pitch', 'cutoff', 'amp'];

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

  for (const k of ['lfo1', 'lfo2'] as const) {
    const lfo = p[k];
    lfo.wave   = pick(POLY_WAVES);
    lfo.rate   = randRange(0.2, 8);
    lfo.target = pick(LFO_TARGET_POOL);
    lfo.depth  = lfo.target === 'off' ? 0 : randRange(0.1, 0.5);
  }
}

export function clearPattern(
  seq: Sequencer,
  opts: { bass?: boolean; drums?: boolean; melody?: boolean },
) {
  if (opts.bass) {
    for (const step of seq.bass) { step.on = false; step.accent = false; step.slide = false; }
  }
  if (opts.drums) {
    for (const lane of DRUM_LANES) {
      for (const step of seq.drums[lane]) { step.on = false; step.accent = false; }
    }
  }
  if (opts.melody) {
    for (const step of seq.melody) { step.on = false; step.accent = false; step.tie = false; }
  }
}
