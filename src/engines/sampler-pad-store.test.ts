import { describe, it, expect } from 'vitest';
import { SamplerEngine } from './sampler';
import type { KeymapEntry } from '../samples/types';

function kit(): KeymapEntry[] {
  return [
    { sampleId: 'a', rootNote: 36, loNote: 36, hiNote: 36 }, // kick
    { sampleId: 'b', rootNote: 38, loNote: 38, hiNote: 38 }, // snare
  ];
}

describe('SamplerEngine per-pad params', () => {
  it('params reflect the keymap as <padKey>.<leaf> ids', () => {
    const e = new SamplerEngine();
    e.setKeymap(kit());
    const ids = e.params.map((p) => p.id);
    // Pad keys are note-based (zone<note>), not GM voice names.
    expect(ids).toContain('zone36.tune');
    expect(ids).toContain('zone36.decay');
    expect(ids).toContain('zone36.loop');
    expect(ids).toContain('zone38.cutoff');
    // global params still present
    expect(ids).toContain('gain');
    expect(ids).toContain('poly.voices');
  });

  it('set/getBaseValue round-trip a per-pad value (keyed by note)', () => {
    const e = new SamplerEngine();
    e.setKeymap(kit());
    e.setBaseValue('zone36.tune', 7);
    expect(e.getBaseValue('zone36.tune')).toBe(7);
    expect(e.getPad(36).tune).toBe(7);          // stored by note
    expect(e.getBaseValue('zone38.tune')).toBe(0); // untouched default
  });

  it('an untouched per-pad param returns the default', () => {
    const e = new SamplerEngine();
    e.setKeymap(kit());
    expect(e.getBaseValue('zone36.cutoff')).toBe(1);
    expect(e.getBaseValue('zone38.decay')).toBe(0.08);
  });
});
