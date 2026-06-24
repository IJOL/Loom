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

/** The subtractive engine's DEFAULT modulator set (two ADSRs + two LFOs). The
 *  two ADSRs ship at depth 0 — the built-in amp/filter envelopes are
 *  authoritative — but stay visible/editable. This is the data the worklet lane
 *  serialises to its in-worklet modulation runtime. */
export const SUBTRACTIVE_DEFAULT_MODULATORS: ModulatorState[] = [
  {
    ...makeDefaultADSR('adsr-amp'),
    connections: [{ id: 'c-amp', paramId: 'amp.gain', depth: 0 }],
  },
  {
    ...makeDefaultADSR('adsr-filter'),
    connections: [{ id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0 }],
  },
  makeDefaultLFO('lfo1'),
  { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
];

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
