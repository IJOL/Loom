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
});
