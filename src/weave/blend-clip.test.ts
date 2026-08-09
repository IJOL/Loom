import { describe, it, expect } from 'vitest';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { inScale } from '../core/musicality';
import { blendLoops, blendLoopsBySource, type BlendOptions } from './blend-clip';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });
const key = (n: NoteEvent) => `${n.start}:${n.midi}`;
const keys = (ns: NoteEvent[]) => ns.map(key).sort();

const drums: BlendOptions = { barTicks: BAR, melodic: false, key: 9, scale: 'minor', octaveBase: 36 };
const melodic: BlendOptions = { ...drums, melodic: true };

const A = [hit(0, 36), hit(4, 38)];
const B = [hit(0, 36), hit(8, 36)];

describe('blendLoops', () => {
  it('returns the single loop untouched when there is only one', () => {
    expect(keys(blendLoops([{ notes: A, weight: 1 }], drums))).toEqual(keys(A));
  });

  it('is the first loop when all the weight sits on it', () => {
    const out = blendLoops([{ notes: A, weight: 1 }, { notes: B, weight: 0 }], drums);
    expect(keys(out)).toEqual(keys(A));
  });

  it('is the second loop when all the weight sits on it', () => {
    const out = blendLoops([{ notes: A, weight: 0 }, { notes: B, weight: 1 }], drums);
    expect(keys(out)).toEqual(keys(B));
  });

  it('gives the same answer whichever order the weights arrive in', () => {
    // The fold sorts by weight, so the caller's ordering must not change the
    // result -- a topology that happens to list its loops differently would
    // otherwise sound different for no reason.
    const one = blendLoops([{ notes: A, weight: 0.7 }, { notes: B, weight: 0.3 }], drums);
    const two = blendLoops([{ notes: B, weight: 0.3 }, { notes: A, weight: 0.7 }], drums);
    expect(keys(one)).toEqual(keys(two));
  });

  it('leans towards the heavier loop', () => {
    const heavyA = blendLoops([{ notes: A, weight: 0.95 }, { notes: B, weight: 0.05 }], drums);
    const heavyB = blendLoops([{ notes: A, weight: 0.05 }, { notes: B, weight: 0.95 }], drums);
    // A's exclusive hit is the snare on step 4; B's is the kick on step 8.
    expect(keys(heavyA)).toContain(key(hit(4, 38)));
    expect(keys(heavyB)).toContain(key(hit(8, 36)));
  });

  it('keeps what all four loops share when four are in play', () => {
    const loops = [
      { notes: [hit(0, 36), hit(2, 42)], weight: 0.25 },
      { notes: [hit(0, 36), hit(6, 42)], weight: 0.25 },
      { notes: [hit(0, 36), hit(9, 42)], weight: 0.25 },
      { notes: [hit(0, 36), hit(13, 42)], weight: 0.25 },
    ];
    expect(keys(blendLoops(loops, drums))).toContain(key(hit(0, 36)));
  });

  it('ignores a loop weighted at zero', () => {
    const withGhost = blendLoops(
      [{ notes: A, weight: 1 }, { notes: [hit(15, 99)], weight: 0 }], drums,
    );
    expect(keys(withGhost)).toEqual(keys(A));
  });

  it('returns nothing when handed nothing', () => {
    expect(blendLoops([], drums)).toEqual([]);
  });

  it('returns nothing when every weight is zero', () => {
    expect(blendLoops([{ notes: A, weight: 0 }, { notes: B, weight: 0 }], drums)).toEqual([]);
  });

  it('routes melodic material through the degree walk, so it stays in key', () => {
    const a = [hit(0, 45)];      // A2
    const b = [hit(0, 55)];      // G3 — both already in A minor
    for (let i = 0; i <= 10; i++) {
      const w = i / 10;
      const out = blendLoops([{ notes: a, weight: 1 - w }, { notes: b, weight: w }], melodic);
      for (const n of out) expect(inScale(n.midi, 9, 'minor')).toBe(true);
    }
  });

  it('leaves an out-of-key note alone at the extremes, on purpose', () => {
    // Around 4% of the library's melodic notes sit outside a minor scale, and
    // in acid those chromatics ARE the line. Snapping them would be vandalism,
    // so a loop that is the only thing sounding is handed back untouched.
    const chromatic = [hit(0, 58)];        // A#/Bb — not in A minor
    const out = blendLoops(
      [{ notes: chromatic, weight: 1 }, { notes: [hit(0, 45)], weight: 0 }], melodic,
    );
    expect(out[0].midi).toBe(58);
  });

  it('does not transpose percussion, because a drum note picks a voice', () => {
    const a = [hit(0, 36)];
    const b = [hit(0, 38)];
    const out = blendLoops([{ notes: a, weight: 0.5 }, { notes: b, weight: 0.5 }], drums);
    // Both survive as themselves; neither becomes some note in between.
    for (const n of out) expect([36, 38]).toContain(n.midi);
  });
});

describe('blendLoopsBySource', () => {
  it('a hit that belongs to one loop names that loop as its origin', () => {
    // The point of the exercise: this hit can then be played by that loop's own
    // instrument, instead of one timbre covering the lot.
    const out = blendLoopsBySource([
      { notes: [hit(0, 36)], weight: 1 },
      { notes: [hit(4, 38)], weight: 0 },
    ], drums);
    expect(out.map((n) => [n.midi, n.from])).toEqual([[36, 0]]);
  });

  it('carries the origin across a three-loop fold', () => {
    const out = blendLoopsBySource([
      { notes: [hit(0, 36)], weight: 0.5 },
      { notes: [hit(8, 38)], weight: 0.3 },
      { notes: [hit(4, 42)], weight: 0.2 },
    ], drums);
    expect(out.length).toBeGreaterThan(0);
    // The fold sorts by weight, so an index carried in a parallel array would
    // have come out re-aligned to the wrong notes.
    for (const n of out) expect([36, 38, 42][n.from]).toBe(n.midi);
  });

  it('emits a shared hit once, from one side', () => {
    const out = blendLoopsBySource([
      { notes: [hit(0, 36)], weight: 0.5 },
      { notes: [hit(0, 36)], weight: 0.5 },
    ], drums);
    expect(out).toHaveLength(1);
    expect(out[0].from).toBe(0);
  });

  it('every melodic note still names an origin, even at the pitch in between', () => {
    // A paired melodic note comes out at a pitch that is in NEITHER loop. There
    // is no honest owner, so it takes one by convention — but it must never come
    // back without one, or the router would have nowhere to send it.
    const a = [hit(0, 45), hit(4, 48)];
    const b = [hit(0, 52), hit(8, 55)];
    const out = blendLoopsBySource([{ notes: a, weight: 0.5 }, { notes: b, weight: 0.5 }], melodic);
    expect(out.length).toBeGreaterThan(0);
    for (const n of out) expect([0, 1]).toContain(n.from);
  });

  it('leaves the untagged fold exactly as it was', () => {
    // blendLoops is what the runtime already calls; an origin must not change it.
    const loops = [{ notes: [hit(0, 36)], weight: 1 }, { notes: [hit(4, 38)], weight: 0 }];
    expect(blendLoops(loops, drums)).toEqual([hit(0, 36)]);
  });
});
