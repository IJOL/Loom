import { describe, it, expect } from 'vitest';
import { abWeights, abAdvance, type AbState } from './topology-ab';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const POOL = [loop('p0'), loop('p1'), loop('p2'), loop('p3')];
const state = (x: number): AbState => ({ a: loop('a'), b: loop('b'), x });

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
    const next = abAdvance(state(0), 0.9, POOL, () => 0);
    expect(next.a.id).toBe('a');
    expect(next.b.id).toBe('b');
    expect(next.x).toBeCloseTo(0.9);
  });

  it('makes B the new A on arrival and draws a fresh B', () => {
    const next = abAdvance(state(0.9), 1, POOL, () => 2);
    expect(next.a.id).toBe('b');
    expect(next.b.id).toBe('p2');
    expect(next.x).toBe(0);
  });

  it('never draws the loop it just arrived at', () => {
    // The picker below always wants index 1. If the pool were not filtered
    // first, that would be p1 -- which is exactly the loop now sitting in A,
    // and the next leg would be a crossfade from a loop to itself.
    const s: AbState = { a: loop('a'), b: POOL[1], x: 0.99 };
    const next = abAdvance(s, 1, POOL, () => 1);
    expect(next.b.id).not.toBe(next.a.id);
  });

  it('survives a picker that answers out of range', () => {
    expect(abAdvance(state(1), 1, POOL, () => 99).b).toBeDefined();
    expect(abAdvance(state(1), 1, POOL, () => -5).b).toBeDefined();
  });

  it('keeps playing when the pool holds only the loop it arrived at', () => {
    const only = [loop('b')];
    const next = abAdvance(state(1), 1, only, () => 0);
    expect(next.a.id).toBe('b');
    expect(next.b.id).toBe('b');
  });

  it('carries the notes of each loop through to the weights', () => {
    const a: LoopRef = { id: 'a', notes: [{ start: 0, duration: 1, midi: 60, velocity: 90 }] };
    const b: LoopRef = { id: 'b', notes: [] };
    expect(abWeights({ a, b, x: 0 })[0].notes).toBe(a.notes);
  });
});
