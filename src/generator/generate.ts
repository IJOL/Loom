// The read head walking the grid, and the notes that come out of it.
//
// Stage 1 of the note generator (spec §7): the grid and the head, no
// displacement and no streams. A step fires, the head says where on the pattern
// it is, and the pool says what pitch lives there.
//
// The PATTERN governs the repeat, and the pool is read at the position the head
// folds to. So a pool longer than the pattern has a tail nobody hears, and one
// shorter simply repeats inside it. That is not an oversight to be fixed by
// making the two lengths co-prime here: reaching the rest of a long pool is
// exactly what Bar Mod and Loop Mod are for (stage 6), and doing it early with
// a second modulus would leave two answers to "how does this get long" — the
// one thing `harmony/cycle`'s comment already warns against.

import type { LaneNote } from '../session/lane-note-source';
import { readHead, patternBars, type GridSpec } from './grid';
import { cadenceFires, DEFAULT_CADENCE, type CadenceSpec } from './cadence';
import { chordPitch, DEFAULT_CHORD, type ChordSpec } from './chord';
import {
  offsetTicks, lengthTicks, DEFAULT_OFFSET, DEFAULT_LENGTH,
  type OffsetSpec, type LengthSpec,
} from './note-timing';
import type { ScaleId } from '../core/musicality';
import type { Progression } from '../arranger/progression';
import type { PoolNote } from './pool';

export interface GenerateOptions {
  pool: readonly PoolNote[];
  grid: GridSpec;
  /** How many steps make a bar, at this generator's division. */
  stepsPerBar: number;
  /** How long one step is, in ticks. */
  ticksPerStep: number;
  /** How many steps this iteration covers — the carrier clip's length. */
  steps: number;
  /** The ABSOLUTE step the iteration begins on, so bar 5 renders as bar 5
   *  whether it was played into or fast-forwarded to. */
  startStep: number;
  /** Which steps fire. Absent ⇒ every one of them, which is what this did
   *  before CADENCE existed. */
  cadence?: CadenceSpec;
  barTicks?: number;
  /** Which note each step lands on. Absent ⇒ the pool's own pitch, untouched. */
  chord?: ChordSpec;
  tonality?: { key: number; scale: ScaleId };
  /** The SONG's progression, promoted out of the weave in 2c. */
  progression?: Progression;
  /** Where exactly the hit lands. Absent ⇒ dead on its step. */
  offset?: OffsetSpec;
  /** How long it holds. Absent ⇒ exactly one step. */
  length?: LengthSpec;
}

/** One iteration's worth of notes.
 *
 *  Empty for an empty pool, which is the honest answer rather than a rest-shaped
 *  one: a generator whose material resolved to nothing has nothing to say, and
 *  the lane should be silent rather than droning on a default pitch. */
export function generateNotes(o: GenerateOptions): LaneNote[] {
  if (o.pool.length === 0) return [];
  if (!(o.ticksPerStep > 0)) return [];
  const steps = Math.max(0, Math.floor(o.steps));

  const cadence = o.cadence ?? DEFAULT_CADENCE;
  const barTicks = o.barTicks ?? o.stepsPerBar * o.ticksPerStep;
  // The pattern IS the phrase, as far as this lane is concerned. Its length is
  // a number the user set, which is a better answer than a fixed four: a
  // three-bar pattern gets a three-bar phrase rather than a four-bar one it
  // never finishes.
  const bars = patternBars(o.grid);
  const chord = o.chord ?? DEFAULT_CHORD;
  const tonality = o.tonality ?? { key: 0, scale: 'major' as ScaleId };
  const progression = o.progression ?? [];
  const offset = o.offset ?? DEFAULT_OFFSET;
  const len = o.length ?? DEFAULT_LENGTH;
  const span = steps * o.ticksPerStep;

  const out: LaneNote[] = [];
  for (let i = 0; i < steps; i++) {
    const step = o.startStep + i;
    const head = readHead(step, o.grid, o.stepsPerBar);
    const at = {
      head,
      stepsPerBar: o.stepsPerBar,
      ticksPerStep: o.ticksPerStep,
      barTicks,
    };
    if (!cadenceFires(cadence, at, bars)) continue;
    // The pool is read at the head REGARDLESS of whether a step fired, so
    // thinning the rhythm does not also transpose the melody: turn CADENCE down
    // and you hear the same line with holes in it, not a different line. A pool
    // cursor advanced only on surviving hits would have been the other reading,
    // and it makes one knob do two jobs.
    const note = o.pool[head % o.pool.length];
    // Local to the iteration, never absolute: the scheduler loops this array and
    // a start counted from the transport's zero would put every note beyond the
    // clip's end on the second lap.
    //
    // Clamped INSIDE the iteration after the nudge. A hit nudged early off step
    // 0 would start before the loop and a hit nudged late off the last step
    // would start after its end; the scheduler drops both, so the groove would
    // silently lose its first and last note rather than swing them.
    const start = Math.max(0, Math.min(
      span - 1,
      i * o.ticksPerStep + offsetTicks(offset, head, o.ticksPerStep),
    ));
    out.push({
      start,
      // A note may run PAST the iteration on purpose. Length above one step is
      // what makes consecutive notes overlap, and an overlap is how an engine
      // that declares `"slide": "overlap"` knows to slide — so trimming it to
      // the loop here would quietly remove the generator's portamento.
      duration: lengthTicks(len, head, o.ticksPerStep),
      // The harmony walks the SONG's bars, not the pattern's. The rhythm
      // repeats with the pattern and the chords do not, which is what lets
      // every lane agree on where the music is while disagreeing about what to
      // play there.
      midi: chordPitch(note.midi, chord, tonality, progression, {
        head,
        bar: Math.floor(step / Math.max(1, o.stepsPerBar)),
      }),
      velocity: note.velocity,
    });
  }
  return out;
}
