import { describe, it, expect, vi } from 'vitest';
import { randomizeLaneSound, type RandomizeDeps } from './randomize-ui';
import type { SynthEngine } from '../engines/engine-types';

// A lane engine that rolls two params. Only the members randomizeLaneSound
// touches are real; the rest of SynthEngine is irrelevant here.
function fakeEngine(): { engine: SynthEngine; didRoll: () => boolean } {
  const state: Record<string, number> = { 'filter.cutoff': 1000, 'osc.level': 0.5 };
  let rolled = false;
  const engine = {
    id: 'fm',
    params: [
      { id: 'filter.cutoff', label: 'CUTOFF', min: 20, max: 8000, default: 1000 },
      { id: 'osc.level',     label: 'LEVEL',  min: 0,  max: 1,    default: 0.5 },
    ],
    getBaseValue: (id: string) => state[id],
    setBaseValue: (id: string, v: number) => { state[id] = v; },
    randomize: () => { rolled = true; state['filter.cutoff'] = 4321; state['osc.level'] = 0.9; },
  } as unknown as SynthEngine;
  return { engine, didRoll: () => rolled };
}

function makeDeps(engine: SynthEngine | null) {
  const refreshLaneKnobs = vi.fn();
  const deps: RandomizeDeps = {
    getEngine: () => engine,
    getLaneEngineId: () => 'fm',
    getActiveLaneId: () => 'fm-1',
    getSessionState: () => undefined,
    refreshLaneKnobs,
    // withUndo is a pass-through today (save/history-wiring.ts): the real undo
    // comes from AutoHistory's own checkpoint. Nothing to assert about it here.
    historyDeps: {} as RandomizeDeps['historyDeps'],
  };
  return { deps, refreshLaneKnobs };
}

describe('randomizeLaneSound', () => {
  it("user: rolls the engine and repaints that lane's knobs IN PLACE", () => {
    const { engine, didRoll } = fakeEngine();
    const { deps, refreshLaneKnobs } = makeDeps(engine);

    randomizeLaneSound(deps, 'fm-1');

    expect(didRoll()).toBe(true);
    // The in-place repaint is the whole fix. The dice must never reach
    // rebuildEngineParamUI, which unregisters the lane's knobs — and a knob
    // outside the automation registry never gets its modulation ring painted
    // again (automation-tick walks the registry every frame).
    expect(refreshLaneKnobs).toHaveBeenCalledWith('fm-1', engine);
  });

  it('user: the knob handles show the value the engine just rolled', () => {
    const { engine } = fakeEngine();
    const seen: Array<[string, number]> = [];
    const { deps } = makeDeps(engine);
    deps.refreshLaneKnobs = (laneId, eng) => {
      for (const spec of eng.params) seen.push([`${laneId}.${spec.id}`, eng.getBaseValue(spec.id)]);
    };

    randomizeLaneSound(deps, 'fm-1');

    expect(seen).toEqual([['fm-1.filter.cutoff', 4321], ['fm-1.osc.level', 0.9]]);
  });

  it('user: an engine that cannot roll is left alone', () => {
    const { deps, refreshLaneKnobs } = makeDeps(null);
    randomizeLaneSound(deps, 'sampler-1');
    expect(refreshLaneKnobs).not.toHaveBeenCalled();
  });
});
