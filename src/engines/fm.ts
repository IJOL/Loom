// src/engines/fm.ts
//
// Phase 4 cutover: the legacy FMEngine + FMVoice (Web Audio node-per-note,
// 4-operator DX7-style) were deleted. FM lanes now synthesise through the
// AudioWorklet (WorkletLaneEngine + audio-dsp/fm-renderer) live and the pure
// kernel offline. This file is DATA-ONLY: the algorithm table, the operator
// param spec, the default modulators, and a registered metadata descriptor.

import type { EngineParamSpec } from './engine-params';
import type { EngineParamGroup } from './engine-param-groups';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { registerEngineCapabilities } from '../plugins/capabilities';
import { requireModulator } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';

interface FMAlgorithm {
  id: number;
  name: string;
}

const ALGORITHMS: FMAlgorithm[] = [
  { id: 1, name: 'Serial 4→3→2→1' },
  { id: 2, name: 'Parallel mods → 1' },
  { id: 3, name: 'Two pairs (4→3, 2→1)' },
  { id: 4, name: 'Additive (all carriers)' },
];

const ALGO_OPTIONS = ALGORITHMS.map((a, i) => ({ value: String(i), label: `${a.id}. ${a.name}` }));

// Helper to expand the 7 op params per operator.
function opParamSpecs(n: number, defaults: { ratio: number; level: number }): EngineParamSpec[] {
  const g = `op${n}`;
  return [
    { id: `op${n}.ratio`,   label: `Op${n} Ratio`, kind: 'continuous', min: 0.1, max: 16, default: defaults.ratio, curve: 'exponential', group: g },
    { id: `op${n}.detune`,  label: `Op${n} Det`,   kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢', group: g },
    { id: `op${n}.level`,   label: `Op${n} Lvl`,   kind: 'continuous', min: 0,   max: 1,  default: defaults.level, group: g },
    { id: `op${n}.attack`,  label: `Op${n} Atk`,   kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', group: g },
    { id: `op${n}.decay`,   label: `Op${n} Dec`,   kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's', group: g },
    { id: `op${n}.sustain`, label: `Op${n} Sus`,   kind: 'continuous', min: 0,   max: 1,  default: 0.7, group: g },
    { id: `op${n}.release`, label: `Op${n} Rel`,   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', group: g },
  ];
}

// Unified-param schema. Operator ids are 1-indexed (op1..op4), matching the UI.
// algorithm/feedback/amp.mix have no dot-prefix of their own — they are global
// controls (which routing, how much op4 feeds back into itself, the final
// output mix), not an operator's parameter, so they stay in the leading
// ungrouped row rather than being forced into a section.
export const FM_PARAMS: EngineParamSpec[] = [
  { id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: ALGO_OPTIONS.length - 1, default: 2, options: ALGO_OPTIONS, selectStyle: 'dropdown' },
  { id: 'feedback',  label: 'FB (op4)', kind: 'continuous', min: 0, max: 1, default: 0 },
  ...opParamSpecs(1, { ratio: 1, level: 0.9 }),
  ...opParamSpecs(2, { ratio: 2, level: 0.35 }),
  ...opParamSpecs(3, { ratio: 1, level: 0.5 }),
  ...opParamSpecs(4, { ratio: 3, level: 0.25 }),
  { id: 'amp.mix',    label: 'Mix',       kind: 'continuous', min: 0, max: 1, default: 0.7 },
  { id: 'poly.voices', label: 'Voices',   kind: 'continuous', min: 1, max: 16, default: 6, group: 'poly' },
];

// Four operators, two per row, instead of stacking four deep.
export const FM_GROUPS: EngineParamGroup[] = [
  { id: 'op1', title: 'OP 1', row: 0, color: 'var(--knob-cyan)' },
  { id: 'op2', title: 'OP 2', row: 0, color: 'var(--knob-yellow)' },
  { id: 'op3', title: 'OP 3', row: 1, color: 'var(--knob-blue)' },
  { id: 'op4', title: 'OP 4', row: 1, color: 'var(--knob-purple)' },
  { id: 'poly', title: 'POLY', row: 2 },
];

/** A FUNCTION, not a computed constant — see SUBTRACTIVE_DEFAULT_MODULATORS
 *  (subtractive.ts) for why: this file's own registerEngine(...) below runs at
 *  module scope, the same moment the lfo/adsr components register from a
 *  separate eager glob in an order nothing guarantees. */
export function FM_DEFAULT_MODULATORS(): ModulatorState[] {
  const lfo = requireModulator('lfo');
  const adsr = requireModulator('adsr');
  return [
    lfo.defaultState('lfo1'),
    adsr.defaultState('adsr1'),
  ];
}

function makeFMDescriptor() {
  return createDescriptorEngine({
    id: 'fm',
    name: 'FM',
    polyphony: 'poly',
    params: FM_PARAMS,
    groups: FM_GROUPS,
    presets: () => getCachedPresets('fm'),
    modulators: FM_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('fm', makeFMDescriptor);
registerEngine(makeFMDescriptor());

// Declared, not defaulted — the two numbers this engine's future manifest
// carries. The slug prefix used to be a ternary chain in session-host-util.ts;
// the trim still lives in ENGINE_TRIM, which the in-tree renderer reads through
// synthTrim() until the engine leaves the tree.
registerEngineCapabilities('fm', {
  clipContent: 'notes',
  shortLabel: 'fm-4-op',
  outputTrim: 0.179,
});
