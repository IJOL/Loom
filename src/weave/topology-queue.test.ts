import { describe, it, expect } from 'vitest';
import { queueWeights, type QueueState } from './topology-queue';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const FOUR = [loop('l0'), loop('l1'), loop('l2'), loop('l3')];
const S = (x: number): QueueState => ({ loops: FOUR, x });
const live = (x: number) => queueWeights(S(x)).filter((e) => e.weight > 0);
const sum = (x: number) => queueWeights(S(x)).reduce((s, e) => s + e.weight, 0);

describe('queue topology', () => {
  it('is entirely the first loop at x=0', () => {
    const w = live(0);
    expect(w).toHaveLength(1);
    expect(w[0].weight).toBeCloseTo(1);
    expect(queueWeights(S(0))[0].weight).toBeCloseTo(1);
  });

  it('is entirely the last loop at x=1', () => {
    const w = live(1);
    expect(w).toHaveLength(1);
    expect(w[0].weight).toBeCloseTo(1);
    expect(queueWeights(S(1))[3].weight).toBeCloseTo(1);
  });

  it('only ever mixes two neighbours', () => {
    for (let i = 0; i <= 30; i++) {
      expect(live(i / 30).length).toBeLessThanOrEqual(2);
    }
  });

  it('mixes the two the cursor actually sits between', () => {
    // Four loops span three gaps, so x=0.5 puts the cursor at position 1.5 --
    // halfway between l1 and l2, with l0 and l3 silent.
    const [w0, w1, w2, w3] = queueWeights(S(0.5)).map((e) => e.weight);
    expect(w0).toBe(0);
    expect(w1).toBeCloseTo(0.5);
    expect(w2).toBeCloseTo(0.5);
    expect(w3).toBe(0);
  });

  it('sits entirely on a loop when the cursor lands exactly on it', () => {
    // Position 1.0 of 0..3 -- on l1, not between anything.
    const [w0, w1, w2, w3] = queueWeights(S(1 / 3)).map((e) => e.weight);
    expect(w0).toBe(0);
    expect(w1).toBeCloseTo(1);
    expect(w2).toBeCloseTo(0);
    expect(w3).toBe(0);
  });

  it('always sums to one', () => {
    for (let i = 0; i <= 30; i++) expect(sum(i / 30)).toBeCloseTo(1);
  });

  it('returns one entry per loop, so the caller can index them', () => {
    expect(queueWeights(S(0.4))).toHaveLength(FOUR.length);
  });

  it('walks forward as the cursor advances', () => {
    // The weight on the last loop only ever grows.
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const w = queueWeights(S(i / 20))[3].weight;
      if (i > 15) {
        expect(w).toBeGreaterThanOrEqual(prev);
        prev = w;
      }
    }
  });

  it('clamps a cursor outside 0..1 instead of running off the list', () => {
    expect(sum(1.7)).toBeCloseTo(1);
    expect(sum(-0.4)).toBeCloseTo(1);
    expect(queueWeights(S(1.7))[3].weight).toBeCloseTo(1);
  });

  it('handles a queue of one without dividing by zero', () => {
    const w = queueWeights({ loops: [loop('only')], x: 0.7 });
    expect(w).toHaveLength(1);
    expect(w[0].weight).toBeCloseTo(1);
  });

  it('returns nothing for an empty queue', () => {
    expect(queueWeights({ loops: [], x: 0.5 })).toEqual([]);
  });
});
