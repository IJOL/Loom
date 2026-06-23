// src/audio-dsp/drums/drum-voice-manager.test.ts
// The DrumVoiceManager pools one-shot drum renderers, applies choke groups (a new
// hit cuts ringing group-mates), and renders each voice into its own output of an
// 8-output block (output index = DRUM_VOICE_IDS index). Assertions are relative.
import { describe, it, expect } from 'vitest';
import { DrumVoiceManager } from './drum-voice-manager';
import { DRUM_VOICE_IDS } from './types';

const SR = 48000;

/** Render `frames` samples starting at absolute frame `frame0` into 8 fresh
 *  mono outputs and return them (index = DRUM_VOICE_IDS index). */
const block = (vm: DrumVoiceManager, frames: number, frame0 = 0): Float32Array[] => {
  const outs = Array.from({ length: 8 }, () => new Float32Array(frames));
  vm.renderInto(outs, frame0);
  return outs;
};
const rms = (a: Float32Array): number =>
  Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('DrumVoiceManager', () => {
  it('renders a spawned hit into that voice output only', () => {
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('kick', { startFreq: 200, endFreq: 60, sweep: 0.03, decay: 0.3, attack: 0.5, wave: 0, tune: 1, chokeGroup: 0 });
    vm.spawn({ voice: 'kick', beginSec: 0, velocity: 0.9 });
    const outs = block(vm, SR * 0.05);
    expect(rms(outs[DRUM_VOICE_IDS.indexOf('kick')])).toBeGreaterThan(0.01); // kick = index 0
    expect(rms(outs[DRUM_VOICE_IDS.indexOf('snare')])).toBe(0);              // snare silent
  });

  it('choke: a closed-hat hit cuts a ringing open hat (same group)', () => {
    // Free-ringing reference: an open hat alone, measured over a 100 ms window
    // starting at 20 ms.
    const ref = new DrumVoiceManager(SR);
    ref.setVoiceParams('openHat', { decay: 0.5, filter: 7000, tune: 1.2, chokeGroup: 1 });
    ref.spawn({ voice: 'openHat', beginSec: 0, velocity: 0.9 });
    ref.renderInto(Array.from({ length: 8 }, () => new Float32Array(SR * 0.02)), 0); // 0–20 ms
    const refTail = block(ref, Math.floor(SR * 0.1), Math.floor(SR * 0.02));
    const freeOH = rms(refTail[DRUM_VOICE_IDS.indexOf('openHat')]);

    // Same setup, but a closed-hat hit at 20 ms chokes the ringing open hat.
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('openHat',   { decay: 0.5,  filter: 7000, tune: 1.2, chokeGroup: 1 });
    vm.setVoiceParams('closedHat', { decay: 0.05, filter: 7000, tune: 1.2, chokeGroup: 1 });
    vm.spawn({ voice: 'openHat', beginSec: 0, velocity: 0.9 });
    block(vm, Math.floor(SR * 0.02));                                      // OH rings ~20 ms
    vm.spawn({ voice: 'closedHat', beginSec: 0.02, velocity: 0.9 });       // choke the OH
    const after = block(vm, Math.floor(SR * 0.1), Math.floor(SR * 0.02));
    const chokedOH = rms(after[DRUM_VOICE_IDS.indexOf('openHat')]);

    // The choked open hat carries much less energy after the cut than a free one.
    expect(chokedOH).toBeLessThan(freeOH * 0.5);
  });

  it('a new hit of the same voice cuts its own ringing tail (self-choke in group)', () => {
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('openHat', { decay: 0.5, filter: 7000, tune: 1.2, chokeGroup: 1 });
    vm.spawn({ voice: 'openHat', beginSec: 0, velocity: 0.9 });
    block(vm, Math.floor(SR * 0.02));                 // first OH rings 20 ms
    expect(vm.activeCount).toBe(1);
    vm.spawn({ voice: 'openHat', beginSec: 0.02, velocity: 0.9 }); // retrigger
    // Render past the 6 ms choke fade: the original ring is gone, only the new one lives.
    block(vm, Math.floor(SR * 0.05), Math.floor(SR * 0.02));
    expect(vm.activeCount).toBe(1);
  });

  it('voices in different (or zero) choke groups do not cut each other', () => {
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('kick',  { startFreq: 200, endFreq: 60, sweep: 0.03, decay: 0.4, attack: 0, wave: 0, tune: 1, chokeGroup: 0 });
    vm.setVoiceParams('snare', { tone1: 240, tone2: 360, bodyDecay: 0.04, tone: 0.35, snap: 0.75, noiseDecay: 0.18, noiseTone: 7000, tune: 1, chokeGroup: 0 });
    vm.spawn({ voice: 'kick', beginSec: 0, velocity: 0.9 });
    block(vm, Math.floor(SR * 0.01));
    vm.spawn({ voice: 'snare', beginSec: 0.01, velocity: 0.9 });
    // both alive — group 0 never chokes
    expect(vm.activeCount).toBe(2);
    const outs = block(vm, Math.floor(SR * 0.03), Math.floor(SR * 0.01));
    expect(rms(outs[DRUM_VOICE_IDS.indexOf('kick')])).toBeGreaterThan(0);
    expect(rms(outs[DRUM_VOICE_IDS.indexOf('snare')])).toBeGreaterThan(0);
  });

  it('frees finished voices (activeCount returns to 0)', () => {
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('kick', { startFreq: 200, endFreq: 60, sweep: 0.03, decay: 0.2, attack: 0, wave: 0, tune: 1, chokeGroup: 0 });
    vm.spawn({ voice: 'kick', beginSec: 0, velocity: 0.9 });
    block(vm, Math.floor(SR * 1.0));
    expect(vm.activeCount).toBe(0);
  });
});
