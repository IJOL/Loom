// Pure, DOM-free logic for the canvas drum editor (Spec 3): resolution↔snap,
// per-cell hit lookup, marquee row×tick hit-test, and ROW-BASED group move +
// clipboard. Drum rows are non-contiguous midis, so everything vertical is
// row-indexed (not midi-indexed) through a DrumRows model: gmDrumRows() keeps the
// fixed 8 GM voices (synth drums + bundled kits); noteDrumRows() drives a
// variable-size sample drumkit (one row per pad, any notes). clip-editor-drum-grid.ts
// is canvas glue over this.

import type { NoteEvent } from './notes';
import { TICKS_PER_QUARTER } from './notes';
import { DRUM_LANES, type DrumVoice } from './drums';
import { GM_DRUM_MAP, VOICE_MIDI } from '../engines/drum-gm-map';

export type ResolutionKey = '1/4' | '1/8' | '1/8T' | '1/16' | '1/16T' | '1/32' | 'free';
export const RESOLUTIONS: ResolutionKey[] = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32', 'free'];
export const DEFAULT_RESOLUTION: ResolutionKey = '1/16';

const SNAP: Record<ResolutionKey, number> = {
  '1/4': TICKS_PER_QUARTER,        // 96
  '1/8': TICKS_PER_QUARTER / 2,    // 48
  '1/8T': TICKS_PER_QUARTER / 3,   // 32  (eighth triplet)
  '1/16': TICKS_PER_QUARTER / 4,   // 24
  '1/16T': TICKS_PER_QUARTER / 6,  // 16  (sixteenth triplet)
  '1/32': TICKS_PER_QUARTER / 8,   // 12
  free: 1,
};

export function resolutionToSnap(k: ResolutionKey): number { return SNAP[k]; }

export function clampResolution(x: unknown): ResolutionKey {
  return (typeof x === 'string' && (RESOLUTIONS as string[]).includes(x)) ? (x as ResolutionKey) : DEFAULT_RESOLUTION;
}

export function snapTickToRes(tick: number, snap: number): number {
  return Math.max(0, Math.floor(tick / snap) * snap);
}

// ── Row model ──────────────────────────────────────────────────────────────
// A note-addressed mapping between a clip's midi notes and the editor's visual
// rows. Decouples the grid from the synth's fixed DrumVoice union so a sample
// drumkit can have any number of pads.
export interface DrumRows {
  count: number;
  noteToRow(midi: number): number;   // -1 when the note has no row
  rowToNote(row: number): number;    // canonical midi the row writes
}

/** The fixed GM drum rows: synth drums + bundled GM kits. Preserves alias-note
 *  behaviour (35/40/44 collapse to their canonical voice midi). */
export function gmDrumRows(voices: readonly DrumVoice[] = DRUM_LANES): DrumRows {
  const idxOf = new Map(voices.map((v, i) => [v, i] as const));
  return {
    count: voices.length,
    noteToRow: (midi) => { const v = GM_DRUM_MAP[midi]; return v !== undefined ? (idxOf.get(v) ?? -1) : -1; },
    rowToNote: (row) => VOICE_MIDI[voices[row]],
  };
}

/** A variable-size sample drumkit: one row per pad, addressed by the pad's note. */
export function noteDrumRows(notes: readonly number[]): DrumRows {
  const idxOf = new Map(notes.map((n, i) => [n, i] as const));
  return {
    count: notes.length,
    noteToRow: (midi) => idxOf.get(midi) ?? -1,
    rowToNote: (row) => notes[row],
  };
}

/** First hit on `row` whose start ∈ [cellTick, cellTick + snap). */
export function hitInCell(notes: readonly NoteEvent[], row: number, cellTick: number, snap: number, rows: DrumRows): NoteEvent | null {
  for (const n of notes) {
    if (rows.noteToRow(n.midi) === row && n.start >= cellTick && n.start < cellTick + snap) return n;
  }
  return null;
}

/** ALL hits on `row` in the cell (covers legacy roll clusters + finer-res dupes). */
export function hitsInCell(notes: readonly NoteEvent[], row: number, cellTick: number, snap: number, rows: DrumRows): NoteEvent[] {
  return notes.filter((n) => rows.noteToRow(n.midi) === row && n.start >= cellTick && n.start < cellTick + snap);
}

export interface DrumRect { row0: number; row1: number; tick0: number; tick1: number; }

/** Hits whose row ∈ [row0,row1] and body intersects [tick0,tick1). */
export function rowsInRect(notes: readonly NoteEvent[], rect: DrumRect, rows: DrumRows): NoteEvent[] {
  const r0 = Math.min(rect.row0, rect.row1), r1 = Math.max(rect.row0, rect.row1);
  const t0 = Math.min(rect.tick0, rect.tick1), t1 = Math.max(rect.tick0, rect.tick1);
  return notes.filter((n) => {
    const r = rows.noteToRow(n.midi);
    if (r < 0) return false;
    return r >= r0 && r <= r1 && n.start < t1 && n.start + n.duration > t0;
  });
}

/** New midi per selected hit after moving by dRows; clamped to the row list. */
export function rowMove(selected: readonly NoteEvent[], dRows: number, rows: DrumRows): Map<NoteEvent, number> {
  let minR = Infinity, maxR = -Infinity;
  for (const n of selected) {
    const r = rows.noteToRow(n.midi);
    if (r < 0) continue;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  const out = new Map<NoteEvent, number>();
  if (minR === Infinity) return out;
  const d = Math.max(-minR, Math.min((rows.count - 1) - maxR, dRows));
  for (const n of selected) {
    const r = rows.noteToRow(n.midi);
    if (r < 0) continue;
    out.set(n, rows.rowToNote(r + d));
  }
  return out;
}

export interface DrumClipNote { dStart: number; row: number; duration: number; velocity: number; }

/** Snapshot selection relative to earliest start, storing the ROW (not midi). */
export function serializeDrumClipboard(selected: readonly NoteEvent[], rows: DrumRows): DrumClipNote[] {
  const items: { n: NoteEvent; row: number }[] = [];
  for (const n of selected) {
    const r = rows.noteToRow(n.midi);
    if (r < 0) continue;
    items.push({ n, row: r });
  }
  if (items.length === 0) return [];
  const minStart = Math.min(...items.map((x) => x.n.start));
  return items.map((x) => ({ dStart: x.n.start - minStart, row: x.row, duration: x.n.duration, velocity: x.n.velocity }));
}

/** Anchor the earliest clipboard hit to (anchorTick, anchorRow); preserve relative
 *  tick + row; clamp ticks to [0,patternTicks) and rows to the row list. */
export function pasteDrumClipboard(
  clip: readonly DrumClipNote[], anchorTick: number, anchorRow: number,
  patternTicks: number, rows: DrumRows,
): NoteEvent[] {
  if (clip.length === 0) return [];
  const ref = clip.find((n) => n.dStart === 0) ?? clip[0];
  const lastRow = rows.count - 1;
  return clip.map((n) => {
    const tick = Math.max(0, Math.min(patternTicks - 1, anchorTick + n.dStart));
    const row = Math.max(0, Math.min(lastRow, anchorRow + (n.row - ref.row)));
    return { start: tick, duration: n.duration, midi: rows.rowToNote(row), velocity: n.velocity };
  });
}

/** Horizontal-only group clamp: the dTick that keeps every hit in [0,patternTicks]. */
export function clampGroupTick(selected: readonly NoteEvent[], dTick: number, patternTicks: number): number {
  if (selected.length === 0) return 0;
  let minStart = Infinity, maxEnd = -Infinity;
  for (const n of selected) { minStart = Math.min(minStart, n.start); maxEnd = Math.max(maxEnd, n.start + n.duration); }
  return Math.max(-minStart, Math.min(patternTicks - maxEnd, dTick));
}
