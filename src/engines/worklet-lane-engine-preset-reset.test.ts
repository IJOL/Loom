/** @vitest-environment jsdom */
// Loading a preset must load THE PRESET — not the preset painted over whatever
// the lane held before. applyPreset used to write only the params a preset
// NAMES, so any value the bank leaves unnamed (westcoast names 13 of its 24 on
// average) survived from the previous preset, the dice, or a hand on a knob:
// walking the preset dropdown accumulated osc.ring / detune / fold residue and
// the whole bank sounded noisy and out of tune while every preset, rendered
// from a clean bag, was fine. Same leak, second door: a preset that carries no
// `modulators` kept the PREVIOUS preset's LFO running on the new sound. And a
// third: `output.trim` (0.65..2.0 across the FM bank, undeclared by any spec)
// stuck too, so sounds came in at the previous preset's loudness.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ParamBag } from '../audio-dsp/types';

const postedBags: ParamBag[] = [];
vi.mock('../audio-worklet/loom-node', () => ({
  loadLoomWorklet: vi.fn().mockResolvedValue(undefined),
  LoomWorkletNode: class {
    spawn() {} setParams(p: ParamBag) { postedBags.push(p); }
    setMaxVoices() {} setMods() {} releaseVoice() {}
    steal() {} silenceAll() {} onVoiceCount() {} onModValues() {}
    connect() {} disconnect() {} dispose() {}
  },
}));

import { WorkletLaneEngine, type WorkletEngineConfig } from './worklet-lane-engine';
import type { EngineParamSpec } from './engine-params';
import subtractiveManifest from '../../plugins/subtractive/plugin.json';
import { makeDefaultLFO } from '../plugins/modulators/lfo';
import { __seedPresetCache, __resetPresetCache } from '../presets/preset-loader';
import { STRIP_PARAM_SPECS } from '../core/channel-strip-params';

const SUB_PARAM_SPECS = subtractiveManifest.components[0].params as unknown as EngineParamSpec[];

const cfg = (over: Partial<WorkletEngineConfig> = {}): WorkletEngineConfig => ({
  engineId: 'subtractive', name: 'Sub', params: SUB_PARAM_SPECS, presetsKey: 'subtractive',
  polyphony: 'poly', modulators: [makeDefaultLFO('lfo1')], ...over,
});
const out = () => ({ connect() {} }) as unknown as AudioNode;
const makeEngine = (over: Partial<WorkletEngineConfig> = {}) =>
  new WorkletLaneEngine({} as AudioContext, out(), cfg(over));

beforeEach(() => {
  postedBags.length = 0;
  __resetPresetCache();
  __seedPresetCache('subtractive', [
    // Names ONE param. Everything else the engine declares must come back to
    // its spec default when this loads.
    { name: 'Plain', params: { 'osc1.level': 0.42 } },
    // Ships a modulator, so applying it plants one for 'Plain' to inherit.
    {
      name: 'Wobble', params: { 'osc1.level': 0.5 },
      modulators: [{
        id: 'wob', kind: 'lfo', enabled: true, waveform: 'sine',
        connections: [{ id: 'c1', paramId: 'filter.cutoff', depth: 0.8 }],
      }],
    },
  ] as never);
});
afterEach(() => __resetPresetCache());

describe('applyPreset loads the preset as a FULL patch', () => {
  it('resets a declared param the preset does not name back to its spec default', () => {
    const engine = makeEngine();
    engine.setBaseValue('ring.level', 0.9);          // the leftover: ring mod cranked by hand
    engine.applyPreset('Plain');                     // 'Plain' does not name ring.level
    expect(engine.getBaseValue('ring.level')).toBe(0);
    expect(engine.getBaseValue('osc1.level')).toBe(0.42);   // the named param still lands
  });

  it('resets output.trim to 1 when the preset does not carry one', () => {
    const engine = makeEngine();
    engine.setBaseValue('output.trim', 2.0);         // a hot FM preset left this behind
    engine.applyPreset('Plain');
    expect(engine.getBaseValue('output.trim')).toBe(1);
  });

  it('restores the engine\'s default modulators when the preset carries none', () => {
    const engine = makeEngine();
    engine.applyPreset('Wobble');
    expect(engine.modulators.modulators.some((m) => m.id === 'wob')).toBe(true);
    engine.applyPreset('Plain');                     // no `modulators` on this one
    expect(engine.modulators.modulators.some((m) => m.id === 'wob')).toBe(false);
    expect(engine.modulators.modulators.some((m) => m.id === 'lfo1')).toBe(true);
  });

  it('never posts a strip param to the worklet — the desk is not the patch', () => {
    // A descriptor-built engine declares the strip params too; the reset loop
    // must skip them or a preset load would move the fader.
    const engine = makeEngine({ params: [...SUB_PARAM_SPECS, ...STRIP_PARAM_SPECS] });
    postedBags.length = 0;
    engine.applyPreset('Plain');
    for (const bag of postedBags) {
      for (const id of Object.keys(bag)) expect(id.startsWith('bus.')).toBe(false);
    }
  });
});
