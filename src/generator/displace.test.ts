import { describe, it, expect } from 'vitest';
import { displacement, clampWheel, DEFAULT_WHEEL, type WheelSpec } from './displace';
import { generateNotes } from './generate';
import { patternSteps, DEFAULT_GRID } from './grid';
import type { PoolNote } from './pool';

const wheel = (o: Partial<WheelSpec>): WheelSpec => clampWheel({ ...DEFAULT_WHEEL, ...o });
const OFF = { ...DEFAULT_WHEEL };

const at = (head: number, step: number, stepsPerBar = 4, patternSteps = 4) =>
  ({ head, step, stepsPerBar, patternSteps });

describe('the displacement wheels', () => {
  it('move nothing at their defaults', () => {
    for (let s = 0; s < 32; s++) {
      expect(displacement(OFF, OFF, at(s % 4, s))).toBe(0);
    }
  });

  it('treats a CYCLE of one as a wheel that is not turning', () => {
    // The same convention harmony/cycle uses for a period of 1, deliberately.
    const notTurning = wheel({ multiple: 16, cycle: 1, percent: 1 });
    for (let s = 0; s < 32; s++) {
      expect(displacement(notTurning, OFF, at(s % 4, s))).toBe(0);
    }
  });

  it('moves nothing at zero PERCENT, however big the other two are', () => {
    const faded = wheel({ multiple: 16, cycle: 32, percent: 0 });
    expect(displacement(faded, faded, at(0, 99))).toBe(0);
  });

  it('fades in with PERCENT rather than switching on', () => {
    const w = (percent: number) => wheel({ multiple: 8, cycle: 4, percent });
    const half = displacement(w(0.5), OFF, at(4, 4));
    const full = displacement(w(1), OFF, at(4, 4));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });

  it('comes back to nothing after a full turn of the wheel', () => {
    const w = wheel({ multiple: 3, cycle: 4, percent: 1 });
    // Bar mod turns once per bar: four bars of four steps.
    expect(displacement(w, OFF, at(16, 16))).toBe(displacement(w, OFF, at(0, 0)));
    expect(displacement(w, OFF, at(4, 4))).not.toBe(displacement(w, OFF, at(0, 0)));
  });

  it('turns BAR MOD once per bar and LOOP MOD once per lap', () => {
    // The whole reason there are two of them rather than one slower copy. A
    // FOUR-bar pattern, so the head has more than one bar to be in.
    const w = wheel({ multiple: 1, cycle: 8, percent: 1 });
    const four = (step: number) => at(step % 16, step, 4, 16);
    const bar = (step: number) => displacement(w, OFF, four(step));
    const loop = (step: number) => displacement(OFF, w, four(step));

    // A bar on: the BAR wheel has turned, the LOOP wheel has not.
    expect(bar(4)).toBeGreaterThan(bar(0));
    expect(loop(4)).toBe(loop(0));
    // A whole lap on: the head has folded back to bar 0 and the lap has not.
    expect(bar(16)).toBe(bar(0));
    expect(loop(16)).toBeGreaterThan(loop(0));
  });

  it('leaves BAR MOD with nothing to turn on a ONE-BAR pattern', () => {
    // Not a dead control, but worth pinning because the DEFAULT grid is one bar:
    // out of the box the three BAR knobs do nothing until BARS is raised. A
    // wheel that turns once per bar of the pattern has one turn to make when the
    // pattern is one bar, which is coherent rather than broken — and invisible
    // unless someone says so.
    const w = wheel({ multiple: 4, cycle: 8, percent: 1 });
    for (let s = 0; s < 32; s++) {
      expect(displacement(w, OFF, at(s % 4, s, 4, 4))).toBe(0);
    }
    // Raise the pattern to two bars and the same wheel moves.
    expect(displacement(w, OFF, at(4, 4, 4, 8))).toBeGreaterThan(0);
  });

  it('never displaces backwards for a step before the transport zero', () => {
    // The look-ahead genuinely asks for those, and a negative index would
    // displace further the further back you look.
    const w = wheel({ multiple: 4, cycle: 6, percent: 1 });
    for (let s = -20; s < 0; s++) {
      expect(displacement(w, w, at(0, s))).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps a stored wheel instead of trusting it', () => {
    expect(clampWheel({ multiple: 99, cycle: 99, percent: 5 }))
      .toEqual({ multiple: 16, cycle: 32, percent: 1 });
    expect(clampWheel({ multiple: 0, cycle: 0, percent: -1 }))
      .toEqual({ multiple: 1, cycle: 1, percent: 0 });
    expect(clampWheel(null)).toEqual(DEFAULT_WHEEL);
  });
});

describe('displacement through the generator', () => {
  const pool = (n: number): PoolNote[] =>
    Array.from({ length: n }, (_, i) => ({ midi: 60 + i, velocity: 100 }));

  const base = {
    grid: { ...DEFAULT_GRID },
    stepsPerBar: 4,
    ticksPerStep: 96,
    steps: 4,
    startStep: 0,
  };

  it('reaches the tail of a pool LONGER than the pattern', () => {
    // The gap stage 1 pinned by test and named this stage as the filler of. A
    // one-bar pattern over a seven-note pool can only ever hear four of them
    // until a wheel turns.
    const long = pool(7);
    const len = patternSteps(base.grid, base.stepsPerBar);
    expect(len).toBe(4);

    const heard = new Set<number>();
    const w = wheel({ multiple: 1, cycle: 8, percent: 1 });
    for (let lap = 0; lap < 8; lap++) {
      const notes = generateNotes({
        ...base, pool: long, loopMod: w, startStep: lap * base.steps,
      });
      for (const n of notes) heard.add(n.midi);
    }
    expect(heard.size).toBe(7);
  });

  it('hears only the pattern\'s worth with no wheel turning', () => {
    // The same eight laps, the same pool, both wheels off: the control is what
    // makes the difference, not the laps.
    const heard = new Set<number>();
    for (let lap = 0; lap < 8; lap++) {
      const notes = generateNotes({ ...base, pool: pool(7), startStep: lap * base.steps });
      for (const n of notes) heard.add(n.midi);
    }
    expect(heard.size).toBe(4);
  });

  it('leaves the RHYTHM alone while the material moves', () => {
    // The stage-6 decision: displacement moves what is played, not when. Karst
    // puts it before all four streams, which would move the phrase with the
    // material and stop the opening bar being the opening.
    const cadence = { amount: 0.5, pattern: 0.618, mod: 0, phrase: 1 };
    // A displacement that is a MULTIPLE of the pool length is the identity on
    // the pool — 9 steps over 9 notes lands back where it started. Chosen so it
    // is not: two steps over nine notes.
    const w = wheel({ multiple: 2, cycle: 5, percent: 1 });
    const plain = generateNotes({ ...base, pool: pool(9), cadence });
    const moved = generateNotes({ ...base, pool: pool(9), cadence, loopMod: w, startStep: 12 });
    expect(moved.map((n) => n.start)).toEqual(plain.map((n) => n.start));
    expect(moved.map((n) => n.midi)).not.toEqual(plain.map((n) => n.midi));
  });

  it('still answers the same lap the same way, every time', () => {
    const w = wheel({ multiple: 5, cycle: 7, percent: 0.75 });
    const once = generateNotes({ ...base, pool: pool(11), loopMod: w, barMod: w, startStep: 40 });
    const twice = generateNotes({ ...base, pool: pool(11), loopMod: w, barMod: w, startStep: 40 });
    expect(twice).toEqual(once);
  });
});
