// src/engines/subtractive-params.ts
// Shared param schema for the subtractive engine. Extracted from subtractive.ts
// so BOTH the legacy SubtractiveEngine (PolySynth-backed) and the new
// WorkletLaneEngine (AudioWorklet-backed) reference one definition — the lane
// UI / automation / modulation vocabulary is identical regardless of which
// backend a 'subtractive' lane uses. Do not change the array contents here
// without updating both backends.

import type { EngineParamSpec } from './engine-params';

export const WAVE_OPTIONS = [
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square',   label: 'Sqr' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sine',     label: 'Sin' },
];

// Three filters, one engine. DIG (the Svf) is the default so every preset
// voiced against it sounds exactly as it always has; the ladders are opt-in.
export const FILTER_MODEL_OPTIONS = [
  { value: 'dig', label: 'DIG' },   // state-variable: clean, cheap
  { value: 'mog', label: 'MOG' },   // 4-pole Moog ladder: creamy, thins as it resonates
  { value: '303', label: '303' },   // diode ladder: asymmetric, even harmonics, acid
];

// The Svf computed lp/bp/hp all along — the renderer only ever read .lp, so two
// thirds of the filter were unreachable. LP is the default, so every preset
// voiced against it is untouched. Ordering matches mpump's FTYPE_* so a ported
// preset means the same thing in both codebases.
//
// HONEST LIMIT: only DIG is a true multimode. The ladders (MOG/303) are a
// four-pole lowpass topology and are lowpass ONLY — see FILTER_MODEL_OPTIONS.
export const FILTER_TYPE_OPTIONS = [
  { value: 'lp',    label: 'LP' },      // the default: what every preset was voiced against
  { value: 'hp',    label: 'HP' },
  { value: 'bp',    label: 'BP' },
  { value: 'notch', label: 'NOTCH' },   // lp + hp — the SVF-native notch
];

// Unified-param schema. Dot-namespaced ids map directly onto the nested
// polysynth.params object tree (legacy) or the flat SubParams snapshot (worklet).
export const SUB_PARAM_SPECS: EngineParamSpec[] = [
  // Oscillators
  { id: 'osc1.level',   label: 'Osc1 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.6 },
  { id: 'osc1.detune',  label: 'Osc1 Det',  kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
  { id: 'osc1.wave',    label: 'Osc1 Wave', kind: 'discrete', min: 0, max: 3, default: 0,
    options: WAVE_OPTIONS },
  // Pulse width. Continuous on purpose: an LFO on this id IS pulse-width
  // modulation, so PWM needs no wave of its own. Only bites on a square —
  // that is what a duty cycle means. Kept off the rails (0.05..0.95) because
  // 0 and 1 are silence, not a sound.
  { id: 'osc1.pw',      label: 'Osc1 PW',   kind: 'continuous', min: 0.05, max: 0.95, default: 0.5 },
  { id: 'osc2.level',   label: 'Osc2 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.4 },
  { id: 'osc2.detune',  label: 'Osc2 Det',  kind: 'continuous', min: -50, max: 50, default: 7, unit: '¢' },
  { id: 'osc2.wave',    label: 'Osc2 Wave', kind: 'discrete', min: 0, max: 3, default: 1,
    options: WAVE_OPTIONS },
  { id: 'osc2.pw',      label: 'Osc2 PW',   kind: 'continuous', min: 0.05, max: 0.95, default: 0.5 },
  { id: 'sub.level',    label: 'Sub Lvl',   kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'noise.level',  label: 'Noise Lvl', kind: 'continuous', min: 0, max: 1, default: 0 },

  // Filter
  { id: 'filter.model',     label: 'Model',     kind: 'discrete', min: 0, max: 2, default: 0,
    options: FILTER_MODEL_OPTIONS },
  { id: 'filter.type',      label: 'Type',      kind: 'discrete', min: 0, max: 3, default: 0,
    options: FILTER_TYPE_OPTIONS },
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.55 },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.25 },
  { id: 'filter.envAmount', label: 'Env Amt',   kind: 'continuous', min: 0, max: 1, default: 0.45 },
  { id: 'filter.drive',     label: 'Drive',     kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'filter.keyTrack',  label: 'Key Track', kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'filter.builtinEnv', label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'filter.attack',    label: 'F Atk',     kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'filter.decay',     label: 'F Dec',     kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  { id: 'filter.sustain',   label: 'F Sus',     kind: 'continuous', min: 0, max: 1, default: 0.4 },
  { id: 'filter.release',   label: 'F Rel',     kind: 'continuous', min: 0.005, max: 4, default: 0.35, unit: 's' },

  // Amp env
  { id: 'amp.builtinEnv', label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'amp.attack',  label: 'A Atk', kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'amp.decay',   label: 'A Dec', kind: 'continuous', min: 0.001, max: 4, default: 0.2,  unit: 's' },
  { id: 'amp.sustain', label: 'A Sus', kind: 'continuous', min: 0, max: 1, default: 0.7 },
  { id: 'amp.release', label: 'A Rel', kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's' },

  // Master
  { id: 'master.tune', label: 'Tune', kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st' },

  // Unison: osc1 and osc2 each stacked N times across a detune spread — a
  // supersaw, which two detuned oscillators cannot make. Lives under `master.`
  // because unison is a whole-voice property (as on the JP-8000 / Sylenth), and
  // Detune here reads unambiguously as the spread of the stack next to Unison.
  //
  // Voices is a COUNT and is read once at trigger — you cannot grow a stack
  // mid-note without a click — so, exactly like poly.voices, it is stepped rather
  // than a modulation target and is deliberately absent from DOT_TO_FIELD.
  // Defaults to 1, which makes Detune inert and leaves every preset untouched.
  { id: 'master.unison', label: 'Unison', kind: 'continuous', min: 1, max: 7, default: 1 },
  { id: 'master.detune', label: 'Detune', kind: 'continuous', min: 0, max: 50, default: 25, unit: '¢' },
  // Analog drift: the slow random per-copy pitch wander a digital oscillator
  // never has. Off by default — it is character, not correctness.
  { id: 'master.drift',  label: 'Drift',  kind: 'continuous', min: 0, max: 1, default: 0 },

  { id: 'poly.mode',   label: 'Mode',   kind: 'continuous', min: 0, max: 1,  default: 0 },
  { id: 'poly.retrig', label: 'Retrig', kind: 'continuous', min: 0, max: 1,  default: 1 },
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8 },
];
