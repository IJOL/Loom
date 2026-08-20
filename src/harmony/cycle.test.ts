import { describe, it, expect } from 'vitest';
import { cyclesAt, wheelsAt, cycleLengthPhrases } from './cycle';

describe('the wheels a level turns', () => {
  it('none at all at the bottom — which is what everything did before', () => {
    expect(wheelsAt(0)).toBe(0);
    for (let p = 0; p < 20; p++) {
      expect(cyclesAt(p, 0)).toEqual({ figure: 0, colour: 0, register: 0, density: 0 });
    }
  });

  it('adds them one at a time as the knob rises', () => {
    const counts = [0, 0.25, 0.5, 0.75, 1].map(wheelsAt);
    expect(counts).toEqual([0, 1, 2, 3, 4]);
  });

  it('a wheel that is not turning reads zero for ever', () => {
    // So a renderer written against this behaves exactly as it did before,
    // without knowing the feature exists.
    for (let p = 0; p < 40; p++) {
      const c = cyclesAt(p, 0.25);
      expect(c.colour).toBe(0);
      expect(c.register).toBe(0);
      expect(c.density).toBe(0);
    }
  });

  it('clamps nonsense rather than turning a wheel backwards', () => {
    expect(wheelsAt(-3)).toBe(0);
    expect(wheelsAt(9)).toBe(4);
    expect(cyclesAt(-5, 1).figure).toBe(0);
    expect(cyclesAt(NaN, 1).figure).toBe(0);
  });
});

describe('how long before it repeats', () => {
  it('one phrase at the bottom: pure repetition', () => {
    expect(cycleLengthPhrases(0)).toBe(1);
  });

  it('multiplies with every wheel, because the periods are co-prime', () => {
    // The whole idea in one assertion. Were the periods related — 2, 4, 8 —
    // this would be the largest of them rather than their product, and four
    // wheels would buy eight phrases instead of four hundred and twenty.
    expect(cycleLengthPhrases(0.25)).toBe(4);
    expect(cycleLengthPhrases(0.5)).toBe(20);
    expect(cycleLengthPhrases(0.75)).toBe(140);
    expect(cycleLengthPhrases(1)).toBe(420);
  });

  it('and the MEASURED cycle matches the arithmetic', () => {
    // Counted rather than trusted: a wheel that turned and changed nothing
    // would inflate the number above while the music stood still.
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const claimed = cycleLengthPhrases(level);
      const seen = new Set<string>();
      for (let p = 0; p < claimed * 2; p++) seen.add(JSON.stringify(cyclesAt(p, level)));
      expect(seen.size).toBe(claimed);
      // And it genuinely comes ROUND, rather than merely never repeating.
      expect(cyclesAt(claimed, level)).toEqual(cyclesAt(0, level));
    }
  });

  it('every phrase inside a cycle is a DIFFERENT arrangement of the wheels', () => {
    // No two phrases of the 420 stand the same way. If any pair did, the
    // music would repeat sooner than the number claims.
    const seen = new Set<string>();
    for (let p = 0; p < 420; p++) seen.add(JSON.stringify(cyclesAt(p, 1)));
    expect(seen.size).toBe(420);
  });
});
