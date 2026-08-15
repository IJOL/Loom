// Finding the moment a square arrives at a corner.
//
// A→B is told when it laps: the position wraps and the flow reports it. A cloud
// gets no such report — arriving at a corner is four times a lap and never a
// wrap — so the arrival has to be READ out of where the lane now is, against
// where it was. These are the edges of that reading.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evolveCloudLanes } from './weave-cloud-evolve';
import { weaveLoopContext } from './weave-loops';
import { setLibrary } from '../patterns/pattern-library';
import { cloudPathPoint } from '../weave/topology-cloud';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import type { LaneSelection } from '../weave/weave-state';
import type { SessionLane } from '../session/session';

const STYLE = DEFAULT_MUSICALITY.style;
const STEPS = [{ semi: 0, vel: 0.8, slide: false }];

beforeEach(() => {
  setLibrary({
    synth: {}, bass: {}, drums: { [STYLE]: Array.from({ length: 8 }, () => STEPS) }, catalog: {},
  } as never);
});
afterEach(() => setLibrary(null as never));

const CTX = () => ({
  ...weaveLoopContext(
    { id: 'd1', engineId: 'drums-machine', name: 'd1', clips: [], inserts: [] } as unknown as SessionLane,
    { ...DEFAULT_MUSICALITY, lock: false }, undefined,
    { styleMix: 0, darkness: 0.5, laneIndex: 0, seed: 1 },
  ),
  harmonic: false,
});

/** A cloud lane parked `t` of the way round its lap. */
const cloudAt = (t: number, legAt?: number): LaneSelection => ({
  weave: {
    kind: 'cloud',
    corners: [0, 1, 2, 3].map((i) => `lib:${STYLE}:drums:${i}`),
    path: 'rim',
    t,
    ...cloudPathPoint('rim', t),
  },
  locked: false,
  harmonyLeader: false,
  ...(legAt === undefined ? {} : { legAt }),
});

const corners = (lanes: Record<string, LaneSelection | undefined>) =>
  (lanes.d1!.weave as { corners: string[] }).corners;

describe('finding a cloud lane’s arrivals', () => {
  it('draws nothing the first time it sees a lane — it has not travelled yet', () => {
    // Opening a session must not re-deal a corner. Without this a save reloaded
    // would come back with a loop nobody chose.
    const lanes = { d1: cloudAt(0.3) };
    const before = corners(lanes);
    expect(evolveCloudLanes(lanes, ['d1'], CTX, 1)).toBe(false);
    expect(corners(lanes)).toEqual(before);
    expect(lanes.d1!.legAt).toBe(1);
  });

  it('hands the corner behind it over when the leg changes', () => {
    // Sitting on leg 1 means the leg from the top-left has just ended, so the
    // top-left is what changes and nothing else does.
    const lanes = { d1: cloudAt(0.3, 0) };
    const before = corners(lanes);
    expect(evolveCloudLanes(lanes, ['d1'], CTX, 1)).toBe(true);
    const after = corners(lanes);
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(lanes.d1!.legAt).toBe(1);
  });

  it('does nothing at all while the dot stays on one leg', () => {
    // The tick runs far faster than the journey: a leg is a quarter of a lap and
    // a lap is bars long, so most calls have nothing to do and must cost nothing
    // and change nothing.
    const lanes = { d1: cloudAt(0.3, 1) };
    const before = corners(lanes);
    expect(evolveCloudLanes(lanes, ['d1'], CTX, 1)).toBe(false);
    expect(corners(lanes)).toEqual(before);
  });

  it('leaves A→B lanes alone — they hand over on their own wrap', () => {
    const lanes: Record<string, LaneSelection> = {
      d1: {
        weave: { kind: 'ab', a: `lib:${STYLE}:drums:0`, b: `lib:${STYLE}:drums:1`, x: 0.4 },
        locked: false, harmonyLeader: false,
      },
    };
    expect(evolveCloudLanes(lanes, ['d1'], CTX, 1)).toBe(false);
    expect(lanes.d1.weave).toMatchObject({ b: `lib:${STYLE}:drums:1` });
    expect(lanes.d1.legAt).toBeUndefined();
  });

  it('is repeatable — the same square on the same seed hands over the same loop', () => {
    const a = { d1: cloudAt(0.3, 0) };
    const b = { d1: cloudAt(0.3, 0) };
    evolveCloudLanes(a, ['d1'], CTX, 7);
    evolveCloudLanes(b, ['d1'], CTX, 7);
    expect(corners(a)).toEqual(corners(b));
  });
});
