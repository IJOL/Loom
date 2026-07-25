/** @vitest-environment jsdom */
// refreshLaneKnobs repaints every mounted knob from the engine's current value,
// and a knob handle's setValue fires the SAME onChange a user drag does. Since
// a knob edit now mirrors into `lane.engineState.params`, an unguarded refresh
// would let the load path destroy what it had just restored:
// applyLoadedSessionState applies each lane's preset (→ applyPresetForLane →
// refreshLaneKnobs) BEFORE replaying engineState.params. This pins that a
// refresh moves the display only.

import { describe, it, expect } from 'vitest';
import { createKnobMounter, type KnobMounterDeps } from './knob-mounting';
import { buildEngineParamGrid } from '../engines/engine-param-grid';
import type { EngineParamSpec } from '../engines/engine-params';
import type { EngineUIContext } from '../engines/engine-types';
import type { SynthEngine } from '../engines/engine-types';
import type { KnobHandle } from '../core/knob';
import type { SessionState } from '../session/session';

const CUTOFF: EngineParamSpec =
  { id: 'filter.cutoff', label: 'CUTOFF', kind: 'continuous', min: 0, max: 1, default: 0.5 };

function stubEngine(params: EngineParamSpec[]) {
  const state = new Map(params.map((p) => [p.id, p.default] as const));
  return {
    id: 'karplus', params,
    getBaseValue: (id: string) => state.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { state.set(id, v); },
  };
}

describe('refreshLaneKnobs', () => {
  it('repaints a knob without clobbering the value mirrored into engineState', () => {
    const laneId = 'karplus-1';
    const state = {
      lanes: [{ id: laneId, engineId: 'karplus', clips: [], inserts: [] }],
    } as unknown as SessionState;

    const registry = new Map<string, KnobHandle>();
    const ctx = {
      laneId,
      registerKnob: (k: KnobHandle) => { if (k.meta?.id) registry.set(k.meta.id, k); },
      registry,
      sessionState: state,
    } as unknown as EngineUIContext;

    const engine = stubEngine([CUTOFF]);
    buildEngineParamGrid(engine, ctx, document.createElement('div'));

    // The user turns the knob → mirrored.
    registry.get(`${laneId}.filter.cutoff`)!.setValue(CUTOFF.max);
    const afterEdit = state.lanes[0].engineState?.params?.['filter.cutoff'];
    expect(afterEdit, 'the knob edit never reached engineState.params').toBeDefined();

    // A preset recall moves the engine underneath and refreshes the display.
    engine.setBaseValue('filter.cutoff', CUTOFF.min);
    const mounter = createKnobMounter({
      registry,
      registerKnob: () => {},
      laneResources: { get: () => undefined },
      getSessionState: () => state,
      getLaneDisplayName: () => undefined,
      fmtPct: String, fmtDb: String,
    } as unknown as KnobMounterDeps);
    mounter.refreshLaneKnobs(laneId, engine as unknown as SynthEngine);

    expect(state.lanes[0].engineState?.params?.['filter.cutoff']).toBe(afterEdit);
  });
});
