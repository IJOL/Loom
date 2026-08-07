// Deliberately less than harmony.
//
// Loom does not know what a chord is and this does not teach it. All it does is
// forbid the intervals that genuinely sound wrong against whatever the leading
// lane's lowest note is right now, and nudge the offender to a neighbouring
// scale degree.
//
// If real harmony is ever wanted, this rule is a special case of it and does
// not have to be undone.

import type { NoteEvent } from '../core/notes';
import { inScale, type ScaleId } from '../core/musicality';

/** Minor second, tritone, major seventh — and their inversions, since the
 *  interval is measured within the octave. Everything else is left alone:
 *  the point is to catch what grates, not to police the harmony. */
const FORBIDDEN = new Set([1, 6, 11]);

const interval = (midi: number, root: number) => ((midi - root) % 12 + 12) % 12;

export function avoidClash(
  notes: NoteEvent[], rootMidi: number | null, key: number, scale: ScaleId,
): NoteEvent[] {
  // No leader means this section does nothing at all, which is the default.
  if (rootMidi === null) return notes;

  return notes.map((n) => {
    if (!FORBIDDEN.has(interval(n.midi, rootMidi))) return n;

    // Nearest first, up before down, so a nudged note stays as close to what
    // the composer wrote as the rule allows.
    for (const step of [1, -1, 2, -2]) {
      const cand = n.midi + step;
      if (!inScale(cand, key, scale)) continue;
      if (FORBIDDEN.has(interval(cand, rootMidi))) continue;
      return { ...n, midi: cand };
    }
    // No neighbour helps. The note stays: silencing it would punch a hole in
    // the part, which is worse than the clash it was trying to avoid.
    return n;
  });
}
