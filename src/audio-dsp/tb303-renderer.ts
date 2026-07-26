// src/audio-dsp/tb303-renderer.ts
// Per-sample TB-303 voice renderer: saw/square osc → resonant lowpass with a
// fast cutoff-decay envelope → amp env. Accent = brighter + louder + more Q.
// Slide = pitch glide (approximated as instant for per-note rendering; cross-
// note glide is a VoiceManager concern at integration time) + no amp re-attack.
// Pure: no Web Audio globals. Sample rate injected via constructor.
import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets } from './types';
import { param } from './types';
import { SawOsc, SquareOsc } from './osc';
import { LadderFilter } from './ladder';
import type { ModLite } from './modulation-runtime';
import { ModEnvHost } from './mod-env-host';
import { registerRenderer } from './renderer-registry';
import { synthTrim } from './gain-staging';
import { velGain01, ACCENT_VCA_LADDER } from '../core/velocity-gain';
import { midiToFreq, clamp01 } from './dsp-util';

// Map the TB-303's biquad-Q (1 + resonance*25 + accent*6, so 1..31) onto the
// ladder's 0..1 resonance.
//
// The curve is concave (mpump's ^0.7) so the knob's useful range is spread out
// rather than bunched at the top — but it is scaled over the 303's OWN Q range,
// not mpump's. Borrowing their /20 saturated at resonance ≈0.76: the last
// quarter of the knob did nothing, and accent (which adds up to 6 Q) had no
// headroom left to push into.
const Q_MIN = 1;
const Q_MAX = 31;
function qToLadderRes(q: number): number {
  const norm = (Math.max(Q_MIN, q) - Q_MIN) / (Q_MAX - Q_MIN);
  return Math.min(1, Math.pow(norm, 0.7));
}

export class TB303Renderer implements VoiceRenderer {
  private osc: SawOsc | SquareOsc;
  // The 303 filters through a diode ladder — its asymmetric clipping is the
  // instrument's voice, not a detail. See ladder.ts.
  private filter: LadderFilter;
  private begin: number;
  private holdEnd: number;
  private freq: number;
  private peakAmp: number;
  private slide: boolean;
  // Trigger-time knob snapshot. Used as the fallback when no live bag is attached
  // (the offline kernel builds renderers directly) and as the base the modulation
  // offsets are added to.
  private cutoffBase: number;
  private resBase: number;
  private envModBase: number;
  private decayBase: number;
  private accentBoost: number;
  private accent: boolean;
  /** The lane's live (smoothed) knob bag, or null when this voice runs standalone. */
  private live: ParamBag | null = null;
  // Cached expensive conversions, refreshed only when their raw input moves.
  // 80·100^x and the Q→ladder curve are per-sample costs we refuse to pay while
  // nothing is turning.
  private cutRaw = NaN;
  private cutHz = 0;
  private resRaw = NaN;
  private resLadder = 0;
  private modEnv = new ModEnvHost();
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    const wave = param(p, 'osc.wave', 0);
    this.osc = wave >= 0.5 ? new SquareOsc(sr) : new SawOsc(sr);
    this.filter = new LadderFilter('diode', sr);

    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.freq = midiToFreq(note.midi);
    this.slide = note.slide;

    // Faithful port of TB303.trigger() DSP parameters:
    const cutoff = param(p, 'filter.cutoff', 0.42);
    const resonance = param(p, 'filter.resonance', 0.55);
    const envMod = param(p, 'env.amount', 0.5);
    const decay = param(p, 'env.decay', 0.4);
    const accentAmt = param(p, 'env.accent', 0.6);

    const accentBoost = note.accent ? accentAmt : 0;
    this.cutoffBase = cutoff;
    this.resBase = resonance;
    this.envModBase = envMod;
    this.decayBase = decay;
    this.accent = note.accent;
    this.accentBoost = accentBoost;

    // The 303 declares its own amp punch: its accent raises Q, and this ladder
    // LOSES level as Q climbs, so the shared punch left accents quieter than the
    // notes they punch. See ACCENT_VCA_LADDER.
    this.peakAmp = synthTrim('tb303') * velGain01(note.velocity, note.accent, ACCENT_VCA_LADDER);
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  setModEnvelopes(mods: ModLite[]): void { this.modEnv.setModEnvelopes(mods); }
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }
  setLiveParams(live: ParamBag): void { this.live = live; }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (this.done) return 0;
    if (t < this.begin) return 0;

    const dt = t - this.begin;
    const gate = t <= this.holdEnd ? 1 : 0;
    // Generic modulation reaches the 303's cutoff/resonance; its native acid
    // envelope (Env Mod + Decay) stays intact.
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;
    // Use the current holdEnd (may have been shortened by noteOff)
    const gateLen = this.holdEnd - this.begin;

    // Amp envelope — faithful port of the scheduled automation in TB303.trigger():
    //   - Slide: no re-attack (hold peakAmp from t=begin, gate already open)
    //   - Non-slide: 3 ms linear attack
    //   - Hold at peak until 20 ms before gate end (or after attack end)
    //   - Then ramp toward 0.001 by gate end (exp tail), then silence
    const attackDur = this.slide ? 0 : 0.003;
    const attackEnd = attackDur;
    const releaseStart = Math.max(attackEnd, gateLen - 0.02);

    let amp: number;
    if (!this.slide && dt < attackEnd) {
      // Attack ramp (non-slide only)
      amp = attackDur > 0 ? this.peakAmp * (dt / attackDur) : this.peakAmp;
    } else if (dt < releaseStart) {
      amp = this.peakAmp;
    } else {
      // Exponential release tail (20ms) to ~0.001
      const relDt = dt - releaseStart;
      const relDur = Math.max(gateLen - releaseStart, 0.001);
      // Mimic exponentialRamp from peakAmp → 0.001 over relDur
      const ratio = Math.min(relDt / relDur, 1);
      amp = this.peakAmp * Math.pow(0.001 / Math.max(this.peakAmp, 0.001), ratio);
      // After the gate has ended and the tail has decayed, mark voice done
      if (t > this.holdEnd && amp <= 0.001) {
        this.done = true;
        return 0;
      }
    }

    // Filter contour. The knob values come from the lane's LIVE bag, so turning
    // cutoff/res/env moves THIS note; modulation offsets are added on top exactly
    // as before, which is why a hand on the knob and an LFO simply sum.
    const L = this.live;
    const cutKnob = L ? param(L, 'filter.cutoff', this.cutoffBase) : this.cutoffBase;
    const resKnob = L ? param(L, 'filter.resonance', this.resBase) : this.resBase;
    const envKnob = L ? param(L, 'env.amount', this.envModBase) : this.envModBase;
    const decKnob = L ? param(L, 'env.decay', this.decayBase) : this.decayBase;

    const cutoff01 = mo?.['filter.cutoff'] ? clamp01(cutKnob + mo['filter.cutoff']) : cutKnob;
    if (cutoff01 !== this.cutRaw) { this.cutRaw = cutoff01; this.cutHz = 80 * Math.pow(100, cutoff01); }
    const baseCutHz = this.cutHz;

    const envMod01 = mo?.['env.amount'] ? clamp01(envKnob + mo['env.amount']) : envKnob;
    const peakCutHz = Math.min(baseCutHz + envMod01 * 6000 * (1 + this.accentBoost), 18000);

    // env.decay = how fast the cutoff closes; accent shortens it, as on the real synth.
    const decay01 = mo?.['env.decay'] ? clamp01(decKnob + mo['env.decay']) : decKnob;
    const decaySec = (0.05 + decay01 * 1.2) * (this.accent ? 0.6 : 1);
    const cutoffHz = baseCutHz + (peakCutHz - baseCutHz) * Math.exp(-dt / decaySec);

    // Biquad Q from the legacy synth (1 + res*25 + accent*6) mapped onto the
    // ladder's 0..1. Cached: the pow in qToLadderRes is not a per-sample cost.
    if (resKnob !== this.resRaw) {
      this.resRaw = resKnob;
      this.resLadder = qToLadderRes(1 + resKnob * 25 + this.accentBoost * 6);
    }
    const res = mo?.['filter.resonance'] ? clamp01(this.resLadder + mo['filter.resonance']) : this.resLadder;

    const oscOut = this.osc.update(this.freq);
    let out = this.filter.update(oscOut, cutoffHz, res) * amp;
    if (mo?.['amp.gain']) out *= Math.max(0, Math.min(2, 1 + mo['amp.gain']));
    return out;
  }
}

// Register under the REAL engine id from TB303Engine.id = 'tb303'
registerRenderer('tb303', (n, p, sr) => new TB303Renderer(n, p, sr));
