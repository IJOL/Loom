// src/audio-dsp/live-params.dsp.test.ts
// Live continuous params: turning a knob must change the note ALREADY sounding,
// like an analogue synth — not just the next trigger. Drives the REAL path
// (VoiceManager → smoother → renderer) sample by sample, no AudioContext.
//
// Every "it changed" test carries a negative control, because a brightness
// measurement drifts on its own as an envelope decays: without the control, a
// test can pass while the knob does nothing.
import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { registerRenderer } from './renderer-registry';
// Side-effect imports: register the real renderers.
import './tb303-renderer';
import './wavetable-renderer';
import './subtractive-renderer';

const SR = 48000;

const note = (o: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 45, beginSec: 0, durationSec: 2, velocity: 0.9, accent: false, slide: false, ...o });

/** Render one sustained note, optionally turning a knob part-way through.
 *  `turnAtSec` null ⇒ the negative control: same note, nobody touches anything. */
export function renderWithTurn(
  engineId: string, params: ParamBag, seconds: number,
  turnAtSec: number | null, patch: ParamBag | null,
): number[] {
  const vm = new VoiceManager(SR, engineId, params);
  vm.spawn(note({ durationSec: seconds }));
  const total = Math.floor(SR * seconds);
  const turnSample = turnAtSec == null ? -1 : Math.floor(turnAtSec * SR);
  const out: number[] = new Array(total);
  for (let i = 0; i < total; i++) {
    if (i === turnSample && patch) vm.setParams(patch);
    out[i] = vm.renderSample(i / SR);
  }
  return out;
}

describe('VoiceManager live param bag', () => {
  it('hands each voice the SAME bag object it keeps smoothing', () => {
    const seen: ParamBag[] = [];
    registerRenderer('probe-live', (): VoiceRenderer => ({
      done: false,
      noteOff() {},
      renderSample() { return 0; },
      setLiveParams(live: ParamBag) { seen.push(live); },
    }));
    const vm = new VoiceManager(SR, 'probe-live', { 'filter.cutoff': 0.3 });
    vm.spawn(note());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(vm.liveParams);
    expect(seen[0]['filter.cutoff']).toBe(0.3);
  });

  it('seeds the live bag from the constructor params without a ramp', () => {
    const vm = new VoiceManager(SR, 'tb303', { 'filter.cutoff': 0.7 });
    expect(vm.liveParams['filter.cutoff']).toBe(0.7);
  });

  it('setParams moves the live bag toward the new value over time', () => {
    const vm = new VoiceManager(SR, 'tb303', { 'filter.cutoff': 0.2 });
    vm.spawn(note());
    vm.setParams({ 'filter.cutoff': 0.9 });
    // Not there yet after one sample...
    vm.renderSample(0);
    expect(vm.liveParams['filter.cutoff']).toBeLessThan(0.3);
    // ...and exactly there after the ramp. A mid-range move takes ~11 time
    // constants (~165ms at the 15ms default) to satisfy the convergence
    // epsilon, so give it SR * 0.3, not SR * 0.1 (see param-smoother.ts).
    for (let i = 1; i < SR * 0.3; i++) vm.renderSample(i / SR);
    expect(vm.liveParams['filter.cutoff']).toBe(0.9);
  });

  it('AT REST nothing changes: an untouched render is identical to today', () => {
    const params = { 'filter.cutoff': 0.4, 'env.amount': 0.3 };
    const a = renderWithTurn('tb303', params, 0.3, null, null);
    // Re-setting a param to the value it already holds must not start a ramp,
    // so this render has to match the untouched one sample for sample.
    const b = renderWithTurn('tb303', params, 0.3, 0.1, { 'filter.cutoff': 0.4 });
    expect(b).toEqual(a);
  });
});

/** Spectral brightness proxy: energy of the first difference over total energy.
 *  Opening a lowpass passes more high frequency, so consecutive samples differ
 *  more relative to the signal's own energy. Relative by construction, and no FFT.
 *  Exported: Tasks 4-6 measure their engines the same way. */
export function brightness(buf: number[], from: number, to: number): number {
  let d = 0, e = 0;
  for (let i = from + 1; i < to; i++) {
    const df = buf[i] - buf[i - 1];
    d += df * df;
    e += buf[i] * buf[i];
  }
  return e > 1e-12 ? d / e : 0;
}

/** Largest jump between consecutive samples in a window — a click detector. */
export function maxStep(buf: number[], from: number, to: number): number {
  let m = 0;
  for (let i = from + 1; i < to; i++) {
    const s = Math.abs(buf[i] - buf[i - 1]);
    if (s > m) m = s;
  }
  return m;
}

describe('TB-303 continuous params', () => {
  // env.amount 0 switches OFF the 303's own filter envelope, so the KNOB is the
  // only thing driving the cutoff. At its default the decaying envelope dominates
  // the first half and would mask the gesture under test.
  const BASE: ParamBag = { 'filter.cutoff': 0.2, 'env.amount': 0, 'filter.resonance': 0.3 };
  const SECONDS = 1;
  const HALF = Math.floor(SR * SECONDS / 2);
  const END = Math.floor(SR * SECONDS);
  // Skip the 15 ms slew itself when measuring the second half, so the numbers
  // describe the settled sound rather than the ramp.
  const AFTER = HALF + Math.floor(SR * 0.05);

  it('opening the cutoff mid-note brightens the note ALREADY sounding', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'filter.cutoff': 0.95 });
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeGreaterThan(before * 2);
  });

  it('negative control: untouched, both halves sound the same', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, null, null);
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeLessThan(before * 1.5);
    expect(after).toBeGreaterThan(before * 0.67);
  });

  it('closing the cutoff mid-note darkens it — the gesture works both ways', () => {
    const open: ParamBag = { ...BASE, 'filter.cutoff': 0.95 };
    const buf = renderWithTurn('tb303', open, SECONDS, 0.5, { 'filter.cutoff': 0.2 });
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeLessThan(before * 0.5);
  });

  it('resonance is live too', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'filter.resonance': 0.95 });
    const ctl = renderWithTurn('tb303', BASE, SECONDS, null, null);
    // Same window, one with the res turn and one without: the sound must differ.
    let diff = 0, energy = 0;
    for (let i = AFTER; i < END; i++) { diff += Math.abs(buf[i] - ctl[i]); energy += Math.abs(ctl[i]); }
    expect(diff / Math.max(energy, 1e-9)).toBeGreaterThan(0.1);
  });

  it('the change does not click', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'filter.cutoff': 0.95 });
    // The waveform's own steepest slope, measured where the knob is settled and
    // the filter is fully open — the loudest, brightest part of the render.
    const reference = maxStep(buf, END - Math.floor(SR * 0.2), END);
    // Across the turn there must be no jump bigger than the signal already makes.
    const across = maxStep(buf, HALF - 32, HALF + Math.floor(SR * 0.03));
    expect(across).toBeLessThanOrEqual(reference);
  });

  it('the waveform is STRUCTURAL: switching it mid-note leaves the note alone', () => {
    const withSwitch = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'osc.wave': 1 });
    const control = renderWithTurn('tb303', BASE, SECONDS, null, null);
    expect(withSwitch).toEqual(control);
  });
});

describe('Subtractive continuous params', () => {
  const BASE: ParamBag = {
    'filter.cutoff': 0.2, 'filter.resonance': 0.2, 'filter.envAmount': 0,
    'amp.builtinEnv': 1, 'amp.attack': 0.005, 'amp.decay': 0.5, 'amp.sustain': 1, 'amp.release': 0.2,
    'osc1.level': 0.6, 'osc2.level': 0.4,
  };
  const SECONDS = 1;
  const HALF = Math.floor(SR * SECONDS / 2);
  const END = Math.floor(SR * SECONDS);
  const AFTER = HALF + Math.floor(SR * 0.05);

  it('opening the cutoff mid-note brightens the sounding note', () => {
    const buf = renderWithTurn('subtractive', BASE, SECONDS, 0.5, { 'filter.cutoff': 0.95 });
    expect(brightness(buf, AFTER, END)).toBeGreaterThan(brightness(buf, 0, HALF) * 2);
  });

  it('negative control: untouched, both halves match', () => {
    const buf = renderWithTurn('subtractive', BASE, SECONDS, null, null);
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeLessThan(before * 1.5);
    expect(after).toBeGreaterThan(before * 0.67);
  });

  it('an oscillator level is live', () => {
    // osc2.detune pinned to 0 for this one: BASE's default 7-cent detune puts
    // osc1 (saw) and osc2 (square) in a near-unison beat that, at this note's
    // pitch through this resonant lowpass, happens to lock into a phase where
    // osc1 partially cancels osc2 rather than adding to it — so zeroing osc1
    // can fail to shrink total RMS even though the level IS live (verified with
    // a static, untouched render: same near-cancellation, unrelated to Task 4).
    // Locking both oscillators to the same pitch removes that confound.
    const params: ParamBag = { ...BASE, 'osc2.detune': 0 };
    const buf = renderWithTurn('subtractive', params, SECONDS, 0.5, { 'osc1.level': 0 });
    const ctl = renderWithTurn('subtractive', params, SECONDS, null, null);
    const rms = (b: number[]) => {
      let s = 0;
      for (let i = AFTER; i < END; i++) s += b[i] * b[i];
      return Math.sqrt(s / (END - AFTER));
    };
    expect(rms(buf)).toBeLessThan(rms(ctl) * 0.8);
  });

  it('dropping a level to zero does not click', () => {
    const buf = renderWithTurn('subtractive', BASE, SECONDS, 0.5, { 'osc1.level': 0 });
    const reference = maxStep(buf, Math.floor(SR * 0.2), HALF - 32);
    const across = maxStep(buf, HALF - 32, HALF + Math.floor(SR * 0.03));
    expect(across).toBeLessThanOrEqual(reference);
  });

  it('the ENVELOPE times stay frozen: shortening the attack mid-note changes nothing', () => {
    // Excluded by design — our envelopes are closed-form over elapsed time, so
    // re-reading the attack mid-note would step the amplitude. See the spec.
    const slow: ParamBag = { ...BASE, 'amp.attack': 0.8 };
    const withTurn = renderWithTurn('subtractive', slow, SECONDS, 0.2, { 'amp.attack': 0.001 });
    const control = renderWithTurn('subtractive', slow, SECONDS, null, null);
    expect(withTurn).toEqual(control);
  });

  it('the filter MODEL stays frozen: swapping it mid-note changes nothing', () => {
    const withTurn = renderWithTurn('subtractive', BASE, SECONDS, 0.5, { 'filter.model': 1 });
    const control = renderWithTurn('subtractive', BASE, SECONDS, null, null);
    expect(withTurn).toEqual(control);
  });

  it('a knob never written before still reaches the sounding note (production starts from an empty bag)', () => {
    // The worklet builds each lane as `new VoiceManager(sr, engineId, {})` and the
    // engine posts a param only when it is first written, so a first-ever write is
    // the NORMAL case, not a corner one.
    const empty: ParamBag = {};
    const turned = renderWithTurn('subtractive', empty, SECONDS, 0.5, { 'filter.cutoff': 0.95 });
    const control = renderWithTurn('subtractive', empty, SECONDS, null, null);
    let diff = 0, energy = 0;
    for (let i = AFTER; i < END; i++) { diff += Math.abs(turned[i] - control[i]); energy += Math.abs(control[i]); }
    expect(diff / Math.max(energy, 1e-9)).toBeGreaterThan(0.1);
  });

  it('every voice of a lane follows the one shared snapshot', () => {
    // The design's central claim: the lane owns ONE SubParams and all its voices
    // read through it. Two voices, one knob turn, both must move.
    const vm = new VoiceManager(SR, 'subtractive', BASE);
    vm.spawn({ midi: 45, beginSec: 0, durationSec: SECONDS, velocity: 0.9, accent: false, slide: false });
    vm.spawn({ midi: 52, beginSec: 0, durationSec: SECONDS, velocity: 0.9, accent: false, slide: false });
    const total = Math.floor(SR * SECONDS);
    const turn = Math.floor(SR * 0.5);
    const withTurn: number[] = new Array(total);
    for (let i = 0; i < total; i++) {
      if (i === turn) vm.setParams({ 'filter.cutoff': 0.95 });
      withTurn[i] = vm.renderSample(i / SR);
    }
    expect(brightness(withTurn, AFTER, END)).toBeGreaterThan(brightness(withTurn, 0, HALF) * 2);
  });
});
