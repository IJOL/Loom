// The one entry point the runtime calls: a list of (loop, weight) in, one set
// of notes out.
//
// Every topology reduces to this. A-to-B and a queue produce two entries, a
// cloud produces four, and nothing downstream can tell which — which is why
// adding a fourth topology later costs a file rather than an engine.

import type { NoteEvent } from '../core/notes';
import type { ScaleId } from '../core/musicality';
import { blendRhythm } from './blend-rhythm';
import { blendMelody } from './blend-melody';

export interface LoopWeight {
  notes: NoteEvent[];
  weight: number;
}

export interface BlendOptions {
  barTicks: number;
  /** Percussion is never transposed: a drum note picks a voice, not a pitch. */
  melodic: boolean;
  key: number;
  scale: ScaleId;
  octaveBase: number;
}

function pair(a: NoteEvent[], b: NoteEvent[], x: number, o: BlendOptions): NoteEvent[] {
  return o.melodic
    ? blendMelody(a, b, x, o.barTicks, o.key, o.scale, o.octaveBase)
    : blendRhythm(a, b, x, o.barTicks);
}

/** A blended note that still knows which loop it came from — an index into the
 *  list handed to `blendLoopsBySource`. */
export interface SourcedNote extends NoteEvent {
  from: number;
}

/** The same fold, but every surviving note carries its origin.
 *
 *  This is what lets each loop keep its OWN instrument: the blend decides which
 *  notes sound, and each one is then played by the synth of the loop it came
 *  from. Halfway across you hear the merged bar with two timbres sharing it,
 *  rather than one timbre for the lot.
 *
 *  Neither blend function needed changing for this. They pass notes through by
 *  spreading them, so a field on the way in survives to the way out — which is
 *  also why the tag has to go ON the note rather than in a parallel array that
 *  the pairwise fold would have to re-align at every step.
 *
 *  ONE case has no honest answer and takes a convention: a melodic note that
 *  exists in BOTH loops comes out at a pitch that is in neither, interpolated in
 *  scale degrees. It is attributed to the loop the accumulator was holding — in
 *  practice the heavier side, since the fold goes lightest-first. Percussion has
 *  no such case: a hit is either shared (and emitted unchanged from one side) or
 *  it belongs to exactly one loop. */
export function blendLoopsBySource(loops: LoopWeight[], o: BlendOptions): SourcedNote[] {
  const tagged = loops.map((l, from) => ({
    weight: l.weight,
    notes: l.notes.map((n) => ({ ...n, from })),
  }));
  return blendLoops(tagged, o) as SourcedNote[];
}

export function blendLoops(loops: LoopWeight[], o: BlendOptions): NoteEvent[] {
  // Every loop arrives already the length of the clip it is going into: a
  // library pattern is one bar, and `patternNotes` repeats it to fill the clip
  // when `weaveLoopNotes` hands it the clip's bar count. That is the ONE answer
  // to a loop shorter than its clip, and it belongs there — this fold sees note
  // arrays and has no idea what a library pattern is or how long one is meant
  // to be. Inferring a loop's length HERE, from where its notes happen to fall,
  // also duplicated a two-bar clip that deliberately plays only in its first bar.
  //
  // A loop at zero weight contributes nothing and must not be folded in: at
  // x = 0 the pairwise blend would still let its strongest hits through.
  //
  // NEARLY zero counts as zero, and that threshold is the difference between
  // an end you can reach and one you can only approach. A fader dragged to its
  // stop sent exactly 1.000, so the far end filtered the other loop out and you
  // heard B untouched; an endless dial cannot land on 1.000 by hand, so a
  // thread of A survived every turn and the fold ran on both — near enough to
  // hear as B and never actually B, reported as "scene 2 nunca se escucha
  // limpio". Half a percent is under two pixels of a dial's travel: an end in
  // every sense that matters, and far below anything audible as a blend.
  const live = loops.filter((l) => l.weight > 0.005);
  if (live.length === 0) return [];
  if (live.length === 1) return live[0].notes;

  // Fold lightest-first, so the heaviest loop is the last thing folded in and
  // therefore the one the result resembles most. Sorting also makes the answer
  // independent of the order the caller happened to list them in.
  const sorted = [...live].sort((p, q) => p.weight - q.weight);
  let acc = sorted[0].notes;
  let accWeight = sorted[0].weight;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const total = accWeight + next.weight;
    acc = pair(acc, next.notes, next.weight / total, o);
    accWeight = total;
  }
  return acc;
}
