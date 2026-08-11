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
import { SHAPES, type ChordShapeId } from './chord-rhythms';
import type { ScaleId } from './musicality';

// The five rhythms, their labels and the per-style map all live in
// `chord-rhythms.ts`, which the Chords button reads too. Re-exported here so a
// caller that thinks in SHAPES has one import, and so this module keeps its
// job: turning one of them into notes.
export {
  CHORD_SHAPES, isChordShape, shapeForStyle, type ChordShapeId,
} from './chord-rhythms';

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
