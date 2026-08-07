// src/polysynth/poly-params.ts
// The subtractive parameter SHAPE and its defaults — pure data, no Web Audio.
//
// These used to live in polysynth.ts alongside the node-per-note PolySynth
// class. The class is gone (the worklet renderer replaced it), but the shape
// outlived it: user presets are stored as this nested tree in localStorage, and
// poly-preset-store flattens it to the dot-ids the worklet engine reads. Keeping
// it in the same file as a deleted synth is what made "delete the dead class"
// look like a big change instead of a small one.
//
// The nesting is not decoration: it IS the on-disk format of every user preset
// saved so far, so flattening it here would break them.

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface PolySynthParams {
  master: { tune: number; };                          // semitones global pitch offset
  osc1:  { wave: OscillatorType; level: number; octave: number; semi: number; detune: number; };
  osc2:  { wave: OscillatorType; level: number; octave: number; semi: number; detune: number; };
  sub:   { level: number; octave: number; };          // octave is -2 or -1
  noise: { level: number; color: number; };           // color 0=dark .. 1=bright
  filter: {
    type: FilterType;
    cutoff: number; resonance: number; envAmount: number;
    keyTrack: number;  // 0..1, how much cutoff follows note
    drive: number;     // 0..1, waveshaper pre-filter
    attack: number; decay: number; sustain: number; release: number;
  };
  amp: { attack: number; decay: number; sustain: number; release: number; };
}

export const POLY_DEFAULTS: PolySynthParams = {
  master: { tune: 0 },
  osc1:  { wave: 'sawtooth', level: 0.6, octave: 0, semi: 0, detune: 0 },
  osc2:  { wave: 'square',   level: 0.4, octave: 0, semi: 0, detune: 7 },
  sub:   { level: 0.3, octave: -1 },
  noise: { level: 0, color: 0.6 },
  filter: {
    type: 'lowpass',
    cutoff: 0.55, resonance: 0.25, envAmount: 0.45,
    keyTrack: 0, drive: 0,
    attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.35,
  },
  amp:  { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
};
