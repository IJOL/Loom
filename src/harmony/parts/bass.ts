// The bass: one note at a time, under everything else.
//
// Root and fifth alternating across the style's own hits, rather than a root on
// every hit — a root-only bass is a drone, and the fifth is the one other note
// that never argues with the chord above it whatever the mode.

import type { NoteEvent } from '../../core/notes';
import { scaleDegreeToMidi } from '../../core/musicality';
import { SHAPES, shapeForStyleVariant } from '../../core/chord-rhythms';
import type { Progression } from '../../arranger/progression';
import { chordSpans, placeOf, type PartOptions } from '../part-types';
import { survivingHits } from '../phrase';

/** How far below `octaveBase` the bass sits.
 *
 *  An octave, and not less: `nearestVoicing` may place the comp and the pad up
 *  to an octave below their chord's root position, so anything smaller lets the
 *  bass collide with the part above it on some chords and not others. */
const BASS_DROP = 12;

/** Above the comp's off-beat hits. A bass that a listener has to hunt for is
 *  not doing the one job it has. */
const BASS_VELOCITY = 104;

/** Keep a bass note within one octave of the line's own bottom.
 *
 *  The fifth is taken as `degree + 4` — four steps UP the scale — which is a
 *  fifth when the chord is low in the scale and a TWELFTH when it is not: on VI
 *  and VII those four steps cross the octave, so half the line was landing an
 *  octave and a fifth above its own root. Reported from the speakers, "el bajo
 *  calculado es muy agudo, debe bajar octavas", and it is not a register
 *  problem so much as a line that was leaping out of its own range and back.
 *
 *  Folded rather than clamped: an octave down is the SAME NOTE, so nothing is
 *  altered harmonically and the alternation the part is built on survives. A
 *  clamp would have flattened root and fifth onto one pitch and turned the bass
 *  into a drone.
 */
function inRegister(midi: number, bottom: number): number {
  let m = midi;
  while (m >= bottom + 12) m -= 12;
  while (m < bottom) m += 12;
  return m;
}

export function renderBass(progression: Progression, o: PartOptions): NoteEvent[] {
  // The SAME index into the same palette the comp reads, so the two move
  // figure together. Picking independently would be two players in one band
  // who never agreed on the tune.
  const shape = SHAPES[shapeForStyleVariant(o.style, o.variant ?? 0)];
  const stepTicks = o.barTicks / 16;
  const out: NoteEvent[] = [];

  const spans = chordSpans(progression, o.barTicks);

  for (const span of spans) {
    const bars = Math.round(span.ticks / o.barTicks);
    const spanEnd = span.start + span.ticks;
    for (let bar = 0; bar < bars; bar++) {
      const barStart = span.start + bar * o.barTicks;
      const place = placeOf(Math.round(barStart / o.barTicks), spans, o);
      // The phrase thins the bass too, and it is the part where that is most
      // dangerous — a bass full of holes stops holding the track up. Which is
      // exactly why it goes through `survivingHits`: whatever the floor would
      // take, a bar is never left with nothing.
      survivingHits(shape, stepTicks, o.barTicks, place).forEach((hit, i) => {
        const start = barStart + hit.stepOffset * stepTicks;
        if (start >= spanEnd) return;
        // Degree + 4 is the fifth in SCALE steps — the same [0, 2, 4] triad
        // diatonicTriad builds. Derived here rather than taken from that triad
        // so the bass never inherits an inversion chosen for the voicing of a
        // part sitting an octave or more above it.
        const degree = span.degree + (i % 2 === 0 ? 0 : 4);
        const bottom = o.octaveBase - BASS_DROP + (((o.key % 12) + 12) % 12);
        out.push({
          start,
          duration: Math.min(hit.durationSteps * stepTicks, spanEnd - start),
          midi: inRegister(
            scaleDegreeToMidi(degree, o.octaveBase - BASS_DROP, o.key, o.scale), bottom),
          velocity: BASS_VELOCITY,
        });
      });
    }
  }
  return out;
}
