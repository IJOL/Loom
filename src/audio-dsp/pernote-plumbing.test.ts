// The road a driver:'trigger' modulator travels, end to end. The kernel's own
// maths is tested in plugins/pernote/dsp.test.ts; what is tested HERE is the
// part that can break silently — that the note ordinal is counted, captured per
// voice, and handed to the kernel.
//
// Every failure mode below shipped as a real bug class in this codebase before:
// a modulator that is enabled, connected, drawing a ring, and inert.
import { describe, it, expect } from 'vitest';
import { ModulationRuntime, type ModLite } from './modulation-runtime';
import { registerModulatorKernel, __resetModulatorKernels } from './modulator-kernels';

/** A kernel that reports the ordinal it was handed, so the test reads the
 *  plumbing rather than any particular maths. */
function installProbe(): void {
  __resetModulatorKernels();
  registerModulatorKernel({
    id: 'probe',
    valueAt: (_m, _t, _origin, triggerIndex) => triggerIndex ?? -1,
  });
}

const probe = (over: Partial<ModLite> = {}): ModLite => ({
  id: 'p1', kind: 'probe', enabled: true, rateHz: 1, waveform: 'sine',
  driver: 'trigger', depthByParam: { cutoff: 1 }, ...over,
});

describe('the note ordinal reaches the kernel', () => {
  it('is passed through, not invented', () => {
    installProbe();
    const rt = new ModulationRuntime(48000);
    rt.setMods([probe()]);
    const at = (n: number) =>
      rt.offsetFor('cutoff', 0, { voiceStartT: 0, lastNoteOnT: 0, triggerIndex: n });
    expect(at(0)).toBe(0);
    expect(at(7)).toBe(7);
    expect(at(41)).toBe(41);
  });

  it('reaches the pooled per-sample path too, not just offsetFor', () => {
    installProbe();
    const rt = new ModulationRuntime(48000);
    rt.setMods([probe()]);
    const out: Record<string, number> = {};
    rt.offsetsInto(out, 0, { voiceStartT: 0, lastNoteOnT: 0, triggerIndex: 12 });
    expect(out.cutoff).toBe(12);
  });
});

describe('a trigger modulator forces the per-voice path', () => {
  it('asks for it even when its SCOPE says shared', () => {
    installProbe();
    const rt = new ModulationRuntime(48000);
    // Shared scope, free trigger: the two settings that normally take the cheap
    // once-per-sample path, whose origin is SHARED_ORIGIN — triggerIndex 0
    // forever. Without the driver check this modulator would be frozen on its
    // first value: enabled, connected, and inert.
    rt.setMods([probe({ scope: 'shared', trigger: 'free' })]);
    expect(rt.needsPerVoicePhase()).toBe(true);
  });

  it('leaves the cheap path alone for everything else', () => {
    installProbe();
    registerModulatorKernel({ id: 'plain', valueAt: () => 1 });
    const rt = new ModulationRuntime(48000);
    rt.setMods([probe({ kind: 'plain', driver: 'time', scope: 'shared', trigger: 'free' })]);
    expect(rt.needsPerVoicePhase()).toBe(false);
  });
});

describe('a trigger modulator stays off the gate road', () => {
  it('is not mistaken for an envelope', () => {
    installProbe();
    const rt = new ModulationRuntime(48000);
    rt.setMods([probe(), probe({ id: 'g1', driver: 'gate' })]);
    // getAdsrMods selects driver === 'gate'. A third driver must not leak in, or
    // the renderer would gate an envelope from a modulator that has no shape.
    const gated = rt.getAdsrMods();
    expect(gated.map((m) => m.id)).toEqual(['g1']);
  });
});
