// src/audio-dsp/subtractive-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { attachSlots } from '../../test/slot-offsets';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';
import { Svf } from './filter';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;
// Dot-id ParamBag with the subtractive defaults — the shape a real lane sends.
const DEFAULTS: ParamBag = {
  'master.tune': 0,
  'osc1.wave': 0, 'osc1.level': 0.6, 'osc1.detune': 0,
  'osc2.wave': 1, 'osc2.level': 0.4, 'osc2.detune': 7,
  'sub.level': 0.3, 'noise.level': 0, 'noise.color': 0.6,
  'filter.cutoff': 0.55, 'filter.resonance': 0.25, 'filter.envAmount': 0.45,
  'filter.drive': 0, 'filter.keyTrack': 0, 'filter.builtinEnv': 1,
  'filter.attack': 0.01, 'filter.decay': 0.3, 'filter.sustain': 0.4, 'filter.release': 0.35,
  'amp.builtinEnv': 1, 'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.7, 'amp.release': 0.3,
};
const note = (over: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false, ...over });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const midiToFreqLocal = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

describe('SubtractiveVoiceRenderer', () => {
  it('is audible during the gate and decays to ~silence + done after release', () => {
    const v = new SubtractiveVoiceRenderer(note(), DEFAULTS, SR);
    const gate: number[] = [];
    for (let i = 0; i < SR * 0.3; i++) gate.push(v.renderSample(i / SR));
    expect(rms(gate)).toBeGreaterThan(0.02);
    let last = 1;
    for (let i = SR * 0.4; i < SR * 1.2; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);
    expect(v.done).toBe(true);
  });

  it('a higher velocity is louder', () => {
    const loud = (vel: number) => {
      const v = new SubtractiveVoiceRenderer(note({ velocity: vel }), DEFAULTS, SR);
      const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(loud(1.0)).toBeGreaterThan(loud(0.3) * 1.3);
  });

  it('a higher cutoff yields more high-frequency energy (less filtering)', () => {
    const bright = (cut: number) => {
      // resonance 0 isolates the cutoff's effect: a resonant filter rings at the
      // cutoff frequency, inflating the low-cutoff case and confounding the test.
      const v = new SubtractiveVoiceRenderer(note(), { ...DEFAULTS, 'filter.cutoff': cut, 'filter.resonance': 0, 'filter.envAmount': 0 }, SR);
      const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    // Higher cutoff → more pass-through. Measured ratio ~1.71 at resonance 0; assert
    // a robust 1.3× margin (the sub osc + low harmonics pass both cutoffs, so it's not huge).
    expect(bright(0.95)).toBeGreaterThan(bright(0.15) * 1.3);
  });

  it('noteOff before the gate end shortens the sound (earlier silence)', () => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 2 }), DEFAULTS, SR);
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);
    v.noteOff(0.05);
    let last = 1;
    for (let i = SR * 0.05; i < SR * 0.6; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);   // released well before the 2 s gate
  });

  it('honours a live cutoff modulation offset (positive offset = brighter)', () => {
    // Same base/isolation as the 'higher cutoff = brighter' test above, but the
    // cutoff is opened via the live modOffsets path instead of the param: a +0.8
    // offset on a 0.15 base reaches the 0.95 cutoff that measured ~1.71× brighter.
    const bright = (cutMod: number) => {
      const v = new SubtractiveVoiceRenderer(
        note(), { ...DEFAULTS, 'filter.cutoff': 0.15, 'filter.resonance': 0, 'filter.envAmount': 0 }, SR,
      );
      const { mo } = attachSlots(v, { ...DEFAULTS, 'filter.cutoff': 0.15, 'filter.resonance': 0, 'filter.envAmount': 0 });
      const off = mo({ 'filter.cutoff': cutMod });
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR, off));
      return rms(b);
    };
    expect(bright(0.8)).toBeGreaterThan(bright(0) * 1.3);
  });

  it('master-tune modulation shifts pitch (octave-up ≈ doubles the zero-crossing rate)', () => {
    const upwardCrossings = (tuneMod: number) => {
      const v = new SubtractiveVoiceRenderer(
        note(), { ...DEFAULTS, 'osc1.wave': 3, 'osc1.level': 0.8, 'osc2.level': 0, 'sub.level': 0, 'noise.level': 0, 'filter.cutoff': 0.95, 'filter.resonance': 0, 'filter.envAmount': 0 }, SR,
      );
      const { mo } = attachSlots(v, { ...DEFAULTS, 'osc1.wave': 3, 'osc1.level': 0.8, 'osc2.level': 0, 'sub.level': 0, 'noise.level': 0, 'filter.cutoff': 0.95, 'filter.resonance': 0, 'filter.envAmount': 0 });
      const off = mo({ 'master.tune': tuneMod });
      let prev = 0, zc = 0;
      for (let i = 0; i < SR * 0.1; i++) {
        const s = v.renderSample(i / SR, off);
        if (prev < 0 && s >= 0) zc++;
        prev = s;
      }
      return zc;
    };
    // +1 normalised master-tune offset = +12 st = ×2 frequency.
    expect(upwardCrossings(1)).toBeGreaterThan(upwardCrossings(0) * 1.7);
  });

  it('amp-gain modulation scales output loudness (tremolo), down to silence at -1', () => {
    const loud = (g: number) => {
      const v = new SubtractiveVoiceRenderer(note(), DEFAULTS, SR);
      const { mo } = attachSlots(v, DEFAULTS);
      const off = mo({ 'amp.gain': g });
      const b: number[] = [];
      for (let i = 0; i < SR * 0.05; i++) b.push(v.renderSample(i / SR, off));
      return rms(b);
    };
    expect(loud(1)).toBeGreaterThan(loud(0) * 1.5);   // +1 → ~×2
    expect(loud(-1)).toBeLessThan(loud(0) * 0.05);    // -1 → ~silence
  });

  it('filter output stays bounded — no resonant blow-up (master limiter must not be crushed)', () => {
    // Absolute peak ceilings (justified): a voice must stay near unity so the
    // downstream master limiter/soft-clip is not constantly crushed. A peak far
    // above these signals an undamped-SVF regression (the resonance-scale bug).
    const peakOf = (res: number) => {
      const v = new SubtractiveVoiceRenderer(note(), { ...DEFAULTS, 'filter.resonance': res }, SR);
      let peak = 0;
      for (let i = 0; i < SR * 0.6; i++) { const a = Math.abs(v.renderSample(i / SR)); if (a > peak) peak = a; }
      return peak;
    };
    expect(peakOf(0.25)).toBeLessThan(1.5);   // default resonance ~0.99
    expect(peakOf(1.0)).toBeLessThan(4.0);    // max resonance ~2.8, still bounded
  });

  const adsrMod = (depth: number) => ({
    id: 'a', kind: 'adsr' as const, enabled: true, rateHz: 0, waveform: 'sine' as const,
    attackSec: 0.001, decaySec: 0.001, sustain: 1, releaseSec: 0.1,
    depthByParam: { 'filter.cutoff': depth },
  });

  it('a per-voice ADSR modulator brightens the cutoff while gated (envelope-driven)', () => {
    // adsr → filter.cutoff, fast attack/decay, full sustain. With a low base cutoff
    // and no LFO, the open envelope must brighten the voice (same isolation as the
    // live-cutoff-offset test above).
    const bright = (depth: number) => {
      const v = new SubtractiveVoiceRenderer(
        note(), { ...DEFAULTS, 'filter.cutoff': 0.15, 'filter.resonance': 0, 'filter.envAmount': 0 }, SR,
      );
      if (depth > 0) v.setModEnvelopes([adsrMod(depth)], attachSlots(v, { ...DEFAULTS, 'filter.cutoff': 0.15, 'filter.resonance': 0, 'filter.envAmount': 0 }).index);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(bright(0.8)).toBeGreaterThan(bright(0) * 1.3);
  });

  it('getAdsrOffsets follows the gated envelope (the knob-ring source)', () => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 10 }), DEFAULTS, SR);
    const { index: ringIx } = attachSlots(v, DEFAULTS);
    v.setModEnvelopes([{ ...adsrMod(1), sustain: 0.5 }], ringIx);
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);   // settle into sustain
    const ring = v.getAdsrOffsets();
    expect(ring[ringIx.slot['filter.cutoff']]).toBeCloseTo(0.5, 1);   // sustain 0.5 × depth 1
    // After note-off the envelope releases → the ring contribution falls back toward 0.
    v.noteOff(0.05);
    for (let i = SR * 0.05; i < SR * 0.4; i++) v.renderSample(i / SR);
    expect(v.getAdsrOffsets()[ringIx.slot['filter.cutoff']]).toBeLessThan(0.1);
  });

  const ampAdsr = {
    id: 'amp', kind: 'adsr' as const, enabled: true, rateHz: 0, waveform: 'sine' as const,
    attackSec: 0.005, decaySec: 0.01, sustain: 1, releaseSec: 0.05, depthByParam: { amp: 1 },
  };

  it("an ADSR routed to 'amp' becomes the amplitude envelope when the built-in is off", () => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.2 }), { ...DEFAULTS, 'amp.builtinEnv': 0 }, SR);
    v.setModEnvelopes([ampAdsr], attachSlots(v, { ...DEFAULTS, 'amp.builtinEnv': 0 }).index);
    const gate: number[] = [];
    for (let i = 0; i < SR * 0.15; i++) gate.push(v.renderSample(i / SR));
    expect(rms(gate)).toBeGreaterThan(0.02);        // audible while the envelope is open
    let last = 1;
    for (let i = SR * 0.2; i < SR * 0.6; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);     // silent after release
    expect(v.done).toBe(true);                      // and the voice ends (ADSR governs done)
  });

  it("with the built-in amp env ON, an 'amp' ADSR is ignored (presets unchanged)", () => {
    // ampBuiltinEnv=1 (the preset default): the built-in env governs amplitude and
    // the 'amp' ADSR is inert, so existing presets sound exactly as before.
    const r = (withAdsr: boolean) => {
      const v = new SubtractiveVoiceRenderer(note(), DEFAULTS, SR);
      if (withAdsr) v.setModEnvelopes([{ ...ampAdsr, sustain: 0, releaseSec: 0.001 }], attachSlots(v, DEFAULTS).index); // would silence if applied
      const b: number[] = []; for (let i = 0; i < SR * 0.05; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(r(true)).toBeCloseTo(r(false), 5);       // identical — the 'amp' ADSR was ignored
  });

  it("an ADSR routed to 'filterEnv' opens the filter when the built-in env is off", () => {
    // built-in filter env OFF, low base cutoff, a real env amount. An ADSR on
    // 'filterEnv' must brighten the voice (it scales the same envRangeHz path).
    const bright = (withEnv: boolean) => {
      const v = new SubtractiveVoiceRenderer(
        note(), { ...DEFAULTS, 'filter.cutoff': 0.15, 'filter.resonance': 0, 'filter.envAmount': 0.8, 'filter.builtinEnv': 0 }, SR,
      );
      if (withEnv) v.setModEnvelopes([{
        id: 'fe', kind: 'adsr', enabled: true, rateHz: 0, waveform: 'sine',
        attackSec: 0.001, decaySec: 0.001, sustain: 1, releaseSec: 0.1, depthByParam: { 'filter.env': 1 },
      }], attachSlots(v, { ...DEFAULTS, 'filter.cutoff': 0.15, 'filter.resonance': 0, 'filter.envAmount': 0.8, 'filter.builtinEnv': 0 }).index);
      const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(bright(true)).toBeGreaterThan(bright(false) * 1.3);
  });
});

describe('pulse width (PWM)', () => {
  // SquareOsc has always been a pulse oscillator — update(freq, pw) — but the
  // width was never exposed, so every square was stuck at a 50% duty cycle.
  // A param the sound depends on and the UI cannot reach is a hidden param.
  const pulse = (pw: number, wave = 1): number[] => {
    const bag: ParamBag = {
      ...DEFAULTS, 'osc1.wave': wave, 'osc1.level': 1, 'osc2.level': 0,
      'sub.level': 0, 'noise.level': 0,
      'filter.cutoff': 1, 'filter.resonance': 0, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
      'osc1.pw': pw,
    };
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.2 }), bag, SR);
    const b: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
    return b;
  };
  /** How much two renders differ, relative to their own level. */
  const divergence = (a: number[], b: number[]): number => {
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length / Math.max(1e-9, rms(a));
  };

  it('a thin pulse does not sound like a square', () => {
    expect(divergence(pulse(0.5), pulse(0.12))).toBeGreaterThan(0.5);
  });

  it('is symmetric: 0.25 and 0.75 are the same pulse, mirrored', () => {
    // A duty cycle and its complement have the same harmonic content.
    expect(rms(pulse(0.25))).toBeCloseTo(rms(pulse(0.75)), 1);
  });

  it('defaults to a square when no width is given', () => {
    // Same bag as pulse(), minus osc1.pw — so the only variable is the width.
    const bag: ParamBag = {
      ...DEFAULTS, 'osc1.wave': 1, 'osc1.level': 1, 'osc2.level': 0,
      'sub.level': 0, 'noise.level': 0,
      'filter.cutoff': 1, 'filter.resonance': 0, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
    };
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.2 }), bag, SR);
    const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
    expect(divergence(b, pulse(0.5))).toBeLessThan(0.01);
  });

  it('leaves a saw alone — width is a pulse thing', () => {
    expect(divergence(pulse(0.5, 0), pulse(0.12, 0))).toBeLessThan(0.01);
  });
});

/** Magnitude at one frequency (a single Goertzel-style correlation), normalised
 *  by the buffer length so two renders are comparable. */
const energyAt = (buf: number[], freq: number): number => {
  let re = 0, im = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = 2 * Math.PI * freq * i / SR;
    re += buf[i] * Math.cos(a);
    im += buf[i] * Math.sin(a);
  }
  return Math.hypot(re, im) / buf.length;
};

describe('ring modulation', () => {
  // Ring is osc1 × osc2, mixed in as its OWN source next to sub and noise —
  // not a switch that replaces osc2. Everything below is that claim, split into
  // the four things it means.
  const SINES: ParamBag = {
    ...DEFAULTS, 'osc1.wave': 3, 'osc2.wave': 3,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 1, 'filter.resonance': 0, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
  };
  const render = (bag: ParamBag, sec = 0.25): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.5 }), bag, SR);
    const b: number[] = [];
    for (let i = 0; i < SR * sec; i++) b.push(v.renderSample(i / SR));
    return b;
  };

  it('is off by default — a patch that never mentions Ring is bit-identical', () => {
    const a = render(DEFAULTS);
    const b = render({ ...DEFAULTS, 'ring.level': 0 });
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });

  it('survives both oscillators being muted — it is a source, not a modifier', () => {
    // The product is taken from the RAW oscillators, so Ring alone is a sound.
    // Multiplying the level-scaled outputs instead would make this silent, and
    // the knob would be useless in exactly the patch it exists for.
    const bag: ParamBag = { ...SINES, 'osc1.level': 0, 'osc2.level': 0 };
    expect(rms(render({ ...bag, 'ring.level': 0 }))).toBe(0);
    expect(rms(render({ ...bag, 'ring.level': 1 }))).toBeGreaterThan(0.02);
  });

  it('makes tones neither oscillator has — the sum tone, an octave up', () => {
    // Two sines multiplied are cos(f1−f2) − cos(f1+f2): a slow beat and a tone
    // at f1+f2. The sum tone is the audible half, and it is the proof — adding
    // the two sines can never put energy there, however loud they get.
    const f1 = midiToFreqLocal(57);
    const f2 = f1 * Math.pow(2, 7 / 1200);            // osc2.detune = 7 cents
    const sum = f1 + f2;
    const plain = energyAt(render({ ...SINES, 'osc1.level': 1, 'osc2.level': 1 }), sum);
    const ringed = energyAt(render({ ...SINES, 'osc1.level': 0, 'osc2.level': 0, 'ring.level': 1 }), sum);
    expect(ringed).toBeGreaterThan(plain * 20);
  });

  it('is continuous, so an LFO fades the metal in and out', () => {
    const bag: ParamBag = { ...SINES, 'osc1.level': 0.6, 'osc2.level': 0.4, 'ring.level': 0.5 };
    const sweep = (mod: (t: number) => number): number[] => {
      const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.5 }), bag, SR);
      const { index: ix, mo } = attachSlots(v, bag);
      const off = mo({ 'ring.level': 0 });
      const b: number[] = [];
      for (let i = 0; i < SR * 0.2; i++) {
        const t = i / SR;
        off[ix.slot['ring.level']] = mod(t);
        b.push(v.renderSample(t, off));
      }
      return b;
    };
    const still = sweep(() => 0);
    const swept = sweep((t) => Math.sin(2 * Math.PI * 3 * t));
    let diff = 0; for (let i = 0; i < still.length; i++) diff += Math.abs(still[i] - swept[i]);
    expect(diff / still.length).toBeGreaterThan(0.02);
  });
});

describe('PWM is modulation, not a knob', () => {
  // A static width is a pulse. PWM is the width MOVING — the thing that makes a
  // supersaw-era pad breathe. It works because osc1.pw is a continuous param,
  // so the existing per-param LFO reaches it with no wave of its own.
  const bag: ParamBag = {
    ...DEFAULTS, 'osc1.wave': 1, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 1, 'filter.resonance': 0, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
    'osc1.pw': 0.5,
  };
  const render = (mod: (t: number) => number): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), bag, SR);
    // ONE pooled offsets array, one slot rewritten per sample — the audio path
    // never allocates here either.
    const { index: ix, mo } = attachSlots(v, bag);
    const off = mo({ 'osc1.pw': 0 });
    const b: number[] = [];
    for (let i = 0; i < SR * 0.2; i++) {
      const t = i / SR;
      off[ix.slot['osc1.pw']] = mod(t);
      b.push(v.renderSample(t, off));
    }
    return b;
  };

  it('an LFO on osc1.pw changes the sound over time', () => {
    const still = render(() => 0);
    const swept = render((t) => Math.sin(2 * Math.PI * 4 * t));   // 4 Hz sweep
    let diff = 0;
    for (let i = 0; i < still.length; i++) diff += Math.abs(still[i] - swept[i]);
    expect(diff / still.length).toBeGreaterThan(0.05);
  });

  it('never lets the width reach silence, however hard the LFO pushes', () => {
    // A full-depth LFO would drive the width past 0/1 without the clamp, and a
    // 0-width pulse is no sound at all.
    const slammed = render((t) => (Math.sin(2 * Math.PI * 2 * t) > 0 ? 5 : -5));
    expect(rms(slammed)).toBeGreaterThan(0.01);
  });
});

// Kind indices, from filter-kinds.ts. Named here so a test reads as a sentence.
const LP12DIG = 0, LP24MOG = 1, LP24ACID = 2, HP12DIG = 3, BP12DIG = 6, NOTCHDIG = 9;

describe('filter kind', () => {
  // One dropdown, ten entries. The engine end of it: that the renderer builds
  // the filter the kind names, and that the default is still what every preset
  // was voiced against. The per-entry response measurements live in
  // filter-stack.test.ts, where they can be made without an oscillator.
  const bag = (kind: number): ParamBag => ({
    ...DEFAULTS, 'osc1.wave': 0, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 0.4, 'filter.resonance': 0.7, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
    'filter.kind': kind,
  });
  const render = (kind: number): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), bag(kind), SR);
    const b: number[] = [];
    for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
    return b;
  };
  const divergence = (a: number[], b: number[]): number => {
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length / Math.max(1e-9, rms(a));
  };
  const mean = (b: number[]) => Math.abs(b.reduce((s, v) => s + v, 0) / b.length);

  it('defaults to LP 12 DIG, so nothing that exists today changes', () => {
    const noKind: ParamBag = { ...bag(LP12DIG) };
    delete (noKind as Record<string, number>)['filter.kind'];
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), noKind, SR);
    const b: number[] = []; for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
    expect(divergence(b, render(LP12DIG))).toBeLessThan(0.01);
  });

  it('each lowpass is audibly its own filter', () => {
    expect(divergence(render(LP12DIG), render(LP24MOG))).toBeGreaterThan(0.1);   // svf vs moog
    expect(divergence(render(LP24MOG), render(LP24ACID))).toBeGreaterThan(0.02); // moog vs diode
  });

  it('the 303 lowpass brings the asymmetry the others do not have', () => {
    expect(mean(render(LP24ACID))).toBeGreaterThan(mean(render(LP24MOG)) * 2);
  });

  it('every kind stays bounded through the engine, drive and resonance up', () => {
    // res 0.7 + drive 0.8 is a stress patch: the parallel drive feeds up to 1.8x
    // amplitude into the filter, so an analogue-style rise is EXPECTED. What must
    // not happen is a runaway, so the contract is relative: finite, bounded, and
    // drive raises the peak by a bounded ratio rather than an unbounded one.
    const peakOf = (kind: number, drive: number): number => {
      const v = new SubtractiveVoiceRenderer(
        note({ durationSec: 0.3 }), { ...bag(kind), 'filter.drive': drive }, SR,
      );
      let peak = 0;
      for (let i = 0; i < SR * 0.2; i++) { const a = Math.abs(v.renderSample(i / SR)); if (a > peak) peak = a; }
      return peak;
    };
    for (let kind = 0; kind < 10; kind++) {
      const dry = peakOf(kind, 0);
      const wet = peakOf(kind, 0.8);
      const tag = `kind ${kind}`;
      expect(Number.isFinite(wet), `${tag} went non-finite`).toBe(true);
      expect(wet, `${tag} blew up`).toBeLessThan(4.5);
      expect(wet, `${tag} drive should not reduce peak`).toBeGreaterThanOrEqual(dry);
      expect(wet / Math.max(dry, 1e-6), `${tag} drive ratio unbounded`).toBeLessThan(5);
    }
  });

  it('the notch reaches the engine — it is not the lowpass wearing a label', () => {
    expect(divergence(render(NOTCHDIG), render(LP12DIG))).toBeGreaterThan(0.1);
  });

  it('the highpass and the bandpass reach the engine too', () => {
    expect(divergence(render(HP12DIG), render(LP12DIG))).toBeGreaterThan(0.1);
    expect(divergence(render(BP12DIG), render(LP12DIG))).toBeGreaterThan(0.1);
  });

  // Guards the derivation in filter.ts: the textbook `lp + hp` is structurally
  // pinned at -6 dB in this topology (its bandpass peaks at 0.5/r, not 1/r), so
  // it can never null however the resonance is set.
  it('the notch actually nulls, instead of merely tilting', () => {
    const CUTOFF_HZ = 880;
    const depthAt = (res: number, hz: number): number => {
      const s = new Svf(SR);
      let acc = 0, n = 0;
      for (let i = 0; i < SR * 0.2; i++) {
        s.update(Math.sin(2 * Math.PI * hz * i / SR), CUTOFF_HZ, res);
        if (i > SR * 0.05) { acc += s.notch * s.notch; n++; }
      }
      return Math.sqrt(acc / n);
    };
    for (const res of [0, 0.25, 0.6]) {
      expect(depthAt(res, CUTOFF_HZ), `res ${res}`).toBeLessThan(depthAt(res, CUTOFF_HZ * 8) * 0.4);
    }
  });
});

describe('unison', () => {
  // A supersaw is not two detuned oscillators — it is ONE oscillator stacked N
  // times across a detune spread, which is why "Supersaw" was unportable before:
  // the name IS the feature. Voices default to 1, so every existing preset is
  // untouched.
  const uniBag = (voices: number, over: ParamBag = {}): ParamBag => ({
    ...DEFAULTS, 'osc1.wave': 0, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 1, 'filter.resonance': 0, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
    'amp.builtinEnv': 0,   // flat gain: the level must only move because the STACK moves
    'master.detune': 25,   // declared so an LFO can reach the unison spread
    'master.unison': voices, ...over,
  });
  const render = (voices: number, over: ParamBag = {}, secs = 1): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: secs + 0.2 }), uniBag(voices, over), SR);
    const b: number[] = []; for (let i = 0; i < SR * secs; i++) b.push(v.renderSample(i / SR));
    return b;
  };
  const divergence = (a: number[], b: number[]): number => {
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length / Math.max(1e-9, rms(a));
  };
  /** How much the level wobbles over time. Detuned copies drift in and out of
   *  phase with each other — that beating IS the sound of a unison stack, and a
   *  single oscillator through a flat gain has none of it. */
  const wobble = (b: number[]): number => {
    const win = Math.floor(SR * 0.02);
    const levels: number[] = [];
    for (let i = 0; i + win <= b.length; i += win) levels.push(rms(b.slice(i, i + win)));
    const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
    const varc = levels.reduce((s, v) => s + (v - mean) ** 2, 0) / levels.length;
    return Math.sqrt(varc) / Math.max(1e-9, mean);
  };

  it('defaults to 1 voice, so nothing that exists today changes', () => {
    const noUni: ParamBag = { ...uniBag(1) };
    for (const k of ['master.unison', 'master.detune', 'master.drift']) delete (noUni as Record<string, number>)[k];
    expect(divergence(render(1, {}, 0.2), (() => {
      const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.4 }), noUni, SR);
      const b: number[] = []; for (let i = 0; i < SR * 0.2; i++) b.push(v.renderSample(i / SR));
      return b;
    })())).toBeLessThan(0.01);
  });

  it('the gain compensation is the stack law, not a guess', () => {
    // At spread 0 every copy is the same oscillator from the same start phase, so
    // they sum COHERENTLY: exactly N x one copy, scaled by the 1/N^0.3
    // compensation => N^0.7. That is an exact prediction, so assert it as one.
    const one = rms(render(1, { 'master.detune': 0 }, 0.2));
    const seven = rms(render(7, { 'master.detune': 0 }, 0.2));
    expect(seven / one).toBeCloseTo(Math.pow(7, 0.7), 1);
  });

  it('N detuned voices are nowhere near N times louder', () => {
    // Detuned, the copies are mutually incoherent: they sum ~sqrt(N), and the
    // 1/N^0.3 compensation lands the stack near N^0.2 (~1.5x at N=7) — fatter,
    // which is the point, but not seven times louder.
    const one = rms(render(1, {}, 0.2));
    const seven = rms(render(7, {}, 0.2));
    expect(seven).toBeGreaterThan(one);
    expect(seven).toBeLessThan(one * 3);
  });

  it('a detuned stack beats — that is what makes it a supersaw', () => {
    expect(wobble(render(7))).toBeGreaterThan(wobble(render(1)) * 5);
  });

  it('a wider spread is a different sound from a narrow one', () => {
    expect(divergence(render(7, { 'master.detune': 4 }), render(7, { 'master.detune': 50 }))).toBeGreaterThan(0.3);
  });

  it('drift is off by default, so nothing that exists today changes', () => {
    const noDrift: ParamBag = { ...uniBag(7) };
    delete (noDrift as Record<string, number>)['master.drift'];
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.4 }), noDrift, SR);
    const b: number[] = []; for (let i = 0; i < SR * 0.2; i++) b.push(v.renderSample(i / SR));
    expect(divergence(b, render(7, { 'master.drift': 0 }, 0.2))).toBeLessThan(0.01);
  });

  it('drift pulls apart a stack that detune alone leaves identical', () => {
    // Spread 0 => every copy is the same oscillator => a coherent sum with a
    // dead-steady level (the test above proves it lands on N^0.7). Drift is then
    // the ONLY thing that can pull them apart, so any wobble here is unambiguously
    // the drift wandering each copy's pitch on its own.
    const still = render(7, { 'master.detune': 0, 'master.drift': 0 });
    const drifting = render(7, { 'master.detune': 0, 'master.drift': 1 });
    expect(wobble(drifting)).toBeGreaterThan(wobble(still) * 5);
  });

  it('an LFO on unison.detune sweeps the spread — it is modulation, not a knob', () => {
    const swept = (mod: (t: number) => number): number[] => {
      const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.6 }), uniBag(7), SR);
      const { index: ix, mo } = attachSlots(v, uniBag(7));
      const off = mo({ 'master.detune': 0 });
      const b: number[] = [];
      for (let i = 0; i < SR * 0.4; i++) {
        const t = i / SR;
        off[ix.slot['master.detune']] = mod(t);
        b.push(v.renderSample(t, off));
      }
      return b;
    };
    expect(divergence(swept(() => 0), swept((t) => Math.sin(2 * Math.PI * 3 * t)))).toBeGreaterThan(0.1);
  });

  it('a 7-voice stack stays bounded', () => {
    const peak = render(7, { 'master.drift': 1 }, 0.3).reduce((p, v) => Math.max(p, Math.abs(v)), 0);
    expect(peak).toBeLessThan(4);
  });
});

describe('hard sync wave', () => {
  // The Sync wave routes the stack's second argument to SyncOsc as its ratio.
  // What matters end-to-end: the ratio param reaches the sound, and an LFO on
  // osc1.sync sweeps the timbre — that sweep is the whole reason sync exists.
  const bag = (over: ParamBag = {}): ParamBag => ({
    ...DEFAULTS, 'osc1.wave': 4, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 0.9, 'filter.resonance': 0.1, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
    ...over,
  });
  const render = (over: ParamBag = {}): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.2 }), bag(over), SR);
    const b: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
    return b;
  };
  const divergence = (a: number[], b: number[]): number => {
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length / Math.max(1e-9, rms(a));
  };

  it('makes a sound', () => {
    expect(rms(render({ 'osc1.sync': 3 }))).toBeGreaterThan(0);
  });

  it('the ratio param changes the timbre', () => {
    expect(divergence(render({ 'osc1.sync': 1.5 }), render({ 'osc1.sync': 5 }))).toBeGreaterThan(0.2);
  });

  it('an LFO on osc1.sync sweeps the sound over time', () => {
    // Same static patch, but modulate the ratio — the render must differ from
    // the un-modulated one, which is what proves the LFO reaches the ratio.
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.2 }), bag({ 'osc1.sync': 3 }), SR);
    const still: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) still.push(v.renderSample(i / SR));

    const v2 = new SubtractiveVoiceRenderer(note({ durationSec: 0.2 }), bag({ 'osc1.sync': 3 }), SR);
    const { index: ix2, mo: mo2 } = attachSlots(v2, bag({ 'osc1.sync': 3 }));
    const off2 = mo2({ 'osc1.sync': 0 });
    const swept: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) {
      off2[ix2.slot['osc1.sync']] = Math.sin(2 * Math.PI * 5 * i / SR);
      swept.push(v2.renderSample(i / SR, off2));
    }

    expect(divergence(still, swept)).toBeGreaterThan(0.05);
  });

  it('holds the pitch as the ratio sweeps (this is what sync is)', () => {
    // The pitch is the RESET rate, not the slave's crossing count (the ragged saw
    // has plenty of those and they move with the ratio). The defining property is
    // periodicity at the master period: one master period apart, the waveform
    // repeats — and it does so at the SAME period whatever the ratio.
    const repeatsAtMasterPeriod = (syncRatio: number): number => {
      const b = render({ 'osc1.sync': syncRatio });
      const period = SR / midiToFreqLocal(57);   // master period in samples
      const at = Math.floor(period * 5), next = Math.floor(period * 6);
      // difference relative to the signal's own level — same-period = near 0.
      let d = 0; for (let k = 0; k < 40; k++) d += Math.abs(b[at + k] - b[next + k]);
      return d / 40 / Math.max(1e-9, rms(b));
    };
    // Both ratios repeat cleanly at the master period (< 0.4 relative diff),
    // which is only possible if the pitch did not move with the ratio.
    expect(repeatsAtMasterPeriod(2)).toBeLessThan(0.4);
    expect(repeatsAtMasterPeriod(6)).toBeLessThan(0.4);
  });

  it('a non-sync wave ignores osc1.sync entirely', () => {
    const saw = (r: number) => render({ 'osc1.wave': 0, 'osc1.sync': r });
    expect(divergence(saw(2), saw(7))).toBeLessThan(0.01);
  });
});
