import { describe, it, expect } from 'vitest';
import { snapSecToBeat, moveEvent, resizeEvent, deleteEvent } from './arrangement-edit';
import type { ArrangementClipEvent } from './performance';

const E = (id: string, at: number, until: number): ArrangementClipEvent =>
  ({ clipId: id, laneId: 'L', atSec: at, untilSec: until });

describe('snapSecToBeat (120 bpm → 0.5s per beat)', () => {
  it('rounds to the nearest beat', () => {
    expect(snapSecToBeat(0.24, 120)).toBeCloseTo(0.0, 6);
    expect(snapSecToBeat(0.26, 120)).toBeCloseTo(0.5, 6);
    expect(snapSecToBeat(1.1, 120)).toBeCloseTo(1.0, 6);
  });
});

describe('moveEvent', () => {
  it('moves a band to a free slot, snapped, keeping its duration', () => {
    const events = [E('a', 0, 2), E('b', 4, 6)];
    const out = moveEvent(events, 1, 2.1, 120); // move b near 2.0
    const b = out.find((e) => e.clipId === 'b')!;
    expect(b.atSec).toBeCloseTo(2.0, 6);
    expect(b.untilSec - b.atSec).toBeCloseTo(2.0, 6); // duration preserved
  });
  it('does not mutate the input array', () => {
    const events = [E('a', 0, 2)];
    const copy = JSON.parse(JSON.stringify(events));
    moveEvent(events, 0, 4, 120);
    expect(events).toEqual(copy);
  });
  it('ripples following bands forward to avoid overlap', () => {
    const events = [E('a', 0, 2), E('b', 2, 4)];
    // drag a's right so it now spans [0,3]? No — move a to start at 1 → [1,3], collides with b[2,4]
    const out = moveEvent(events, 0, 1, 120).sort((x, y) => x.atSec - y.atSec);
    // a is at [1,3]; b must be pushed to start at 3 (a.untilSec), keeping its 2s duration → [3,5]
    const a = out.find((e) => e.clipId === 'a')!;
    const b = out.find((e) => e.clipId === 'b')!;
    expect(a.atSec).toBeCloseTo(1, 6);
    expect(b.atSec).toBeCloseTo(3, 6);
    expect(b.untilSec).toBeCloseTo(5, 6);
  });
  it('clamps atSec to >= 0', () => {
    const out = moveEvent([E('a', 2, 4)], 0, -1, 120);
    expect(out[0].atSec).toBe(0);
    expect(out[0].untilSec).toBeCloseTo(2, 6);
  });
});

describe('resizeEvent', () => {
  it('end edge extends untilSec (snapped) and ripples the next band', () => {
    const events = [E('a', 0, 2), E('b', 2, 4)];
    const out = resizeEvent(events, 0, 'end', 3.1, 120); // a → [0,3]
    const a = out.find((e) => e.clipId === 'a')!;
    const b = out.find((e) => e.clipId === 'b')!;
    expect(a.untilSec).toBeCloseTo(3, 6);
    expect(b.atSec).toBeCloseTo(3, 6); // pushed
  });
  it('start edge moves atSec (snapped), keeping at least one beat', () => {
    const out = resizeEvent([E('a', 0, 2)], 0, 'start', 1.1, 120); // → [1,2]
    expect(out[0].atSec).toBeCloseTo(1, 6);
    expect(out[0].untilSec).toBeCloseTo(2, 6);
  });
  it('enforces a 1-beat minimum width on the end edge', () => {
    const out = resizeEvent([E('a', 0, 2)], 0, 'end', 0.1, 120); // try to shrink below a beat
    expect(out[0].untilSec - out[0].atSec).toBeGreaterThanOrEqual(0.5 - 1e-9); // 1 beat at 120
  });
  it('enforces a 1-beat minimum width on the start edge', () => {
    const out = resizeEvent([E('a', 0, 2)], 0, 'start', 1.9, 120); // try to push start past end-beat
    expect(out[0].untilSec - out[0].atSec).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });
});

describe('deleteEvent', () => {
  it('removes the band and leaves the gap (others unchanged)', () => {
    const events = [E('a', 0, 2), E('b', 4, 6)];
    const out = deleteEvent(events, 0);
    expect(out).toHaveLength(1);
    expect(out[0].clipId).toBe('b');
    expect(out[0].atSec).toBe(4); // not rippled
  });
  it('does not mutate the input', () => {
    const events = [E('a', 0, 2)];
    deleteEvent(events, 0);
    expect(events).toHaveLength(1);
  });
});
