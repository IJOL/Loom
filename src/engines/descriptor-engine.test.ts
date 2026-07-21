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
});
