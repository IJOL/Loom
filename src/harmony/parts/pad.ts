// The pad: one stack per chord, held for as long as the chord lasts.
//
// It has no rhythm of its own on purpose. A pad that comped would be a comp;
// what a pad does is state the harmony and get out of the way, which is why it
// is the one part that ignores the style's shape entirely.

import type { NoteEvent } from '../../core/notes';
import { nearestVoicing } from '../../core/harmony';
import type { Progression } from '../../arranger/progression';
import { chordSpans, registerOctaves, chordColour, type PartOptions } from '../part-types';

/** Well under the comp's, because a pad that competes with the part carrying
 *  the rhythm stops being a bed and starts being a second comp. */
const PAD_VELOCITY = 78;


export function renderPad(progression: Progression, o: PartOptions): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  // Its OWN wheel, turning at its own rate. It used to read `variant` — the
  // comp's number — so the pad re-voiced on exactly the phrase the comp changed
  // figure, and the two came round together as one.

  for (const span of chordSpans(progression, o.barTicks)) {
    // CHAINED rather than anchored: a pad is rendered over the whole
    // progression in one pass, so each chord genuinely has the previous one to
    // be near. (WEAVE's revoiceChords is anchored instead, because it
    // re-derives over a window shorter than the progression and a chain would
    // restart at every seam — see core/harmony.ts.)
    const triad = nearestVoicing(
      chordColour(span.degree, o.colour,
        o.octaveBase + 12 * registerOctaves(o.register), o.key, o.scale), prev);
    prev = triad;
    for (const midi of triad) {
      out.push({ start: span.start, duration: span.ticks, midi, velocity: PAD_VELOCITY });
    }
  }
  return out;
}
