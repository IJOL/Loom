// A to B, and when you arrive B becomes the new A and a fresh B is drawn.
//
// The journey never ends and never returns to where it started, which is the
// whole point: a queue eventually runs out, and running out is exactly the
// "static on purpose" this panel exists to avoid.

import type { LoopRef, LoopWeight } from './topology-types';

export interface AbState {
  a: LoopRef;
  b: LoopRef;
  /** 0..1 across the current leg. */
  x: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function abWeights(s: AbState): LoopWeight[] {
  const x = clamp01(s.x);
  return [
    { notes: s.a.notes, weight: 1 - x },
    { notes: s.b.notes, weight: x },
  ];
}

/** What a re-hook operates on: the two loop IDS and the position.
 *
 *  Ids, not `LoopRef`s. This used to take the resolved shape — refs with their
 *  notes — and that is why it sat with a test and no caller for so long: what a
 *  lane STORES is a pair of ids, so a function written against the resolved
 *  layer had nothing to be called from. */
export interface AbLegIds {
  a: string;
  b: string;
  x: number;
}

/** Advance the leg, re-hooking on arrival.
 *
 *  `pick` returns an index into the candidate list. It is injected rather than
 *  reaching for Math.random inside so the draw is deterministic in a test — and
 *  so a caller can seed it and get the same journey twice. */
export function abAdvance<T extends AbLegIds>(
  s: T, x: number, pool: readonly string[], pick: (n: number) => number,
): T {
  if (x < 1) return { ...s, x: clamp01(x) };

  const arrived = s.b;
  // Drawing the loop that just became A would make the next leg a crossfade
  // from a loop to itself: the fader would move and nothing would happen.
  const candidates = pool.filter((id) => id !== arrived);
  if (candidates.length === 0) {
    // Nothing else to go to. Staying put is honest -- better a loop that
    // repeats than a lane that falls silent.
    return { ...s, a: arrived, b: arrived, x: 0 };
  }
  const i = Math.min(candidates.length - 1, Math.max(0, Math.floor(pick(candidates.length))));
  return { ...s, a: arrived, b: candidates[i], x: 0 };
}
