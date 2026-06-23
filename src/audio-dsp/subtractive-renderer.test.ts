// src/audio-dsp/subtractive-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';
import type { SubParams, NoteSpec } from './types';

const SR = 48000;
const DEFAULTS: SubParams = {
  masterTune: 0,
  osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0,
  osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7,
  subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6,
  filterCutoff: 0.55, filterResonance: 0.25, filterEnvAmount: 0.45,
  filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1,
  filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.35,
  ampBuiltinEnv: 1,
  ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.3,
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
      const v = new SubtractiveVoiceRenderer(note(), { ...DEFAULTS, filterCutoff: cut, filterEnvAmount: 0 }, SR);
      const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(bright(0.95)).toBeGreaterThan(bright(0.15) * 1.2);
  });

  it('noteOff before the gate end shortens the sound (earlier silence)', () => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 2 }), DEFAULTS, SR);
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);
    v.noteOff(0.05);
    let last = 1;
    for (let i = SR * 0.05; i < SR * 0.6; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);   // released well before the 2 s gate
  });
});
