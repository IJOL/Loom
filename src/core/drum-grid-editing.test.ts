import { describe, it, expect } from 'vitest';
import {
  RESOLUTIONS, resolutionToSnap, clampResolution, DEFAULT_RESOLUTION,
  snapTickToRes, hitInCell, hitsInCell, rowsInRect, rowMove,
  serializeDrumClipboard, pasteDrumClipboard, clampGroupTick,
} from './drum-grid-editing';
import type { NoteEvent } from './notes';
import { DRUM_LANES } from './drums';

const VOICES = DRUM_LANES;
const rowOf = (v: typeof VOICES[number]) => VOICES.indexOf(v);
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

describe('hitInCell / hitsInCell', () => {
  it('finds a hit of the voice within [cell, cell+snap)', () => {
    const notes = [kick(0), kick(24), snare(24)];
    expect(hitInCell(notes, 'kick', 24, 24)).toBe(notes[1]);
    expect(hitInCell(notes, 'kick', 48, 24)).toBeNull();
    expect(hitInCell(notes, 'snare', 24, 24)).toBe(notes[2]);
  });
  it('hitsInCell returns every hit in the cell (legacy roll cluster)', () => {
    const roll = [kick(0), kick(8), kick(16), snare(0)]; // 3 kicks in one 1/16 cell
    expect(hitsInCell(roll, 'kick', 0, 24)).toEqual([roll[0], roll[1], roll[2]]);
    expect(hitsInCell(roll, 'snare', 0, 24)).toEqual([roll[3]]);
  });
});

describe('rowsInRect', () => {
  it('selects hits by row index and tick span', () => {
    const notes = [kick(0), snare(48), kick(120)];
    const hit = rowsInRect(notes, { row0: 0, row1: 1, tick0: 0, tick1: 60 }, rowOf);
    expect(hit).toEqual([notes[0], notes[1]]);
  });
});

describe('rowMove', () => {
  it('maps a downward move to the next voice midi, clamped at the bottom', () => {
    const sel = [kick(0)];                       // row 0
    expect(rowMove(sel, 1, VOICES).get(sel[0])).toBe(38);   // snare
    const last = [{ start: 0, midi: 51, duration: 12, velocity: 80 }]; // ride = row 7
    expect(rowMove(last, 5, VOICES).get(last[0])).toBe(51); // clamped, unchanged
  });
});

describe('clipboard (row-based) + tick clamp', () => {
  it('serialize→paste anchors to (tick,row) and preserves relative row/tick', () => {
    const sel = [kick(48), snare(72)];           // rows 0,1 ; dStart 0,24
    const clip = serializeDrumClipboard(sel, rowOf);
    const pasted = pasteDrumClipboard(clip, 96, 2, 384, VOICES); // anchor row 2 (closedHat)
    expect(pasted[0]).toMatchObject({ start: 96, midi: 42 });    // row 2
    expect(pasted[1]).toMatchObject({ start: 120, midi: 46 });   // row 3 (openHat), +24 tick
  });
  it('clampGroupTick stops the group at 0 and patternTicks', () => {
    expect(clampGroupTick([kick(24), kick(48)], -100, 384)).toBe(-24);
    expect(clampGroupTick([{ start: 360, midi: 36, duration: 24, velocity: 80 }], 100, 384)).toBe(0);
  });
});
