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

  it('all params are continuous', () => {
    for (const spec of engine.params) {
      expect(spec.kind).toBe('continuous');
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
