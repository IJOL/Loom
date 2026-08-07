// plugins/chorus/main.ts — a longer base delay swept by an LFO, no feedback.
// Detuned copies of the signal thicken it into a small ensemble, which is what
// the name means. What it IS lives in plugin.json.
//
// The graph is the SDK's `createModulatedDelay`: a chorus and a flanger are the
// same circuit with different numbers, and the SDK is where two plugins can
// share one. Everything that makes this a CHORUS rather than a flanger is the
// three values below — a delay long enough to read as an ensemble rather than a
// comb, a gentle sweep, and no feedback at all.
import { createModulatedDelay, type FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('chorus', (ctx): FxInstance => createModulatedDelay(ctx, {
  baseDelaySec: 0.018,   // ~18 ms — the ensemble region
  sweepSec: 0.006,       // ±a few ms of detune
  maxFeedback: 0,        // no feedback: thickening, not resonance
}));
