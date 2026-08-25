import { describe, it, expect } from 'vitest';
import {
  offsetTicks, lengthTicks, clampOffset, clampLength,
  DEFAULT_OFFSET, DEFAULT_LENGTH,
} from './note-timing';
import { generateNotes } from './generate';
import { DEFAULT_GRID } from './grid';
import type { PoolNote } from './pool';

const STEP = 96;
const pool = (...midi: number[]): PoolNote[] => midi.map((m) => ({ midi: m, velocity: 100 }));

describe('OFFSET — where exactly the hit lands', () => {
  it('lands dead on the step at its default', () => {
    // The whole of stages 1 to 4 describes the un-nudged behaviour. A default
    // that re-timed them would have made every one of those tests a fresh
    // judgement call rather than a check.
    for (let h = 0; h < 16; h++) expect(offsetTicks(DEFAULT_OFFSET, h, STEP)).toBe(0);
  });

  it('moves every hit the same way with no MOD — early or late, not swung', () => {
    const late = clampOffset({ amount: 0.5, mod: 0 });
    const vals = [0, 1, 2, 3].map((h) => offsetTicks(late, h, STEP));
    expect(new Set(vals).size).toBe(1);
    expect(vals[0]).toBe(STEP / 2);
  });

  it('scatters the hits once MOD is open — that is what makes it a groove', () => {
    const groove = clampOffset({ amount: 0, mod: 1 });
    const vals = [0, 1, 2, 3, 4, 5].map((h) => offsetTicks(groove, h, STEP));
    expect(new Set(vals).size).toBeGreaterThan(1);
  });

  it('never moves a hit further than one step, however the two stack', () => {
    // Amount at the stop AND mod at full would otherwise reach two steps, which
    // changes which BEAT a hit is on — CADENCE's job, done badly.
    const both = clampOffset({ amount: 1, mod: 1 });
    for (let h = 0; h < 64; h++) {
      expect(Math.abs(offsetTicks(both, h, STEP))).toBeLessThanOrEqual(STEP);
    }
  });

  it('means the same thing at every division', () => {
    // Fractions of a step, not ticks: moving DIV must not rescale the groove.
    const s = clampOffset({ amount: 0.25, mod: 0 });
    expect(offsetTicks(s, 0, 96) / 96).toBeCloseTo(offsetTicks(s, 0, 24) / 24);
  });
});

describe('LENGTH — how long it holds', () => {
  it('fills exactly one step at its default', () => {
    for (let h = 0; h < 16; h++) expect(lengthTicks(DEFAULT_LENGTH, h, STEP)).toBe(STEP);
  });

  it('detaches below one and overlaps above it', () => {
    expect(lengthTicks(clampLength({ length: 0.25 }), 0, STEP)).toBeLessThan(STEP);
    expect(lengthTicks(clampLength({ length: 2 }), 0, STEP)).toBeGreaterThan(STEP);
  });

  it('never produces a note of no length', () => {
    // A zero-length note never gates on: silence wearing the shape of a hit.
    for (const l of [0, -5, 0.0001]) {
      expect(lengthTicks(clampLength({ length: l }), 0, 4)).toBeGreaterThan(0);
    }
  });

  it('varies note by note once MOD is open', () => {
    const s = clampLength({ length: 1, mod: 1 });
    const vals = [0, 1, 2, 3, 4, 5].map((h) => lengthTicks(s, h, STEP));
    expect(new Set(vals).size).toBeGreaterThan(1);
  });

  it('clamps a stored spec instead of trusting it', () => {
    expect(clampLength({ length: 99, mod: 5 })).toMatchObject({ length: 4, mod: 1 });
    expect(clampOffset({ amount: -9, mod: -1 })).toMatchObject({ amount: -1, mod: 0 });
    expect(clampOffset(null)).toEqual(DEFAULT_OFFSET);
    expect(clampLength(null)).toEqual(DEFAULT_LENGTH);
  });
});

describe('the two of them through the generator', () => {
  const base = {
    pool: pool(60, 62, 64),
    grid: { ...DEFAULT_GRID },
    stepsPerBar: 4,
    ticksPerStep: STEP,
    steps: 4,
    startStep: 0,
  };

  it('keeps every note INSIDE the iteration however it is nudged', () => {
    // A hit nudged early off step 0 starts before the loop and one nudged late
    // off the last step starts after its end. The scheduler drops both, so the
    // groove would silently lose its first and last note rather than swing them.
    for (const amount of [-1, -0.5, 0.5, 1]) {
      const notes = generateNotes({ ...base, offset: clampOffset({ amount }) });
      expect(notes).toHaveLength(4);
      for (const n of notes) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start).toBeLessThan(base.steps * STEP);
      }
    }
  });

  it('lets a note run PAST the iteration, because that is what slides', () => {
    // Trimming to the loop here would quietly remove the generator's portamento
    // on every engine that infers slide from an overlap.
    const notes = generateNotes({ ...base, length: clampLength({ length: 3 }) });
    const last = notes[notes.length - 1];
    expect(last.start + last.duration).toBeGreaterThan(base.steps * STEP);
  });

  it('makes consecutive notes overlap above one, and not below', () => {
    const overlaps = (length: number) => {
      const n = generateNotes({ ...base, length: clampLength({ length }) });
      return n[0].start + n[0].duration > n[1].start;
    };
    expect(overlaps(2)).toBe(true);
    expect(overlaps(0.5)).toBe(false);
  });

  it('changes nothing at all when both are left alone', () => {
    const plain = generateNotes(base);
    const explicit = generateNotes({
      ...base, offset: { ...DEFAULT_OFFSET }, length: { ...DEFAULT_LENGTH },
    });
    expect(explicit).toEqual(plain);
  });
});
