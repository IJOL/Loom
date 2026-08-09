// The catalogue lists a connection's DEPTH as an automation destination, and it
// reads that list off `lane.engineState.modulators`. That field used to be
// written only by getStateForSave, so it was a snapshot of the last save: a
// routing added now was not automatable until you saved, and one removed stayed
// in every picker writing nowhere.
import { describe, it, expect, vi } from 'vitest';
import { sync, mirrorToSession, type ModulationUIDeps } from './mod-ui-shared';
import { ModulationHostImpl } from './modulation-host';
import type { SessionState } from '../session/session';

function harness() {
  const host = new ModulationHostImpl([
    { id: 'lfo1', kind: 'lfo', enabled: true, connections: [], params: {} } as never,
  ]);
  const sessionState = {
    lanes: [{ id: 'L1', name: 'L1', engineId: 'subtractive', clips: [], inserts: [] }],
  } as unknown as SessionState;
  const invalidate = vi.fn();
  const deps = {
    engineId: 'subtractive', laneId: 'L1', host,
    registry: new Map(), registerKnob: () => {},
    onChange: () => {}, onLiveEdit: vi.fn(),
    sessionState,
    destinations: { list: () => [], subscribe: () => () => {}, invalidate },
  } as unknown as ModulationUIDeps;
  return { deps, host, sessionState, invalidate };
}

describe('mirroring modulators onto the lane', () => {
  it('writes the live set onto the lane the moment it changes', () => {
    const h = harness();
    h.host.setConnection('lfo1', { id: 'c1', paramId: 'filter.cutoff', depth: 0.4 } as never);
    mirrorToSession(h.deps);
    const mods = (h.sessionState.lanes[0] as { engineState?: { modulators?: unknown[] } })
      .engineState?.modulators as { connections: { id: string }[] }[] | undefined;
    expect(mods?.[0].connections).toHaveLength(1);
    expect(mods?.[0].connections[0].id).toBe('c1');
  });

  it('tells the catalogue, because the SET of destinations just moved', () => {
    const h = harness();
    mirrorToSession(h.deps);
    expect(h.invalidate).toHaveBeenCalled();
  });

  it('is a COPY — editing the lane afterwards cannot reach the live host', () => {
    const h = harness();
    h.host.setConnection('lfo1', { id: 'c1', paramId: 'filter.cutoff', depth: 0.4 } as never);
    mirrorToSession(h.deps);
    const mods = (h.sessionState.lanes[0] as { engineState: { modulators: { connections: { depth: number }[] }[] } })
      .engineState.modulators;
    mods[0].connections[0].depth = 99;
    expect(h.host.modulators[0].connections[0].depth).toBe(0.4);
  });

  it('every control edit mirrors, because every control calls sync', () => {
    const h = harness();
    h.host.setConnection('lfo1', { id: 'c1', paramId: 'filter.cutoff', depth: 0.4 } as never);
    sync(h.deps);
    expect(h.deps.onLiveEdit).toHaveBeenCalled();
    expect(h.invalidate).toHaveBeenCalled();
  });

  it('says nothing about a lane the session does not have', () => {
    const h = harness();
    (h.deps as { laneId: string }).laneId = 'gone';
    expect(() => mirrorToSession(h.deps)).not.toThrow();
    expect(h.invalidate).not.toHaveBeenCalled();
  });
});
