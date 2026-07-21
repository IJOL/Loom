// src/engines/note-name.ts
// Pure MIDI-note → name helper (e.g. 60 → "C4"). Extracted from
// sampler-keyboard-map so lightweight modules (the sampler metadata descriptor,
// automation sub-group labels) can name a note without importing the keymap
// renderer's DOM code.
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const pc = (m: number): number => ((m % 12) + 12) % 12;
/** e.g. 60 → "C4" (the octave convention Loom's sampler UI already shows). */
export const noteName = (m: number): string => `${NOTE_NAMES[pc(m)]}${Math.floor(m / 12) - 1}`;
