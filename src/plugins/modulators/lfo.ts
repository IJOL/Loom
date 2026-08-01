// src/plugins/modulators/lfo.ts
import { LFOVoice } from '../../modulation/lfo-voice';
import { makeDefaultLFO } from '../../modulation/types';
import type { ModulatorInstance, PluginFactory } from '../types';
import { registerModulator } from '../../modulation/modulator-registry';
import { lfoConfigTemplate } from '../../modulation/mod-config-templates';

export const lfoPlugin: PluginFactory = {
  kind: 'modulator',
  manifest: {
    id: 'lfo',
    name: 'LFO',
    kind: 'modulator',
    version: '1.0.0',
    params: [],
    presets: [],
  },
  create(ctx, bpm): ModulatorInstance {
    const state = makeDefaultLFO('lfo-tmp');
    const voice = new LFOVoice(ctx, state, () => bpm);
    return {
      output: voice.output,
      getAudioParams: () => new Map(),
      getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {},
      trigger: (t, o) => voice.trigger(t, o),
      release: (t)    => voice.release(t),
      dispose: ()     => voice.dispose(),
    };
  },
};

registerModulator({
  id: 'lfo',
  name: 'LFO',
  driver: 'time',
  scopes: ['shared', 'per-voice'],
  idPrefix: 'lfo',
  defaultState: (id) => makeDefaultLFO(id),
  configTemplate: (mod, ctx) => lfoConfigTemplate(mod, ctx),
  createVoice: (ctx, { state, bpm }) => new LFOVoice(ctx, state, bpm),
});
