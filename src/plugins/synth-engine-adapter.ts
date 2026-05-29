import type { SynthEngine } from '../engines/engine-types';
import type { PluginFactory, SynthInstance } from './types';

export function synthEngineAsPlugin(engine: SynthEngine): PluginFactory {
  return {
    kind: 'synth',
    manifest: {
      id: engine.id,
      name: engine.name,
      kind: 'synth',
      version: '0.0.0-legacy',
      params: engine.params,
      presets: [],
    },
    create(ctx: AudioContext, output: AudioNode): SynthInstance {
      const voice = engine.createVoice(ctx, output);
      return {
        trigger:                (m, t, o) => voice.trigger(m, t, o),
        release:                (t)       => voice.release(t),
        connect:                (d)       => voice.connect(d),
        getAudioParams:         ()        => voice.getAudioParams(),
        getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
        getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
        getBaseValue:           (id)      => engine.getBaseValue(id),
        setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
        applyPreset:            (name)    => engine.applyPreset(name),
        dispose:                ()        => voice.dispose(),
      };
    },
  };
}
