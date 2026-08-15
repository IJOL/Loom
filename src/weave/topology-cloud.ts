// Four loops at the corners of a square, weighted by where the dot sits.
// Plain bilinear interpolation, which is what makes an edge behave like a
// two-loop crossfade and a corner behave like no crossfade at all.
//
// Known and accepted: with four rhythms in play the intersection of all four is
// usually empty, so the shared skeleton the crossfade leans on thins out and
// percussion tends towards mush. It earns its place on melodic material, and
// the per-lane selector is what lets the user decide rather than the code
// deciding for them.

import type { CloudPath } from '@loom/plugin-sdk';
import type { LoopRef, LoopWeight } from './topology-types';

export interface CloudState {
  /** top-left, top-right, bottom-left, bottom-right. */
  corners: [LoopRef, LoopRef, LoopRef, LoopRef];
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How the master flow drags the dot around the square.
 *
 *  It needs a path at all because the flow is ONE number and the cloud is two.
 *  Until this existed the flow wrote x and left y alone, so a travelling cloud
 *  slid back and forth along whatever horizontal line the dot happened to be on
 *  — three of the four corners unreachable, and the topology reading as broken
 *  rather than as unfinished.
 *
 *  'rim' is the plain answer: the four sides, so the dot spends its whole lap on
 *  an EDGE, where the cloud behaves as a two-loop crossfade and each corner
 *  arrives as a clean solo.
 *
 *  'cross' is the other musical shape: side, diagonal, side, diagonal. It also
 *  touches all four corners, but it passes through the middle twice — the only
 *  point where all four loops sound at once — so the lap alternates between
 *  handing over cleanly and piling everything up.
 *
 *  Declared in the SDK, because the panel RENDERS the choice and this file
 *  WALKS it — the two have to agree on the words. */
export type { CloudPath };

const TL = [0, 0], TR = [1, 0], BL = [0, 1], BR = [1, 1];

/** Four legs per path, a quarter of the lap each.
 *
 *  Equal TIME, not equal length: a diagonal is longer than a side, so the dot
 *  crosses the middle faster than it walks an edge. That is the right way round
 *  musically — the middle is where all four loops pile up, and lingering there
 *  is the mush this file's header warns about. */
const LEGS: Record<CloudPath, number[][][]> = {
  rim:   [[TL, TR], [TR, BR], [BR, BL], [BL, TL]],
  cross: [[TL, TR], [TR, BL], [BL, BR], [BR, TL]],
};

/** Where a lane sits in its square, `t` of the way through its lap.
 *
 *  Pure: `t` is folded into 0..1 here rather than trusted, because the caller
 *  is a clock and 1 is a position it can legitimately produce. */
export function cloudPathPoint(path: CloudPath | undefined, t: number): { x: number; y: number } {
  const legs = LEGS[path ?? 'rim'] ?? LEGS.rim;
  const { leg, k } = legAndPhase(path, t);
  const [from, to] = legs[leg];
  return { x: from[0] + (to[0] - from[0]) * k, y: from[1] + (to[1] - from[1]) * k };
}

/** How many legs every path has. Four because a square has four corners, and
 *  both shapes visit all of them — that is what makes a leg the cloud's unit of
 *  travel and not just an implementation detail of the drawing. */
export const CLOUD_LEGS = 4;

function legAndPhase(path: CloudPath | undefined, t: number): { leg: number; k: number } {
  const legs = LEGS[path ?? 'rim'] ?? LEGS.rim;
  const f = Number.isFinite(t) ? ((t % 1) + 1) % 1 : 0;
  const leg = Math.min(legs.length - 1, Math.floor(f * legs.length));
  return { leg, k: f * legs.length - leg };
}

/** Which leg of its path the dot is walking, 0..3.
 *
 *  A leg is the cloud's A→B: it leaves one corner and arrives at the next, by a
 *  side or by a diagonal depending on the path, and everywhere along it the two
 *  ends are the only loops that matter. Crossing into a new one is therefore the
 *  same event as an A→B lap, which is what a lane evolving hangs its draw on. */
export function cloudLegAt(path: CloudPath | undefined, t: number): number {
  return legAndPhase(path, t).leg;
}

/** The corner a leg SETS OFF from, as an index into `corners` — the [TL, TR, BL,
 *  BR] order the state is stored in.
 *
 *  A coordinate is turned into that index rather than the pairs being listed
 *  again: `x + 2y` IS the order, and a second table of which corner is which is
 *  the kind that ends up disagreeing with the first. */
export function cloudLegOrigin(path: CloudPath | undefined, leg: number): number {
  const legs = LEGS[path ?? 'rim'] ?? LEGS.rim;
  const [from] = legs[((leg % legs.length) + legs.length) % legs.length];
  return from[0] + 2 * from[1];
}

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
