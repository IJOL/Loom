// The live modulation telemetry (the knob rings / the LFO graph in the UI) is
// computed by ModulationRuntime.activeOffsets. The worklet used to call it with
// NO phase origin, so it defaulted to {0,0} — the free+shared origin — and the
// rings drew every LFO free-running regardless of TRIG/SCOPE. So a note-
// triggered LFO looked identical to a free one on screen even though the audio
// retriggered. This pins the fix: the VoiceManager exposes the origin the audio
// actually uses, and feeding it to activeOffsets makes the telemetry follow the
// most recent note.

import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import { ModulationRuntime, type ModLite } from './modulation-runtime';
import './tb303-renderer';   // register the renderer so spawn() can build a voice

const SR = 44100;

function note(beginSec: number) {
  return { midi: 40, beginSec, durationSec: 0.5, velocity: 0.8, accent: false, slide: false };
}

const noteLfo: ModLite = {
  id: 'l1', kind: 'lfo', enabled: true, rateHz: 3, waveform: 'sine',
  trigger: 'note', scope: 'shared', depthByParam: { filterCutoff: 1 },
};

describe('VoiceManager.currentPhaseOrigin — the origin the telemetry must use', () => {
  it('follows the most recent note-on', () => {
    const vm = new VoiceManager(SR, 'tb303', { 'filter.cutoff': 0.3 });
    vm.setMaxVoices(1);
    vm.spawn(note(1.1));
    const o = vm.currentPhaseOrigin();
    expect(o.lastNoteOnT).toBeCloseTo(1.1, 6);
    expect(o.voiceStartT).toBeCloseTo(1.1, 6);
  });

  it('is the free origin {0,0} when no note has played', () => {
    const vm = new VoiceManager(SR, 'tb303', { 'filter.cutoff': 0.3 });
    const o = vm.currentPhaseOrigin();
    expect(o.lastNoteOnT).toBe(0);
    expect(o.voiceStartT).toBe(0);
  });
});

describe('telemetry with the current origin reflects TRIG=note (the bug fix)', () => {
  it('activeOffsets(t, currentPhaseOrigin) shows the retrigger; the default origin hides it', () => {
    const vm = new VoiceManager(SR, 'tb303', { 'filter.cutoff': 0.3 });
    vm.setMaxVoices(1);
    const rt = new ModulationRuntime(SR);
    rt.setMods([noteLfo]);
    vm.setModulation(rt);

    const t = 1.1;
    vm.spawn(note(t));   // note-on exactly at t → a note-triggered LFO is at phase 0

    const withOrigin = rt.activeOffsets(t, vm.currentPhaseOrigin());
    const withDefault = rt.activeOffsets(t);   // {0,0} — what the worklet used to send

    // Phase 0 of a sine is 0: the correctly-oriented telemetry sits at the
    // reset point. The default origin is a third of the way through the cycle
    // (1.1 s × 3 Hz = phase 0.3), nowhere near 0.
    expect(withOrigin.filterCutoff).toBeCloseTo(0, 5);
    expect(Math.abs(withDefault.filterCutoff)).toBeGreaterThan(0.5);
  });
});
