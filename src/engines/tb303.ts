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
import type { EngineParamGroup } from './engine-param-groups';
import { registerEngine, registerEngineFactory } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { registerEngineCapabilities } from '../plugins/capabilities';
import { getCachedPresets } from '../presets/preset-loader';
import { requireModulator } from '../modulation/modulator-registry';
import type { ModulatorState } from '../modulation/types';

export const TB303_PARAMS: EngineParamSpec[] = [
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.42, group: 'filter' },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.55, group: 'filter' },
  { id: 'env.amount',       label: 'Env',       kind: 'continuous', min: 0, max: 1, default: 0.5,  group: 'env' },
  { id: 'env.decay',        label: 'Decay',     kind: 'continuous', min: 0, max: 1, default: 0.4,  group: 'env' },
  { id: 'env.accent',       label: 'Accent',    kind: 'continuous', min: 0, max: 1, default: 0.6,  group: 'env' },
  {
    id: 'osc.wave', label: 'Wave', kind: 'discrete',
    min: 0, max: 1, default: 0,
    options: [{ value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Sqr' }],
    group: 'osc',
  },
];

// One row — the 303 is a small, single-page synth: the OSC/FILTER/ENV split
// used to be a flat Wave/Cutoff/Resonance/Env/Decay/Accent knob row with no
// section headers at all (see 55a9b9b). No POLY here on purpose: the 303 is
// mono, so it declares no poly.voices param and this table stays silent about it.
export const TB303_GROUPS: EngineParamGroup[] = [
  { id: 'osc',    title: 'OSC',    row: 0, color: 'var(--knob-cyan)' },
  { id: 'filter', title: 'FILTER', row: 0, color: 'var(--knob-orange)' },
  { id: 'env',    title: 'ENV',    row: 0, color: 'var(--knob-purple)' },
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
// A FUNCTION, not a computed constant — see SUBTRACTIVE_DEFAULT_MODULATORS
// (subtractive.ts) for why: this file's own registerEngine(...) below runs at
// module scope, the same moment the lfo component registers from a separate
// eager glob in an order nothing guarantees.
export function TB303_DEFAULT_MODULATORS(): ModulatorState[] {
  const lfo = requireModulator('lfo');
  return [lfo.defaultState('lfo1')];
}

function makeTB303Descriptor() {
  return createDescriptorEngine({
    id: 'tb303',
    name: '303',
    polyphony: 'mono',
    params: TB303_PARAMS,
    groups: TB303_GROUPS,
    presets: () => getCachedPresets('tb303'),
    modulators: TB303_DEFAULT_MODULATORS,
  });
}

registerEngineFactory('tb303', makeTB303Descriptor);
registerEngine(makeTB303Descriptor());

// Declared, not defaulted: these are the numbers the engine's future manifest
// will carry, and they must already be answered by the engine rather than by a
// table in the host. The slug prefix used to live in a ternary chain in
// session-host-util.ts; the trim still lives in ENGINE_TRIM, which the in-tree
// renderer reads through synthTrim() — that second owner disappears when the
// engine becomes a plugin and the host applies outputTrim instead.
//
// `slide: 'overlap'` is the 303's defining musical rule, and it used to be an
// `engineId === 'tb303'` in the lane scheduler. There is no slide flag on a
// note: a note slides when a previous one still covers its start tick.
registerEngineCapabilities('tb303', {
  clipContent: 'notes',
  shortLabel: 'tb-303',
  outputTrim: 0.45,
  slide: 'overlap',
});
