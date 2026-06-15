import { describe, it, expect } from 'vitest';
import { effectiveClipLoop, loopAwareStep } from './clip-loop';
import { DEFAULT_METER, ticksPerBar, stepsPerBar } from './meter';
import type { SessionClip } from '../session/session';

const bar = ticksPerBar(DEFAULT_METER); // 384
const clip = (over: Partial<SessionClip>): SessionClip =>
  ({ id: 'c', lengthBars: 4, notes: [], ...over });

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
