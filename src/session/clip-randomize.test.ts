import { describe, it, expect } from 'vitest';
import { randomizeClipNotes } from './clip-randomize';
import { TICKS_PER_STEP } from '../core/notes';
import { ticksPerBar } from '../core/meter';
import type { SessionClip, SessionLane } from './session';

describe('randomizeClipNotes', () => {
  it('fills a tb303 clip with in-bounds notes (32 steps → effectively never empty)', () => {
    const clip = { lengthBars: 2, notes: [] } as any;
    randomizeClipNotes(clip, { engineId: 'tb303' } as any, { scale: 'minor', rootMidi: 36 });
    expect(clip.notes.length).toBeGreaterThan(0);
    const maxTick = 2 * 16 * TICKS_PER_STEP;
    for (const n of clip.notes) {
      expect(n.start).toBeGreaterThanOrEqual(0);
      expect(n.start).toBeLessThan(maxTick);
      expect(n.midi).toBeGreaterThan(0);
    }
  });

  it('drum clips emit only GM drum midi notes', () => {
    const clip = { lengthBars: 1, notes: [] } as any;
    randomizeClipNotes(clip, { engineId: 'drums-machine' } as any, { scale: 'minor', rootMidi: 36 });
    const gm = new Set([36, 38, 39, 42, 46]);
    for (const n of clip.notes) expect(gm.has(n.midi)).toBe(true);
  });

  it('poly clips place notes within the clip and above the bass register', () => {
    const clip = { lengthBars: 2, notes: [] } as any;
    randomizeClipNotes(clip, { engineId: 'subtractive' } as any, { scale: 'minor', rootMidi: 36 });
    const maxTick = 2 * 16 * TICKS_PER_STEP;
    for (const n of clip.notes) {
      expect(n.start).toBeLessThan(maxTick);
      expect(n.midi).toBeGreaterThanOrEqual(36 + 36); // rootMidi + poly baseOffset
    }
  });
});

describe('randomizeClipNotes respects the meter', () => {
  it('keeps every generated note inside the bar in 7/8', () => {
    const clip = { id: 'r', lengthBars: 1, notes: [] } as unknown as SessionClip;
    const lane = { id: 'l', engineId: 'drums-machine' } as unknown as SessionLane;
    const limit = ticksPerBar({ num: 7, den: 8 }); // 336
    for (let trial = 0; trial < 30; trial++) {
      randomizeClipNotes(clip, lane, { scale: 'pentMinor', rootMidi: 36 }, { num: 7, den: 8 });
      for (const n of clip.notes) expect(n.start).toBeLessThan(limit);
    }
  });
});
