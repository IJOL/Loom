// One loop, two instruments, one fader. The properties that make it a fader
// rather than two knobs that happen to move together.
import { describe, it, expect } from 'vitest';
import { soundGains } from './sound-fade';

describe('soundGains', () => {
  it('is entirely the first instrument at one end and the second at the other', () => {
    // Exactly, not nearly: a morph parked at an end must sound like that
    // instrument alone, not like it with something inaudible underneath.
    expect(soundGains(0)).toEqual({ a: 1, b: 0 });
    expect(soundGains(1)).toEqual({ a: 0, b: 1 });
  });

  it('holds the LOUDNESS flat across the middle', () => {
    // The reason this is not `x` and `1 - x`. Uncorrelated sounds add by power,
    // so a linear pair dips in the middle and the morph reads as a hole rather
    // than a handover. Squares summing to one is what keeps it level.
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const { a, b } = soundGains(x);
      expect(a * a + b * b).toBeCloseTo(1, 6);
    }
  });

  it('meets in the middle', () => {
    const { a, b } = soundGains(0.5);
    expect(a).toBeCloseTo(b, 6);
  });

  it('moves one way only', () => {
    // A fader that went back on itself anywhere would be unusable, and it is
    // the kind of thing a formula change could introduce silently.
    let prevA = Infinity;
    let prevB = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const { a, b } = soundGains(i / 20);
      expect(a).toBeLessThanOrEqual(prevA + 1e-12);
      expect(b).toBeGreaterThanOrEqual(prevB - 1e-12);
      prevA = a;
      prevB = b;
    }
  });

  it('clamps rather than inventing gains outside the fader', () => {
    // The dial winds past its ends so the host can tell a lap from a rewind;
    // a gain of 1.4 would be an instrument louder than it was built to be.
    expect(soundGains(-3)).toEqual({ a: 1, b: 0 });
    expect(soundGains(9)).toEqual({ a: 0, b: 1 });
  });
});
