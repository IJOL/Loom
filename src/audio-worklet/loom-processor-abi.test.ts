// The worklet half of the runtime handshake: importing loom-processor.ts
// installs globalThis.Loom, mirroring installMainThreadLoomApi on the main
// thread (loom-api.test.ts). This test proves the WORKLET realm also opens
// the modulator kernel door — the two ABI halves are separate modules
// (separately addModule'd in the browser), so neither installation covers
// the other; each has to be checked on its own.
import { describe, it, expect } from 'vitest';
import { __resetModulatorKernels, getModulatorKernel } from '../audio-dsp/modulator-kernels';

// Importing this module runs its top-level Object.defineProperty(globalThis,
// 'Loom', ...) as a side effect — the same mechanism a plugin's dsp.js relies
// on being in place before it runs.
import './loom-processor';

describe('the worklet half of the runtime handshake (loom-processor.ts)', () => {
  it('installs a Loom global with the same shape as the main thread', () => {
    const Loom = (globalThis as unknown as { Loom: { apiVersion: number; registerRenderer: unknown; registerModulatorKernel: unknown } }).Loom;
    expect(typeof Loom.registerRenderer).toBe('function');
    expect(typeof Loom.registerModulatorKernel).toBe('function');
  });

  it('a kernel registered through the worklet Loom global lands in the shared registry', () => {
    __resetModulatorKernels();
    const Loom = (globalThis as unknown as { Loom: { registerModulatorKernel(k: unknown): void } }).Loom;
    Loom.registerModulatorKernel({ id: 'sh', valueAt: () => 0.25 });
    expect(getModulatorKernel('sh')?.valueAt({} as never, 0, 0)).toBe(0.25);
  });
});
