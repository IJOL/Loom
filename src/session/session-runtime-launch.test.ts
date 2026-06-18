// src/session/session-runtime-launch.test.ts
import { describe, it, expect } from 'vitest';
import { launchClip, stopLane, stopAll, emptyLanePlayState, type LanePlayState } from './session-runtime';
import type { SessionState, SessionClip, SessionLane } from './session';

const BPM = 120; // 1 bar = 2s in 4/4

function setup(playingBars: number | null) {
  const playing: SessionClip = { id: 'old', lengthBars: 2, notes: [] };
  const next: SessionClip = { id: 'new', lengthBars: 1, notes: [] };
  const lane: SessionLane = { id: 'L', engineId: 'subtractive', clips: [playing, next] };
  const state: SessionState = { lanes: [lane], scenes: [], globalQuantize: 'immediate' };
  const lp: LanePlayState = { ...emptyLanePlayState('L') };
  if (playingBars != null) { lp.playing = playing; lp.loopStartedAt = 0; }
  const laneStates = new Map([['L', lp]]);
  return { state, lane, next, laneStates, lp };
}

describe('stopLane clears queuedStop', () => {
  it('clears a stale queuedStop so a future relaunch is not killed', () => {
    const { laneStates, lp } = setup(2);
    lp.queuedStop = 99;
    stopLane(laneStates, 'L');
    expect(lp.queuedStop).toBeNull();
  });
});

describe('stopAll clears queuedStop on every lane', () => {
  it('clears queuedStop so no orphan-stop fires after a fresh relaunch', () => {
    const { laneStates, lp } = setup(2);
    lp.queuedStop = 99;
    stopAll(laneStates);
    expect(lp.queuedStop).toBeNull();
  });
});

describe('launchClip clears stale queuedStop', () => {
  it('hot-swap path: clears queuedStop so the newly queued clip is not silenced', () => {
    const { state, lane, next, laneStates, lp } = setup(2);
    lp.queuedStop = 99; // stale from a prior scene launch
    launchClip(laneStates, state, lane, next, /*now=*/3, BPM);
    expect(lp.queued).toBe(next);
    expect(lp.queuedStop).toBeNull();
  });
});

describe('launchClip hot-swap waits for the current loop end', () => {
  it('lane already playing → queues at the current clip loop end', () => {
    const { state, lane, next, laneStates, lp } = setup(2);
    // old clip is 2 bars = 4s, started at 0; now = 3 → next loop end = 4
    launchClip(laneStates, state, lane, next, /*now=*/3, BPM);
    expect(lp.queued).toBe(next);
    expect(lp.queuedBoundary).toBeCloseTo(4, 9);
  });

  it('cold lane (nothing playing) → uses the quantize grid (immediate)', () => {
    const { state, lane, next, laneStates, lp } = setup(null);
    launchClip(laneStates, state, lane, next, /*now=*/3, BPM); // globalQuantize 'immediate'
    expect(lp.queued).toBe(next);
    expect(lp.queuedBoundary).toBeCloseTo(3, 9); // immediate → now
  });
});
