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
import { requireModulator } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';
import { drumSubGroupFor } from './drum-subgroups';
import { registerEngineCapabilities } from '../plugins/capabilities';

/** A FUNCTION, not a computed constant — see SUBTRACTIVE_DEFAULT_MODULATORS
 *  (subtractive.ts, src/engines/) for why: this file's own registerEngine(...)
 *  below runs at module scope, the same moment the lfo/adsr components
 *  register from a separate eager glob in an order nothing guarantees. */
export function DRUMS_DEFAULT_MODULATORS(): ModulatorState[] {
  const lfo = requireModulator('lfo');
  const adsr = requireModulator('adsr');
  return [
    lfo.defaultState('lfo1'),
    adsr.defaultState('adsr1'),
  ];
}

function makeDrumsDescriptor() {
  return createDescriptorEngine({
    id: 'drums-machine',
    name: 'Drums',
    polyphony: 'poly',
    params: DRUM_PARAMS,
    presets: () => getCachedPresets('drums-machine'),
    modulators: DRUMS_DEFAULT_MODULATORS,
    subGroupFor: drumSubGroupFor,
  });
}

registerEngineFactory('drums-machine', makeDrumsDescriptor);
registerEngine(makeDrumsDescriptor());

registerEngineCapabilities('drums-machine', {
  clipContent: 'notes', defaultNoteView: 'pads', shortLabel: 'drums', outputTrim: 1,
  acceptsNoteFx: false,
  harmonic: false,        // hits, not pitches: cannot host a chord accompaniment
  isRandomizable: false,  // sound is a loaded kit, not a bag of params
  presetKind: 'kits',     // ...and so is its preset: the unified Synth/Samples list
});
