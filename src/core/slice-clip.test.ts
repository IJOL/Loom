import { describe, it, expect } from 'vitest';
import { buildSliceClip, barCountFor, SLICE_BASE_NOTE } from './slice-clip';
import { DEFAULT_METER } from './meter';
import { TICKS_PER_QUARTER } from './notes';

describe('barCountFor', () => {
  it('derives whole bars from duration at the loop tempo (4/4)', () => {
    // 2 bars @ 120bpm 4/4 = 2 * 4 * 0.5s = 4.0s
    expect(barCountFor(4.0, 120, DEFAULT_METER)).toBe(2);
    // 1 bar @ 174bpm 4/4 = 4 * (60/174) ≈ 1.379s
    expect(barCountFor(1.379, 174, DEFAULT_METER)).toBe(1);
  });
  it('never returns less than 1', () => {
    expect(barCountFor(0.1, 120, DEFAULT_METER)).toBe(1);
  });
});

describe('buildSliceClip', () => {
  it('one slice + note per onset, contiguous notes from SLICE_BASE_NOTE', () => {
    const r = buildSliceClip({
      slicePointsSec: [0, 0.5, 1.0, 1.5],
      durationSec: 2.0,
      originalBpm: 120,
      projectMeter: DEFAULT_METER,
      gridResolution: '1/16',
    });
    expect(r.lengthBars).toBe(1);
    expect(r.slices.length).toBe(4);
    expect(r.notes.length).toBe(4);
    expect(r.slices.map((s) => s.note)).toEqual([
      SLICE_BASE_NOTE, SLICE_BASE_NOTE + 1, SLICE_BASE_NOTE + 2, SLICE_BASE_NOTE + 3,
    ]);
    expect(r.slices[0].start).toBe(0);
    expect(r.slices[3].end).toBeCloseTo(2.0, 5);
    expect(r.notes[0].start).toBe(0);
    expect(r.notes[1].start).toBe(TICKS_PER_QUARTER);
    expect(r.notes[2].start).toBe(TICKS_PER_QUARTER * 2);
    expect(r.notes[3].start).toBe(TICKS_PER_QUARTER * 3);
  });

  it('falls back to a single whole-buffer slice when no onsets', () => {
    const r = buildSliceClip({
      slicePointsSec: [], durationSec: 1.0, originalBpm: 120,
      projectMeter: DEFAULT_METER, gridResolution: '1/16',
    });
    expect(r.slices.length).toBe(1);
    expect(r.slices[0].start).toBe(0);
    expect(r.slices[0].end).toBeCloseTo(1.0, 5);
    expect(r.notes.length).toBe(1);
  });
});
