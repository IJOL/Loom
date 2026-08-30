import { describe, it, expect } from 'vitest';
import { findBand, setBandMuted, duplicateBand, splitBandAt, trimBandStart } from './band-ops';
import { emptyLaneRec, type ArrangementClipEvent } from './performance';

const ev = (id: string, atSec: number, untilSec: number, offsetSec = 0): ArrangementClipEvent =>
  ({ id, clipId: 'c', laneId: 'l', atSec, untilSec, offsetSec });

describe('findBand', () => {
  it('resolves a band to its lane and index; null when absent', () => {
    const lane = { ...emptyLaneRec('l1'), clipEvents: [ev('a', 0, 2), ev('b', 4, 6)] };
    expect(findBand([lane], 'b')).toEqual({ lane, index: 1 });
    expect(findBand([lane], 'nope')).toBeNull();
  });
});

describe('setBandMuted', () => {
  it('flips only the addressed band', () => {
    const out = setBandMuted([ev('a', 0, 2), ev('b', 4, 6)], 'b', true);
    expect(out.find((e) => e.id === 'b')!.muted).toBe(true);
    expect(out.find((e) => e.id === 'a')!.muted).toBeFalsy();
  });
});

describe('duplicateBand', () => {
  it('puts the copy right after the original with a fresh id', () => {
    const out = duplicateBand([ev('a', 0, 2)], 'a');
    expect(out).toHaveLength(2);
    const copy = out.find((e) => e.id !== 'a')!;
    expect(copy.atSec).toBeCloseTo(2, 9);
    expect(copy.untilSec).toBeCloseTo(4, 9);
    expect(copy.clipId).toBe('c');
  });
  it('a copy that does not fit against the neighbour refuses (input untouched)', () => {
    const out = duplicateBand([ev('a', 0, 2), ev('b', 2.5, 4)], 'a');
    expect(out).toHaveLength(2);
  });
});

describe('splitBandAt', () => {
  it('yields two bands whose offsets keep the music in place', () => {
    const out = splitBandAt([ev('a', 4, 8, 1)], 'a', 6, 120);
    expect(out).toHaveLength(2);
    const [l, r] = [...out].sort((x, y) => x.atSec - y.atSec);
    expect(l.untilSec).toBeCloseTo(6, 9);
    expect(r.atSec).toBeCloseTo(6, 9);
    expect(r.untilSec).toBeCloseTo(8, 9);
    expect(r.offsetSec).toBeCloseTo(1 + 2, 9); // original offset + seconds cut away
    expect(r.id).not.toBe(l.id);
  });
  it('a cut outside the band is a no-op', () => {
    const events = [ev('a', 4, 8)];
    expect(splitBandAt(events, 'a', 4, 120)).toHaveLength(1);
    expect(splitBandAt(events, 'a', 9, 120)).toHaveLength(1);
  });
});

describe('trimBandStart', () => {
  it('slides atSec and offsetSec together', () => {
    const out = trimBandStart([ev('a', 4, 8, 0)], 'a', 5, 120);
    const a = out.find((e) => e.id === 'a')!;
    expect(a.atSec).toBeCloseTo(5, 9);
    expect(a.offsetSec).toBeCloseTo(1, 9);
  });
  it('never trims into negative offset — you can only reveal what exists', () => {
    const out = trimBandStart([ev('a', 4, 8, 0.5)], 'a', 3, 120);
    const a = out.find((e) => e.id === 'a')!;
    expect(a.offsetSec).toBeGreaterThanOrEqual(-1e-9);
    expect(a.atSec).toBeGreaterThanOrEqual(3.5 - 1e-9);
  });
  it('keeps at least one beat of band', () => {
    const out = trimBandStart([ev('a', 4, 8, 0)], 'a', 7.9, 120);
    const a = out.find((e) => e.id === 'a')!;
    expect(a.untilSec - a.atSec).toBeGreaterThanOrEqual(60 / 120 - 1e-9);
  });
});
