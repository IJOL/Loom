// The arp: the chord's own notes, one at a time, up.
//
// Not to be confused with the `arp` note-FX, which is a different thing under
// the same name. That one takes ONE root and walks a hardcoded scale table of
// its own (pentatonic minor by default), unrelated to the session's key — so
// two notes played together come out as two independent scale walks, and it can
// leave the key without noticing. Two of its patterns call Math.random().
//
// This walks the CHORD TONES of the inferred progression, in the session's key,
// and gives the same answer every time. It must: the offline render has to
// match what was heard live.

import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';
import { diatonicTriad } from '../../core/harmony';
import type { Progression } from '../../arranger/progression';
import { chordSpans, placeOf, type PartOptions } from '../part-types';
import { inHole } from '../phrase';

const ARP_VELOCITY = 96;

export function renderArp(progression: Progression, o: PartOptions): NoteEvent[] {
  const out: NoteEvent[] = [];
  const spans = chordSpans(progression, o.barTicks);
  for (const span of spans) {
    // Root position on every chord, deliberately NOT voice-led. An arpeggio is
    // heard as a line, and inverting it to sit near the previous chord would
    // put that line's contour at the mercy of a rule written for stacked
    // voicings — the pad wants the nearest inversion, a melody does not.
    const tones = diatonicTriad(span.degree, o.octaveBase, o.key, o.scale);
    const steps = Math.max(1, Math.round(span.ticks / TICKS_PER_STEP));
    for (let i = 0; i < steps; i++) {
      const start = span.start + i * TICKS_PER_STEP;
      // The HOLE only — never the floor. An arpeggio kept to its strong
      // positions is not a lighter arpeggio, it is a different part: the
      // unbroken stream is what makes it one. Dropping out for half of the
      // turnaround is the device a player would use on it anyway.
      const place = placeOf(Math.floor(start / o.barTicks), spans, o);
      if (inHole(start % o.barTicks, o.barTicks, place)) continue;
      out.push({
        start,
        duration: Math.min(TICKS_PER_STEP, span.start + span.ticks - start),
        // Modulo the triad, so the walk restarts at the root each pass and the
        // figure repeats rather than climbing out of its register.
        midi: tones[i % tones.length],
        velocity: ARP_VELOCITY,
      });
    }
  }
  return out;
}
