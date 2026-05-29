import { describe, it, expect } from 'vitest';
import {
  launchClip, stopLane, tickSession, emptyLanePlayState,
  type LanePlayState,
} from './session-runtime';
import { emptyArrangementState } from '../performance/performance';
import { createRecState, armRec, startRecording } from '../performance/rec-state';
import {
  type SessionState, type SessionClip, emptySessionState,
} from './session';

function withSingleLane(): { s: SessionState; clip: SessionClip } {
  const s = emptySessionState();
  s.lanes = [{ id: 'tb-303-1', engineId: 'tb303', clips: [] }];
  const clip: SessionClip = { id: 'c1', lengthBars: 1, notes: [] };
  s.lanes[0].clips = [clip];
  return { s, clip };
}

describe('launchClip recording hook', () => {
  it('appends a clipEvent when rec.recording is true', () => {
    const { s, clip } = withSingleLane();
    const laneStates = new Map<string, LanePlayState>();
    const rec = createRecState();
    const arrangement = emptyArrangementState(120);
    armRec(rec); startRecording(rec, 100);

    launchClip(laneStates, s, s.lanes[0], clip, /*now=*/100, /*bpm=*/120,
      { rec, arrangement });

    tickSession(
      laneStates, s, /*now=*/100, /*lookahead=*/0.15, /*bpm=*/120,
      () => {}, () => {},
      { rec, arrangement },
    );

    expect(arrangement.lanes[0].laneId).toBe('tb-303-1');
    expect(arrangement.lanes[0].clipEvents).toHaveLength(1);
    expect(arrangement.lanes[0].clipEvents[0].clipId).toBe('c1');
    expect(arrangement.lanes[0].clipEvents[0].atSec).toBeCloseTo(0, 3);
  });

  it('stopLane closes the pending clipEvent', () => {
    const { s, clip } = withSingleLane();
    const laneStates = new Map<string, LanePlayState>();
    const rec = createRecState();
    const arrangement = emptyArrangementState(120);
    armRec(rec); startRecording(rec, 0);

    launchClip(laneStates, s, s.lanes[0], clip, 0, 120, { rec, arrangement });
    tickSession(laneStates, s, 0, 0.15, 120, () => {}, () => {}, { rec, arrangement });

    stopLane(laneStates, 'tb-303-1', { rec, arrangement, nowCtx: 2 });

    expect(arrangement.lanes[0].clipEvents[0].untilSec).toBeCloseTo(2, 3);
  });
});
