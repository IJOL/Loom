// plugins/flanger/main.ts — a very short base delay swept by an LFO, WITH
// feedback. The comb notches sweep and the feedback sharpens them into the
// metallic jet. What it IS lives in plugin.json.
//
// Same graph as the chorus next door (the SDK's `createModulatedDelay`) and
// only the three numbers differ: a delay short enough that the comb lands in
// the audible range, a sweep that stays close to it, and a feedback ceiling
// under 1 so the resonance sharpens without running away.
import { createModulatedDelay, type FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('flanger', (ctx): FxInstance => createModulatedDelay(ctx, {
  baseDelaySec: 0.002,   // ~2 ms — the jet region
  sweepSec: 0.0018,      // sweep close to the base, staying short
  maxFeedback: 0.9,      // feedback: sharpens the comb, kept under 1 to stay stable
}));
