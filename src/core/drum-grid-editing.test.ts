import { describe, it, expect } from 'vitest';
import {
  RESOLUTIONS, resolutionToSnap, clampResolution, DEFAULT_RESOLUTION,
  snapTickToRes, hitInCell, hitsInCell, rowsInRect, rowMove,
  serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
  gmDrumRows, noteDrumRows,
} from './drum-grid-editing';
import type { NoteEvent } from './notes';
import { DRUM_LANES } from './drums';

const GM = gmDrumRows();                              // one fixed row per kit voice
const kick = (start: number, vel = 80): NoteEvent => ({ start, midi: 36, duration: 12, velocity: vel });
const snare = (start: number): NoteEvent => ({ start, midi: 38, duration: 12, velocity: 80 });

describe('resolution', () => {
  it('maps every key to the right snap', () => {
    expect(resolutionToSnap('1/4')).toBe(96);
    expect(resolutionToSnap('1/8')).toBe(48);
    expect(resolutionToSnap('1/8T')).toBe(32);
    expect(resolutionToSnap('1/16')).toBe(24);
    expect(resolutionToSnap('1/16T')).toBe(16);
    expect(resolutionToSnap('1/32')).toBe(12);
    expect(resolutionToSnap('free')).toBe(1);
  });
  it('clampResolution corrects junk to the default', () => {
    expect(clampResolution('1/8')).toBe('1/8');
    expect(clampResolution('garbage')).toBe(DEFAULT_RESOLUTION);
    expect(clampResolution(undefined)).toBe(DEFAULT_RESOLUTION);
    expect(RESOLUTIONS).toContain('free');
  });
  it('snapTickToRes floors to the snap grid', () => {
    expect(snapTickToRes(50, 24)).toBe(48);
    expect(snapTickToRes(23, 24)).toBe(0);
  });
});

describe('gmDrumRows', () => {
  it('gives every kit voice a row and collapses alias notes to their canonical voice row', () => {
    expect(GM.count).toBe(DRUM_LANES.length);
    expect(GM.noteToRow(36)).toBe(0);    // kick
    expect(GM.noteToRow(35)).toBe(0);    // kick alias
    expect(GM.noteToRow(38)).toBe(1);    // snare
    expect(GM.noteToRow(40)).toBe(1);    // snare alias
    expect(GM.noteToRow(37)).toBe(2);    // rimshot sits with the snare
    expect(GM.noteToRow(57)).toBe(GM.noteToRow(49)); // crash alias → crash
    expect(GM.rowToNote(0)).toBe(36);
    expect(GM.rowToNote(1)).toBe(38);
    expect(GM.noteToRow(99)).toBe(-1);   // not a drum note
  });
});

describe('hitInCell / hitsInCell (row-addressed)', () => {
  it('finds a hit on the row within [cell, cell+snap)', () => {
    const notes = [kick(0), kick(24), snare(24)];
    expect(hitInCell(notes, GM.noteToRow(36), 24, 24, GM)).toBe(notes[1]);
    expect(hitInCell(notes, GM.noteToRow(36), 48, 24, GM)).toBeNull();
    expect(hitInCell(notes, GM.noteToRow(38), 24, 24, GM)).toBe(notes[2]);
  });
  it('hitsInCell returns every hit in the cell (legacy roll cluster)', () => {
    const roll = [kick(0), kick(8), kick(16), snare(0)]; // 3 kicks in one 1/16 cell
    expect(hitsInCell(roll, GM.noteToRow(36), 0, 24, GM)).toEqual([roll[0], roll[1], roll[2]]);
    expect(hitsInCell(roll, GM.noteToRow(38), 0, 24, GM)).toEqual([roll[3]]);
  });
});

describe('rowsInRect', () => {
  it('selects hits by row index and tick span', () => {
    const notes = [kick(0), snare(48), kick(120)];
    const hit = rowsInRect(notes, { row0: 0, row1: 1, tick0: 0, tick1: 60 }, GM);
    expect(hit).toEqual([notes[0], notes[1]]);
  });
});

describe('rowMove', () => {
  it('maps a downward move to the next voice midi, clamped at the bottom', () => {
    const sel = [kick(0)];                                  // row 0
    expect(rowMove(sel, 1, GM).get(sel[0])).toBe(38);       // snare
    const bottom = [{ start: 0, midi: 49, duration: 12, velocity: 80 }]; // crash = last row
    expect(rowMove(bottom, 5, GM).get(bottom[0])).toBe(49);  // clamped, unchanged
  });
});

describe('clipboard (row-based) + tick clamp', () => {
  it('serialize→paste anchors to (tick,row) and preserves relative row/tick', () => {
    const sel = [kick(48), snare(72)];                      // rows 0,1 ; dStart 0,24
    const clip = serializeDrumClipboard(sel, GM);
    const pasted = pasteDrumClipboard(clip, 96, 2, 384, GM); // anchor row 2 (rimshot)
    expect(pasted[0]).toMatchObject({ start: 96, midi: 37 }); // row 2
    expect(pasted[1]).toMatchObject({ start: 120, midi: 42 }); // row 3 (closedHat), +24 tick
  });
  it('clampGroupTick stops the group at 0 and patternTicks', () => {
    expect(clampGroupTick([kick(24), kick(48)], -100, 384)).toBe(-24);
    expect(clampGroupTick([{ start: 360, midi: 36, duration: 24, velocity: 80 }], 100, 384)).toBe(0);
  });
});

// ── Variable-size sample drumkit: a 12-pad kit on arbitrary notes ───────────
describe('noteDrumRows (variable-size kit)', () => {
  const NOTES = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]; // 12 pads
  const K = noteDrumRows(NOTES);
  const pad = (note: number, start = 0): NoteEvent => ({ start, midi: note, duration: 12, velocity: 80 });

  it('exposes one row per pad, addressed by exact note', () => {
    expect(K.count).toBe(12);
    expect(K.noteToRow(36)).toBe(0);
    expect(K.noteToRow(44)).toBe(8);     // a row BEYOND the 8 GM voices
    expect(K.rowToNote(11)).toBe(47);
    expect(K.noteToRow(99)).toBe(-1);
  });
  it('moves and clamps on rows past the 8th', () => {
    const a = [pad(44)];                                   // row 8
    expect(rowMove(a, 2, K).get(a[0])).toBe(46);           // → row 10
    const last = [pad(47)];                                // row 11 (last)
    expect(rowMove(last, 5, K).get(last[0])).toBe(47);     // clamped
  });
  it('copy/paste preserves a row beyond 8', () => {
    const cb = serializeDrumClipboard([pad(45)], K);       // row 9
    const out = pasteDrumClipboard(cb, 96, 11, 384, K);    // anchor at last row
    expect(out[0]).toMatchObject({ start: 96, midi: 47 });
  });
  it('hit lookup works on a high row', () => {
    const notes = [pad(44, 24), pad(36, 24)];
    expect(hitInCell(notes, 8, 24, 24, K)).toBe(notes[0]);
  });
});
