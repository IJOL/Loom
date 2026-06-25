// src/audio-dsp/wavetable-renderer.ts
// Per-sample wavetable voice renderer. Two single-cycle tables crossfaded by
// morph (equal-power), slight A/B detune, → Svf lowpass → amp ADSR.
// Ported from src/engines/wavetable.ts WavetableVoice.
//
// Pure: no Web Audio / worklet globals. Sample rate injected via constructor.
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { Svf } from './filter';
import { Adsr } from './adsr';
import { getWaveTables } from './wavetable-data';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Linear interpolation inside a single-cycle table. `phase` is 0..1. */
function sampleTable(tab: Float32Array, phase: number): number {
  const x = phase * tab.length;
  const i = Math.floor(x);
  const f = x - i;
  return tab[i % tab.length] * (1 - f) + tab[(i + 1) % tab.length] * f;
}

export class WavetableRenderer implements VoiceRenderer {
  private tA: Float32Array;
  private tB: Float32Array;
  private phA = 0;
  private phB = 0;
  private fA: number;
  private fB: number;
  private morph: number;
  private filter: Svf;
  private cutoffHz: number;
  private q: number;
  private ampEnv = new Adsr();
  private begin: number;
  private holdEnd: number;
  private aA: number;
  private aD: number;
  private aS: number;
  private aR: number;
  private ampOn: boolean;
  private vel: number;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    const tables = getWaveTables();
    const ai = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveA', 2))));
    const bi = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveB', 3))));
    this.tA = tables[ai];
    this.tB = tables[bi];
    this.morph = param(p, 'osc.morph', 0);

    // Slight A/B detune: detune cents split ±detune/2 between the two oscillators.
    // Mirrors legacy code: oscA.detune = -detune, oscB.detune = +detune.
    const det = param(p, 'osc.detune', 0);
    const f = midiToFreq(note.midi);
    this.fA = f * Math.pow(2, -det / 1200);
    this.fB = f * Math.pow(2, det / 1200);

    this.filter = new Svf(sr);

    // Cutoff: same formula as legacy WavetableVoice: 60 * 220^cutoff Hz.
    // Clamped to 18 kHz to keep the SVF stable.
    const cutoff = param(p, 'filter.cutoff', 0.55);
    this.cutoffHz = Math.min(18000, 60 * Math.pow(220, cutoff));

    // Resonance: 0..1 straight to Svf (NOT *20*0.45 — Svf uses its own 0..1 damping
    // scale; biquad-Q values blow the SVF up). See filter.ts comment.
    this.q = Math.max(0, Math.min(1, param(p, 'filter.resonance', 0.2)));

    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;

    this.aA = Math.max(0.001, param(p, 'amp.attack', 0.01));
    this.aD = Math.max(0.001, param(p, 'amp.decay', 0.3));
    this.aS = param(p, 'amp.sustain', 0.7);
    this.aR = Math.max(0.001, param(p, 'amp.release', 0.3));
    this.ampOn = param(p, 'amp.builtinEnv', 1) >= 0.5;

    // velocity * accent punch (mirrors legacy velGain: 0.3 + 1.1*vel * accent? 1.1:1)
    this.vel = (0.3 + 1.1 * note.velocity) * (note.accent ? 1.1 : 1.0);
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;

    // Equal-power crossfade: morph 0 → full A, morph 1 → full B.
    const gA = Math.cos(this.morph * Math.PI * 0.5);
    const gB = Math.sin(this.morph * Math.PI * 0.5);
    const osc = sampleTable(this.tA, this.phA) * gA + sampleTable(this.tB, this.phB) * gB;

    // Advance phases
    this.phA = (this.phA + this.fA / this.sr) % 1;
    this.phB = (this.phB + this.fB / this.sr) % 1;

    // Filter
    this.filter.update(osc, this.cutoffHz, this.q);

    // Amp envelope
    const env = this.ampOn
      ? this.ampEnv.update(t, gate, this.aA, this.aD, this.aS, this.aR)
      : 1;

    // Mark done once the amp env has finished after note-off.
    // When builtinEnv is off, the voice ends at gate-off (no release tail).
    if (gate === 0 && this.ampEnv.isOff && t > this.holdEnd) this.done = true;

    // Per-engine output trim, centralized in gain-staging (was 0.6). vel already
    // accounts for the 0.3 + 1.1*v factor.
    return this.filter.lp * env * this.vel * synthTrim('wavetable');
  }
}

registerRenderer('wavetable', (n, p, sr) => new WavetableRenderer(n, p, sr));
