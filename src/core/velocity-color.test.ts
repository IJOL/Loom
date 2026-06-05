import { describe, it, expect } from 'vitest';
import { velToColor } from './velocity-color';

const rgb = (s: string) => s.match(/\d+/g)!.map(Number);

describe('velToColor', () => {
  it('is blue at low velocity and yellow at high velocity', () => {
    const [rLo, gLo, bLo] = rgb(velToColor(1));
    const [rHi, gHi, bHi] = rgb(velToColor(127));
    expect(bLo).toBeGreaterThan(rLo);        // low: blue dominates
    expect(rHi).toBeGreaterThan(bHi);        // high: warm dominates
    expect(gHi).toBeGreaterThan(gLo);        // yellow is greener+redder than blue
  });

  it('red channel rises monotonically with velocity', () => {
    const reds = [0, 32, 64, 96, 127].map((v) => rgb(velToColor(v))[0]);
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeGreaterThanOrEqual(reds[i - 1]);
  });

  it('clamps out-of-range velocities', () => {
    expect(velToColor(-50)).toBe(velToColor(0));
    expect(velToColor(999)).toBe(velToColor(127));
  });
});
