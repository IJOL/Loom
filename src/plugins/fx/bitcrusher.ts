// src/plugins/fx/bitcrusher.ts
// Bitcrusher — the digital-degradation effect. Its heart is BIT-DEPTH reduction:
// quantizing the signal to a small number of amplitude steps, which is exactly
// what a WaveShaperNode does when you feed it a staircase curve. That is native,
// stateless, and (unlike a true sample-rate decimator, which needs a stateful
// worklet the test harness can't run) fully measurable offline.
//
// A `tone` lowpass stands in for the high-end dulling that real downsampling
// brings, and a dry/wet `mix` lets it sit in parallel. All native Web Audio,
// like reverb/delay/distortion.
import type { FxInstance, PluginFactory } from '../types';

// A quantization staircase mapping input −1..1 to `2^bits` evenly-spaced levels.
// Fractional bit counts are honoured (levels = 2^bits) so the knob is smooth.
function crushCurve(bits: number): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const levels = Math.max(2, Math.pow(2, bits));
  const step = 2 / (levels - 1);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;          // input position, −1..1
    curve[i] = Math.max(-1, Math.min(1, Math.round(x / step) * step));
  }
  return curve;
}

export const bitcrusherPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'bitcrusher',
    name: 'Crush',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'bits', label: 'Bits', kind: 'continuous', min: 1,   max: 16,    default: 8 },
      { id: 'tone', label: 'Tone', kind: 'continuous', min: 200, max: 20000, default: 8000, unit: 'Hz' },
      { id: 'mix',  label: 'Mix',  kind: 'continuous', min: 0,   max: 1,     default: 1 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const output = ctx.createGain();

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 8000;
    tone.Q.value = 0.7;

    const dry = ctx.createGain(); dry.gain.value = 0;
    const wet = ctx.createGain(); wet.gain.value = 1;

    // A WaveShaperNode's curve cannot be reassigned once set (the spec, and
    // node-web-audio-api, forbid it), so changing `bits` swaps in a fresh shaper.
    let shaper = ctx.createWaveShaper();
    const buildShaper = (b: number) => {
      const next = ctx.createWaveShaper();
      next.curve = crushCurve(b) as any;
      next.oversample = 'none';                // crushing WANTS the aliasing
      input.connect(next); next.connect(tone);
      try { input.disconnect(shaper); shaper.disconnect(); } catch { /* first build */ }
      shaper = next;
    };

    // input → dry → out ; input → shaper → tone → wet → out.
    input.connect(dry).connect(output);
    tone.connect(wet).connect(output);
    buildShaper(8);

    let bits = 8, toneHz = 8000, mix = 1;

    return {
      input, output,
      getAudioParams: () => new Map<string, AudioParam>([
        ['tone', tone.frequency],
        ['mix', wet.gain],
      ]),
      getBaseValue: (id) => id === 'bits' ? bits : id === 'tone' ? toneHz : id === 'mix' ? mix : 0,
      setBaseValue: (id, v) => {
        if (id === 'bits') { bits = v; buildShaper(v); }
        if (id === 'tone') { toneHz = v; tone.frequency.value = v; }
        if (id === 'mix')  { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
      },
      applyPreset: () => {},
      dispose: () => {
        for (const n of [input, output, shaper, tone, dry, wet]) {
          try { n.disconnect(); } catch { /* ok */ }
        }
      },
    };
  },
};
