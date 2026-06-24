import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import './subtractive-renderer';   // side-effect: registers the 'subtractive' renderer
import type { ParamBag, NoteSpec } from './types';

const SR = 48000;
// Empty bag → the subtractive renderer fills its own defaults via param().
const P: ParamBag = {};
const note = (midi: number, begin = 0): NoteSpec =>
  ({ midi, beginSec: begin, durationSec: 0.5, velocity: 0.8, accent: false, slide: false });
const render = (vm: VoiceManager, from: number, to: number) => {
  let r = 0; for (let i = from; i < to; i++) { const s = vm.renderSample(i / SR); r += s * s; }
  return Math.sqrt(r / (to - from));
};

describe('VoiceManager', () => {
  it('polyphonic lanes are UNCAPPED — voices accumulate, no eviction (an artificial cap clicked)', () => {
    const vm = new VoiceManager(SR, 'subtractive', P); vm.setMaxVoices(3);
    for (let i = 0; i < 6; i++) vm.spawn(note(48 + i));
    expect(vm.activeCount).toBe(6);   // poly does NOT steal — all 6 distinct notes sound
  });

  it('mono lane (maxVoices 1) stays monophonic — a new note steals the previous', () => {
    const vm = new VoiceManager(SR, 'subtractive', P); vm.setMaxVoices(1);
    for (let i = 0; i < 4; i++) vm.spawn(note(48 + i));
    expect(vm.activeCount).toBe(1);
  });

  it('a retrigger of the same midi replaces, not stacks', () => {
    const vm = new VoiceManager(SR, 'subtractive', P); vm.setMaxVoices(8);
    vm.spawn(note(60)); vm.spawn(note(60)); vm.spawn(note(60));
    expect(vm.activeCount).toBe(1);
  });

  it('renders louder with more simultaneous voices', () => {
    const one = new VoiceManager(SR, 'subtractive', P); one.setMaxVoices(8); one.spawn(note(50));
    const many = new VoiceManager(SR, 'subtractive', P); many.setMaxVoices(8);
    for (const m of [50, 54, 57, 61]) many.spawn(note(m));
    expect(render(many, 0, SR * 0.1)).toBeGreaterThan(render(one, 0, SR * 0.1));
  });

  it('frees finished voices so activeCount returns to 0', () => {
    const vm = new VoiceManager(SR, 'subtractive', P); vm.setMaxVoices(8); vm.spawn(note(60));
    for (let i = 0; i < SR * 1.5; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBe(0);
  });

  it('steal(n) silences the n oldest voices early', () => {
    const vm = new VoiceManager(SR, 'subtractive', P); vm.setMaxVoices(8);
    for (const m of [50, 52, 54]) vm.spawn(note(m));
    for (let i = 0; i < SR * 0.05; i++) vm.renderSample(i / SR);
    vm.steal(2);
    for (let i = SR * 0.05; i < SR * 0.6; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBeLessThanOrEqual(1);
  });
});
