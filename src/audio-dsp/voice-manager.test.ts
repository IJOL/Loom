import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import type { SubParams, NoteSpec } from './types';

const SR = 48000;
const P: SubParams = {
  masterTune: 0, osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0, osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7,
  subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6, filterCutoff: 0.6, filterResonance: 0.2, filterEnvAmount: 0.4,
  filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1, filterAttack: 0.01, filterDecay: 0.2,
  filterSustain: 0.5, filterRelease: 0.2, ampBuiltinEnv: 1, ampAttack: 0.01, ampDecay: 0.2,
  ampSustain: 0.8, ampRelease: 0.2,
};
const note = (midi: number, begin = 0): NoteSpec =>
  ({ midi, beginSec: begin, durationSec: 0.5, velocity: 0.8, accent: false, slide: false });
const render = (vm: VoiceManager, from: number, to: number) => {
  let r = 0; for (let i = from; i < to; i++) { const s = vm.renderSample(i / SR); r += s * s; }
  return Math.sqrt(r / (to - from));
};

describe('VoiceManager', () => {
  it('caps active voices at maxVoices, stealing the oldest', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(3);
    for (let i = 0; i < 6; i++) vm.spawn(note(48 + i));
    expect(vm.activeCount).toBeLessThanOrEqual(3);
  });

  it('a retrigger of the same midi replaces, not stacks', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(8);
    vm.spawn(note(60)); vm.spawn(note(60)); vm.spawn(note(60));
    expect(vm.activeCount).toBe(1);
  });

  it('renders louder with more simultaneous voices', () => {
    const one = new VoiceManager(SR, P); one.setMaxVoices(8); one.spawn(note(50));
    const many = new VoiceManager(SR, P); many.setMaxVoices(8);
    for (const m of [50, 54, 57, 61]) many.spawn(note(m));
    expect(render(many, 0, SR * 0.1)).toBeGreaterThan(render(one, 0, SR * 0.1));
  });

  it('frees finished voices so activeCount returns to 0', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(8); vm.spawn(note(60));
    for (let i = 0; i < SR * 1.5; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBe(0);
  });

  it('steal(n) silences the n oldest voices early', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(8);
    for (const m of [50, 52, 54]) vm.spawn(note(m));
    for (let i = 0; i < SR * 0.05; i++) vm.renderSample(i / SR);
    vm.steal(2);
    for (let i = SR * 0.05; i < SR * 0.6; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBeLessThanOrEqual(1);
  });
});
