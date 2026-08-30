// @vitest-environment jsdom
// Launch-solo / launch-mute: the arrangement stops DRIVING the other lanes
// (via the per-lane override gate), what already sounds leaves at the next bar
// through the same queuedStop door a scene launch uses, and clearing the solo
// re-anchors the freed lanes into the band under the playhead.
import { describe, it, expect } from 'vitest';
import { createArrangementPlayback, type ArrangementPlaybackDeps } from './arrangement-playback';
import { createArrangementPlayState, isLaneOverridden } from '../performance/arrangement-runtime';
import { emptyArrangementState, newBandId } from '../performance/performance';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { createRecState } from '../performance/rec-state';

const MET = { num: 4, den: 4 } as const;

function fixture() {
  const arrangement = emptyArrangementState(120); // barSec = 2s at 4/4
  const band = (laneId: string, clipId: string, atSec: number, untilSec: number) =>
    ({ id: newBandId(), clipId, laneId, atSec, untilSec });
  arrangement.lanes.push(
    { laneId: 'l1', clipEvents: [band('l1', 'c1', 0, 8)], automation: [] },
    { laneId: 'l2', clipEvents: [band('l2', 'c2', 0, 8)], automation: [] },
  );
  arrangement.durationSec = 8; // the fixture skips recomputeDurationSec
  const laneStates = new Map<string, LanePlayState>([
    ['l1', emptyLanePlayState('l1')],
    ['l2', emptyLanePlayState('l2')],
  ]);
  const sessionLanes = ['l1', 'l2'].map((id) => ({
    id, engineId: 'tb303', name: id, inserts: [],
    clips: [{ id: `c${id.slice(1)}`, lengthBars: 4, notes: [], gridResolution: '1/16', color: '#111' }],
  }));
  const ctx = { currentTime: 0 } as AudioContext;
  const ps = createArrangementPlayState();
  const deps = {
    ctx,
    seq: { meter: MET } as never,
    sessionHost: {
      state: { lanes: sessionLanes },
      laneStates,
      deps: { liveVoices: undefined },
      songAnchorSec: 0,
      setSongAnchor: () => {},
    } as never,
    automationRegistry: new Map(),
    arrangement,
    ps,
    recHooks: { rec: createRecState(), arrangement },
    getPxPerBar: () => 40,
    isPerformanceMode: () => true,
  } as unknown as ArrangementPlaybackDeps;
  return { deps, ps, laneStates, ctx, arrangement };
}

describe('launch-solo', () => {
  it('soloing l1 overrides l2 and stops it at the NEXT bar via queuedStop', () => {
    const { deps, ps, laneStates, ctx } = fixture();
    const pb = createArrangementPlayback(deps);
    pb.begin();                       // startedAtCtx = 0
    (ctx as { currentTime: number }).currentTime = 1.3; // mid bar 1 (barSec 2)
    pb.setLaunchSolo('l1');
    expect(isLaneOverridden(ps, 'l2')).toBe(true);
    expect(isLaneOverridden(ps, 'l1')).toBe(false);
    // stop lands on the next bar boundary: ceil(1.3 / 2) * 2 = 2 (ctx time 2)
    expect(laneStates.get('l2')!.queuedStop).toBeCloseTo(2, 9);
    expect(laneStates.get('l1')!.queuedStop).toBeNull();
  });

  it('after the solo, ticking launches only the solo lane', () => {
    const { deps, ps, laneStates, ctx } = fixture();
    const pb = createArrangementPlayback(deps);
    pb.begin();
    (ctx as { currentTime: number }).currentTime = 1.3;
    pb.setLaunchSolo('l1');
    // reset the pointers as if nothing launched yet, then tick across t=0
    ps.nextEventIdxPerLane.clear();
    pb.tick(1.3, 0.12);
    expect(laneStates.get('l1')!.queued).not.toBeNull();  // l1 got its launch
    expect(laneStates.get('l2')!.queued).toBeNull();       // l2 stayed silent
    expect(ps.laneOverridden.get('l2')).toBe(true);
  });

  it('clearing the solo re-anchors the freed lane into the band under the playhead', () => {
    const { deps, laneStates, ctx } = fixture();
    const pb = createArrangementPlayback(deps);
    pb.begin();
    (ctx as { currentTime: number }).currentTime = 5;   // inside c2's [0,8) span
    pb.setLaunchSolo('l1');
    laneStates.get('l2')!.queued = null;
    pb.setLaunchSolo(null);
    // l2 got relaunched (queued) and its pending bar-stop was cancelled
    expect(laneStates.get('l2')!.queued).not.toBeNull();
    expect(laneStates.get('l2')!.queuedStop).toBeNull();
  });
});

describe('timeline wins — the weave door', () => {
  it('begin() claims every lane (null) and each band launch claims its lane', () => {
    const { deps, ctx } = fixture();
    const claimed: (string | null)[] = [];
    (deps as { onTimelineLaunch?: (id: string | null) => void }).onTimelineLaunch =
      (id) => claimed.push(id);
    const pb = createArrangementPlayback(deps);
    pb.begin();
    expect(claimed).toEqual([null]);   // a take speaks for every lane, like a scene
    (ctx as { currentTime: number }).currentTime = 0.01;
    pb.tick(0.01, 0.12);
    // both lanes' bands at t=0 launched, each claiming its lane BEFORE the launch
    expect(claimed.slice(1).sort()).toEqual(['l1', 'l2']);
  });
});

describe('band offset — the trimmed band enters the clip already started', () => {
  it('launches with a past-shifted anchor: queuedBoundary = launch time - offsetSec', () => {
    const { deps, laneStates, ctx, arrangement } = fixture();
    arrangement.lanes[0].clipEvents[0].atSec = 2;
    arrangement.lanes[0].clipEvents[0].untilSec = 6;
    arrangement.lanes[0].clipEvents[0].offsetSec = 1.5;
    const pb = createArrangementPlayback(deps);
    pb.begin();
    (ctx as { currentTime: number }).currentTime = 2;
    pb.tick(2, 0.12);
    // the clip "entered already started": its anchor sits offsetSec in the past
    expect(laneStates.get('l1')!.queuedBoundary).toBeCloseTo(2 - 1.5, 9);
  });
});

describe('launch-mute', () => {
  it('is the single-lane version of the same gate', () => {
    const { deps, ps, laneStates, ctx } = fixture();
    const pb = createArrangementPlayback(deps);
    pb.begin();
    (ctx as { currentTime: number }).currentTime = 1.3;
    pb.setLaunchMute('l2', true);
    expect(isLaneOverridden(ps, 'l2')).toBe(true);
    expect(laneStates.get('l2')!.queuedStop).toBeCloseTo(2, 9);
    pb.setLaunchMute('l2', false);
    expect(isLaneOverridden(ps, 'l2')).toBe(false);
  });

  it('getLaunchState reports what the header paints', () => {
    const { deps } = fixture();
    const pb = createArrangementPlayback(deps);
    pb.setLaunchMute('l2', true);
    pb.setLaunchSolo('l1');
    expect(pb.getLaunchState()).toEqual({ solo: 'l1', muted: new Set(['l2']) });
  });
});

describe('mixer automation route', () => {
  it('a .mixer.mute curve lands on applyMixerFlag, thresholded at 0.5', () => {
    const { deps, arrangement, ctx } = fixture();
    const flags: Array<[string, string, boolean]> = [];
    (deps as { applyMixerFlag?: (l: string, k: string, on: boolean) => void }).applyMixerFlag =
      (l, k, on) => flags.push([l, k, on]);
    arrangement.lanes[0].automation.push({ paramId: 'l1.mixer.mute', values: [1, 1, 1, 1], enabled: true });
    const pb = createArrangementPlayback(deps);
    pb.begin();
    (ctx as { currentTime: number }).currentTime = 0.01;
    pb.tick(0.01, 0.12);
    expect(flags).toContainEqual(['l1', 'mute', true]);
  });
});
