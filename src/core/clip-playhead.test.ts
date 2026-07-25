import { describe, it, expect } from 'vitest';
import { clipPlayheadStep, clipPlayheadTick, clipPlayheadFrac, PLAYHEAD_IDLE } from './clip-playhead';
import { DEFAULT_METER } from './meter';
import { TICKS_PER_STEP } from './notes';
import type { SessionClip } from '../session/session';

const BPM = 120;
const STEP_DUR = 60 / BPM / 4;          // 0.125 s per 16th

function clip(over: Partial<SessionClip> = {}): SessionClip {
  return { id: 'c1', name: 'c', lengthBars: 2, notes: [], ...over } as SessionClip;
}

/** A lane playing `c` since t=0. */
function playing(c: SessionClip, startTime = 0) {
  return { playing: c, startTime } as { playing: SessionClip | null; startTime: number };
}

describe('clipPlayheadStep', () => {
  it('is idle when the lane is not playing anything', () => {
    expect(clipPlayheadStep(undefined, clip(), DEFAULT_METER, BPM, 1)).toBe(PLAYHEAD_IDLE);
    expect(clipPlayheadStep({ playing: null, startTime: 0 }, clip(), DEFAULT_METER, BPM, 1))
      .toBe(PLAYHEAD_IDLE);
  });

  it('is idle when the lane plays a DIFFERENT clip', () => {
    const other = clip({ id: 'other' });
    expect(clipPlayheadStep(playing(other), clip(), DEFAULT_METER, BPM, 1)).toBe(PLAYHEAD_IDLE);
  });

  it('starts at 0 and advances one step per step-duration', () => {
    const c = clip();
    const lp = playing(c);
    expect(clipPlayheadStep(lp, c, DEFAULT_METER, BPM, 0)).toBeCloseTo(0);
    expect(clipPlayheadStep(lp, c, DEFAULT_METER, BPM, STEP_DUR * 4)).toBeCloseTo(4);
  });

  it('never goes negative when the launch time is in the future', () => {
    const c = clip();
    expect(clipPlayheadStep(playing(c, 10), c, DEFAULT_METER, BPM, 9)).toBeCloseTo(0);
  });

  it('advances twice as fast at twice the tempo', () => {
    const c = clip();
    const lp = playing(c);
    const slow = clipPlayheadStep(lp, c, DEFAULT_METER, 60, 1);
    const fast = clipPlayheadStep(lp, c, DEFAULT_METER, 120, 1);
    expect(fast).toBeCloseTo(slow * 2);
  });

  it('sweeps only the loop region when the clip loops', () => {
    // 2-bar clip, loop = bar 2 only → steps [16, 32)
    const c = clip({ loopEnabled: true, loopStartTick: 16 * TICKS_PER_STEP, loopEndTick: 32 * TICKS_PER_STEP });
    const lp = playing(c);
    const at = (steps: number) => clipPlayheadStep(lp, c, DEFAULT_METER, BPM, steps * STEP_DUR);
    expect(at(0)).toBeCloseTo(16);              // enters at the loop start
    expect(at(8)).toBeCloseTo(24);
    expect(at(16)).toBeCloseTo(16);             // wraps back to the loop start
    // and never leaves the region
    for (const s of [0, 3, 15.9, 16, 40, 100.5]) {
      expect(at(s)).toBeGreaterThanOrEqual(16);
      expect(at(s)).toBeLessThan(32);
    }
  });
});

describe('clipPlayheadTick / clipPlayheadFrac', () => {
  it('tick is the step position on the clip tick grid', () => {
    const c = clip();
    const lp = playing(c);
    const step = clipPlayheadStep(lp, c, DEFAULT_METER, BPM, STEP_DUR * 5);
    expect(clipPlayheadTick(lp, c, DEFAULT_METER, BPM, STEP_DUR * 5)).toBeCloseTo(step * TICKS_PER_STEP);
  });

  it('frac spans 0..1 across the WHOLE clip, not the loop region', () => {
    const c = clip({ lengthBars: 2 });                       // 32 steps
    const lp = playing(c);
    expect(clipPlayheadFrac(lp, c, DEFAULT_METER, BPM, 0)).toBeCloseTo(0);
    expect(clipPlayheadFrac(lp, c, DEFAULT_METER, BPM, STEP_DUR * 16)).toBeCloseTo(0.5);
  });

  it("a looping clip's frac stays inside the loop's slice of the clip", () => {
    // loop = second half → frac must stay in [0.5, 1)
    const c = clip({ lengthBars: 2, loopEnabled: true, loopStartTick: 16 * TICKS_PER_STEP, loopEndTick: 32 * TICKS_PER_STEP });
    const lp = playing(c);
    for (const s of [0, 5, 20, 63.5]) {
      const f = clipPlayheadFrac(lp, c, DEFAULT_METER, BPM, s * STEP_DUR);
      expect(f).toBeGreaterThanOrEqual(0.5);
      expect(f).toBeLessThan(1);
    }
  });

  it('both stay idle when the step is idle', () => {
    const c = clip();
    expect(clipPlayheadTick(undefined, c, DEFAULT_METER, BPM, 1)).toBe(PLAYHEAD_IDLE);
    expect(clipPlayheadFrac(undefined, c, DEFAULT_METER, BPM, 1)).toBe(PLAYHEAD_IDLE);
  });
});
