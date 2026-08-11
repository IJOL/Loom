// Where a travelling cloud goes.
//
// The bug this answers: the master flow is ONE number and a cloud is two, so
// applyFlow wrote x and left y alone. A cloud with a speed set slid back and
// forth along whatever horizontal line the dot happened to be on — three of its
// four corners unreachable for the whole lap.
import { describe, it, expect } from 'vitest';
import { cloudPathPoint, cloudWeights } from './topology-cloud';
import { applyFlow, type PositionedWeave } from './flow';

const CORNERS = [0, 1, 2, 3].map((i) => ({ notes: [], id: `c${i}` })) as never;

/** The four corners, as points. */
const AT = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };
const near = (p: { x: number; y: number }, [x, y]: number[]) =>
  Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;

describe('the RIM path', () => {
  it('starts and ends at the same corner, so a lap closes', () => {
    // A journey that ended somewhere else would jump every time it wrapped.
    expect(near(cloudPathPoint('rim', 0), AT.tl)).toBe(true);
    expect(near(cloudPathPoint('rim', 1), AT.tl)).toBe(true);
  });

  it('touches all four corners, a quarter of the lap apart', () => {
    expect(near(cloudPathPoint('rim', 0), AT.tl)).toBe(true);
    expect(near(cloudPathPoint('rim', 0.25), AT.tr)).toBe(true);
    expect(near(cloudPathPoint('rim', 0.5), AT.br)).toBe(true);
    expect(near(cloudPathPoint('rim', 0.75), AT.bl)).toBe(true);
  });

  it('stays on an EDGE the whole way round', () => {
    // Which is the point of it: on an edge two of the four weights are zero, so
    // the cloud behaves as the two-loop crossfade the blend is good at.
    for (let i = 0; i < 100; i++) {
      const p = cloudPathPoint('rim', i / 100);
      const onEdge = [p.x, p.y].some((v) => Math.abs(v) < 1e-9 || Math.abs(v - 1) < 1e-9);
      expect(onEdge).toBe(true);
    }
  });

  it('never has more than two loops sounding', () => {
    // The same claim, measured where it is actually heard.
    for (let i = 0; i < 100; i++) {
      const p = cloudPathPoint('rim', i / 100);
      const sounding = cloudWeights({ corners: CORNERS, ...p })
        .filter((w) => w.weight > 1e-9).length;
      expect(sounding).toBeLessThanOrEqual(2);
    }
  });
});

describe('the CROSS path', () => {
  it('touches all four corners too', () => {
    expect(near(cloudPathPoint('cross', 0), AT.tl)).toBe(true);
    expect(near(cloudPathPoint('cross', 0.25), AT.tr)).toBe(true);
    expect(near(cloudPathPoint('cross', 0.5), AT.bl)).toBe(true);
    expect(near(cloudPathPoint('cross', 0.75), AT.br)).toBe(true);
  });

  it('crosses the middle TWICE a lap', () => {
    // The whole difference between the two paths, and the only place where all
    // four loops sound at once.
    expect(near(cloudPathPoint('cross', 0.375), [0.5, 0.5])).toBe(true);
    expect(near(cloudPathPoint('cross', 0.875), [0.5, 0.5])).toBe(true);
  });

  it('puts all four loops in play at the middle, and RIM never does', () => {
    const four = (t: number, path: 'rim' | 'cross') =>
      cloudWeights({ corners: CORNERS, ...cloudPathPoint(path, t) })
        .filter((w) => w.weight > 1e-9).length;
    expect(four(0.375, 'cross')).toBe(4);
    for (let i = 0; i < 100; i++) expect(four(i / 100, 'rim')).toBeLessThanOrEqual(2);
  });

  it('closes its lap as well', () => {
    expect(near(cloudPathPoint('cross', 1), AT.tl)).toBe(true);
  });
});

describe('whatever it is handed', () => {
  it('treats an absent path as RIM', () => {
    // Every cloud saved before this existed has no path. It must travel, not
    // sit still or throw.
    expect(cloudPathPoint(undefined, 0.25)).toEqual(cloudPathPoint('rim', 0.25));
  });

  it('folds a position outside 0..1 rather than running off the square', () => {
    expect(near(cloudPathPoint('rim', 1.25), AT.tr)).toBe(true);
    expect(near(cloudPathPoint('rim', -0.75), AT.tr)).toBe(true);
  });

  it('survives a position that is not a number', () => {
    // The caller is a clock, and a clock that has not started divides by zero
    // somewhere upstream.
    expect(near(cloudPathPoint('rim', NaN), AT.tl)).toBe(true);
  });
});

describe('the flow actually moves a cloud in two dimensions', () => {
  type Lanes = Record<string, { weave?: PositionedWeave | null; locked?: boolean }>;
  const cloudLane = (t?: number): Lanes => ({
    lane1: { weave: { kind: 'cloud', corners: ['a', 'b', 'c', 'd'], x: 0, y: 0, t } },
  });

  it('writes BOTH coordinates, which is the bug', () => {
    const lanes = cloudLane();
    applyFlow(lanes, ['lane1'], 0.25, 'together');
    const w = lanes.lane1.weave as unknown as { x: number; y: number };
    expect(w.x).toBeCloseTo(1);
    expect(w.y).toBeCloseTo(0);

    applyFlow(lanes, ['lane1'], 0.5, 'together');
    expect((lanes.lane1.weave as unknown as { y: number }).y).toBeCloseTo(1);
  });

  it('keeps the lap in `t`, because x is now a coordinate', () => {
    // Half way round the rim the dot is at (1, 1) — an x of 1 that means "far
    // corner", not "lap finished". Without a separate lap the next tick would
    // read that 1 as a completed journey.
    const lanes = cloudLane();
    applyFlow(lanes, ['lane1'], 0.5, 'together');
    expect((lanes.lane1.weave as unknown as { t: number }).t).toBeCloseTo(0.5);
  });

  it('reports a WRAP off the lap and not off the coordinate', () => {
    // The rim's x goes 0 → 1 → 1 → 0 → 0 across a lap, so a coordinate-based
    // wrap test would fire in the middle of the journey and re-hook the lane
    // onto fresh loops half way round.
    const wrapped: string[] = [];
    const lanes = cloudLane(0.6);
    applyFlow(lanes, ['lane1'], 0.7, 'together', undefined, (id) => wrapped.push(id));
    expect(wrapped).toEqual([]);

    applyFlow(lanes, ['lane1'], 0.05, 'together', undefined, (id) => wrapped.push(id));
    expect(wrapped).toEqual(['lane1']);
  });

  it('leaves every other topology writing exactly x', () => {
    const lanes: Lanes = { lane1: { weave: { kind: 'ab', a: 'x', b: 'y', x: 0 } } };
    applyFlow(lanes, ['lane1'], 0.4, 'together');
    expect(lanes.lane1.weave).toEqual({ kind: 'ab', a: 'x', b: 'y', x: 0.4 });
  });
});
