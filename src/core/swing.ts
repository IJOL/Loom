// Swing: the shuffle feel, as a pure warp of the clip's tick grid.
//
// `swing` delays each OFF-beat 16th by `swing × one 16th step`. 0 = straight.
// Reading it as "how far along the 8th-note pair the off-beat sits" gives the
// familiar MPC swing percentage — 50·(1 + swing):
//
//   0     → 50%   straight
//   1/3   → 66.7% the classic triplet shuffle
//   0.5   → 75%   a heavy shuffle
//   0.6   → 80%   SWING_MAX, the hardest limp Loom offers
//
// The on-beats are the fixed anchors and the off-beat is dragged between them,
// so the map is applied to the WHOLE grid, not just to notes that happen to sit
// exactly on a 16th: a 32nd, an imported MIDI note or an off-grid drum hit is
// carried along with the beat it belongs to instead of being left behind by it.

import { TICKS_PER_STEP } from './notes';

/** Past 1.0 the off-beat would reach the next on-beat and the warp would stop
 *  being order-preserving. 0.6 keeps a wide, musical range well clear of that;
 *  index.html's `max` is set from this constant, never hardcoded. */
export const SWING_MAX = 0.6;

export function clampSwing(swing: number): number {
  return Math.max(0, Math.min(SWING_MAX, swing));
}

/**
 * Map a clip-tick position onto the swung grid: piecewise-linear within each
 * 8th-note pair, stretching the on-beat half and compressing the off-beat half.
 * Strictly increasing, so no two notes can ever swap order.
 */
export function swungTick(tick: number, swing: number): number {
  const s = clampSwing(swing);
  if (s === 0) return tick;
  const pairTicks = TICKS_PER_STEP * 2;
  const pairStart = Math.floor(tick / pairTicks) * pairTicks;
  const u = tick - pairStart;
  return u <= TICKS_PER_STEP
    ? pairStart + u * (1 + s)
    : pairStart + TICKS_PER_STEP * (1 + s) + (u - TICKS_PER_STEP) * (1 - s);
}

/**
 * A note's gate length on the swung grid. The note's END travels through the
 * same warp as its start — that is what keeps a TB-303 slide sliding: its gate
 * is 1.5 steps so it must still be open when the next (now delayed) step fires,
 * and since the warp is monotonic, an overlap that exists straight survives at
 * every swing.
 */
export function swungSpan(start: number, duration: number, swing: number): number {
  if (clampSwing(swing) === 0) return duration;
  return swungTick(start + duration, swing) - swungTick(start, swing);
}
