import { describe, it, expect } from 'vitest';
import { SamplerEngine } from './sampler';
import { createEngineInstance } from './registry';
import type { KeymapEntry } from '../samples/types';

describe('SamplerEngine — metadata', () => {
  it('declares global params only with an empty keymap; expands per-pad with a keymap', () => {
    const e = new SamplerEngine();
    expect(e.id).toBe('sampler');
    expect(e.type).toBe('polyhost');
    expect(e.polyphony).toBe('poly');
    // Empty keymap → only global params
    const emptyIds = e.params.map((p) => p.id);
    expect(emptyIds).toContain('gain');
    expect(emptyIds).toContain('poly.voices');
    expect(emptyIds).not.toContain('amp.attack');
    expect(emptyIds).not.toContain('amp.release');
    expect(emptyIds).not.toContain('pitch');
    expect(emptyIds).not.toContain('filter.cutoff');
    expect(emptyIds).not.toContain('filter.resonance');
    expect(emptyIds).toEqual(['gain', 'poly.voices']);
    // With a keymap → per-pad ids appear
    const kit: KeymapEntry[] = [
      { sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 },
    ];
    e.setKeymap(kit);
    const kitIds = e.params.map((p) => p.id);
    expect(kitIds).toContain('kick.cutoff');
    expect(kitIds).toContain('kick.tune');
    expect(kitIds).toContain('kick.decay');
  });

  it('per-pad cutoff defaults to fully open (1)', () => {
    const e = new SamplerEngine();
    const kit: KeymapEntry[] = [
      { sampleId: 'k', rootNote: 60, loNote: 60, hiNote: 60 },
    ];
    e.setKeymap(kit);
    expect(e.getBaseValue('zone60.cutoff')).toBe(1);
  });

  it('get/setBaseValue round-trips a per-pad param', () => {
    const e = new SamplerEngine();
    const kit: KeymapEntry[] = [
      { sampleId: 'k', rootNote: 60, loNote: 60, hiNote: 60 },
    ];
    e.setKeymap(kit);
    e.setBaseValue('zone60.attack', 0.25);
    expect(e.getBaseValue('zone60.attack')).toBe(0.25);
  });

  it('is registered as a factory engine', () => {
    const inst = createEngineInstance('sampler');
    expect(inst?.id).toBe('sampler');
  });
});
