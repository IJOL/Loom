// src/plugins/modulators/adsr.ts
import { ADSRVoice } from '../../modulation/adsr-voice';
import { makeDefaultADSR } from '../../modulation/types';
import type { ModulatorInstance, PluginFactory } from '../types';

export const adsrPlugin: PluginFactory = {
  kind: 'modulator',
  manifest: {
    id: 'adsr',
    name: 'ADSR',
    kind: 'modulator',
    version: '1.0.0',
    params: [],
    presets: [],
  },
  create(ctx, _bpm): ModulatorInstance {
    const state = makeDefaultADSR('adsr-tmp');
    const voice = new ADSRVoice(ctx, state);
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
