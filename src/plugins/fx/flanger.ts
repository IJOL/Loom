// src/plugins/fx/flanger.ts
// Flanger — a very short base delay swept by the LFO, WITH feedback. The comb
// notches sweep and the feedback sharpens them into the metallic jet. Built on
// the shared modulated delay (native Web Audio), see modulated-delay.ts.
import { makeModulatedDelayPlugin } from './modulated-delay';

export const flangerPlugin = makeModulatedDelayPlugin({
  id: 'flanger',
  name: 'Flanger',
  baseDelaySec: 0.002,   // ~2 ms — the jet region
  sweepSec: 0.0018,      // sweep close to the base, staying short
  maxFeedback: 0.9,      // feedback: sharpens the comb, kept under 1 to stay stable
});
