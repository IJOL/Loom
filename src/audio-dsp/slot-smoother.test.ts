// src/audio-dsp/slot-smoother.test.ts
// The behaviour ParamSmoother's own tests pin, re-pinned against slots — plus
// the two things only the indexed version can be asked.
import { describe, it, expect, vi } from 'vitest';
import { SlotSmoother } from './slot-smoother';
import { buildParamIndex } from './param-index';

const SR = 48000;
const IX = buildParamIndex(['filter.cutoff', 'amp.level']);
const CUT = IX.slot['filter.cutoff'];
const LVL = IX.slot['amp.level'];

describe('SlotSmoother — the boundary where a name becomes a number', () => {
  it('resolves incoming names to slots and stores them by index', () => {
    const s = new SlotSmoother(SR, IX);
    s.reset({ 'filter.cutoff': 0.4 });
    expect(s.values[CUT]).toBeCloseTo(0.4, 12);
  });

  it('user: an id with no slot is ignored, warned about once, and never stored', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SlotSmoother(SR, IX);
    s.reset({ 'typo.here': 1 });
    s.setTargets({ 'typo.here': 2 });
    s.setTargets({ 'typo.here': 3 });
    expect(s.values.length).toBe(IX.length);
    expect(warn).toHaveBeenCalledTimes(1);          // once per id, not per write
    warn.mockRestore();
  });
});

describe('SlotSmoother — the slew itself', () => {
  it('a first-ever write lands instantly: there is nothing to ramp from', () => {
    const s = new SlotSmoother(SR, IX);
    s.setTargets({ 'amp.level': 0.9 });
    expect(s.values[LVL]).toBe(0.9);
    expect(s.moving).toBe(false);
  });

  it('a first-ever write still reports movement, so cached readers refresh', () => {
    // The bug this defends: tick() said "nothing moved" for an instant landing,
    // and anything caching a value derived from the bag kept the stale one until
    // an unrelated knob moved — losing the turn, then resyncing as a click.
    const s = new SlotSmoother(SR, IX);
    s.setTargets({ 'amp.level': 0.9 });
    expect(s.tick()).toBe(true);
    expect(s.tick()).toBe(false);
  });

  it('a known param ramps toward its target instead of jumping', () => {
    const s = new SlotSmoother(SR, IX);
    s.reset({ 'filter.cutoff': 0 });
    s.setTargets({ 'filter.cutoff': 1 });
    s.tick();
    expect(s.values[CUT]).toBeGreaterThan(0);
    expect(s.values[CUT]).toBeLessThan(1);
  });

  it('the ramp lands and the slot leaves the active list — zero cost at rest', () => {
    const s = new SlotSmoother(SR, IX);
    s.reset({ 'filter.cutoff': 0 });
    s.setTargets({ 'filter.cutoff': 1 });
    for (let i = 0; i < SR; i++) if (!s.tick()) break;
    expect(s.values[CUT]).toBeCloseTo(1, 9);
    expect(s.moving).toBe(false);
    expect(s.tick()).toBe(false);
  });

  it('a non-finite target is ignored and the last good value survives', () => {
    const s = new SlotSmoother(SR, IX);
    s.reset({ 'filter.cutoff': 0.5 });
    s.setTargets({ 'filter.cutoff': NaN });
    s.tick();
    expect(s.values[CUT]).toBe(0.5);
    expect(s.moving).toBe(false);
  });

  it('two params in flight both converge', () => {
    const s = new SlotSmoother(SR, IX);
    s.reset({ 'filter.cutoff': 0, 'amp.level': 0 });
    s.setTargets({ 'filter.cutoff': 1, 'amp.level': 0.5 });
    for (let i = 0; i < SR; i++) if (!s.tick()) break;
    expect(s.values[CUT]).toBeCloseTo(1, 9);
    expect(s.values[LVL]).toBeCloseTo(0.5, 9);
  });
});
