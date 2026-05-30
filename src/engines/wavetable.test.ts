import { describe, it, expect } from 'vitest';
import { WavetableEngine } from './wavetable';
import { validateSpec } from './engine-params';

describe('WavetableEngine.params', () => {
  const engine = new WavetableEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('has 11 declared params (10 sound + poly.voices)', () => {
    expect(engine.params).toHaveLength(11);
  });

  it('wave selectors are discrete; the rest are continuous', () => {
    for (const spec of engine.params) {
      if (spec.id === 'osc.waveA' || spec.id === 'osc.waveB') {
        expect(spec.kind).toBe('discrete');
      } else {
        expect(spec.kind).toBe('continuous');
      }
    }
  });
});

describe('WavetableEngine getBaseValue/setBaseValue', () => {
  it('returns defaults before setBaseValue', () => {
    const engine = new WavetableEngine();
    expect(engine.getBaseValue('filter.cutoff')).toBe(0.55);
    expect(engine.getBaseValue('amp.attack')).toBe(0.01);
  });

  it('round-trips setBaseValue → getBaseValue', () => {
    const engine = new WavetableEngine();
    engine.setBaseValue('filter.cutoff', 0.8);
    expect(engine.getBaseValue('filter.cutoff')).toBe(0.8);
    engine.setBaseValue('amp.release', 1.5);
    expect(engine.getBaseValue('amp.release')).toBe(1.5);
  });

  it('unknown id returns 0', () => {
    const engine = new WavetableEngine();
    expect(engine.getBaseValue('not.a.real.param')).toBe(0);
  });
});
