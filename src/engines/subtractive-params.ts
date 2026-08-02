// src/engines/subtractive-params.ts
// Shared param schema for the subtractive engine. Extracted from subtractive.ts
// so BOTH the legacy SubtractiveEngine (PolySynth-backed) and the new
// WorkletLaneEngine (AudioWorklet-backed) reference one definition — the lane
// UI / automation / modulation vocabulary is identical regardless of which
// backend a 'subtractive' lane uses. Do not change the array contents here
// without updating both backends.

import type { EngineParamSpec } from './engine-params';
import { FILTER_MODE_OPTIONS, typeOptionsFor } from '../audio-dsp/filter-kinds';

export const WAVE_OPTIONS = [
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square',   label: 'Sqr' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sine',     label: 'Sin' },
  { value: 'sync',     label: 'Sync' },   // hard sync — the ratio (osc*.sync) is the timbre
];

// Unified-param schema. Dot-namespaced ids map directly onto the nested
// polysynth.params object tree (legacy) or the flat SubParams snapshot (worklet).
export const SUB_PARAM_SPECS: EngineParamSpec[] = [
  // Oscillators
  { id: 'osc1.level',   label: 'Osc1 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.6, group: 'osc1' },
  { id: 'osc1.detune',  label: 'Osc1 Det',  kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢', group: 'osc1' },
  { id: 'osc1.wave',    label: 'Osc1 Wave', kind: 'discrete', min: 0, max: 4, default: 0,
    options: WAVE_OPTIONS, group: 'osc1' },
  // Pulse width. Continuous on purpose: an LFO on this id IS pulse-width
  // modulation, so PWM needs no wave of its own. Only bites on a square —
  // that is what a duty cycle means. Kept off the rails (0.05..0.95) because
  // 0 and 1 are silence, not a sound.
  { id: 'osc1.pw',      label: 'Osc1 PW',   kind: 'continuous', min: 0.05, max: 0.95, default: 0.5, group: 'osc1' },
  // Hard-sync ratio (only bites when osc1.wave = Sync). Continuous: an LFO or
  // envelope on it is the bright tearing sweep the effect exists for.
  { id: 'osc1.sync',    label: 'Osc1 Sync', kind: 'continuous', min: 1, max: 8, default: 2, group: 'osc1' },
  { id: 'osc2.level',   label: 'Osc2 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.4, group: 'osc2' },
  { id: 'osc2.detune',  label: 'Osc2 Det',  kind: 'continuous', min: -50, max: 50, default: 7, unit: '¢', group: 'osc2' },
  { id: 'osc2.wave',    label: 'Osc2 Wave', kind: 'discrete', min: 0, max: 4, default: 1,
    options: WAVE_OPTIONS, group: 'osc2' },
  { id: 'osc2.pw',      label: 'Osc2 PW',   kind: 'continuous', min: 0.05, max: 0.95, default: 0.5, group: 'osc2' },
  { id: 'osc2.sync',    label: 'Osc2 Sync', kind: 'continuous', min: 1, max: 8, default: 2, group: 'osc2' },
  // Ring modulation: osc1 × osc2, as its OWN mixer source rather than a switch
  // that hijacks osc2. That is the honest topology (MS-20, Prophet, SH-101 all
  // mix the ring output next to the oscillators): turn both osc levels down and
  // Ring alone gives you the pure inharmonic product, leave them up and it sits
  // on top. The timbre is osc2's DETUNE — the further the two oscillators are
  // apart, the more clangorous the sum/difference tones. Continuous, so an LFO
  // or envelope on it fades the metal in and out; 0 by default, so no existing
  // preset moves.
  { id: 'ring.level',   label: 'Ring',      kind: 'continuous', min: 0, max: 1, default: 0, group: 'ring' },
  { id: 'sub.level',    label: 'Sub Lvl',   kind: 'continuous', min: 0, max: 1, default: 0.3, group: 'sub' },
  { id: 'noise.level',  label: 'Noise Lvl', kind: 'continuous', min: 0, max: 1, default: 0, group: 'noise' },
  // The colour of the noise: a one-pole low-pass from 200 Hz (dark) to 15 kHz
  // (bright). The renderer has read this live since the worklet cutover and
  // mod-lite has always mapped it as a modulation target, but NOTHING declared
  // it — so it sat frozen at 0.6 with no knob and no LFO able to reach it.
  // Declared here at that same 0.6, which is why the sound does not change.
  { id: 'noise.color',  label: 'Noise Tone', kind: 'continuous', min: 0, max: 1, default: 0.6, group: 'noise' },

  // Filter
  // Mode picks the circuit; Type picks the response — and Type offers EXACTLY
  // the responses that circuit can honestly produce (audio-dsp/filter-kinds.ts).
  // Choose MOG and the NOTCH button is not there, rather than being there and
  // quietly handing back a lowpass, which is what the old grid did.
  // max: 3 -- four modes (DIG/MOG/303/COMB).
  { id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 3, default: 0,
    options: FILTER_MODE_OPTIONS, group: 'filter' },
  { id: 'filter.type',  label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
    options: typeOptionsFor(0), optionsFrom: { paramId: 'filter.model', build: typeOptionsFor },
    group: 'filter' },
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.55, group: 'filter' },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.25, group: 'filter' },
  { id: 'filter.envAmount', label: 'Env Amt',   kind: 'continuous', min: 0, max: 1, default: 0.45, group: 'filter' },
  { id: 'filter.drive',     label: 'Drive',     kind: 'continuous', min: 0, max: 1, default: 0, group: 'filter' },
  { id: 'filter.keyTrack',  label: 'Key Track', kind: 'continuous', min: 0, max: 1, default: 0, group: 'filter' },
  { id: 'filter.builtinEnv', label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }], drawnBy: 'modulators' },
  { id: 'filter.attack',    label: 'F Atk',     kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', drawnBy: 'modulators' },
  { id: 'filter.decay',     label: 'F Dec',     kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's', drawnBy: 'modulators' },
  { id: 'filter.sustain',   label: 'F Sus',     kind: 'continuous', min: 0, max: 1, default: 0.4, drawnBy: 'modulators' },
  { id: 'filter.release',   label: 'F Rel',     kind: 'continuous', min: 0.005, max: 4, default: 0.35, unit: 's', drawnBy: 'modulators' },

  // Amp env
  { id: 'amp.builtinEnv', label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }], drawnBy: 'modulators' },
  { id: 'amp.attack',  label: 'A Atk', kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', drawnBy: 'modulators' },
  { id: 'amp.decay',   label: 'A Dec', kind: 'continuous', min: 0.001, max: 4, default: 0.2,  unit: 's', drawnBy: 'modulators' },
  { id: 'amp.sustain', label: 'A Sus', kind: 'continuous', min: 0, max: 1, default: 0.7, drawnBy: 'modulators' },
  { id: 'amp.release', label: 'A Rel', kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', drawnBy: 'modulators' },

  // Master
  { id: 'master.tune', label: 'Tune', kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st', group: 'master' },

  // Unison: osc1 and osc2 each stacked N times across a detune spread — a
  // supersaw, which two detuned oscillators cannot make. Lives under `master.`
  // because unison is a whole-voice property (as on the JP-8000 / Sylenth), and
  // Detune here reads unambiguously as the spread of the stack next to Unison.
  //
  // Voices is a COUNT and is read once at trigger — you cannot grow a stack
  // mid-note without a click — so, exactly like poly.voices, it is stepped rather
  // than a modulation target and is deliberately absent from DOT_TO_FIELD.
  // Defaults to 1, which makes Detune inert and leaves every preset untouched.
  { id: 'master.unison', label: 'Unison', kind: 'continuous', min: 1, max: 7, default: 1, group: 'master' },
  { id: 'master.detune', label: 'Detune', kind: 'continuous', min: 0, max: 50, default: 25, unit: '¢', group: 'master' },
  // Analog drift: the slow random per-copy pitch wander a digital oscillator
  // never has. Off by default — it is character, not correctness.
  { id: 'master.drift',  label: 'Drift',  kind: 'continuous', min: 0, max: 1, default: 0, group: 'master' },

  // poly.mode / poly.retrig were declared here but dead on both sides — no
  // control ever drew them, and WorkletLaneEngine.setBaseValue accepted and
  // discarded a write to either — so they were deleted outright rather than
  // wired up. poly.voices is the one poly.* param with a real control (the
  // POLY section's VOICES knob) and a real effect (the worklet's voice cap).
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8, group: 'poly' },
];
