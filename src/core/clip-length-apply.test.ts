// applyClipLength is the half of the length change that is NOT arithmetic: the
// bar count, the loop region and the automation curves. The note maths has its
// own tests in weave/clip-length.test.ts; what matters here is that everything
// else stays in step with them.
import { describe, it, expect } from 'vitest';
import { applyClipLength } from './clip-time-scale';
import { TICKS_PER_STEP } from './notes';
import type { SessionClip } from '../session/session';

const BAR = TICKS_PER_STEP * 16;

const clip = (over: Partial<SessionClip> = {}): SessionClip => ({
  id: 'c', color: '#fff', lengthBars: 1, gridResolution: '1/16',
  notes: [
    { start: 0, duration: 12, midi: 36, velocity: 100 },
    { start: TICKS_PER_STEP * 4, duration: 12, midi: 38, velocity: 100 },
  ],
  ...over,
});

describe('applyClipLength', () => {
  it('makes the clip factor times as long', () => {
    const c = clip();
    applyClipLength(c, 2, 'repeat', BAR);
    expect(c.lengthBars).toBe(2);
  });

  it('repeat fills the new room with the same groove', () => {
    const c = clip();
    applyClipLength(c, 2, 'repeat', BAR);
    // The pattern, twice — the second copy starting a bar in.
    expect(c.notes.filter((n) => n.start >= BAR)).toHaveLength(2);
  });

  it('stretch lengthens the notes instead of repeating them', () => {
    const c = clip();
    applyClipLength(c, 2, 'stretch', BAR);
    expect(c.notes).toHaveLength(2);
    expect(c.notes[1].start).toBe(TICKS_PER_STEP * 8);
  });

  it('vary drops a weak hit from the second time round, so it is not the first', () => {
    const c = clip();
    applyClipLength(c, 2, 'vary', BAR);
    const second = c.notes.filter((n) => n.start >= BAR);
    expect(second.length).toBeLessThan(2);
  });

  it('scales the loop region, so growing a clip does not shrink its loop', () => {
    const c = clip({ loopEnabled: true, loopStartTick: 0, loopEndTick: BAR });
    applyClipLength(c, 2, 'repeat', BAR);
    expect(c.loopEndTick).toBe(BAR * 2);
  });

  it('REPEATS the automation when the notes repeat', () => {
    // The curve has to describe the same music the notes do. This is the whole
    // reason the length change lives here rather than on the pure note function.
    const c = clip({ envelopes: [{ paramId: 'filter.cutoff', values: [0, 1] }] });
    const before = c.envelopes![0].values.length;
    applyClipLength(c, 2, 'repeat', BAR);
    expect(c.envelopes![0].values.length).toBeGreaterThan(before);
  });

  it('STRETCHES the automation when the notes stretch', () => {
    const c = clip({ envelopes: [{ paramId: 'filter.cutoff', values: [0, 0.5, 1] }] });
    applyClipLength(c, 2, 'stretch', BAR);
    // Resampled to the longer clip, and still starting where it started.
    expect(c.envelopes![0].values[0]).toBe(0);
    expect(c.envelopes![0].values.length).toBeGreaterThan(3);
  });

  it('leaves the clip alone for a factor that would destroy it', () => {
    // Zero, negative and NaN all reach here from a text field, and an empty
    // clip reads exactly like data loss.
    for (const bad of [0, -1, NaN]) {
      const c = clip();
      applyClipLength(c, bad, 'repeat', BAR);
      expect(c.notes).toHaveLength(2);
      expect(c.lengthBars).toBe(1);
    }
  });

  it('never lets a clip fall below one bar', () => {
    const c = clip();
    applyClipLength(c, 0.1, 'stretch', BAR);
    expect(c.lengthBars).toBeGreaterThanOrEqual(1);
  });
});
