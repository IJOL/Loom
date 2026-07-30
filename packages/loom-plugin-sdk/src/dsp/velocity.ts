// @loom/plugin-sdk — dsp/velocity.ts — the single owner of "note velocity +
// accent flag → this voice's amplitude gain". Two spellings of ONE curve: velGain() for the
// 0..127 MIDI-domain callers, velGain01() for the worklet renderers, which get
// velocity already normalised.
//
// KEEP THIS MODULE DEPENDENCY-FREE: it is imported by the AudioWorklet DSP kernel
// (src/audio-dsp/*-renderer.ts), which has no DOM and no Web Audio globals.
//
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

// Accent emphasis: on top of the continuous velocity gain, an accented note
// (velocity ≥ 100) gets an extra loudness punch so accents pop — matching the
// app's binary accent model (which also brightens filter/Q). Tuned by ear + the
// engines' no-clip DSP tests.
export const ACCENT_PUNCH = 1.1;

/** The TB-303's accent also raises Q — and a diode ladder gets QUIETER as Q climbs
 *  (its feedback is subtracted), unlike the Svf it replaced, whose resonant peak
 *  added level. At ACCENT_PUNCH the 303's accent came out *quieter* than the note
 *  it is meant to punch. 1.3 restores "accent is louder", which on a real 303 is a
 *  large VCA jump anyway (~6 dB), far more than the 0.8 dB 1.1 buys.
 *
 *  This is an AMP punch an engine opts into, never a timbre multiplier. */
export const ACCENT_VCA_LADDER = 1.3;

/** The one place the velocity curve is spelled out. 0..1 sibling of velGain:
 *  `NoteSpec.velocity` reaches the worklet renderers already normalised, so they
 *  cannot use the 0..127 spelling below — that mismatch is why six renderers each
 *  re-inlined this and two of them lost the curve entirely.
 *
 *  `accentMul` lets an engine declare its own amp punch (see ACCENT_VCA_LADDER). */
export function velGain01(v01: number, accent: boolean, accentMul = ACCENT_PUNCH): number {
  const g = 0.3 + 1.1 * Math.max(0, Math.min(1, v01));
  return accent ? g * accentMul : g;
}

export function velToGain(velocity: number): number {
  return velGain01(velNorm(velocity), false);
}

/** Legacy callsites pass only an `accent` boolean and no velocity (auditions,
 *  note-FX). Resolve a velocity for them so loudness ≈ the old behaviour. */
export function resolveVelocity(velocity: number | undefined, accent: boolean): number {
  if (velocity != null) return velocity;
  return accent ? 115 : DEFAULT_VELOCITY;
}

/** Per-note loudness multiplier for the 0..127 (MIDI-domain) callers: continuous
 *  velocity gain × accent punch. Engines apply this as
 *  `oldNonAccentBase × velGain(velocity, accent)`. */
export function velGain(velocity: number | undefined, accent: boolean): number {
  return velGain01(velNorm(resolveVelocity(velocity, accent)), accent);
}
