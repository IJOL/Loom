// What every part renderer is handed, and the shape they all share.
//
// One options bag rather than a per-renderer signature, so `renderPart` can
// dispatch on the role without knowing which renderer it is about to call — and
// so adding a role later is a file and a line in a table, not a change to how
// the caller works.

import type { NoteEvent } from '../core/notes';
import type { ScaleId, StyleId } from '../core/musicality';
import type { Progression } from '../arranger/progression';

export interface PartOptions {
  key: number;
  scale: ScaleId;
  /** Decides the RHYTHM a part comps with, via `shapeForStyle`. Not every
   *  renderer reads it: a pad deliberately has no rhythm of its own. */
  style: StyleId;
  barTicks: number;
  /** Where the part sits, as a MIDI note. Each renderer places itself relative
   *  to this — the bass drops below it, the pad and the comp sit on it. */
  octaveBase: number;
  /** How long the PHRASE is, in bars, when it outlasts this render.
   *
   *  A two-bar loop played twice is a four-bar phrase, and that is the ordinary
   *  case in Loom rather than the exception. Without it the shaping in
   *  `phrase.ts` sat inert on every two-bar clip — it leaves anything under
   *  three bars alone, by its own rule — so both bars came out identical and
   *  full: no arc, no hole, no turn. It was written for four-bar material and
   *  four-bar material was all it had been tried on.
   *
   *  Absent ⇒ the phrase is exactly what is being rendered. */
  phraseLength?: number;
  /** How many bars of that phrase are already behind — which repeat of the loop
   *  this is. Absent ⇒ the top of the phrase. */
  phraseOffset?: number;
  /** Which of the style's ways of comping to use — an index into its palette,
   *  wrapped by `shapeForStyleVariant`.
   *
   *  This is the difference between an accompaniment and a loop pedal. A style
   *  used to name ONE rhythm, so a part was a constant function of a constant:
   *  the harmony cannot move on its own (every library loop infers the tonic)
   *  and the rhythm was a table lookup on a style that does not move either.
   *  Nothing downstream could rescue that, and no amount of phrase shaping did
   *  — it rearranges a bar, it cannot write a different one.
   *
   *  Counted in PHRASES by the caller, not in bars: a comp that changed figure
   *  every bar is not a player, it is a shuffle button.
   *
   *  Absent ⇒ the style's typical shape, which is what every caller got before
   *  this existed. */
  variant?: number;
}

export type PartRenderer = (progression: Progression, o: PartOptions) => NoteEvent[];

export interface ChordSpan {
  degree: number;
  /** Ticks from the start of the progression. */
  start: number;
  /** How long this chord lasts, in ticks. */
  ticks: number;
}

/** Where each chord of a progression starts and how long it holds.
 *
 *  Shared because every renderer walks a progression the same way, and three
 *  copies of this loop would be three chances to disagree about what `bars`
 *  means — which shows up as one part changing chord a bar before another.
 *
 *  A chord of zero or fewer bars is clamped to one rather than skipped: it
 *  would otherwise occupy no time, and the parts would silently disagree with
 *  the chord bar drawing it. */
export function chordSpans(progression: Progression, barTicks: number): ChordSpan[] {
  const out: ChordSpan[] = [];
  let at = 0;
  for (const c of progression) {
    const ticks = Math.max(1, c.bars) * barTicks;
    out.push({ degree: c.degree, start: at, ticks });
    at += ticks;
  }
  return out;
}

/** How many bars the whole progression runs to — the PHRASE, which is what the
 *  shaping in `phrase.ts` measures position against.
 *
 *  The phrase is the progression rather than a fixed four, because that is what
 *  actually comes round: a three-bar progression turns at bar three, and a
 *  renderer counting to four would put its hole in the middle of the next lap. */
export const phraseBars = (spans: readonly ChordSpan[], barTicks: number): number =>
  spans.reduce((sum, s) => sum + Math.round(s.ticks / barTicks), 0);

/** Where a bar of THIS render sits inside the phrase.
 *
 *  One helper because all three shaped renderers need the same two lines, and
 *  getting them subtly different is how one part turns round a bar before
 *  another. The offset wraps, so a two-bar loop alternates between the first
 *  half of the phrase and the second as it repeats. */
export function placeOf(
  localBar: number, spans: readonly ChordSpan[], o: PartOptions,
): { bar: number; bars: number } {
  const own = phraseBars(spans, o.barTicks);
  const bars = Math.max(own, o.phraseLength ?? own);
  return { bar: ((o.phraseOffset ?? 0) + localBar) % bars, bars };
}
