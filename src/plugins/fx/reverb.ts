// src/plugins/fx/reverb.ts
import type { FxInstance, PluginFactory } from '../types';

function makeImpulse(ctx: AudioContext, sec: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * Math.max(0.05, sec));
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

export const reverbPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'reverb',
    name: 'Reverb',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'wet',      label: 'Wet',      kind: 'continuous', min: 0,    max: 1.5, default: 0.9 },
      { id: 'predelay', label: 'PreD',     kind: 'continuous', min: 0,    max: 0.5, default: 0,   unit: 's' },
      { id: 'size',     label: 'Size',     kind: 'continuous', min: 0.05, max: 8,   default: 2.5, unit: 's' },
      { id: 'decay',    label: 'Decay',    kind: 'continuous', min: 0.1,  max: 10,  default: 3 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    let size = 2.5, decay = 3;
    const input    = ctx.createGain();
    const predelay = ctx.createDelay(0.5);
    const conv     = ctx.createConvolver(); conv.buffer = makeImpulse(ctx, size, decay);
    const wet      = ctx.createGain(); wet.gain.value = 0.9;
    const output   = ctx.createGain();
    input.connect(predelay).connect(conv).connect(wet).connect(output);

    const params = new Map<string, AudioParam>([
      ['wet', wet.gain],
      ['predelay', predelay.delayTime],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => {
        if (id === 'wet')      return wet.gain.value;
        if (id === 'predelay') return predelay.delayTime.value;
        if (id === 'size')     return size;
        if (id === 'decay')    return decay;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'wet')      wet.gain.value = v;
        if (id === 'predelay') predelay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01);
        if (id === 'size')     { size = v;  conv.buffer = makeImpulse(ctx, size, decay); }
        if (id === 'decay')    { decay = v; conv.buffer = makeImpulse(ctx, size, decay); }
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); predelay.disconnect(); conv.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
