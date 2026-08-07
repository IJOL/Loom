// The ring's caption target, recorded where the launch happens.
//
// It cannot be derived from lane states alone: a scene with a single lane in
// it looks exactly like a lone clip launch, and would get captioned with the
// clip's name instead of the scene's. So the launch sites record it.
//
// The record carries the boundary it was made against and is only honoured
// while that boundary is still the pending one. That makes it self-expiring:
// no stop/seek/undo seam has to remember to clear it.

import type { LanePlayState } from './session-runtime';

export interface QueuedLabel {
  label: string;
  boundary: number;
}

const EPS = 1e-6;

export function queuedLabelFor(
  rec: QueuedLabel | null,
  laneStates: Map<string, LanePlayState>,
): string | null {
  if (!rec) return null;
  let nearest = Infinity;
  for (const lp of laneStates.values()) {
    if (lp.queued && lp.queuedBoundary < nearest) nearest = lp.queuedBoundary;
  }
  if (nearest === Infinity) return null;
  return Math.abs(nearest - rec.boundary) <= EPS ? rec.label : null;
}
