import { describe, it, expect } from 'vitest';
// dsp.ts calls Loom.registerModulatorKernel(...) at module scope, so the
// global must exist before the import graph is evaluated (see
// plugins/karplus/dsp.test.ts for the same problem with Loom.registerRenderer).
// Sibling static imports of ONE file evaluate in declaration order, so
// importing the worklet's real Loom install FIRST — which wires
// registerModulatorKernel straight into the shared registry, the same one
// getModulatorKernel below reads from — lands the 'sh' kernel for real,
// instead of a throwaway stub only this file could see.
import '../../src/audio-worklet/loom-processor';
import './dsp';
import { getModulatorKernel } from '../../src/audio-dsp/modulator-kernels';

const mod = { id: 'sh1', kind: 'sh', enabled: true, rateHz: 4,
  depthByParam: {}, params: { rate: 4, bipolar: 1 } } as never;

describe('sample & hold kernel', () => {
  it('holds its value for the whole step', () => {
    const k = getModulatorKernel('sh')!;
    // Two instants inside the same 1/4 s step must read identical.
    expect(k.valueAt(mod, 0.05, 0)).toBe(k.valueAt(mod, 0.20, 0));
  });

  it('latches a new value on the next step', () => {
    const k = getModulatorKernel('sh')!;
    expect(k.valueAt(mod, 0.20, 0)).not.toBe(k.valueAt(mod, 0.30, 0));
  });

  it('is pure: the same instant always reads the same, whatever the call order', () => {
    const k = getModulatorKernel('sh')!;
    const first = k.valueAt(mod, 0.55, 0);
    k.valueAt(mod, 1.9, 0);
    k.valueAt(mod, 0.1, 0);
    // Without purity the offline render would diverge from the live one: the
    // exporter calls valueAt in a different order.
    expect(k.valueAt(mod, 0.55, 0)).toBe(first);
  });

  it('stays inside its polarity range', () => {
    const k = getModulatorKernel('sh')!;
    for (let t = 0; t < 4; t += 0.037) {
      const v = k.valueAt(mod, t, 0);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
