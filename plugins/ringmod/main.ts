// plugins/ringmod/main.ts — a ring modulator, and the smallest complete example
// of a Loom insert.
//
// Everything an insert must do is here and nothing else is: plugin.json says
// what it is called and what knobs it has, this file says how to build its
// nodes, and the two meet through Loom.registerFx. There is no manifest in this
// file — the host already read and validated the one on disk.
//
// The DSP is a multiplication. A GainNode's gain is an AudioParam, so an
// oscillator connected to it ADDS to that param's value; set the value to 0 and
// the gain becomes the oscillator's signal, which means the audio passing
// through comes out multiplied by it. That is all a ring modulator is: it
// replaces a 440 Hz tone with the sum and difference of 440 and the carrier, so
// the original pitch disappears and what is left is inharmonic — bells, metal,
// robot voices.
import type { FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('ringmod', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const output = ctx.createGain();

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = 300;
  carrier.start();

  // The multiplier. Its own gain sits at 0 so the carrier IS the gain.
  const ring = ctx.createGain();
  ring.gain.value = 0;
  carrier.connect(ring.gain);

  const dry = ctx.createGain(); dry.gain.value = 0;
  const wet = ctx.createGain(); wet.gain.value = 1;

  input.connect(dry).connect(output);
  input.connect(ring).connect(wet).connect(output);

  let mix = 1;

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>([
      // DETUNE, not frequency, and the reason is the whole difference between a
      // modulation destination that works and one that looks like it does. A
      // modulator's depth is scaled by the declared range, and an undeclared one
      // falls back to 0..1 — so publishing `carrier.frequency` over a 20-4000 Hz
      // knob gave a full-depth LFO a swing of ±1 Hz out of 3980. Cents are
      // additive and perceptually even, which is what the SDK's own note on this
      // says and what the auto-wah and the multifilter already do.
      ['freq', carrier.detune],
      ['mix', wet.gain],
    ]),
    getAudioParamRange: (id) =>
      // ±4 octaves in cents: at full depth the carrier sweeps the audible span
      // the knob covers, instead of a rounding error.
      id === 'freq' ? { min: 0, max: 4800 } : id === 'mix' ? { min: 0, max: 1 } : undefined,
    getBaseValue: (id) =>
      id === 'freq' ? carrier.frequency.value : id === 'mix' ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === 'freq') carrier.frequency.value = v;
      if (id === 'mix')  { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
    },
    applyPreset: () => {},
    dispose: () => {
      try { carrier.stop(); } catch { /* already stopped */ }
      for (const n of [input, output, carrier, ring, dry, wet]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
});
