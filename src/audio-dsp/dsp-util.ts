// src/audio-dsp/dsp-util.ts
// Tiny pure helpers shared by every voice renderer. Previously each renderer
// re-declared its own identical copy of these.

/** Equal-tempered MIDI note → frequency (A4 = 69 = 440 Hz). */
export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Clamp to the [0, 1] range. */
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
