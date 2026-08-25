// The generator as a `LaneNoteSource` — the third producer, beside the weave
// and the follower.
//
// Every dependency is a thunk, read at ask time rather than captured. Same
// reason as the weave's: a knob moved while the transport runs has to be heard
// on the next iteration, not on the next launch.

import type { NoteEvent } from '../core/notes';
import type { LaneNote, LaneNoteSource } from '../session/lane-note-source';
import { generateNotes } from './generate';
import { pitchPool, type PoolNote } from './pool';
import type { GridSpec } from './grid';

export interface GeneratorDeps {
  /** The material: the lane's loop selection, already folded to one bar.
   *
   *  Handed in rather than resolved here, so this module never learns what a
   *  loop id is or how one becomes notes. The weave already owns that road and
   *  the generator takes the same one. */
  material: () => readonly NoteEvent[];
  grid: () => GridSpec;
  stepsPerBar: () => number;
  ticksPerStep: () => number;
  /** How many steps the carrier clip is long. */
  steps: () => number;
  /** The absolute step the next iteration begins on. */
  startStep: () => number;
}

export function createGeneratorSource(deps: GeneratorDeps): LaneNoteSource {
  // The pool is cached against the material ARRAY, not its contents. The fold
  // upstream already caches and hands back the same array while its weights sit
  // still, so identity is both cheaper than a content hash and exactly as
  // sensitive: a new array is a new blend by construction.
  let poolFrom: readonly NoteEvent[] | null = null;
  let pool: PoolNote[] = [];
  // Bumped whenever the pool is rebuilt, and part of the output key below.
  //
  // The key cannot describe the pool by its LENGTH: a refold that changes every
  // pitch and keeps the count — a crossfade arriving at the other loop, a clip
  // edited under a running transport — hits the cache and hands back the notes
  // from before. Caught by test, and it is the quietest possible failure: the
  // lane keeps playing, in the wrong material.
  let poolVersion = 0;

  let cacheKey = '';
  let out: LaneNote[] = [];

  return () => {
    const material = deps.material();
    if (material !== poolFrom) {
      poolFrom = material;
      pool = pitchPool(material);
      poolVersion++;
    }

    const grid = deps.grid();
    const stepsPerBar = deps.stepsPerBar();
    const ticksPerStep = deps.ticksPerStep();
    const steps = deps.steps();
    const startStep = deps.startStep();

    // `startStep` is in the key, so the head genuinely moves from one iteration
    // to the next — a cache that ignored it would freeze the pattern on its
    // first bar, which is the mistake that would look most like "it works".
    const key = `${poolVersion}|${grid.repeats},${grid.pow2}`
      + `|${stepsPerBar}|${ticksPerStep}|${steps}|${startStep}`;
    if (key !== cacheKey) {
      cacheKey = key;
      out = generateNotes({ pool, grid, stepsPerBar, ticksPerStep, steps, startStep });
    }
    return out;
  };
}
