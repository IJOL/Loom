import { describe, it, expect } from 'vitest';
import { fillSteps, stepPreset } from './automation-steps';

const flatRuns = (xs: number[]) => xs.filter((v, i) => i > 0 && v === xs[i - 1]).length;

describe('fillSteps', () => {
  it('holds each value flat across its slice', () => {
    const out = fillSteps([0, 1], 'hold', 8);
    expect(out.slice(0, 4).every((v) => v === 0)).toBe(true);
    expect(out.slice(4).every((v) => v === 1)).toBe(true);
  });

  it('ramps between neighbours instead of stepping', () => {
    const mid = fillSteps([0, 1], 'ramp', 8)[2];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('gives a hold curve more flat runs than a ramp of the same steps', () => {
    const steps = [0, 0.5, 1, 0.25];
    expect(flatRuns(fillSteps(steps, 'hold', 32)))
      .toBeGreaterThan(flatRuns(fillSteps(steps, 'ramp', 32)));
  });

  it('wraps the ramp to the first step, so the curve closes on itself', () => {
    // Without the wrap every loop would jump at the seam.
    const out = fillSteps([0, 1], 'ramp', 16);
    expect(out[out.length - 1]).toBeLessThan(1);
    expect(out[out.length - 1]).toBeGreaterThan(0);
  });

  it('returns exactly the number of samples asked for', () => {
    for (const subs of [1, 7, 16, 33]) {
      expect(fillSteps([0.2, 0.8, 0.5], 'hold', subs)).toHaveLength(subs);
    }
  });

  it('starts at the first step in both modes', () => {
    expect(fillSteps([0.3, 0.9], 'hold', 8)[0]).toBeCloseTo(0.3);
    expect(fillSteps([0.3, 0.9], 'ramp', 8)[0]).toBeCloseTo(0.3);
  });

  it('returns a flat zero curve when handed no steps', () => {
    expect(fillSteps([], 'hold', 4)).toEqual([0, 0, 0, 0]);
  });

  it('returns nothing when asked for no samples', () => {
    expect(fillSteps([0.5], 'hold', 0)).toEqual([]);
  });

  it('keeps every sample inside 0..1 even with values outside it', () => {
    // The control cannot produce these, but a saved file could.
    for (const v of fillSteps([-2, 3], 'ramp', 8)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('step presets', () => {
  it('ramps up from low to high', () => {
    const up = stepPreset('up', 8, [], () => 0.5);
    expect(up[0]).toBeLessThan(up[up.length - 1]);
  });

  it('ramps down from high to low', () => {
    const down = stepPreset('down', 8, [], () => 0.5);
    expect(down[0]).toBeGreaterThan(down[down.length - 1]);
  });

  it('mirrors the current values when inverting', () => {
    expect(stepPreset('invert', 3, [0.2, 0.5, 1], () => 0)).toEqual([0.8, 0.5, 0]);
  });

  it('inverting twice returns the original', () => {
    const original = [0.1, 0.4, 0.9];
    const twice = stepPreset('invert', 3, stepPreset('invert', 3, original, () => 0), () => 0);
    twice.forEach((v, i) => expect(v).toBeCloseTo(original[i]));
  });

  it('uses the injected source for random, so the result is reproducible', () => {
    expect(stepPreset('random', 4, [], () => 0.25)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('returns the asked-for count even when the current values are shorter', () => {
    expect(stepPreset('invert', 5, [0.5], () => 0)).toHaveLength(5);
  });

  it('keeps every value inside 0..1', () => {
    for (const kind of ['up', 'down', 'invert', 'random'] as const) {
      for (const v of stepPreset(kind, 8, [-4, 9], () => 7)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('handles a count of one without dividing by zero', () => {
    expect(stepPreset('up', 1, [], () => 0.5)).toHaveLength(1);
    expect(Number.isFinite(stepPreset('up', 1, [], () => 0.5)[0])).toBe(true);
  });
});
