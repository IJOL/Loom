// One loop, four instruments, one pad. The properties that make it a crossfade
// rather than four knobs that happen to move together.
import { describe, it, expect } from 'vitest';
import { soundGains } from './sound-fade';

describe('soundGains', () => {
  it('is entirely ONE instrument at each corner', () => {
    // Exactly, not nearly: a morph parked at a corner must sound like that
    // instrument alone, not like it with something inaudible underneath.
    expect(soundGains(0, 0)).toEqual([1, 0, 0, 0]);
    expect(soundGains(1, 0)).toEqual([0, 1, 0, 0]);
    expect(soundGains(0, 1)).toEqual([0, 0, 1, 0]);
    expect(soundGains(1, 1)).toEqual([0, 0, 0, 1]);
  });

  it('holds the LOUDNESS flat everywhere in the square', () => {
    // The reason these are square roots. Uncorrelated sounds add by power, so a
    // linear set dips in the middle and the morph reads as a hole rather than a
    // handover. Squares summing to one is what keeps it level.
    for (const x of [0, 0.1, 0.5, 0.75, 1]) {
      for (const y of [0, 0.3, 0.5, 1]) {
        const sum = soundGains(x, y).reduce((t, g) => t + g * g, 0);
        expect(sum).toBeCloseTo(1, 6);
      }
    }
  });

  it('meets in the middle, all four equal', () => {
    const [a, b, c, d] = soundGains(0.5, 0.5);
    expect(b).toBeCloseTo(a, 6);
    expect(c).toBeCloseTo(a, 6);
    expect(d).toBeCloseTo(a, 6);
  });

  it('moves one way only along an edge', () => {
    // A fader that went back on itself anywhere would be unusable, and it is the
    // kind of thing a formula change could introduce silently.
    let prevA = Infinity;
    let prevB = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const [a, b] = soundGains(i / 20, 0);
      expect(a).toBeLessThanOrEqual(prevA + 1e-12);
      expect(b).toBeGreaterThanOrEqual(prevB - 1e-12);
      prevA = a;
      prevB = b;
    }
  });

  it('is the old two-slot fader when nothing is on the bottom half', () => {
    // A rack of two is the same square with its lower corners empty, so the
    // control that used to be a fader is still in here — and a lane that has
    // only slots 0 and 1 must not have gain quietly diverted to slots it does
    // not have.
    const [, , c, d] = soundGains(0.4);
    expect(c).toBe(0);
    expect(d).toBe(0);
  });

  it('clamps rather than inventing gains outside the square', () => {
    // The dial winds past its ends so the host can tell a lap from a rewind; a
    // gain of 1.4 would be an instrument louder than it was built to be.
    expect(soundGains(-3, -3)).toEqual([1, 0, 0, 0]);
    expect(soundGains(9, 9)).toEqual([0, 0, 0, 1]);
  });
});
