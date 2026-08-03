import { describe, it, expect } from 'vitest';
import { UnisonStack, driftDepthFor, MAX_UNISON } from './unison';

const SR = 48000;
const SAW = 0;

function rms(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

/** One second of a stack at 220 Hz with the given size and spread. */
function capture(count: number, spreadCents: number, n = SR): number[] {
  const s = new UnisonStack(SAW, count, SR);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(s.update(220, 0.5, 0, spreadCents, 0));
  return out;
}

describe('the unison stack', () => {
  it('one copy is exactly one oscillator — gain 1, no compensation', () => {
    // The degenerate case has to be free, or turning unison off would still
    // change the level of every patch. 1^0.3 === 1.
    expect(new UnisonStack(SAW, 1, SR).gain).toBe(1);
  });

  it('a detuned stack is fatter but not N times louder', () => {
    // A stack that summed N copies without compensating would blow the
    // headroom of every preset that raises the voice count. Relative: the wide
    // stack must stay within a small factor of one copy, nowhere near 7x.
    const ratio = rms(capture(MAX_UNISON, 20)) / rms(capture(1, 20));
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(3);
  });

  it('spread makes the copies beat; no spread leaves them coherent', () => {
    // Beating is amplitude variation over time. Relative: the spread stack's
    // envelope must move more between two windows than the coherent one's.
    const wander = (spreadCents: number): number => {
      const out = capture(MAX_UNISON, spreadCents);
      return Math.abs(rms(out.slice(0, SR / 8)) - rms(out.slice(SR / 2, SR / 2 + SR / 8)));
    };
    expect(wander(20)).toBeGreaterThan(wander(0));
  });

  it('the stack never exceeds MAX_UNISON copies however many are asked for', () => {
    // An unbounded count would allocate per voice on the audio thread.
    expect(new UnisonStack(SAW, 99, SR).gain)
      .toBeCloseTo(new UnisonStack(SAW, MAX_UNISON, SR).gain, 12);
  });

  it('drift depth is chosen by FREQUENCY, not by stack size', () => {
    // The same number of cents is far more Hz down low, so a drifting bass
    // just sounds out of tune. This also pins the argument's meaning, which
    // reads like a count and is not one.
    expect(driftDepthFor(400)).toBeGreaterThan(driftDepthFor(100));
  });
});
