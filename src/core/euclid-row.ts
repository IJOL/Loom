// Pure glue between the Euclidean generator and the drum grid's row model:
// paint ONE row's rhythm, leave the rest of the clip alone. Row-addressed (not
// midi-addressed) because a row owns more than one midi — GM's 35 and 36 both
// draw on KICK, so replacing the row means clearing its aliases too — and
// because a sample kit's pad row has no DrumVoice at all.

import { euclidNotesAt, type EuclidCycle } from './euclid';
import type { NoteEvent } from './notes';
import type { DrumRows } from './drum-grid-editing';

/** Zero hits means "this row isn't generating", NOT "silence this row": the
 *  fields start empty on every row, so any other reading would wipe hand-drawn
 *  hits the moment the user touched steps or rotate. Clearing a row is the
 *  eraser's job. A cycle with no steps has nothing to say either. */
const generates = (spec: EuclidCycle): boolean =>
  spec.hits >= 1 && spec.steps >= 1;

/**
 * Replace `row`'s hits with its Euclidean pattern, filling `totalSteps` of the
 * clip (the cycle tiles, so a `steps` that doesn't divide the clip phases
 * against it). Every note on every other row survives untouched.
 */
export function applyEuclidToRow(
  notes: readonly NoteEvent[],
  row: number,
  spec: EuclidCycle,
  totalSteps: number,
  rows: DrumRows,
): NoteEvent[] {
  if (!generates(spec)) return [...notes];
  const others = notes.filter((n) => rows.noteToRow(n.midi) !== row);
  return [...others, ...euclidNotesAt(rows.rowToNote(row), spec, totalSteps)];
}
