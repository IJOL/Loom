// src/plugins/fx/chorus.ts
// Chorus — a longer base delay swept by the LFO, no feedback. Detuned copies of
// the signal thicken it into a small ensemble. Built on the shared modulated
// delay (native Web Audio), see modulated-delay.ts.
import { makeModulatedDelayPlugin } from './modulated-delay';

export const chorusPlugin = makeModulatedDelayPlugin({
  id: 'chorus',
  name: 'Chorus',
  baseDelaySec: 0.018,   // ~18 ms — the ensemble region
  sweepSec: 0.006,       // ±a few ms of detune
  maxFeedback: 0,        // no feedback: thickening, not resonance
});
