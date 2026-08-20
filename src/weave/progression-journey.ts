// A progression that travels, instead of one that loops.
//
// WEAVE moves everything about a scene except its harmony. The loops cross-fade,
// the style strays, the macros breathe — and underneath it the chords are the
// one thing that picked a shape at the start and repeats it until somebody
// changes it by hand. Reported in exactly those words: "chords no es dinámico",
// "lo quiero dinámico en contexto weave".
//
// So the progression takes the same journey the loops take, measured in the
// same LEGS, and the rules are the ones a player uses rather than a shuffle:
//
//   - The FIRST chord never moves. Home is what a departure is measured
//     against; a progression whose tonic wanders is not a variation of itself,
//     it is a different progression, and the ear hears a modulation nobody
//     asked for.
//   - An INTERIOR chord may be swapped for its diatonic relative — the chord a
//     third away, which shares two of its three notes. That is the substitution
//     that changes the colour without breaking the shape, and it is why a
//     relative minor sounds like the same tune and a random degree does not.
//   - The LAST chord is the TURNAROUND, and it is the one a player actually
//     varies: alternating it with V is the oldest way there is of pushing back
//     into the top of the phrase.
//
// ONE slot moves per leg, never a re-deal. The style draw learned this the hard
// way — thrown every leg it was a different style every lap, which is churn and
// not travel — and harmony is far less forgiving than timbre: two chords
// changing at once reads as a wrong chord, where one reads as a variation.
//
// Pure: a progression and a leg number in, a progression out. No state, no
// clock, no DOM — and deterministic, because the offline render has to produce
// the same harmony that was heard live.

import type { Chord, Progression } from '../arranger/progression';

/** Degrees in the scale the progression is walking. Seven unless the session is
 *  in something smaller, and it matters: a relative a third away is `+2` steps
 *  of THIS scale, not of a major one. */
const DEFAULT_SCALE_LEN = 7;

/** The dominant, 0-based. The turnaround chord in every idiom that has one. */
const DOMINANT = 4;

/** Deterministic and cheap. Not `Math.random`: the same leg must produce the
 *  same harmony in the offline render as it did through the speakers. */
function hash(a: number, b: number, c: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The chord a third away — up or down, whichever this leg chose.
 *
 *  Both share two of their three notes with the original, which is what makes
 *  the swap sound like a re-voicing rather than a mistake. Up and down are
 *  genuinely different colours, so the choice is made rather than fixed. */
function relativeOf(degree: number, len: number, up: boolean): number {
  const step = up ? 2 : len - 2;
  return (((degree + step) % len) + len) % len;
}

export interface JourneyOptions {
  /** How many degrees the scale has. Default 7. */
  scaleLen?: number;
  /** The session's seed, so two sessions do not take the same journey. */
  seed?: number;
}

/**
 * The progression as it stands after `leg` legs of travel.
 *
 * At leg 0 it is the base, untouched — a session that has not travelled plays
 * precisely what it always played, which is what makes this safe to have on by
 * default. A progression of fewer than two chords has nothing to vary and is
 * returned as it came: "Stay home" means stay home.
 */
export function travelProgression(
  base: Progression, leg: number, o: JourneyOptions = {},
): Progression {
  if (!Number.isFinite(leg) || leg <= 0 || base.length < 2) return base.map((c) => ({ ...c }));
  const len = Math.max(3, Math.floor(o.scaleLen ?? DEFAULT_SCALE_LEN));
  const seed = Math.floor(o.seed ?? 0);
  const out: Chord[] = base.map((c) => ({ ...c }));
  const last = out.length - 1;

  // The turnaround, on alternate legs. Alternating rather than random because
  // its whole effect is that it comes and goes: a V that is always there is not
  // a turnaround, it is the fourth chord of the progression.
  if (leg % 2 === 1 && base[last].degree !== DOMINANT) out[last].degree = DOMINANT;

  // Then ONE interior chord — strictly between the anchor and the turnaround,
  // so neither of the two slots that carry the phrase's shape is touched by
  // this. With three chords or fewer there is no interior, and the turnaround
  // above is the whole of the journey.
  const interior = last - 1;
  if (interior >= 1) {
    const slot = 1 + ((leg - 1) % interior);
    const h = hash(seed, leg, slot);
    // Not every leg moves one: a third of them leave the progression alone
    // apart from the turnaround, which is what keeps this from feeling like a
    // machine working its way down a list.
    if (h % 3 !== 0) out[slot].degree = relativeOf(base[slot].degree, len, (h >>> 8) % 2 === 0);
  }
  return out;
}
