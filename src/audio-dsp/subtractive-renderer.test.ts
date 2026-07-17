// src/audio-dsp/subtractive-renderer.test.ts
import { describe, it, expect } from 'vitest';
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

describe('filter model', () => {
  // Three filters, one engine. The Svf stays the default so every existing
  // preset sounds exactly as it was voiced; the ladders are opt-in.
  const bag = (model: number): ParamBag => ({
    ...DEFAULTS, 'osc1.wave': 0, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': 0.4, 'filter.resonance': 0.7, 'filter.envAmount': 0, 'filter.builtinEnv': 0,
    'filter.model': model,
  });
  const render = (model: number): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), bag(model), SR);
    const b: number[] = [];
    for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
    return b;
  };
  const divergence = (a: number[], b: number[]): number => {
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length / Math.max(1e-9, rms(a));
  };
  const mean = (b: number[]) => Math.abs(b.reduce((s, v) => s + v, 0) / b.length);

  it('defaults to the Svf, so nothing that exists today changes', () => {
    const noModel: ParamBag = { ...bag(0) };
    delete (noModel as Record<string, number>)['filter.model'];
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), noModel, SR);
    const b: number[] = []; for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
    expect(divergence(b, render(0))).toBeLessThan(0.01);
  });

  it('each model is audibly its own filter', () => {
    expect(divergence(render(0), render(1))).toBeGreaterThan(0.1);   // svf vs moog
    expect(divergence(render(1), render(2))).toBeGreaterThan(0.02);  // moog vs diode
  });

  it('the 303 model brings the asymmetry the others do not have', () => {
    expect(mean(render(2))).toBeGreaterThan(mean(render(1)) * 2);
  });

  it('every model stays bounded', () => {
    for (const m of [0, 1, 2]) {
      const peak = render(m).reduce((p, v) => Math.max(p, Math.abs(v)), 0);
      expect(peak, `model ${m} blew up`).toBeLessThan(4);
    }
  });
});

// LP=0, HP=1, BP=2, NOTCH=3 — mpump's FTYPE_* ordering, kept so a ported preset
// means the same thing in both codebases.
const LP = 0, HP = 1, BP = 2, NOTCH = 3;

describe('filter type', () => {
  // The Svf has computed .lp, .bp AND .hp all along; the renderer only ever read
  // .lp, so two thirds of the filter were unreachable. filter.type picks the tap.
  //
  // A filter IS what it passes and what it stops, so every assertion below is one
  // tone's level against another's — never an absolute dB.
  const CUTOFF_HZ = 880;
  // baseCutoffHz = min(60 * 220^c, 18000). Inverted, so the cutoff lands exactly
  // on a pitch we can aim tones at.
  const cutoffParam = Math.log(CUTOFF_HZ / 60) / Math.log(220);
  // A2 (110 Hz), A5 (880 Hz), A8 (7040 Hz): three octaves below the cutoff, on it,
  // three above.
  const LOW = 45, AT = 81, HIGH = 117;

  // Resonance stays at the engine's DEFAULT (0.25) rather than 0. This Svf's
  // damping is r = 0.5^((res+0.125)/0.125), so res=0 means r=0.5 — its most
  // damped, leakiest setting, where the bandpass never fully rolls off below the
  // cutoff (a 0.40 shelf) and the lowpass only reaches 0.80 at DC. Those are real
  // properties of the shipping filter, not of the taps being added; measuring the
  // taps at the setting the engine actually boots with is the honest test.
  const toneBag = (type: number, model = 0): ParamBag => ({
    ...DEFAULTS, 'osc1.wave': 3, 'osc1.level': 1, 'osc2.level': 0,
    'sub.level': 0, 'noise.level': 0,
    'filter.cutoff': cutoffParam, 'filter.resonance': 0.25, 'filter.envAmount': 0,
    'filter.builtinEnv': 0, 'filter.keyTrack': 0, 'amp.builtinEnv': 0,
    'filter.type': type, 'filter.model': model,
  });
  /** How much of a steady sine at `midi` survives `type`. */
  const passes = (type: number, midi: number, model = 0): number => {
    const v = new SubtractiveVoiceRenderer(note({ midi, durationSec: 0.4 }), toneBag(type, model), SR);
    const b: number[] = [];
    // Drop the first 20 ms: the filter states start at zero, so the run-in is a
    // transient, not the steady-state response being measured.
    for (let i = 0; i < SR * 0.25; i++) { const s = v.renderSample(i / SR); if (i > SR * 0.02) b.push(s); }
    return rms(b);
  };
  const divergence = (a: number[], b: number[]): number => {
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length / Math.max(1e-9, rms(a));
  };
  /** A saw at the default note through `bag` — for comparing two param bags. */
  const renderBag = (bag: ParamBag): number[] => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 0.3 }), { ...bag, 'osc1.wave': 0 }, SR);
    const b: number[] = []; for (let i = 0; i < SR * 0.15; i++) b.push(v.renderSample(i / SR));
    return b;
  };

  it('defaults to LP, so nothing that exists today changes', () => {
    const noType: ParamBag = { ...toneBag(LP) };
    delete (noType as Record<string, number>)['filter.type'];
    expect(divergence(renderBag(noType), renderBag(toneBag(LP)))).toBeLessThan(0.01);
  });

  it('LP passes what is under the cutoff and stops what is over it', () => {
    expect(passes(LP, LOW)).toBeGreaterThan(passes(LP, HIGH) * 10);
  });

  it('HP is the mirror image of the LP', () => {
    expect(passes(HP, HIGH)).toBeGreaterThan(passes(HP, LOW) * 10);
    // ...and against the LP on the SAME tone: the lows the LP passes, the HP stops.
    expect(passes(HP, LOW)).toBeLessThan(passes(LP, LOW) * 0.2);
  });

  it('BP passes the cutoff and rejects both sides of it', () => {
    // Measured ~23x over the low tone and ~30x over the high one; assert 5x.
    expect(passes(BP, AT)).toBeGreaterThan(passes(BP, LOW) * 5);
    expect(passes(BP, AT)).toBeGreaterThan(passes(BP, HIGH) * 5);
  });

  it('the notch is the hole where the BP has its peak', () => {
    // The exact inverse of the BP test above, on the same three tones.
    expect(passes(NOTCH, AT)).toBeLessThan(passes(NOTCH, LOW) * 0.2);
    expect(passes(NOTCH, AT)).toBeLessThan(passes(NOTCH, HIGH) * 0.2);
  });

  it('the notch actually nulls, instead of merely tilting', () => {
    // Guards the derivation in filter.ts: the textbook `lp + hp` is structurally
    // pinned at -6 dB in this topology (its bandpass peaks at 0.5/r, not 1/r), so
    // it can never null however the resonance is set. Measured directly on the Svf
    // — the renderer's velocity/amp scaling would only add a constant here.
    const depthAt = (res: number, hz: number): number => {
      const s = new Svf(SR);
      let acc = 0, n = 0;
      for (let i = 0; i < SR * 0.2; i++) {
        s.update(Math.sin(2 * Math.PI * hz * i / SR), CUTOFF_HZ, res);
        if (i > SR * 0.05) { acc += s.notch * s.notch; n++; }   // skip the run-in transient
      }
      return Math.sqrt(acc / n);
    };
    for (const res of [0, 0.25, 0.6]) {
      // The null must be deep RELATIVE to what the notch passes three octaves out.
      expect(depthAt(res, CUTOFF_HZ), `res ${res}`).toBeLessThan(depthAt(res, CUTOFF_HZ * 8) * 0.4);
    }
  });

  it('every type stays bounded — no runaway, and drive lifts the level without exploding', () => {
    // A real patch — a saw at the default note. NOT the sine used above: a pure
    // tone parked on a resonant filter's cutoff rings to ~30x by design, so
    // asserting on that would be measuring physics rather than catching a bug.
    //
    // res 0.7 + drive 0.8 is a stress patch: the parallel drive (mix +
    // driveShape(mix)*drive, on main since forever) feeds up to 1.8x amplitude
    // into the filter, so an analogue-style rise is EXPECTED. What must not
    // happen is a runaway. So the contract is relative, not a magic ceiling:
    // the output stays finite, and drive raises the peak by a bounded ratio
    // rather than an unbounded one.
    const peakOf = (t: number, model: number, res: number, drive: number): number => {
      const v = new SubtractiveVoiceRenderer(
        note({ durationSec: 0.3 }),
        { ...toneBag(t, model), 'osc1.wave': 0, 'filter.resonance': res, 'filter.drive': drive }, SR,
      );
      let peak = 0;
      for (let i = 0; i < SR * 0.2; i++) { const a = Math.abs(v.renderSample(i / SR)); if (a > peak) peak = a; }
      return peak;
    };
    for (const t of [LP, HP, BP, NOTCH]) {
      for (const model of [0, 1, 2]) {
        const dry = peakOf(t, model, 0.7, 0);
        const wet = peakOf(t, model, 0.7, 0.8);
        const tag = `type ${t} model ${model}`;
        // Never a runaway or a NaN, dry or driven.
        expect(Number.isFinite(wet), `${tag} went non-finite`).toBe(true);
        // The soft-clip must have bent it back near unity — 4.5 is well below the
        // ~6 the raw HP tap reached before the ceiling was added.
        expect(wet, `${tag} blew up`).toBeLessThan(4.5);
        // Drive lifts level, and the lift is bounded — a saturator, not a spike.
        expect(wet, `${tag} drive should not reduce peak`).toBeGreaterThanOrEqual(dry);
        expect(wet / Math.max(dry, 1e-6), `${tag} drive ratio unbounded`).toBeLessThan(5);
      }
    }
  });

  // ── The ladders ────────────────────────────────────────────────────────────
  // A ladder is four one-pole lowpasses in a feedback loop, so its stages ARE
  // LP1..LP4 of the loop input and the classic multimode taps expand binomially
  // out of them — HP4 = (1-LP)^4, BP2 = LP^2*(1-LP)^2. That is real analog
  // practice (the Oberheim Xpander derives its modes from a ladder exactly so),
  // not a re-label of the lowpass, and each tap is measured below.
  //
  // The NOTCH is the exception and it is NOT shipped on a ladder: measured, the
  // notch tap only nulls while the resonance is low, and as resonance rises the
  // ladder's own feedback fills the null in — on the diode at res 0.7 it inverts
  // into a BUMP (0.46 at the cutoff against 0.25 three octaves down). A notch
  // that becomes a peak is not a notch, and no honest amount of makeup gain fixes
  // a filled null, so MOG/303 + NOTCH stays the lowpass. See ladder.ts.
  for (const [name, model] of [['MOG', 1], ['303', 2]] as const) {
    it(`${name} honours HP — it is a real highpass, not the lowpass relabelled`, () => {
      expect(passes(HP, HIGH, model)).toBeGreaterThan(passes(HP, LOW, model) * 10);
      expect(passes(HP, LOW, model)).toBeLessThan(passes(LP, LOW, model) * 0.2);
    });

    it(`${name} honours BP — it passes the cutoff and rejects both sides`, () => {
      expect(passes(BP, AT, model)).toBeGreaterThan(passes(BP, LOW, model) * 5);
      expect(passes(BP, AT, model)).toBeGreaterThan(passes(BP, HIGH, model) * 5);
    });

    it(`${name} keeps its lowpass exactly as it was`, () => {
      // The ladder LP is 20+ presets' voicing; adding taps must not move it.
      const noType: ParamBag = { ...toneBag(LP, model) };
      delete (noType as Record<string, number>)['filter.type'];
      const a = renderBag(noType);
      expect(divergence(a, renderBag(toneBag(LP, model)))).toBeLessThan(0.01);
    });

    it(`${name} + NOTCH stays the lowpass — a ladder has no honest notch`, () => {
      // Deliberate and documented: this asserts the fallback is EXACTLY the LP,
      // so the day someone finds an honest ladder notch, this test fails loudly
      // and gets rewritten rather than silently drifting.
      expect(divergence(renderBag(toneBag(NOTCH, model)), renderBag(toneBag(LP, model)))).toBeLessThan(0.01);
    });
  }
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
      const b: number[] = [];
      for (let i = 0; i < SR * 0.4; i++) { const t = i / SR; b.push(v.renderSample(t, { unisonDetune: mod(t) })); }
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
    const swept: number[] = [];
    for (let i = 0; i < SR * 0.1; i++) swept.push(v2.renderSample(i / SR, { osc1Sync: Math.sin(2 * Math.PI * 5 * i / SR) }));

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
