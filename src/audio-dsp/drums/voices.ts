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

/** TONE at its maximum means "filter open": the cascade is not built at all, so
 *  a default kick renders through exactly the pre-filter path it always did.
 *  Exported because the param spec MUST declare this same number as its max —
 *  two literals drifting apart would silently colour every default kit. */
export const KICK_TONE_OPEN = 12000;

// THUD is a punch, not a note: it has no length control on Karst's kick either,
// so it gets a fixed short decay and stays out of the parameter budget. It sits
// an octave ABOVE the landing frequency — at f1 it would merely double the note
// the body is already landing on, which is not a knock, it is more of the same.
const THUD_DECAY = 0.03;
const THUD_RATIO = 2;
// BOOM sits an octave below. With the body's own sweep between them, the three
// split the low end into knock, note and weight instead of stacking on one spot.
const BOOM_RATIO = 0.5;
// BOOM is the tail, so it outlasts the body it hangs off — tied to `decay`
// rather than being a number of its own, which keeps a long kick's sub long.
const BOOM_DECAY_RATIO = 1.5;
// The resonant shell. Svf's res is DAMPING (0..1): higher rings longer.
//
// The normaliser is MEASURED, not derived, and the difference matters. This
// topology's bandpass peaks at 0.5/r in its FREQUENCY RESPONSE — 27.9 at this
// res — which is the right normaliser for a sine sitting on the centre and the
// wrong one for noise, where only a narrow band gets through. Driven by white
// noise the tap actually comes out at RMS 0.89 / peak 2.61 (measured, 800 Hz,
// 44.1 kHz), so dividing by 27.9 buried the whole layer 28x under everything
// else. Normalising by the measured PEAK puts a full body at the same peak as
// the kick body it sits beside.
const BODY_RES = 0.6;
const BODY_BP_PEAK = 2.61;
const BODY_BP_NORM = 1 / BODY_BP_PEAK;

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

/** tanh saturation, normalised by tanh(k) so the PEAK stays put as drive rises
 *  and only the shape changes — otherwise DRIVE doubles as a volume knob and
 *  every A/B sounds "better" simply for being louder. drive 0 is a bypass, not
 *  a near-bypass: the identity must be exact so kits keep their sound. */
function saturate(x: number, drive: number): number {
  if (drive <= 0) return x;
  const k = 1 + drive * 9;
  return Math.tanh(x * k) / Math.tanh(k);
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
  /** Longest tail of any post-envelope `extra()` layer, so a snap that outlives
   *  the body env is not cut short by `done`. 0 when the voice has no extra. */
  protected extraDecay = 0;
  done = false;
  constructor(hit: DrumHit) { this.t0 = hit.beginSec; }

  /** Raw signal (pre-amp), per sample. */
  protected abstract source(t: number): number;

  /** Optional layer that carries its OWN envelope and must therefore bypass the
   *  amp env (a transient whose decay is independent of the body). It is still
   *  choked, via chokeScale. Default 0 — most voices are a single source. */
  protected extra(_t: number): number { return 0; }

  /** Applied to the SUMMED voice (source·env + extra), so a filter or saturator
   *  sees every layer — the order a real signal path has. Identity by default. */
  protected postFx(y: number): number { return y; }

  /** 1 → 0 across the choke fade; 1 when not choked. Multiplies `extra`, which
   *  does not pass through ampAt and would otherwise survive a choke. */
  protected chokeScale(t: number): number {
    if (this.chokeAt == null) return 1;
    const f = (t - this.chokeAt) / CHOKE_FADE;
    return f >= 1 ? 0 : 1 - f;
  }

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
    const end = this.chokeAt != null
      ? this.chokeAt + CHOKE_FADE
      : this.t0 + Math.max(this.decay, this.extraDecay) + TAIL;
    if (t > end) { this.done = true; return 0; }
    return this.postFx(this.source(t) * this.ampAt(t) + this.extra(t) * this.chokeScale(t));
  }
}

// ── Kick ─────────────────────────────────────────────────────────────────────
// sine/tri/square osc swept startFreq→endFreq over `sweep`; amp peak vel·1.2.
// Optional 1500 Hz square click (gated to the first 15 ms) scaled by `attack`.
//
// Everything past that was added 2026-08-23 to reach the FULL control set of
// Karst's factory kick, whose ten boundary ports are Pitch, Length, Snap, Thud,
// Boom, Tone, Body, Body Centre, Body Length and Trigger. Three of those we
// already had under other names (Pitch = tune/startFreq/endFreq, Length = decay,
// Trigger = the hit itself); the other seven are below. Their patch spends 72
// modules on it; this is the same reach in ~70 lines.
//
//   SNAP + SDEC — a noise transient on its OWN envelope (post-amp, hence
//                 extra()): a click that can outlive or die before the body.
//   THUD        — a short low burst at the landing frequency: the punch that
//                 lands before the body has settled. Fixed short decay, as
//                 theirs has no Thud Length.
//   BOOM        — the sub tail, an octave under the landing frequency, on a
//                 decay longer than the body's. Thud and Boom split the low end
//                 into its attack and its weight.
//   BODY + BCTR + BLEN — the resonant shell: noise through a bandpass at Body
//                 Centre, ringing for Body Length. This is the one that was not
//                 reachable at all before; a kick had no resonance of its own.
//   TONE        — two cascaded Svf lowpasses = 24 dB/oct, the 4-pole they use.
//   DRIVE       — tanh saturation, after the filter, as in their signal path.
//
// Every amount defaults to 0 and TONE defaults to open, so no existing kit
// changes by a single sample — proved by kick-shape.dsp.test.ts.
class KickRenderer extends OneShot {
  private o: { update(f: number): number };
  private click: SquareOsc | null;
  private clickAmt: number; private sweep: number; private f0: number; private f1: number;
  private noise: WhiteNoise | null; private snapAmt: number; private snapDecay: number;
  private thudOsc: SineOsc | null; private thudAmt: number;
  private boomOsc: SineOsc | null; private boomAmt: number; private boomDecay: number;
  private bodyNoise: WhiteNoise | null; private bodyBp: Svf | null;
  private bodyAmt: number; private bodyCentre: number; private bodyLength: number;
  private lpA: Svf | null; private lpB: Svf | null; private tone: number; private drive: number;
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

    this.snapAmt = param(p, 'snap', 0);
    this.snapDecay = param(p, 'snapDecay', 0.02);
    this.noise = this.snapAmt > 0 ? new WhiteNoise() : null;

    this.thudAmt = param(p, 'thud', 0);
    this.thudOsc = this.thudAmt > 0 ? new SineOsc(sr) : null;

    this.boomAmt = param(p, 'boom', 0);
    this.boomDecay = this.decay * BOOM_DECAY_RATIO;
    this.boomOsc = this.boomAmt > 0 ? new SineOsc(sr) : null;

    this.bodyAmt = param(p, 'body', 0);
    this.bodyCentre = param(p, 'bodyCentre', 220);
    this.bodyLength = param(p, 'bodyLength', 0.12);
    this.bodyNoise = this.bodyAmt > 0 ? new WhiteNoise() : null;
    this.bodyBp = this.bodyAmt > 0 ? new Svf(sr) : null;

    // The base ends the voice at max(decay, extraDecay): every extra layer has to
    // declare its tail or it is cut off mid-ring when `done` flips.
    this.extraDecay = Math.max(
      this.noise ? this.snapDecay : 0,
      this.thudOsc ? THUD_DECAY : 0,
      this.boomOsc ? this.boomDecay : 0,
      this.bodyNoise ? this.bodyLength : 0,
    );

    this.tone = param(p, 'tone', KICK_TONE_OPEN);
    this.drive = param(p, 'drive', 0);
    const filtered = this.tone < KICK_TONE_OPEN;
    this.lpA = filtered ? new Svf(sr) : null;
    this.lpB = filtered ? new Svf(sr) : null;
  }

  /** The four layers that bypass the amp env. That separation IS the feature —
   *  each carries its own exp decay, which is what "four AD envelopes" buys you
   *  and what a single shared envelope can never express. */
  protected extra(t: number): number {
    let s = 0;
    if (this.noise) {
      const env = expEnv(1, this.t0, t, this.snapDecay);
      if (env > 0) s += this.noise.update() * this.snapAmt * this.peak * env;
    }
    if (this.thudOsc) {
      // An octave over the sweep's destination: the knock, not the note.
      const env = expEnv(1, this.t0, t, THUD_DECAY);
      if (env > 0) s += this.thudOsc.update(this.f1 * THUD_RATIO) * this.thudAmt * this.peak * env;
    }
    if (this.boomOsc) {
      const env = expEnv(1, this.t0, t, this.boomDecay);
      if (env > 0) s += this.boomOsc.update(this.f1 * BOOM_RATIO) * this.boomAmt * this.peak * env;
    }
    if (this.bodyNoise && this.bodyBp) {
      const env = expEnv(1, this.t0, t, this.bodyLength);
      if (env > 0) {
        this.bodyBp.update(this.bodyNoise.update(), this.bodyCentre, BODY_RES);
        // Normalised: this topology's bandpass peaks at 0.5/r, so without
        // BODY_BP_NORM a resonant body would be ~28x everything else.
        s += this.bodyBp.bp * BODY_BP_NORM * this.bodyAmt * this.peak * env;
      }
    }
    return s;
  }

  /** 4-pole lowpass then saturation, over the summed voice. Resonance is 0: a
   *  kick wants a slope, not a peak, and Svf's res is a damping term (0..1),
   *  not a biquad Q — see the note at the top of this file. */
  protected postFx(y: number): number {
    let s = y;
    if (this.lpA && this.lpB) {
      this.lpA.update(s, this.tone, 0);
      this.lpB.update(this.lpA.lp, this.tone, 0);
      s = this.lpB.lp;
    }
    return saturate(s, this.drive);
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
