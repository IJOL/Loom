import { describe, it, expect } from 'vitest';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey, nextFreePadNote } from './sampler-pad-params';
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

describe('nextFreePadNote (variable-size kit growth)', () => {
  // TR-808 GM kit notes: kick, snare, closedHat, openHat, clap, cowbell, tom, ride.
  const TR808 = [36, 38, 42, 46, 39, 56, 45, 51];

  it('starts at 36 for an empty kit', () => {
    expect(nextFreePadNote([])).toBe(36);
  });

  it('returns the next note above the max when its pad key is unique', () => {
    expect(nextFreePadNote(TR808)).toBe(57); // 57 → zone57, unique
  });

  it('skips a GM-alias note whose pad key collides with an existing pad', () => {
    // 59 is a GM ride alias; the kit already has ride (51), so a pad on 59 would
    // collapse onto it — nextFreePadNote must skip 59 and pick 60.
    expect(padKeyForNote(59)).toBe('ride');
    expect(nextFreePadNote([...TR808, 57, 58])).toBe(60);
  });

  it('every grown pad keeps a distinct pad key (no silent param sharing)', () => {
    const notes = [...TR808];
    for (let i = 0; i < 6; i++) notes.push(nextFreePadNote(notes));
    const keys = notes.map(padKeyForNote);
    expect(new Set(keys).size).toBe(keys.length); // all distinct
  });
});
