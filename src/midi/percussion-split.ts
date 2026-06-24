// src/midi/percussion-split.ts
// Pure logic for the MIDI-import percussion handling. A channel-10 (drum) track
// often mixes a standard kit (kick/snare/hi-hats/toms/cymbals) with auxiliary
// percussion (shaker/tambourine/congas…). The standard kit is covered by the
// 808/909/tidal kits; the auxiliary percussion is covered by the GM Percussion
// sample kit. So on import we PARTITION a drum track's notes into those two
// groups and may create two lanes (a normal drum lane + a percussion lane).
//
// Detection is by CHANNEL, not by track name: a track named "Drums" can be
// melodic (and lives on a melodic channel), and percussion can be mislabelled —
// the reliable signal is "most note-ons on MIDI channel 10" (0-based 9).

import type { NoteEvent } from '../core/notes';

/** The GM Percussion sample kit's notes (auxiliary/Latin perc): 54, 56, 58 and
 *  60..87. These are the pads in public/drumkits/gm-percussion.json. Kept in sync
 *  with the generator's PADS table. */
export const PERC_KIT_NOTES: ReadonlySet<number> = new Set([
  54, 56, 58,
  60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
  76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
]);

/** A pad in the GM Percussion kit (→ goes to the percussion lane). */
export function isPercKitNote(midi: number): boolean {
  return PERC_KIT_NOTES.has(midi);
}

/** A standard-kit drum note: any GM percussion note (27..87) NOT in the GM
 *  Percussion kit — i.e. kick/snare/hi-hats/toms/cymbals + GM2 lows. */
export function isStandardDrumNote(midi: number): boolean {
  return midi >= 27 && midi <= 87 && !PERC_KIT_NOTES.has(midi);
}

export interface DrumSplit {
  /** Standard-kit notes (kick/snare/hats/toms/cymbals). */
  drum: NoteEvent[];
  /** GM-percussion-kit notes (shaker/tambourine/congas…). */
  perc: NoteEvent[];
}

/** Partition a drum track's notes into standard-kit vs GM-percussion. Notes
 *  outside the GM percussion range (27..87) — e.g. 88+ noise, very low samples —
 *  are dropped (they have no pad in either kit). */
export function partitionDrumNotes(notes: readonly NoteEvent[]): DrumSplit {
  const drum: NoteEvent[] = [];
  const perc: NoteEvent[] = [];
  for (const n of notes) {
    if (isPercKitNote(n.midi)) perc.push(n);
    else if (isStandardDrumNote(n.midi)) drum.push(n);
    // else: dropped (no pad in either kit)
  }
  return { drum, perc };
}

/** Distinct pitch count in a note list. */
export function distinctPitchCount(notes: readonly NoteEvent[]): number {
  return new Set(notes.map((n) => n.midi)).size;
}

/** Decide which lanes an imported drum track produces. A standard-drum lane is
 *  created whenever there are drum notes (a "full kit" is >2 distinct, but even a
 *  couple of kit hits still belong on a normal kit). A percussion lane is created
 *  whenever there are GM-percussion notes. A mixed track yields BOTH. */
export interface DrumLanePlan {
  drum: NoteEvent[] | null;  // null ⇒ no standard-drum lane
  perc: NoteEvent[] | null;  // null ⇒ no percussion lane
}

export function planDrumLanes(notes: readonly NoteEvent[]): DrumLanePlan {
  const { drum, perc } = partitionDrumNotes(notes);
  return {
    drum: drum.length ? drum : null,
    perc: perc.length ? perc : null,
  };
}
