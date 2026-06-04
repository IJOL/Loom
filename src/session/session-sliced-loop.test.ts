import { describe, it, expect } from 'vitest';
import { slicedLoopClip } from './session';

describe('slicedLoopClip', () => {
  it('builds a slice-mode clip carrying slices + generated notes', () => {
    const clip = slicedLoopClip({
      name: 'amen',
      sampleId: 'smp-x',
      durationSec: 1.846,
      originalBpm: 174,
      lengthBars: 2,
      slices: [
        { start: 0, end: 0.46, note: 36 },
        { start: 0.46, end: 0.92, note: 37 },
      ],
      notes: [
        { start: 0, duration: 24, midi: 36, velocity: 90 },
        { start: 48, duration: 24, midi: 37, velocity: 90 },
      ],
    });
    expect(clip.sample?.warpMode).toBe('slice');
    expect(clip.sample?.warp).toBe(true);
    expect(clip.sample?.slices?.length).toBe(2);
    expect(clip.lengthBars).toBe(2);
    expect(clip.notes.length).toBe(2);
    expect(clip.notes[1].midi).toBe(37);
  });
});
