// Pure, DOM-free logic for the piano-roll editing UX (Spec 2): the computer-
// keyboard note map, marquee hit-testing, group-move clamping, clipboard
// serialize/paste, and recorded-note quantization. pianoroll.ts is thin canvas
// glue around these.

import type { NoteEvent } from './notes';

// Standard piano-typing layout: home row a s d f g h j k = white C D E F G A B C;
// upper row w e t y u = black C# D# F# G# A#. Other keys are unused.
export const KEY_SEMITONES: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};

// Complete piano-roll keyboard legend (notes + all editing shortcuts). Kept next
// to KEY_SEMITONES so the on-screen help and the actual key handling cannot drift.
// A coherence test asserts every live key/shortcut is mentioned here.
export const PIANO_KEY_LEGEND =
  'Keyboard:  a s d f g h j k = notes (C…C) · w e t y u = sharps\n' +
  '           z / x = octave down / up · 1 / 2 = pencil / select\n' +
  '           Ctrl+A = select all · Ctrl+C / Ctrl+X / Ctrl+V = copy / cut / paste\n' +
  '           Esc = deselect · ←/→ = move cursor (or nudge with a selection)\n' +
  '           ↑/↓ = transpose selection · ⌫ = delete';

export function keyToSemitone(key: string): number | null {
  const s = KEY_SEMITONES[key.toLowerCase()];
  return s === undefined ? null : s;
}

export function midiForKey(key: string, octaveBase: number): number | null {
  const semi = keyToSemitone(key);
  return semi === null ? null : octaveBase + semi;
}

export interface GridRect { tick0: number; tick1: number; midi0: number; midi1: number; }

/** Notes whose body intersects the rect (corners may be given in any order). */
export function notesInRect(notes: readonly NoteEvent[], rect: GridRect): NoteEvent[] {
  const t0 = Math.min(rect.tick0, rect.tick1), t1 = Math.max(rect.tick0, rect.tick1);
  const m0 = Math.min(rect.midi0, rect.midi1), m1 = Math.max(rect.midi0, rect.midi1);
  return notes.filter((n) =>
    n.midi >= m0 && n.midi <= m1 && n.start < t1 && n.start + n.duration > t0);
}

export interface Bounds { patternTicks: number; minMidi: number; maxMidi: number; }

/** Clamp a desired (dTick,dMidi) so EVERY note stays in bounds; preserves shape.
 *  Also serves to pull an already-out-of-bounds group back in (pass 0,0). */
export function translateGroup(
  notes: readonly NoteEvent[], dTick: number, dMidi: number, b: Bounds,
): { dTick: number; dMidi: number } {
  if (notes.length === 0) return { dTick: 0, dMidi: 0 };
  let minStart = Infinity, maxEnd = -Infinity, minMidi = Infinity, maxMidi = -Infinity;
  for (const n of notes) {
    minStart = Math.min(minStart, n.start);
    maxEnd = Math.max(maxEnd, n.start + n.duration);
    minMidi = Math.min(minMidi, n.midi);
    maxMidi = Math.max(maxMidi, n.midi);
  }
  const loT = -minStart, hiT = b.patternTicks - maxEnd;
  const loM = b.minMidi - minMidi, hiM = b.maxMidi - maxMidi;
  return {
    dTick: Math.max(loT, Math.min(hiT, dTick)),
    dMidi: Math.max(loM, Math.min(hiM, dMidi)),
  };
}

export interface ClipboardNote { dStart: number; midi: number; duration: number; velocity: number; }

/** Snapshot selected notes relative to the group's earliest start. */
export function serializeClipboard(selected: readonly NoteEvent[]): ClipboardNote[] {
  if (selected.length === 0) return [];
  const minStart = Math.min(...selected.map((n) => n.start));
  return selected.map((n) => ({
    dStart: n.start - minStart, midi: n.midi, duration: n.duration, velocity: n.velocity,
  }));
}

/** Build fresh notes anchored so the earliest clipboard note lands at
 *  (anchorTick, anchorMidi); the rest keep their relative offsets. Clamped. */
export function pasteTranslate(
  clip: readonly ClipboardNote[], anchorTick: number, anchorMidi: number, b: Bounds,
): NoteEvent[] {
  if (clip.length === 0) return [];
  const ref = clip.find((n) => n.dStart === 0) ?? clip[0];
  const built: NoteEvent[] = clip.map((n) => ({
    start: anchorTick + n.dStart,
    duration: n.duration,
    midi: anchorMidi + (n.midi - ref.midi),
    velocity: n.velocity,
  }));
  const adj = translateGroup(built, 0, 0, b);
  return built.map((n) => ({ ...n, start: n.start + adj.dTick, midi: n.midi + adj.dMidi }));
}

/** Snap a recorded note (keydown→keyup ticks) to the grid, min one snap long. */
export function quantizeRecorded(startTick: number, endTick: number, snap: number): { start: number; duration: number } {
  const start = Math.max(0, Math.round(startTick / snap) * snap);
  const rawDur = Math.max(0, endTick - startTick);
  const duration = Math.max(snap, Math.round(rawDur / snap) * snap);
  return { start, duration };
}
