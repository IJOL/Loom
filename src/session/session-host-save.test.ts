import { describe, it, expect } from 'vitest';
import { SessionHost } from './session-host';
import { mirrorParamChange } from './session-engine-state';
import { fakeDestinations } from './fake-destinations';

// Minimal DOM stub so any incidental document access is a no-op under node.
(globalThis as unknown as { document: unknown }).document ??= {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

/** Deps sufficient for getStateForSave(): a laneResources stub whose engine
 *  exposes a modulators host, so collectEngineState() enters its serialize
 *  branch (the branch that historically clobbered engineState.params). */
function makeDeps(): ConstructorParameters<typeof SessionHost>[0] {
  const engine = {
    id: 'subtractive',
    modulators: {
      serialize: () => [
        { id: 'lfo1', kind: 'lfo', enabled: true, connections: [] },
      ],
    },
  };
  const laneResources = {
    get: (id: string) => (id === 'subtractive-1' ? { engine } : undefined),
    ids: () => ['subtractive-1'],
    dispose: () => {},
  };
  return { laneResources, destinations: fakeDestinations() } as unknown as ConstructorParameters<typeof SessionHost>[0];
}

describe('SessionHost.getStateForSave — per-lane engine param persistence', () => {
  it('preserves engineState.params (does not clobber knob values on save)', () => {
    const host = new SessionHost(makeDeps());
    host.state.lanes = [{ inserts: [], id: 'subtractive-1', engineId: 'subtractive', clips: [] }];

    // User turned a knob → mirrored into engineState.params, exactly as
    // engine-ui.ts does live on every knob/select change.
    mirrorParamChange(host.state, 'subtractive-1', 'filter.cutoff', 0.42);

    const saved = host.getStateForSave();
    const lane = saved.lanes.find((l) => l.id === 'subtractive-1')!;

    expect(lane.engineState?.params?.['filter.cutoff']).toBe(0.42);
  });

  it('still refreshes modulators from the live engine alongside params', () => {
    const host = new SessionHost(makeDeps());
    host.state.lanes = [{ inserts: [], id: 'subtractive-1', engineId: 'subtractive', clips: [] }];
    mirrorParamChange(host.state, 'subtractive-1', 'filter.cutoff', 0.42);

    const saved = host.getStateForSave();
    const lane = saved.lanes.find((l) => l.id === 'subtractive-1')!;

    expect(lane.engineState?.params?.['filter.cutoff']).toBe(0.42);
    expect(lane.engineState?.modulators?.[0]?.id).toBe('lfo1');
  });
});
