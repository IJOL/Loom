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
