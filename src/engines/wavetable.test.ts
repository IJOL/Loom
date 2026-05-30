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

  it('has 12 declared params (10 sound + poly.voices + amp.builtinEnv)', () => {
    expect(engine.params).toHaveLength(12);
  });

  it('wave selectors and amp.builtinEnv are discrete; the rest are continuous', () => {
    const discreteIds = new Set(['osc.waveA', 'osc.waveB', 'amp.builtinEnv']);
    for (const spec of engine.params) {
      if (discreteIds.has(spec.id)) {
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

describe('WavetableEngine built-in amp env toggle', () => {
  it('exposes amp.builtinEnv discrete param defaulting On', () => {
    const engine = new WavetableEngine();
    const amp = engine.params.find(p => p.id === 'amp.builtinEnv');
    expect(amp?.kind).toBe('discrete');
    expect(amp?.options).toHaveLength(2);
    // On: the built-in env is the only amp.gain driver in a lane (adsr1 routes
    // to cutoff), so Off would silence lane patches — On preserves the sound.
    expect(amp?.default).toBe(1);
  });

  it('round-trips through get/setBaseValue', () => {
    const engine = new WavetableEngine();
    expect(engine.getBaseValue('amp.builtinEnv')).toBe(1);  // default On
    engine.setBaseValue('amp.builtinEnv', 0);
    expect(engine.getBaseValue('amp.builtinEnv')).toBe(0);
    engine.setBaseValue('amp.builtinEnv', 1);
    expect(engine.getBaseValue('amp.builtinEnv')).toBe(1);
  });
});
