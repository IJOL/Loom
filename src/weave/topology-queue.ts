// A cursor over an ordered list: always a crossfade between the two loops the
// cursor sits between.
//
// Finite where A-to-B is endless -- the end of the list is the end of the
// journey -- but walkable backwards, which A-to-B is not. That is the trade,
// and it is why both exist rather than one replacing the other.

import type { LoopRef, LoopWeight } from './topology-types';

export interface QueueState {
  loops: LoopRef[];
  /** 0..1 across the whole queue. */
  x: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function queueWeights(s: QueueState): LoopWeight[] {
  const n = s.loops.length;
  if (n === 0) return [];
  // A queue of one has no span to travel: n - 1 would be zero below.
  if (n === 1) return [{ notes: s.loops[0].notes, weight: 1 }];

  const pos = clamp01(s.x) * (n - 1);
  // Cap at n - 2 so the pair is always (i, i + 1) and the last loop can reach
  // full weight without the index running past the end of the list.
  const i = Math.min(n - 2, Math.floor(pos));
  const frac = pos - i;

  return s.loops.map((l, k) => ({
    notes: l.notes,
    weight: k === i ? 1 - frac : k === i + 1 ? frac : 0,
  }));
}
