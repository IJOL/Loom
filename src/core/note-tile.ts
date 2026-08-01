// Repeat a clip's content across a new length — what has to happen to everything
// you drew by hand when something else resizes the clip under you.
//
// Growing a 2-bar clip to 5 because a 5-step cycle needs it would otherwise leave
// the hats in the first two bars and three bars of silence after them: the clip
// no longer joins end to start, which was the whole point of growing it. So the
// old length becomes the period and the block repeats to fill the new one.
// Shrinking is the same rule read backwards — what falls outside is dropped.

import type { NoteEvent } from './notes';

/**
 * `notes` repeated every `periodTicks` until `totalTicks`.
 *
 * The first period is the source; a final partial period keeps only the notes
 * that start inside it. Shrinking (total < period) just drops what no longer
 * fits. Equal lengths are the identity.
 */
export function tileNotesToLength(
  notes: readonly NoteEvent[],
  periodTicks: number,
  totalTicks: number,
): NoteEvent[] {
  const total = Math.max(0, totalTicks);
  const inside = notes.filter((n) => n.start < Math.min(periodTicks || total, total));
  if (periodTicks <= 0 || total <= periodTicks) return inside;

  const out = [...inside];
  for (let offset = periodTicks; offset < total; offset += periodTicks) {
    for (const n of inside) {
      if (n.start + offset < total) out.push({ ...n, start: n.start + offset });
    }
  }
  return out;
}
