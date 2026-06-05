// Velocity → continuous loudness. velToGain(v) = 0.3 + 1.1·(v/127) reproduces the
// engines' legacy binary factor at the old defaults: velToGain(80) ≈ 1.0 (old
// non-accent) and velToGain(115) ≈ 1.3 (old accent), while making everything in
// between continuous. Engines apply it as `oldNonAccentBase × velToGain(velocity)`.
export const DEFAULT_VELOCITY = 90; // new-note creation default (accent stays ≥100)

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
