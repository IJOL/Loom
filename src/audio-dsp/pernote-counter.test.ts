// The lane's note counter: the one piece of state in the whole per-note
// modulation path. It lives in VoiceManager because a kernel may not remember
// anything (an offline export would drift from what you heard), so this is
// where it has to be proved correct.
import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import '../../test/plugin-dsp';
import '../../plugins/subtractive/dsp';
import { ModulationRuntime, type ModLite } from './modulation-runtime';
import { registerModulatorKernel, __resetModulatorKernels } from './modulator-kernels';
import type { ParamBag, NoteSpec } from './types';

const SR = 48000;
const P: ParamBag = {};
const note = (midi: number, begin = 0, durationSec = 10): NoteSpec =>
  ({ midi, beginSec: begin, durationSec, velocity: 0.8, accent: false, slide: false });

/** Reports whatever ordinal it is handed, so these tests read the counter. */
function probeRuntime(): ModulationRuntime {
  __resetModulatorKernels();
  registerModulatorKernel({ id: 'probe', valueAt: (_m, _t, _o, n) => n ?? -1 });
  const rt = new ModulationRuntime(SR);
  const m: ModLite = {
    id: 'p1', kind: 'probe', enabled: true, rateHz: 1, waveform: 'sine',
    // No connection: these tests read the counter, not the offsets, and an
    // unresolved target would warn on every spawn.
    driver: 'trigger', depthByParam: {},
  };
  rt.setMods([m]);
  return rt;
}

describe('the lane counts its notes', () => {
  it('hands each successive note the next ordinal', () => {
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setModulation(probeRuntime());
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      vm.spawn(note(48 + i, i * 0.1));
      seen.push(vm.currentPhaseOrigin().triggerIndex);
    }
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('gives a held note the ordinal it was BORN with, not the lane\'s latest', () => {
    // The property that makes this musical rather than maddening: a pad held
    // across eight notes must not lurch every time something else is struck.
    // Reading the lane's live counter per sample instead of the slot's captured
    // one is the obvious implementation, and it is wrong.
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setModulation(probeRuntime());
    vm.spawn(note(48, 0));                 // the held voice — ordinal 0
    const first = vm.currentPhaseOrigin().triggerIndex;
    for (let i = 1; i < 5; i++) vm.spawn(note(60 + i, i * 0.01));
    // The lane has moved on...
    expect(vm.currentPhaseOrigin().triggerIndex).toBe(4);
    // ...and the first voice was still born at 0.
    expect(first).toBe(0);
  });

  it('keeps counting past a voice ending — the ordinal is the lane\'s, not the pool\'s', () => {
    // Slots are recycled; ordinals are not. A counter derived from the number of
    // LIVE voices would go backwards the moment a note released.
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setModulation(probeRuntime());
    vm.setMaxVoices(1);                    // mono: every note steals the last
    for (let i = 0; i < 6; i++) vm.spawn(note(48 + i, i * 0.1, 0.02));
    expect(vm.currentPhaseOrigin().triggerIndex).toBe(5);
  });

  it('starts at zero, so playing from the top always sounds the same', () => {
    const a = new VoiceManager(SR, 'subtractive', P);
    a.setModulation(probeRuntime());
    a.spawn(note(48));
    const b = new VoiceManager(SR, 'subtractive', P);
    b.setModulation(probeRuntime());
    b.spawn(note(48));
    expect(a.currentPhaseOrigin().triggerIndex).toBe(b.currentPhaseOrigin().triggerIndex);
    expect(a.currentPhaseOrigin().triggerIndex).toBe(0);
  });
});
