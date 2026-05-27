import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from './subtractive';
import { validateSpec } from './engine-params';

describe('SubtractiveEngine.params', () => {
  const engine = new SubtractiveEngine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('has at least 20 params (full polysynth surface)', () => {
    expect(engine.params.length).toBeGreaterThanOrEqual(20);
  });

  it('osc1.wave and osc2.wave are discrete with 4 options', () => {
    const osc1 = engine.params.find(p => p.id === 'osc1.wave');
    const osc2 = engine.params.find(p => p.id === 'osc2.wave');
    expect(osc1?.kind).toBe('discrete');
    expect(osc1?.options).toHaveLength(4);
    expect(osc2?.kind).toBe('discrete');
    expect(osc2?.options).toHaveLength(4);
  });

  it('filter and amp envelope params present', () => {
    const ids = engine.params.map(p => p.id);
    expect(ids).toContain('filter.cutoff');
    expect(ids).toContain('filter.resonance');
    expect(ids).toContain('amp.attack');
    expect(ids).toContain('amp.release');
  });
});

describe('SubtractiveEngine getBaseValue/setBaseValue', () => {
  it('returns defaults when no polysynth set', () => {
    const engine = new SubtractiveEngine();
    // setPolySynth has not been called yet — getBaseValue falls back to spec default.
    const cutoffSpec = engine.params.find(p => p.id === 'filter.cutoff');
    expect(engine.getBaseValue('filter.cutoff')).toBe(cutoffSpec?.default ?? 0);
  });

  it('unknown id with no polysynth returns 0', () => {
    const engine = new SubtractiveEngine();
    expect(engine.getBaseValue('not.real')).toBe(0);
  });
});
