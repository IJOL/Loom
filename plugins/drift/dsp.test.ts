// plugins/drift/dsp.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

type Kernel = { id: string; valueAt(m: unknown, t: number, origin: number): number };
const kernels = new Map<string, Kernel>();
beforeAll(async () => {
  (globalThis as Record<string, unknown>).Loom = {
    registerModulatorKernel: (k: Kernel) => kernels.set(k.id, k),
  };
  await import('./dsp');
});

const m = (id: string, extra: Record<string, number> = {}) =>
  ({ id, kind: 'drift', enabled: true, params: { rate: 2, amount: 1, mode: 0, ...extra } });

describe('drift kernel', () => {
  it('stays within -1..+1 and scales with amount', () => {
    const k = kernels.get('drift')!;
    for (let i = 0; i < 500; i++) {
      const v = k.valueAt(m('drf1'), i * 0.013, 0);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(k.valueAt(m('drf1', { amount: 0.25 }), i * 0.013, 0)))
        .toBeLessThanOrEqual(Math.abs(v) + 1e-9);
    }
  });

  it('is continuous: adjacent samples move a small fraction of the range', () => {
    const k = kernels.get('drift')!;
    // At rate 2Hz a 1ms step should never jump more than a few percent of the
    // full span — RELATIVE to what a whole period could move (2 units), x4 slack.
    for (let i = 0; i < 2000; i++) {
      const a = k.valueAt(m('drf1'), i * 0.001, 0);
      const b = k.valueAt(m('drf1'), (i + 1) * 0.001, 0);
      expect(Math.abs(b - a)).toBeLessThan(2 * (2 * 0.001) * 4);
    }
  });

  it('is deterministic per instance and different across instances', () => {
    const k = kernels.get('drift')!;
    expect(k.valueAt(m('drf1'), 1.234, 0)).toBe(k.valueAt(m('drf1'), 1.234, 0));
    const a = Array.from({ length: 32 }, (_, i) => k.valueAt(m('drf1'), i * 0.11, 0));
    const b = Array.from({ length: 32 }, (_, i) => k.valueAt(m('drf2'), i * 0.11, 0));
    expect(a.some((v, i) => Math.abs(v - b[i]) > 1e-6)).toBe(true);
  });

  it('chaos mode also holds range and continuity', () => {
    const k = kernels.get('drift')!;
    let prev = k.valueAt(m('drf1', { mode: 1 }), 0, 0);
    for (let i = 1; i < 1000; i++) {
      const v = k.valueAt(m('drf1', { mode: 1 }), i * 0.002, 0);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      // Continuous, never a step: the Lorenz walk is integrated, not sampled
      // from noise, so adjacent 2ms values stay close. 0.2 is ~10% of span.
      expect(Math.abs(v - prev)).toBeLessThan(0.2);
      prev = v;
    }
  });
});
