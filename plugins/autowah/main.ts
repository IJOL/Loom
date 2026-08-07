// plugins/autowah/main.ts — a bandpass filter whose frequency follows how hard
// you play. The wah of a funk guitar and of an acid bassline, without a pedal.
// What it IS lives in plugin.json.
//
// ⚠️ THE FOLLOWER DRIVES `detune`, IN CENTS — NOT `frequency`, IN HERTZ.
// This is the rule filter modulation already follows in Loom, and the reason is
// audibility: a control summed onto `frequency` adds a fixed number of Hz, so
// the same movement that sweeps two octaves at 100 Hz is inaudible at 2 kHz.
// Cents are multiplicative, so the sweep is the same musical distance wherever
// the base sits. `range` is therefore declared in cents (4800 = four octaves),
// not in Hz. If you ever "simplify" this to frequency, the knob will feel dead
// everywhere except the very bottom.
import { createEnvelopeFollower, type FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('autowah', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const output = ctx.createGain();

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 300;
  filter.Q.value = 4;

  const follower = createEnvelopeFollower(ctx, { attackMs: 10, releaseMs: 120 });
  // The follower reads the signal BEFORE the filter — it should respond to what
  // you played, not to what the filter has already let through, which would
  // feed back on itself.
  input.connect(follower.input);

  // The follower's 0..1 control scaled into cents of detune.
  const depth = ctx.createGain();
  depth.gain.value = 2400 * 0.6;               // range * sens
  follower.output.connect(depth).connect(filter.detune);

  const dry = ctx.createGain(); dry.gain.value = 0;
  const wet = ctx.createGain(); wet.gain.value = 1;

  input.connect(dry).connect(output);
  input.connect(filter).connect(wet).connect(output);

  let sens = 0.6, range = 2400, base = 300, attack = 10, release = 120, q = 4, mix = 1;
  const applyDepth = () => { depth.gain.value = range * sens; };

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>([
      ['base', filter.detune],
      ['q', filter.Q],
      ['mix', wet.gain],
    ]),
    getAudioParamRange: (id) => {
      // Modulating the base rides the same detune the follower does, so its
      // span is stated in cents for the same reason.
      if (id === 'base') return { min: 0, max: 4800 };
      if (id === 'q')    return { min: 0, max: 12 };
      return undefined;
    },
    getBaseValue: (id) =>
      id === 'sens' ? sens : id === 'range' ? range : id === 'base' ? base
      : id === 'attack' ? attack : id === 'release' ? release
      : id === 'q' ? q : id === 'mix' ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === 'sens')    { sens = v; applyDepth(); }
      if (id === 'range')   { range = v; applyDepth(); }
      if (id === 'base')    { base = v; filter.frequency.value = v; }
      if (id === 'attack')  { attack = v; follower.setAttack(v); }
      if (id === 'release') { release = v; follower.setRelease(v); }
      if (id === 'q')       { q = v; filter.Q.value = v; }
      if (id === 'mix')     { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
    },
    applyPreset: () => {},
    dispose: () => {
      follower.dispose();
      for (const n of [input, output, filter, depth, dry, wet]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
});
