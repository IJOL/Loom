// src/engines/subtractive.ts
//
// Phase 4 cutover: the legacy PolySynth-backed SubtractiveEngine + SubtractiveVoice
// were deleted. Subtractive lanes now synthesise through the AudioWorklet
// (WorkletLaneEngine + audio-dsp/subtractive-renderer) on the live path and the
// pure kernel offline. This file is now DATA-ONLY: the param spec lives in
// subtractive-params.ts, the default modulator set is declared here, and a
// metadata descriptor is registered so getEngine('subtractive') /
// getEngineDescriptor('subtractive') keep returning id/name/params/presets/
// modulators (engine selector UI, save/load, offline ParamBag assembly).

import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';
import { SUB_PARAM_SPECS } from './subtractive-params';

/** The subtractive engine's DEFAULT modulator set: the two ADSRs ARE the amp /
 *  filter envelopes (the pre-worklet model, git 29a342c). adsr-amp drives the
 *  synthetic 'amp' target (amplitude envelope) and adsr-filter drives 'filter.env'
 *  (the filter envelope, scaled by Env Amt exactly like the old built-in), both at
 *  full depth. The built-in amp/filter env stays as a fallback for older saves
 *  (ampBuiltinEnv/filterBuiltinEnv default 1); a preset/Init turns it off via
 *  applyPreset → deriveSubtractiveEnvMods. */
export const SUBTRACTIVE_DEFAULT_MODULATORS: ModulatorState[] = [
  {
    ...makeDefaultADSR('adsr-amp'), decaySec: 0.2,                         // amp env defaults
    connections: [{ id: 'c-amp', paramId: 'amp', depth: 1 }],
  },
  {
    ...makeDefaultADSR('adsr-filter'), sustain: 0.4, releaseSec: 0.35,     // filter env defaults
    connections: [{ id: 'c-filter', paramId: 'filter.env', depth: 1 }],
  },
  makeDefaultLFO('lfo1'),
  { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
];

/** Build the unified-model modulators for a preset from its built-in env params:
 *  adsr-amp ← amp.attack/decay/sustain/release → 'amp'; adsr-filter ← filter.* →
 *  'filter.env'; plus the two default LFOs. Used by WorkletLaneEngine.applyPreset
 *  for subtractive presets that predate the model (no `modulators` of their own),
 *  so they sound identical (same Adsr, same mapping) with the ADSRs as the
 *  envelopes — no need to rewrite the 44 preset JSONs. */
export function deriveSubtractiveEnvMods(params: Record<string, number>): ModulatorState[] {
  const n = (id: string, d: number): number => (typeof params[id] === 'number' ? params[id] : d);
  return [
    {
      ...makeDefaultADSR('adsr-amp'),
      attackSec: n('amp.attack', 0.01), decaySec: n('amp.decay', 0.2),
      sustain: n('amp.sustain', 0.7), releaseSec: n('amp.release', 0.3),
      connections: [{ id: 'c-amp', paramId: 'amp', depth: 1 }],
    },
    {
      ...makeDefaultADSR('adsr-filter'),
      attackSec: n('filter.attack', 0.01), decaySec: n('filter.decay', 0.3),
      sustain: n('filter.sustain', 0.4), releaseSec: n('filter.release', 0.35),
      connections: [{ id: 'c-filter', paramId: 'filter.env', depth: 1 }],
    },
    makeDefaultLFO('lfo1'),
    { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
  ];
}

function makeSubtractiveDescriptor() {
  return createDescriptorEngine({
    id: 'subtractive',
    name: 'Sub',
    polyphony: 'poly',
    params: SUB_PARAM_SPECS,
    presets: () => getCachedPresets('subtractive'),
    modulators: SUBTRACTIVE_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('subtractive', makeSubtractiveDescriptor);
registerEngine(makeSubtractiveDescriptor());
