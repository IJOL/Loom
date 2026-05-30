import { describe, it, expect } from 'vitest';
import { KarplusEngine } from './karplus';
import { validateSpec } from './engine-params';

describe('KarplusEngine.params', () => {
  const engine = new KarplusEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('uses unified dot-namespaced vocabulary (no ks- prefix)', () => {
    for (const spec of engine.params) {
      expect(spec.id.startsWith('ks-')).toBe(false);
      expect(spec.id).toContain('.');
    }
  });

  it('all params except discrete toggles are continuous', () => {
    const discreteIds = ['amp.builtinEnv'];
    for (const spec of engine.params) {
      if (!discreteIds.includes(spec.id)) {
        expect(spec.kind).toBe('continuous');
      }
    }
  });
});

describe('KarplusEngine getBaseValue/setBaseValue', () => {
  it('returns defaults', () => {
    const engine = new KarplusEngine();
    const ampLevel = engine.params.find(p => p.id === 'amp.level');
    if (ampLevel) {
      expect(engine.getBaseValue('amp.level')).toBe(ampLevel.default);
    }
  });

  it('round-trips setBaseValue → getBaseValue', () => {
    const engine = new KarplusEngine();
    engine.setBaseValue('string.damping', 0.8);
    expect(engine.getBaseValue('string.damping')).toBe(0.8);
  });

  it('unknown id returns 0', () => {
    const engine = new KarplusEngine();
    expect(engine.getBaseValue('not.real')).toBe(0);
  });
});

describe('KarplusEngine built-in amp env toggle', () => {
  it('exposes amp.builtinEnv discrete param defaulting On', () => {
    const engine = new KarplusEngine();
    const amp = engine.params.find(p => p.id === 'amp.builtinEnv');
    expect(amp?.kind).toBe('discrete');
    expect(amp?.options).toHaveLength(2);
    expect(amp?.default).toBe(1);
  });

  it('round-trips through get/setBaseValue', () => {
    const engine = new KarplusEngine();
    engine.setBaseValue('amp.builtinEnv', 0);
    expect(engine.getBaseValue('amp.builtinEnv')).toBe(0);
    engine.setBaseValue('amp.builtinEnv', 1);
    expect(engine.getBaseValue('amp.builtinEnv')).toBe(1);
  });
});
