// What every part renderer is handed, and the shape they all share.
//
// One options bag rather than a per-renderer signature, so `renderPart` can
// dispatch on the role without knowing which renderer it is about to call — and
// so adding a role later is a file and a line in a table, not a change to how
// the caller works.

import type { NoteEvent } from '../core/notes';
import { scaleDegreeToMidi, type ScaleId, type StyleId } from '../core/musicality';
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
   *  the harmony cannot move on its own and the rhythm was a table lookup on a
   *  style that does not move either.
   *
   *  Counted in PHRASES by the caller, not in bars: a comp that changed figure
   *  every bar is not a player, it is a shuffle button.
   *
   *  Absent ⇒ the style's typical shape, which is what every caller got before
   *  this existed. */
  variant?: number;
  /** Which colour the chord is voiced in — the pad's wheel.
   *
   *  Separate from `variant`, and that separation is the point. The two used to
   *  be one number, so the pad re-voiced on exactly the phrase the comp changed
   *  figure and the pair came round together. Turning at different rates is
   *  what makes a scene take longer to repeat than any one of its parts.
   *
   *  Absent ⇒ the plain triad. */
  colour?: number;
  /** How many octaves to move this part, as a wheel position rather than a
   *  number of octaves — the renderer decides what a step means, because a pad
   *  climbing an octave and a bass climbing one are not the same idea. The bass
   *  ignores it outright: staying put is the one job it has.
   *
   *  Absent ⇒ where the role says it sits. */
  register?: number;
  /** How thinned this phrase is, as a wheel position. Read by the caller and
   *  applied to the macros rather than by the renderers, so the thinning that
   *  a knob does and the thinning that time does are the same code.
   *
   *  Absent ⇒ untouched. */
  density?: number;
}

/** How far the register wheel moves a part, in octaves, at each of its five
 *  positions.
 *
 *  Mostly home. A part that changed octave every turn would be a part with no
 *  register at all — the effect works because it is rare enough to read as a
 *  decision rather than as wobble, and because it always comes back.
 *
 *  Up more often than down: a comp or a pad lifted an octave opens the mix,
 *  while the same move downwards crowds whatever is holding the bottom.
 */
const REGISTER_STEPS = [0, 0, 1, 0, -1];

export function registerOctaves(wheel: number | undefined): number {
  if (wheel === undefined || !Number.isFinite(wheel)) return 0;
  const n = REGISTER_STEPS.length;
  return REGISTER_STEPS[((Math.floor(wheel) % n) + n) % n];
}

/** How the density wheel leans on whatever the knob already said.
 *
 *  Small, and centred on nothing: a phrase is a little thinner, then plain,
 *  then a little fuller. It is added to Density rather than replacing it, so
 *  the user's setting stays the middle of the range instead of being
 *  overwritten by a wheel they did not touch.
 */
const DENSITY_STEPS = [0, -0.12, 0.08, -0.05, 0.15, -0.2, 0.04];

export function densityLean(wheel: number | undefined): number {
  if (wheel === undefined || !Number.isFinite(wheel)) return 0;
  const n = DENSITY_STEPS.length;
  return DENSITY_STEPS[((Math.floor(wheel) % n) + n) % n];
}

/** The four colours a chord may be voiced in, as scale degrees above its root.
 *
 *  Shared by the pad and the comp rather than written twice: they are the same
 *  four chords, and two tables would drift into the pad and the comp voicing
 *  the same bar differently for no reason anyone chose.
 *
 *  THREE voices in every one of them, deliberately. `nearestVoicing` compares
 *  voicings voice by voice and gives up when the counts differ, so a four-note
 *  colour among three-note ones would silently switch the voice-leading off for
 *  that chord alone and let the part leap. Sevenths and ninths get in by
 *  replacing a voice rather than by being added to one.
 */
export const CHORD_COLOURS: number[][] = [
  [0, 2, 4],  // the triad
  [0, 2, 6],  // shell: root, third, seventh — the fifth is the voice nobody misses
  [0, 4, 8],  // open: root, fifth, ninth
  [0, 1, 4],  // sus2
];

export function chordColour(
  degree: number, wheel: number | undefined, octaveBase: number,
  key: number, scale: ScaleId,
): number[] {
  const w = Number.isFinite(wheel ?? 0) ? Math.floor(wheel ?? 0) : 0;
  const n = CHORD_COLOURS.length;
  const colour = CHORD_COLOURS[((w % n) + n) % n];
  return colour.map((d) => scaleDegreeToMidi(degree + d, octaveBase, key, scale));
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
