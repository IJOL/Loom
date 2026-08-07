// A delay line whose time an LFO wobbles, mixed back with the dry signal — the
// graph a chorus and a flanger both ARE. Two effects differ only by the numbers
// they hand it:
//
//   chorus  — a longer base delay (~18 ms), no feedback: many slightly-detuned
//             copies, a thickening. The name is the sound of a small ensemble.
//   flanger — a very short base delay (~2 ms) WITH feedback: the comb notches
//             sweep, and the feedback sharpens them into the metallic jet.
//
// ⚠️ This is NOT the same kind of thing as the per-sample kernels next to it in
// this folder. `osc`, `ladder`, `filter`, `unison`, `fold`, `comb` and
// `reverb-ir` are pure maths that run inside the AudioWorklet with no
// AudioContext in sight. This one BUILDS NATIVE WEB AUDIO NODES and can only
// run on the main thread, because that is what an insert is in Loom. Importing
// it into a renderer will not work.
import type { FxInstance } from '../fx';

/** What a caller must decide to turn this graph into a specific effect. Numbers
 *  only: the id, the display name and the rack colour are manifest concerns and
 *  live in the plugin's own `plugin.json`. */
export interface ModulatedDelaySpec {
  /** Centre of the LFO sweep, in seconds. */
  baseDelaySec: number;
  /** How far depth 1 moves the delay time, in seconds. */
  sweepSec: number;
  /** 0 for a chorus; a flanger's resonance ceiling. A spec of 0 wires no
   *  feedback path at all, so a `feedback` write is refused rather than
   *  silently landing on a node nothing is listening to. */
  maxFeedback: number;
}

/** Param defaults, exported so a manifest and this graph cannot drift apart
 *  about what a fresh instance sounds like. */
export const MODULATED_DELAY_DEFAULTS = { rate: 0.8, depth: 0.6, feedback: 0.4, mix: 0.5 } as const;

export function createModulatedDelay(ctx: AudioContext, spec: ModulatedDelaySpec): FxInstance {
  const d = MODULATED_DELAY_DEFAULTS;

  const input  = ctx.createGain();
  const output = ctx.createGain();
  const delay  = ctx.createDelay(1);
  delay.delayTime.value = spec.baseDelaySec;

  // LFO → sweep the delay time around its base. Audio-rate source summed onto
  // the delayTime AudioParam.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = d.rate;
  const sweep = ctx.createGain();
  sweep.gain.value = spec.sweepSec * 0.6;
  lfo.connect(sweep).connect(delay.delayTime);
  lfo.start();

  const fb = ctx.createGain();
  fb.gain.value = spec.maxFeedback > 0 ? d.feedback * spec.maxFeedback : 0;

  const dry = ctx.createGain(); dry.gain.value = 1 - d.mix;
  const wet = ctx.createGain(); wet.gain.value = d.mix;

  // Graph: input → dry → out ; input → delay → wet → out ; delay → fb → delay.
  input.connect(dry).connect(output);
  input.connect(delay);
  delay.connect(wet).connect(output);
  if (spec.maxFeedback > 0) delay.connect(fb).connect(delay);

  // Annotated, not inferred: MODULATED_DELAY_DEFAULTS is `as const`, so an
  // inferred local would take the LITERAL type (0.8, 0.6…) and setBaseValue's
  // `number` could not be assigned to it.
  let rate: number = d.rate, depth: number = d.depth,
      feedback: number = d.feedback, mix: number = d.mix;
  const applyDepth = () => { sweep.gain.value = spec.sweepSec * depth * 0.6; };
  const applyMix   = () => { wet.gain.value = mix; dry.gain.value = 1 - mix; };

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>([
      ['rate', lfo.frequency],
      ['mix', wet.gain],
    ]),
    getBaseValue: (id) =>
      id === 'rate' ? rate : id === 'depth' ? depth
      : id === 'feedback' ? feedback : id === 'mix' ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === 'rate')     { rate = v; lfo.frequency.value = v; }
      if (id === 'depth')    { depth = v; applyDepth(); }
      if (id === 'feedback' && spec.maxFeedback > 0) { feedback = v; fb.gain.value = v * spec.maxFeedback; }
      if (id === 'mix')      { mix = v; applyMix(); }
    },
    applyPreset: () => {},
    dispose: () => {
      try { lfo.stop(); } catch { /* already stopped */ }
      for (const n of [input, output, delay, lfo, sweep, fb, dry, wet]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
}
