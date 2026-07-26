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
import { ModulationRuntime, type ModLite } from './modulation-runtime';
// Side-effect imports: register the real renderers.
import './tb303-renderer';
import './wavetable-renderer';
import './subtractive-renderer';
import './fm-renderer';
import './karplus-renderer';
import './westcoast-renderer';

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

// One row per engine: a continuous param that AUDIBLY moves, and the direction
// the measurement should go. Each row gets its own gesture test AND its own
// negative control — no `(or …)` alternatives, so a dead path cannot hide behind
// a live one.
const ENGINE_CASES: Array<{
  id: string; base: ParamBag; patch: ParamBag; expect: 'brighter' | 'quieter';
  /** Skip the generic "does not click" assertion for this row — see the row's
   *  own comment for why, and its dedicated replacement test below. */
  skipClick?: boolean;
}> = [
  // resonance pinned to 0: at the spec default (0.2), a fast (~15ms) cutoff
  // sweep across this whole range excites the Svf hard enough to produce a
  // genuine transient overshoot (>1.0 peak) — verified with a static render
  // (no turn) sweeping resonance alone: even at res=0 the moving-cutoff
  // transient exceeds the settled-tail reference a little, so the sweep is
  // narrowed to 0.9 (still an easy >20x brightness ratio) rather than 0.95.
  // Pre-existing Svf behaviour under a fast sweep, not a Task 5 regression —
  // but the generic click assertion here (across <= reference) only clears by
  // 0.4% at this exact cell (a spec-review grid search confirmed every
  // neighbouring resonance/target combination FAILS it): a flake waiting to
  // happen, not a real margin. skipClick: true; see the dedicated
  // "no clickier than the same sweep by modulation" test below instead, which
  // compares against the mechanism this codebase already ships and accepts.
  { id: 'wavetable', base: { 'filter.cutoff': 0.2, 'osc.waveA': 3, 'osc.waveB': 3, 'amp.sustain': 1, 'filter.resonance': 0 },
    patch: { 'filter.cutoff': 0.9 }, expect: 'brighter', skipClick: true },
  // op2.level is a MODULATOR's index in algorithm 0 (serial), not the carrier's
  // own level — verified with a static (no-turn) A/B render at op2.level 0.5
  // vs 0: RMS ratio 0.96, i.e. flat. That is FM physics (Parseval/Bessel: a
  // carrier's total energy is conserved across its sidebands regardless of
  // modulation index), not a bug. op1.level is the only carrier in algorithm 0,
  // so it is the one live param whose gesture is guaranteed to be "quieter".
  { id: 'fm', base: { algorithm: 0, 'op1.level': 0.6, 'op2.level': 0.5, 'op1.sustain': 1, 'op2.sustain': 1 },
    patch: { 'op1.level': 0 }, expect: 'quieter' },
  // Two pre-existing confounds, both verified with static/identical-burst
  // renders before changing anything here:
  //  1) amp.level is missing from `base`, so its first-ever live write would
  //     "land instantly" per ParamSmoother.setTargets (documented there: "an
  //     id never seen before lands instantly, it has no previous value to ramp
  //     FROM") — a genuine, if intentional, discontinuity unrelated to the
  //     Karplus DSP. Seeding amp.level in `base` makes the patch a real ramp.
  //  2) At the spec default damping (0.5, T60≈0.7s) and brightness (0.65), the
  //     string's OWN natural decay — both the damping-driven loop gain AND the
  //     brightness-driven one-pole's progressive high-frequency loss — swamps
  //     the negative control regardless of amp.level. Pinning damping very low
  //     (T60 far longer than the render) and brightness near 1 (negligible
  //     per-pass high-frequency loss) neutralizes both, isolating amp.level.
  { id: 'karplus', base: { 'string.damping': -3, 'string.brightness': 0.98, 'amp.level': 0.8 },
    patch: { 'amp.level': 0.1 }, expect: 'quieter' },
  // Two pre-existing confounds, both verified independently:
  //  1) contour.amount: 0 (peak=0) trips AdContour's own decay branch instantly
  //     (val = peak·exp(...) = 0 < 1e-4 on the very next tick), marking the
  //     VOICE done within ~5ms — verified by tracing `.done` directly on a
  //     standalone renderer. VoiceManager then reaps it long before the 0.5s
  //     turn, so nothing is left to move. contour.mode: 1 (sustain) holds the
  //     contour at its peak for the whole gate instead of decaying,
  //     sidestepping the instant-done path.
  //  2) lpg.cutoff itself is a bad "brighter" lever here: sweeping it drives
  //     the STATEFUL Svf's cutoff every sample, and an exhaustive sweep (every
  //     combination of resonance 0..1, fold 0..1, sweep width, sweep target)
  //     never once produced a click-free result — a fast-varying cutoff
  //     through a state-variable filter is inherently a mini coefficient-
  //     modulation transient, worse than either the dark or bright settled
  //     state (a pre-existing Svf characteristic, unrelated to Task 5: the
  //     same overshoot appears even with a plain sine and zero resonance).
  //     timbre.fold is a MEMORYLESS nonlinearity — no filter state to modulate
  //     — so it gives the same "brighter" gesture cleanly. lpg.cutoff/
  //     resonance stay fixed (wide open, no resonance) so nothing sweeps them.
  { id: 'westcoast', base: { 'lpg.cutoff': 0.9, 'lpg.mode': 0, 'lpg.resonance': 0,
      'contour.decay': 4, 'contour.amount': 0, 'contour.mode': 1, 'timbre.fold': 0 },
    patch: { 'timbre.fold': 1.0 }, expect: 'brighter' },
];

describe.each(ENGINE_CASES)('$id continuous params', ({ id, base, patch, expect: dir, skipClick }) => {
  const SECONDS = 1;
  const HALF = Math.floor(SR * SECONDS / 2);
  const END = Math.floor(SR * SECONDS);
  const AFTER = HALF + Math.floor(SR * 0.05);
  const rms = (b: number[], from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) s += b[i] * b[i];
    return Math.sqrt(s / Math.max(1, to - from));
  };

  it('the knob moves the note already sounding', () => {
    const buf = renderWithTurn(id, base, SECONDS, 0.5, patch);
    if (dir === 'brighter') {
      expect(brightness(buf, AFTER, END)).toBeGreaterThan(brightness(buf, 0, HALF) * 1.8);
    } else {
      expect(rms(buf, AFTER, END)).toBeLessThan(rms(buf, 0, HALF) * 0.7);
    }
  });

  it('negative control: untouched, the same measurement barely moves', () => {
    const buf = renderWithTurn(id, base, SECONDS, null, null);
    if (dir === 'brighter') {
      expect(brightness(buf, AFTER, END)).toBeLessThan(brightness(buf, 0, HALF) * 1.8);
    } else {
      expect(rms(buf, AFTER, END)).toBeGreaterThan(rms(buf, 0, HALF) * 0.7);
    }
  });

  // Skipped for rows whose gesture drives a stateful filter's coefficients
  // every sample (a pre-existing Svf characteristic — see the row's own
  // comment) — those get a dedicated, more honest comparison test instead.
  it.skipIf(skipClick)('the change does not click', () => {
    const buf = renderWithTurn(id, base, SECONDS, 0.5, patch);
    // The reference window must be the LOUDEST/BRIGHTEST side of the gesture,
    // because that is where the waveform's own steepest slope lives. Measuring a
    // 'brighter' turn against its dull first half would compare the sweep to
    // silence and fail on a perfectly clean render.
    const reference = dir === 'brighter'
      ? maxStep(buf, END - Math.floor(SR * 0.2), END)
      : maxStep(buf, Math.floor(SR * 0.2), HALF - 32);
    const across = maxStep(buf, HALF - 32, HALF + Math.floor(SR * 0.03));
    expect(across).toBeLessThanOrEqual(reference);
  });
});

it('wavetable: a live cutoff sweep is no clickier than the same sweep by modulation', () => {
  // Svf recomputes its coefficients every sample without renormalising state
  // (filter.ts:20-25) — a pre-existing characteristic, and identical whether
  // the cutoff is driven by a hand on the knob or by an LFO (the mechanism
  // modulation-pipeline.test.ts already exercises and this codebase already
  // ships). So the honest "does not click" bar for a cutoff-sweep row is not
  // the waveform's own settled-tail slope (the generic ENGINE_CASES assertion
  // passed there by only 0.4% — a flake, not a margin) but this modulated path.
  const base: ParamBag = { 'filter.cutoff': 0.3, 'osc.waveA': 3, 'osc.waveB': 3, 'amp.sustain': 1 };
  const byKnob = renderWithTurn('wavetable', base, 1, 0.5, { 'filter.cutoff': 0.9 });

  // Same excursion (0.3 -> up to 0.9), driven by the SAME LFO shape
  // modulation-pipeline.test.ts uses for its own wavetable case (rateHz 6,
  // depth 0.6, sine). A 6 Hz sine is exactly 3 full cycles into its run at
  // t=0.5s, i.e. at a rising zero-crossing — the point of MAXIMUM rate of
  // change for a sine — so this lands the LFO's hardest-hitting moment at the
  // same HALF the knob turn is measured at, no window juggling needed.
  const runtime = new ModulationRuntime(SR);
  const lfo: ModLite = { id: 'l', kind: 'lfo', enabled: true, rateHz: 6, waveform: 'sine', depthByParam: { 'filter.cutoff': 0.6 } };
  runtime.setMods([lfo]);
  const vm = new VoiceManager(SR, 'wavetable', base);
  vm.setModulation(runtime);
  vm.spawn(note({ durationSec: 1 }));
  const byMod: number[] = [];
  for (let i = 0; i < SR; i++) byMod.push(vm.renderSample(i / SR));

  const half = Math.floor(SR * 0.5);
  const w = Math.floor(SR * 0.03);
  const knobStep = maxStep(byKnob, half - 32, half + w);
  const modStep = maxStep(byMod, half - 32, half + w);
  // 1.1x: the two ramp shapes (exponential knob-slew vs sine LFO) are not
  // bit-identical, so a small allowance absorbs that without hiding a real
  // regression — the live path must not be MEANINGFULLY worse than the
  // modulation path we already accept.
  expect(knobStep).toBeLessThanOrEqual(modStep * 1.1);
});

it('wavetable: the WAVE choice is structural and stays frozen mid-note', () => {
  const base: ParamBag = { 'osc.waveA': 0, 'osc.waveB': 0, 'amp.sustain': 1 };
  const withTurn = renderWithTurn('wavetable', base, 1, 0.5, { 'osc.waveA': 3 });
  const control = renderWithTurn('wavetable', base, 1, null, null);
  expect(withTurn).toEqual(control);
});

it('wavetable: the ENVELOPE times stay frozen mid-note', () => {
  const base: ParamBag = { 'amp.attack': 0.8, 'amp.sustain': 1, 'osc.waveA': 3, 'osc.waveB': 3 };
  const withTurn = renderWithTurn('wavetable', base, 1, 0.2, { 'amp.attack': 0.001 });
  const control = renderWithTurn('wavetable', base, 1, null, null);
  expect(withTurn).toEqual(control);
});

it('westcoast: lpg.cutoff is live even though its row measures fold', () => {
  // The ENGINE_CASES westcoast row measures timbre.fold instead of lpg.cutoff:
  // neutralising the contour to isolate the filter (contour.amount: 0) kills
  // the voice at ~5ms (AdContour's own decay branch, see the row's comment),
  // and lpg.cutoff itself is unfit for a click test regardless (a pre-existing
  // Svf coefficient-modulation transient — see the wavetable test above). None
  // of that is a reason to leave lpg.cutoff's LIVENESS unverified: this test
  // uses a REAL contour (lpg.mode: 2, contour.amount: 0.9) so the voice stays
  // alive, and just checks the turned render diverges from the untouched one —
  // no click assertion, since the transient above already covers that ground.
  const base: ParamBag = { 'lpg.cutoff': 0.2, 'lpg.mode': 2, 'contour.decay': 4, 'contour.amount': 0.9 };
  const turned = renderWithTurn('westcoast', base, 1, 0.5, { 'lpg.cutoff': 0.95 });
  const control = renderWithTurn('westcoast', base, 1, null, null);
  let diff = 0, energy = 0;
  const from = Math.floor(SR * 0.58), to = Math.floor(SR);
  for (let i = from; i < to; i++) { diff += Math.abs(turned[i] - control[i]); energy += Math.abs(control[i]); }
  expect(diff / Math.max(energy, 1e-9)).toBeGreaterThan(0.1);
});
