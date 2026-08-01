import { describe, it, expect } from 'vitest';
import { createDescriptorEngine } from './descriptor-engine';
import type { EngineParamSpec } from './engine-params';
import type { SessionLane } from '../session/session';

const dyn: EngineParamSpec[] = [
  { id: 'zone60.tune', label: 'TUNE', kind: 'continuous', min: -24, max: 24, default: 0 },
];

describe('createDescriptorEngine hook passthrough', () => {
  it('forwards subGroupFor and dynamicParamsFor to the built descriptor', () => {
    const eng = createDescriptorEngine({
      id: 'x', name: 'X', polyphony: 'poly', params: [], presets: () => [],
      subGroupFor: (id) => (id.startsWith('zone') ? { key: 'zone60', label: 'C4' } : undefined),
      dynamicParamsFor: () => dyn,
    });
    expect(eng.subGroupFor?.('zone60.tune')).toEqual({ key: 'zone60', label: 'C4' });
    expect(eng.subGroupFor?.('gain')).toBeUndefined();
    expect(eng.dynamicParamsFor?.({} as SessionLane)).toBe(dyn);
  });

  it('leaves both hooks undefined when config omits them', () => {
    const eng = createDescriptorEngine({ id: 'y', name: 'Y', polyphony: 'poly', params: [], presets: () => [] });
    expect(eng.subGroupFor).toBeUndefined();
    expect(eng.dynamicParamsFor).toBeUndefined();
  });

  it('carries the declared groups through to the engine', () => {
    const e = createDescriptorEngine({
      id: 'x', name: 'X', polyphony: 'poly',
      params: [{ id: 'osc1.level', label: 'L', kind: 'continuous', min: 0, max: 1, default: 0.5, group: 'osc1' }],
      groups: [{ id: 'osc1', title: 'OSC 1', row: 0, color: '#2ee0c0' }],
      presets: () => [],
    });
    expect(e.groups).toEqual([{ id: 'osc1', title: 'OSC 1', row: 0, color: '#2ee0c0' }]);
  });

  it('has no groups when none are declared', () => {
    const e = createDescriptorEngine({ id: 'y', name: 'Y', polyphony: 'poly', params: [], presets: () => [] });
    expect(e.groups).toBeUndefined();
  });
});
