// src/engines/audio.ts
//
// Phase 4 cutover: the legacy AudioEngine + AudioVoice (Web Audio playAudioClip)
// were deleted. The dedicated audio channel now plays its clip through the
// AudioWorklet (AudioWorkletEngine + the sampler worklet/kernel) live. This file
// is DATA-ONLY: the single Gain param spec and a registered descriptor so
// getEngine('audio') / the selector keep working.

import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { registerEngineCapabilities } from '../plugins/capabilities';

const AUDIO_PARAMS: EngineParamSpec[] = [
  { id: 'gain', label: 'Gain', kind: 'continuous', min: 0, max: 1.5, default: 1 },
];

function makeAudioDescriptor() {
  return createDescriptorEngine({
    id: 'audio',
    name: 'Audio',
    polyphony: 'mono',
    params: AUDIO_PARAMS,
    presets: () => [],
  });
}

registerEngineFactory('audio', makeAudioDescriptor);
registerEngine(makeAudioDescriptor());

// The capability door (Task 4): isAudioClip() now asks clipEditorFor(engineId)
// instead of comparing lane.engineId === 'audio' literally. The built-in audio
// channel has to answer through the same door a plugin would, or its own real
// clips would stop being recognised as audio clips the moment the router
// switched. Task 5 registers sampler/drums-machine the same way; this one
// piece could not wait — without it the router change breaks the live audio
// channel and every pre-existing test exercising it.
registerEngineCapabilities('audio', {
  clipEditor: 'audio',
  shortLabel: 'audio',
  outputTrim: 1,
  accepts: ['audio-file'],
  acceptsNoteFx: false,      // a whole file is not transformed note by note
  harmonic: false,           // cannot host a chord accompaniment
  listedInSelector: false,   // added through its own explicit entry, not the list
});
