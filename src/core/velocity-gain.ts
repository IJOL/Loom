// Velocity → continuous loudness. velToGain(v) = 0.3 + 1.1·(v/127) reproduces the
// engines' legacy binary factor at the old defaults: velToGain(80) ≈ 1.0 (old
// non-accent) and velToGain(115) ≈ 1.3 (old accent), while making everything in
// between continuous. Engines apply it as `oldNonAccentBase × velToGain(velocity)`.
// New-note creation default: slightly above the legacy non-accent level (80) so
// freshly drawn notes are clearly audible, while staying below the accent
// threshold (accent is still velocity ≥ 100).
export const DEFAULT_VELOCITY = 90;

export function velNorm(velocity: number): number {
  return Math.max(0, Math.min(127, velocity)) / 127;
}

export function velToGain(velocity: number): number {
  return 0.3 + 1.1 * velNorm(velocity);
}

/** Legacy callsites pass only an `accent` boolean and no velocity (auditions,
 *  note-FX). Resolve a velocity for them so loudness ≈ the old behaviour. */
export function resolveVelocity(velocity: number | undefined, accent: boolean): number {
  if (velocity != null) return velocity;
  return accent ? 115 : DEFAULT_VELOCITY;
}

// Accent emphasis: on top of the continuous velocity gain, an accented note
// (velocity ≥ 100) gets an extra loudness punch so accents pop — matching the
// app's binary accent model (which also brightens filter/Q). Tuned by ear + the
// engines' no-clip DSP tests.
export const ACCENT_PUNCH = 1.1;

/** Per-note loudness multiplier: continuous velocity gain × accent punch.
 *  Engines apply this as `oldNonAccentBase × velGain(velocity, accent)`. */
export function velGain(velocity: number | undefined, accent: boolean): number {
  return velToGain(resolveVelocity(velocity, accent)) * (accent ? ACCENT_PUNCH : 1);
}
