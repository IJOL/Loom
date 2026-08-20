// The claim, measured on the NOTES.
//
// `cycle.ts` says how many phrases its wheels take to come back into line.
// That is arithmetic, and arithmetic can be right about a wheel that turns and
// changes nothing — which would be a number growing while the music stood
// still, the exact failure this feature exists to end. So this counts distinct
// RENDERED phrases and holds the two answers against each other.

import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import { createFollowSource, type FollowDeps } from './follow-source';
import { cycleLengthPhrases } from './cycle';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, duration: number, midi: number): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });
const LEADER = [n(0, BAR, 60), n(BAR, BAR, 58)];
const FOUR: Progression = [
  { degree: 0, bars: 1 }, { degree: 5, bars: 1 },
  { degree: 2, bars: 1 }, { degree: 6, bars: 1 },
];

const deps = (role: string, level: number, lapRef: { v: number }): FollowDeps => ({
  leaderNotes: () => LEADER,
  role: () => role as never,
  tonality: () => ({ key: 0, scale: 'minor' }),
  style: () => 'trance',
  barTicks: () => BAR,
  bars: () => 2,
  octaveBase: () => 48,
  written: () => undefined,
  sessionProgression: () => FOUR,
  clipBars: () => 2,
  lap: () => lapRef.v,
  level: () => level,
});

/** Every distinct thing this lane plays across `laps` repeats of its clip. */
function distinct(role: string, level: number, laps: number): number {
  const lapRef = { v: 0 };
  const src = createFollowSource(deps(role, level, lapRef));
  const seen = new Set<string>();
  for (let l = 0; l < laps; l++) {
    lapRef.v = l;
    seen.add((src() ?? []).map((x) => `${x.start}:${x.midi}:${x.velocity}`).join(','));
  }
  return seen.size;
}

describe('a level buys length, and the length is real', () => {
  it('at 0 the lane repeats as soon as its phrase does', () => {
    // Two bars into a four-bar progression is two phrases before it comes
    // round, and nothing else is turning. This is the "loop de 16 notas".
    expect(distinct('comp', 0, 64)).toBe(2);
  });

  it('every wheel added makes it take longer', () => {
    const lengths = [0, 0.25, 0.5, 0.75, 1].map((lv) => distinct('comp', lv, 200));
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]).toBeGreaterThan(lengths[i - 1]);
    }
  });

  it('at the top a hundred phrases are almost all different', () => {
    // Relative, not absolute: what matters is the DISTANCE from level 0, which
    // is the whole claim. Measured at 79 distinct phrases in 100 against 2 at
    // the bottom — and not 100, on purpose. The register wheel sits at home in
    // three of its five positions because a part that changed octave every
    // turn would have no register at all, and a slightly different density
    // does not move a part that was already sparse. Wheels turning is not the
    // same as music differing, and claiming the product of the periods would
    // be a number growing while the music stood still.
    const bottom = distinct('comp', 0, 200);
    const top = distinct('comp', 1, 200);
    expect(top).toBeGreaterThan(bottom * 20);
    expect(top).toBeGreaterThan(50);
  });

  it('the pad gets its length too, and from a different wheel', () => {
    expect(distinct('pad', 0, 64)).toBe(2);
    expect(distinct('pad', 1, 120)).toBeGreaterThan(20);
  });

  it('the bass lengthens without leaving its register', () => {
    // It ignores the register wheel by design, so it has fewer wheels than the
    // others — and must still not repeat every phrase.
    // Fewer wheels than the others by design, and a sparse part besides, so
    // its numbers are smaller — what matters is that it is no longer two.
    expect(distinct('bass', 1, 120)).toBeGreaterThan(distinct('bass', 0, 120) * 3);
    const lapRef = { v: 0 };
    const src = createFollowSource(deps('bass', 1, lapRef));
    const pitches: number[] = [];
    for (let l = 0; l < 60; l++) { lapRef.v = l; (src() ?? []).forEach((x) => pitches.push(x.midi)); }
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThan(12);
  });

  it('what it plays at the top of a cycle is what it played at the start', () => {
    // It has to come ROUND, not merely wander off: a piece that never returns
    // is not a form, it is a drift.
    const lapRef = { v: 0 };
    const src = createFollowSource(deps('comp', 0.5, lapRef));
    const at = (lap: number) => {
      lapRef.v = lap;
      return (src() ?? []).map((x) => `${x.start}:${x.midi}`).join(',');
    };
    // A phrase is two laps here, so a cycle of `cycleLengthPhrases` phrases is
    // twice that in laps.
    const laps = cycleLengthPhrases(0.5) * 2;
    expect(at(laps)).toEqual(at(0));
  });
});
