import { describe, it, expect } from 'vitest';
import { resolveAutomationTarget } from './automation-target-resolver';
import type { SessionState } from '../session/session-types';
import type { LanePlayState } from '../session/session-runtime';

function playState(laneId: string, playing: { id: string } | null): LanePlayState {
  return { laneId, playing, queued: null, queuedBoundary: 0, queuedStop: null,
    startTime: 0, nextStepIdx: 0, loopCount: 0, loopStartedAt: 0,
    lastScheduledAt: -Infinity } as unknown as LanePlayState;
}

function stateWith(clips: ({ id: string; name?: string } | null)[]): SessionState {
  return {
    lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips, inserts: [] }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

const NO_TIMELINE: string[] = [];

describe('resolveAutomationTarget', () => {
  it('routes to the timeline in Performance mode', () => {
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'performance',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toEqual({ kind: 'timeline', existing: false });
  });

  it('reports an existing timeline curve', () => {
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'performance',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: ['poly1.filter.cutoff'],
    });
    expect(t).toEqual({ kind: 'timeline', existing: true });
  });

  it('routes to the clip PLAYING on that param\'s lane', () => {
    const state = stateWith([{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }]);
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state,
      laneStates: new Map([['poly1', playState('poly1', { id: 'c2' })]]),
      timelineParamIds: NO_TIMELINE,
    });
    expect(t).toEqual({ kind: 'clip', laneId: 'poly1', clipIdx: 1, clipName: 'B', existing: false });
  });

  it('falls back to the first clip when nothing is playing', () => {
    const state = stateWith([null, { id: 'c2', name: 'B' }]);
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state,
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toEqual({ kind: 'clip', laneId: 'poly1', clipIdx: 1, clipName: 'B', existing: false });
  });

  it('reports an envelope the clip already has', () => {
    const state = stateWith([
      { id: 'c1', name: 'A', envelopes: [{ paramId: 'poly1.filter.cutoff' }] } as never,
    ]);
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state,
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toMatchObject({ kind: 'clip', existing: true });
  });

  it('is unavailable for a master FX param outside Performance', () => {
    const t = resolveAutomationTarget({
      paramId: 'fx.master.fx:slotA.freq', mode: 'session',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t.kind).toBe('unavailable');
    expect((t as { reason: string }).reason).toMatch(/Performance/);
  });

  it('is unavailable when the track has no clips', () => {
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state: stateWith([null, null]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t.kind).toBe('unavailable');
    expect((t as { reason: string }).reason).toMatch(/no clips/i);
  });

  it('is unavailable when the lane no longer exists', () => {
    const t = resolveAutomationTarget({
      paramId: 'ghost.filter.cutoff', mode: 'session',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t.kind).toBe('unavailable');
  });

  // FINDING 1: Legacy-shaped param id (e.g. poly1.fx2.mix)
  it('rejects legacy-shaped insert param ids with a clear reason', () => {
    const t = resolveAutomationTarget({
      paramId: 'poly1.fx2.mix', mode: 'session',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t.kind).toBe('unavailable');
    expect((t as { reason: string }).reason).not.toMatch(/track is gone/i);
  });

  // FINDING 2: Insert param (e.g. poly1.fx:slotA.freq)
  it('routes to the clip for an insert param on that lane', () => {
    const state = stateWith([null, { id: 'c2', name: 'B' }]);
    const t = resolveAutomationTarget({
      paramId: 'poly1.fx:slotA.freq', mode: 'session', state,
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toEqual({ kind: 'clip', laneId: 'poly1', clipIdx: 1, clipName: 'B', existing: false });
  });

  // FINDING 3: Unnamed clip fallback
  it('uses a positional label for unnamed clips', () => {
    const state = stateWith([null, { id: 'c2' }]); // no name
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state,
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toMatchObject({ kind: 'clip', clipIdx: 1 });
    expect((t as { clipName: string }).clipName).toBe('Clip 2');
  });
});
