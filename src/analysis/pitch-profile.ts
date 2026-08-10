// How much a piece of music leans on each of the twelve notes.
//
// One measurement, twelve numbers, and everything harmonic is built on it: what
// key something is in, which chord a bar implies, whether two loops will fight.
// Notes produce it here and audio produces the same shape elsewhere, so nothing
// downstream ever learns which one it came from.
//
// It is a PROFILE, not a histogram of hits. Counting note-ons would say a
// sixteenth-note hi-hat line of one pitch matters more than a bass note held
// through the bar, and the ear says the opposite. Three things scale a note's
// vote, each for a musical reason and each the smallest rule that captures it:
//
//   - HOW LONG it sounds, and HOW HARD it was struck. Presence, plainly. The
//     velocity curve is the engines' own, minus the accent punch: that extra
//     multiplier is an amplitude trick of the synth, and how loud a note is
//     rendered is not how much it names the harmony.
//   - HOW LOW it is. The bass carries the root; a lead running around above it
//     is decoration, however many notes it plays.
//   - WHERE IT FALLS. A note on the bar line is a statement, the same note on
//     the last sixteenth is a passing remark.
//
// Pure: no DOM, no AudioContext, no session objects. Given the same notes it
// returns the same twelve numbers for ever.

import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import { velToGain } from '../core/velocity-gain';

/** Twelve, and it is not a tunable. */
export const PITCH_CLASSES = 12;

/** The pitch a note is measured DOWN from, and the octave it takes to halve a
 *  note's vote.
 *
 *  36 is C2 — where a bass line lives — so the bass sits at full weight and
 *  everything above it is discounted smoothly. Two octaves to halve is gentle
 *  on purpose: a lead an octave up still counts for most of a bass note, since
 *  a melody does name the harmony, just less decisively than the root under it.
 *  Clamped so neither extreme runs away — a sub-bass rumble cannot drown the
 *  whole profile, and a piccolo line is quiet but never mute. */
const BASS_MIDI = 36;
const HALVE_OVER_SEMITONES = 24;
const MIN_PITCH_WEIGHT = 0.5;
const MAX_PITCH_WEIGHT = 2;

/** What a note's position in the bar is worth.
 *
 *  A bar line is the strongest place in music and a beat is the next; anything
 *  between them is passing. The two figures are deliberately mild — this is a
 *  thumb on the scale, not a filter, and a syncopated tune whose every accent
 *  lands off the beat must still be measurable. */
const ON_BAR = 1.5;
const ON_BEAT = 1.2;
const OFF_BEAT = 1;

function positionWeight(start: number, barTicks: number): number {
  if (barTicks <= 0) return OFF_BEAT;
  const inBar = ((start % barTicks) + barTicks) % barTicks;
  if (inBar === 0) return ON_BAR;
  return inBar % TICKS_PER_QUARTER === 0 ? ON_BEAT : OFF_BEAT;
}

function pitchWeight(midi: number): number {
  const w = 2 ** (-(midi - BASS_MIDI) / HALVE_OVER_SEMITONES);
  return Math.min(MAX_PITCH_WEIGHT, Math.max(MIN_PITCH_WEIGHT, w));
}

/** The twelve numbers for a run of notes.
 *
 *  Not normalised: the caller decides whether it wants a shape (divide by the
 *  sum) or a magnitude. Silence returns twelve zeroes, and that is a real
 *  answer rather than an empty one — NO evidence is different from evidence
 *  spread evenly, and a detector has to be able to tell those apart.
 *
 *  `barTicks` is only used to decide where inside a bar a note falls, so any
 *  number of bars can be measured at once. */
export function profileFromNotes(
  notes: readonly NoteEvent[], barTicks: number,
): Float32Array {
  const out = new Float32Array(PITCH_CLASSES);
  for (const note of notes) {
    // A zero-length note is a note nobody hears. Guarding here rather than
    // trusting the caller: this is fed by generators, by imports and by the
    // pattern library, and one of those will eventually hand over a zero.
    const held = Math.max(0, note.duration);
    if (held === 0) continue;
    const weight = held
      * velToGain(note.velocity)
      * pitchWeight(note.midi)
      * positionWeight(note.start, barTicks);
    out[((note.midi % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES] += weight;
  }
  return out;
}
