// src/plugins/fx/reverb.ts
import type { FxInstance, PluginFactory } from '../types';
import { generateReverbIR, REVERB_TYPES, type ReverbType } from './reverb-ir';

function makeImpulse(ctx: AudioContext, sec: number, decay: number, type: ReverbType): AudioBuffer {
  const { left, right } = generateReverbIR({
    sampleRate: ctx.sampleRate, seconds: sec, decay, type,
  });
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.getChannelData(0).set(left);
  ir.getChannelData(1).set(right);
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
      { id: 'type',     label: 'Type',     kind: 'discrete',   min: 0,    max: 3,   default: 0,
        options: [
          { value: 'room',   label: 'ROOM' },
          { value: 'hall',   label: 'HALL' },
          { value: 'plate',  label: 'PLATE' },
          { value: 'spring', label: 'SPRING' },
        ] },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    let size = 2.5, decay = 3, typeIdx = 0;
    const input    = ctx.createGain();
    const predelay = ctx.createDelay(0.5);
    const conv     = ctx.createConvolver();
    // Rebuilding the IR walks the whole buffer through five passes, so only do
    // it when a value that shapes it actually changed.
    const rebuild = () => { conv.buffer = makeImpulse(ctx, size, decay, REVERB_TYPES[typeIdx] ?? 'room'); };
    rebuild();
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
        if (id === 'type')     return typeIdx;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'wet')      wet.gain.value = v;
        if (id === 'predelay') predelay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01);
        if (id === 'size')     { if (v !== size)    { size = v;         rebuild(); } }
        if (id === 'decay')    { if (v !== decay)   { decay = v;        rebuild(); } }
        if (id === 'type')     { const i = v | 0; if (i !== typeIdx) { typeIdx = i; rebuild(); } }
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); predelay.disconnect(); conv.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
