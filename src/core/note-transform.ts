// src/core/note-transform.ts
// Pure note-list transforms: variator, melodic inversion, retrograde.
// No DOM, no audio. All three are in-scale (for melodic lanes) and work
// on the flat NoteEvent[] that every clip carries.

import { TICKS_PER_STEP, type NoteEvent } from './notes';
import { midiToScaleDegree, scaleDegreeToMidi, type ScaleId } from './musicality';

// Use octaveBase=0 as internal reference — both midiToScaleDegree and
// scaleDegreeToMidi use it symmetrically so it cancels out for relative shifts.
const REF = 0;

function shiftDegree(midi: number, key: number, scale: ScaleId, delta: number): number {
  return scaleDegreeToMidi(midiToScaleDegree(midi, key, scale, REF) + delta, REF, key, scale);
}

export interface VariateOpts {
  key: number;
  scale: ScaleId;
  /** true for melodic/bass lanes; false for drum/beat lanes (preserves GM pitches). */
  melodic: boolean;
  /** Total tick length of the clip (used to clamp nudges and guard additions). */
  clipTicks: number;
  rng: () => number;
}

/**
 * A musical VARIATION of the pattern: keeps most of it, nudges some pitches to
 * neighbouring scale degrees, wobbles velocity/accents, occasionally shifts a
 * note in time, may drop or add one.  All output pitches are in-scale (melodic)
 * or unchanged (non-melodic / drums). Timing stays within [0, clipTicks).
 */
export function variateNotes(notes: readonly NoteEvent[], o: VariateOpts): NoteEvent[] {
  const out = notes.map((n) => ({ ...n }));

  for (const n of out) {
    // Pitch nudge (melodic only): 50 % chance, ±1 or ±2 scale degrees.
    if (o.melodic && o.rng() < 0.5) {
      const mag = o.rng() < 0.6 ? 1 : 2;
      n.midi = shiftDegree(n.midi, o.key, o.scale, o.rng() < 0.5 ? mag : -mag);
    }
    // Velocity / accent toggle: 30 % chance.
    if (o.rng() < 0.3) n.velocity = n.velocity >= 100 ? 80 : 115;
    // Timing nudge: 20 % chance, ±1 step (clamped to clip).
    if (o.rng() < 0.2) {
      const nudged = n.start + (o.rng() < 0.5 ? TICKS_PER_STEP : -TICKS_PER_STEP);
      if (nudged >= 0 && nudged + n.duration <= o.clipTicks) n.start = nudged;
    }
  }

  // Maybe drop one note (25 % chance, only when > 2 notes so the pattern survives).
  if (out.length > 2 && o.rng() < 0.25) out.splice(Math.floor(o.rng() * out.length), 1);

  // Maybe add one note derived from a random existing one (25 % chance).
  if (out.length > 0 && o.rng() < 0.25) {
    const base = out[Math.floor(o.rng() * out.length)];
    const midi = o.melodic
      ? shiftDegree(base.midi, o.key, o.scale, o.rng() < 0.5 ? 2 : -2)
      : base.midi;
    const start = base.start + TICKS_PER_STEP;
    if (start + TICKS_PER_STEP <= o.clipTicks) {
      out.push({ start, duration: TICKS_PER_STEP, midi, velocity: base.velocity });
    }
  }

  return out;
}

/**
 * Melodic inversion: mirrors pitches around the first note's scale degree so the
 * contour flips (rising → falling). All output pitches stay in-scale. Timing
 * and durations are unchanged.
 */
export function invertMelodic(notes: readonly NoteEvent[], key: number, scale: ScaleId): NoteEvent[] {
  if (notes.length === 0) return [];
  const degs = notes.map((n) => midiToScaleDegree(n.midi, key, scale, REF));
  const pivot = degs[0];
  return notes.map((n, i) => ({
    ...n,
    midi: scaleDegreeToMidi(2 * pivot - degs[i], REF, key, scale),
  }));
}

/**
 * Retrograde: plays the pattern back-to-front in time. Each note's new start is
 * `clipTicks - (originalStart + duration)`, clamped to 0. Pitches are unchanged.
 */
export function invertRetrograde(notes: readonly NoteEvent[], clipTicks: number): NoteEvent[] {
  return notes.map((n) => ({
    ...n,
    start: Math.max(0, clipTicks - (n.start + n.duration)),
  }));
}
