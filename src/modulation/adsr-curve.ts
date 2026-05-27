// src/modulation/adsr-curve.ts
// Pure JS mirror of the ADSR curve scheduled into the audio graph.
// Output is unipolar 0..1. The audio side uses linearRampToValueAtTime;
// this helper does the same linear math for UI animation polling.

import type { ModulatorState } from './types';

export function computeAdsrAt(
  t: number,           // seconds since trigger
  state: ModulatorState,
  gateDuration: number,
): number {
  const a = Math.max(0.001, state.attackSec ?? 0.01);
  const d = Math.max(0.001, state.decaySec  ?? 0.1);
  const s = Math.min(1, Math.max(0, state.sustain ?? 0.7));
  const r = Math.max(0.001, state.releaseSec ?? 0.3);

  if (t <= 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);

  const releaseStart = Math.max(a + d, gateDuration);
  if (t < releaseStart) return s;
  const rt = t - releaseStart;
  if (rt >= r) return 0;
  return s * (1 - rt / r);
}
