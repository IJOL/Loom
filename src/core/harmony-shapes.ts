// The chordal material a lane is offered, GENERATED rather than authored.
//
// There are no pad loops in the library and there never will be. A chord
// written as fixed semitones cannot stay diatonic across the eight scales a
// session may be in — `[0,3,7]` is a minor triad in a minor key and something
// else in a major one — and transposition by degree SNAPS to the scale before
// it moves anything, so an out-of-scale stack comes back mangled rather than
// merely transposed: `[0,4,7]` in A minor returns F–B–C, a tritone and a
// semitone.
//
// So what a chordal lane picks is a RHYTHM, and the notes come from the
// diatonic triad — in the session's own scale, by construction, in every scale.
// The rhythms are the ones harmony.ts already names for its per-style comping
// table; naming them here as choices is the whole of this module.
//
// Rendered on the TONIC, one bar, exactly like a library pattern: the
// progression moves it per bar downstream (applyProgression). Pre-applying a
// chord here would move it twice.

import { type NoteEvent } from './notes';
import { diatonicTriad } from './harmony';
import type { ScaleId } from './musicality';

export type ChordShapeId =
  | 'sustained' | 'offbeat' | 'eighths' | 'sparse' | 'syncopated';

interface Hit { stepOffset: number; durationSteps: number; }

const SHAPES: Record<ChordShapeId, Hit[]> = {
  sustained:  [{ stepOffset: 0, durationSteps: 16 }],
  offbeat:    [2, 6, 10, 14].map((s) => ({ stepOffset: s, durationSteps: 1 })),
  eighths:    [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ({ stepOffset: s, durationSteps: 1 })),
  sparse:     [{ stepOffset: 0, durationSteps: 2 }, { stepOffset: 8, durationSteps: 2 }],
  syncopated: [
    { stepOffset: 0, durationSteps: 1 },
    { stepOffset: 9, durationSteps: 1 },
    { stepOffset: 14, durationSteps: 1 },
  ],
};

/** What a chordal lane is offered instead of loops. Five, because they are five
 *  ways of playing chords and not five settings of one. */
export const CHORD_SHAPES: { id: ChordShapeId; label: string }[] = [
  { id: 'sustained',  label: 'Sustained' },
  { id: 'offbeat',    label: 'Offbeat stabs' },
  { id: 'eighths',    label: 'Pulsing eighths' },
  { id: 'sparse',     label: 'Sparse stabs' },
  { id: 'syncopated', label: 'Syncopated' },
];

/** Validated, never cast. An id that parses but does not exist is a loop that
 *  shows in the dropdown and plays silence. */
export function isChordShape(id: string): id is ChordShapeId {
  return Object.prototype.hasOwnProperty.call(SHAPES, id);
}

/** One bar of a shape, on the tonic triad.
 *
 *  `octaveBase` is the RAW base — 48, not 48-moved-to-the-key. The key is added
 *  by `scaleDegreeToMidi` inside the triad, so a base that already carried it
 *  would apply it twice. */
export function renderChordShape(
  shape: ChordShapeId,
  opts: { key: number; scale: ScaleId; octaveBase: number; barTicks: number },
): NoteEvent[] {
  const { key, scale, octaveBase, barTicks } = opts;
  const stepTicks = barTicks / 16;
  const triad = diatonicTriad(0, octaveBase, key, scale);
  const out: NoteEvent[] = [];
  let first = true;
  for (const hit of SHAPES[shape]) {
    const start = hit.stepOffset * stepTicks;
    if (start >= barTicks) continue;
    const duration = Math.min(hit.durationSteps * stepTicks, barTicks - start);
    // The downbeat louder, the way the comping generator already accents it.
    const velocity = first ? 115 : 95;
    first = false;
    for (const midi of triad) out.push({ start, duration, midi, velocity });
  }
  return out;
}
