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
