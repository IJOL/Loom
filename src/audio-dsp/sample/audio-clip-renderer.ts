// src/audio-dsp/sample/audio-clip-renderer.ts
// Pure per-sample audio-clip voice for the AudioWorklet engine. Flat gain with
// ~5 ms anti-click fades and no filter — mirrors src/engines/audio-clip-voice.ts
// (playAudioClip). Warp/stretch is a main-thread pre-render: by the time a spawn
// reaches here, OUTPUT_TRIM and the playback rate are already folded into
// spawn.gain / spawn.rate, and spawn.sampleId points at the rendered buffer.
// Pure: no Web Audio — fed a SampleBank of transferred Float32Array channels.
import type { VoiceRenderer } from '../types';
import type { SampleSpawn } from './types';
import { BufferPlayer, SampleBank } from './sample-bank';

export class AudioClipRenderer implements VoiceRenderer {
  private player: BufferPlayer | null;
  private begin: number;
  private gate: number;
  private gain: number;
  private rate: number;
  done = false;

  constructor(spawn: SampleSpawn, bank: SampleBank, sr: number) {
    this.begin = spawn.beginSec;
    this.gate = Math.max(1e-4, spawn.gateSec);
    this.gain = spawn.gain;
    this.rate = spawn.rate;
    const d = bank.get(spawn.sampleId);
    if (!d) { this.player = null; this.done = true; return; }
    this.player = new BufferPlayer(d, sr);
    this.player.seek(spawn.offsetSec);
    if (spawn.loop) this.player.setLoop(true, spawn.loopStartSec, spawn.loopEndSec);
  }

  noteOff(t: number): void { if (t - this.begin < this.gate) this.gate = Math.max(1e-4, t - this.begin); }

  renderSample(t: number): number {
    if (!this.player || t < this.begin) return 0;
    const dt = t - this.begin;
    if (dt > this.gate) { this.done = true; return 0; }
    // ~5 ms anti-click fades at both ends (matches playAudioClip's fade).
    const fade = Math.min(0.005, this.gate / 4);
    let env = 1;
    if (dt < fade) env = dt / fade;
    else if (dt > this.gate - fade) env = (this.gate - dt) / fade;
    return this.player.update(this.rate) * Math.max(0, env) * this.gain;
  }
}
