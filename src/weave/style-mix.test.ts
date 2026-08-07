import { describe, it, expect } from 'vitest';
import { styleForLane, scaleForDarkness, DARKNESS_SCALES } from './style-mix';
import { STYLE_CATALOG } from '../core/musicality';

describe('style mix', () => {
  it('gives every lane the base style when the mix is zero', () => {
    for (let i = 0; i < 8; i++) {
      expect(styleForLane('techno', 0, i, 7)).toBe('techno');
    }
  });

  it('is deterministic for the same seed, lane and mix', () => {
    // A lane must not change style merely because a curve was repainted or the
    // panel re-rendered, so this can never reach for Math.random.
    for (let i = 0; i < 8; i++) {
      expect(styleForLane('techno', 0.8, i, 42)).toBe(styleForLane('techno', 0.8, i, 42));
    }
  });

  it('gives different lanes different answers', () => {
    const got = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => styleForLane('techno', 1, i, 42));
    expect(new Set(got).size).toBeGreaterThan(1);
  });

  it('moves at least one lane off the base once the mix is high', () => {
    const got = [0, 1, 2, 3, 4, 5].map((i) => styleForLane('techno', 1, i, 42));
    expect(got.some((s) => s !== 'techno')).toBe(true);
  });

  it('strays more often as the mix rises', () => {
    const strayed = (mix: number) =>
      [...Array(40).keys()].filter((i) => styleForLane('techno', mix, i, 42) !== 'techno').length;
    expect(strayed(0.9)).toBeGreaterThan(strayed(0.2));
  });

  it('never strays to the base itself, so "strayed" always means moved', () => {
    for (let i = 0; i < 40; i++) {
      const s = styleForLane('techno', 1, i, 42);
      if (s !== 'techno') expect(STYLE_CATALOG.some((e) => e.id === s)).toBe(true);
    }
  });

  it('ignores the mix entirely when the lane forces a style', () => {
    expect(styleForLane('techno', 1, 3, 42, 'jungle')).toBe('jungle');
    expect(styleForLane('techno', 0, 3, 42, 'jungle')).toBe('jungle');
  });

  it('always returns a style the catalogue knows', () => {
    for (let i = 0; i < 40; i++) {
      const s = styleForLane('techno', 1, i, 42);
      expect(STYLE_CATALOG.some((e) => e.id === s)).toBe(true);
    }
  });

  it('gives a different scene a different draw', () => {
    const a = [...Array(8).keys()].map((i) => styleForLane('techno', 1, i, 1));
    const b = [...Array(8).keys()].map((i) => styleForLane('techno', 1, i, 2));
    expect(a).not.toEqual(b);
  });
});

describe('darkness', () => {
  it('gets darker as the macro rises', () => {
    expect(DARKNESS_SCALES.indexOf(scaleForDarkness(1)))
      .toBeGreaterThan(DARKNESS_SCALES.indexOf(scaleForDarkness(0)));
  });

  it('returns a scale the table knows, across the whole range', () => {
    for (let i = 0; i <= 20; i++) {
      expect(DARKNESS_SCALES).toContain(scaleForDarkness(i / 20));
    }
  });

  it('is the brightest at the floor and the darkest at the ceiling', () => {
    expect(scaleForDarkness(0)).toBe(DARKNESS_SCALES[0]);
    expect(scaleForDarkness(1)).toBe(DARKNESS_SCALES[DARKNESS_SCALES.length - 1]);
  });

  it('never runs off the end of the table at exactly 1', () => {
    // Math.floor(1 * n) is n, one past the last index.
    expect(scaleForDarkness(1)).toBeDefined();
  });

  it('clamps a value outside 0..1', () => {
    expect(scaleForDarkness(-3)).toBe(DARKNESS_SCALES[0]);
    expect(scaleForDarkness(9)).toBe(DARKNESS_SCALES[DARKNESS_SCALES.length - 1]);
  });

  it('never moves backwards as darkness rises', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const idx = DARKNESS_SCALES.indexOf(scaleForDarkness(i / 20));
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});
