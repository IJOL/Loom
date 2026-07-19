// src/control/loom-facade.test.ts
// Task 10: the APC's device-knob bank must reach insert/FX params, not just
// engine params. Today `engineParamIds` returns bare local ids
// (`res.engine.params...map(p => p.id)`) and `setEngineParam` looks the id up
// ONLY in `res.engine.params` — an insert id fails that lookup and is
// silently dropped (see loom-facade.ts:54-63, 293-297 before this task).
//
// These tests build the REAL DestinationRegistry (not a fake) against a real
// registered engine + fx plugin, following xy-pad-ui.test.ts's pattern: an
// unregistered engine/plugin id makes listAutomationTargets silently return
// [], which would make these assertions pass or fail for the wrong reason.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLoomFacade, type LoomFacadeDeps } from './loom-facade';
import { createActiveLaneStore } from './active-lane';
import { createDestinationRegistry } from '../automation/destination-registry';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { multifilterPlugin } from '../plugins/fx/multifilter';
import { getEngine } from '../engines/registry';
import type { SessionState, SessionLane } from '../session/session';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import type { SynthEngine } from '../engines/engine-types';
// Side-effect import: registers the 'subtractive' engine descriptor so
// listAutomationTargets() can find its continuous engine params, and so a
// fake SynthEngine for the bare-id test can borrow its real (dotted) param
// ids. Without this getEngine('subtractive') returns undefined and the
// catalogue silently offers zero engine params for 'poly1'.
import '../engines/subtractive';

beforeEach(() => {
  _resetRegistry();
  registerPlugin(multifilterPlugin);
});
afterEach(() => { _resetRegistry(); });

function stateWith(lane: Partial<SessionLane> & { id: string; engineId: string }): SessionState {
  return {
    lanes: [{ name: lane.id, clips: [], inserts: [], ...lane }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

function makeHostStub(state: SessionState): SessionHost {
  return {
    state,
    laneStates: new Map(),
    inspector: { getSelectedClip: () => null, refreshOpenEditor: () => {} },
  } as unknown as SessionHost;
}

function baseDeps(overrides: Partial<LoomFacadeDeps>): LoomFacadeDeps {
  const activeLane = createActiveLaneStore();
  return {
    ctx: { currentTime: 0, resume: () => Promise.resolve() } as unknown as AudioContext,
    sessionHost: makeHostStub(stateWith({ id: 'poly1', engineId: 'subtractive' })),
    laneResources: { get: () => undefined } as unknown as LaneResourceMap,
    activeLane,
    knobRegistry: new Map<string, KnobHandle>(),
    seq: { bpm: 120, meter: { num: 4, den: 4 }, isPlaying: () => false } as unknown as Sequencer,
    destinations: createDestinationRegistry({
      getState: () => makeHostStub(stateWith({ id: 'poly1', engineId: 'subtractive' })).state,
      getKnobRegistry: () => new Map(),
    }),
    ...overrides,
  };
}

describe('loom-facade — reaching insert/FX params from the device-knob bank', () => {
  it('drives an insert param through a canonical destination id, landing the real range value', () => {
    const state = stateWith({
      id: 'poly1', engineId: 'subtractive',
      inserts: [{ id: 'slot-a', pluginId: 'multifilter', params: {}, bypass: false }],
    } as unknown as Partial<SessionLane> & { id: string; engineId: string });
    const destinations = createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() });

    const setBase = vi.fn();
    const chain = { list: () => [{ id: 'slot-a', fx: { setBaseValue: setBase } }] };
    const laneResources = { get: (id: string) => (id === 'poly1' ? { inserts: chain } : undefined) } as unknown as LaneResourceMap;

    const facade = createLoomFacade(baseDeps({
      sessionHost: makeHostStub(state), laneResources, destinations,
    }));

    // multifilter's 'freq' param is min:20 max:20000 (multifilter.ts) — a real,
    // non-trivial range, so a passing assertion proves the fallback actually
    // scaled through the declared spec, not a stray 0/1 default.
    facade.setEngineParam('poly1', 'poly1.fx:slot-a.freq', 0.5);

    expect(setBase).toHaveBeenCalledWith('freq', 20 + 0.5 * (20000 - 20));
  });

  it('prefers a mounted knob over the raw fx write for an insert param (ring follows)', () => {
    const state = stateWith({
      id: 'poly1', engineId: 'subtractive',
      inserts: [{ id: 'slot-a', pluginId: 'multifilter', params: {}, bypass: false }],
    } as unknown as Partial<SessionLane> & { id: string; engineId: string });

    const setBase = vi.fn();
    const chain = { list: () => [{ id: 'slot-a', fx: { setBaseValue: setBase } }] };
    const laneResources = { get: (id: string) => (id === 'poly1' ? { inserts: chain } : undefined) } as unknown as LaneResourceMap;

    const knobSetValue = vi.fn();
    const knobRegistry = new Map<string, KnobHandle>([
      ['poly1.fx:slot-a.freq', { meta: { id: 'poly1.fx:slot-a.freq', label: 'Freq', min: 0, max: 100 }, setValue: knobSetValue } as unknown as KnobHandle],
    ]);
    // The destination registry consults the SAME live registry to resolve the
    // mounted knob's own range (as listAutomationTargets does in production).
    const destinations = createDestinationRegistry({ getState: () => state, getKnobRegistry: () => knobRegistry });

    const facade = createLoomFacade(baseDeps({
      sessionHost: makeHostStub(state), laneResources, knobRegistry, destinations,
    }));

    facade.setEngineParam('poly1', 'poly1.fx:slot-a.freq', 0.5);

    expect(knobSetValue).toHaveBeenCalledWith(50); // knob's own 0..100 range, not the plugin's 20..20000
    expect(setBase).not.toHaveBeenCalled();
  });

  it('still accepts a bare local engine id, including one with a dot in it (backwards compat)', () => {
    // Real engine param ids are almost all dotted ('filter.cutoff',
    // 'osc1.detune', ...). A naive canonical-id parse of a bare id like
    // 'filter.cutoff' would misread 'filter' as a lane id and 'cutoff' as the
    // param, failing the lookup — this is the trap this test exists to catch.
    const fakeSetBase = vi.fn();
    const fakeEngine = {
      params: [{ id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous', min: 0, max: 1, default: 0.5 }],
      setBaseValue: fakeSetBase,
    } as unknown as SynthEngine;
    const laneResources = { get: (id: string) => (id === 'poly1' ? { engine: fakeEngine } : undefined) } as unknown as LaneResourceMap;

    const facade = createLoomFacade(baseDeps({ laneResources }));

    facade.setEngineParam('poly1', 'filter.cutoff', 0.4);

    expect(fakeSetBase).toHaveBeenCalledWith('filter.cutoff', 0.4); // min 0, max 1 -> real === value01
  });

  it('engineParamIds returns the same first-8 params, in the same order, as the old bare-id code for a lane with >=8 continuous params', () => {
    const state = stateWith({ id: 'poly1', engineId: 'subtractive' });
    const destinations = createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() });
    const facade = createLoomFacade(baseDeps({ sessionHost: makeHostStub(state), destinations }));

    const engine = getEngine('subtractive')!;
    const oldStyle = engine.params.filter((p) => p.kind === 'continuous').slice(0, 8).map((p) => p.id);
    expect(oldStyle.length).toBe(8); // sanity: subtractive really has >=8 continuous params

    const ids = facade.engineParamIds('poly1');

    expect(ids).toHaveLength(8);
    // Canonical now (laneId-prefixed), but stripping the prefix recovers
    // exactly the old bare-id list, in the same positional order — so the
    // device bank's index -> param mapping is unchanged for this lane.
    expect(ids.map((id) => id.replace(/^poly1\./, ''))).toEqual(oldStyle);
  });

  it('engineParamIds never includes master/send-rack destinations, only this lane’s own', () => {
    const state = {
      lanes: [{ id: 'poly1', name: 'poly1', engineId: 'subtractive', clips: [], inserts: [] }],
      masterInserts: [{ id: 'slot-m', pluginId: 'multifilter', params: {}, bypass: false }],
      sends: [{ id: 'A', label: 'Send A', inserts: [{ id: 'slot-s', pluginId: 'multifilter', params: {}, bypass: false }] }],
    } as unknown as SessionState;
    const destinations = createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() });
    const facade = createLoomFacade(baseDeps({ sessionHost: makeHostStub(state), destinations }));

    const ids = facade.engineParamIds('poly1');

    expect(ids.length).toBeGreaterThan(0); // not a vacuous pass on an empty list
    expect(ids.every((id) => id.startsWith('poly1.'))).toBe(true);
    expect(ids.some((id) => id.includes('fx.master') || id.includes('fx.send'))).toBe(false);
  });
});
