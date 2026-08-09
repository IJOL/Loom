// Does the step row's value actually reach the ENGINE?
//
// Reported from the panel: the row is on, the destination is a lane's Cutoff,
// and nothing is heard. Every link of the chain has its own test — the row's
// write (weave-wiring.test.ts), the id parse and the engine write
// (automation-apply.test.ts), the live bag (live-params.dsp.test.ts) — and the
// JOIN had none. A destination that lists but does not land looks exactly like
// a broken row, and this file is where that would show.
import { describe, it, expect, vi } from 'vitest';
import { createWeaveWiring } from './weave-wiring';
import { applyAutomationToSession } from '../automation/automation-apply';
import { DEFAULT_METER } from '../core/meter';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

// The id the panel actually had selected, lane and all.
const DEST = 'subtractive-1.filter.cutoff';
const RANGES = new Map([[DEST, { min: 20, max: 20000 }]]);

function harness() {
  const state = {
    lanes: [{ id: 'subtractive-1', name: 'Sub 1', engineId: 'subtractive', clips: [], inserts: [] }],
    scenes: [],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;

  const setBaseValue = vi.fn();
  const engine = { setBaseValue, getBaseValue: () => 0 };

  // main.ts's own wiring, spelled out: the row's write goes through the
  // PLAYBACK door with the ranges the destination catalogue declares.
  const w = createWeaveWiring({
    getLaneStates: () => new Map<string, LanePlayState>(),
    getMeter: () => DEFAULT_METER,
    getState: () => state,
    writeStep: (destId, v) => {
      applyAutomationToSession(destId, v, {
        getInsertFx: () => undefined,
        getEngine: (laneId) => (laneId === 'subtractive-1' ? engine : undefined) as never,
        getRange: (id) => RANGES.get(id),
      });
    },
  });
  return { w, setBaseValue };
}

describe('the step row reaches the engine it names', () => {
  it('lands a value on the lane\'s param, denormalised into real units', () => {
    const h = harness();
    h.w.state.steps = [{ destId: DEST, values: [0, 1], mode: 'hold', on: true }];
    h.w.advance(0);        // first half of the bar -> step 0
    h.w.advance(1.2);      // second half -> step 1

    expect(h.setBaseValue.mock.calls).toEqual([
      ['filter.cutoff', 20],
      ['filter.cutoff', 20000],
    ]);
  });

  it('lands nothing when the id names a lane that is gone', () => {
    // Honest silence rather than a throw: a lane can be deleted while a row
    // still points at it.
    const h = harness();
    h.w.state.steps = [{ destId: 'deleted-lane.filter.cutoff', values: [0, 1], mode: 'hold', on: true }];
    h.w.advance(0);
    h.w.advance(1.2);
    expect(h.setBaseValue).not.toHaveBeenCalled();
  });

  it('lands nothing when the catalogue has no range for the id', () => {
    // The quiet failure this file exists to catch: getRange returns undefined
    // and applyAutomationToSession answers false, writing nowhere at all.
    const h = harness();
    h.w.state.steps = [{ destId: 'subtractive-1.filter.notAThing', values: [0, 1], mode: 'hold', on: true }];
    h.w.advance(0);
    h.w.advance(1.2);
    expect(h.setBaseValue).not.toHaveBeenCalled();
  });
});
