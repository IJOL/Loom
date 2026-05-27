import { describe, it, expect } from 'vitest';
import { isContinuous, isDiscrete, validateSpec, type EngineParamSpec } from './engine-params';

describe('EngineParamSpec validators', () => {
  it('isContinuous returns true for continuous specs', () => {
    const s: EngineParamSpec = { id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous', min: 0, max: 1, default: 0.5 };
    expect(isContinuous(s)).toBe(true);
    expect(isDiscrete(s)).toBe(false);
  });

  it('isDiscrete returns true for discrete specs with options', () => {
    const s: EngineParamSpec = {
      id: 'osc.wave', label: 'Wave', kind: 'discrete',
      min: 0, max: 1, default: 0,
      options: [{ value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Sqr' }],
    };
    expect(isDiscrete(s)).toBe(true);
    expect(isContinuous(s)).toBe(false);
  });

  it('validateSpec rejects continuous specs missing min/max ordering', () => {
    const bad: EngineParamSpec = { id: 'x', label: 'X', kind: 'continuous', min: 1, max: 0, default: 0 };
    expect(() => validateSpec(bad)).toThrow();
  });

  it('validateSpec rejects discrete specs without options', () => {
    const bad = { id: 'x', label: 'X', kind: 'discrete', min: 0, max: 0, default: 0 } as EngineParamSpec;
    expect(() => validateSpec(bad)).toThrow();
  });

  it('validateSpec accepts a well-formed continuous spec', () => {
    expect(() => validateSpec({ id: 'a.b', label: 'AB', kind: 'continuous', min: 0, max: 1, default: 0.5 })).not.toThrow();
  });
});
