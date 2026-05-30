import { describe, it, expect } from 'vitest';
import { SamplerEngine } from './sampler';
import { createEngineInstance } from './registry';

describe('SamplerEngine — metadata', () => {
  it('declares the expected identity + params', () => {
    const e = new SamplerEngine();
    expect(e.id).toBe('sampler');
    expect(e.type).toBe('polyhost');
    expect(e.polyphony).toBe('poly');
    const ids = e.params.map((p) => p.id);
    expect(ids).toEqual([
      'gain', 'amp.attack', 'amp.release', 'pitch',
      'filter.cutoff', 'filter.resonance', 'poly.voices',
    ]);
  });

  it('filter.cutoff defaults to fully open (1)', () => {
    expect(new SamplerEngine().getBaseValue('filter.cutoff')).toBe(1);
  });

  it('get/setBaseValue round-trips a param', () => {
    const e = new SamplerEngine();
    e.setBaseValue('amp.attack', 0.25);
    expect(e.getBaseValue('amp.attack')).toBe(0.25);
  });

  it('is registered as a factory engine', () => {
    const inst = createEngineInstance('sampler');
    expect(inst?.id).toBe('sampler');
  });
});
