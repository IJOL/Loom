// src/engines/karplus.ts
//
// Phase 4 cutover: the legacy KarplusEngine + KarplusVoice (offline per-note
// renderKarplusString into an AudioBuffer + Web Audio amp) were deleted. Karplus
// lanes now synthesise through the AudioWorklet (WorkletLaneEngine +
// audio-dsp/karplus-renderer) live and the pure kernel offline. The shared
// renderKarplusString DSP lives in audio-dsp/karplus-renderer.ts. This file is
// DATA-ONLY: the param spec, default modulators, and a registered descriptor.

import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';

const KARPLUS_PARAMS: EngineParamSpec[] = [
  // String resonator
  { id: 'string.damping',    label: 'Damping',    kind: 'continuous', min: 0,     max: 1,   default: 0.5 },
  { id: 'string.brightness', label: 'Brightness', kind: 'continuous', min: 0,     max: 1,   default: 0.65 },
  // Excitation burst
  { id: 'excite.time',       label: 'Excite',     kind: 'continuous', min: 0.001, max: 0.1, default: 0.01, unit: 's' },
  { id: 'excite.tone',       label: 'Noise Tone', kind: 'continuous', min: 0,     max: 1,   default: 0.5 },
  // Amp envelope
  { id: 'amp.builtinEnv',    label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'amp.attack',        label: 'Attack',     kind: 'continuous', min: 0.001, max: 0.5, default: 0.005, unit: 's' },
  { id: 'amp.release',       label: 'Release',    kind: 'continuous', min: 0.05,  max: 4,   default: 0.5,   unit: 's' },
  { id: 'amp.level',         label: 'Level',      kind: 'continuous', min: 0,     max: 1,   default: 0.8 },
  // Polyphony cap
  { id: 'poly.voices',       label: 'Voices',     kind: 'continuous', min: 1,     max: 16,  default: 8 },
];

export const KARPLUS_DEFAULT_MODULATORS: ModulatorState[] = [
  makeDefaultLFO('lfo1'),
  makeDefaultADSR('adsr1'),
];

function makeKarplusDescriptor() {
  return createDescriptorEngine({
    id: 'karplus',
    name: 'Karp',
    polyphony: 'poly',
    params: KARPLUS_PARAMS,
    presets: () => getCachedPresets('karplus'),
    modulators: KARPLUS_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('karplus', makeKarplusDescriptor);
registerEngine(makeKarplusDescriptor());
