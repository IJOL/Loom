import { describe, it, expect } from 'vitest';
import { TB303Engine } from './tb303';
import { validateSpec } from './engine-params';

describe('TB303Engine.params', () => {
  const engine = new TB303Engine();

  it('every spec validates', () => {
    for (const spec of engine.params) {
      expect(() => validateSpec(spec)).not.toThrow();
    }
  });

  it('has 6 declared params', () => {
    expect(engine.params).toHaveLength(6);
  });

  it('has continuous filter.cutoff', () => {
    const cutoff = engine.params.find(p => p.id === 'filter.cutoff');
    expect(cutoff?.kind).toBe('continuous');
    expect(cutoff?.min).toBe(0);
    expect(cutoff?.max).toBe(1);
  });

  it('has discrete osc.wave with saw + sqr options', () => {
    const wave = engine.params.find(p => p.id === 'osc.wave');
    expect(wave?.kind).toBe('discrete');
    expect(wave?.options).toHaveLength(2);
    expect(wave?.options?.map(o => o.value)).toEqual(['sawtooth', 'square']);
  });
});

describe('TB303Engine getBaseValue/setBaseValue (no instance) returns defaults', () => {
  const engine = new TB303Engine();

  it('returns the default value when no instance is configured', () => {
    expect(engine.getBaseValue('filter.cutoff')).toBe(0.42);
    expect(engine.getBaseValue('filter.resonance')).toBe(0.55);
    expect(engine.getBaseValue('env.amount')).toBe(0.5);
    expect(engine.getBaseValue('env.decay')).toBe(0.4);
    expect(engine.getBaseValue('env.accent')).toBe(0.6);
    expect(engine.getBaseValue('osc.wave')).toBe(0);
  });

  it('unknown id returns 0', () => {
    expect(engine.getBaseValue('not.a.real.param')).toBe(0);
  });

  it('setBaseValue without instance is a no-op (no throw)', () => {
    expect(() => engine.setBaseValue('filter.cutoff', 0.7)).not.toThrow();
  });
});

describe('TB303Engine getBaseValue/setBaseValue (with instance) round-trip', () => {
  // We can't create a real TB303 (needs AudioContext). Instead simulate by
  // assigning a minimal stub to lastInstance via a public registerInstance.
  // TB303Engine has registerInstance(output, instance) but it requires both
  // an AudioNode and a TB303. We mock both as the simplest object shape that
  // exposes a `params` record.
  it('writes and reads back the same value through .params on the instance', () => {
    const engine = new TB303Engine();
    const fakeOutput = {} as AudioNode;
    const fakeTb = { params: { cutoff: 0, resonance: 0, envMod: 0, decay: 0, accent: 0, wave: 'sawtooth' } } as unknown as import('../core/synth').TB303;
    engine.registerInstance(fakeOutput, fakeTb);
    engine.setBaseValue('filter.cutoff', 0.7);
    expect(engine.getBaseValue('filter.cutoff')).toBe(0.7);
    engine.setBaseValue('env.accent', 0.85);
    expect(engine.getBaseValue('env.accent')).toBe(0.85);
  });

  it('osc.wave is discrete: setBaseValue 0.7 → square, 0.2 → sawtooth', () => {
    const engine = new TB303Engine();
    const fakeOutput = {} as AudioNode;
    const fakeTb = { params: { cutoff: 0, resonance: 0, envMod: 0, decay: 0, accent: 0, wave: 'sawtooth' } } as unknown as import('../core/synth').TB303;
    engine.registerInstance(fakeOutput, fakeTb);
    engine.setBaseValue('osc.wave', 0.7);
    expect(engine.getBaseValue('osc.wave')).toBe(1);
    engine.setBaseValue('osc.wave', 0.2);
    expect(engine.getBaseValue('osc.wave')).toBe(0);
  });
});

describe('TB303Engine.getSharedAudioParams', () => {
  it('returns the underlying TB303 filter+amp AudioParams after createVoice', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    engine.createVoice(ctx, ctx.destination);
    const shared = engine.getSharedAudioParams?.() ?? new Map();
    expect(shared.has('filter.cutoff')).toBe(true);
    expect(shared.has('filter.resonance')).toBe(true);
    expect(shared.has('amp.gain')).toBe(true);
  });

  it('returns an empty Map before any createVoice call', () => {
    const engine = new TB303Engine();
    const shared = engine.getSharedAudioParams?.() ?? new Map();
    expect(shared.size).toBe(0);
  });
});
