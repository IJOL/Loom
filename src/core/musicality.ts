// src/core/musicality.ts
// Single source of truth for scales/tonality across all of Loom. Pure: no DOM,
// no audio. Consumed by the piano-roll (highlight + lock), generators,
// and the example gallery.

export type ScaleId = 'minor' | 'major' | 'pentMinor' | 'phrygian' | 'dorian' | 'chromatic';
// Style ids are the genre keys of the pattern library, verbatim, so a lookup is
// `patterns[style]` with no translation table to drift. The five original ids
// were combined styles ("Acid / Techno", "Lo-fi / Ambient"); the library splits
// them, so acid → acid-techno and lofi → lo-fi, with techno and ambient now
// standing on their own.
export type StyleId =
  | 'techno' | 'acid-techno' | 'trance' | 'dub-techno' | 'idm' | 'edm'
  | 'drum-and-bass' | 'house' | 'breakbeat' | 'jungle' | 'garage' | 'ambient'
  | 'glitch' | 'electro' | 'downtempo' | 'dubstep' | 'lo-fi' | 'synthwave'
  | 'deep-house' | 'psytrance';

const INTERVALS: Record<ScaleId, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  dorian:    [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export interface ScaleEntry { id: ScaleId; label: string; mood: string; hint: string; }
export const SCALE_CATALOG: ScaleEntry[] = [
  { id: 'minor',     label: 'minor',            mood: '🌙 Dark / tense',                hint: 'the classic acid/techno sound' },
  { id: 'pentMinor', label: 'pentatonic minor',  mood: '🛡️ Safe (almost anything fits)', hint: 'hard to sound wrong; riffs & basslines' },
  { id: 'major',     label: 'major',            mood: '☀️ Bright / open',               hint: 'pop, most "happy" music' },
  { id: 'phrygian',  label: 'phrygian',         mood: '🔥 Mysterious / hypnotic',       hint: 'dark acid, EBM' },
  { id: 'dorian',    label: 'dorian',           mood: '🌊 Groovy / swung',              hint: 'house & funk' },
  { id: 'chromatic', label: 'chromatic',        mood: '🎛️ Anything goes (no net)',      hint: 'any note; no safety net' },
];

export interface StyleEntry { id: StyleId; label: string; }
// Ordered by family (four-to-the-floor → broken → bass → downtempo → leftfield)
// rather than alphabetically, so neighbours in the dropdown sound like neighbours.
export const STYLE_CATALOG: StyleEntry[] = [
  { id: 'techno',        label: 'Techno' },
  { id: 'acid-techno',   label: 'Acid Techno' },
  { id: 'dub-techno',    label: 'Dub Techno' },
  { id: 'house',         label: 'House' },
  { id: 'deep-house',    label: 'Deep House' },
  { id: 'garage',        label: 'Garage' },
  { id: 'trance',        label: 'Trance' },
  { id: 'psytrance',     label: 'Psytrance' },
  { id: 'edm',           label: 'EDM' },
  { id: 'breakbeat',     label: 'Breakbeat / Big Beat' },
  { id: 'drum-and-bass', label: 'Drum & Bass' },
  { id: 'jungle',        label: 'Jungle' },
  { id: 'dubstep',       label: 'Dubstep' },
  { id: 'electro',       label: 'Electro' },
  { id: 'synthwave',     label: 'Synthwave' },
  { id: 'idm',           label: 'IDM' },
  { id: 'glitch',        label: 'Glitch' },
  { id: 'downtempo',     label: 'Downtempo' },
  { id: 'lo-fi',         label: 'Lo-fi' },
  { id: 'ambient',       label: 'Ambient' },
];

const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function scaleIntervals(scale: ScaleId): number[] {
  return INTERVALS[scale] ?? INTERVALS.minor;
}
export function rootName(pc: number): string {
  return ROOT_NAMES[((pc % 12) + 12) % 12];
}
/** Pitch classes (0-11) that belong to `scale` rooted at `key`. */
export function degreesOf(key: number, scale: ScaleId): number[] {
  const k = ((key % 12) + 12) % 12;
  return scaleIntervals(scale).map((iv) => (k + iv) % 12);
}
export function inScale(midi: number, key: number, scale: ScaleId): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return degreesOf(key, scale).includes(pc);
}
/** Nearest in-scale midi. Ties (equal distance up/down) resolve UP. */
export function snapToScale(midi: number, key: number, scale: ScaleId): number {
  if (inScale(midi, key, scale)) return midi;
  for (let d = 1; d <= 6; d++) {
    if (inScale(midi + d, key, scale)) return midi + d; // up wins ties (checked first)
    if (inScale(midi - d, key, scale)) return midi - d;
  }
  return midi; // unreachable for the defined scales (max gap between in-scale notes is 2 semitones)
}
/** Map a scale-degree index (0-based, may exceed the scale length → wraps octaves)
 *  to an absolute midi, relative to `octaveBase` (midi of the scale root in the
 *  lowest on-screen octave). */
export function scaleDegreeToMidi(degree: number, octaveBase: number, key: number, scale: ScaleId): number {
  const ivs = scaleIntervals(scale);
  const n = ivs.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  const k = ((key % 12) + 12) % 12;
  return octaveBase + k + ivs[idx] + 12 * oct;
}

/** Inverse of scaleDegreeToMidi. Returns the degree index (0-based, may be
 *  negative or exceed scale length) such that:
 *    scaleDegreeToMidi(result, octaveBase, key, scale) === snapToScale(midi, key, scale)
 *  Works by snapping midi to scale first, then computing the semitone offset
 *  from the scale root at octaveBase and walking scaleIntervals across octaves. */
export function midiToScaleDegree(midi: number, key: number, scale: ScaleId, octaveBase: number): number {
  const snapped = snapToScale(midi, key, scale);
  const ivs = scaleIntervals(scale);
  const n = ivs.length;
  const k = ((key % 12) + 12) % 12;
  // Semitone distance from the root at octaveBase (can be negative)
  const semiOffset = snapped - (octaveBase + k);
  // Which octave does the note fall in relative to the root?
  const octave = Math.floor(semiOffset / 12);
  // Semitone within that octave (interval relative to root pitch class)
  const semitoneInOct = ((semiOffset % 12) + 12) % 12;
  // Find the degree index within the octave by matching the interval
  const degInOct = ivs.indexOf(semitoneInOct);
  // degInOct should always be found (snapToScale guarantees an in-scale result)
  return octave * n + degInOct;
}
