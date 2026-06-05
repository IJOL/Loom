import { describe, it, expect } from 'vitest';
import { effectiveClipLoop } from './clip-loop';
import { DEFAULT_METER, ticksPerBar } from './meter';
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
