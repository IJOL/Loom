/** @vitest-environment jsdom */
// What a LAYERS slot is allowed to hold.
//
// The question looks like UI and is not: a slot holding an engine whose voice
// is not built inside the worklet is skipped at spawn by `LayersRenderer`, so
// the dropdown names an instrument and that end of the sound control is
// silence. It shipped that way — every rack the WEAVE sound control built came
// up with the Sampler in slot 2 — because the list was filtered by NOTE EDITOR,
// and the Sampler's editor is a piano roll like any melodic engine's.
import { describe, it, expect } from 'vitest';
import './layers-engine';
import './sampler';
// LAYERS ships an LFO with the sound, and building its descriptor resolves that
// modulator through the registry — so the kinds have to be registered before
// anything asks the registry for a descriptor.
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
import { registerEngine } from './registry';
import { createDescriptorEngine } from './descriptor-engine';
import { registerEngineCapabilities } from '../plugins/capabilities';
import { slotChoices } from './layers-rack-ui';
import { melodicSynthEngineIds } from './engine-selector-ui';
import { LAYERS_ENGINE_ID } from './layers-engine';

// A plugin engine, as the host sees one: registered from a manifest, which is
// what makes it worklet-hosted.
registerEngine(createDescriptorEngine({
  id: 'test-synth', name: 'Test Synth', polyphony: 'poly',
  params: [{ id: 'gain', label: 'Gain', kind: 'continuous', min: 0, max: 1, default: 1 }],
  presets: () => [],
}));
registerEngineCapabilities(
  'test-synth', { clipContent: 'notes', shortLabel: 'test', outputTrim: 1 }, true,
);

const ids = () => slotChoices().map((e) => e.id);

describe('slotChoices', () => {
  it('offers an engine whose voice is built in the worklet', () => {
    expect(ids()).toContain('test-synth');
  });

  it('never offers the Sampler, which the editor filter alone let through', () => {
    // Not a vacuous assertion: by the rule this list used to apply, the Sampler
    // qualifies. If this first line ever stops holding, the one below stops
    // testing anything.
    expect(melodicSynthEngineIds()).toContain('sampler');
    // It runs in a processor of its own, so `hasRenderer('sampler')` is false
    // inside the worklet and the slot renders nothing. Measured at the master
    // before the fix: RMS 0.032 at the near end of the fader, 0.0020 at the far
    // one — which is what "le pone sampler y no suena" was.
    expect(ids()).not.toContain('sampler');
  });

  it('never offers LAYERS itself', () => {
    // A rack pointing at itself builds its own sub-engines at spawn with
    // nothing bounding the depth: an infinite tower of synths in the audio
    // callback.
    expect(ids()).not.toContain(LAYERS_ENGINE_ID);
  });
});
