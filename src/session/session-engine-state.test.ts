import { describe, it, expect } from 'vitest';
import { emptySessionState } from './session';
import { mirrorParamChange, syncModulators, mirrorKeymapChange, readLaneKeymap } from './session-engine-state';
import type { KeymapEntry } from '../samples/types';
import { syncNoteFx } from './session-engine-state';
import type { NoteFxState } from '../notefx/notefx-types';

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

  it('mirrorKeymapChange writes the keymap onto lane.engineState.sampler.keymap', () => {
    const state = emptySessionState();
    const km: KeymapEntry[] = [{ sampleId: 'a', rootNote: 60, loNote: 0, hiNote: 127 }];
    mirrorKeymapChange(state, 'subtractive-1', km);
    const lane = state.lanes.find((l) => l.id === 'subtractive-1')!;
    expect(lane.engineState?.sampler?.keymap).toEqual(km);
  });

  it('readLaneKeymap round-trips and returns [] when absent', () => {
    const state = emptySessionState();
    expect(readLaneKeymap(state, 'subtractive-1')).toEqual([]);
    const km: KeymapEntry[] = [{ sampleId: 'b', rootNote: 48, loNote: 0, hiNote: 127 }];
    mirrorKeymapChange(state, 'subtractive-1', km);
    expect(readLaneKeymap(state, 'subtractive-1')).toEqual(km);
  });

  it('mirrorKeymapChange is a no-op for unknown laneId', () => {
    const state = emptySessionState();
    mirrorKeymapChange(state, 'does-not-exist', [{ sampleId: 'x', rootNote: 60, loNote: 0, hiNote: 127 }]);
    expect(state.lanes.every((l) => !l.engineState?.sampler)).toBe(true);
  });
});

describe('syncNoteFx', () => {
  it('writes a deep-cloned note-FX array into lane.engineState.noteFx', () => {
    const state = { lanes: [{ id: 'sub-1', engineId: 'subtractive', clips: [] }], scenes: [], globalQuantize: '1/1' } as any;
    const fx: NoteFxState[] = [{ id: 'arp1', kind: 'arp', enabled: true, params: { octaves: 2 } }];
    syncNoteFx(state, 'sub-1', fx);
    expect(state.lanes[0].engineState.noteFx).toEqual(fx);
    // deep clone — mutating source does not leak
    fx[0].params.octaves = 4;
    expect(state.lanes[0].engineState.noteFx[0].params.octaves).toBe(2);
  });

  it('is a no-op for an unknown lane', () => {
    const state = { lanes: [], scenes: [], globalQuantize: '1/1' } as any;
    expect(() => syncNoteFx(state, 'nope', [])).not.toThrow();
  });
});
