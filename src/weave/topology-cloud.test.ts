import { describe, it, expect } from 'vitest';
import { cloudWeights, type CloudState } from './topology-cloud';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const CORNERS: [LoopRef, LoopRef, LoopRef, LoopRef] =
  [loop('tl'), loop('tr'), loop('bl'), loop('br')];
const S = (x: number, y: number): CloudState => ({ corners: CORNERS, x, y });
const w = (x: number, y: number) => cloudWeights(S(x, y)).map((e) => e.weight);

describe('cloud topology', () => {
  it('is entirely the top-left corner at (0,0)', () => {
    expect(w(0, 0)).toEqual([1, 0, 0, 0]);
  });

  it('is entirely the top-right corner at (1,0)', () => {
    expect(w(1, 0)).toEqual([0, 1, 0, 0]);
  });

  it('is entirely the bottom-left corner at (0,1)', () => {
    expect(w(0, 1)).toEqual([0, 0, 1, 0]);
  });

  it('is entirely the bottom-right corner at (1,1)', () => {
    expect(w(1, 1)).toEqual([0, 0, 0, 1]);
  });

  it('splits evenly in the centre', () => {
    for (const e of w(0.5, 0.5)) expect(e).toBeCloseTo(0.25);
  });

  it('splits between two corners on an edge, ignoring the far side', () => {
    const [tl, tr, bl, br] = w(0.5, 0);
    expect(tl).toBeCloseTo(0.5);
    expect(tr).toBeCloseTo(0.5);
    expect(bl).toBe(0);
    expect(br).toBe(0);
  });

  it('always sums to one', () => {
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        expect(w(i / 8, j / 8).reduce((s, e) => s + e, 0)).toBeCloseTo(1);
      }
    }
  });

  it('leans towards the corner the dot is nearest', () => {
    const [tl, , , br] = w(0.1, 0.1);
    expect(tl).toBeGreaterThan(br);
  });

  it('clamps a position outside the box instead of weighting past a corner', () => {
    const out = w(1.4, -0.3);
    expect(out.every((e) => e >= 0 && e <= 1)).toBe(true);
    expect(out[1]).toBeCloseTo(1);          // top-right
    expect(out.reduce((s, e) => s + e, 0)).toBeCloseTo(1);
  });

  it('returns one entry per corner, in corner order', () => {
    const entries = cloudWeights(S(0.3, 0.7));
    expect(entries).toHaveLength(4);
    expect(entries[0].notes).toBe(CORNERS[0].notes);
    expect(entries[3].notes).toBe(CORNERS[3].notes);
  });
});
