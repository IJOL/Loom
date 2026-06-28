import { describe, it, expect } from 'vitest';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey, nextFreePadNote } from './sampler-pad-params';
import { validateSpec } from './engine-params';

describe('sampler pad params', () => {
  it('defaults cover every leaf', () => {
    const leaves = PAD_LEAF_SPECS.map((s) => s.leaf);
    for (const l of leaves) expect(PAD_DEFAULTS).toHaveProperty(l);
    expect(leaves).toContain('loop');
    expect(leaves).toContain('retrig');
    expect(leaves).toContain('chokeGroup');
    expect(PAD_DEFAULTS.chokeGroup).toBe(0); // no choke until set (GM hats defaulted at the engine)
  });

  it('every leaf spec validates as an EngineParamSpec when prefixed', () => {
    for (const s of PAD_LEAF_SPECS) {
      const { leaf, ...rest } = s;
      expect(() => validateSpec({ ...rest, id: `kick.${leaf}` })).not.toThrow();
    }
  });

  it('padKeyForNote is a unique per-note key (zone<note>), never a GM voice name', () => {
    // GM voice names are NOT the identity — that merged distinct notes (loop slices,
    // tom 41/43/45/47/48) into one pad. Every note gets its own key.
    expect(padKeyForNote(36)).toBe('zone36');
    expect(padKeyForNote(38)).toBe('zone38');
    expect(padKeyForNote(45)).toBe('zone45');
    expect(padKeyForNote(47)).toBe('zone47'); // 45 + 47 are both GM "tom" — still distinct
    expect(padKeyForNote(60)).toBe('zone60');
  });

  it('noteForPadKey is the inverse', () => {
    expect(noteForPadKey('zone36')).toBe(36);
    expect(noteForPadKey('zone45')).toBe(45);
    expect(noteForPadKey('zone60')).toBe(60);
  });

  it('has trim + loop-end leaves with sound-preserving defaults', () => {
    expect(PAD_DEFAULTS.sampleStart).toBe(0);
    expect(PAD_DEFAULTS.sampleEnd).toBe(1);
    expect(PAD_DEFAULTS.loopEnd).toBe(1);
    const leaves = PAD_LEAF_SPECS.map((s) => s.leaf);
    expect(leaves).toContain('sampleStart');
    expect(leaves).toContain('sampleEnd');
    expect(leaves).toContain('loopEnd');
  });
});

describe('nextFreePadNote (variable-size kit growth)', () => {
  // TR-808 GM kit notes: kick, snare, closedHat, openHat, clap, cowbell, tom, ride.
  const TR808 = [36, 38, 42, 46, 39, 56, 45, 51];

  it('starts at 36 for an empty kit', () => {
    expect(nextFreePadNote([])).toBe(36);
  });

  it('returns the next note above the max (no GM-alias skipping any more)', () => {
    expect(nextFreePadNote(TR808)).toBe(57);
    expect(nextFreePadNote([...TR808, 57, 58])).toBe(59); // 59 was skipped before (GM ride)
  });

  it('every grown pad keeps a distinct note + key', () => {
    const notes = [...TR808];
    for (let i = 0; i < 6; i++) notes.push(nextFreePadNote(notes));
    expect(new Set(notes).size).toBe(notes.length);
    expect(new Set(notes.map(padKeyForNote)).size).toBe(notes.length);
  });
});
