import { describe, it, expect } from 'vitest';
import { effectiveClipLoop, loopAwareStep, clipLoopSourceRange } from './clip-loop';
import { DEFAULT_METER, ticksPerBar, stepsPerBar } from './meter';
import type { SessionClip } from '../session/session';

const bar = ticksPerBar(DEFAULT_METER); // 384
const clip = (over: Partial<SessionClip>): SessionClip =>
  ({ id: 'c', lengthBars: 4, notes: [], color: '#a8c8e8', gridResolution: '1/16', ...over });

describe('effectiveClipLoop', () => {
  it('loop off ⇒ whole clip', () => {
    expect(effectiveClipLoop(clip({}), DEFAULT_METER)).toEqual({ startTick: 0, endTick: 4 * bar });
  });
  it('loop on with a valid region ⇒ that region', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true, loopStartTick: bar, loopEndTick: 3 * bar }), DEFAULT_METER);
    expect(r).toEqual({ startTick: bar, endTick: 3 * bar });
  });
  it('missing bounds default to 0..total', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true }), DEFAULT_METER);
    expect(r).toEqual({ startTick: 0, endTick: 4 * bar });
  });
  it('invalid region (end <= start) ⇒ whole clip', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true, loopStartTick: 3 * bar, loopEndTick: bar }), DEFAULT_METER);
    expect(r).toEqual({ startTick: 0, endTick: 4 * bar });
  });
  it('bounds are clamped into 0..total', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true, loopStartTick: -50, loopEndTick: 99 * bar }), DEFAULT_METER);
    expect(r).toEqual({ startTick: 0, endTick: 4 * bar });
  });
});

describe('loopAwareStep', () => {
  const spb = stepsPerBar(DEFAULT_METER);     // 16
  const total = 4 * spb;                      // 64 steps in a 4-bar clip

  it('loop off ⇒ wraps over the whole clip', () => {
    expect(loopAwareStep(clip({}), DEFAULT_METER, 0)).toBe(0);
    expect(loopAwareStep(clip({}), DEFAULT_METER, 10)).toBe(10);
    expect(loopAwareStep(clip({}), DEFAULT_METER, total + 5)).toBe(5); // wrap at full clip
  });

  it('loop on ⇒ starts at the loop start and wraps within the sub-region', () => {
    // loop bars 2..4 ⇒ steps [16, 48), length 32 steps.
    const c = clip({ loopEnabled: true, loopStartTick: bar, loopEndTick: 3 * bar });
    expect(loopAwareStep(c, DEFAULT_METER, 0)).toBe(16);     // launch at the loop start, not 0
    expect(loopAwareStep(c, DEFAULT_METER, 10)).toBe(26);    // 16 + 10
    expect(loopAwareStep(c, DEFAULT_METER, 32)).toBe(16);    // wraps after 32 steps, back to start
    expect(loopAwareStep(c, DEFAULT_METER, 40)).toBe(24);    // 16 + (40 % 32)
  });
});

describe('clipLoopSourceRange', () => {
  const sample = (over: object) => ({ sampleId: 's', mode: 'loop', trimStart: 0, trimEnd: 8, ...over });

  it('non-warped, loop off ⇒ whole trim span', () => {
    const c = clip({ sample: sample({}) as never });
    expect(clipLoopSourceRange(c, DEFAULT_METER, 8)).toEqual({ startSec: 0, endSec: 8 });
  });

  it('non-warped, loop bars 2..4 ⇒ matching fraction of the trim span', () => {
    // 4-bar clip mapped to [0,8]s; loop ticks [bar, 3*bar] = fraction [0.25, 0.75].
    const c = clip({ sample: sample({}) as never, loopEnabled: true, loopStartTick: bar, loopEndTick: 3 * bar });
    const r = clipLoopSourceRange(c, DEFAULT_METER, 8);
    expect(r.startSec).toBeCloseTo(2);
    expect(r.endSec).toBeCloseTo(6);
  });

  it('warped ⇒ maps loop beats to source seconds via the markers', () => {
    // markers: beat0→0s, beat8→5s, beat16→10s (16 quarter-beats = 4 bars).
    const warpMarkers = [{ srcSec: 0, beat: 0 }, { srcSec: 5, beat: 8 }, { srcSec: 10, beat: 16 }];
    const c = clip({
      sample: sample({ warp: true, warpMarkers }) as never,
      loopEnabled: true, loopStartTick: bar, loopEndTick: 3 * bar,  // beats 4..12
    });
    const r = clipLoopSourceRange(c, DEFAULT_METER, 10);
    expect(r.startSec).toBeCloseTo(2.5); // beat 4 → halfway in [0,5]
    expect(r.endSec).toBeCloseTo(7.5);   // beat 12 → halfway in [5,10]
  });
});
