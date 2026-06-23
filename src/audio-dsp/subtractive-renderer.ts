// src/audio-dsp/subtractive-renderer.ts
import type { NoteSpec, SubParams, VoiceRenderer } from './types';
import { SawOsc, SquareOsc, TriOsc, SineOsc, WhiteNoise } from './osc';
import { Svf } from './filter';
import { Adsr } from './adsr';

type Osc = { update(freq: number): number };
function makeOsc(wave: number, sr: number): Osc {
  switch (wave) {
    case 1: return new SquareOsc(sr);
    case 2: return new TriOsc(sr);
    case 3: return new SineOsc(sr);
    default: return new SawOsc(sr);
  }
}
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const detuneMul = (cents: number) => Math.pow(2, cents / 1200);
function driveShape(x: number, amount: number): number {
  const k = 1 + amount * amount * 25;
  return Math.tanh(x * k) / Math.tanh(k);
}

export class SubtractiveVoiceRenderer implements VoiceRenderer {
  private sr: number;
  private osc1: Osc; private osc2: Osc; private sub: SineOsc; private noise = new WhiteNoise();
  private noiseLp: Svf; private filter: Svf;
  private ampEnv = new Adsr(); private filtEnv = new Adsr();
  private begin: number; private holdEnd: number;
  private p: SubParams;
  private baseFreq: number; private velPeak: number;
  private baseCutoffHz: number; private keyTrackHz: number; private envRangeHz: number;
  done = false;

  constructor(note: NoteSpec, params: SubParams, sampleRate: number) {
    this.sr = sampleRate; this.p = params;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    const tuneSemis = params.masterTune;
    this.baseFreq = midiToFreq(note.midi) * Math.pow(2, tuneSemis / 12);
    this.osc1 = makeOsc(params.osc1Wave, sampleRate);
    this.osc2 = makeOsc(params.osc2Wave, sampleRate);
    this.sub = new SineOsc(sampleRate);
    this.noiseLp = new Svf(sampleRate);
    this.filter = new Svf(sampleRate);
    // 0.4 * velGain(...) with NoteSpec.velocity already normalised 0..1.
    // velToGain(v01) = 0.3 + 1.1*v01 ; accent amp punch = 1.1 (ACCENT_PUNCH).
    this.velPeak = 0.4 * (0.3 + 1.1 * note.velocity) * (note.accent ? 1.1 : 1.0);
    this.baseCutoffHz = Math.min(60 * Math.pow(220, params.filterCutoff), 18000);
    const keySemiDelta = note.midi - 60;
    this.keyTrackHz = keySemiDelta * this.baseCutoffHz * (Math.pow(2, 1 / 12) - 1) * params.filterKeyTrack;
    const accentMul = note.accent ? 1.3 : 1.0;
    this.envRangeHz = Math.min(this.baseCutoffHz * 7, 16000) * params.filterEnvAmount * accentMul;
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const p = this.p;
    const gate = t <= this.holdEnd ? 1 : 0;
    // oscillators (osc detune in cents; sub one octave down)
    let mix = this.osc1.update(this.baseFreq * detuneMul(p.osc1Detune)) * p.osc1Level
            + this.osc2.update(this.baseFreq * detuneMul(p.osc2Detune)) * p.osc2Level
            + this.sub.update(this.baseFreq * 0.5) * p.subLevel;
    if (p.noiseLevel > 0) {
      this.noiseLp.update(this.noise.update(), 200 + p.noiseColor * 14800, 0);
      mix += this.noiseLp.lp * p.noiseLevel;
    }
    // parallel drive (dry + saturated wet scaled by drive), as in PolySynth
    if (p.filterDrive > 0) mix = mix + driveShape(mix, 1.0) * p.filterDrive;
    // filter cutoff = base + keytrack + envelope contribution
    const fe = p.filterBuiltinEnv >= 0.5
      ? this.filtEnv.update(t, gate, p.filterAttack, p.filterDecay, p.filterSustain, p.filterRelease) : 0;
    const cutoff = this.baseCutoffHz + this.keyTrackHz + fe * this.envRangeHz;
    const q = p.filterResonance * 22 * 0.45;     // 0..~10 res scale for Svf
    this.filter.update(mix, cutoff, q);
    // amp envelope
    const ae = p.ampBuiltinEnv >= 0.5
      ? this.ampEnv.update(t, gate, p.ampAttack, p.ampDecay, p.ampSustain, p.ampRelease) : 1;
    const out = this.filter.lp * ae * this.velPeak;
    // done once the amp env has fully released after the gate
    if (gate === 0 && this.ampEnv.isOff && t > this.holdEnd) this.done = true;
    return out;
  }
}
