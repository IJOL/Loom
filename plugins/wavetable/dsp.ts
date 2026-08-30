// plugins/wavetable/dsp.ts
// Per-sample wavetable voice renderer. Two single-cycle tables crossfaded by
// morph (equal-power), slight A/B detune, → Svf lowpass → amp ADSR.
// Ported from src/engines/wavetable.ts WavetableVoice.
//
// Pure: no Web Audio / worklet globals. Sample rate injected via constructor.
import { param, slotOf, Svf, Adsr, ModEnvHost, midiToFreq, clamp01, velGain01 } from '@loom/plugin-sdk';
import type {
  NoteSpec, ParamBag, ParamIndex, VoiceRenderer, VoiceModOffsets, ModEnvSpec,
} from '@loom/plugin-sdk';
import { getWaveTables, getWarpedTable, SPECTRAL_STEPS } from './wavetable-data';
// Detune modulation span: depth 1 (bipolar) sweeps ±50 cents, matching the knob.
const MOD_DETUNE_CENTS = 50;

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
  // Spectral warp: the MODE is structural (frozen at trigger); the AMOUNT is
  // live and quantised to SPECTRAL_STEPS, so moving it swaps precomputed
  // tables (cached in wavetable-data) — phase carries across the swap.
  private readonly waveA: number;
  private readonly waveB: number;
  private readonly specMode: number;
  private spectralBase: number;
  private sSpectral = -1;
  private specStep: number;
  private phA = 0;
  private phB = 0;
  private f0: number;                 // base note frequency (Hz), for live detune
  private morphBase: number;
  private detuneBase: number;
  private filter: Svf;
  private cutoffBase: number;         // 0..1 knob value (for live cutoff modulation)
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
  // Per-voice ADSR modulators. This used to be a hand-rolled copy of ModEnvHost
  // — the shared host exists precisely so a renderer does not carry its own.
  private modEnv = new ModEnvHost();
  /** The lane's live (smoothed) values, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). Addressed by the slots
   *  below, resolved ONCE in setLiveValues; -1 means the lane does not declare
   *  that id, so the trigger snapshot stands. */
  private live: Float64Array | null = null;
  private sMorph = -1;
  private sDetune = -1;
  private sCutoff = -1;
  private sRes = -1;
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  private sAmpGain = -1;
  // Cached expensive conversions, refreshed only when their raw input moves.
  private cutRaw = NaN;
  private cutHz = 0;
  private detRaw = NaN;
  private fACache = 0;
  private fBCache = 0;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    const tables = getWaveTables();
    const ai = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveA', 2))));
    const bi = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveB', 3))));
    this.waveA = ai;
    this.waveB = bi;
    this.specMode = param(p, 'osc.spectral', 0);
    this.spectralBase = clamp01(param(p, 'osc.spectralAmt', 0));
    this.specStep = Math.round(this.spectralBase * SPECTRAL_STEPS);
    // Step 0 hands back the untouched originals — the exact arrays the
    // pre-warp voice used, which is what keeps the parity render pinned.
    this.tA = getWarpedTable(ai, this.specMode, this.specStep);
    this.tB = getWarpedTable(bi, this.specMode, this.specStep);
    this.morphBase = param(p, 'osc.morph', 0);

    this.detuneBase = param(p, 'osc.detune', 0);
    this.f0 = midiToFreq(note.midi);

    this.filter = new Svf(sr);
    this.cutoffBase = param(p, 'filter.cutoff', 0.55);
    this.qBase = clamp01(param(p, 'filter.resonance', 0.2));

    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;

    this.aA = Math.max(0.001, param(p, 'amp.attack', 0.01));
    this.aD = Math.max(0.001, param(p, 'amp.decay', 0.3));
    this.aS = param(p, 'amp.sustain', 0.7);
    this.aR = Math.max(0.001, param(p, 'amp.release', 0.3));
    this.ampOn = param(p, 'amp.builtinEnv', 1) >= 0.5;

    this.vel = velGain01(note.velocity, note.accent);
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  /** Receive this voice's per-voice ADSR modulators (one Adsr each), at spawn,
   *  with the lane's numbering so their targets resolve to slots once. */
  setModEnvelopes(mods: ModEnvSpec[], index: ParamIndex): void { this.modEnv.setModEnvelopes(mods, index); }

  /** This voice's ADSR-only offsets by slot (for the UI knob ring). */
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }
  setLiveValues(values: Float64Array, index: ParamIndex): void {
    this.live = values;
    this.sMorph = slotOf(index, 'osc.morph');
    this.sSpectral = slotOf(index, 'osc.spectralAmt');
    this.sDetune = slotOf(index, 'osc.detune');
    this.sCutoff = slotOf(index, 'filter.cutoff');
    this.sRes = slotOf(index, 'filter.resonance');
    this.sAmpGain = slotOf(index, 'amp.gain');
  }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    // Shared-LFO offsets + this voice's per-voice ADSR, addressed by slot.
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;

    // Live knobs: turning these moves THIS note. The trigger snapshot is the
    // fallback when no lane bag is attached.
    const L = this.live;
    const morphKnob = L && this.sMorph >= 0 ? L[this.sMorph] : this.morphBase;
    const detuneKnob = L && this.sDetune >= 0 ? L[this.sDetune] : this.detuneBase;
    const cutoffKnob = L && this.sCutoff >= 0 ? L[this.sCutoff] : this.cutoffBase;
    const qKnob = L && this.sRes >= 0 ? clamp01(L[this.sRes]) : this.qBase;

    // Spectral warp amount: live knob + modulation, quantised to a table step.
    // A step change swaps cached tables; phase carries across, so the swap is
    // a timbre move, not a retrigger.
    const spectralKnob = L && this.sSpectral >= 0 ? clamp01(L[this.sSpectral]) : this.spectralBase;
    const spectralEff = mo?.[this.sSpectral] ? clamp01(spectralKnob + mo[this.sSpectral]) : spectralKnob;
    const step = Math.round(spectralEff * SPECTRAL_STEPS);
    if (step !== this.specStep) {
      this.specStep = step;
      this.tA = getWarpedTable(this.waveA, this.specMode, step);
      this.tB = getWarpedTable(this.waveB, this.specMode, step);
    }

    // Morph (equal-power crossfade), modulatable.
    const morph = mo?.[this.sMorph] ? clamp01(morphKnob + mo[this.sMorph]) : morphKnob;
    const gA = Math.cos(morph * Math.PI * 0.5);
    const gB = Math.sin(morph * Math.PI * 0.5);
    const osc = sampleTable(this.tA, this.phA) * gA + sampleTable(this.tB, this.phB) * gB;

    // Detune (±50¢ full-depth) → live A/B frequencies. Cached: the two pow calls
    // only re-run when the effective (knob + mod) cents value actually moves.
    const det = mo?.[this.sDetune] ? detuneKnob + mo[this.sDetune] * MOD_DETUNE_CENTS : detuneKnob;
    if (det !== this.detRaw) {
      this.detRaw = det;
      this.fACache = this.f0 * Math.pow(2, -det / 1200);
      this.fBCache = this.f0 * Math.pow(2, det / 1200);
    }
    this.phA = (this.phA + this.fACache / this.sr) % 1;
    this.phB = (this.phB + this.fBCache / this.sr) % 1;

    // Filter cutoff (exponential, like the base) + resonance, both modulatable.
    // Cached: the pow only re-runs when the effective cutoff actually moves.
    const cutoff01 = mo?.[this.sCutoff] ? clamp01(cutoffKnob + mo[this.sCutoff]) : cutoffKnob;
    if (cutoff01 !== this.cutRaw) {
      this.cutRaw = cutoff01;
      this.cutHz = Math.min(18000, 60 * Math.pow(220, cutoff01));
    }
    const q = mo?.[this.sRes] ? clamp01(qKnob + mo[this.sRes]) : qKnob;
    this.filter.update(osc, this.cutHz, q);

    // Amp envelope (built-in). amp.gain modulation = tremolo (multiplicative).
    const env = this.ampOn ? this.ampEnv.update(t, gate, this.aA, this.aD, this.aS, this.aR) : 1;
    if (gate === 0 && this.ampEnv.isOff && t > this.holdEnd) this.done = true;
    // No engine trim here: it is a manifest capability (`outputTrim`) that the
    // host multiplies in, together with its synth category gain.
    let out = this.filter.lp * env * this.vel;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    return out;
  }
}

Loom.registerRenderer('wavetable', (n, p, sr) => new WavetableRenderer(n, p, sr));
