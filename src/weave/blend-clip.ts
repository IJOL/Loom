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
  /** How much clip the fold has to cover, in ticks. A library loop is one bar
   *  and the clip carrying it may be longer, and the fold has to fill it: with
   *  nothing here, a two-bar clip woven against a one-bar loop went SILENT for
   *  its second half as the fader crossed — the loop simply had no notes there
   *  to hand over, so the other side's hits left and nothing arrived.
   *
   *  Absent ⇒ no repeating at all, byte-for-byte what this did before. */
  fillTicks?: number;
}

/** A loop's own length in ticks, rounded UP to a whole bar and never shorter
 *  than one. Measured from note STARTS: a note whose tail spills past the last
 *  bar line is a tie-over, not another bar of music. */
function loopSpanTicks(notes: readonly NoteEvent[], barTicks: number): number {
  if (barTicks <= 0) return 0;
  let last = 0;
  for (const n of notes) if (n.start > last) last = n.start;
  return Math.max(1, Math.floor(last / barTicks) + 1) * barTicks;
}

/** Repeat `notes` until they cover `fillTicks`, cutting whatever overshoots.
 *
 *  Shorter only: a loop LONGER than the clip is left alone, because truncating
 *  it would be throwing music away to make a length match — the clip's own
 *  region already decides what gets played.
 *
 *  Exported for the tests; the blend calls it on every loop before folding, so
 *  both sides of a crossfade have something to say in every bar. */
export function tileNotesToFill<T extends NoteEvent>(
  notes: readonly T[], barTicks: number, fillTicks: number,
): readonly T[] {
  if (notes.length === 0 || !(fillTicks > 0) || !(barTicks > 0)) return notes;
  const span = loopSpanTicks(notes, barTicks);
  if (span <= 0 || span >= fillTicks) return notes;

  const out: T[] = [];
  for (let offset = 0; offset < fillTicks; offset += span) {
    for (const n of notes) {
      const start = n.start + offset;
      if (start >= fillTicks) continue;
      out.push({ ...n, start });
    }
  }
  return out;
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
  // Every loop brought up to the clip's length BEFORE anything folds. It has to
  // happen here rather than on the result: fold first and the short loop still
  // has no notes in the clip's later bars, so the crossfade there is a fade to
  // nothing instead of a handover. Repeating the RESULT would not fix it either
  // — the result is already missing those hits.
  const filled = o.fillTicks
    ? loops.map((l) => ({ ...l, notes: tileNotesToFill(l.notes, o.barTicks, o.fillTicks!) as NoteEvent[] }))
    : loops;

  // A loop at zero weight contributes nothing and must not be folded in: at
  // x = 0 the pairwise blend would still let its strongest hits through.
  const live = filled.filter((l) => l.weight > 0);
  if (live.length === 0) return [];
  // Tiled too, and that is the case the bug was reported from: the fader all the
  // way over to a one-bar library loop, in a two-bar clip.
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
