import { describe, it, expect } from 'vitest';
import { styleForLane, scaleForDarkness, DARKNESS_SCALES, holdLegsFor, reachFor } from './style-mix';
import { STYLE_CATALOG, scaleIntervals } from '../core/musicality';

/** A leg well past the first block, since block 0 is deliberately home.
 *
 *  Every case below that is about STRAYING has to travel first. It did not use
 *  to: the draw fired the first time it was asked, so a scene opened in a style
 *  the toolbar was not showing — which made Style a label for somewhere the
 *  music had never been. Home first, then away. */
const TRAVELLED = 40;

describe('style mix', () => {
  it('gives every lane the base style when the mix is zero', () => {
    for (let i = 0; i < 8; i++) {
      expect(styleForLane('techno', 0, i, 7, undefined, TRAVELLED)).toBe('techno');
    }
  });

  it('opens at HOME however high the mix, and travels afterwards', () => {
    for (let i = 0; i < 8; i++) expect(styleForLane('techno', 1, i, 42)).toBe('techno');
    const later = [...Array(8).keys()].map((i) => styleForLane('techno', 1, i, 42, undefined, TRAVELLED));
    expect(later.some((s) => s !== 'techno')).toBe(true);
  });

  it('is deterministic for the same seed, lane and mix', () => {
    // A lane must not change style merely because a curve was repainted or the
    // panel re-rendered, so this can never reach for Math.random.
    for (let i = 0; i < 8; i++) {
      expect(styleForLane('techno', 0.8, i, 42, undefined, TRAVELLED))
        .toBe(styleForLane('techno', 0.8, i, 42, undefined, TRAVELLED));
    }
  });

  it('gives different lanes different answers', () => {
    const got = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => styleForLane('techno', 1, i, 42, undefined, TRAVELLED));
    expect(new Set(got).size).toBeGreaterThan(1);
  });

  it('strays more often as the mix rises', () => {
    const strayed = (mix: number) => [...Array(40).keys()]
      .filter((i) => styleForLane('techno', mix, i, 42, undefined, TRAVELLED) !== 'techno').length;
    expect(strayed(0.9)).toBeGreaterThan(strayed(0.2));
  });

  it('never strays to the base itself, so "strayed" always means moved', () => {
    // Reflection at the ends can bounce straight back onto home — two steps
    // down from index one mirrors to index one — so this is not the tautology
    // it looks like. It failed before the bounce was guarded.
    for (let leg = 1; leg < 60; leg++) {
      for (let i = 0; i < 20; i++) {
        for (const base of ['techno', 'acid-techno', 'ambient', 'lo-fi'] as const) {
          const s = styleForLane(base, 1, i, 42, undefined, leg);
          if (s !== base) expect(STYLE_CATALOG.some((e) => e.id === s)).toBe(true);
        }
      }
    }
  });

  it('ignores the mix entirely when the lane forces a style', () => {
    expect(styleForLane('techno', 1, 3, 42, 'jungle', TRAVELLED)).toBe('jungle');
    expect(styleForLane('techno', 0, 3, 42, 'jungle', TRAVELLED)).toBe('jungle');
  });

  it('always returns a style the catalogue knows', () => {
    for (let leg = 0; leg < 60; leg++) {
      for (let i = 0; i < 20; i++) {
        expect(STYLE_CATALOG.some((e) => e.id === styleForLane('techno', 1, i, 42, undefined, leg)))
          .toBe(true);
      }
    }
  });

  it('gives a different scene a different draw', () => {
    const a = [...Array(8).keys()].map((i) => styleForLane('techno', 1, i, 1, undefined, TRAVELLED));
    const b = [...Array(8).keys()].map((i) => styleForLane('techno', 1, i, 2, undefined, TRAVELLED));
    expect(a).not.toEqual(b);
  });
});

describe('a stray travels by NEIGHBOURS, not by teleport', () => {
  const at = (id: string) => STYLE_CATALOG.findIndex((s) => s.id === id);

  it('never lands further than the knob reaches', () => {
    // "Los estilos han variado a lo loco": a uniform draw over twenty styles
    // put a downtempo scene in jungle and back again. The catalogue is ordered
    // by family, so a step or two along it shares a tempo and a kick with what
    // it left.
    for (const mix of [0.2, 0.5, 1]) {
      for (let leg = 1; leg < 80; leg++) {
        for (let i = 0; i < 12; i++) {
          const got = styleForLane('trance', mix, i, 9, undefined, leg);
          expect(Math.abs(at(got) - at('trance'))).toBeLessThanOrEqual(reachFor(mix));
        }
      }
    }
  });

  it('measures from HOME, so the scene does not wander off for good', () => {
    // Cumulative steps would leave the toolbar's Style naming only where the
    // scene BEGAN, which is the same reason the colour drifts around Mood.
    const seen = new Set<string>();
    for (let leg = 1; leg < 200; leg++) seen.add(styleForLane('house', 1, 0, 5, undefined, leg));
    for (const s of seen) expect(Math.abs(at(s) - at('house'))).toBeLessThanOrEqual(reachFor(1));
  });

  it('a base at either end of the catalogue still moves inwards', () => {
    for (const base of ['techno', 'ambient'] as const) {
      const seen = new Set<string>();
      for (let leg = 1; leg < 120; leg++) seen.add(styleForLane(base, 1, 0, 3, undefined, leg));
      expect(seen.size).toBeGreaterThan(1);
      for (const s of seen) expect(STYLE_CATALOG.some((e) => e.id === s)).toBe(true);
    }
  });
});

describe('the knob is a RATE, and one knob moves both things', () => {
  it('holds longer the lower it is set', () => {
    expect(holdLegsFor(0.1)).toBeGreaterThan(holdLegsFor(1));
    expect(holdLegsFor(0)).toBeGreaterThan(holdLegsFor(0.5));
  });

  it('never holds for less than a leg', () => {
    for (const m of [0, 0.25, 0.5, 0.75, 1, 2, -1]) expect(holdLegsFor(m)).toBeGreaterThanOrEqual(1);
  });

  it('reaches further the higher it is set, and always at least one step', () => {
    expect(reachFor(1)).toBeGreaterThan(reachFor(0));
    for (const m of [0, 0.5, 1, 2, -1]) expect(reachFor(m)).toBeGreaterThanOrEqual(1);
  });

  it('holds a style for the whole block, then may move', () => {
    // The complaint was rate, not existence: "el estilo cambia demasiado a
    // menudo". Inside one block the answer must not move at all.
    const hold = holdLegsFor(1);
    const first = styleForLane('house', 1, 2, 11, undefined, hold);
    for (let k = 0; k < hold; k++) {
      expect(styleForLane('house', 1, 2, 11, undefined, hold + k)).toBe(first);
    }
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

  it('moves exactly ONE note per step, which is why it reads as a fade', () => {
    // Reported as "darkness es casi un switch". It was four scales and
    // major→dorian flattened TWO degrees at once — twice the size of every
    // other step, and the one that sounded like a channel change. Mixolydian
    // was the missing rung.
    //
    // A scale control cannot be continuous: notes are a semitone apart, and a
    // third of a semitone is detuning rather than colour. Steps this small are
    // the most it can offer, so the property worth pinning is the step SIZE.
    for (let i = 1; i < DARKNESS_SCALES.length; i++) {
      const before = new Set(scaleIntervals(DARKNESS_SCALES[i - 1]));
      const after = scaleIntervals(DARKNESS_SCALES[i]);
      expect(before.size).toBe(after.length);       // seven-note modes throughout
      const moved = after.filter((n) => !before.has(n));
      expect(moved).toHaveLength(1);
    }
  });

  it('darkens by FLATTENING, never by raising', () => {
    // "Darker" has to mean something, or the ladder is just an ordering. Each
    // step replaces one degree with a lower one.
    for (let i = 1; i < DARKNESS_SCALES.length; i++) {
      const before = scaleIntervals(DARKNESS_SCALES[i - 1]);
      const after = scaleIntervals(DARKNESS_SCALES[i]);
      const gone = before.find((n) => !after.includes(n))!;
      const added = after.find((n) => !before.includes(n))!;
      expect(added).toBeLessThan(gone);
    }
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
