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
import { readHead, patternBars, patternSteps, type GridSpec } from './grid';
import { displacement, DEFAULT_WHEEL, type WheelSpec } from './displace';
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
  /** Moves the read WITHIN a pass of the pattern, once per bar. */
  barMod?: WheelSpec;
  /** Moves the read ACROSS passes, once per lap. The one that reaches the tail
   *  of a pool longer than the pattern. */
  loopMod?: WheelSpec;
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
  const barWheel = o.barMod ?? DEFAULT_WHEEL;
  const loopWheel = o.loopMod ?? DEFAULT_WHEEL;
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
    // CADENCE reads the UNDISPLACED head, and that is the stage-6 decision.
    // Karst's model puts the displacement before all four streams, which would
    // move the rhythm and the phrase with the material — so the opening bar of
    // a phrase would stop being the opening. Displacement moves WHAT IS PLAYED,
    // not WHEN: the groove and the phrase stay where you put them while the
    // material underneath them evolves, which is the thing "the loop evolves"
    // is asking for.
    if (!cadenceFires(cadence, at, bars)) continue;

    // Added to the head rather than folded back into the pattern. Re-folding
    // would cap the read at `patternSteps`, and then a pool LONGER than the
    // pattern could never be reached — the exact gap stage 1 pinned by test and
    // named this stage as the filler of.
    const readAt = head + displacement(barWheel, loopWheel, {
      head, step, stepsPerBar: o.stepsPerBar, patternSteps: patternSteps(o.grid, o.stepsPerBar),
    });
    // The pool is read REGARDLESS of whether a step fired, so thinning the
    // rhythm does not also transpose the melody: turn CADENCE down and you hear
    // the same line with holes in it, not a different line. A pool cursor
    // advanced only on surviving hits would have been the other reading, and it
    // makes one knob do two jobs.
    const idx = ((readAt % o.pool.length) + o.pool.length) % o.pool.length;
    const note = o.pool[idx];
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
        // The DISPLACED read, so the voicing evolves with the material it is
        // voicing rather than staying pinned to a position the material has
        // moved away from.
        head: readAt,
        bar: Math.floor(step / Math.max(1, o.stepsPerBar)),
      }),
      velocity: note.velocity,
    });
  }
  return out;
}
