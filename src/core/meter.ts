// Global time signature (session meter) — the single source of truth for how a
// bar maps onto the tick grid. Timing lives in ticks (TICKS_PER_QUARTER = 96);
// one whole note = 384 ticks. A bar of num/den = num * (384/den) ticks.
//
// Allowed denominators are the powers of two that divide 384, which guarantees
// an integer number of 16th-steps per bar (the grid the editors draw on).

import { TICKS_PER_QUARTER, TICKS_PER_STEP } from './notes';

export interface TimeSignature {
  num: number; // beats per bar (1..16)
  den: number; // beat unit; one of 2, 4, 8, 16
}

export const DEFAULT_METER: TimeSignature = { num: 4, den: 4 };
export const ALLOWED_DENOMINATORS: readonly number[] = [2, 4, 8, 16];

/** Common meters, in dropdown order. 4/4 first so it is the default selection. */
export const COMMON_METERS: readonly TimeSignature[] = [
  { num: 4, den: 4 }, { num: 3, den: 4 }, { num: 2, den: 4 }, { num: 5, den: 4 },
  { num: 6, den: 8 }, { num: 7, den: 8 }, { num: 9, den: 8 }, { num: 12, den: 8 },
];

const TICKS_PER_WHOLE = TICKS_PER_QUARTER * 4; // 384

export function ticksPerBar(m: TimeSignature): number {
  return (m.num * TICKS_PER_WHOLE) / m.den;
}
export function quartersPerBar(m: TimeSignature): number {
  return ticksPerBar(m) / TICKS_PER_QUARTER;
}
export function stepsPerBar(m: TimeSignature): number {
  return ticksPerBar(m) / TICKS_PER_STEP;
}
export function stepsPerBeat(m: TimeSignature): number {
  return (TICKS_PER_WHOLE / m.den) / TICKS_PER_STEP;
}

/** Coerce arbitrary input into a valid meter (num 1..16, den in {2,4,8,16}). */
export function clampMeter(m: TimeSignature): TimeSignature {
  const den = ALLOWED_DENOMINATORS.includes(m.den) ? m.den : 4;
  const num = Number.isFinite(m.num) ? Math.max(1, Math.min(16, Math.round(m.num))) : 4;
  return { num, den };
}

/** Resolve a possibly-absent saved value into a valid meter (default 4/4). */
export function resolveMeter(saved: Partial<TimeSignature> | null | undefined): TimeSignature {
  if (!saved) return { ...DEFAULT_METER };
  return clampMeter({ num: saved.num ?? 4, den: saved.den ?? 4 });
}

export function formatMeter(m: TimeSignature): string {
  return `${m.num}/${m.den}`;
}

/** Parse a "num/den" label back into a clamped meter; garbage ⇒ 4/4. */
export function meterFromLabel(label: string): TimeSignature {
  const parts = label.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!Number.isFinite(num) || !Number.isFinite(den)) return { ...DEFAULT_METER };
  return clampMeter({ num, den });
}
