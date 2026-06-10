import { describe, it, expect } from 'vitest';
import { samplePlaybackWindow } from './sampler-playback-window';
import { PAD_DEFAULTS } from './sampler-pad-params';

const pad = (over: Partial<typeof PAD_DEFAULTS> = {}) => ({ ...PAD_DEFAULTS, ...over });

describe('samplePlaybackWindow', () => {
  it('defaults play the whole buffer as a one-shot', () => {
    const w = samplePlaybackWindow(pad(), 2, 1);
    expect(w.offset).toBe(0);
    expect(w.duration).toBeCloseTo(2);
    expect(w.loop).toBe(false);
  });

  it('trim shrinks the window and offsets the start', () => {
    const w = samplePlaybackWindow(pad({ sampleStart: 0.5, sampleEnd: 0.75 }), 2, 1);
    expect(w.offset).toBeCloseTo(1);      // 0.5 * 2s
    expect(w.duration).toBeCloseTo(0.5);  // (0.75-0.5) * 2s
  });

  it('a faster playbackRate shortens the wall-clock duration', () => {
    const slow = samplePlaybackWindow(pad(), 2, 1).duration!;
    const fast = samplePlaybackWindow(pad(), 2, 2).duration!;
    expect(fast).toBeCloseTo(slow / 2);
  });

  it('loop uses [loopStart, loopEnd] in seconds and no fixed duration', () => {
    const w = samplePlaybackWindow(pad({ loop: 1, loopStart: 0.25, loopEnd: 0.75 }), 4, 1);
    expect(w.loop).toBe(true);
    expect(w.duration).toBeNull();
    expect(w.loopStart).toBeCloseTo(1); // 0.25 * 4
    expect(w.loopEnd).toBeCloseTo(3);   // 0.75 * 4
  });

  it('clamps a loop region to within the trim', () => {
    const w = samplePlaybackWindow(pad({ loop: 1, sampleStart: 0.2, sampleEnd: 0.6, loopStart: 0, loopEnd: 1 }), 10, 1);
    expect(w.loopStart).toBeGreaterThanOrEqual(2);  // >= sampleStart*dur
    expect(w.loopEnd).toBeLessThanOrEqual(6);       // <= sampleEnd*dur
  });
});
