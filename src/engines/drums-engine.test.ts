import { describe, it, expect } from 'vitest';
import { DrumsEngine } from './drums-engine';
import { validateSpec } from './engine-params';

describe('DrumsEngine.params', () => {
  const engine = new DrumsEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('has master + per-voice specs', () => {
    const ids = engine.params.map(p => p.id);
    expect(ids).toContain('master.level');
    expect(ids).toContain('master.tune');
    expect(ids).toContain('kick.level');
    expect(ids).toContain('snare.level');
    expect(ids).toContain('closedHat.level');
    expect(ids).toContain('openHat.level');
  });

  it('all params are continuous', () => {
    for (const spec of engine.params) {
      expect(spec.kind).toBe('continuous');
    }
  });
});

describe('DrumsEngine getBaseValue (no instance) returns defaults', () => {
  const engine = new DrumsEngine();

  it('returns default for kick.level', () => {
    expect(engine.getBaseValue('kick.level')).toBe(1);
  });

  it('returns 0 for unknown id', () => {
    expect(engine.getBaseValue('not.real')).toBe(0);
  });

  it('setBaseValue without instance is a no-op (no throw)', () => {
    expect(() => engine.setBaseValue('kick.level', 0.8)).not.toThrow();
  });
});
