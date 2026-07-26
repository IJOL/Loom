// The two siblings that land a value on an UNMOUNTED target differ in exactly
// one thing, and these cases pin that difference from both sides: a live gesture
// persists into `lane.engineState.params`, a replayed curve never does.
import { describe, it, expect } from 'vitest';
import { applyAutomationToSession } from './automation-apply';
import { applyLiveControlWrite } from './live-control-apply';
import { withoutParamMirror } from '../session/session-engine-state';
import type { SessionState } from '../session/session';

const LANE = 'poly1';

function fixture() {
  const state = {
    lanes: [{ id: LANE, engineId: 'subtractive', clips: [], inserts: [] }],
  } as unknown as SessionState;
  const engineVals: Record<string, number> = { 'filter.cutoff': 0 };
  const fxVals: Record<string, number> = { freq: 0 };
  const deps = {
    getEngine: (laneId: string) => (laneId === LANE ? {
      getBaseValue: (id: string) => engineVals[id] ?? 0,
      setBaseValue: (id: string, v: number) => { engineVals[id] = v; },
    } : undefined),
    getInsertFx: () => ({
      getBaseValue: (id: string) => fxVals[id] ?? 0,
      setBaseValue: (id: string, v: number) => { fxVals[id] = v; },
    }),
    getRange: () => ({ min: 0, max: 100 }),
    sessionState: state,
  };
  return { state, engineVals, fxVals, deps };
}

const saved = (s: SessionState, id: string) => s.lanes[0].engineState?.params?.[id];

describe('applyLiveControlWrite', () => {
  it('mirrors an engine write into engineState.params, matching what reached the engine', () => {
    const f = fixture();

    expect(applyLiveControlWrite(`${LANE}.filter.cutoff`, 0.25, f.deps)).toBe(true);

    expect(f.engineVals['filter.cutoff']).toBeGreaterThan(0);            // the sound moved
    expect(saved(f.state, 'filter.cutoff')).toBe(f.engineVals['filter.cutoff']);
  });

  it('leaves engineState alone for an insert write (that one persists through lane.inserts)', () => {
    const f = fixture();

    expect(applyLiveControlWrite(`${LANE}.fx:slot-a.freq`, 0.5, f.deps)).toBe(true);

    expect(f.fxVals.freq).toBeGreaterThan(0);
    expect(f.state.lanes[0].engineState?.params).toBeUndefined();
  });

  it('drives the engine but writes nothing when the lane is not in the session', () => {
    // A destination can outlive its lane for a frame (the catalogue is rebuilt
    // on invalidate). mirrorParamChange no-ops on an unknown lane, so the write
    // must still land on the engine rather than throw.
    const f = fixture();
    const orphanState = { lanes: [] } as unknown as SessionState;

    expect(applyLiveControlWrite(`${LANE}.filter.cutoff`, 0.25, { ...f.deps, sessionState: orphanState }))
      .toBe(true);

    expect(f.engineVals['filter.cutoff']).toBeGreaterThan(0);
    expect(orphanState.lanes.length).toBe(0);
  });

  it('reports failure, and mirrors nothing, when the target is gone', () => {
    const f = fixture();

    expect(applyLiveControlWrite('GONE.filter.cutoff', 0.25, f.deps)).toBe(false);

    expect(saved(f.state, 'filter.cutoff')).toBeUndefined();
  });

  it('respects withoutParamMirror, so a caller that suppresses the mirror still gets the sound', () => {
    const f = fixture();

    withoutParamMirror(() => applyLiveControlWrite(`${LANE}.filter.cutoff`, 0.25, f.deps));

    expect(f.engineVals['filter.cutoff']).toBeGreaterThan(0);
    expect(saved(f.state, 'filter.cutoff')).toBeUndefined();
  });
});

describe('applyAutomationToSession stays the replay path', () => {
  it('writes the same engine value and mirrors NOTHING (a curve is not the lane base sound)', () => {
    // The negative control for a97d67b. Both calls are handed the identical
    // deps, so the only difference on show is the mirror.
    const f = fixture();

    expect(applyAutomationToSession(`${LANE}.filter.cutoff`, 0.25, f.deps)).toBe(true);

    expect(f.engineVals['filter.cutoff']).toBeGreaterThan(0);
    expect(saved(f.state, 'filter.cutoff')).toBeUndefined();
  });

  it('lands the identical value the live writer does — only persistence differs', () => {
    const live = fixture();
    const replay = fixture();

    applyLiveControlWrite(`${LANE}.filter.cutoff`, 0.75, live.deps);
    applyAutomationToSession(`${LANE}.filter.cutoff`, 0.75, replay.deps);

    expect(live.engineVals['filter.cutoff']).toBe(replay.engineVals['filter.cutoff']);
  });
});
