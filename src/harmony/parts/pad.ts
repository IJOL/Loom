// The pad: one stack per chord, held for as long as the chord lasts.
//
// It has no rhythm of its own on purpose. A pad that comped would be a comp;
// what a pad does is state the harmony and get out of the way, which is why it
// is the one part that ignores the style's shape entirely.

import type { NoteEvent } from '../../core/notes';
import { nearestVoicing } from '../../core/harmony';
import { scaleDegreeToMidi } from '../../core/musicality';
import type { Progression } from '../../arranger/progression';
import { chordSpans, type PartOptions } from '../part-types';

/** Well under the comp's, because a pad that competes with the part carrying
 *  the rhythm stops being a bed and starts being a second comp. */
const PAD_VELOCITY = 78;

/** The pad's four colours, as scale degrees above the chord's root.
 *
 *  A pad is the one part with no rhythm to vary, so what it varies instead is
 *  the chord itself: plain triad, the shell that drops the fifth for the
 *  seventh, the open voicing that reaches the ninth, and the suspension. That
 *  is what a keyboard player does over a bed and it is the only thing a held
 *  chord CAN do — reported as "el pad no se ha movido en ningún momento", which
 *  was true and by construction: one stack per chord, forever the same stack.
 *
 *  THREE voices each, deliberately. `nearestVoicing` compares voicings voice by
 *  voice and gives up when the counts differ, so a four-note colour among
 *  three-note ones would silently switch the voice-leading off for that chord
 *  and let the pad leap. Sevenths and ninths get in by replacing a voice rather
 *  than by being added to one. */
const PAD_COLOURS: number[][] = [
  [0, 2, 4],  // the triad
  [0, 2, 6],  // shell: root, third, seventh — the fifth is the voice nobody misses
  [0, 4, 8],  // open: root, fifth, ninth
  [0, 1, 4],  // sus2
];

export function renderPad(progression: Progression, o: PartOptions): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  const colour = PAD_COLOURS[
    ((Math.floor(Number.isFinite(o.variant ?? 0) ? (o.variant ?? 0) : 0) % PAD_COLOURS.length)
      + PAD_COLOURS.length) % PAD_COLOURS.length
  ];
  for (const span of chordSpans(progression, o.barTicks)) {
    // CHAINED rather than anchored: a pad is rendered over the whole
    // progression in one pass, so each chord genuinely has the previous one to
    // be near. (WEAVE's revoiceChords is anchored instead, because it
    // re-derives over a window shorter than the progression and a chain would
    // restart at every seam — see core/harmony.ts.)
    const triad = nearestVoicing(
      colour.map((d) => scaleDegreeToMidi(span.degree + d, o.octaveBase, o.key, o.scale)), prev);
    prev = triad;
    for (const midi of triad) {
      out.push({ start: span.start, duration: span.ticks, midi, velocity: PAD_VELOCITY });
    }
  }
  return out;
}
