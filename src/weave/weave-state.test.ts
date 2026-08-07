import { describe, it, expect } from 'vitest';
import { defaultWeaveState, laneWeights, type LaneWeaveConfig } from './weave-state';
import { WEAVE_MACROS } from './weave-catalog';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const cfg = (weave: LaneWeaveConfig['weave']): LaneWeaveConfig =>
  ({ weave, locked: false, harmonyLeader: false });

describe('weave state', () => {
  it('starts with no lanes', () => {
    expect(Object.keys(defaultWeaveState().lanes)).toHaveLength(0);
  });

  it('starts with every macro at its own neutral', () => {
    const s = defaultWeaveState();
    for (const m of WEAVE_MACROS) expect(s.macros[m.id]).toBeCloseTo(m.neutral);
  });

  it('gives a fresh state a seed, so the style draw is reproducible', () => {
    expect(Number.isFinite(defaultWeaveState().seed)).toBe(true);
  });

  it('hands back a state nobody else shares', () => {
    // Module-level state handed out by reference is how one session's edits
    // leak into the next one.
    const a = defaultWeaveState();
    const b = defaultWeaveState();
    a.macros.density = 0.1;
    expect(b.macros.density).toBeCloseTo(0.5);
  });
});

describe('laneWeights', () => {
  it('routes an ab lane to the ab weights', () => {
    const w = laneWeights(cfg({ kind: 'ab', state: { a: loop('a'), b: loop('b'), x: 0.25 } }));
    expect(w).toHaveLength(2);
    expect(w[0].weight).toBeCloseTo(0.75);
  });

  it('routes a queue lane to the queue weights', () => {
    const w = laneWeights(cfg({
      kind: 'queue', state: { loops: [loop('a'), loop('b'), loop('c')], x: 0 },
    }));
    expect(w).toHaveLength(3);
    expect(w.filter((e) => e.weight > 0)).toHaveLength(1);
  });

  it('routes a cloud lane to four weights', () => {
    const w = laneWeights(cfg({
      kind: 'cloud',
      state: { corners: [loop('a'), loop('b'), loop('c'), loop('d')], x: 0.3, y: 0.7 },
    }));
    expect(w).toHaveLength(4);
  });

  it('always returns weights that sum to one, whichever topology', () => {
    const all: Array<LaneWeaveConfig['weave']> = [
      { kind: 'ab', state: { a: loop('a'), b: loop('b'), x: 0.4 } },
      { kind: 'queue', state: { loops: [loop('a'), loop('b'), loop('c')], x: 0.6 } },
      { kind: 'cloud', state: { corners: [loop('a'), loop('b'), loop('c'), loop('d')], x: 0.3, y: 0.7 } },
    ];
    for (const weave of all) {
      const sum = laneWeights(cfg(weave)).reduce((s, e) => s + e.weight, 0);
      expect(sum).toBeCloseTo(1);
    }
  });

  it('does not care whether the lane is locked — that is the caller’s job', () => {
    // The lock freezes what ADVANCES the position, not what the position
    // currently means. Reading it here would make a locked lane silent.
    const frozen: LaneWeaveConfig = {
      weave: { kind: 'ab', state: { a: loop('a'), b: loop('b'), x: 0.25 } },
      locked: true, harmonyLeader: false,
    };
    expect(laneWeights(frozen)[0].weight).toBeCloseTo(0.75);
  });
});
