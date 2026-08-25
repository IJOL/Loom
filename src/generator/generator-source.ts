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
import { DEFAULT_CADENCE, type CadenceSpec } from './cadence';
import { DEFAULT_CHORD, type ChordSpec } from './chord';
import {
  DEFAULT_OFFSET, DEFAULT_LENGTH, type OffsetSpec, type LengthSpec,
} from './note-timing';
import { DEFAULT_WHEEL, type WheelSpec } from './displace';
import type { ScaleId } from '../core/musicality';
import type { Progression } from '../arranger/progression';

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
  /** Which steps fire. Absent ⇒ all of them. */
  cadence?: () => CadenceSpec;
  /** How long a bar is, from the METER. Not derivable from the division: `div`
   *  says how many steps cut the bar, and the bar's own length is the session's
   *  business. */
  barTicks: () => number;
  /** Which note each step lands on. Absent ⇒ the pool's own pitch. */
  chord?: () => ChordSpec;
  /** The key and scale the lane's material was folded in. */
  tonality?: () => { key: number; scale: ScaleId };
  /** The SONG's progression. */
  progression?: () => Progression;
  /** Where exactly the hit lands. Absent ⇒ dead on its step. */
  offset?: () => OffsetSpec;
  /** How long it holds. Absent ⇒ exactly one step. */
  length?: () => LengthSpec;
  /** The two displacement wheels. Absent ⇒ neither turning. */
  barMod?: () => WheelSpec;
  loopMod?: () => WheelSpec;
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
    const cadence = deps.cadence?.() ?? DEFAULT_CADENCE;
    const barTicks = deps.barTicks();
    const chord = deps.chord?.() ?? DEFAULT_CHORD;
    const tonality = deps.tonality?.() ?? { key: 0, scale: 'major' as ScaleId };
    const progression = deps.progression?.() ?? [];
    const offset = deps.offset?.() ?? DEFAULT_OFFSET;
    const length = deps.length?.() ?? DEFAULT_LENGTH;

    const spec = {
      grid, stepsPerBar, ticksPerStep, steps, startStep, barTicks,
      cadence, chord, tonality, progression, offset, length,
      barMod: deps.barMod?.() ?? DEFAULT_WHEEL,
      loopMod: deps.loopMod?.() ?? DEFAULT_WHEEL,
    };

    // The key is the WHOLE input, serialised, rather than a hand-picked list of
    // fields. That is deliberate and it is the second time this cache has been
    // wrong: the first version described the pool by its length, so a crossfade
    // that changed every pitch and kept the count went unnoticed. A hand-picked
    // list has to be edited for every control the spec still has to add, and the
    // failure it produces when someone forgets is silent — the lane plays on
    // with the settings from before. This cannot be forgotten.
    //
    // `startStep` is in there, so the head genuinely moves from one iteration to
    // the next. A cache that ignored it would freeze the pattern on its first
    // bar, which is the mistake that would look most like working. And the
    // progression is keyed by its SHAPE rather than its identity, because
    // `activeProgression` builds a fresh array per call — an identity check
    // would miss every time and refold on every tick.
    //
    // It runs once per look-ahead tick over a handful of small objects, not per
    // sample.
    const key = `${poolVersion}|${JSON.stringify(spec)}`;
    if (key !== cacheKey) {
      cacheKey = key;
      out = generateNotes({ ...spec, pool });
    }
    return out;
  };
}
