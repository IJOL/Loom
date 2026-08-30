// src/notefx/chord-presets.ts
// The chord card's factory bank: named starting points over the processor's
// params, the way a Reason Player ships patches. Pure data + one apply
// function — the UI owns the dropdown, this file owns what is in it.

import { CHORD_PROCESSOR_DEFAULTS, type ChordProcessorParams } from './chord-processor';

export interface ChordFxPreset {
  id: string;
  name: string;
  params: Partial<ChordProcessorParams>;
}

// Diatonic-first on purpose: the bank is what teaches that the mode exists.
export const CHORD_FX_PRESETS: ChordFxPreset[] = [
  { id: 'diatonic-triads', name: 'Diatonic Triads',
    params: { chordType: 'diatonic', notes: 3 } },
  { id: 'diatonic-7ths', name: 'Diatonic 7ths',
    params: { chordType: 'diatonic', notes: 4 } },
  { id: 'open-pad', name: 'Open Pad',
    params: { chordType: 'diatonic', notes: 4, open: true, addOctDown: true } },
  { id: 'deep-9ths', name: 'Deep House 9ths',
    params: { chordType: 'diatonic', notes: 4, color: true, inversion: 1 } },
  { id: 'house-stab', name: 'House Stab',
    params: { chordType: 'diatonic', notes: 4, inversion: 2 } },
  { id: 'guitar-open', name: 'Open Guitar',
    params: { chordType: 'diatonic', notes: 3, open: true, addOctUp: true } },
  { id: 'full-stack', name: 'Full Stack',
    params: { chordType: 'diatonic', notes: 5, color: true, addOctDown: true } },
  { id: 'outside-jazz', name: 'Outside Jazz',
    params: { chordType: 'diatonic', notes: 4, alter: true, color: true } },
  { id: 'epic-wide', name: 'Epic Wide',
    params: { chordType: 'diatonic', notes: 3, addOctUp: true, addOctDown: true } },
  { id: 'power-5ths', name: 'Power 5ths',
    params: { chordType: 'free', i1: 7, i2: 12, i3: 0 } },
  { id: 'trance-octaves', name: 'Trance Octaves',
    params: { chordType: 'free', i1: 12, i2: 0, i3: 0 } },
  { id: 'sus-dream', name: 'Sus Dream',
    params: { chordType: 'sus2', conform: 'scale' } },
];

/** Reset the bag to defaults, then write the preset's params over it — a
 *  preset is THE sound, so a toggle it does not name must come out at its
 *  default rather than survive from whatever was dialled before. Unknown ids
 *  change nothing: the bag a user tweaked beats a preset that does not exist. */
export function applyChordFxPreset(
  bag: Record<string, number | string | boolean>, id: string,
): void {
  const preset = CHORD_FX_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  Object.assign(bag, CHORD_PROCESSOR_DEFAULTS, preset.params);
}
