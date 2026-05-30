// src/samples/keymap.ts
// Pure keymap resolution + repitch math. No audio, no DOM.

import type { KeymapEntry } from './types';

/** The entry that should play for `midi`. Last matching entry wins, so a
 *  single-note pad added after a broad melodic range overrides it on that
 *  note. Returns undefined when nothing covers the note. */
export function keymapEntryFor(keymap: KeymapEntry[], midi: number): KeymapEntry | undefined {
  let found: KeymapEntry | undefined;
  for (const e of keymap) {
    if (midi >= e.loNote && midi <= e.hiNote) found = e;
  }
  return found;
}

/** Playback rate for a one-shot: equal-temperament repitch from the root,
 *  plus an optional global pitch offset (semitones). */
export function repitchRate(midi: number, rootNote: number, pitchSemitones = 0): number {
  return Math.pow(2, (midi - rootNote + pitchSemitones) / 12);
}
