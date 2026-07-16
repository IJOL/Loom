// SPDX-License-Identifier: AGPL-3.0-or-later
// Converts mpump's pattern library into Loom NoteEvents.
//
// The patterns themselves come from mpump (https://github.com/gdamdam/mpump),
// AGPL-3.0-or-later, same licence as Loom. mpump stores a pattern as one entry
// per 16th step; Loom stores free NoteEvents in ticks, so a step index becomes
// `step * TICKS_PER_STEP`.

import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';

/** A drum hit in mpump's format: a GM-ish MIDI note plus 0-127 velocity. */
export interface MpumpDrumHit {
  note: number;
  vel: number;
}

/** One mpump drum pattern: per step, the hits that fire on it (empty = rest). */
export type MpumpDrumPattern = MpumpDrumHit[][];

/** mpump numbers its clap and cowbell off the 808 layout; in GM those are toms,
 *  so they must be remapped or they fire the wrong voice. Every other drum note
 *  mpump uses (kick 36, snare 38, hats 42/46, ride 51) is already GM. */
const MPUMP_TO_GM: Record<number, number> = {
  50: 39, // clap
  47: 56, // cowbell
};

/** A melodic step in mpump's format: a semitone offset from the root the user
 *  is playing, velocity as 0..1, and the TB-303-style slide flag. */
export interface MpumpStep {
  semi: number;
  vel: number;
  slide: boolean;
}

/** One mpump melodic pattern (synth or bass): null = rest. */
export type MpumpMelodicPattern = (MpumpStep | null)[];

/** A sliding step must still be sounding when the next one triggers — that
 *  overlap IS the slide, and matches the 1.5x the lane scheduler already uses
 *  for a slid step. */
const SLIDE_DURATION = TICKS_PER_STEP * 1.5;

export function melodicPatternToNotes(pattern: MpumpMelodicPattern, rootMidi: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let step = 0; step < pattern.length; step++) {
    const s = pattern[step];
    if (!s) continue;
    out.push({
      start: step * TICKS_PER_STEP,
      duration: s.slide ? SLIDE_DURATION : TICKS_PER_STEP,
      midi: rootMidi + s.semi,
      velocity: Math.round(s.vel * 127),
    });
  }
  return out;
}

export function drumPatternToNotes(pattern: MpumpDrumPattern): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let step = 0; step < pattern.length; step++) {
    for (const hit of pattern[step]) {
      out.push({
        start: step * TICKS_PER_STEP,
        duration: TICKS_PER_STEP,
        midi: MPUMP_TO_GM[hit.note] ?? hit.note,
        velocity: hit.vel,
      });
    }
  }
  return out;
}
