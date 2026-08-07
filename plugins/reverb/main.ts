// plugins/reverb/main.ts — a convolution reverb over a synthetic impulse
// response. What it IS lives in plugin.json.
//
// The IR itself is the SDK's `generateReverbIR`: five passes of pure Float32
// arithmetic (early reflections, diffuse tail, brightness, allpass diffusion,
// DC blocking) that make a room rather than a noise burst. This file is only
// the graph around it — predelay, the convolver, and a wet gain.
import { generateReverbIR, REVERB_TYPES, type ReverbType, type FxInstance } from '@loom/plugin-sdk';

function makeImpulse(ctx: AudioContext, sec: number, decay: number, type: ReverbType): AudioBuffer {
  const { left, right } = generateReverbIR({
    sampleRate: ctx.sampleRate, seconds: sec, decay, type,
  });
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.getChannelData(0).set(left);
  ir.getChannelData(1).set(right);
  return ir;
}

Loom.registerFx('reverb', (ctx): FxInstance => {
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
});
