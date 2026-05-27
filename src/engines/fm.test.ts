import { describe, it, expect } from 'vitest';
import { FMEngine } from './fm';
import { validateSpec } from './engine-params';

describe('FMEngine.params', () => {
  const engine = new FMEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('uses 1-indexed operator naming (op1, op2, ...)', () => {
    const opIds = engine.params.map(p => p.id).filter(id => id.startsWith('op'));
    expect(opIds.length).toBeGreaterThan(0);
    // No 0-indexed names like 'op0.level'
    expect(opIds.some(id => id.startsWith('op0'))).toBe(false);
    // op1 entries present
    expect(opIds.some(id => id.startsWith('op1.'))).toBe(true);
  });

  it('all params are continuous', () => {
    for (const spec of engine.params) {
      expect(spec.kind).toBe('continuous');
    }
  });
});

describe('FMEngine getBaseValue/setBaseValue', () => {
  it('returns defaults', () => {
    const engine = new FMEngine();
    const op1Level = engine.params.find(p => p.id === 'op1.level');
    expect(engine.getBaseValue('op1.level')).toBe(op1Level?.default ?? 0);
  });

  it('round-trips setBaseValue → getBaseValue', () => {
    const engine = new FMEngine();
    engine.setBaseValue('op1.ratio', 4);
    expect(engine.getBaseValue('op1.ratio')).toBe(4);
    engine.setBaseValue('amp.mix', 0.3);
    expect(engine.getBaseValue('amp.mix')).toBe(0.3);
  });

  it('unknown id returns 0', () => {
    const engine = new FMEngine();
    expect(engine.getBaseValue('not.real')).toBe(0);
  });
});
