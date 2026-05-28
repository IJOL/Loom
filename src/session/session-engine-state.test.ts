import { describe, it, expect } from 'vitest';
import { emptySessionState } from './session';
import { mirrorParamChange, syncModulators } from './session-engine-state';

describe('per-lane engineState persistence', () => {
  it('mirrorParamChange writes to lane.engineState.params', () => {
    const state = emptySessionState();
    mirrorParamChange(state, 'subtractive-1', 'filter.cutoff', 0.42);
    const lane = state.lanes.find((l) => l.id === 'subtractive-1')!;
    expect(lane.engineState?.params?.['filter.cutoff']).toBe(0.42);
  });

  it('mirrorParamChange does not affect other lanes', () => {
    const state = emptySessionState();
    mirrorParamChange(state, 'subtractive-1', 'filter.cutoff', 0.42);
    const otherLane = state.lanes.find((l) => l.id === 'tb-303-1')!;
    expect(otherLane.engineState?.params?.['filter.cutoff']).toBeUndefined();
  });

  it('mirrorParamChange overwrites existing param value', () => {
    const state = emptySessionState();
    mirrorParamChange(state, 'subtractive-1', 'filter.cutoff', 0.42);
    mirrorParamChange(state, 'subtractive-1', 'filter.cutoff', 0.85);
    const lane = state.lanes.find((l) => l.id === 'subtractive-1')!;
    expect(lane.engineState?.params?.['filter.cutoff']).toBe(0.85);
  });

  it('mirrorParamChange noop on unknown laneId', () => {
    const state = emptySessionState();
    mirrorParamChange(state, 'does-not-exist', 'filter.cutoff', 0.42);
    // No exception; no mutation of existing lanes.
    expect(state.lanes.every((l) => !l.engineState?.params?.['filter.cutoff'])).toBe(true);
  });

  it('syncModulators writes the modulator array into lane.engineState.modulators', () => {
    const state = emptySessionState();
    const mods = [
      { id: 'lfo1', kind: 'lfo' as const, enabled: true, connections: [] },
      { id: 'adsr1', kind: 'adsr' as const, enabled: true, connections: [], attackSec: 0.05 },
    ];
    syncModulators(state, 'subtractive-1', mods as unknown as import('../modulation/types').ModulatorState[]);
    const lane = state.lanes.find((l) => l.id === 'subtractive-1')!;
    expect(lane.engineState?.modulators).toHaveLength(2);
    expect(lane.engineState?.modulators?.[0].id).toBe('lfo1');
    expect(lane.engineState?.modulators?.[1].id).toBe('adsr1');
  });

  it('syncModulators deep-copies the array so later mutations on the source do not leak', () => {
    const state = emptySessionState();
    const mods = [{ id: 'lfo1', kind: 'lfo' as const, enabled: true, connections: [] }];
    syncModulators(state, 'subtractive-1', mods as unknown as import('../modulation/types').ModulatorState[]);
    // Mutate the source
    (mods[0] as { enabled: boolean }).enabled = false;
    const lane = state.lanes.find((l) => l.id === 'subtractive-1')!;
    // Stored copy should still reflect the value at sync time.
    expect(lane.engineState?.modulators?.[0].enabled).toBe(true);
  });

  it('syncModulators is a no-op for unknown laneId', () => {
    const state = emptySessionState();
    syncModulators(state, 'does-not-exist', []);
    // No exception, no lane mutated.
    expect(state.lanes.every((l) => !l.engineState?.modulators)).toBe(true);
  });
});
