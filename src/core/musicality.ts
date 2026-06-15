// src/core/musicality.ts
// Única fuente de verdad de escalas/tonalidad para todo Loom. Puro: sin DOM,
// sin audio. Lo consumen el piano-roll (resaltado + candado), los generadores
// y la galería de ejemplos.

export type ScaleId = 'minor' | 'major' | 'pentMinor' | 'phrygian' | 'dorian' | 'chromatic';
export type StyleId = 'acid' | 'house' | 'synthwave' | 'lofi';

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
  { id: 'minor',     label: 'menor',          mood: '🌙 Oscura / tensa',       hint: 'el sonido acid/techno clásico' },
  { id: 'pentMinor', label: 'pentatónica menor', mood: '🛡️ Segura (casi todo pega)', hint: 'difícil sonar mal; riffs y bajos' },
  { id: 'major',     label: 'mayor',          mood: '☀️ Alegre / abierta',      hint: 'pop, casi todo lo "feliz"' },
  { id: 'phrygian',  label: 'frigia',         mood: '🔥 Misteriosa / hipnótica', hint: 'acid oscuro, EBM' },
  { id: 'dorian',    label: 'dórica',         mood: '🌊 Groovy / con swing',    hint: 'house y funk' },
  { id: 'chromatic', label: 'cromática',      mood: '🎛️ Todo vale (sin red)',   hint: 'cualquier nota; sin ayuda' },
];

export interface StyleEntry { id: StyleId; label: string; }
export const STYLE_CATALOG: StyleEntry[] = [
  { id: 'acid',      label: 'Acid / Techno' },
  { id: 'house',     label: 'House' },
  { id: 'synthwave', label: 'Synthwave / Electro' },
  { id: 'lofi',      label: 'Lo-fi / Ambient' },
];

const ROOT_NAMES_ES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

export function scaleIntervals(scale: ScaleId): number[] {
  return INTERVALS[scale] ?? INTERVALS.minor;
}
export function rootNameEs(pc: number): string {
  return ROOT_NAMES_ES[((pc % 12) + 12) % 12];
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
