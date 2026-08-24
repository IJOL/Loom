// src/audio-dsp/modulator-kernels.ts
// The worklet half of the modulator door. A kernel is per-sample maths and
// nothing else — no DOM, no AudioContext — so it runs unchanged inside the
// AudioWorklet and on the main thread for the offline render.
import type { ModLite } from './modulation-runtime';

export interface ModulatorKernel {
  id: string;
  /** Normalised signal at absolute time `t`: -1..+1 when bipolar, 0..1 when
   *  unipolar. `origin` is the phase origin the runtime already resolved for
   *  this modulator (shared/free = 0, note = last note-on, voice = that
   *  voice's start).
   *
   *  `triggerIndex` is the ordinal of the note this voice belongs to, counted
   *  by the lane since the transport started. A driver:'trigger' kernel is a
   *  function of it and ignores `t`; every other kernel ignores it. Optional
   *  in the signature so a kernel written before this existed — a plugin's, and
   *  its tests — keeps compiling and calling with three arguments; the runtime
   *  always passes it. It is a
   *  parameter rather than something the kernel counts for itself precisely
   *  BECAUSE of the rule below — a counter is state, and a kernel may not hold
   *  any. The counting happens in VoiceManager, which is allowed to remember.
   *
   *  MUST be pure: same inputs, same output. The offline render calls it in a
   *  different order from the live one, so a kernel holding mutable state
   *  would make an export sound different from what you heard. */
  valueAt(m: ModLite, t: number, origin: number, triggerIndex?: number): number;
}

const kernels = new Map<string, ModulatorKernel>();

export function registerModulatorKernel(k: ModulatorKernel): void {
  kernels.set(k.id, k);
}

export function getModulatorKernel(id: string): ModulatorKernel | undefined {
  return kernels.get(id);
}

/** Test-only. */
export function __resetModulatorKernels(): void {
  kernels.clear();
}
