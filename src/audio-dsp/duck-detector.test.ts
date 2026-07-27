import { describe, it, expect } from 'vitest';
import { DuckDetector } from './duck-detector';

const SR = 48000;

/** A kick-ish pulse train: `hits` per second, each a 30 ms decaying burst. */
function pulse(i: number, hitsPerSec = 2, amp = 0.9): number {
  const period = Math.floor(SR / hitsPerSec);
  const phase = i % period;
  const len = Math.floor(SR * 0.03);
  if (phase >= len) return 0;
  const env = 1 - phase / len;
  return Math.sin((2 * Math.PI * 60 * phase) / SR) * amp * env;
}

function run(d: DuckDetector, n: number, src: (i: number) => number, from = 0) {
  let min = Infinity, max = -Infinity, last = 1;
  for (let i = 0; i < n; i++) {
    last = d.process(src(from + i));
    if (last < min) min = last;
    if (last > max) max = last;
  }
  return { min, max, last };
}

describe('DuckDetector', () => {
  it('never leaves [0, 1] over a long run', () => {
    const d = new DuckDetector(SR, { depth: 0.6, attack: 0.005, release: 0.25, threshold: -60 });
    const r = run(d, SR * 30, (i) => pulse(i));
    expect(r.min).toBeGreaterThanOrEqual(0);
    expect(r.max).toBeLessThanOrEqual(1);
  });

  it('does not drift when the source is silent', () => {
    const d = new DuckDetector(SR, { depth: 0.6, attack: 0.005, release: 0.25, threshold: -60 });
    const r = run(d, SR * 30, () => 0);
    expect(r.min).toBe(1);
    expect(r.max).toBe(1);
  });

  it('ducks by depth × envelope on a sustained source', () => {
    const d = new DuckDetector(SR, { depth: 0.6, attack: 0.005, release: 0.02, threshold: -60 });
    const r = run(d, SR * 2, () => 0.8);
    // steady state: 1 − 0.6 × 0.8 = 0.52
    expect(r.last).toBeGreaterThan(0.50);
    expect(r.last).toBeLessThan(0.54);
  });

  it('recovers to unity after the source stops', () => {
    const d = new DuckDetector(SR, { depth: 0.9, attack: 0.005, release: 0.1, threshold: -60 });
    run(d, SR * 2, () => 0.8);
    const r = run(d, Math.floor(SR * 0.8), () => 0);   // 8 release constants
    expect(r.last).toBeGreaterThan(0.99);
  });

  it('is stateless across a stop: the same source gives the same duck again', () => {
    const d = new DuckDetector(SR, { depth: 0.6, attack: 0.005, release: 0.25, threshold: -60 });
    // First run — settle, then take the deepest duck of a 4 s window.
    run(d, SR * 8, (i) => pulse(i));
    const firstPass = run(d, SR * 4, (i) => pulse(i), SR * 8);
    // Transport stopped: 5 s of true silence (the reported repro).
    run(d, SR * 5, () => 0);
    // Relaunch: settle for the same 8 s as the first pass, THEN measure the same
    // 4 s window. Comparing equivalent phases is the point — a window starting
    // from rest legitimately peaks at 1 because nothing has ducked yet.
    run(d, SR * 8, (i) => pulse(i));
    const secondPass = run(d, SR * 4, (i) => pulse(i), SR * 8);
    expect(secondPass.min).toBeCloseTo(firstPass.min, 2);
    expect(secondPass.max).toBeCloseTo(firstPass.max, 2);
    expect(secondPass.min).toBeGreaterThan(0);
  });

  it('a faster attack reaches the duck sooner', () => {
    const fast = new DuckDetector(SR, { depth: 0.8, attack: 0.001, release: 0.2, threshold: -60 });
    const slow = new DuckDetector(SR, { depth: 0.8, attack: 0.2, release: 0.2, threshold: -60 });
    const n = Math.floor(SR * 0.01);   // 10 ms after a step
    const f = run(fast, n, () => 0.9);
    const s = run(slow, n, () => 0.9);
    expect(f.last).toBeLessThan(s.last);
  });

  it('a longer release holds the duck for longer', () => {
    const mk = (release: number) => {
      const d = new DuckDetector(SR, { depth: 0.9, attack: 0.002, release, threshold: -60 });
      run(d, Math.floor(SR * 0.5), () => 0.9);
      return run(d, Math.floor(SR * 0.1), () => 0).last;
    };
    expect(mk(0.5)).toBeLessThan(mk(0.02));
  });

  it('ignores a source under the threshold', () => {
    const d = new DuckDetector(SR, { depth: 1, attack: 0.005, release: 0.05, threshold: -20 });
    const r = run(d, SR, () => 0.05);   // −26 dB, below the −20 dB threshold
    expect(r.last).toBe(1);
  });

  it('depth 0 never ducks', () => {
    const d = new DuckDetector(SR, { depth: 0, attack: 0.005, release: 0.25, threshold: -60 });
    const r = run(d, SR * 2, (i) => pulse(i));
    expect(r.min).toBe(1);
  });

  it('setParams mid-flight keeps the multiplier bounded', () => {
    const d = new DuckDetector(SR, { depth: 0.6, attack: 0.005, release: 0.25, threshold: -60 });
    run(d, SR, (i) => pulse(i));
    d.setParams({ depth: 1, attack: 0.001, release: 1, threshold: -60 });
    const r = run(d, SR * 3, (i) => pulse(i));
    expect(r.min).toBeGreaterThanOrEqual(0);
    expect(r.max).toBeLessThanOrEqual(1);
  });
});
