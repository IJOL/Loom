// Which style a lane draws from, and which scale darkness lands on.
//
// These two are grouped because both are macros that move SESSION state rather
// than an automation destination: the style a lane pulls its loops from, and
// the scale the whole scene is in.

import { STYLE_CATALOG, type StyleId, type ScaleId } from '../core/musicality';

/** Deterministic given (seed, laneIndex, salt).
 *
 *  This never reaches for Math.random, and that is the whole point: a lane must
 *  not change style because a curve was repainted or the panel re-rendered. The
 *  same scene has to draw the same way every time it is looked at. */
function hash(seed: number, laneIndex: number, salt: number): number {
  let h = (seed * 2654435761 + laneIndex * 40503 + salt * 2246822519) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

export function styleForLane(
  base: StyleId, mix: number, laneIndex: number, seed: number, forced?: StyleId,
): StyleId {
  // A forced style is the user speaking, so the macro gets no vote. That is the
  // entire purpose of the per-lane override.
  if (forced) return forced;
  if (mix <= 0) return base;

  // Two independent draws: one decides WHETHER this lane strays, the other
  // WHERE to. Sharing one would make the choice of style correlate with how
  // likely the lane was to move, which reads as the same few styles always
  // winning.
  if (hash(seed, laneIndex, 0) >= mix) return base;

  // Never draw the base itself, or "strayed" would sometimes mean "stayed".
  const others = STYLE_CATALOG.filter((s) => s.id !== base);
  if (others.length === 0) return base;
  const i = Math.min(others.length - 1, Math.floor(hash(seed, laneIndex, 1) * others.length));
  return others[i].id;
}

/** Brightest first, so a HIGH darkness lands at the dark end.
 *
 *  Every step down this ladder flattens exactly ONE degree — lydian ♮4→ major
 *  ♭7→ mixolydian ♭3→ dorian ♭6→ minor ♭2→ phrygian — which is what makes the
 *  knob read as a gradual darkening. It was four scales and major→dorian moved
 *  TWO notes at once, twice the size of every other step: reported as "darkness
 *  is almost a switch". Mixolydian is the missing rung; lydian extends the
 *  bright end by the same single-degree rule rather than by taste.
 *
 *  It cannot be made continuous, and that is not a defect to work around: notes
 *  are a semitone apart and a third of a semitone is detuning, not colour. The
 *  most a scale control can offer is steps this small. */
export const DARKNESS_SCALES: readonly ScaleId[] =
  ['lydian', 'major', 'mixolydian', 'dorian', 'minor', 'phrygian'];

export function scaleForDarkness(darkness: number): ScaleId {
  const d = Math.min(1, Math.max(0, darkness));
  // Math.floor(1 * n) is n, one past the last index -- hence the cap.
  const i = Math.min(DARKNESS_SCALES.length - 1, Math.floor(d * DARKNESS_SCALES.length));
  return DARKNESS_SCALES[i];
}
