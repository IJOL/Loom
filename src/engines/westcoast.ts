// src/engines/westcoast.ts
//
// Phase 4 cutover: the legacy WestEngine + WestVoice (Buchla-style complex osc →
// wavefolder → low-pass gate, Web Audio node-per-note) were deleted. Westcoast
// lanes now synthesise through the AudioWorklet (WorkletLaneEngine +
// audio-dsp/westcoast-renderer) live and the pure kernel offline. The fold curve
// lives in westcoast-fold.ts (data) / audio-dsp/fold.ts (kernel). This file is
// DATA-ONLY: the param spec, default modulators, and a registered descriptor.

import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { registerEngineCapabilities } from '../plugins/capabilities';
import { requireModulator } from '../modulation/modulator-registry';
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

export const WEST_PARAMS: EngineParamSpec[] = [
  // Complex oscillator
  { id: 'osc.mainWave', label: 'Princ Wave', kind: 'discrete', min: 0, max: 2, default: 0, options: MAIN_WAVE_OPTIONS, group: 'osc' },
  { id: 'osc.modWave',  label: 'Mod Wave',   kind: 'discrete', min: 0, max: 1, default: 0, options: MOD_WAVE_OPTIONS, group: 'osc' },
  { id: 'osc.ratio',    label: 'Ratio',      kind: 'continuous', min: 0.25, max: 16, default: 2, unit: '×', group: 'osc' },
  { id: 'osc.fmIndex',  label: 'FM Index',   kind: 'continuous', min: 0, max: 1, default: 0.2, group: 'osc' },
  { id: 'osc.ring',     label: 'Ring/AM',    kind: 'continuous', min: 0, max: 1, default: 0, group: 'osc' },
  { id: 'osc.subDiv',   label: 'Sub ÷',      kind: 'discrete', min: 0, max: 3, default: 0, options: SUBDIV_OPTIONS, group: 'osc' },
  { id: 'osc.subLevel', label: 'Sub Lvl',    kind: 'continuous', min: 0, max: 1, default: 0.3, group: 'osc' },
  { id: 'osc.detune',   label: 'Detune',     kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢', group: 'osc' },
  // Timbre (wavefolder)
  { id: 'timbre.fold',     label: 'Fold',     kind: 'continuous', min: 0, max: 1, default: 0.5, group: 'timbre' },
  { id: 'timbre.symmetry', label: 'Symmetry', kind: 'continuous', min: -1, max: 1, default: 0, group: 'timbre' },
  // Low-pass gate
  { id: 'lpg.mode',      label: 'Mode',      kind: 'discrete', min: 0, max: 2, default: 2, options: LPG_MODE_OPTIONS, group: 'lpg' },
  { id: 'lpg.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.6, group: 'lpg' },
  { id: 'lpg.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.2, group: 'lpg' },
  // Contour
  { id: 'contour.mode',   label: 'Mode',    kind: 'discrete', min: 0, max: 1, default: 0, options: CONTOUR_MODE_OPTIONS, group: 'contour' },
  { id: 'contour.attack', label: 'Attack',  kind: 'continuous', min: 0.001, max: 2, default: 0.005, unit: 's', curve: 'exponential', group: 'contour' },
  { id: 'contour.decay',  label: 'Decay',   kind: 'continuous', min: 0.005, max: 4, default: 0.4, unit: 's', curve: 'exponential', group: 'contour' },
  { id: 'contour.amount', label: 'Amount',  kind: 'continuous', min: 0, max: 1, default: 0.9, group: 'contour' },
  { id: 'contour.cycle',  label: 'Cycle',   kind: 'discrete', min: 0, max: 1, default: 0, options: ONOFF_OPTIONS, group: 'contour' },
  // Amp / master
  { id: 'amp.level',   label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8, group: 'amp' },
  { id: 'master.tune', label: 'Tune',  kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st', group: 'master' },
  // Poly. poly.mode used to live here too — a VISIBLE Mode dropdown whose value
  // WorkletLaneEngine.setBaseValue discarded on write — deleted rather than wired up.
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8, group: 'poly' },
];

// OSC (8 params, the complex oscillator) and CONTOUR (5 params, the envelope)
// each earn a row of their own; TIMBRE (the wavefolder) and LPG (the gate that
// follows it in the signal path) pack onto one line, and so do the two
// one-knob tails, AMP and MASTER. POLY stays last. Colours for
// osc/timbre/lpg/contour/amp follow the dead `.west-*-knobs` rules in
// _knob.scss (24b25bf) — the hand-written page these params used to have was
// already keyed cyan/orange/purple/red/green; MASTER gets the one colour that
// page never assigned, teal.
export const WEST_GROUPS: EngineParamGroup[] = [
  { id: 'osc',     title: 'OSC',     row: 0, color: 'var(--knob-cyan)' },
  { id: 'timbre',  title: 'TIMBRE',  row: 1, color: 'var(--knob-orange)' },
  { id: 'lpg',     title: 'LPG',     row: 1, color: 'var(--knob-purple)' },
  { id: 'contour', title: 'CONTOUR', row: 2, color: 'var(--knob-red)' },
  { id: 'amp',     title: 'AMP',     row: 3, color: 'var(--knob-green)' },
  { id: 'master',  title: 'MASTER',  row: 3, color: 'var(--knob-teal)' },
  { id: 'poly',    title: 'POLY',    row: 4 },
];

/** A FUNCTION, not a computed constant — see SUBTRACTIVE_DEFAULT_MODULATORS
 *  (subtractive.ts) for why: this file's own registerEngine(...) below runs at
 *  module scope, the same moment the lfo/adsr components register from a
 *  separate eager glob in an order nothing guarantees. */
export function WESTCOAST_DEFAULT_MODULATORS(): ModulatorState[] {
  const lfo = requireModulator('lfo');
  const adsr = requireModulator('adsr');
  return [
    { ...adsr.defaultState('adsr1'), connections: [{ id: 'c-fold', paramId: 'timbre.fold', depth: 0 }] },
    { ...adsr.defaultState('adsr2'), connections: [{ id: 'c-cut', paramId: 'lpg.cutoff', depth: 0 }] },
    lfo.defaultState('lfo1'),
    { ...lfo.defaultState('lfo2'), rateHz: 2, waveform: 'triangle' },
  ];
}

function makeWestcoastDescriptor() {
  return createDescriptorEngine({
    id: 'westcoast',
    name: 'West',
    polyphony: 'poly',
    params: WEST_PARAMS,
    groups: WEST_GROUPS,
    presets: () => getCachedPresets('westcoast'),
    modulators: WESTCOAST_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('westcoast', makeWestcoastDescriptor);
registerEngine(makeWestcoastDescriptor());

// Declared, not defaulted — the two numbers this engine's future manifest
// carries. The slug prefix used to be a ternary chain in session-host-util.ts;
// the trim still lives in ENGINE_TRIM, which the in-tree renderer reads through
// synthTrim() until the engine leaves the tree.
registerEngineCapabilities('westcoast', {
  clipContent: 'notes',
  shortLabel: 'west',
  outputTrim: 0.5,
});
