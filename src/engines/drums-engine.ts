// src/engines/drums-engine.ts
//
// Phase 4 cutover: the legacy DrumsEngine + DrumsVoice (wrapping the
// node-per-note DrumMachine, with an embedded SamplerEngine for sample kits)
// were deleted. Drums lanes now synthesise through the 8-output AudioWorklet
// (DrumsWorkletEngine + audio-dsp/drums), constructed directly by the lane
// allocator. This file is DATA-ONLY: it registers the 'drums-machine' metadata
// descriptor so getEngine('drums-machine') / getEngineDescriptor /
// listEngines keep working (engine selector UI, GM matching, save/load), sharing
// the worklet engine's exact param vocabulary.

import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { DRUM_PARAMS } from './drums-worklet-engine';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';

export const DRUMS_DEFAULT_MODULATORS: ModulatorState[] = [
  makeDefaultLFO('lfo1'),
  makeDefaultADSR('adsr1'),
];

function makeDrumsDescriptor() {
  return createDescriptorEngine({
    id: 'drums-machine',
    name: 'Drums',
    polyphony: 'poly',
    editor: 'drum-grid',
    params: DRUM_PARAMS,
    presets: () => getCachedPresets('drums-machine'),
    modulators: DRUMS_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('drums-machine', makeDrumsDescriptor);
registerEngine(makeDrumsDescriptor());
