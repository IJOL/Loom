import { describe, it, expect } from 'vitest';
// dsp.ts calls Loom.registerModulatorKernel(...) at module scope, so the
// global must exist before the import graph is evaluated. Importing the
// worklet's real Loom install FIRST wires the kernel into the shared registry
// — same pattern as plugins/sh/dsp.test.ts.
import '../../src/audio-worklet/loom-processor';
import './dsp';
import { getModulatorKernel } from '../../src/audio-dsp/modulator-kernels';

// The bag the UI writes and the kernel reads: step values live 0..1 (drawn),
// polarity is applied at the OUTPUT.
const BAG = {
  steps: 4, rate: 4, bipolar: 0, glide: 0,
  step0: 1, step1: 0.25, step2: 0.75, step3: 0,
};
const mod = (over: Record<string, number> = {}): never =>
  ({ id: 'seq1', kind: 'stepseq', enabled: true, depthByParam: {}, params: { ...BAG, ...over } }) as never;

describe('step sequencer kernel', () => {
  const k = () => getModulatorKernel('stepseq')!;

  it('plays the drawn value of each step and wraps around', () => {
    // rate 4 → 0.25 s per step.
    expect(k().valueAt(mod(), 0.10, 0)).toBe(1);
    expect(k().valueAt(mod(), 0.30, 0)).toBe(0.25);
    expect(k().valueAt(mod(), 0.60, 0)).toBe(0.75);
    expect(k().valueAt(mod(), 0.80, 0)).toBe(0);
    expect(k().valueAt(mod(), 1.10, 0)).toBe(1);
  });

  it('bipolar maps the drawn 0..1 onto -1..+1 at the output', () => {
    expect(k().valueAt(mod({ bipolar: 1 }), 0.10, 0)).toBe(1);
    expect(k().valueAt(mod({ bipolar: 1 }), 0.80, 0)).toBe(-1);
  });

  it('glide 0 holds hard to the boundary; glide 1 ramps into the next step', () => {
    // Hard: a hair before the boundary is still the step's own value.
    expect(k().valueAt(mod(), 0.2499, 0)).toBe(1);
    // Full glide: the whole step is a ramp from its value to the next one's.
    // At frac 0.99 that is 1 + (0.25-1)·0.99.
    const v = k().valueAt(mod({ glide: 1 }), 0.2475, 0);
    expect(Math.abs(v - 0.2575)).toBeLessThan(0.01);
  });

  it('honours the origin — the pattern starts where the phase origin is', () => {
    expect(k().valueAt(mod(), 1.10, 1.0)).toBe(1);
  });

  it('is pure: the same instant always reads the same, whatever the call order', () => {
    const first = k().valueAt(mod(), 0.55, 0);
    k().valueAt(mod(), 1.9, 0);
    k().valueAt(mod(), 0.1, 0);
    // Without purity the offline render would diverge from the live one: the
    // exporter calls valueAt in a different order.
    expect(k().valueAt(mod(), 0.55, 0)).toBe(first);
  });

  it('an undrawn bag is silent-safe: missing steps read as 0', () => {
    const bare = ({ id: 'seq1', kind: 'stepseq', enabled: true, depthByParam: {}, params: { steps: 8, rate: 4, bipolar: 0, glide: 0 } }) as never;
    expect(k().valueAt(bare, 0.9, 0)).toBe(0);
  });
});
