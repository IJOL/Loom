// src/modulation/rate-sync.ts
// BPM-sync conversion for LFO rate. Cycles-per-beat map mirrors the same
// ratio set the FX delay sync uses.

import type { ModulatorState } from './types';

export const SYNC_RATIO_MAP: Record<string, number> = {
  // straight
  '4/1': 1/16, '2/1': 1/8, '1/1': 1/4, '1/2': 1/2, '1/4': 1,
  '1/8': 2,    '1/16': 4,  '1/32': 8,
  // triplet
  '1/2T': 3/4, '1/4T': 3/2, '1/8T': 3, '1/16T': 6,
  // dotted
  '1/2.': 1/3, '1/4.': 2/3, '1/8.': 4/3, '1/16.': 8/3,
};

export function effectiveRateHz(state: ModulatorState, bpm: number): number {
  if (!state.syncToBpm || !state.syncRatio) return state.rateHz ?? 1;
  const beatHz = bpm / 60;
  const cyclesPerBeat = SYNC_RATIO_MAP[state.syncRatio] ?? 1;
  return beatHz * cyclesPerBeat;
}

// ── FREE-mode rate knob scale ──────────────────────────────────────────────
// The FREE rate knob is a 0..1 position with a PIECEWISE scale so the slow,
// musically-useful range gets most of the travel. Expressed in "bpm" = LFO
// cycles per minute (1 Hz = 60 bpm):
//   • 0 .. 50%  → 0 .. 240 bpm (0 .. 4 Hz), LINEAR — so 25% = 120 bpm / 2 Hz.
//   • 50 .. 100% → 240 bpm .. 1200 bpm (4 .. 20 Hz), EXPONENTIAL.
// The audio-graph reads state.rateHz as before; only the knob's mapping changes.
export const FREE_RATE_MIN_HZ = 0.02;   // ~1 bpm floor (avoid a stopped LFO at 0%)
export const FREE_RATE_MID_HZ = 4;      // 240 bpm at the 50% breakpoint
export const FREE_RATE_MAX_HZ = 20;     // 1200 bpm at 100%

/** Map a 0..1 knob position to an LFO rate in Hz (piecewise: linear-slow,
 *  exponential-fast). */
export function lfoFreeRatePosToHz(pos: number): number {
  const p = Math.max(0, Math.min(1, pos));
  if (p <= 0.5) return Math.max(FREE_RATE_MIN_HZ, p * 2 * FREE_RATE_MID_HZ);
  return FREE_RATE_MID_HZ * Math.pow(FREE_RATE_MAX_HZ / FREE_RATE_MID_HZ, (p - 0.5) * 2);
}

/** Inverse of lfoFreeRatePosToHz: map an LFO rate (Hz) back to a 0..1 knob
 *  position (used to seed the knob from a saved/preset rateHz). */
export function lfoFreeRateHzToPos(hz: number): number {
  const h = Math.max(FREE_RATE_MIN_HZ, Math.min(FREE_RATE_MAX_HZ, hz));
  if (h <= FREE_RATE_MID_HZ) return h / (2 * FREE_RATE_MID_HZ);
  return 0.5 + Math.log(h / FREE_RATE_MID_HZ) / Math.log(FREE_RATE_MAX_HZ / FREE_RATE_MID_HZ) / 2;
}
