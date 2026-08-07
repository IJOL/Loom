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

export function blendLoops(loops: LoopWeight[], o: BlendOptions): NoteEvent[] {
  // A loop at zero weight contributes nothing and must not be folded in: at
  // x = 0 the pairwise blend would still let its strongest hits through.
  const live = loops.filter((l) => l.weight > 0);
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
