// src/engines/westcoast.ts
//
// Phase 4 cutover: the legacy WestEngine + WestVoice (Buchla-style complex osc →
// wavefolder → low-pass gate, Web Audio node-per-note) were deleted. Westcoast
// lanes now synthesise through the AudioWorklet (WorkletLaneEngine +
// audio-dsp/westcoast-renderer) live and the pure kernel offline. The fold curve
// lives in westcoast-fold.ts (data) / audio-dsp/fold.ts (kernel). This file is
// DATA-ONLY: the param spec, default modulators, and a registered descriptor.

import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';

const MAIN_WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sawtooth', label: 'Saw' },
];
const MOD_WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
];
const SUBDIV_OPTIONS = [
  { value: 'off', label: 'Off' }, { value: '2', label: '2' },
  { value: '3', label: '3' }, { value: '4', label: '4' },
];
const LPG_MODE_OPTIONS = [
  { value: 'lp', label: 'LP' }, { value: 'gate', label: 'Gate' }, { value: 'both', label: 'Both' },
];
const CONTOUR_MODE_OPTIONS = [
  { value: 'pluck', label: 'Pluck' }, { value: 'sustain', label: 'Sus' },
];
const ONOFF_OPTIONS = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }];
const POLY_MODE_OPTIONS = [{ value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }];

const WEST_PARAMS: EngineParamSpec[] = [
  // Complex oscillator
  { id: 'osc.mainWave', label: 'Princ Wave', kind: 'discrete', min: 0, max: 2, default: 0, options: MAIN_WAVE_OPTIONS },
  { id: 'osc.modWave',  label: 'Mod Wave',   kind: 'discrete', min: 0, max: 1, default: 0, options: MOD_WAVE_OPTIONS },
  { id: 'osc.ratio',    label: 'Ratio',      kind: 'continuous', min: 0.25, max: 16, default: 2, unit: '×' },
  { id: 'osc.fmIndex',  label: 'FM Index',   kind: 'continuous', min: 0, max: 1, default: 0.2 },
  { id: 'osc.ring',     label: 'Ring/AM',    kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'osc.subDiv',   label: 'Sub ÷',      kind: 'discrete', min: 0, max: 3, default: 0, options: SUBDIV_OPTIONS },
  { id: 'osc.subLevel', label: 'Sub Lvl',    kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'osc.detune',   label: 'Detune',     kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
  // Timbre (wavefolder)
  { id: 'timbre.fold',     label: 'Fold',     kind: 'continuous', min: 0, max: 1, default: 0.5 },
  { id: 'timbre.symmetry', label: 'Symmetry', kind: 'continuous', min: -1, max: 1, default: 0 },
  // Low-pass gate
  { id: 'lpg.mode',      label: 'Mode',      kind: 'discrete', min: 0, max: 2, default: 2, options: LPG_MODE_OPTIONS },
  { id: 'lpg.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.6 },
  { id: 'lpg.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.2 },
  // Contour
  { id: 'contour.mode',   label: 'Mode',    kind: 'discrete', min: 0, max: 1, default: 0, options: CONTOUR_MODE_OPTIONS },
  { id: 'contour.attack', label: 'Attack',  kind: 'continuous', min: 0.001, max: 2, default: 0.005, unit: 's', curve: 'exponential' },
  { id: 'contour.decay',  label: 'Decay',   kind: 'continuous', min: 0.005, max: 4, default: 0.4, unit: 's', curve: 'exponential' },
  { id: 'contour.amount', label: 'Amount',  kind: 'continuous', min: 0, max: 1, default: 0.9 },
  { id: 'contour.cycle',  label: 'Cycle',   kind: 'discrete', min: 0, max: 1, default: 0, options: ONOFF_OPTIONS },
  // Amp / master
  { id: 'amp.level',   label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 },
  { id: 'master.tune', label: 'Tune',  kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st' },
  // Poly
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8 },
  { id: 'poly.mode',   label: 'Mode',   kind: 'discrete', min: 0, max: 1, default: 0, options: POLY_MODE_OPTIONS },
];

export const WESTCOAST_DEFAULT_MODULATORS: ModulatorState[] = [
  { ...makeDefaultADSR('adsr1'), connections: [{ id: 'c-fold', paramId: 'timbre.fold', depth: 0 }] },
  { ...makeDefaultADSR('adsr2'), connections: [{ id: 'c-cut', paramId: 'lpg.cutoff', depth: 0 }] },
  makeDefaultLFO('lfo1'),
  { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
];

function makeWestcoastDescriptor() {
  return createDescriptorEngine({
    id: 'westcoast',
    name: 'West',
    polyphony: 'poly',
    params: WEST_PARAMS,
    presets: () => getCachedPresets('westcoast'),
    modulators: WESTCOAST_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('westcoast', makeWestcoastDescriptor);
registerEngine(makeWestcoastDescriptor());
