// src/audio-dsp/sample/sampler-renderer.ts
// Pure per-sample Sampler voice for the AudioWorklet engine. Dry path mirrors
// the legacy SamplerVoice (src/engines/sampler.ts): buffer player → per-pad
// lowpass (Svf) → linear attack/decay amp env → level × gain → StereoPanner.
// The native stereo channels are preserved through the chain (a stereo sample
// keeps its image) — a separate Svf per channel filters L and R, then the pad
// pan is applied with the Web Audio StereoPanner algorithm (equal-power for a
// mono source, image-preserving for a stereo source). Per-pad reverb/delay
// sends are the post-pan L/R × the send level, reported on SEPARATE channels so
// the processor can route them to DISTINCT FxBus inputs (rev→reverb, dly→delay).
// Pure: no Web Audio — fed a SampleBank of transferred Float32Array channels.
import type { VoiceRenderer } from '../types';
import type { SampleData, SampleSpawn } from './types';
import { BufferPlayer, SampleBank } from './sample-bank';
import { Svf } from '../filter';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CHOKE_FADE = 0.006; // 6 ms linear fade-to-zero on choke (matches the drums voices)

export class SamplerRenderer implements VoiceRenderer {
  private player: BufferPlayer | null;
  private filterL: Svf;
  private filterR: Svf;
  private begin: number;
  private holdEnd: number;
  private s: SampleSpawn;
  // Choke: a fast linear fade-to-zero from the amp value the env had reached
  // (`chokeFrom`) starting at `chokeAt`. Independent of the gate/decay, so a
  // still-ringing (or looping) voice is cut hard when a group-mate or a mono
  // re-hit triggers. Mirrors the drums OneShot choke.
  private chokeAt: number | null = null;
  private chokeFrom = 0;
  // Post-pan stereo dry output of the most recent render (read by the processor).
  outL = 0;
  outR = 0;
  done = false;

  constructor(spawn: SampleSpawn, bank: SampleBank, private sr: number) {
    this.s = spawn;
    this.filterL = new Svf(sr);
    this.filterR = new Svf(sr);
    this.begin = spawn.beginSec;
    this.holdEnd = spawn.beginSec + spawn.gateSec;
    const data: SampleData | undefined = bank.get(spawn.sampleId);
    if (!data) { this.player = null; this.done = true; return; }
    this.player = new BufferPlayer(data, sr);
    this.player.seek(spawn.offsetSec);
    if (spawn.loop) this.player.setLoop(true, spawn.loopStartSec, spawn.loopEndSec);
    else if (spawn.endSec != null) this.player.setEnd(spawn.endSec);
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  /** Start a fast fade-to-zero at time t (choke). Idempotent: a second choke does
   *  not restart the fade from the (already lower) current level. */
  choke(t: number): void {
    if (this.chokeAt == null) { this.chokeFrom = this.ampAt(t); this.chokeAt = t; }
  }

  /** Linear attack → hold to the gate end → linear decay (matches the legacy
   *  SamplerVoice envelope: attack/decay ramps around the gate). Once choked, the
   *  fast 6 ms choke fade overrides the gate envelope. */
  private ampAt(t: number): number {
    if (this.chokeAt != null) {
      const f = (t - this.chokeAt) / CHOKE_FADE;
      return f >= 1 ? 0 : this.chokeFrom * (1 - f);
    }
    const dt = t - this.begin;
    const relAt = Math.max(this.s.attack, this.holdEnd - this.begin);
    if (dt < this.s.attack) return dt / Math.max(1e-4, this.s.attack);
    if (dt < relAt) return 1;
    const rel = dt - relAt;
    const a = 1 - rel / Math.max(1e-4, this.s.decay);
    return a > 0 ? a : 0;
  }

  /** Render one stereo sample (post-filter, post-amp, post-pan) into outL/outR. */
  private renderStereo(t: number): void {
    if (!this.player || t < this.begin) { this.outL = 0; this.outR = 0; return; }
    const amp = this.ampAt(t);
    const chokeDone = this.chokeAt != null && t >= this.chokeAt + CHOKE_FADE;
    if ((t > this.holdEnd && amp <= 0) || chokeDone) { this.done = true; this.outL = 0; this.outR = 0; return; }
    this.player.update(this.s.rate);   // advances + fills lastL/lastR
    // cutoff: 0..1 → 60·300^x Hz, clamped below Nyquist (legacy SamplerVoice mapping).
    const cutoffHz = Math.min(this.sr * 0.45, 60 * Math.pow(300, this.s.cutoff));
    const res = clamp01(this.s.res);
    // Svf resonance is a 0..1 damping parameter — pass the pad res straight
    // through (NOT scaled to a biquad Q). One filter instance per channel so a
    // stereo sample's two channels are filtered independently (same coeffs).
    this.filterL.update(this.player.lastL, cutoffHz, res);
    this.filterR.update(this.player.lastR, cutoffHz, res);
    const g = amp * this.s.level * this.s.gain;
    const dl = this.filterL.lp * g;
    const dr = this.filterR.lp * g;
    // Pan via the Web Audio StereoPanner algorithm. A mono source (lastL===lastR)
    // gets equal-power panning (−3 dB centre, matching the old equal-power write);
    // a stereo source keeps its image (identity at pan=0).
    const pan = this.s.pan;
    if (this.player.channelCount > 1) {
      // Stereo-input algorithm (W3C): preserves the image, identity at pan 0.
      if (pan <= 0) {
        const x = (pan + 1) * 0.5 * Math.PI;
        this.outL = dl + dr * Math.cos(x);
        this.outR = dr * Math.sin(x);
      } else {
        const x = pan * 0.5 * Math.PI;
        this.outL = dl * Math.cos(x);
        this.outR = dr + dl * Math.sin(x);
      }
    } else {
      // Mono-input algorithm (W3C): equal-power constant-power pan.
      const x = (pan + 1) * 0.25 * Math.PI;
      this.outL = dl * Math.cos(x);
      this.outR = dr * Math.sin(x);
    }
  }

  /** Render the mono mix at time t (sum of the post-pan stereo). Retained for the
   *  unit tests / callers that don't need the stereo pair. */
  renderSample(t: number): number {
    this.renderStereo(t);
    return this.outL + this.outR;
  }

  /** Render one stereo sample and report the post-pan L/R. The processor uses
   *  this for the dry bus + (via the send getters) the per-pad FX sends. */
  renderStereoInto(t: number): { l: number; r: number } {
    this.renderStereo(t);
    return { l: this.outL, r: this.outR };
  }

  /** Per-pad reverb send (stereo, post-pan dry × the pad's reverb level). */
  sendRevL(): number { return this.outL * this.s.rev; }
  sendRevR(): number { return this.outR * this.s.rev; }
  /** Per-pad delay send (stereo, post-pan dry × the pad's delay level). */
  sendDlyL(): number { return this.outL * this.s.dly; }
  sendDlyR(): number { return this.outR * this.s.dly; }
  /** Pan (-1..1) — retained for callers/tests that inspect the spawn pan. */
  pan(): number { return this.s.pan; }
}
