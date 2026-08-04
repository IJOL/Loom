// plugins/distortion/main.ts — the factory, and nothing else. What this effect
// IS lives in plugin.json, which the host reads, validates and obeys.
//
// A WaveShaper with the classic arctangent-ish curve: `drive` rebuilds the
// curve rather than driving into a fixed one, so the knob changes the SHAPE of
// the clipping and not just how hard the signal hits it. 4x oversampling keeps
// the harmonics it creates from folding back down as aliasing.
import type { FxInstance } from '@loom/plugin-sdk';

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

Loom.registerFx('distortion', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeCurve(0.3);
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
      if (id === 'drive') { drive = v; shaper.curve = makeCurve(v); }
      if (id === 'mix')   { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
    },
    applyPreset: () => {},
    dispose: () => { try { input.disconnect(); shaper.disconnect(); dry.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
  };
});
