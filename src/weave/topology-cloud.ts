// Four loops at the corners of a square, weighted by where the dot sits.
// Plain bilinear interpolation, which is what makes an edge behave like a
// two-loop crossfade and a corner behave like no crossfade at all.
//
// Known and accepted: with four rhythms in play the intersection of all four is
// usually empty, so the shared skeleton the crossfade leans on thins out and
// percussion tends towards mush. It earns its place on melodic material, and
// the per-lane selector is what lets the user decide rather than the code
// deciding for them.

import type { LoopRef, LoopWeight } from './topology-types';

export interface CloudState {
  /** top-left, top-right, bottom-left, bottom-right. */
  corners: [LoopRef, LoopRef, LoopRef, LoopRef];
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function cloudWeights(s: CloudState): LoopWeight[] {
  // A dot dragged outside the box would otherwise produce a negative weight on
  // the near corner and one above 1 on the far one -- the blend would weight a
  // loop it should never reach.
  const x = clamp01(s.x);
  const y = clamp01(s.y);

  const weights = [
    (1 - x) * (1 - y),
    x * (1 - y),
    (1 - x) * y,
    x * y,
  ];
  return s.corners.map((c, i) => ({ notes: c.notes, weight: weights[i] }));
}
