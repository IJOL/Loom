// src/audio-dsp/sample/sampler-renderer.ts
// Pure per-sample Sampler voice for the AudioWorklet engine. Dry path mirrors
// the legacy SamplerVoice (src/engines/sampler.ts): buffer player → per-pad
// lowpass (Svf) → linear attack/decay amp env → level × gain. Per-pad reverb/
// delay sends are exposed as the dry signal × send level for the processor's
// send bus; pan is reported for the processor's equal-power stereo write.
// Pure: no Web Audio — fed a SampleBank of transferred Float32Array channels.
import type { VoiceRenderer } from '../types';
import type { SampleData, SampleSpawn } from './types';
import { BufferPlayer, SampleBank } from './sample-bank';
import { Svf } from '../filter';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class SamplerRenderer implements VoiceRenderer {
  private player: BufferPlayer | null;
  private filter: Svf;
  private begin: number;
  private holdEnd: number;
  private s: SampleSpawn;
  private lastDry = 0;
  done = false;

  constructor(spawn: SampleSpawn, bank: SampleBank, private sr: number) {
    this.s = spawn;
    this.filter = new Svf(sr);
    this.begin = spawn.beginSec;
    this.holdEnd = spawn.beginSec + spawn.gateSec;
    const data: SampleData | undefined = bank.get(spawn.sampleId);
    if (!data) { this.player = null; this.done = true; return; }
    this.player = new BufferPlayer(data, sr);
    this.player.seek(spawn.offsetSec);
    if (spawn.loop) this.player.setLoop(true, spawn.loopStartSec, spawn.loopEndSec);
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  /** Linear attack → hold to the gate end → linear decay (matches the legacy
   *  SamplerVoice envelope: attack/decay ramps around the gate). */
  private ampAt(t: number): number {
    const dt = t - this.begin;
    const relAt = Math.max(this.s.attack, this.holdEnd - this.begin);
    if (dt < this.s.attack) return dt / Math.max(1e-4, this.s.attack);
    if (dt < relAt) return 1;
    const rel = dt - relAt;
    const a = 1 - rel / Math.max(1e-4, this.s.decay);
    return a > 0 ? a : 0;
  }

  renderSample(t: number): number {
    if (!this.player || t < this.begin) return 0;
    const amp = this.ampAt(t);
    if (t > this.holdEnd && amp <= 0) { this.done = true; this.lastDry = 0; return 0; }
    const raw = this.player.update(this.s.rate);
    // cutoff: 0..1 → 60·300^x Hz, clamped below Nyquist (legacy SamplerVoice mapping).
    const cutoffHz = Math.min(this.sr * 0.45, 60 * Math.pow(300, this.s.cutoff));
    // Svf resonance is a 0..1 damping parameter — pass the pad res straight
    // through (NOT scaled to a biquad Q). See filter.ts.
    this.filter.update(raw, cutoffHz, clamp01(this.s.res));
    this.lastDry = this.filter.lp * amp * this.s.level * this.s.gain;
    return this.lastDry;
  }

  /** Per-pad reverb send: the dry signal scaled by the pad's reverb level. */
  sendRev(): number { return this.lastDry * this.s.rev; }
  /** Per-pad delay send: the dry signal scaled by the pad's delay level. */
  sendDly(): number { return this.lastDry * this.s.dly; }
  /** Pan (-1..1) for the processor's equal-power stereo write. */
  pan(): number { return this.s.pan; }
}
