// The MATERIAL, read as a pool.
//
// What the generator draws from is a blended bar — the same `(loop, weight)[]`
// fold the weave hands `blendLoops`, resolved through the same door. This turns
// that bar into the thing a read head can index: the pitches it states, in the
// order it states them.
//
// The bar's RHYTHM is deliberately dropped. Where the notes fall is CADENCE's
// question and CADENCE has not been built yet; until it is, the generator fires
// on the beat. Reading the material's rhythm too would make the generator a
// slightly-worse way of playing the loop, which is not what it is for.

import type { NoteEvent } from '../core/notes';

/** One entry in the pool: a pitch, and how hard the material said it. */
export interface PoolNote {
  midi: number;
  velocity: number;
}

/** The pitches some material states, in the order it states them.
 *
 *  Duplicates are KEPT. A bassline that hits its root eight times has one
 *  pitch and eight statements of it, and a pool that deduplicated would read
 *  that as the same material as a single sustained root — which it plainly is
 *  not once anything starts walking it at a different period.
 *
 *  Simultaneities are ordered low to high. A chord has no order in time, so one
 *  has to be chosen, and low-first is the one an arpeggiator would pick — but
 *  the reason it is chosen at all is determinism: `sort` on equal starts would
 *  otherwise leave the pool at the mercy of the fold's emission order, and a
 *  render from bar 5 could disagree with the same bar reached by playing. */
export function pitchPool(notes: readonly NoteEvent[]): PoolNote[] {
  return [...notes]
    .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.midi))
    .sort((a, b) => (a.start - b.start) || (a.midi - b.midi))
    .map((n) => ({ midi: n.midi, velocity: n.velocity }));
}
