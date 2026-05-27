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
