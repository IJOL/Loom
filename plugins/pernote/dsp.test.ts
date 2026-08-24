import { describe, it, expect } from 'vitest';
// Same import order as plugins/sh/dsp.test.ts: the real Loom install first, so
// registerModulatorKernel wires into the shared registry getModulatorKernel reads.
import '../../src/audio-worklet/loom-processor';
import './dsp';
import { getModulatorKernel } from '../../src/audio-dsp/modulator-kernels';

const mod = (params: Record<string, number>) => ({
  id: 'pn1', kind: 'pernote', enabled: true, rateHz: 4, depthByParam: {}, params,
} as never);

const k = () => getModulatorKernel('pernote')!;

/** The value the kernel gives note n. Time is passed deliberately varied — it
 *  must not matter. */
const at = (params: Record<string, number>, n: number, t = 0) => k().valueAt(mod(params), t, 0, n);

describe('per-note modulator', () => {
  it('gives a different value to each note', () => {
    const p = { pattern: 0.618, skew: 0, bipolar: 1 };
    const vals = [0, 1, 2, 3, 4].map((n) => at(p, n));
    expect(new Set(vals).size).toBe(5);
  });

  it('does not move during a note — the whole point of driver:trigger', () => {
    const p = { pattern: 0.618, skew: 0, bipolar: 1 };
    // Same ordinal, wildly different times.
    expect(at(p, 7, 0)).toBe(at(p, 7, 123.456));
  });

  it('gives the SAME note the same value every time — it is not random', () => {
    const p = { pattern: 0.618, skew: 0, bipolar: 1 };
    expect(at(p, 41)).toBe(at(p, 41));
    // And a fresh kernel lookup agrees: nothing was remembered between calls.
    expect(getModulatorKernel('pernote')!.valueAt(mod(p), 9, 0, 41)).toBe(at(p, 41));
  });

  it('turns Pattern into period: 0.5 alternates, 0.25 cycles every four', () => {
    const two = [0, 1, 2, 3].map((n) => at({ pattern: 0.5, skew: 0, bipolar: 0 }, n));
    expect(two[0]).toBe(two[2]);
    expect(two[1]).toBe(two[3]);
    expect(two[0]).not.toBe(two[1]);

    const four = [0, 1, 2, 3, 4].map((n) => at({ pattern: 0.25, skew: 0, bipolar: 0 }, n));
    expect(four[0]).toBe(four[4]);
    expect(new Set(four.slice(0, 4)).size).toBe(4);
  });

  it('never cycles at the default pattern, where 0.25 cycles every four', () => {
    // The claim is that no value COMES BACK — not that no two values are close.
    // Two readings 0.2% apart are two different values; a cycle is an exact
    // return. 0.618 would fail this at note 500 (it is 309/500); the default is
    // the irrational, which never returns at all.
    const golden = (Math.sqrt(5) - 1) / 2;
    const vals = [];
    for (let n = 0; n < 500; n++) vals.push(at({ pattern: golden, skew: 0, bipolar: 0 }, n));
    expect(new Set(vals).size).toBe(500);
    // And the contrast, so "500 distinct" is not just what any number does.
    const quarter = [];
    for (let n = 0; n < 500; n++) quarter.push(at({ pattern: 0.25, skew: 0, bipolar: 0 }, n));
    expect(new Set(quarter).size).toBe(4);
  });

  it('stays in range, and Polarity decides which way the target moves', () => {
    for (let n = 0; n < 50; n++) {
      const uni = at({ pattern: 0.618, skew: 0.3, bipolar: 0 }, n);
      expect(uni).toBeGreaterThanOrEqual(0);
      expect(uni).toBeLessThan(1);
      const bi = at({ pattern: 0.618, skew: 0.3, bipolar: 1 }, n);
      expect(bi).toBeGreaterThanOrEqual(-1);
      expect(bi).toBeLessThan(1);
    }
  });

  it('Skew shifts the whole sequence without changing its shape', () => {
    const a = [0, 1, 2, 3].map((n) => at({ pattern: 0.25, skew: 0, bipolar: 0 }, n));
    const b = [0, 1, 2, 3].map((n) => at({ pattern: 0.25, skew: 0.25, bipolar: 0 }, n));
    // Same four values, rotated by one.
    expect(b[0]).toBeCloseTo(a[1], 10);
    expect(b[1]).toBeCloseTo(a[2], 10);
  });

  it('is inert at Pattern 0 — a neutral default position exists', () => {
    const p = { pattern: 0, skew: 0, bipolar: 0 };
    expect(at(p, 0)).toBe(at(p, 99));
  });
});
