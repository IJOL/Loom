// test/engine-fixtures.ts
// "A default note on every melodic engine", in one place. Shared by the
// cross-engine velocity/accent tests and by tools/render-checksum.mts so the two
// cannot drift into different ideas of what a default patch is.
//
// The param bags are each engine's own defaults, as used by its renderer test.
import type { NoteSpec, ParamBag, VoiceRenderer } from '../src/audio-dsp/types';
import { TB303Renderer } from '../src/audio-dsp/tb303-renderer';
import { WavetableRenderer } from '../src/audio-dsp/wavetable-renderer';
import { SubtractiveVoiceRenderer } from '../src/audio-dsp/subtractive-renderer';
import { WestcoastRenderer } from '../src/audio-dsp/westcoast-renderer';
import { FMRenderer } from '../src/audio-dsp/fm-renderer';
import { KarplusRenderer } from '../src/audio-dsp/karplus-renderer';

export const SR = 48000;

export const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({
  midi: 45, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false, ...o,
});

/** Deterministic PRNG so karplus's noise excitation is identical across renders —
 *  otherwise the pluck seed, not the velocity, would move the measurement. */
export function seededRng(): () => number {
  let s = 0x2f6e2b1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

export const ENGINE_PARAMS: Record<string, ParamBag> = {
  tb303: {
    'filter.cutoff': 0.3, 'filter.resonance': 0.8, 'env.amount': 0.6,
    'env.decay': 0.4, 'env.accent': 0.6, 'osc.wave': 0,
  },
  wavetable: {
    'osc.waveA': 0, 'osc.waveB': 1, 'osc.morph': 0, 'osc.detune': 0,
    'filter.cutoff': 0.7, 'filter.resonance': 0.2,
    'amp.attack': 0.01, 'amp.decay': 0.3, 'amp.sustain': 0.7, 'amp.release': 0.3,
    'amp.builtinEnv': 1,
  },
  subtractive: {
    'master.tune': 0,
    'osc1.wave': 0, 'osc1.level': 0.6, 'osc1.detune': 0,
    'osc2.wave': 1, 'osc2.level': 0.4, 'osc2.detune': 7,
    'sub.level': 0.3, 'noise.level': 0, 'noise.color': 0.6,
    'filter.cutoff': 0.55, 'filter.resonance': 0.25, 'filter.envAmount': 0.45,
    'filter.drive': 0, 'filter.keyTrack': 0, 'filter.builtinEnv': 1,
    'filter.attack': 0.01, 'filter.decay': 0.3, 'filter.sustain': 0.4, 'filter.release': 0.35,
    'amp.builtinEnv': 1, 'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.7, 'amp.release': 0.3,
  },
  westcoast: {
    'osc.mainWave': 0, 'osc.modWave': 0, 'osc.ratio': 2, 'osc.fmIndex': 0.2,
    'osc.ring': 0, 'osc.subDiv': 0, 'osc.subLevel': 0.3, 'osc.detune': 0,
    'timbre.fold': 0.5, 'timbre.symmetry': 0,
    'lpg.mode': 2, 'lpg.cutoff': 0.6, 'lpg.resonance': 0.2,
    'contour.mode': 0, 'contour.attack': 0.005, 'contour.decay': 0.4,
    'contour.amount': 0.9, 'contour.cycle': 0,
    'amp.level': 0.8, 'master.tune': 0,
  },
  fm: {
    algorithm: 0, feedback: 0, 'amp.mix': 0.7,
    'op1.ratio': 1, 'op1.level': 0.9, 'op1.attack': 0.01, 'op1.decay': 0.3, 'op1.sustain': 0.7, 'op1.release': 0.2, 'op1.detune': 0,
    'op2.ratio': 2, 'op2.level': 0.5, 'op2.attack': 0.01, 'op2.decay': 0.3, 'op2.sustain': 0.7, 'op2.release': 0.2, 'op2.detune': 0,
    'op3.ratio': 3, 'op3.level': 0.4, 'op3.attack': 0.01, 'op3.decay': 0.3, 'op3.sustain': 0.7, 'op3.release': 0.2, 'op3.detune': 0,
    'op4.ratio': 1, 'op4.level': 0.6, 'op4.attack': 0.01, 'op4.decay': 0.3, 'op4.sustain': 0.7, 'op4.release': 0.2, 'op4.detune': 0,
  },
  karplus: {
    'string.damping': 0.4, 'string.brightness': 0.7, 'excite.time': 0.01,
    'excite.tone': 0.5, 'amp.attack': 0.005, 'amp.release': 0.5,
    'amp.level': 0.8, 'amp.builtinEnv': 1,
  },
};

/** Every engine whose voice gain comes from the velocity + accent pair. */
export const MELODIC_IDS = ['tb303', 'wavetable', 'subtractive', 'westcoast', 'fm', 'karplus'];

/** Build one voice. `over` patches the engine's default bag (e.g. output.trim). */
export function makeRenderer(id: string, n: NoteSpec, over: ParamBag = {}): VoiceRenderer {
  const p: ParamBag = { ...ENGINE_PARAMS[id], ...over };
  switch (id) {
    case 'tb303':       return new TB303Renderer(n, p, SR);
    case 'wavetable':   return new WavetableRenderer(n, p, SR);
    case 'subtractive': return new SubtractiveVoiceRenderer(n, p, SR);
    case 'westcoast':   return new WestcoastRenderer(n, p, SR);
    case 'fm':          return new FMRenderer(n, p, SR);
    case 'karplus':     return new KarplusRenderer(n, p, SR, seededRng());
    default: throw new Error(`no fixture for engine '${id}'`);
  }
}
