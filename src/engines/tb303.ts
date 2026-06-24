// src/engines/tb303.ts
//
// Phase 4 cutover: the legacy TB303Engine + TB303Voice (wrapping core/synth.ts
// TB303) were deleted. TB-303 lanes now synthesise through the AudioWorklet
// (WorkletLaneEngine + audio-dsp/tb303-renderer) live and the pure kernel
// offline. This file is DATA-ONLY: the param spec, the preset-key remap (legacy
// flat JSON keys → dot-id spec, used by the lane allocator to apply TB-303
// presets on the worklet path), the default LFO modulator, and a registered
// metadata descriptor.

import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { getCachedPresets } from '../presets/preset-loader';
import { makeDefaultLFO } from '../modulation/types';
import type { ModulatorState } from '../modulation/types';

const PARAMS: EngineParamSpec[] = [
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.42 },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.55 },
  { id: 'env.amount',       label: 'Env',       kind: 'continuous', min: 0, max: 1, default: 0.5  },
  { id: 'env.decay',        label: 'Decay',     kind: 'continuous', min: 0, max: 1, default: 0.4  },
  { id: 'env.accent',       label: 'Accent',    kind: 'continuous', min: 0, max: 1, default: 0.6  },
  {
    id: 'osc.wave', label: 'Wave', kind: 'discrete',
    min: 0, max: 1, default: 0,
    options: [{ value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Sqr' }],
  },
];

// TB-303 preset JSON keys are the legacy TB303 synth's internal field names; map
// them to the EngineParamSpec ids the worklet lane speaks so a preset applies
// through setBaseValue (the lane allocator passes this as presetKeyRemap).
export const PRESET_KEY_TO_SPEC: Record<string, string> = {
  cutoff:    'filter.cutoff',
  resonance: 'filter.resonance',
  envMod:    'env.amount',
  decay:     'env.decay',
  accent:    'env.accent',
  wave:      'osc.wave',
};

// LFO only — the 303's filter envelope is baked into the renderer and is part of
// the 303 character. A free LFO lets the user add dub-style cutoff wobbles.
export const TB303_DEFAULT_MODULATORS: ModulatorState[] = [makeDefaultLFO('lfo1')];

function makeTB303Descriptor() {
  return createDescriptorEngine({
    id: 'tb303',
    name: '303',
    polyphony: 'mono',
    params: PARAMS,
    presets: () => getCachedPresets('tb303'),
    modulators: TB303_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('tb303', makeTB303Descriptor);
registerEngine(makeTB303Descriptor());
