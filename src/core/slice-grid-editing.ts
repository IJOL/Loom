// Contiguous-row editing helpers for the slice loop editor: rows map to MIDI
// linearly (midi = baseNote + row), unlike drum-grid-editing which uses the GM
// map. Reuse resolution/snap helpers from drum-grid-editing.

import type { NoteEvent } from './notes';

export interface SliceRect { row0: number; row1: number; tick0: number; tick1: number; }

export function rowOfMidi(midi: number, baseNote: number): number { return midi - baseNote; }
export function midiOfRow(row: number, baseNote: number): number { return baseNote + row; }

export function hitInCellRow(
  notes: readonly NoteEvent[], row: number, cellTick: number, snap: number, baseNote: number,
): NoteEvent | null {
  for (const n of notes) {
    if (n.midi - baseNote === row && n.start >= cellTick && n.start < cellTick + snap) return n;
  }
  return null;
}

export function hitsInCellRow(
  notes: readonly NoteEvent[], row: number, cellTick: number, snap: number, baseNote: number,
): NoteEvent[] {
  return notes.filter((n) => n.midi - baseNote === row && n.start >= cellTick && n.start < cellTick + snap);
}

export function rowsInRectRow(notes: readonly NoteEvent[], rect: SliceRect, baseNote: number): NoteEvent[] {
  const r0 = Math.min(rect.row0, rect.row1), r1 = Math.max(rect.row0, rect.row1);
  const t0 = Math.min(rect.tick0, rect.tick1), t1 = Math.max(rect.tick0, rect.tick1);
  return notes.filter((n) => {
    const r = n.midi - baseNote;
    return r >= r0 && r <= r1 && n.start < t1 && n.start + n.duration > t0;
  });
}

export function rowMoveContig(
  selected: readonly NoteEvent[], dRows: number, baseNote: number, rowCount: number,
): Map<NoteEvent, number> {
  let minR = Infinity, maxR = -Infinity;
  for (const n of selected) { const r = n.midi - baseNote; minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
  const out = new Map<NoteEvent, number>();
  if (minR === Infinity) return out;
  const d = Math.max(-minR, Math.min((rowCount - 1) - maxR, dRows));
  for (const n of selected) out.set(n, baseNote + (n.midi - baseNote) + d);
  return out;
}

export function clampGroupTickContig(selected: readonly NoteEvent[], dTick: number, patternTicks: number): number {
  if (selected.length === 0) return 0;
  let minStart = Infinity, maxEnd = -Infinity;
  for (const n of selected) { minStart = Math.min(minStart, n.start); maxEnd = Math.max(maxEnd, n.start + n.duration); }
  return Math.max(-minStart, Math.min(patternTicks - maxEnd, dTick));
}
