// The point of every case here is the SAME melody scoring differently than it
// would under a headcount. Where a test would pass under the old frequency vote
// too, it is not pinning anything.

import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { inferChords } from './infer-chords';

const BAR = TICKS_PER_QUARTER * 4;                    // 384 ticks in 4/4
// Both bonuses off by default here: most cases are about the WEIGHTING, and
// leaving one on lets a test pass for the wrong reason. Inertia was off from
// the start for exactly that reason; the cadence was not, and it duly did it —
// "a long note outweighs a short one" below was green because the tonic
// collected the end-of-phrase bonus, not because the long note won anything.
// The two tests that are ABOUT the cadence pass their own.
const base = {
  key: 9, scale: 'minor' as const, barTicks: BAR, bars: 1, inertia: 0, cadence: 0,
};
/** For the cases that are about the lean itself. */
const leaning = { ...base, cadence: 0.2 };
const n = (start: number, duration: number, midi: number): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });
// A = 57, C = 60, E = 64 → the tonic triad of A minor (degrees 0, 2, 4).

describe('inferChords weighs position and duration', () => {
  it('names the tonic when the bar is built on it', () => {
    expect(inferChords([n(0, BAR / 2, 57), n(BAR / 2, BAR / 2, 60)], base))
      .toEqual([{ degree: 0, bars: 1 }]);
  });

  it('is not moved by a short passing note off the beat', () => {
    // One long tonic, plus a lone B (59, degree 1) as a sixteenth on the
    // weakest position. A headcount scores these 1-1.
    const withPassing = inferChords(
      [n(0, BAR - TICKS_PER_STEP, 57), n(BAR - TICKS_PER_STEP, TICKS_PER_STEP, 59)], base);
    const without = inferChords([n(0, BAR - TICKS_PER_STEP, 57)], base);
    expect(withPassing[0].degree).toBe(without[0].degree);
  });

  it('a downbeat note outweighs an equal-length note off the beat', () => {
    // The SAME two pitches, swapping only which one lands on the downbeat. The
    // answer has to flip — that is the whole claim, and nothing but position
    // differs between the two calls.
    //
    // The pair is A (57, degree 0) and B (59, degree 1), chosen because neither
    // one's triad contains the other. An earlier version of this test used D
    // (62), and D minor CONTAINS A — so the winner explained both notes and the
    // test was measuring the scoring, not the position.
    const aFirst = inferChords(
      [n(0, TICKS_PER_STEP, 57), n(TICKS_PER_STEP, TICKS_PER_STEP, 59)], base);
    const bFirst = inferChords(
      [n(0, TICKS_PER_STEP, 59), n(TICKS_PER_STEP, TICKS_PER_STEP, 57)], base);
    expect(aFirst[0].degree).toBe(0);
    expect(bFirst[0].degree).not.toBe(0);
  });

  it('a chord that explains BOTH notes beats one that explains the louder one', () => {
    // A on the downbeat and D off it. The tonic triad holds A alone; the triad
    // on D holds A *and* D, so it wins despite A carrying more weight. This is
    // the behaviour that made the previous test wrong, pinned deliberately —
    // it is the scoring working, not a leak.
    const out = inferChords(
      [n(0, TICKS_PER_STEP, 57), n(TICKS_PER_STEP, TICKS_PER_STEP, 62)], base);
    expect(out[0].degree).toBe(3);
  });

  it('a long note outweighs a short one in the same position class', () => {
    // Two QUARTERS — steps 4 and 12, identical metric weight — so length is
    // genuinely the only thing between them. And two degrees a step apart (A
    // and B), because no triad holds both: with a chord able to explain the
    // pair, the pair wins and duration never gets asked.
    //
    // The previous version of this used a downbeat sixteenth against a
    // half-note and expected the tonic. Neither half was true: the positions
    // differed, and the triad on D explains BOTH those notes — which the test
    // directly above pins as correct behaviour. It passed on the cadence bonus.
    const q1 = TICKS_PER_STEP * 4;
    const q2 = TICKS_PER_STEP * 12;
    const longB = inferChords([n(q1, TICKS_PER_STEP, 57), n(q2, TICKS_PER_STEP * 4, 59)], base);
    const longA = inferChords([n(q1, TICKS_PER_STEP * 4, 57), n(q2, TICKS_PER_STEP, 59)], base);
    // Whichever note is held is the one the chord is built to hold.
    expect(longB[0].degree).toBe(1);
    expect(longA[0].degree).toBe(0);
  });
});

describe('inferChords holds its ground', () => {
  it('merges consecutive bars on the same chord into one entry', () => {
    expect(inferChords([n(0, BAR, 57), n(BAR, BAR, 57)], { ...base, bars: 2 }))
      .toEqual([{ degree: 0, bars: 2 }]);
  });

  it('an empty bar keeps the chord before it', () => {
    expect(inferChords([n(0, BAR, 57)], { ...base, bars: 2 }))
      .toEqual([{ degree: 0, bars: 2 }]);
  });

  it('an empty leader yields the tonic rather than nothing', () => {
    expect(inferChords([], { ...base, bars: 2 })).toEqual([{ degree: 0, bars: 2 }]);
  });

  it('inertia can hold a chord that the weighting alone would move', () => {
    // A bar that leans elsewhere only slightly. With the bonus on, the previous
    // chord survives it; with the bonus off, it does not have to.
    const notes = [n(0, BAR, 57), n(BAR, TICKS_PER_STEP, 62), n(BAR + TICKS_PER_STEP, TICKS_PER_STEP, 64)];
    const held = inferChords(notes, { ...base, bars: 2, inertia: 2 });
    expect(held).toEqual([{ degree: 0, bars: 2 }]);
  });
});

describe('inferChords leans towards a cadence at the end', () => {
  it('applies the bonus to the LAST bar only', () => {
    const notes = [n(0, BAR, 60), n(BAR, BAR / 2, 64), n(BAR + BAR / 2, BAR / 2, 59)];
    const out = inferChords(notes, { ...leaning, bars: 2 });
    expect(out[0].degree).not.toBe(4);
  });

  it('is a preference, not an override — it does not rewrite a firm ending', () => {
    // A whole last bar of the tonic triad stays the tonic. If the bonus could
    // overrule material this plain, it would be a rule and not a lean.
    const notes = [n(0, BAR, 62), n(BAR, BAR, 57), n(BAR, BAR, 60), n(BAR, BAR, 64)];
    const out = inferChords(notes, { ...leaning, bars: 2 });
    expect(out[out.length - 1].degree).toBe(0);
  });
});
