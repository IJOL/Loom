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

/** Beats per bar for sync math. 4/4 assumption — matches the legacy ratio map
 *  (where 4/1 = 4 bars = 16 beats). */
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
  // Legacy: the preset ratio string (old saves before syncBars).
  if (state.syncRatio) return beatHz * (SYNC_RATIO_MAP[state.syncRatio] ?? 1);
  return state.rateHz ?? 1;
}

/** Parse a legacy ratio label ('4/1', '1/8T', '1/4.') into bars-per-cycle +
 *  subdivision, so old saves migrate to the numeric model exactly. Returns
 *  null for unrecognised labels. */
export function parseSyncRatioToBars(
  ratio: string,
): { bars: number; subdiv: 'straight' | 'triplet' | 'dotted' } | null {
  const m = /^(\d+)\/(\d+)([T.]?)$/.exec(ratio.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (!d) return null;
  const subdiv = m[3] === 'T' ? 'triplet' : m[3] === '.' ? 'dotted' : 'straight';
  return { bars: n / d, subdiv };
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
