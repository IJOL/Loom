// The one owner of "how long is a clip's automation envelope". Every assertion
// here is relative: a ratio between two calls, or one call compared against the
// period lane-scheduler.ts loops the clip on. No magic lengths.
import { describe, it, expect } from 'vitest';
import {
  envelopeStepCount, envelopeValueLength, envelopeValueLengthFromBarTicks, envelopeSubIndex,
} from './clip-envelope-length';
import { DEFAULT_METER, ticksPerBar, type TimeSignature } from './meter';
import { AUTOMATION_SUB_RES } from './pattern';
import { TICKS_PER_STEP } from './notes';

const THREE_FOUR: TimeSignature = { num: 3, den: 4 };
const SEVEN_EIGHT: TimeSignature = { num: 7, den: 8 };

describe('envelopeStepCount', () => {
  it('tracks the meter: a 3/4 bar is three quarters of a 4/4 bar', () => {
    expect(envelopeStepCount(4, THREE_FOUR) / envelopeStepCount(4, DEFAULT_METER))
      .toBeCloseTo(THREE_FOUR.num / DEFAULT_METER.num, 10);
  });

  it('scales with the clip length at a fixed meter', () => {
    expect(envelopeStepCount(4, SEVEN_EIGHT) / envelopeStepCount(1, SEVEN_EIGHT)).toBeCloseTo(4, 10);
  });

  it('reads an absent meter as the session default', () => {
    expect(envelopeStepCount(2)).toBe(envelopeStepCount(2, DEFAULT_METER));
  });

  it('never returns an empty envelope for a degenerate clip length', () => {
    expect(envelopeStepCount(0, THREE_FOUR)).toBeGreaterThan(0);
  });
});

describe('envelopeValueLength', () => {
  it('is the step count times the sub-resolution, in every meter', () => {
    for (const m of [DEFAULT_METER, THREE_FOUR, SEVEN_EIGHT]) {
      expect(envelopeValueLength(3, m) / envelopeStepCount(3, m)).toBe(AUTOMATION_SUB_RES);
    }
  });

  it('shrinks with the meter exactly as the step count does', () => {
    expect(envelopeValueLength(2, THREE_FOUR) / envelopeValueLength(2, DEFAULT_METER))
      .toBeCloseTo(envelopeStepCount(2, THREE_FOUR) / envelopeStepCount(2, DEFAULT_METER), 10);
  });
});

describe('envelopeValueLengthFromBarTicks', () => {
  it('agrees with the meter-based length when handed that meter’s bar', () => {
    for (const m of [DEFAULT_METER, THREE_FOUR, SEVEN_EIGHT]) {
      expect(envelopeValueLengthFromBarTicks(3, ticksPerBar(m))).toBe(envelopeValueLength(3, m));
    }
  });
});

describe('envelopeSubIndex', () => {
  const bpm = 120;
  const stepDur = 60 / bpm / 4;
  /** The period lane-scheduler.ts loops the clip on, in seconds. */
  const clipLapSec = (lengthBars: number, m: TimeSignature) =>
    ((lengthBars * ticksPerBar(m)) / TICKS_PER_STEP) * stepDur;

  it('starts at the top of the envelope', () => {
    expect(envelopeSubIndex(0, bpm, 4, THREE_FOUR)).toBe(0);
  });

  it('returns to the top after exactly one clip lap, in a non-4/4 meter', () => {
    // The key property of this concern: the envelope's loop period IS the clip's.
    for (const m of [DEFAULT_METER, THREE_FOUR, SEVEN_EIGHT]) {
      const lap = clipLapSec(4, m);
      expect(envelopeSubIndex(lap, bpm, 4, m)).toBe(envelopeSubIndex(0, bpm, 4, m));
      // and it is not trivially constant on the way there
      expect(envelopeSubIndex(lap / 2, bpm, 4, m)).toBeGreaterThan(envelopeSubIndex(0, bpm, 4, m));
    }
  });

  it('advances monotonically inside a lap and stays inside the array', () => {
    const m = THREE_FOUR;
    const lap = clipLapSec(2, m);
    const len = envelopeValueLength(2, m);
    let prev = -1;
    for (let i = 0; i < 32; i++) {
      const idx = envelopeSubIndex((lap * i) / 32, bpm, 2, m);
      expect(idx).toBeGreaterThan(prev);
      expect(idx).toBeLessThan(len);
      prev = idx;
    }
  });

  it('covers a whole lap: the last sub-step of the lap is the last slot', () => {
    const m = THREE_FOUR;
    const len = envelopeValueLength(3, m);
    const lap = clipLapSec(3, m);
    // Sampled in the middle of the final sub-step, so the assertion does not
    // rest on where a float lands exactly on the boundary.
    expect(envelopeSubIndex(lap * ((len - 0.5) / len), bpm, 3, m)).toBe(len - 1);
  });
});
