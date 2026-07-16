// src/audio-dsp/drums/voices.ts
// Per-sample one-shot drum voice renderers — pure port of the play* methods in
// src/core/drums.ts. Each voice is a fixed-decay one-shot (no gate sustain): an
// exponential decay env  amp(t) = peak·(0.001/peak)^((t-t0)/decay)  matching the
// old graph's exponentialRampToValueAtTime(0.001, t0+decay) shape, so ampAt/choke
// can fade cleanly. Leaf param ids match seedSynthState(kit) in drums.ts.
//
// NOTE on filters: the old graph used BiquadFilter (bandpass/highpass with a Q).
// Here we use the kernel Svf, whose resonance arg is 0..1 (a damping parameter,
// NOT a biquad 0..22 Q — see filter.ts). The drum filters only need gentle
// shaping, so we pass small fixed resonance values through the bp/hp taps.
import type { DrumHit, DrumRenderer, DrumRendererCtor, DrumVoiceId } from './types';
import type { ParamBag } from '../types';
import { param } from '../types';
import { SineOsc, SquareOsc, TriOsc, WhiteNoise } from '../osc';
import { Svf } from '../filter';

const CHOKE_FADE = 0.006;   // 6 ms linear fade-to-zero on choke (matches drums.ts)
const TAIL = 0.05;          // extra silence past the decay before reporting done

function osc(wave: number, sr: number): { update(f: number): number } {
  const w = Math.round(wave);
  return w >= 2 ? new SquareOsc(sr) : w >= 1 ? new TriOsc(sr) : new SineOsc(sr);
}

/** exp decay from peak→~0 over `decay` s, matching exponentialRampToValueAtTime.
 *  Returns 0 before t0 and once the decay window has elapsed. */
function expEnv(peak: number, t0: number, t: number, decay: number): number {
  if (t < t0) return 0;
  const frac = decay > 0 ? (t - t0) / decay : 1;
  if (frac >= 1) return 0;
  return peak * Math.pow(0.001 / Math.max(1e-6, peak), frac);
}

/** Base class: handles the choke fade + done bookkeeping around a subclass DSP.
 *  Subclasses provide `source(t)` (the raw pre-amp signal, per sample) and set
 *  `peak`/`decay` in their constructor. */
abstract class OneShot implements DrumRenderer {
  protected t0: number;
  protected peak = 1;
  protected decay = 0.3;
  private chokeAt: number | null = null;
  private chokeFrom = 0;
  done = false;
  constructor(hit: DrumHit) { this.t0 = hit.beginSec; }

  /** Raw signal (pre-amp), per sample. */
  protected abstract source(t: number): number;

  ampAt(t: number): number {
    if (this.chokeAt != null) {
      const f = (t - this.chokeAt) / CHOKE_FADE;
      return f >= 1 ? 0 : this.chokeFrom * (1 - f);
    }
    return expEnv(this.peak, this.t0, t, this.decay);
  }

  choke(t: number): void {
    if (this.chokeAt == null) { this.chokeFrom = this.ampAt(t); this.chokeAt = t; }
  }

  renderSample(t: number): number {
    if (t < this.t0) return 0;
    const end = this.chokeAt != null ? this.chokeAt + CHOKE_FADE : this.t0 + this.decay + TAIL;
    if (t > end) { this.done = true; return 0; }
    return this.source(t) * this.ampAt(t);
  }
}

// ── Kick ─────────────────────────────────────────────────────────────────────
// sine/tri/square osc swept startFreq→endFreq over `sweep`; amp peak vel·1.2.
// Optional 1500 Hz square click (gated to the first 15 ms) scaled by `attack`.
class KickRenderer extends OneShot {
  private o: { update(f: number): number };
  private click: SquareOsc | null;
  private clickAmt: number; private sweep: number; private f0: number; private f1: number;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.f0 = param(p, 'startFreq', 220) * tune;
    this.f1 = param(p, 'endFreq', 55) * tune;
    this.sweep = param(p, 'sweep', 0.03);
    this.decay = param(p, 'decay', 0.4);
    this.peak = hit.velocity * 1.2;
    this.o = osc(param(p, 'wave', 0), sr);
    this.clickAmt = param(p, 'attack', 0.7);
    this.click = this.clickAmt > 0 ? new SquareOsc(sr) : null;
  }
  protected source(t: number): number {
    const dt = t - this.t0;
    const f = this.f0 * Math.pow(this.f1 / this.f0, Math.min(1, this.sweep > 0 ? dt / this.sweep : 1));
    let s = this.o.update(f);
    if (this.click && dt < 0.015) {
      // click amp is vel·attack·0.5 over its own 8 ms exp decay, relative to the
      // body peak so the *·ampAt(t) in the base re-applies the body env to it too
      // — but the click is short (15 ms) so the body env barely moves; close enough.
      const clickEnv = expEnv(1, this.t0, t, 0.008);
      const bodyEnv = Math.max(1e-6, this.ampAt(t));
      s += this.click.update(1500) * this.clickAmt * 0.5 * this.peak * clickEnv / bodyEnv;
    }
    return s;
  }
}

// ── Tom ──────────────────────────────────────────────────────────────────────
// sine swept startFreq→end over `sweep`; amp peak vel·1.0.
class TomRenderer extends OneShot {
  private o: SineOsc; private f0: number; private f1: number; private sweep: number;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.f0 = param(p, 'startFreq', 200) * tune;
    this.f1 = param(p, 'end', 90) * tune;
    this.sweep = param(p, 'sweep', 0.08);
    this.decay = param(p, 'decay', 0.5);
    this.peak = hit.velocity;
    this.o = new SineOsc(sr);
  }
  protected source(t: number): number {
    const dt = t - this.t0;
    const f = this.f0 * Math.pow(this.f1 / this.f0, Math.min(1, this.sweep > 0 ? dt / this.sweep : 1));
    return this.o.update(f);
  }
}

// ── Snare ────────────────────────────────────────────────────────────────────
// Two triangle bodies (tone1/tone2·tune, peak vel·tone, decay bodyDecay) +
// high-passed white noise (peak vel·snap, decay noiseDecay, hp at noiseTone·tune).
// The base applies ONE overall decay = max(bodyDecay, noiseDecay); source()
// re-weights each part by its own decay ratio so the relative envelopes survive.
class SnareRenderer extends OneShot {
  private o1: TriOsc; private o2: TriOsc; private noise = new WhiteNoise(); private hp: Svf;
  private f1: number; private f2: number; private bodyDecay: number; private toneAmt: number;
  private snap: number; private noiseDecay: number; private noiseHz: number;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.f1 = param(p, 'tone1', 240) * tune;
    this.f2 = param(p, 'tone2', 360) * tune;
    this.bodyDecay = param(p, 'bodyDecay', 0.04);
    this.toneAmt = param(p, 'tone', 0.35);
    this.snap = param(p, 'snap', 0.75);
    this.noiseDecay = param(p, 'noiseDecay', 0.18);
    this.noiseHz = param(p, 'noiseTone', 7000) * tune;
    this.decay = Math.max(this.bodyDecay, this.noiseDecay);
    this.peak = hit.velocity;
    this.o1 = new TriOsc(sr); this.o2 = new TriOsc(sr); this.hp = new Svf(sr);
  }
  protected source(t: number): number {
    // ampAt applies peak·env(overall decay); divide it back out per part and
    // multiply by that part's own env, so each part keeps its native decay shape.
    const overall = Math.max(1e-6, expEnv(this.peak, this.t0, t, this.decay));
    const bodyW = (this.toneAmt * expEnv(this.peak, this.t0, t, this.bodyDecay)) / overall;
    const noiseW = (this.snap * expEnv(this.peak, this.t0, t, this.noiseDecay)) / overall;
    // Legacy playSnare connected osc1 AND osc2 at unity into a single tone gain
    // (drums.ts: osc1.connect(toneAmp); osc2.connect(toneAmp)), so the body peak
    // is 2·(vel·tone). No ×0.5 merger gain — summing both at unity matches that.
    const body = (this.o1.update(this.f1) + this.o2.update(this.f2)) * bodyW;
    this.hp.update(this.noise.update(), this.noiseHz, 0.1);
    const noise = this.hp.hp * noiseW;
    return body + noise;
  }
}

// ── Hat (closed + open via the `decay` param) ─────────────────────────────────
// Six inharmonic squares summed (merger gain 0.25) → bandpass 10 kHz → highpass
// `filter` → amp peak vel, decay `decay`.
const HAT_FREQS = [205, 304, 369, 522, 540, 800];
class HatRenderer extends OneShot {
  private oscs: SquareOsc[]; private freqs: number[]; private bp: Svf; private hp: Svf; private filterHz: number;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.freqs = HAT_FREQS.map((f) => f * tune);
    this.filterHz = param(p, 'filter', 7000);
    this.decay = param(p, 'decay', 0.05);
    this.peak = hit.velocity;
    this.oscs = HAT_FREQS.map(() => new SquareOsc(sr));
    this.bp = new Svf(sr); this.hp = new Svf(sr);
  }
  protected source(_t: number): number {
    let mix = 0;
    for (let i = 0; i < this.oscs.length; i++) mix += this.oscs[i].update(this.freqs[i]);
    mix *= 0.25;
    this.bp.update(mix, 10000, 0.1);
    this.hp.update(this.bp.bp, this.filterHz, 0.1);
    return this.hp.hp;
  }
}

// ── Clap ──────────────────────────────────────────────────────────────────────
// Four band-passed noise bursts at offsets [0,11,22,33] ms. The first three are
// short (8 ms, peak vel·0.6); the last is the body (peak vel, decay `decay`). We
// model the burst sum internally (the base env is the body burst's; the early
// bursts are added on top with their own short envs in source()).
const CLAP_OFFSETS = [0, 0.011, 0.022, 0.033];
class ClapRenderer extends OneShot {
  private noise = new WhiteNoise(); private bp: Svf; private toneHz: number; private res: number;
  private earlyDecay = 0.008; private bodyDecay: number;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    this.toneHz = param(p, 'tone', 1500);
    this.bodyDecay = param(p, 'decay', 0.18);
    // `sharp` was a biquad Q (≈1–2); Svf resonance is 0..1, so scale it down and clamp.
    this.res = Math.min(0.9, param(p, 'sharp', 2) * 0.25);
    this.peak = hit.velocity;
    // overall decay must span the last burst's body so the base keeps it alive.
    this.decay = CLAP_OFFSETS[CLAP_OFFSETS.length - 1] + this.bodyDecay;
    this.bp = new Svf(sr);
  }
  protected source(t: number): number {
    // Sum each burst's own exponential env (relative weight); divide out the base
    // env so *·ampAt(t) restores absolute amplitude. One shared band-passed noise.
    const overall = Math.max(1e-6, expEnv(this.peak, this.t0, t, this.decay));
    let env = 0;
    for (let i = 0; i < CLAP_OFFSETS.length; i++) {
      const isLast = i === CLAP_OFFSETS.length - 1;
      const ot = this.t0 + CLAP_OFFSETS[i];
      if (t < ot) continue;
      const w = isLast ? this.peak : this.peak * 0.6;
      const d = isLast ? this.bodyDecay : this.earlyDecay;
      env += expEnv(w, ot, t, d);
    }
    this.bp.update(this.noise.update(), this.toneHz, this.res);
    return (this.bp.bp * env) / overall;
  }
}

// ── Cowbell ───────────────────────────────────────────────────────────────────
// Two squares (freq1·tune, freq2·tune·detune) summed (merger gain 0.4) → bandpass
// at (f1+f2)/2 → amp: peak vel·0.45, 5 ms attack ramp to vel·0.55, then decay.
class CowbellRenderer extends OneShot {
  private o1: SquareOsc; private o2: SquareOsc; private bp: Svf;
  private f1: number; private f2: number; private bpHz: number; private attackTo: number; private attackFrom: number;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.f1 = param(p, 'freq1', 540) * tune;
    this.f2 = param(p, 'freq2', 800) * tune * param(p, 'detune', 1);
    this.bpHz = (this.f1 + this.f2) / 2;
    this.decay = param(p, 'decay', 0.3);
    // peak of the env is vel·0.55 (after the 5 ms attack); the base env decays
    // from there. The short attack ramp is applied in source() as a gain.
    this.attackFrom = hit.velocity * 0.45;
    this.attackTo = hit.velocity * 0.55;
    this.peak = this.attackTo;
    this.o1 = new SquareOsc(sr); this.o2 = new SquareOsc(sr); this.bp = new Svf(sr);
  }
  protected source(t: number): number {
    let mix = (this.o1.update(this.f1) + this.o2.update(this.f2)) * 0.4;
    this.bp.update(mix, this.bpHz, 0.4);
    mix = this.bp.bp;
    const dt = t - this.t0;
    if (dt < 0.005) {
      // 5 ms linear attack from 0.45→0.55: scale relative to the base peak (0.55).
      const ramp = this.attackFrom + (this.attackTo - this.attackFrom) * (dt / 0.005);
      return mix * (ramp / Math.max(1e-6, this.peak));
    }
    return mix;
  }
}

// ── Ride ──────────────────────────────────────────────────────────────────────
// Six inharmonic squares (merger gain 0.18) → bandpass 5500 → highpass 3000 →
// amp peak vel·0.7, decay `decay`. Like a long shimmering open hat.
const RIDE_FREQS = [284, 372, 504, 712, 858, 1057];
class RideRenderer extends OneShot {
  private oscs: SquareOsc[]; private freqs: number[]; private bp: Svf; private hp: Svf;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.freqs = RIDE_FREQS.map((f) => f * tune);
    this.decay = param(p, 'decay', 1.2);
    this.peak = hit.velocity * 0.7;
    this.oscs = RIDE_FREQS.map(() => new SquareOsc(sr));
    this.bp = new Svf(sr); this.hp = new Svf(sr);
  }
  protected source(_t: number): number {
    let mix = 0;
    for (let i = 0; i < this.oscs.length; i++) mix += this.oscs[i].update(this.freqs[i]);
    mix *= 0.18;
    this.bp.update(mix, 5500, 0.1);
    this.hp.update(this.bp.bp, 3000, 0.1);
    return this.hp.hp;
  }
}

/** Crash — the ride's brighter, longer sibling: same metallic square bank, but
 *  detuned up, washed with noise and opened higher, so it reads as a cymbal
 *  crash rather than a ping. */
class CrashRenderer extends OneShot {
  private oscs: SquareOsc[]; private freqs: number[]; private noise = new WhiteNoise();
  private bp: Svf; private hp: Svf;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.freqs = RIDE_FREQS.map((f) => f * tune * 1.6);
    this.decay = param(p, 'decay', 2.5);
    this.peak = hit.velocity * 0.6;
    this.oscs = RIDE_FREQS.map(() => new SquareOsc(sr));
    this.bp = new Svf(sr); this.hp = new Svf(sr);
  }
  protected source(_t: number): number {
    let mix = 0;
    for (let i = 0; i < this.oscs.length; i++) mix += this.oscs[i].update(this.freqs[i]);
    mix = mix * 0.1 + this.noise.update() * 0.45;
    this.bp.update(mix, 8000, 0.06);
    this.hp.update(this.bp.bp, 4500, 0.06);
    return this.hp.hp;
  }
}

/** Rimshot (GM 37, side stick) — a dry click, not a drum: a short resonant
 *  burst around `freq` with a noise transient, gone in ~30 ms. */
class RimshotRenderer extends OneShot {
  private o: SquareOsc; private noise = new WhiteNoise(); private bp: Svf; private hz: number;
  constructor(hit: DrumHit, p: ParamBag, sr: number) {
    super(hit);
    this.hz = param(p, 'freq', 1700) * param(p, 'tune', 1);
    this.decay = param(p, 'decay', 0.03);
    this.peak = hit.velocity * 0.8;
    this.o = new SquareOsc(sr); this.bp = new Svf(sr);
  }
  protected source(_t: number): number {
    const mix = this.o.update(this.hz) * 0.6 + this.noise.update() * 0.4;
    this.bp.update(mix, this.hz, 0.5);
    return this.bp.bp;
  }
}

export const DRUM_RENDERERS: Record<DrumVoiceId, DrumRendererCtor> = {
  kick:      (h, p, sr) => new KickRenderer(h, p, sr),
  snare:     (h, p, sr) => new SnareRenderer(h, p, sr),
  rimshot:   (h, p, sr) => new RimshotRenderer(h, p, sr),
  closedHat: (h, p, sr) => new HatRenderer(h, p, sr),
  openHat:   (h, p, sr) => new HatRenderer(h, p, sr),
  clap:      (h, p, sr) => new ClapRenderer(h, p, sr),
  cowbell:   (h, p, sr) => new CowbellRenderer(h, p, sr),
  tom:       (h, p, sr) => new TomRenderer(h, p, sr),
  ride:      (h, p, sr) => new RideRenderer(h, p, sr),
  crash:     (h, p, sr) => new CrashRenderer(h, p, sr),
};
