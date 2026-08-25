import { describe, it, expect } from 'vitest';
import { generateNotes } from './generate';
import { patternSteps } from './grid';
import type { PoolNote } from './pool';

const pool = (...midi: number[]): PoolNote[] => midi.map((m) => ({ midi: m, velocity: 100 }));

const BASE = {
  grid: { repeats: 1, div: 4, pow2: 0 },
  stepsPerBar: 4,
  ticksPerStep: 96,
  steps: 4,
  startStep: 0,
};

describe('the read head over a pool', () => {
  it('fires once per step, filling the iteration', () => {
    const out = generateNotes({ ...BASE, pool: pool(60, 62, 64, 65) });
    expect(out).toHaveLength(4);
    expect(out.map((n) => n.start)).toEqual([0, 96, 192, 288]);
  });

  it('says nothing at all when the material resolves to nothing', () => {
    // Silence rather than a default pitch: a generator with no material has
    // nothing to say, and a drone would be a lie about that.
    expect(generateNotes({ ...BASE, pool: [] })).toEqual([]);
  });

  it('starts every note inside the iteration, never at an absolute tick', () => {
    const out = generateNotes({ ...BASE, pool: pool(60), startStep: 400 });
    const span = BASE.steps * BASE.ticksPerStep;
    for (const n of out) expect(n.start).toBeLessThan(span);
  });

  it('takes the material dynamics rather than inventing one', () => {
    const out = generateNotes({
      ...BASE, steps: 2, pool: [{ midi: 60, velocity: 30 }, { midi: 62, velocity: 120 }],
    });
    expect(out[1].velocity).toBeGreaterThan(out[0].velocity * 2);
  });

  it('repeats on the PATTERN, whatever length the pool happens to be', () => {
    // The pattern governs, and nothing else does yet. Reaching the tail of a
    // long pool is what displacement is for (stage 6) — asserting a co-prime
    // cycle here would be asserting a second modulus this does not have.
    const grid = { repeats: 1, div: 4, pow2: 0 };
    const len = patternSteps(grid, 4);
    const out = generateNotes({
      ...BASE, grid, pool: pool(60, 64, 67), steps: len * 3, startStep: 0,
    });
    const midi = out.map((n) => n.midi);
    expect(midi.slice(len, len * 2)).toEqual(midi.slice(0, len));
  });

  it('leaves a pool longer than the pattern with a tail nobody hears', () => {
    // Stated as a fact rather than hidden: it is the gap stage 6 fills, and a
    // reader finding it by ear later would read it as a bug.
    const grid = { repeats: 1, div: 4, pow2: 0 };
    const len = patternSteps(grid, 4);
    const long = pool(60, 62, 64, 65, 67, 69, 71);
    const out = generateNotes({ ...BASE, grid, pool: long, steps: len * 2 });
    expect(new Set(out.map((n) => n.midi)).size).toBe(len);
    expect(out.some((n) => n.midi === 71)).toBe(false);
  });

  it('renders bar 5 the same whether it was played into or jumped to', () => {
    // The determinism the offline export depends on. Not optional.
    const p = pool(60, 62, 64, 65, 67);
    const grid = { repeats: 2, div: 4, pow2: 1 };
    const long = generateNotes({ ...BASE, grid, pool: p, steps: 32, startStep: 0 });
    const jumped = generateNotes({ ...BASE, grid, pool: p, steps: 4, startStep: 20 });
    expect(jumped.map((n) => n.midi)).toEqual(long.slice(20, 24).map((n) => n.midi));
  });

  it('refuses a step of no length instead of writing NaN starts', () => {
    expect(generateNotes({ ...BASE, pool: pool(60), ticksPerStep: 0 })).toEqual([]);
  });
});
