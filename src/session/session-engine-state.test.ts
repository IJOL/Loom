import { describe, it, expect } from 'vitest';
import { emptySessionState } from './session';
import { mirrorParamChange } from './session-engine-state';

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
});
