import { describe, it, expect } from 'vitest';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey } from './sampler-pad-params';
import { validateSpec } from './engine-params';

describe('sampler pad params', () => {
  it('defaults cover every leaf', () => {
    const leaves = PAD_LEAF_SPECS.map((s) => s.leaf);
    for (const l of leaves) expect(PAD_DEFAULTS).toHaveProperty(l);
    expect(leaves).toContain('loop');
    expect(leaves).toContain('retrig');
  });

  it('every leaf spec validates as an EngineParamSpec when prefixed', () => {
    for (const s of PAD_LEAF_SPECS) {
      const { leaf, ...rest } = s;
      expect(() => validateSpec({ ...rest, id: `kick.${leaf}` })).not.toThrow();
    }
  });

  it('padKeyForNote maps GM drum notes to voice names, else zone<note>', () => {
    expect(padKeyForNote(36)).toBe('kick');
    expect(padKeyForNote(38)).toBe('snare');
    expect(padKeyForNote(60)).toBe('zone60');
  });

  it('noteForPadKey is the inverse for voice names and zones', () => {
    expect(noteForPadKey('kick')).toBe(36);
    expect(noteForPadKey('snare')).toBe(38);
    expect(noteForPadKey('zone60')).toBe(60);
  });
});
