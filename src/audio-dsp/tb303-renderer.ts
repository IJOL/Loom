// src/audio-dsp/tb303-renderer.ts
// Per-sample TB-303 voice renderer: saw/square osc → resonant lowpass with a
// fast cutoff-decay envelope → amp env. Accent = brighter + louder + more Q.
// Slide = pitch glide (approximated as instant for per-note rendering; cross-
// note glide is a VoiceManager concern at integration time) + no amp re-attack.
// Pure: no Web Audio globals. Sample rate injected via constructor.
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { SawOsc, SquareOsc } from './osc';
import { Svf } from './filter';
import { registerRenderer } from './renderer-registry';

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// velGain mirrors the logic from src/core/velocity-gain.ts:
// velToGain(v) = 0.3 + 1.1 * v (accent punch applied outside).
function velGain(velocity: number, accent: boolean): number {
  const g = 0.3 + 1.1 * velocity;
  return accent ? g * 1.1 : g;
}

// Map the TB-303's biquad-Q value (~1..31) to the Svf's resonance parameter.
// The Svf uses damping: r = 0.5^((res+0.125)/0.125).
// Empirical: Q 1 → res≈0, Q 25 → res≈0.8, capped at 1.0 to avoid blow-up.
function qToSvfRes(q: number): number {
  return Math.min(1.0, Math.max(0, (q - 1) / 30));
}

export class TB303Renderer implements VoiceRenderer {
  private osc: SawOsc | SquareOsc;
  private filter: Svf;
  private begin: number;
  private holdEnd: number;
  private freq: number;
  private baseCutHz: number;
  private peakCutHz: number;
  private decaySec: number;
  private svfRes: number;
  private peakAmp: number;
  private slide: boolean;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    const wave = param(p, 'osc.wave', 0);
    this.osc = wave >= 0.5 ? new SquareOsc(sr) : new SawOsc(sr);
    this.filter = new Svf(sr);

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

    this.baseCutHz = 80 * Math.pow(100, cutoff);
    const envAmount = envMod * 6000;
    this.decaySec = 0.05 + decay * 1.2;

    const accentBoost = note.accent ? accentAmt : 0;
    this.peakCutHz = Math.min(this.baseCutHz + envAmount * (1 + accentBoost), 18000);
    // accent shortens the filter decay (as in the real synth)
    if (note.accent) this.decaySec *= 0.6;

    // Biquad Q from the legacy synth: 1 + resonance*25 + accentBoost*6
    const biquadQ = 1 + resonance * 25 + accentBoost * 6;
    this.svfRes = qToSvfRes(biquadQ);

    this.peakAmp = 0.3 * velGain(note.velocity, note.accent);
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  renderSample(t: number): number {
    if (this.done) return 0;
    if (t < this.begin) return 0;

    const dt = t - this.begin;
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

    // Filter cutoff envelope: opens to peak at note start, decays to base
    // exponentially over decaySec. Uses dt from note begin.
    const cutoffHz = this.baseCutHz +
      (this.peakCutHz - this.baseCutHz) * Math.exp(-dt / this.decaySec);

    const oscOut = this.osc.update(this.freq);
    this.filter.update(oscOut, cutoffHz, this.svfRes);
    return this.filter.lp * amp;
  }
}

// Register under the REAL engine id from TB303Engine.id = 'tb303'
registerRenderer('tb303', (n, p, sr) => new TB303Renderer(n, p, sr));
