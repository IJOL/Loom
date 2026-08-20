import { describe, it, expect } from 'vitest';
import { TICKS_PER_QUARTER, type NoteEvent } from '../core/notes';
import { barsOfProgression } from './clip-window';

const BAR = TICKS_PER_QUARTER * 4;
const n = (start: number, midi: number, duration = 24): NoteEvent =>
  ({ start, duration, midi, velocity: 100 });

/** Four bars, one note per bar, each nameable by its pitch. */
const FOUR = [n(0, 60), n(BAR, 61), n(BAR * 2, 62), n(BAR * 3, 63)];
const pitches = (x: NoteEvent[]) => x.map((e) => e.midi);
const starts = (x: NoteEvent[]) => x.map((e) => e.start);

describe('the bars a clip plays of a longer progression', () => {
  it('a two-bar clip hears the FIRST half on lap 0', () => {
    expect(pitches(barsOfProgression(FOUR, 4, 0, 2, BAR))).toEqual([60, 61]);
  });

  it('and the SECOND half on lap 1 — which is the whole point', () => {
    // Before this, bars three and four were dropped by the scheduler and no
    // chord after the second had ever been heard, while the chord bar drew all
    // four. A four-bar progression now reaches a two-bar lane, two per lap.
    expect(pitches(barsOfProgression(FOUR, 4, 2, 2, BAR))).toEqual([62, 63]);
  });

  it('and comes round', () => {
    expect(pitches(barsOfProgression(FOUR, 4, 4, 2, BAR))).toEqual([60, 61]);
  });

  it('rebases what it takes, so the clip always starts at its own bar one', () => {
    expect(starts(barsOfProgression(FOUR, 4, 2, 2, BAR))).toEqual([0, BAR]);
  });

  it('keeps each note where it sat INSIDE its bar', () => {
    const offbeat = [n(BAR * 2 + 48, 62), n(BAR * 3 + 96, 63)];
    expect(starts(barsOfProgression(offbeat, 4, 2, 2, BAR))).toEqual([48, BAR + 96]);
  });
});

describe('the bars a clip plays of a SHORTER progression', () => {
  it('tiles it, instead of leaving the rest of the clip silent', () => {
    // "Stay home" is one bar. In a two-bar clip that used to be a bar of music
    // and a bar of nothing — hidden until the harmony stopped being inferred,
    // because inference measured the leader and happened to answer with as
    // many bars as the clip had.
    const one = [n(0, 60)];
    expect(pitches(barsOfProgression(one, 1, 0, 2, BAR))).toEqual([60, 60]);
    expect(starts(barsOfProgression(one, 1, 0, 2, BAR))).toEqual([0, BAR]);
  });

  it('a three-bar progression in a two-bar clip walks, it does not restart', () => {
    const three = [n(0, 60), n(BAR, 61), n(BAR * 2, 62)];
    expect(pitches(barsOfProgression(three, 3, 0, 2, BAR))).toEqual([60, 61]);
    expect(pitches(barsOfProgression(three, 3, 2, 2, BAR))).toEqual([62, 60]);
    expect(pitches(barsOfProgression(three, 3, 4, 2, BAR))).toEqual([61, 62]);
  });
});

describe('it holds its shape', () => {
  it('an equal-length clip is the progression untouched', () => {
    expect(barsOfProgression(FOUR, 4, 0, 4, BAR)).toEqual(FOUR);
  });

  it('a chord held across the whole bar keeps its length', () => {
    const held = [n(0, 60, BAR), n(BAR, 61, BAR)];
    expect(barsOfProgression(held, 2, 1, 1, BAR)[0].duration).toBe(BAR);
  });

  it('several voices in one bar all travel together', () => {
    const stack = [n(BAR, 60), n(BAR, 64), n(BAR, 67)];
    expect(pitches(barsOfProgression(stack, 2, 1, 1, BAR))).toEqual([60, 64, 67]);
  });

  it('nonsense in, the notes back out rather than silence', () => {
    expect(barsOfProgression(FOUR, 0, 0, 2, BAR)).toHaveLength(FOUR.length);
    expect(barsOfProgression(FOUR, 4, 0, 0, BAR)).toHaveLength(FOUR.length);
  });
});
