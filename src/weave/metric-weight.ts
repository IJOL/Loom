// How strongly a position is felt in the bar.
//
// This is what decides the ORDER in which two patterns hand over during a
// crossfade: the weak positions swap first and the downbeat swaps last, so the
// bar never loses its shape halfway across. Without it the hand-over would be
// arbitrary and the groove would fall apart in the middle of every transition.

import { TICKS_PER_STEP } from '../core/notes';

/** 0..1. A position off the sixteenth grid is the weakest thing there is —
 *  nothing lands there deliberately in this library, so anything that does is
 *  ornament and goes first. */
export function metricWeight(tick: number, barTicks: number): number {
  // A negative tick is the bar before, not an error: the scheduler works in
  // absolute time and a look-ahead window can reach back across a loop edge.
  const inBar = ((tick % barTicks) + barTicks) % barTicks;
  if (inBar % TICKS_PER_STEP !== 0) return 0.28;

  const s = inBar / TICKS_PER_STEP;
  if (s === 0) return 1;
  // The middle of the bar — the "three" in 4/4 — is the second strongest place
  // there is, and derived from the meter rather than hard-coded to step 8, so a
  // bar that is not sixteen steps long still has one.
  if (s === Math.floor(barTicks / TICKS_PER_STEP / 2)) return 0.9;
  if (s % 4 === 0) return 0.72;
  if (s % 2 === 0) return 0.5;
  return 0.28;
}

// FLOOR and SPAN are pinned by a requirement, not chosen for taste:
//   FLOOR + SPAN * 1 = 0.86 < 1   → the strongest A hit still survives x just
//                                   under 1, so nothing leaves early
//   (1 - FLOOR) - SPAN * 1 = 0.14 > 0 → the strongest B hit still waits for x
//                                   just over 0, so nothing arrives early
// Together they are what makes x = 0 exactly A and x = 1 exactly B. Widen SPAN
// past 0.86 and the extremes stop being the pure patterns.
const FLOOR = 0.14;
const SPAN = 0.72;

/** A hit of A sounds while `x < leavesAt(...)`. Stronger hits hold out longer. */
export function leavesAt(tick: number, barTicks: number): number {
  return FLOOR + SPAN * metricWeight(tick, barTicks);
}

/** A hit of B sounds once `x > entersAt(...)`. Stronger hits arrive sooner.
 *  Deliberately the mirror of leavesAt — what is last to go is first to come,
 *  so the two patterns hand over symmetrically rather than one crowding out
 *  the other. */
export function entersAt(tick: number, barTicks: number): number {
  return (1 - FLOOR) - SPAN * metricWeight(tick, barTicks);
}
