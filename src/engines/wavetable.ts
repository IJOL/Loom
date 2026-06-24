// src/engines/wavetable.ts
//
// Phase 4 cutover: the legacy WavetableEngine + WavetableVoice (Web Audio
// PeriodicWave morph + filter) were deleted. Wavetable lanes now synthesise
// through the AudioWorklet (WorkletLaneEngine + audio-dsp/wavetable-renderer)
// live and the pure kernel offline. The wave tables live in wavetable-tables.ts
// (data) / audio-dsp/wavetable-data.ts (kernel). This file is DATA-ONLY: the
// param spec, default modulators, and a registered descriptor.

import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { WAVETABLES } from './wavetable-tables';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';

const WAVE_OPTIONS = WAVETABLES.map((w, i) => ({ value: String(i), label: w.name }));

const WT_PARAMS: EngineParamSpec[] = [
  { id: 'osc.waveA',        label: 'Wave A',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 2, options: WAVE_OPTIONS },
  { id: 'osc.waveB',        label: 'Wave B',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 3, options: WAVE_OPTIONS },
  { id: 'osc.morph',        label: 'Morph',     kind: 'continuous', min: 0,    max: 1,  default: 0.0 },
  { id: 'osc.detune',       label: 'Detune',    kind: 'continuous', min: -50,  max: 50, default: 0, unit: '¢' },
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0,    max: 1,  default: 0.55 },
  { id: 'filter.resonance', label: 'Res',       kind: 'continuous', min: 0,    max: 1,  default: 0.2 },
  // Default On: the built-in amp env is the ONLY amp.gain driver in a lane
  // (adsr1 routes to filter.cutoff, not amp). Defaulting Off would silence
  // lane patches. Turning it Off is opt-in for users who route a modular ADSR.
  { id: 'amp.builtinEnv',   label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'amp.attack',       label: 'Attack',    kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', curve: 'exponential' },
  { id: 'amp.decay',        label: 'Decay',     kind: 'continuous', min: 0.001, max: 2, default: 0.3,  unit: 's', curve: 'exponential' },
  { id: 'amp.sustain',      label: 'Sustain',   kind: 'continuous', min: 0,    max: 1,  default: 0.7 },
  { id: 'amp.release',      label: 'Release',   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', curve: 'exponential' },
  // Polyphony cap
  { id: 'poly.voices',      label: 'Voices',    kind: 'continuous', min: 1, max: 16, default: 8 },
];

export const WAVETABLE_DEFAULT_MODULATORS: ModulatorState[] = [
  {
    ...makeDefaultADSR('adsr1'),
    connections: [{ id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0.5 }],
  },
  makeDefaultLFO('lfo1'),
];

function makeWavetableDescriptor() {
  return createDescriptorEngine({
    id: 'wavetable',
    name: 'Wave',
    polyphony: 'poly',
    params: WT_PARAMS,
    presets: () => getCachedPresets('wavetable'),
    modulators: WAVETABLE_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('wavetable', makeWavetableDescriptor);
registerEngine(makeWavetableDescriptor());
