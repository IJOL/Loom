import { describe, it, expect } from 'vitest';
import { WEAVE_MACROS, WEAVE_SCOPE, macroDestinationId, macroNeutral } from './weave-catalog';

describe('weave catalogue', () => {
  it('declares the four macros', () => {
    // Six, until Space and Motion were removed. What is left has a property the
    // six did not: every one of them changes the MUSIC — how many notes, how
    // hard, which scale, which shelf. The two that went were the only two that
    // wrote params instead, and they were reported as spent after one sweep.
    expect(WEAVE_MACROS.map((m) => m.id)).toEqual(
      ['density', 'energy', 'darkness', 'styleMix'],
    );
  });

  it('gives every macro a neutral inside 0..1', () => {
    for (const m of WEAVE_MACROS) {
      expect(m.neutral).toBeGreaterThanOrEqual(0);
      expect(m.neutral).toBeLessThanOrEqual(1);
    }
  });

  it('centres the bipolar macros and floors the additive one', () => {
    // Density, energy and darkness cut as well as add, so their neutral is the
    // middle. Style mix only ever adds, so its neutral is zero — and zero is
    // what "the scene sounds untouched" means for it.
    expect(macroNeutral('density')).toBeCloseTo(0.5);
    expect(macroNeutral('energy')).toBeCloseTo(0.5);
    expect(macroNeutral('darkness')).toBeCloseTo(0.5);
    expect(macroNeutral('styleMix')).toBe(0);
  });

  it('answers zero for a macro that no longer exists', () => {
    // A save written before Space and Motion were removed still carries them.
    // `macroNeutral` falls back to 0 for an unknown id, so those keys read as
    // "does nothing" rather than as NaN travelling into the arithmetic — which
    // is why removing the two needed no migration at all.
    expect(macroNeutral('space')).toBe(0);
    expect(macroNeutral('motion')).toBe(0);
  });

  it('gives every macro its own label and colour', () => {
    expect(new Set(WEAVE_MACROS.map((m) => m.label)).size).toBe(WEAVE_MACROS.length);
    expect(new Set(WEAVE_MACROS.map((m) => m.color)).size).toBe(WEAVE_MACROS.length);
  });

  it('builds an id carrying an explicit marker, not a bare dotted prefix', () => {
    // A bare `weave.density` would parse as the `density` param of a lane
    // called `weave`. There is no such lane, so it would land nowhere and
    // throw nothing — inert, which looks exactly like working.
    expect(macroDestinationId('density')).toBe('session.weave:density');
    expect(macroDestinationId('density')).toContain(':');
  });

  it('puts the marker where a parser can find it before the dotted fallback', () => {
    expect(macroDestinationId('space').startsWith(`${WEAVE_SCOPE}:`)).toBe(true);
  });

  it('returns zero for a macro that does not exist, rather than undefined', () => {
    // A saved file from a future version could name a macro this build has
    // never heard of; reading NaN out of it would poison the whole blend.
    expect(macroNeutral('nope')).toBe(0);
  });
});
