// A crossfade position that is not a number.
//
// The panel is a plugin, so its numbers are DATA the host receives — and this
// one was checked nowhere. Every clamp in this directory is
// `Math.min(1, Math.max(0, v))` or the ternary form, and both hand NaN back
// unchanged, so it travels the whole way in.
//
// What it does at the far end was MEASURED rather than assumed, and it is not
// what it looked like: the weights come out NaN, `blendLoops` keeps only a loop
// weighted above 0.005, NaN never is, and both are dropped. The lane plays
// nothing. A silent lane with every light on screen still right, and nothing
// anywhere saying why.
import { describe, it, expect } from 'vitest';
import { finitePosition } from './weave-state';
import { blendLoops } from './blend-clip';
import { abWeights } from './topology-ab';
import type { NoteEvent } from '../core/notes';

const TICKS_PER_BAR = 384;

const line = (midi: number): NoteEvent[] =>
  [0, 96, 192, 288].map((start) => ({ start, duration: 90, midi, velocity: 90 }));

describe('finitePosition', () => {
  it('accepts a real position, with or without a second axis', () => {
    expect(finitePosition({ x: 0 })).toBe(true);
    expect(finitePosition({ x: 0.37 })).toBe(true);
    expect(finitePosition({ x: 0.5, y: 0.5 })).toBe(true);
    expect(finitePosition({})).toBe(true);
  });

  it('refuses one that is not a number, on either axis', () => {
    expect(finitePosition({ x: NaN })).toBe(false);
    expect(finitePosition({ x: Infinity })).toBe(false);
    expect(finitePosition({ x: 0.5, y: NaN })).toBe(false);
  });
});

describe('what a non-finite position does downstream', () => {
  // What it actually does, measured rather than assumed: `clamp01` hands NaN
  // back, both weights come out NaN, and `blendLoops` drops a loop whose weight
  // is not above 0.005 — which NaN never is. Both loops are dropped and the
  // lane plays NOTHING.
  //
  // Silence, not noise. Worth pinning precisely because it is the quiet
  // failure: a lane that stops playing with every light on screen still right,
  // and no error anywhere to say why.
  const ab = (x: number) =>
    abWeights({ a: { id: 'clip:a', notes: line(48) }, b: { id: 'clip:b', notes: line(55) }, x });

  it('a NaN position weights both loops NaN, and the lane falls silent', () => {
    const w = ab(NaN);
    expect(w.every((l) => Number.isNaN(l.weight))).toBe(true);
    const notes = blendLoops(w, { key: 0, scale: 'minor', barTicks: TICKS_PER_BAR, melodic: true, octaveBase: 48 });
    expect(notes).toEqual([]);
  });

  it('a real position plays', () => {
    const notes = blendLoops(ab(0.5), { key: 0, scale: 'minor', barTicks: TICKS_PER_BAR, melodic: true, octaveBase: 48 });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => Number.isFinite(n.duration))).toBe(true);
  });
});
