import { describe, it, expect } from 'vitest';
import { tickLane } from './lane-scheduler';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from './meter';

function sliceClip(): SessionClip {
  return {
    id: 'c1', lengthBars: 1, notes: [
      { start: 0, duration: 24, midi: 36, velocity: 90 },
      { start: 48, duration: 24, midi: 37, velocity: 90 },
    ],
    sample: {
      sampleId: 'smp-x', mode: 'loop', warp: true, warpMode: 'slice',
      trimStart: 0, trimEnd: 2,
      slices: [
        { start: 0, end: 1, note: 36 },
        { start: 1, end: 2, note: 37 },
      ],
    },
  };
}

describe('tickLane slice mode', () => {
  it('emits notes (not one buffer trigger) with the slice region attached', () => {
    const fired: Array<{ midi: number; slice?: { sampleId: string; start: number; end: number } }> = [];
    tickLane(sliceClip(), {
      bpm: 120, lookaheadSec: 1.5, now: 0, loopStartedAt: 0, meter: DEFAULT_METER,
      onTrigger: (note) => fired.push({ midi: note.midi, slice: note.slice }),
      onAutomation: () => {},
    });
    expect(fired.length).toBe(2);
    expect(fired[0].slice).toEqual({ sampleId: 'smp-x', start: 0, end: 1 });
    expect(fired[1].midi).toBe(37);
    expect(fired[1].slice?.start).toBe(1);
  });
});
