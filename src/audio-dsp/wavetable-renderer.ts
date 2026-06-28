// src/audio-dsp/wavetable-renderer.ts
// Per-sample wavetable voice renderer. Two single-cycle tables crossfaded by
// morph (equal-power), slight A/B detune, → Svf lowpass → amp ADSR.
// Ported from src/engines/wavetable.ts WavetableVoice.
//
// Pure: no Web Audio / worklet globals. Sample rate injected via constructor.
import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets } from './types';
import { param } from './types';
import { Svf } from './filter';
import { Adsr } from './adsr';
import type { ModLite } from './modulation-runtime';
import { getWaveTables } from './wavetable-data';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Detune modulation span: depth 1 (bipolar) sweeps ±50 cents, matching the knob.
const MOD_DETUNE_CENTS = 50;

/** One per-voice ADSR modulator (its envelope state + the ModLite shape/depths). */
interface ModEnv { adsr: Adsr; m: ModLite; }

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
  private f0: number;                 // base note frequency (Hz), for live detune
  private fA: number;
  private fB: number;
  private morphBase: number;
  private detuneBase: number;
  private filter: Svf;
  private cutoffBase: number;         // 0..1 knob value (for live cutoff modulation)
  private cutoffHz: number;
  private qBase: number;
  private ampEnv = new Adsr();
  private begin: number;
  private holdEnd: number;
  private aA: number;
  private aD: number;
  private aS: number;
  private aR: number;
  private ampOn: boolean;
  private vel: number;
  // Per-voice ADSR modulators (handed in at spawn) + pooled effective-offset
  // struct (shared LFO + this voice's ADSR), keyed by param dot-id.
  private modEnvs: ModEnv[] = [];
  private readonly effMo: VoiceModOffsets = {};
  private readonly adsrOnly: VoiceModOffsets = {};
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    const tables = getWaveTables();
    const ai = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveA', 2))));
    const bi = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveB', 3))));
    this.tA = tables[ai];
    this.tB = tables[bi];
    this.morphBase = param(p, 'osc.morph', 0);

    this.detuneBase = param(p, 'osc.detune', 0);
    this.f0 = midiToFreq(note.midi);
    this.fA = this.f0 * Math.pow(2, -this.detuneBase / 1200);
    this.fB = this.f0 * Math.pow(2, this.detuneBase / 1200);

    this.filter = new Svf(sr);
    this.cutoffBase = param(p, 'filter.cutoff', 0.55);
    this.cutoffHz = Math.min(18000, 60 * Math.pow(220, this.cutoffBase));
    this.qBase = clamp01(param(p, 'filter.resonance', 0.2));

    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;

    this.aA = Math.max(0.001, param(p, 'amp.attack', 0.01));
    this.aD = Math.max(0.001, param(p, 'amp.decay', 0.3));
    this.aS = param(p, 'amp.sustain', 0.7);
    this.aR = Math.max(0.001, param(p, 'amp.release', 0.3));
    this.ampOn = param(p, 'amp.builtinEnv', 1) >= 0.5;

    this.vel = (0.3 + 1.1 * note.velocity) * (note.accent ? 1.1 : 1.0);
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  /** Receive this voice's per-voice ADSR modulators (one Adsr each), at spawn. */
  setModEnvelopes(mods: ModLite[]): void {
    this.modEnvs = mods.map((m) => ({ adsr: new Adsr(), m }));
  }

  /** This voice's ADSR-only offsets per param dot-id (for the UI knob ring). */
  getAdsrOffsets(): VoiceModOffsets { return this.adsrOnly; }

  /** Fold this voice's gated ADSR envelopes into the shared-LFO offsets (keyed by
   *  param dot-id), returning one effective offset set. Mirrors the subtractive
   *  renderer's combineMods. */
  private combineMods(t: number, gate: number, moIn?: VoiceModOffsets): VoiceModOffsets {
    const e = this.effMo as Record<string, number>;
    const a = this.adsrOnly as Record<string, number>;
    for (const k in a) a[k] = 0;
    for (const me of this.modEnvs) {
      const env = me.adsr.update(
        t, gate, me.m.attackSec ?? 0.01, me.m.decaySec ?? 0.3, me.m.sustain ?? 0.7, me.m.releaseSec ?? 0.3,
      );
      const depths = me.m.depthByParam;
      for (const field in depths) {
        const depth = depths[field];
        if (!depth) continue;
        a[field] = (a[field] ?? 0) + env * depth;
      }
    }
    if (moIn) Object.assign(e, moIn); else for (const k in e) e[k] = 0;
    for (const k in a) e[k] = (e[k] ?? 0) + a[k];
    return this.effMo;
  }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    // Shared-LFO offsets + this voice's per-voice ADSR, keyed by param dot-id.
    const mo = this.modEnvs.length > 0 ? this.combineMods(t, gate, moIn) : moIn;

    // Morph (equal-power crossfade), modulatable.
    const morph = mo?.['osc.morph'] ? clamp01(this.morphBase + mo['osc.morph']) : this.morphBase;
    const gA = Math.cos(morph * Math.PI * 0.5);
    const gB = Math.sin(morph * Math.PI * 0.5);
    const osc = sampleTable(this.tA, this.phA) * gA + sampleTable(this.tB, this.phB) * gB;

    // Detune (±50¢ full-depth) → live A/B frequencies.
    let fA = this.fA, fB = this.fB;
    if (mo?.['osc.detune']) {
      const det = this.detuneBase + mo['osc.detune'] * MOD_DETUNE_CENTS;
      fA = this.f0 * Math.pow(2, -det / 1200);
      fB = this.f0 * Math.pow(2, det / 1200);
    }
    this.phA = (this.phA + fA / this.sr) % 1;
    this.phB = (this.phB + fB / this.sr) % 1;

    // Filter cutoff (exponential, like the base) + resonance, both modulatable.
    const cutoffHz = mo?.['filter.cutoff']
      ? Math.min(18000, 60 * Math.pow(220, clamp01(this.cutoffBase + mo['filter.cutoff'])))
      : this.cutoffHz;
    const q = mo?.['filter.resonance'] ? clamp01(this.qBase + mo['filter.resonance']) : this.qBase;
    this.filter.update(osc, cutoffHz, q);

    // Amp envelope (built-in). amp.gain modulation = tremolo (multiplicative).
    const env = this.ampOn ? this.ampEnv.update(t, gate, this.aA, this.aD, this.aS, this.aR) : 1;
    if (gate === 0 && this.ampEnv.isOff && t > this.holdEnd) this.done = true;
    let out = this.filter.lp * env * this.vel * synthTrim('wavetable');
    if (mo?.['amp.gain']) out *= Math.max(0, Math.min(2, 1 + mo['amp.gain']));
    return out;
  }
}

registerRenderer('wavetable', (n, p, sr) => new WavetableRenderer(n, p, sr));
