// src/audio-dsp/subtractive-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';
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
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR, { filterCutoff: cutMod }));
      return rms(b);
    };
    expect(bright(0.8)).toBeGreaterThan(bright(0) * 1.3);
  });

  it('master-tune modulation shifts pitch (octave-up ≈ doubles the zero-crossing rate)', () => {
    const upwardCrossings = (tuneMod: number) => {
      const v = new SubtractiveVoiceRenderer(
        note(), { ...DEFAULTS, 'osc1.wave': 3, 'osc1.level': 0.8, 'osc2.level': 0, 'sub.level': 0, 'noise.level': 0, 'filter.cutoff': 0.95, 'filter.resonance': 0, 'filter.envAmount': 0 }, SR,
      );
      let prev = 0, zc = 0;
      for (let i = 0; i < SR * 0.1; i++) {
        const s = v.renderSample(i / SR, { masterTune: tuneMod });
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
      const b: number[] = [];
      for (let i = 0; i < SR * 0.05; i++) b.push(v.renderSample(i / SR, { ampGain: g }));
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
    depthByParam: { filterCutoff: depth },
  });

  it('a per-voice ADSR modulator brightens the cutoff while gated (envelope-driven)', () => {
    // adsr → filter.cutoff, fast attack/decay, full sustain. With a low base cutoff
    // and no LFO, the open envelope must brighten the voice (same isolation as the
    // live-cutoff-offset test above).
    const bright = (depth: number) => {
      const v = new SubtractiveVoiceRenderer(
        note(), { ...DEFAULTS, 'filter.cutoff': 0.15, 'filter.resonance': 0, 'filter.envAmount': 0 }, SR,
      );
      if (depth > 0) v.setModEnvelopes([adsrMod(depth)]);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(bright(0.8)).toBeGreaterThan(bright(0) * 1.3);
  });

  it('getAdsrOffsets follows the gated envelope (the knob-ring source)', () => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 10 }), DEFAULTS, SR);
    v.setModEnvelopes([{ ...adsrMod(1), sustain: 0.5 }]);
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);   // settle into sustain
    const off = v.getAdsrOffsets() as Record<string, number>;
    expect(off.filterCutoff).toBeCloseTo(0.5, 1);                 // sustain 0.5 × depth 1
    // After note-off the envelope releases → the ring contribution falls back toward 0.
    v.noteOff(0.05);
    for (let i = SR * 0.05; i < SR * 0.4; i++) v.renderSample(i / SR);
    expect((v.getAdsrOffsets() as Record<string, number>).filterCutoff).toBeLessThan(0.1);
  });

  const ampAdsr = {
    id: 'amp', kind: 'adsr' as const, enabled: true, rateHz: 0, waveform: 'sine' as const,
    attackSec: 0.005, decaySec: 0.01, sustain: 1, releaseSec: 0.05, depthByParam: { amp: 1 },
  };

  it("an ADSR routed to 'amp' becomes the amplitude envelope when the built-in is off", () => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.2 }), { ...DEFAULTS, 'amp.builtinEnv': 0 }, SR);
    v.setModEnvelopes([ampAdsr]);
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
      if (withAdsr) v.setModEnvelopes([{ ...ampAdsr, sustain: 0, releaseSec: 0.001 }]); // would silence if applied
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
        attackSec: 0.001, decaySec: 0.001, sustain: 1, releaseSec: 0.1, depthByParam: { filterEnv: 1 },
      }]);
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
    const b: number[] = [];
    for (let i = 0; i < SR * 0.2; i++) {
      const t = i / SR;
      b.push(v.renderSample(t, { osc1Pw: mod(t) }));
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
