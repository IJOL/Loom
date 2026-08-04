// plugins/bitcrusher/main.ts — the digital-degradation effect. What it IS —
// its four knobs, its name, its rack colour — lives in plugin.json.
//
// Its heart is BIT-DEPTH reduction: quantizing the signal to a small number of
// amplitude steps, which is exactly what a WaveShaperNode does when you feed it
// a staircase curve. That is native, stateless, and (unlike a true sample-rate
// decimator, which needs a stateful worklet) fully measurable offline.
//
// A `tone` lowpass stands in for the high-end dulling that real downsampling
// brings, and a dry/wet `mix` lets it sit in parallel.
//
// DITHER (idea from mpump, AGPL-3.0-or-later — its crusher is a worklet that
// adds noise per sample before rounding). A WaveShaper curve is a stateless
// lookup, so dither CANNOT live inside the curve: adding noise there would just
// make the staircase ragged. It has to be real noise summed into the signal
// BEFORE quantizing, which is what the noise source below does. Triangular-PDF
// (two uniforms summed) is the standard choice — it decorrelates the
// quantization error from the signal, turning gritty harmonic distortion into
// an even hiss. Its level tracks the step size, because dither that does not
// scale with the step does nothing at 16 bits and swamps the signal at 2.
import type { FxInstance } from '@loom/plugin-sdk';
import { crushCurve } from './curve';

/** One second of triangular-PDF noise, looped. Amplitude ±1; the gain node that
 *  plays it scales to the current quantization step. */
function makeTpdfNoise(ctx: AudioContext): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // Two uniforms summed → triangular distribution over −1..1.
    d[i] = (Math.random() - 0.5) + (Math.random() - 0.5);
  }
  return buf;
}

Loom.registerFx('bitcrusher', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const output = ctx.createGain();

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 8000;
  tone.Q.value = 0.7;

  const dry = ctx.createGain(); dry.gain.value = 0;
  const wet = ctx.createGain(); wet.gain.value = 1;

  // Dither: looping TPDF noise summed into the shaper's input. One unit of the
  // knob is ONE FULL quantization step (2 LSB peak-to-peak), which is the
  // standard TPDF amount. Half a step is not a smaller dither — it is no
  // dither: the quantizer rounds at ±step/2, so noise that never exceeds that
  // threshold rounds straight back to zero and does nothing at all.
  const noise = ctx.createBufferSource();
  noise.buffer = makeTpdfNoise(ctx);
  noise.loop = true;
  const ditherGain = ctx.createGain();
  ditherGain.gain.value = 0;
  noise.connect(ditherGain);
  try { noise.start(); } catch { /* already started */ }

  // A WaveShaperNode's curve cannot always be reassigned (node-web-audio-api
  // throws "cannot assign curve twice"), so changing `bits` swaps in a fresh
  // shaper.
  let shaper = ctx.createWaveShaper();
  const buildShaper = (b: number) => {
    const next = ctx.createWaveShaper();
    next.curve = crushCurve(b);
    next.oversample = 'none';                // crushing WANTS the aliasing
    // Signal AND dither noise both land on the shaper input, so the noise is
    // present at the moment of quantization — which is the whole point.
    input.connect(next); ditherGain.connect(next); next.connect(tone);
    try {
      input.disconnect(shaper); ditherGain.disconnect(shaper); shaper.disconnect();
    } catch { /* first build */ }
    shaper = next;
  };

  // input → dry → out ; (input + dither) → shaper → tone → wet → out.
  input.connect(dry).connect(output);
  tone.connect(wet).connect(output);
  buildShaper(8);

  let bits = 8, toneHz = 8000, mix = 1, dither = 0;

  /** Step size of the current bit depth, in the shaper's −1..1 domain. */
  const stepFor = (b: number) => 2 / (Math.max(2, Math.pow(2, b)) - 1);
  const applyDither = () => { ditherGain.gain.value = dither * stepFor(bits); };

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>([
      ['tone', tone.frequency],
      ['mix', wet.gain],
    ]),
    getBaseValue: (id) =>
      id === 'bits' ? bits : id === 'tone' ? toneHz : id === 'mix' ? mix
      : id === 'dither' ? dither : 0,
    setBaseValue: (id, v) => {
      // A new bit depth means a new step size, so the dither level must follow.
      if (id === 'bits')   { bits = v; buildShaper(v); applyDither(); }
      if (id === 'tone')   { toneHz = v; tone.frequency.value = v; }
      if (id === 'mix')    { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
      if (id === 'dither') { dither = v; applyDither(); }
    },
    applyPreset: () => {},
    dispose: () => {
      try { noise.stop(); } catch { /* never started */ }
      for (const n of [input, output, shaper, tone, dry, wet, noise, ditherGain]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
});
