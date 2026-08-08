import { describe, it, expect } from 'vitest';
import { abWeights, abAdvance, type AbState } from './topology-ab';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const state = (x: number): AbState => ({ a: loop('a'), b: loop('b'), x });

// The re-hook works on what a lane STORES — a pair of ids — while the weights
// work on what a lane PLAYS: the same pair resolved to notes. Two fixtures
// because they are genuinely two layers, and the mismatch between them is what
// left abAdvance with a test and no caller for so long.
const IDS = ['p0', 'p1', 'p2', 'p3'];
const leg = (x: number) => ({ a: 'a', b: 'b', x });

describe('A to B with re-hook', () => {
  it('weights only A at x=0', () => {
    expect(abWeights(state(0)).map((e) => e.weight)).toEqual([1, 0]);
  });

  it('weights only B at x=1', () => {
    expect(abWeights(state(1)).map((e) => e.weight)).toEqual([0, 1]);
  });

  it('splits the weight in the middle', () => {
    const w = abWeights(state(0.5));
    expect(w[0].weight).toBeCloseTo(0.5);
    expect(w[1].weight).toBeCloseTo(0.5);
  });

  it('always sums to one', () => {
    for (let i = 0; i <= 10; i++) {
      const sum = abWeights(state(i / 10)).reduce((s, e) => s + e.weight, 0);
      expect(sum).toBeCloseTo(1);
    }
  });

  it('clamps a position outside 0..1 rather than weighting past a loop', () => {
    expect(abWeights(state(1.4)).map((e) => e.weight)).toEqual([0, 1]);
    expect(abWeights(state(-0.3)).map((e) => e.weight)).toEqual([1, 0]);
  });

  it('does not re-hook before the journey ends', () => {
    const next = abAdvance(leg(0), 0.9, IDS, () => 0);
    expect(next.a).toBe('a');
    expect(next.b).toBe('b');
    expect(next.x).toBeCloseTo(0.9);
  });

  it('makes B the new A on arrival and draws a fresh B', () => {
    const next = abAdvance(leg(0.9), 1, IDS, () => 2);
    expect(next.a).toBe('b');
    expect(next.b).toBe('p2');
    expect(next.x).toBe(0);
  });

  it('never draws the loop it just arrived at', () => {
    // The picker below always wants index 1. If the pool were not filtered
    // first, that would be p1 -- which is exactly the loop now sitting in A,
    // and the next leg would be a crossfade from a loop to itself.
    const next = abAdvance({ a: 'a', b: IDS[1], x: 0.99 }, 1, IDS, () => 1);
    expect(next.b).not.toBe(next.a);
  });

  it('survives a picker that answers out of range', () => {
    expect(abAdvance(leg(1), 1, IDS, () => 99).b).toBeDefined();
    expect(abAdvance(leg(1), 1, IDS, () => -5).b).toBeDefined();
  });

  it('keeps playing when the pool holds only the loop it arrived at', () => {
    const next = abAdvance(leg(1), 1, ['b'], () => 0);
    expect(next.a).toBe('b');
    expect(next.b).toBe('b');
  });

  it('carries whatever else the stored selection holds', () => {
    // It advances a SELECTION, not just a pair: `kind` and anything a later
    // version adds must survive the re-hook, or a lane would come back from a
    // lap having forgotten what topology it was on.
    const next = abAdvance({ kind: 'ab' as const, a: 'a', b: 'b', x: 1 }, 1, IDS, () => 0);
    expect(next.kind).toBe('ab');
  });

  it('carries the notes of each loop through to the weights', () => {
    const a: LoopRef = { id: 'a', notes: [{ start: 0, duration: 1, midi: 60, velocity: 90 }] };
    const b: LoopRef = { id: 'b', notes: [] };
    expect(abWeights({ a, b, x: 0 })[0].notes).toBe(a.notes);
  });
});
