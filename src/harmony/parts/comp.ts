// The comp: voiced chords on the style's rhythm, entering early when the
// harmony moves.
//
// The anticipation is the whole reason this is not renderChordComp with better
// voicing. A chord that lands exactly on the bar line every single time is what
// makes generated accompaniment sound generated; a player leans into the change
// and arrives just before it.
//
// It applies ONLY where the harmony actually moves. Anticipating a chord that
// is not changing is not a lean, it is an early note.

import { TICKS_PER_QUARTER, type NoteEvent } from '../../core/notes';
import { nearestVoicing } from '../../core/harmony';
import { SHAPES, shapeForStyleVariant } from '../../core/chord-rhythms';
import type { Progression } from '../../arranger/progression';
import { chordSpans, placeOf, registerOctaves, chordColour, type PartOptions } from '../part-types';
import { survivingHits } from '../phrase';

/** Half a beat. Enough to be heard as a lean rather than as a mistake, and a
 *  division of the BEAT rather than of the bar, so it means the same thing in a
 *  meter that is not four. */
const ANTICIPATION = TICKS_PER_QUARTER / 2;

const DOWNBEAT_VELOCITY = 112;
const OFFBEAT_VELOCITY = 92;

export function renderComp(progression: Progression, o: PartOptions): NoteEvent[] {
  // The style's way of comping ON THIS TURN, not its only one. The bass reads
  // the same index off the same palette, so the two lock together — a comp and
  // a bass on different figures is two players who have not met.
  const shape = SHAPES[shapeForStyleVariant(o.style, o.variant ?? 0)];
  const stepTicks = o.barTicks / 16;
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;

  const spans = chordSpans(progression, o.barTicks);

  spans.forEach((span, ci) => {
    // The register wheel moves the whole part bodily, BEFORE the voicing is
    // chosen — so the chain still leads voice to voice inside the new octave
    // rather than leaping back to where it used to sit.
    const base = o.octaveBase + 12 * registerOctaves(o.register);
    // Voiced in a COLOUR, the same four the pad uses. Without this the colour
    // wheel turned and the comp did not hear it — a wheel that changes nothing
    // is a number growing while the music stands still, which is the failure
    // this whole idea has to avoid rather than commit.
    const triad = nearestVoicing(chordColour(span.degree, o.colour, base, o.key, o.scale), prev);
    prev = triad;
    const bars = Math.round(span.ticks / o.barTicks);
    const spanEnd = span.start + span.ticks;

    for (let bar = 0; bar < bars; bar++) {
      const barStart = span.start + bar * o.barTicks;
      const place = placeOf(Math.round(barStart / o.barTicks), spans, o);
      // Gated on each hit's OWN position, before the anticipation moves it: an
      // anticipated entry lands in the bar BEFORE, and asking the phrase about a
      // tick belonging to the previous bar would answer about the wrong bar —
      // and drop the very entry the lean exists to make.
      const kept = survivingHits(shape, stepTicks, o.barTicks, place);
      for (const hit of kept) {
        let start = barStart + hit.stepOffset * stepTicks;
        let duration = hit.durationSteps * stepTicks;
        // The lean: the FIRST hit of a chord that is not the progression's
        // first, and only in that chord's first bar — a chord held across two
        // bars has nothing to arrive ahead of at bar two. Held longer by as
        // much as it moved, so the chord still ends where it would have.
        // …and only while something is left behind to land ON the bar. A shape
        // with ONE hit — `sustained` is exactly that — has its whole bar carried
        // off by the lean, and a chord anticipated into the previous bar leaves
        // its own with nothing at all. You cannot lean into a chord if leaning
        // is what removes it: eight of the twenty styles came out with silent
        // bars this way, and it is the same erasure `survivingHits` guards
        // against, arriving one step later.
        if (bar === 0 && hit.stepOffset === 0 && ci > 0 && kept.length > 1) {
          start -= ANTICIPATION;
          duration += ANTICIPATION;
        }
        if (start >= spanEnd) continue;
        const velocity = hit.stepOffset === 0 ? DOWNBEAT_VELOCITY : OFFBEAT_VELOCITY;
        for (const midi of triad) {
          out.push({ start, duration: Math.min(duration, spanEnd - start), midi, velocity });
        }
      }
    }
  });
  return out;
}
