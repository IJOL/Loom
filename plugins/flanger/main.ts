// plugins/flanger/main.ts — a very short base delay swept by an LFO, WITH
// feedback. The comb notches sweep and the feedback sharpens them into the
// metallic jet. What it IS lives in plugin.json.
//
// Same graph as the chorus next door (the SDK's `createModulatedDelay`) and
// only the three numbers differ: a delay short enough that the comb lands in
// the audible range, a sweep that stays close to it, and a feedback ceiling
// under 1 so the resonance sharpens without running away.
import { createModulatedDelay, type FxInstance } from '@loom/plugin-sdk';

// ⚠️ THE FEEDBACK CEILING IS A LEVEL DECISION, not a stability one. A comb fed
// back at g resonates by 1/(1 − g), so 0.9 was a factor of TEN at the
// frequencies that line up with the delay: measured, with feedback at its
// maximum, depth 1 and mix 0.7, the output peaked at 5.48× the input. That is
// not instability — the level settles and does not grow, which its test checks
// by comparing the second half of the render against the first — it is simply
// enough to swamp the master on its own, with nothing in the rack to warn you.
// Turning the knob up stopped sounding like a flanger and started sounding like
// the master limiter.
//
// 0.75 puts the resonance at 4 instead of 10. The jet is still there; the top of
// the knob no longer eats the mix. This is what hardware does — the range you
// are given is the range that works.
//
// It only came to light because this effect got its first test of its own during
// the migration: before that it rode along inside the chorus's, which never
// moved the feedback knob, so nobody had ever measured its extreme.
Loom.registerFx('flanger', (ctx): FxInstance => createModulatedDelay(ctx, {
  baseDelaySec: 0.002,   // ~2 ms — the jet region
  sweepSec: 0.0018,      // sweep close to the base, staying short
  maxFeedback: 0.75,     // resonance 1/(1 − g) = 4 — see the note above
}));
