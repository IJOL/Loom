// src/audio-dsp/westcoast-renderer.ts
// Per-sample Westcoast (Buchla-style) voice renderer.
// Ports WestVoice from src/engines/westcoast.ts faithfully:
//   complex osc (main lin-FM'd by mod, ring/AM, sub-divider)
//   → DC-bias (symmetry)
//   → wavefolder (Timbre)
//   → low-pass gate (SVF + VCA driven by AD contour)
// Pure — no Web Audio. Sample rate is injected.

import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets } from './types';
import { param } from './types';
import { SineOsc, TriOsc, SawOsc } from './osc';
import { Svf } from './filter';
import { fold } from './fold';
import type { ModLite } from './modulation-runtime';
import { ModEnvHost } from './mod-env-host';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

type Osc = { update(f: number): number };

const MAIN_WAVE_OSC = [
  (sr: number): Osc => new SineOsc(sr),   // 0 = sine
  (sr: number): Osc => new TriOsc(sr),    // 1 = triangle
  (sr: number): Osc => new SawOsc(sr),    // 2 = sawtooth
];
const MOD_WAVE_OSC = [
  (sr: number): Osc => new SineOsc(sr),   // 0 = sine
  (sr: number): Osc => new TriOsc(sr),    // 1 = triangle
];

// Sub-divisor lookup: index 0..3 → divisor (0 = off)
const SUBDIV_VALUES = [0, 2, 3, 4];

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// Cutoff curve: same as westcoast.ts cutoffHz(norm) = min(18000, 60 * 220^norm)
function cutoffHz(norm: number): number {
  return Math.min(18000, 60 * Math.pow(220, norm));
}

// CUTOFF_ENV_SCALE from westcoast.ts: multiplier on base cutoff for the
// contour's filter sweep.
const CUTOFF_ENV_SCALE = 3;
// Per-engine output trim now lives in gain-staging.ts — synthTrim('westcoast').

/** Simple AD + optional sustain contour, clocked per-sample. Mirrors the
 *  ConstantSource automation schedule in WestVoice.trigger. */
class AdContour {
  private val = 0;
  private phase: 'idle' | 'attack' | 'decay' | 'sustain' | 'release' | 'done' = 'idle';
  private phaseStart = 0;
  private peak = 0;
  // Set once the note gate ends. A cycling contour keeps re-triggering only while
  // the note is held; after gate-off it finishes its current decay and goes
  // 'done' so the voice is reaped (otherwise a cycling LPG voice is immortal).
  private ended = false;

  constructor(
    private atk: number,
    private dec: number,
    private amount: number,
    /** 0=pluck (AD, gate-independent), 1=sustain (hold until noteOff then dec) */
    private cmode: number,
    private cycle: boolean,
    /** gate end time for sustain mode / cycling */
    private holdEnd: number,
  ) {
    this.peak = amount;
  }

  /** Signal gate-off to the contour. Stops a cycling contour from re-triggering
   *  and releases a sustained one. */
  noteOff(t: number): void {
    this.ended = true;
    if (this.phase === 'sustain') {
      this.phase = 'release';
      this.phaseStart = t;
    }
  }

  tick(t: number): number {
    switch (this.phase) {
      case 'idle': {
        this.phase = 'attack';
        this.phaseStart = t;
        return 0;
      }
      case 'attack': {
        const dt = t - this.phaseStart;
        if (dt >= this.atk) {
          this.phase = this.cmode === 1 ? 'sustain' : 'decay';
          this.phaseStart = t;
          this.val = this.peak;
          return this.peak;
        }
        this.val = this.peak * (dt / this.atk);
        return this.val;
      }
      case 'decay': {
        const dt = t - this.phaseStart;
        // Exponential decay: setTargetAtTime with time-constant dec/3
        const tau = this.dec / 3;
        this.val = this.peak * Math.exp(-dt / tau);
        if (this.val < 1e-4) {
          if (this.cycle && !this.ended) {
            // Restart the AD cycle (free-running LFO-like contour) — only while
            // the note is still held; after gate-off it finishes here.
            this.phase = 'attack';
            this.phaseStart = t;
            this.val = 0;
          } else {
            this.phase = 'done';
            this.val = 0;
          }
        }
        return this.val;
      }
      case 'sustain': {
        // Hold at peak until noteOff is called
        this.val = this.peak;
        return this.val;
      }
      case 'release': {
        const dt = t - this.phaseStart;
        const tau = this.dec / 3;
        this.val = this.peak * Math.exp(-dt / tau);
        if (this.val < 1e-4) {
          this.phase = 'done';
          this.val = 0;
        }
        return this.val;
      }
      case 'done':
        return 0;
    }
  }

  get isDone(): boolean { return this.phase === 'done'; }
}

export class WestcoastRenderer implements VoiceRenderer {
  private main: Osc;
  private mod: Osc;
  private sub: SineOsc;

  private freq: number;
  private modFreq: number;
  private subFreq: number;
  private subDiv: number;

  // Linear FM depth (Hz): fmIndex * note * ratio * 2  (mirrors WestVoice.trigger)
  private fmDepthHz: number;
  private ringAmt: number;
  private mainGain: number;
  private subLevel: number;

  // Wavefolder
  private driveGain: number;   // (0.1 + fold * 0.9) * accentMul — matches foldDrive.gain
  private symmetry: number;    // DC bias = symmetry * 0.5

  // LPG
  private filter: Svf;
  private cutoffBaseHz: number;
  private cutoffEnvScale: number;  // = cutoffBaseHz * CUTOFF_ENV_SCALE * accentMul (or 0 in gate-only mode)
  private lpgRes: number;          // 0..1 for Svf
  private filterMode: boolean;     // drives filter cutoff with contour
  private vcaMode: boolean;        // drives VCA with contour; if false, VCA is fixed 1

  // Contour
  private contour: AdContour;

  // Amp
  private ampGain: number;         // level * vel * OUTPUT_TRIM

  // Modulation: ModEnvHost (per-voice ADSR) + saved knob bases so generic LFO/ADSR
  // can recompute the timbre params live (cutoff, fold, resonance, fmIndex).
  private modEnv = new ModEnvHost();
  private foldBase: number;
  private fmIndexBase: number;
  private fmFactor: number;         // freq*ratio*2, so fmDepthHz = fmIndex * fmFactor
  private cutoffNorm: number;       // 0..1 lpg.cutoff knob
  private lpgResBase: number;
  private accentMul: number;

  // Timing
  private begin: number;
  private holdEnd: number;
  private contourGateTriggered = false;

  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;

    // Frequency
    const tune = param(p, 'master.tune', 0);
    const det = param(p, 'osc.detune', 0);
    this.freq = midiToFreq(note.midi) * Math.pow(2, (tune * 100 + det) / 1200);
    const ratio = param(p, 'osc.ratio', 2);
    this.modFreq = this.freq * ratio;
    this.subDiv = SUBDIV_VALUES[Math.round(param(p, 'osc.subDiv', 0))] ?? 0;
    this.subFreq = this.subDiv > 0 ? this.freq / this.subDiv : this.freq;

    // Oscillators
    const mainWave = Math.max(0, Math.min(2, Math.round(param(p, 'osc.mainWave', 0))));
    const modWave = Math.max(0, Math.min(1, Math.round(param(p, 'osc.modWave', 0))));
    this.main = (MAIN_WAVE_OSC[mainWave] ?? MAIN_WAVE_OSC[0])(sr);
    this.mod = (MOD_WAVE_OSC[modWave] ?? MOD_WAVE_OSC[0])(sr);
    this.sub = new SineOsc(sr);

    // FM + mix (mirrors WestVoice.trigger exactly)
    const fmIndex = param(p, 'osc.fmIndex', 0.2);
    this.fmDepthHz = fmIndex * this.freq * ratio * 2;
    this.ringAmt = param(p, 'osc.ring', 0);
    this.mainGain = 0.7;   // fixed in original
    this.subLevel = this.subDiv > 0 ? param(p, 'osc.subLevel', 0.3) : 0;

    // Wavefolder
    const foldAmt = param(p, 'timbre.fold', 0.5);
    const accentMul = note.accent ? 1.3 : 1.0;
    this.driveGain = (0.1 + foldAmt * 0.9) * accentMul;
    this.symmetry = param(p, 'timbre.symmetry', 0) * 0.5;  // bias.offset = symmetry * 0.5

    // LPG
    this.filter = new Svf(sr);
    const mode = Math.round(param(p, 'lpg.mode', 2));  // 0=lp, 1=gate, 2=both
    this.filterMode = mode === 0 || mode === 2;
    this.vcaMode = mode === 1 || mode === 2;
    const cutoff = param(p, 'lpg.cutoff', 0.6);
    this.cutoffBaseHz = cutoffHz(cutoff);
    this.cutoffEnvScale = this.filterMode
      ? this.cutoffBaseHz * CUTOFF_ENV_SCALE * accentMul
      : 0;
    // Svf resonance is 0..1 — pass straight through (per carry-forward note).
    // The legacy biquad used Q = 0.5 + res*20; here we map that to 0..1:
    // the 0..1 resonance knob → svf 0..1 resonance directly (as spec'd).
    this.lpgRes = Math.max(0, Math.min(1, param(p, 'lpg.resonance', 0.2)));

    // Contour
    const cmode = Math.round(param(p, 'contour.mode', 0));
    const atk = Math.max(0.001, param(p, 'contour.attack', 0.005));
    const dec = Math.max(0.005, param(p, 'contour.decay', 0.4));
    const amount = param(p, 'contour.amount', 0.9);
    const cycle = Math.round(param(p, 'contour.cycle', 0)) >= 1;
    this.contour = new AdContour(atk, dec, amount, cmode, cycle, this.holdEnd);

    // Amp
    const level = param(p, 'amp.level', 0.8);
    // velGain from legacy: 0.3 + 1.1 * vel (already 0..1 in NoteSpec)
    const vel = (0.3 + 1.1 * note.velocity) * accentMul;
    this.ampGain = level * vel * synthTrim('westcoast');

    // Saved bases so generic LFO/ADSR can recompute the timbre params live.
    this.foldBase = foldAmt;
    this.fmIndexBase = fmIndex;
    this.fmFactor = this.freq * ratio * 2;
    this.cutoffNorm = cutoff;
    this.lpgResBase = param(p, 'lpg.resonance', 0.2);
    this.accentMul = accentMul;
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) {
      this.holdEnd = t;
      this.contour.noteOff(t);
    }
  }

  setModEnvelopes(mods: ModLite[]): void { this.modEnv.setModEnvelopes(mods); }
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    // Generic LFO/ADSR offsets keyed by param dot-id — the timbre params are
    // modulatable (cutoff, fold, resonance, fmIndex); the contour stays native.
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;

    // --- Complex oscillator (FM index modulatable) ---
    // Mod osc runs at modFreq, feeds linear FM into main osc via fmDepthHz.
    const fmDepthHz = mo?.['osc.fmIndex']
      ? Math.max(0, this.fmIndexBase + mo['osc.fmIndex']) * this.fmFactor : this.fmDepthHz;
    const modSample = this.mod.update(this.modFreq);
    const mainFreq = this.freq + modSample * fmDepthHz;
    const mainSample = this.main.update(mainFreq);

    // Ring/AM: ringMod.gain = modSample, so ring = mainSample * modSample * ringAmt
    // In the original: mainOsc → ringMod (gain.value = 0 initially), modOsc → ringMod.gain
    // → ringGain (gain.value = ring param). So ring output = mainSample * modSample * ringAmt.
    const ringSample = mainSample * modSample * this.ringAmt;

    // Sub osc
    const subSample = this.subLevel > 0 ? this.sub.update(this.subFreq) * this.subLevel : 0;

    // Mix: mainGain*main + ringGain*ring + sub + bias
    // Original: mainGain=0.7, ringGain=ring param, subGain=subLevel
    const mixRaw = mainSample * this.mainGain + ringSample + subSample + this.symmetry;

    // --- Wavefolder (fold amount modulatable) ---
    const driveGain = mo?.['timbre.fold']
      ? (0.1 + clamp01(this.foldBase + mo['timbre.fold']) * 0.9) * this.accentMul : this.driveGain;
    const folded = fold(mixRaw, driveGain);

    // --- Contour (AD envelope driving the LPG) ---
    // Trigger gate-off on the contour when the note gate ends (sustain mode needs this)
    if (!this.contourGateTriggered && t >= this.holdEnd) {
      this.contourGateTriggered = true;
      this.contour.noteOff(t);
    }
    const contourVal = this.contour.tick(t);

    // --- Low-pass gate (cutoff + resonance modulatable) ---
    let cutoffBaseHz = this.cutoffBaseHz, cutoffEnvScale = this.cutoffEnvScale;
    if (mo?.['lpg.cutoff']) {
      cutoffBaseHz = cutoffHz(clamp01(this.cutoffNorm + mo['lpg.cutoff']));
      cutoffEnvScale = this.filterMode ? cutoffBaseHz * CUTOFF_ENV_SCALE * this.accentMul : 0;
    }
    const lpgRes = mo?.['lpg.resonance'] ? clamp01(this.lpgResBase + mo['lpg.resonance']) : this.lpgRes;
    const dynamicCutoff = cutoffBaseHz + contourVal * cutoffEnvScale;
    this.filter.update(folded, dynamicCutoff, lpgRes);

    // VCA: contour drives gain in gate/both mode; in lp-only mode, VCA is fixed 1
    const vca = this.vcaMode ? contourVal : 1;

    // --- Output (amp.gain tremolo) ---
    let out = this.filter.lp * vca * this.ampGain;
    if (mo?.['amp.gain']) out *= Math.max(0, Math.min(2, 1 + mo['amp.gain']));

    // Mark done:
    // - In pluck (gate-independent) mode: done when contour finishes, regardless of gate
    // - In sustain mode: done only after gate ends AND contour finishes
    if (this.contour.isDone) {
      this.done = true;
    }

    return out;
  }
}

registerRenderer('westcoast', (n, p, sr) => new WestcoastRenderer(n, p, sr));
