// Style mix has to be a RATE, not a single throw.
//
// It was the second: seed and laneIndex never move on their own, so the draw
// was decided the first time it was asked and never again. Turning the knob up
// meant a lane either strayed or did not, for the life of the session, unless
// you pressed reshuffle by hand — which is precisely how it was reported:
// "no hace nada si no das a reshuffle, debería actuar por sí mismo haciendo
// más frecuentes los cambios de estilo, que automáticamente no ocurren".

import { describe, it, expect } from 'vitest';
import { styleForLane, scaleForDarkness, sceneScale, DARKNESS_SCALES, holdLegsFor } from './style-mix';
import { STYLE_CATALOG, type StyleId } from '../core/musicality';

const BASE: StyleId = 'techno';
const SEED = 12345;

/** The styles one lane draws across a run of legs. */
const walk = (mix: number, legs: number, laneIndex = 0, seed = SEED): StyleId[] =>
  Array.from({ length: legs }, (_, leg) => styleForLane(BASE, mix, laneIndex, seed, undefined, leg));

describe('the draw is re-thrown per leg', () => {
  it('a lane visits more than one style as it travels', () => {
    // Long enough to cross several BLOCKS. Half way up the knob a lane holds a
    // style for ten legs and only strays on half of them, so forty legs is four
    // blocks and could honestly be four blocks of home — a run that short was
    // testing the seed, not the feature.
    const seen = new Set(walk(0.5, 400));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('leg 0 draws exactly what it drew before legs existed', () => {
    // The two salts are 0 and 1 at leg 0 — the same constants the function used
    // when it had no leg parameter. A session that has not travelled must not
    // change what it plays because this feature was added.
    for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
      expect(styleForLane(BASE, mix, 3, SEED, undefined, 0))
        .toBe(styleForLane(BASE, mix, 3, SEED));
    }
  });

  it('is still deterministic — the same leg always draws the same style', () => {
    // Repeatability is the whole reason this never touches Math.random: a lane
    // must not change style because a curve was repainted.
    expect(walk(0.6, 25)).toEqual(walk(0.6, 25));
  });
});

describe('a style is HELD for more than one lap', () => {
  it('does not change on every lap, even at the top of the knob', () => {
    // A leg is a lap — the counter ticks when a lane wraps — so a draw thrown
    // per leg is a new style every time round. Reported as too much.
    const styles = walk(1, 12);
    const changes = styles.filter((s, i) => i > 0 && s !== styles[i - 1]).length;
    expect(changes).toBeLessThan(styles.length - 1);
  });

  it('holds each style across consecutive laps', () => {
    // Laps 0 and 1 are one block, 2 and 3 the next: adjacent pairs must agree.
    for (const leg of [0, 2, 4, 6, 8]) {
      expect(styleForLane(BASE, 1, 0, SEED, undefined, leg))
        .toBe(styleForLane(BASE, 1, 0, SEED, undefined, leg + 1));
    }
  });

  it('still moves on — holding is not stopping', () => {
    expect(new Set(walk(1, 40)).size).toBeGreaterThan(1);
  });
});

describe('the knob decides HOW OFTEN', () => {
  /** Legs out of `n` on which the lane is somewhere other than home. */
  const strayRate = (mix: number, n = 400) =>
    walk(mix, n).filter((s) => s !== BASE).length / n;

  it('zero never strays, however far it travels', () => {
    expect(strayRate(0)).toBe(0);
  });

  it('turning it up strays more often', () => {
    // Relative, in order — the claim is monotonicity, not any particular rate.
    const low = strayRate(0.2), mid = strayRate(0.5), high = strayRate(0.9);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('full strays on nearly every leg', () => {
    expect(strayRate(1)).toBeGreaterThan(0.9);
  });

  it('never draws the base as a "stray" — straying means leaving', () => {
    // From the SECOND block on: the first is deliberately home, so a scene
    // opens in the style the toolbar is showing rather than somewhere the
    // music has never been.
    const others: Set<StyleId> = new Set(STYLE_CATALOG.map((s) => s.id).filter((id) => id !== BASE));
    const hold = holdLegsFor(1);
    for (let leg = hold; leg < 60; leg++) {
      expect(others.has(styleForLane(BASE, 1, 0, SEED, undefined, leg))).toBe(true);
    }
  });
});

describe('lanes travel independently', () => {
  it('two lanes on the same leg do not move in lockstep', () => {
    const a = walk(0.5, 40, 0);
    const b = walk(0.5, 40, 1);
    expect(a).not.toEqual(b);
  });

  it('a per-lane override still silences the macro entirely', () => {
    // A forced style is the user speaking, at every leg.
    for (let leg = 0; leg < 20; leg++) {
      expect(styleForLane(BASE, 1, 0, SEED, 'house', leg)).toBe('house');
    }
  });
});

describe('the colour travels, and it travels from wherever HOME is', () => {
  it('leg 0 is exactly what Mood says, and Mood at rest is the session', () => {
    expect(sceneScale('dorian', 0.5, 0, 99)).toBe('dorian');
    for (const d of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      expect(sceneScale('minor', d, 0, 99)).toBe(scaleForDarkness(d));
    }
  });

  it('drifts at the NEUTRAL Mood — which is where it never used to', () => {
    // The whole bug: the drift hung off `scaleForDarkness`, which only ran when
    // Mood was off centre, and Mood sits at centre unless dragged. So a scene
    // at the default never changed colour however far it travelled.
    // "Seguimos sin usar escalas para nuestras evoluciones."
    const seen = new Set<string>();
    for (let leg = 0; leg < 24; leg++) seen.add(sceneScale('minor', 0.5, leg, 7));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('never further than ONE rung from home', () => {
    const home = DARKNESS_SCALES.indexOf('dorian');
    for (let leg = 0; leg < 200; leg++) {
      const i = DARKNESS_SCALES.indexOf(sceneScale('dorian', 0.5, leg, leg * 13));
      expect(Math.abs(i - home)).toBeLessThanOrEqual(1);
    }
  });

  it('a scale the ladder does not carry stays put', () => {
    // Six modes of seven notes; there is no honest neighbour for a five-note
    // scale, and drifting to one would change how many notes the music has.
    for (let leg = 0; leg < 40; leg++) {
      expect(sceneScale('pentMinor', 0.5, leg, 3)).toBe('pentMinor');
      expect(sceneScale('chromatic', 0.5, leg, 3)).toBe('chromatic');
    }
  });

  it('the ends of the ladder do not fall off it', () => {
    for (let leg = 0; leg < 60; leg++) {
      expect(DARKNESS_SCALES).toContain(sceneScale('lydian', 0.5, leg, 3));
      expect(DARKNESS_SCALES).toContain(sceneScale('phrygian', 0.5, leg, 3));
    }
  });

  it('HOLDS — a mode is too big a thing to change every leg', () => {
    for (let leg = 0; leg < 20; leg += 2) {
      expect(sceneScale('minor', 0.5, leg, 5)).toBe(sceneScale('minor', 0.5, leg + 1, 5));
    }
  });

  it('the same leg gives the same colour every time', () => {
    for (let leg = 0; leg < 10; leg++) {
      expect(sceneScale('minor', 0.7, leg, 11)).toBe(sceneScale('minor', 0.7, leg, 11));
    }
  });
});
