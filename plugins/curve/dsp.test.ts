// plugins/curve/dsp.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

// dsp.ts registers through the worklet-side global; capture the kernels.
type Kernel = { id: string; valueAt(m: unknown, t: number, origin: number): number };
const kernels = new Map<string, Kernel>();
beforeAll(async () => {
  (globalThis as Record<string, unknown>).Loom = {
    registerModulatorKernel: (k: Kernel) => kernels.set(k.id, k),
  };
  await import('./dsp');
});

/** Bag for a 2-point ramp (0,1)->(1,0), curvature c on the first point. */
const ramp = (c = 0): Record<string, number> => ({
  pts: 2, p0x: 0, p0y: 1, p0c: c, p1x: 1, p1y: 0, p1c: 0,
});

describe('evalCurve', () => {
  it('interpolates linearly when curvature is 0', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(ramp(0), 0)).toBeCloseTo(1, 5);
    expect(evalCurve(ramp(0), 0.25)).toBeCloseTo(0.75, 5);
    expect(evalCurve(ramp(0), 1)).toBeCloseTo(0, 5);
  });

  it('positive curvature bows toward the start (ease-in): stays above the line', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(ramp(1), 0.25)).toBeGreaterThan(evalCurve(ramp(0), 0.25));
  });

  it('negative curvature bows the other way: below the line', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(ramp(-1), 0.25)).toBeLessThan(evalCurve(ramp(0), 0.25));
  });

  it('a missing bag falls back to the seed ramp, never throws', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(undefined, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('curve-lfo kernel', () => {
  const m = (extra: Record<string, number>) =>
    ({ id: 'crv1', kind: 'curve-lfo', enabled: true, params: { ...ramp(0), ...extra } });

  it('walks the curve at rate and wraps: one full cycle returns to the start', () => {
    const k = kernels.get('curve-lfo')!;
    const at = (t: number) => k.valueAt(m({ rate: 2 }), t, 0); // 2 Hz -> period 0.5s
    expect(at(0)).toBeCloseTo(1, 5);
    expect(at(0.25)).toBeCloseTo(0.5, 5);   // half cycle down the ramp
    expect(at(0.5)).toBeCloseTo(at(0), 5);  // wrapped
  });

  it('bipolar maps 0..1 onto -1..+1', () => {
    const k = kernels.get('curve-lfo')!;
    expect(k.valueAt(m({ rate: 1, bipolar: 1 }), 0, 0)).toBeCloseTo(1, 5);
    expect(k.valueAt(m({ rate: 1, bipolar: 1 }), 0.5, 0)).toBeCloseTo(0, 5); // midpoint 0.5 -> 0
  });
});
