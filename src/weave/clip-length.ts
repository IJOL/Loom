// Growing a clip is three different musical operations, and they are three
// buttons rather than one hidden mode:
//
//   repeat  -- tile the bar. The groove is untouched; there is just more of it.
//   stretch -- lengthen the notes. The groove changes character.
//   vary    -- tile, but drop a different weak hit from each copy after the
//              first, so the second time round is not the first time round.
//
// The existing x2 / /2 buttons conflate the first two, which is why the same
// press feels right on drums and wrong on a pad.

import type { NoteEvent } from '../core/notes';
import { metricWeight } from './metric-weight';

export type LengthMode = 'repeat' | 'stretch' | 'vary';

/** Rejects anything that would silently destroy the clip. Zero, negative and
 *  NaN all reach here from a text field. */
const usable = (v: number) => Number.isFinite(v) && v > 0;

export function scaleClipLength(
  notes: NoteEvent[], factor: number, mode: LengthMode, srcTicks: number,
): NoteEvent[] {
  // Returning the clip unchanged is the honest answer: an empty one reads
  // exactly like data loss.
  if (!usable(factor)) return notes;

  if (mode === 'stretch') {
    return notes.map((n) => ({
      ...n,
      start: Math.round(n.start * factor),
      duration: Math.max(1, Math.round(n.duration * factor)),
    }));
  }

  const target = Math.round(srcTicks * factor);
  const copies = Math.max(1, Math.ceil(factor));
  const out: NoteEvent[] = [];

  for (let c = 0; c < copies; c++) {
    let src = notes;
    if (mode === 'vary' && c > 0 && notes.length > 1) {
      // Drop this copy's weakest surviving hit. WHICH one depends on the copy
      // index, so the third pass is not the second pass either — and the
      // downbeat, being the strongest, is the last thing that could ever go.
      const ranked = [...notes].sort(
        (a, b) => metricWeight(a.start, srcTicks) - metricWeight(b.start, srcTicks),
      );
      const victim = ranked[(c - 1) % ranked.length];
      src = notes.filter((n) => n !== victim);
    }
    for (const n of src) {
      const start = n.start + c * srcTicks;
      if (start >= target) continue;
      out.push({ ...n, start });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Play the same material faster or slower without changing which notes it
 *  contains. `rate > 1` packs them closer.
 *
 *  For audio material this is the time-stretch that already exists; for notes
 *  it is arithmetic. */
export function retimeClip(notes: NoteEvent[], rate: number): NoteEvent[] {
  // Rate 0 would collapse every note onto tick 0 — a clip that plays one chord
  // and nothing else, which reads as a bug rather than as a very slow tempo.
  if (!usable(rate)) return notes;
  return notes.map((n) => ({
    ...n,
    start: Math.round(n.start / rate),
    duration: Math.max(1, Math.round(n.duration / rate)),
  }));
}
