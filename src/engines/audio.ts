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
