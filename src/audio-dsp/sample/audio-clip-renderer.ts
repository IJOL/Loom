// src/audio-dsp/sample/audio-clip-renderer.ts
// Pure per-sample audio-clip voice for the AudioWorklet engine. Flat gain with
// ~5 ms anti-click fades and no filter — mirrors src/engines/audio-clip-voice.ts
// (playAudioClip). Warp/stretch is a main-thread pre-render: by the time a spawn
// reaches here, OUTPUT_TRIM and the playback rate are already folded into
// spawn.gain / spawn.rate, and spawn.sampleId points at the rendered buffer.
// The native stereo channels are preserved (the Audio channel exists to play
// full stereo songs/stems — the legacy AudioVoice fed the stereo buffer through
// a plain GainNode, no mono-sum), so renderStereoInto reports L/R.
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
  outL = 0;
  outR = 0;
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

  private envAt(dt: number): number {
    // ~5 ms anti-click fades at both ends (matches playAudioClip's fade).
    const fade = Math.min(0.005, this.gate / 4);
    if (dt < fade) return dt / fade;
    if (dt > this.gate - fade) return (this.gate - dt) / fade;
    return 1;
  }

  /** Render one stereo sample into outL/outR (native channels preserved). */
  renderStereoInto(t: number): { l: number; r: number } {
    if (!this.player || t < this.begin) { this.outL = 0; this.outR = 0; return { l: 0, r: 0 }; }
    const dt = t - this.begin;
    if (dt > this.gate) { this.done = true; this.outL = 0; this.outR = 0; return { l: 0, r: 0 }; }
    this.player.update(this.rate);   // advances + fills lastL/lastR
    const g = Math.max(0, this.envAt(dt)) * this.gain;
    this.outL = this.player.lastL * g;
    this.outR = this.player.lastR * g;
    return { l: this.outL, r: this.outR };
  }

  renderSample(t: number): number {
    const { l, r } = this.renderStereoInto(t);
    return (l + r) * 0.5;
  }
}
