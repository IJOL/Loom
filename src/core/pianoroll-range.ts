// src/core/pianoroll-range.ts
// Pure (DOM-free) pitch range for the melodic clip editors (piano roll).

import type { NoteEvent } from './notes';

export const EDITOR_MIN_MIDI = 12;   // C0 — full orchestral range floor
export const EDITOR_MAX_MIDI = 108;  // C8 — full orchestral range ceiling

/** Pitch range for a clip's piano-roll editor.
 *
 *  Spans the full orchestral range (C0..C8) so any note is writable, and is
 *  ALWAYS widened to include every note the clip already contains — so no clip
 *  note is ever hidden/uneditable (the editor clips notes outside [min,max]).
 *  Row height shrinks as the range grows; that's fine — the editor zooms. */
export function pianoRollRange(notes: readonly NoteEvent[]): { minMidi: number; maxMidi: number } {
  let minMidi = EDITOR_MIN_MIDI;
  let maxMidi = EDITOR_MAX_MIDI;
  for (const n of notes) {
    if (n.midi < minMidi) minMidi = n.midi;
    if (n.midi > maxMidi) maxMidi = n.midi;
  }
  return { minMidi, maxMidi };
}
