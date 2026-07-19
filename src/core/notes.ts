// Time-based note events for the polysynth track piano roll. Uses ticks at
// TICKS_PER_QUARTER resolution so notes can sit anywhere, not just on 16th
// boundaries.

export const TICKS_PER_QUARTER = 96;
export const TICKS_PER_STEP    = TICKS_PER_QUARTER / 4; // 24 (one 16th)

/** Equal-temperament MIDI note → Hz. A4 = 440 Hz (MIDI 69). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface NoteEvent {
  start: number;     // ticks from pattern start
  duration: number;  // ticks (min 1, snap suggested to TICKS_PER_STEP/2)
  midi: number;      // 0-127
  velocity: number;  // 0-127 (>= 100 = accent)
}

export function patternTicks(steps: number): number {
  return steps * TICKS_PER_STEP;
}
