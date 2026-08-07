import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { blendRhythm } from './blend-rhythm';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });

const KICK = 36, SNARE = 38, HAT = 42;
const key = (n: NoteEvent) => `${n.start}:${n.midi}`;
const keys = (ns: NoteEvent[]) => ns.map(key).sort();

// Shared: kick on 0 and 8, snare on 4.
// A-only: kick on 10 (an eighth), hat on 3 (an off-sixteenth) — one strong, one weak.
// B-only: hat on 12 (a beat), kick on 3 and hat on 15 (off-sixteenths) — likewise.
// Both sides need a strong AND a weak exclusive hit, or the ordering tests
// compare two positions of equal weight and pass or fail by luck.
const A = [hit(0, KICK), hit(8, KICK), hit(10, KICK), hit(4, SNARE), hit(3, HAT)];
const B = [hit(0, KICK), hit(8, KICK), hit(3, KICK), hit(4, SNARE), hit(12, HAT), hit(15, HAT)];
const SHARED = [hit(0, KICK), hit(8, KICK), hit(4, SNARE)].map(key);

describe('blendRhythm', () => {
  it('is exactly A at x=0', () => {
    expect(keys(blendRhythm(A, B, 0, BAR))).toEqual(keys(A));
  });

  it('is exactly B at x=1', () => {
    expect(keys(blendRhythm(A, B, 1, BAR))).toEqual(keys(B));
  });

  it('keeps every shared hit at every point of the crossing', () => {
    for (let i = 0; i <= 20; i++) {
      const out = keys(blendRhythm(A, B, i / 20, BAR));
      for (const s of SHARED) expect(out).toContain(s);
    }
  });

  it('drops a weak hit of A before a strong one', () => {
    // The hat on step 3 is an off-sixteenth; the kick on step 10 sits on an
    // eighth. The weaker one has to go first.
    let hatGone = -1, kickGone = -1;
    for (let i = 0; i <= 100; i++) {
      const out = keys(blendRhythm(A, B, i / 100, BAR));
      if (hatGone < 0 && !out.includes(key(hit(3, HAT)))) hatGone = i;
      if (kickGone < 0 && !out.includes(key(hit(10, KICK)))) kickGone = i;
    }
    expect(hatGone).toBeGreaterThan(-1);
    expect(kickGone).toBeGreaterThan(-1);
    expect(hatGone).toBeLessThan(kickGone);
  });

  it('brings a strong hit of B in before a weak one', () => {
    // The hat on step 12 lands on a beat; the kick on step 3 is an
    // off-sixteenth. The stronger one has to arrive first.
    let strongIn = -1, weakIn = -1;
    for (let i = 0; i <= 100; i++) {
      const out = keys(blendRhythm(A, B, i / 100, BAR));
      if (strongIn < 0 && out.includes(key(hit(12, HAT)))) strongIn = i;
      if (weakIn < 0 && out.includes(key(hit(3, KICK)))) weakIn = i;
    }
    expect(strongIn).toBeGreaterThan(-1);
    expect(weakIn).toBeGreaterThan(-1);
    expect(strongIn).toBeLessThan(weakIn);
  });

  it('never returns two hits on the same step and voice', () => {
    for (let i = 0; i <= 20; i++) {
      const out = blendRhythm(A, B, i / 20, BAR).map(key);
      expect(new Set(out).size).toBe(out.length);
    }
  });

  it('treats a kick and a snare on the same step as two different hits', () => {
    // In percussion `midi` picks the drum, so keying on the step alone would
    // collapse a whole backbeat into one hit.
    const a = [hit(4, KICK)];
    const b = [hit(4, SNARE)];
    expect(keys(blendRhythm(a, b, 0, BAR))).toEqual([key(hit(4, KICK))]);
    expect(keys(blendRhythm(a, b, 1, BAR))).toEqual([key(hit(4, SNARE))]);
  });

  it('returns the notes in time order', () => {
    const out = blendRhythm(A, B, 0.5, BAR);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
    }
  });

  it('produces something neither pattern contains, halfway across', () => {
    const mid = keys(blendRhythm(A, B, 0.5, BAR));
    expect(mid).not.toEqual(keys(A));
    expect(mid).not.toEqual(keys(B));
    for (const s of SHARED) expect(mid).toContain(s);
  });

  it('handles an empty pattern on either side', () => {
    expect(keys(blendRhythm([], B, 1, BAR))).toEqual(keys(B));
    expect(keys(blendRhythm(A, [], 0, BAR))).toEqual(keys(A));
  });
});
