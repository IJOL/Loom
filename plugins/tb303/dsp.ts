// plugins/tb303/dsp.ts
// Per-sample TB-303 voice renderer: saw/square osc → resonant lowpass with a
// fast cutoff-decay envelope → amp env. Accent = brighter + louder + more Q.
// Slide = pitch glide (approximated as instant for per-note rendering; cross-
// note glide is a VoiceManager concern at integration time) + no amp re-attack.
// Pure: no Web Audio globals. Sample rate injected via constructor.
import {
  param, slotOf, SawOsc, SquareOsc, LadderFilter, ModEnvHost, velGain01,
  ACCENT_VCA_LADDER, midiToFreq, clamp01,
} from '@loom/plugin-sdk';
import type {
  NoteSpec, ParamBag, ParamIndex, VoiceRenderer, VoiceModOffsets, ModEnvSpec,
} from '@loom/plugin-sdk';

/** The amp tail's floor, in the units this renderer outputs in.
 *
 *  The 303's release is an exponentialRamp to an ABSOLUTE floor, and the voice
 *  is reaped when it reaches it. That makes it the ONE place where handing the
 *  engine trim to the host changes the SHAPE of the sound and not merely its
 *  level — a peak of 1.18 falling to the same floor is a steeper ramp and a
 *  later reap than 0.531 falling to it. Every other engine that moved out of
 *  the tree multiplied its trim in at the very end, where dropping it is a pure
 *  scale; this one does not.
 *
 *  0.54 is what the in-tree renderer's `synthTrim('tb303')` returned: the
 *  engine trim (0.45, now this manifest's `outputTrim`) times the host's synth
 *  category gain (1.2). Dividing the historical 0.001 by it puts the floor back
 *  where it was in output terms, and reproduces the tail sample for sample —
 *  which the parity test pins, and which caught this when the constant was
 *  simply carried over.
 *
 *  A FIXED number, deliberately not derived from `outputTrim`: this ramp is
 *  part of the instrument's voice, and rebalancing the 303 against the other
 *  engines must move its level, not the shape of its release. (The plugin could
 *  not derive it anyway — the category gain is the host's and no manifest
 *  carries it.) */
const AMP_FLOOR = 0.001 / 0.54;

// The 303's own amp punch (ACCENT_VCA_LADDER) is imported from the SDK, not
// redeclared: it is one number with one owner, and a local copy is how the same
// constant drifts into two values. The SDK owns the shared velocity curve
// (velGain01) and every accent multiplier an engine may opt into.

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
  // instrument's voice, not a detail. See the SDK's ladder.ts.
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
  /** The lane's live (smoothed) values, or null when this voice runs standalone.
   *  Addressed by the slots below, resolved ONCE in setLiveValues; -1 means the
   *  lane does not declare that id, so the trigger snapshot stands. */
  private live: Float64Array | null = null;
  private sCutoff = -1;
  private sRes = -1;
  private sEnvAmount = -1;
  private sEnvDecay = -1;
  /** The synthetic tremolo target. Not a declared param — the index appends it,
   *  which is what those three synthetic slots are for. */
  private sAmpGain = -1;
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

    // No engine trim here: the host applies capabilities.outputTrim from the
    // manifest. What stays is the 303's OWN amp punch — see ACCENT_VCA_LADDER.
    this.peakAmp = velGain01(note.velocity, note.accent, ACCENT_VCA_LADDER);
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  setModEnvelopes(mods: ModEnvSpec[], index: ParamIndex): void { this.modEnv.setModEnvelopes(mods, index); }
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }
  setLiveValues(values: Float64Array, index: ParamIndex): void {
    this.live = values;
    this.sCutoff = slotOf(index, 'filter.cutoff');
    this.sRes = slotOf(index, 'filter.resonance');
    this.sEnvAmount = slotOf(index, 'env.amount');
    this.sEnvDecay = slotOf(index, 'env.decay');
    this.sAmpGain = slotOf(index, 'amp.gain');
  }

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
    //   - Then ramp toward AMP_FLOOR by gate end (exp tail), then silence
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
      // Exponential release tail (20ms) to ~AMP_FLOOR
      const relDt = dt - releaseStart;
      const relDur = Math.max(gateLen - releaseStart, 0.001);
      // Mimic exponentialRamp from peakAmp → AMP_FLOOR over relDur
      const ratio = Math.min(relDt / relDur, 1);
      amp = this.peakAmp * Math.pow(AMP_FLOOR / Math.max(this.peakAmp, AMP_FLOOR), ratio);
      // After the gate has ended and the tail has decayed, mark voice done
      if (t > this.holdEnd && amp <= AMP_FLOOR) {
        this.done = true;
        return 0;
      }
    }

    // Filter contour. The knob values come from the lane's LIVE bag, so turning
    // cutoff/res/env moves THIS note; modulation offsets are added on top exactly
    // as before, which is why a hand on the knob and an LFO simply sum.
    const L = this.live;
    const cutKnob = L && this.sCutoff >= 0 ? L[this.sCutoff] : this.cutoffBase;
    const resKnob = L && this.sRes >= 0 ? L[this.sRes] : this.resBase;
    const envKnob = L && this.sEnvAmount >= 0 ? L[this.sEnvAmount] : this.envModBase;
    const decKnob = L && this.sEnvDecay >= 0 ? L[this.sEnvDecay] : this.decayBase;

    const cutoff01 = mo?.[this.sCutoff] ? clamp01(cutKnob + mo[this.sCutoff]) : cutKnob;
    if (cutoff01 !== this.cutRaw) { this.cutRaw = cutoff01; this.cutHz = 80 * Math.pow(100, cutoff01); }
    const baseCutHz = this.cutHz;

    const envMod01 = mo?.[this.sEnvAmount] ? clamp01(envKnob + mo[this.sEnvAmount]) : envKnob;
    const peakCutHz = Math.min(baseCutHz + envMod01 * 6000 * (1 + this.accentBoost), 18000);

    // env.decay = how fast the cutoff closes; accent shortens it, as on the real synth.
    const decay01 = mo?.[this.sEnvDecay] ? clamp01(decKnob + mo[this.sEnvDecay]) : decKnob;
    const decaySec = (0.05 + decay01 * 1.2) * (this.accent ? 0.6 : 1);
    const cutoffHz = baseCutHz + (peakCutHz - baseCutHz) * Math.exp(-dt / decaySec);

    // Biquad Q from the legacy synth (1 + res*25 + accent*6) mapped onto the
    // ladder's 0..1. Cached: the pow in qToLadderRes is not a per-sample cost.
    if (resKnob !== this.resRaw) {
      this.resRaw = resKnob;
      this.resLadder = qToLadderRes(1 + resKnob * 25 + this.accentBoost * 6);
    }
    const res = mo?.[this.sRes] ? clamp01(this.resLadder + mo[this.sRes]) : this.resLadder;

    const oscOut = this.osc.update(this.freq);
    let out = this.filter.update(oscOut, cutoffHz, res) * amp;
    if (mo?.[this.sAmpGain]) out *= Math.max(0, Math.min(2, 1 + mo[this.sAmpGain]));
    return out;
  }
}

Loom.registerRenderer('tb303', (n, p, sr) => new TB303Renderer(n, p, sr));
