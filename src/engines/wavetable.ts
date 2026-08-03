// src/engines/wavetable.ts
//
// Phase 4 cutover: the legacy WavetableEngine + WavetableVoice (Web Audio
// PeriodicWave morph + filter) were deleted. Wavetable lanes now synthesise
// through the AudioWorklet (WorkletLaneEngine + audio-dsp/wavetable-renderer)
// live and the pure kernel offline. The wave specs + synthesised tables both
// live in audio-dsp/wavetable-data.ts (single source). This file is DATA-ONLY:
// the param spec, default modulators, and a registered descriptor.

import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { registerEngineCapabilities } from '../plugins/capabilities';
import { WAVETABLES } from '../audio-dsp/wavetable-data';
import { requireModulator } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';

const WAVE_OPTIONS = WAVETABLES.map((w, i) => ({ value: String(i), label: w.name }));

export const WT_PARAMS: EngineParamSpec[] = [
  { id: 'osc.waveA',        label: 'Wave A',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 2, options: WAVE_OPTIONS, group: 'osc' },
  { id: 'osc.waveB',        label: 'Wave B',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 3, options: WAVE_OPTIONS, group: 'osc' },
  { id: 'osc.morph',        label: 'Morph',     kind: 'continuous', min: 0,    max: 1,  default: 0.0, group: 'osc' },
  { id: 'osc.detune',       label: 'Detune',    kind: 'continuous', min: -50,  max: 50, default: 0, unit: '¢', group: 'osc' },
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0,    max: 1,  default: 0.55, group: 'filter' },
  { id: 'filter.resonance', label: 'Res',       kind: 'continuous', min: 0,    max: 1,  default: 0.2, group: 'filter' },
  // Default On: the built-in amp env is the ONLY amp.gain driver in a lane
  // (adsr1 routes to filter.cutoff, not amp). Defaulting Off would silence
  // lane patches. Turning it Off is opt-in for users who route a modular ADSR.
  { id: 'amp.builtinEnv',   label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }], group: 'amp' },
  { id: 'amp.attack',       label: 'Attack',    kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', curve: 'exponential', group: 'amp' },
  { id: 'amp.decay',        label: 'Decay',     kind: 'continuous', min: 0.001, max: 2, default: 0.3,  unit: 's', curve: 'exponential', group: 'amp' },
  { id: 'amp.sustain',      label: 'Sustain',   kind: 'continuous', min: 0,    max: 1,  default: 0.7, group: 'amp' },
  { id: 'amp.release',      label: 'Release',   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', curve: 'exponential', group: 'amp' },
  // Polyphony cap
  { id: 'poly.voices',      label: 'Voices',    kind: 'continuous', min: 1, max: 16, default: 8, group: 'poly' },
];

// OSC and FILTER are small and adjacent in the signal path, so they share the
// leading row; AMP's five-knob envelope earns a row of its own, POLY last.
// Unlike Subtractive, this engine's amp envelope has no ADSR modulator
// covering the same ground (adsr1 routes to filter.cutoff, not amp), so it is
// a real section here rather than `drawnBy: 'modulators'`.
export const WT_GROUPS: EngineParamGroup[] = [
  { id: 'osc',    title: 'OSC',    row: 0, color: 'var(--knob-cyan)' },
  { id: 'filter', title: 'FILTER', row: 0, color: 'var(--knob-orange)' },
  { id: 'amp',    title: 'AMP',    row: 1, color: 'var(--knob-green)' },
  { id: 'poly',   title: 'POLY',   row: 2 },
];

/** A FUNCTION, not a computed constant — see SUBTRACTIVE_DEFAULT_MODULATORS
 *  (subtractive.ts) for why: this file's own registerEngine(...) below runs at
 *  module scope, the same moment the lfo/adsr components register from a
 *  separate eager glob in an order nothing guarantees. */
export function WAVETABLE_DEFAULT_MODULATORS(): ModulatorState[] {
  const lfo = requireModulator('lfo');
  const adsr = requireModulator('adsr');
  return [
    {
      ...adsr.defaultState('adsr1'),
      connections: [{ id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0.5 }],
    },
    lfo.defaultState('lfo1'),
  ];
}

function makeWavetableDescriptor() {
  return createDescriptorEngine({
    id: 'wavetable',
    name: 'Wave',
    polyphony: 'poly',
    params: WT_PARAMS,
    groups: WT_GROUPS,
    presets: () => getCachedPresets('wavetable'),
    modulators: WAVETABLE_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('wavetable', makeWavetableDescriptor);
registerEngine(makeWavetableDescriptor());

// Declared, not defaulted — the two numbers this engine's future manifest
// carries. The slug prefix used to be a ternary chain in session-host-util.ts;
// the trim still lives in ENGINE_TRIM, which the in-tree renderer reads through
// synthTrim() until the engine leaves the tree.
registerEngineCapabilities('wavetable', {
  clipContent: 'notes',
  shortLabel: 'wavetable',
  outputTrim: 0.6,
});
