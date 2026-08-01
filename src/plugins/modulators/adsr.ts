// src/plugins/modulators/adsr.ts
import { ADSRVoice } from '../../modulation/adsr-voice';
import type { ModulatorState } from '../../modulation/types';
import type { ModulatorInstance, PluginFactory } from '../types';
import { registerModulator } from '../../modulation/modulator-registry';
import { adsrConfigTemplate } from '../../modulation/mod-config-templates';

/** Fresh ADSR state for a new instance. Moved from modulation/types.ts — the
 *  ADSR component owns its own defaults now; the registry's `defaultState`
 *  below is the only door callers should use to reach it. */
export function makeDefaultADSR(id: string): ModulatorState {
  return {
    id, kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.01, decaySec: 0.3, sustain: 0.7, releaseSec: 0.3,
    scope: 'per-voice',
  };
}

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

registerModulator({
  id: 'adsr',
  name: 'ADSR',
  driver: 'gate',
  scopes: ['per-voice'],
  idPrefix: 'adsr',
  defaultState: (id) => makeDefaultADSR(id),
  configTemplate: (mod, ctx) => adsrConfigTemplate(mod, ctx),
  createVoice: (ctx, { state }) => new ADSRVoice(ctx, state),
});
