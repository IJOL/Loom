import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
// `test/plugin-dsp` installs the Loom global a plugin's dsp.ts registers
// through, so it MUST stay above the plugin import below.
import '../../test/plugin-dsp';
import '../../plugins/subtractive/dsp';   // side-effect: registers the 'subtractive' renderer
import { registerRenderer } from './renderer-registry';
import type { ParamBag, NoteSpec, VoiceRenderer } from './types';

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

  it('a retrigger of the same midi releases the old voice — no unbounded stacking', () => {
    const vm = new VoiceManager(SR, 'subtractive', P); vm.setMaxVoices(8);
    vm.spawn(note(60)); vm.spawn(note(60)); vm.spawn(note(60));
    // The two stolen voices stay in the loop only long enough to render their
    // release (they were note-off'd at spawn), then self-free via done. After
    // the release window only the live retrigger remains.
    for (let i = 0; i < SR * 0.45; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBe(1);
  });

  it('a same-midi retrigger does not click — the stolen voice renders its release', () => {
    // The transcription-clip bug (tb303-bs.json): back-to-back same-pitch notes
    // made spawn() splice the old voice out of the render loop, so its release
    // never rendered and the discarded amplitude landed as a step (audible
    // click, the same physics that killed the finite voice cap). Two passes:
    // find a retrigger instant where the sustaining voice is NOT near a zero
    // crossing (so the step can't hide), then retrigger there and compare the
    // step across the boundary against the signal's own slew just before it —
    // relative, not absolute: a clean steal stays within the waveform's slew
    // scale (~3×); a splice jumps by the whole discarded amplitude (>5×).
    // A CLOSED filter makes the tone near-sinusoidal so the local slew is a
    // meaningful yardstick — a bright saw's own band-limited edge is already
    // step-sized and would mask the splice.
    const SMOOTH: ParamBag = { 'filter.cutoff': 0.2, 'filter.resonance': 0.2 };
    const dry = new VoiceManager(SR, 'subtractive', SMOOTH); dry.setMaxVoices(8);
    dry.spawn(note(48));
    const probe: number[] = [];
    for (let i = 0; i < SR * 0.35; i++) probe.push(dry.renderSample(i / SR));
    let peak = 0;
    for (let i = Math.floor(SR * 0.2); i < probe.length; i++) peak = Math.max(peak, Math.abs(probe[i]));
    let retrigAt = -1;
    for (let i = Math.floor(SR * 0.25); i < probe.length; i++) {
      if (Math.abs(probe[i]) > peak * 0.7) { retrigAt = i; break; }
    }
    expect(retrigAt).toBeGreaterThan(0);

    const vm = new VoiceManager(SR, 'subtractive', SMOOTH); vm.setMaxVoices(8);
    vm.spawn(note(48));
    const buf: number[] = [];
    for (let i = 0; i < retrigAt + SR * 0.05; i++) {
      if (i === retrigAt) vm.spawn(note(48, i / SR));
      buf.push(vm.renderSample(i / SR));
    }
    let slewBefore = 0;
    for (let i = retrigAt - Math.floor(SR * 0.01); i < retrigAt - 1; i++) {
      slewBefore = Math.max(slewBefore, Math.abs(buf[i] - buf[i - 1]));
    }
    let step = 0;
    for (let i = retrigAt; i < retrigAt + 4; i++) step = Math.max(step, Math.abs(buf[i] - buf[i - 1]));
    expect(step).toBeLessThan(slewBefore * 3);
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

  it('scales every voice by the engine output trim the host handed it', () => {
    registerRenderer('probe-trim', (): VoiceRenderer => ({
      done: false, noteOff() {}, renderSample() { return 1; },
    }));
    const n = { midi: 60, beginSec: 0, durationSec: 1, velocity: 1, accent: false, slide: false };
    const full = new VoiceManager(SR, 'probe-trim', {});
    const half = new VoiceManager(SR, 'probe-trim', {}, 0.5);
    full.spawn(n); half.spawn(n);
    // Relative: the trimmed lane must be exactly half the untrimmed one.
    expect(half.renderSample(0) / full.renderSample(0)).toBeCloseTo(0.5, 10);
  });
});
