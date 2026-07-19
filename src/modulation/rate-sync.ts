// src/modulation/rate-sync.ts
// BPM-sync conversion for LFO rate.

import type { ModulatorState } from './types';

/** Beats per bar for sync math. 4/4 assumption. */
export const BEATS_PER_BAR = 4;

const SUBDIV_FACTOR: Record<string, number> = { straight: 1, triplet: 3 / 2, dotted: 2 / 3 };

export function effectiveRateHz(state: ModulatorState, bpm: number): number {
  if (!state.syncToBpm) return state.rateHz ?? 1;
  const beatHz = bpm / 60;
  // Preferred: BARS-per-cycle + subdivision (the "4" of 4/1 = 4 bars).
  if (state.syncBars != null && state.syncBars > 0) {
    const subFactor = SUBDIV_FACTOR[state.syncSubdiv ?? 'straight'] ?? 1;
    const cyclesPerBeat = subFactor / (state.syncBars * BEATS_PER_BAR);
    return beatHz * cyclesPerBeat;
  }
  return state.rateHz ?? 1;
}

// ── FREE-mode rate knob scale ──────────────────────────────────────────────
// The FREE rate knob is a 0..1 position on a LOGARITHMIC scale, so the slow
// (musically-useful) range dominates the travel. In "bpm" = LFO cycles/min
// (1 Hz = 60 bpm): 0% ≈ 0.05 bpm (one cycle ~20 min) … 100% = 1200 bpm (20 Hz).
// The first quarter stays well under 1 bpm; 50% ≈ 8 bpm. The audio-graph reads
// state.rateHz as before; only the knob's position↔Hz mapping changes.
export const FREE_RATE_MIN_HZ = 0.05 / 60;   // 0.05 bpm at 0%
export const FREE_RATE_MAX_HZ = 20;          // 1200 bpm at 100%

/** Map a 0..1 knob position to an LFO rate in Hz (pure log scale). */
export function lfoFreeRatePosToHz(pos: number): number {
  const p = Math.max(0, Math.min(1, pos));
  return FREE_RATE_MIN_HZ * Math.pow(FREE_RATE_MAX_HZ / FREE_RATE_MIN_HZ, p);
}

/** Inverse of lfoFreeRatePosToHz: map an LFO rate (Hz) back to a 0..1 knob
 *  position (used to seed the knob from a saved/preset rateHz). */
export function lfoFreeRateHzToPos(hz: number): number {
  const h = Math.max(FREE_RATE_MIN_HZ, Math.min(FREE_RATE_MAX_HZ, hz));
  return Math.log(h / FREE_RATE_MIN_HZ) / Math.log(FREE_RATE_MAX_HZ / FREE_RATE_MIN_HZ);
}
