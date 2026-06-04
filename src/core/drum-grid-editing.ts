// Pure, DOM-free logic for the canvas drum editor (Spec 3): resolution↔snap,
// per-cell hit lookup, marquee row×tick hit-test, and ROW-BASED group move +
// clipboard. Drum rows are non-contiguous GM midis, so everything vertical is
// row-indexed (not midi-indexed). clip-editor-drum-grid.ts is canvas glue over this.

import type { NoteEvent } from './notes';
import { TICKS_PER_QUARTER } from './notes';
import type { DrumVoice } from './drums';
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

/** First hit of `voice` whose start ∈ [cellTick, cellTick + snap). */
export function hitInCell(notes: readonly NoteEvent[], voice: DrumVoice, cellTick: number, snap: number): NoteEvent | null {
  for (const n of notes) {
    if (GM_DRUM_MAP[n.midi] === voice && n.start >= cellTick && n.start < cellTick + snap) return n;
  }
  return null;
}

/** ALL hits of `voice` in the cell (covers legacy roll clusters + finer-res dupes). */
export function hitsInCell(notes: readonly NoteEvent[], voice: DrumVoice, cellTick: number, snap: number): NoteEvent[] {
  return notes.filter((n) => GM_DRUM_MAP[n.midi] === voice && n.start >= cellTick && n.start < cellTick + snap);
}

export interface DrumRect { row0: number; row1: number; tick0: number; tick1: number; }

/** Hits whose voice-row ∈ [row0,row1] and body intersects [tick0,tick1). */
export function rowsInRect(
  notes: readonly NoteEvent[], rect: DrumRect, rowOfVoice: (v: DrumVoice) => number,
): NoteEvent[] {
  const r0 = Math.min(rect.row0, rect.row1), r1 = Math.max(rect.row0, rect.row1);
  const t0 = Math.min(rect.tick0, rect.tick1), t1 = Math.max(rect.tick0, rect.tick1);
  return notes.filter((n) => {
    const v = GM_DRUM_MAP[n.midi];
    if (v === undefined) return false;
    const r = rowOfVoice(v);
    return r >= r0 && r <= r1 && n.start < t1 && n.start + n.duration > t0;
  });
}

/** New GM midi per selected hit after moving by dRows; clamped to the voice list. */
export function rowMove(
  selected: readonly NoteEvent[], dRows: number, voicesInOrder: readonly DrumVoice[],
): Map<NoteEvent, number> {
  const idxOf = new Map(voicesInOrder.map((v, i) => [v, i]));
  let minR = Infinity, maxR = -Infinity;
  for (const n of selected) {
    const v = GM_DRUM_MAP[n.midi]; const r = v !== undefined ? idxOf.get(v) : undefined;
    if (r === undefined) continue;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  const out = new Map<NoteEvent, number>();
  if (minR === Infinity) return out;
  const d = Math.max(-minR, Math.min((voicesInOrder.length - 1) - maxR, dRows));
  for (const n of selected) {
    const v = GM_DRUM_MAP[n.midi]; const r = v !== undefined ? idxOf.get(v) : undefined;
    if (r === undefined) continue;
    out.set(n, VOICE_MIDI[voicesInOrder[r + d]]);
  }
  return out;
}

export interface DrumClipNote { dStart: number; row: number; duration: number; velocity: number; }

/** Snapshot selection relative to earliest start, storing the voice ROW (not midi). */
export function serializeDrumClipboard(selected: readonly NoteEvent[], rowOfVoice: (v: DrumVoice) => number): DrumClipNote[] {
  const rows: { n: NoteEvent; row: number }[] = [];
  for (const n of selected) {
    const v = GM_DRUM_MAP[n.midi];
    if (v === undefined) continue;
    rows.push({ n, row: rowOfVoice(v) });
  }
  if (rows.length === 0) return [];
  const minStart = Math.min(...rows.map((x) => x.n.start));
  return rows.map((x) => ({ dStart: x.n.start - minStart, row: x.row, duration: x.n.duration, velocity: x.n.velocity }));
}

/** Anchor the earliest clipboard hit to (anchorTick, anchorRow); preserve relative
 *  tick + row; clamp ticks to [0,patternTicks) and rows to the voice list. */
export function pasteDrumClipboard(
  clip: readonly DrumClipNote[], anchorTick: number, anchorRow: number,
  patternTicks: number, voicesInOrder: readonly DrumVoice[],
): NoteEvent[] {
  if (clip.length === 0) return [];
  const ref = clip.find((n) => n.dStart === 0) ?? clip[0];
  const lastRow = voicesInOrder.length - 1;
  return clip.map((n) => {
    const tick = Math.max(0, Math.min(patternTicks - 1, anchorTick + n.dStart));
    const row = Math.max(0, Math.min(lastRow, anchorRow + (n.row - ref.row)));
    return { start: tick, duration: n.duration, midi: VOICE_MIDI[voicesInOrder[row]], velocity: n.velocity };
  });
}

/** Horizontal-only group clamp: the dTick that keeps every hit in [0,patternTicks]. */
export function clampGroupTick(selected: readonly NoteEvent[], dTick: number, patternTicks: number): number {
  if (selected.length === 0) return 0;
  let minStart = Infinity, maxEnd = -Infinity;
  for (const n of selected) { minStart = Math.min(minStart, n.start); maxEnd = Math.max(maxEnd, n.start + n.duration); }
  return Math.max(-minStart, Math.min(patternTicks - maxEnd, dTick));
}
