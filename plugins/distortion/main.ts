// plugins/distortion/main.ts — the factory, and nothing else. What this effect
// IS lives in plugin.json, which the host reads, validates and obeys.
//
// A WaveShaper fed the curve from ./curve.ts, at 4x oversampling so the
// harmonics it creates do not fold back down as aliasing.
import type { FxInstance } from '@loom/plugin-sdk';
import { makeCurve } from './curve';

Loom.registerFx('distortion', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0;
  const wet = ctx.createGain(); wet.gain.value = 1;
  const output = ctx.createGain();
  input.connect(dry).connect(output);

  // A WaveShaperNode's curve cannot always be reassigned — node-web-audio-api
  // throws "cannot assign curve twice", and relying on the browser being more
  // permissive would make the drive knob untestable. So a new drive swaps in a
  // fresh shaper, which is what the bitcrusher next door already does for its
  // bit depth.
  let shaper = ctx.createWaveShaper();
  const buildShaper = (amount: number) => {
    const next = ctx.createWaveShaper();
    next.curve = makeCurve(amount);
    next.oversample = '4x';                  // keep the new harmonics from aliasing
    input.connect(next); next.connect(wet);
    try { input.disconnect(shaper); shaper.disconnect(); } catch { /* first build */ }
    shaper = next;
  };
  wet.connect(output);
  buildShaper(0.3);

  let drive = 0.3;
  let mix   = 1.0;
  const params = new Map<string, AudioParam>([['mix', wet.gain]]);

  return {
    input, output,
    getAudioParams: () => params,
    getBaseValue: (id) => id === 'drive' ? drive : id === 'mix' ? mix : 0,
    setBaseValue: (id, v) => {
      // Only on a real move: a redundant write — a preset re-applying the
      // current value, a knob committing what it already had — would otherwise
      // rebuild 1024 floats and rewire two nodes for nothing.
      if (id === 'drive' && v !== drive) { drive = v; buildShaper(v); }
      if (id === 'mix')   { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
    },
    applyPreset: () => {},
    dispose: () => { try { input.disconnect(); shaper.disconnect(); dry.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
  };
});
