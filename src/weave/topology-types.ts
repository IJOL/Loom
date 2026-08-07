// What every topology speaks.
//
// A topology's whole job is to turn its own state into a list of weights; the
// blend engine knows nothing else about it. That is why A-to-B, a queue and a
// 2D cloud can coexist in the same panel, on the same lane row, for the price
// of one small file each.

import type { NoteEvent } from '../core/notes';

export type { LoopWeight } from './blend-clip';

/** A loop as a topology holds it: an identity plus its notes. The id is what
 *  lets a topology avoid handing back the loop it just arrived at. */
export interface LoopRef {
  id: string;
  notes: NoteEvent[];
}
