// src/plugins/fx/distortion.ts
import type { FxInstance, PluginFactory } from '../types';

function makeCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 100;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export const distortionPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'distortion',
    name: 'Dist',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'drive', label: 'Drive', kind: 'continuous', min: 0, max: 1, default: 0.3 },
      { id: 'mix',   label: 'Mix',   kind: 'continuous', min: 0, max: 1, default: 1.0 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeCurve(0.3) as any;
    shaper.oversample = '4x';
    const dry = ctx.createGain(); dry.gain.value = 0;
    const wet = ctx.createGain(); wet.gain.value = 1;
    const output = ctx.createGain();
    input.connect(dry).connect(output);
    input.connect(shaper).connect(wet).connect(output);

    let drive = 0.3;
    let mix   = 1.0;
    const params = new Map<string, AudioParam>([['mix', wet.gain]]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => id === 'drive' ? drive : id === 'mix' ? mix : 0,
      setBaseValue: (id, v) => {
        if (id === 'drive') { drive = v; shaper.curve = makeCurve(v) as any; }
        if (id === 'mix')   { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); shaper.disconnect(); dry.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
