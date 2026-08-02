// src/audio-dsp/param-index.test.ts
import { describe, it, expect } from 'vitest';
import { buildParamIndex, SYNTHETIC_TARGETS } from './param-index';

describe('buildParamIndex', () => {
  it('numbers declared params in declaration order, from zero', () => {
    const ix = buildParamIndex(['filter.cutoff', 'osc1.level']);
    expect(ix.slot['filter.cutoff']).toBe(0);
    expect(ix.slot['osc1.level']).toBe(1);
  });

  it('puts the synthetic targets AFTER every declared param', () => {
    // So that adding or removing a synthetic target can never renumber a
    // declared one — a renderer resolves its slots once and keeps them.
    const ix = buildParamIndex(['a', 'b']);
    for (const t of SYNTHETIC_TARGETS) expect(ix.slot[t]).toBeGreaterThanOrEqual(2);
  });

  it('length covers the declared params plus the synthetic targets', () => {
    const ix = buildParamIndex(['a', 'b']);
    expect(ix.length).toBe(2 + SYNTHETIC_TARGETS.length);
  });

  it('user: an id it never heard of has no slot', () => {
    // The point of the index: an unknown id is not addressable, so a plugin's
    // typo cannot silently occupy storage nobody reads.
    const ix = buildParamIndex(['a']);
    expect(ix.slot['typo.here']).toBeUndefined();
  });

  it('a repeated id keeps its first slot instead of taking a second', () => {
    const ix = buildParamIndex(['a', 'b', 'a']);
    expect(ix.slot['a']).toBe(0);
    expect(ix.length).toBe(2 + SYNTHETIC_TARGETS.length);
  });

  it('an engine that declares a synthetic name does not get it twice', () => {
    // 'amp' is a legal param id AND a synthetic modulation target. One slot.
    const ix = buildParamIndex(['amp']);
    expect(ix.slot['amp']).toBe(0);
    expect(ix.length).toBe(1 + SYNTHETIC_TARGETS.length - 1);
  });
});
