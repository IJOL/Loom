import { describe, it, expect } from 'vitest';
import { hitInCellRow, rowsInRectRow, rowMoveContig } from './slice-grid-editing';
import type { NoteEvent } from './notes';

const BASE = 36;
const notes: NoteEvent[] = [
  { start: 0, duration: 24, midi: 36, velocity: 90 },  // row 0
  { start: 48, duration: 24, midi: 38, velocity: 90 }, // row 2
];

describe('slice-grid-editing', () => {
  it('hitInCellRow finds a note by row+cell', () => {
    expect(hitInCellRow(notes, 0, 0, 24, BASE)?.midi).toBe(36);
    expect(hitInCellRow(notes, 1, 0, 24, BASE)).toBeNull();
  });
  it('rowsInRectRow selects by row band + tick span', () => {
    const sel = rowsInRectRow(notes, { row0: 0, row1: 2, tick0: 0, tick1: 96 }, BASE);
    expect(sel.length).toBe(2);
  });
  it('rowMoveContig clamps within [0, rowCount)', () => {
    const moved = rowMoveContig([notes[0]], 5, BASE, 4); // 4 rows max → clamp
    expect(moved.get(notes[0])).toBe(BASE + 3);
  });
});
