// src/plugins/fx/delay.ts
import type { FxInstance, PluginFactory } from '../types';

export const delayPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'delay',
    name: 'Delay',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'time',     label: 'Time',     kind: 'continuous', min: 0.01, max: 2,     default: 0.375, unit: 's' },
      { id: 'feedback', label: 'Fbk',      kind: 'continuous', min: 0,    max: 0.95,  default: 0.45 },
      { id: 'wet',      label: 'Wet',      kind: 'continuous', min: 0,    max: 1.5,   default: 0.8 },
      { id: 'damping',  label: 'Damp',     kind: 'continuous', min: 200,  max: 12000, default: 4500, curve: 'exponential', unit: 'Hz' },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input    = ctx.createGain();
    const delay    = ctx.createDelay(2);
    delay.delayTime.value = 0.375;
    const damping  = ctx.createBiquadFilter();
    damping.type = 'lowpass';
    damping.frequency.value = 4500;
    const fb       = ctx.createGain();
    fb.gain.value = 0.45;
    const wet      = ctx.createGain();
    wet.gain.value = 0.8;
    const output   = ctx.createGain();

    // input → delay
    input.connect(delay);
    // delay → damping → fb → delay (feedback loop with lowpass darkening)
    delay.connect(damping).connect(fb).connect(delay);
    // delay → wet → output
    delay.connect(wet).connect(output);

    const params = new Map<string, AudioParam>([
      ['time', delay.delayTime],
      ['feedback', fb.gain],
      ['wet', wet.gain],
      ['damping', damping.frequency],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => {
        if (id === 'time')     return delay.delayTime.value;
        if (id === 'feedback') return fb.gain.value;
        if (id === 'wet')      return wet.gain.value;
        if (id === 'damping')  return damping.frequency.value;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'time')     delay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01);
        if (id === 'feedback') fb.gain.value = v;
        if (id === 'wet')      wet.gain.value = v;
        if (id === 'damping')  damping.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); delay.disconnect(); damping.disconnect(); fb.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
