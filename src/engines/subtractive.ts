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
import { requireModulator } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';
import { SUB_PARAM_SPECS } from './subtractive-params';
import type { EngineParamGroup } from './engine-param-groups';

/** The page, as data. The seven sections used to be three rows of hand-written
 *  markup in index.html, and their colours were seven CSS rules keyed on the
 *  div ids (`#poly-osc1-knobs { @include knob-accent(var(--knob-cyan)) }`).
 *  Both are gone: this table is the whole layout, and it is what every other
 *  engine can now declare too. AMP is deliberately absent — its four envelope
 *  params are drawn by the MODULATORS panel (`drawnBy: 'modulators'`), so a
 *  section here would be an empty header. */
export const SUB_PARAM_GROUPS: EngineParamGroup[] = [
  { id: 'osc1',   title: 'OSC 1',  row: 0, color: 'var(--knob-cyan)' },
  { id: 'osc2',   title: 'OSC 2',  row: 0, color: 'var(--knob-yellow)' },
  { id: 'sub',    title: 'SUB',    row: 0, color: 'var(--knob-blue)' },
  { id: 'noise',  title: 'NOISE',  row: 0, color: 'var(--knob-purple)' },
  { id: 'filter', title: 'FILTER', row: 1, color: 'var(--knob-orange)' },
  { id: 'master', title: 'MASTER', row: 2, color: 'var(--knob-green)' },
  { id: 'poly',   title: 'POLY',   row: 3 },
];

/** The subtractive engine's DEFAULT modulator set: the two ADSRs ARE the amp /
 *  filter envelopes (the pre-worklet model, git 29a342c). adsr-amp drives the
 *  synthetic 'amp' target (amplitude envelope) and adsr-filter drives 'filter.env'
 *  (the filter envelope, scaled by Env Amt exactly like the old built-in), both at
 *  full depth. The built-in amp/filter env stays as a fallback for older saves
 *  (ampBuiltinEnv/filterBuiltinEnv default 1); a preset/Init turns it off via
 *  applyPreset → deriveSubtractiveEnvMods.
 *
 *  A FUNCTION, not a computed constant: it reads getModulator('lfo')/('adsr'),
 *  and this file's own registerEngine(...) below runs at module scope — the
 *  same moment the lfo/adsr components register from a separate eager glob,
 *  in an order nothing guarantees (see DescriptorEngineConfig.modulators).
 *  Calling this only happens lazily, well after both globs have settled. */
export function SUBTRACTIVE_DEFAULT_MODULATORS(): ModulatorState[] {
  const lfo = requireModulator('lfo');
  const adsr = requireModulator('adsr');
  return [
    {
      ...adsr.defaultState('adsr-amp'), decaySec: 0.2,                         // amp env defaults
      connections: [{ id: 'c-amp', paramId: 'amp', depth: 1 }],
    },
    {
      ...adsr.defaultState('adsr-filter'), sustain: 0.4, releaseSec: 0.35,     // filter env defaults
      connections: [{ id: 'c-filter', paramId: 'filter.env', depth: 1 }],
    },
    lfo.defaultState('lfo1'),
    { ...lfo.defaultState('lfo2'), rateHz: 2, waveform: 'triangle' },
  ];
}

/** Build the unified-model modulators for a preset from its built-in env params:
 *  adsr-amp ← amp.attack/decay/sustain/release → 'amp'; adsr-filter ← filter.* →
 *  'filter.env'; plus the two default LFOs. Used by WorkletLaneEngine.applyPreset
 *  for subtractive presets that predate the model (no `modulators` of their own),
 *  so they sound identical (same Adsr, same mapping) with the ADSRs as the
 *  envelopes — no need to rewrite the 44 preset JSONs. */
export function deriveSubtractiveEnvMods(params: Record<string, number>): ModulatorState[] {
  const n = (id: string, d: number): number => (typeof params[id] === 'number' ? params[id] : d);
  const lfo = requireModulator('lfo');
  const adsr = requireModulator('adsr');
  return [
    {
      ...adsr.defaultState('adsr-amp'),
      attackSec: n('amp.attack', 0.01), decaySec: n('amp.decay', 0.2),
      sustain: n('amp.sustain', 0.7), releaseSec: n('amp.release', 0.3),
      connections: [{ id: 'c-amp', paramId: 'amp', depth: 1 }],
    },
    {
      ...adsr.defaultState('adsr-filter'),
      attackSec: n('filter.attack', 0.01), decaySec: n('filter.decay', 0.3),
      sustain: n('filter.sustain', 0.4), releaseSec: n('filter.release', 0.35),
      connections: [{ id: 'c-filter', paramId: 'filter.env', depth: 1 }],
    },
    lfo.defaultState('lfo1'),
    { ...lfo.defaultState('lfo2'), rateHz: 2, waveform: 'triangle' },
  ];
}

function makeSubtractiveDescriptor() {
  return createDescriptorEngine({
    id: 'subtractive',
    name: 'Sub',
    polyphony: 'poly',
    params: SUB_PARAM_SPECS,
    groups: SUB_PARAM_GROUPS,
    presets: () => getCachedPresets('subtractive'),
    modulators: SUBTRACTIVE_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('subtractive', makeSubtractiveDescriptor);
registerEngine(makeSubtractiveDescriptor());
