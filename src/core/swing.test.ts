import { describe, it, expect } from 'vitest';
import { swungTick, swungSpan, clampSwing, SWING_MAX } from './swing';
import { TICKS_PER_STEP } from './notes';

const PAIR = TICKS_PER_STEP * 2;   // one 8th note = the on-beat/off-beat pair

/** Where the off-beat sits inside its pair, as a fraction (0.5 = straight).
 *  This is the MPC "swing %" reading of a given swing amount. */
const pairFraction = (swing: number) => swungTick(TICKS_PER_STEP, swing) / PAIR;

describe('swungTick — straight is the identity', () => {
  it('swing 0 returns every tick unchanged, exactly', () => {
    // The whole feature rests on this: swing 0 must not perturb a single note
    // of any existing pattern, so assert exact equality, not closeness.
    for (let t = 0; t <= PAIR * 4; t++) expect(swungTick(t, 0)).toBe(t);
  });

  it('swing 0 leaves a note duration untouched, exactly', () => {
    for (let d = 1; d <= PAIR * 2; d++) expect(swungSpan(0, d, 0)).toBe(d);
    expect(swungSpan(TICKS_PER_STEP, TICKS_PER_STEP, 0)).toBe(TICKS_PER_STEP);
  });
});

describe('swungTick — the off-beat 16ths are what move', () => {
  it('delays the off-beat 16th by swing × one step', () => {
    expect(swungTick(TICKS_PER_STEP, 0.5)).toBe(TICKS_PER_STEP * 1.5);
    expect(swungTick(TICKS_PER_STEP, 0.25)).toBe(TICKS_PER_STEP * 1.25);
  });

  it('never moves an on-beat 16th, at any swing', () => {
    for (const swing of [0, 0.1, 1 / 3, 0.5, SWING_MAX]) {
      for (const onBeat of [0, PAIR, PAIR * 2, PAIR * 8]) {
        expect(swungTick(onBeat, swing)).toBe(onBeat);
      }
    }
  });

  it('delays the off-beat further as swing rises', () => {
    const times = [0, 0.2, 0.4, SWING_MAX].map((s) => swungTick(TICKS_PER_STEP, s));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('swing 1/3 is the classic triplet shuffle: the off-beat sits 2/3 of the way', () => {
    expect(pairFraction(1 / 3)).toBeCloseTo(2 / 3, 10);
  });

  it('swing 0.5 matches mpump\'s "heavy shuffle" (its 0.75 = 75% of the way)', () => {
    expect(pairFraction(0.5)).toBeCloseTo(0.75, 10);
  });

  it('the off-beat always stays strictly between its own on-beat and the next', () => {
    for (const swing of [0.1, 1 / 3, 0.5, SWING_MAX]) {
      const f = pairFraction(swing);
      expect(f).toBeGreaterThan(0.5);
      expect(f).toBeLessThan(1);
    }
  });
});

describe('swungTick — the warp is order-preserving', () => {
  it('keeps every tick in a pair strictly increasing (off-grid notes never reorder)', () => {
    for (const swing of [0.1, 1 / 3, 0.5, SWING_MAX]) {
      for (let t = 1; t <= PAIR * 2; t++) {
        expect(swungTick(t, swing)).toBeGreaterThan(swungTick(t - 1, swing));
      }
    }
  });

  it('an off-grid note between two 16ths lands between their swung times', () => {
    const swing = 0.5;
    const between = TICKS_PER_STEP / 2;  // a 32nd, before the off-beat
    expect(swungTick(between, swing)).toBeGreaterThan(swungTick(0, swing));
    expect(swungTick(between, swing)).toBeLessThan(swungTick(TICKS_PER_STEP, swing));
  });

  it('clamps beyond the ceiling, so a bad saved value cannot reorder notes', () => {
    expect(clampSwing(99)).toBe(SWING_MAX);
    expect(clampSwing(-1)).toBe(0);
    expect(swungTick(TICKS_PER_STEP, 99)).toBe(swungTick(TICKS_PER_STEP, SWING_MAX));
  });
});

describe('swungSpan — gates travel with the note', () => {
  it('a TB-303 slide gate still overlaps the next (delayed) trigger, at every swing', () => {
    // bassStepsToNotes gives a sliding step 1.5 × step ticks so its gate holds
    // past the next trigger. Both ends warp, so the overlap survives.
    const slideDur = Math.floor(TICKS_PER_STEP * 1.5);
    for (const swing of [0, 0.1, 1 / 3, 0.5, SWING_MAX]) {
      const gateEnd = swungSpan(0, slideDur, swing);
      const nextTrigger = swungTick(TICKS_PER_STEP, swing);
      expect(gateEnd).toBeGreaterThan(nextTrigger);
    }
  });

  it('shortens the off-beat note that runs into the next on-beat (the long-short of shuffle)', () => {
    const straight = swungSpan(TICKS_PER_STEP, TICKS_PER_STEP, 0);
    const swung = swungSpan(TICKS_PER_STEP, TICKS_PER_STEP, 0.5);
    expect(swung).toBeLessThan(straight);
  });

  it('lengthens the on-beat note that runs into the off-beat', () => {
    const straight = swungSpan(0, TICKS_PER_STEP, 0);
    const swung = swungSpan(0, TICKS_PER_STEP, 0.5);
    expect(swung).toBeGreaterThan(straight);
  });

  it('leaves a note spanning whole pairs at its original length', () => {
    for (const swing of [0.1, 0.5, SWING_MAX]) {
      expect(swungSpan(0, PAIR * 2, swing)).toBeCloseTo(PAIR * 2, 10);
    }
  });
});
