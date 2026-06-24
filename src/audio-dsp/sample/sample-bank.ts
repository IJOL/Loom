// src/audio-dsp/sample/sample-bank.ts
// Worklet-side sample bank (id → decoded channels) + a pure per-sample player.
// No Web Audio: the bank is fed decoded buffers transferred from the main thread,
// and BufferPlayer reads them at a fractional position scaled by playbackRate.
import type { SampleData } from './types';

/** id → SampleData. The worklet's keymap-free store of decoded buffers. */
export class SampleBank {
  private map = new Map<string, SampleData>();
  set(id: string, d: SampleData): void { this.map.set(id, d); }
  get(id: string): SampleData | undefined { return this.map.get(id); }
  has(id: string): boolean { return this.map.has(id); }
}

/** Plays a single SampleData with fractional read, playbackRate and an optional
 *  loop window. `update(rate)` advances by `rate × srcRate/hostRate` source
 *  samples per host sample and returns the MONO MIX, or 0 once past the end
 *  (unless looping). It also stores the per-channel interpolated values in
 *  `lastL`/`lastR` so a stereo source's image survives (the legacy SamplerVoice
 *  fed the native stereo buffer through a StereoPanner — see sampler-renderer).
 *  For a mono source lastL === lastR. An optional one-shot END (setEnd, the pad
 *  sampleEnd trim) stops playback before the buffer end. */
export class BufferPlayer {
  private pos = 0;            // fractional sample index into the source
  private step: number;       // src samples advanced per host sample at rate 1
  private len: number;
  private loop = false;
  private loopStart = 0;
  private loopEnd = 0;
  private end = Infinity;     // one-shot trim-out, in source samples
  /** Per-channel value of the most recent update() (L = channel 0, R = channel 1
   *  or channel 0 for mono). Read by the renderer for the stereo pan. */
  lastL = 0;
  lastR = 0;
  /** Number of source channels (1 = mono, ≥2 = stereo). */
  readonly channelCount: number;
  constructor(private data: SampleData, hostSampleRate: number) {
    this.step = data.sampleRate / hostSampleRate;
    this.len = data.channels[0]?.length ?? 0;
    this.channelCount = data.channels.length;
  }
  seek(offsetSec: number): void { this.pos = offsetSec * this.data.sampleRate; }
  setLoop(loop: boolean, startSec: number, endSec: number): void {
    this.loop = loop;
    this.loopStart = startSec * this.data.sampleRate;
    this.loopEnd = endSec * this.data.sampleRate;
  }
  /** One-shot trim-out: stop producing once the read position passes `endSec`
   *  (buffer-time, absolute). Mirrors the legacy src.start(t, offset, duration)
   *  window so audio past the pad's sampleEnd never sounds. No effect on loops. */
  setEnd(endSec: number): void { this.end = endSec * this.data.sampleRate; }
  /** mono mix of all channels at the current position; advances by rate·step.
   *  Also updates lastL/lastR. */
  update(rate: number): number {
    if (this.len === 0) { this.lastL = 0; this.lastR = 0; return 0; }
    if (this.pos >= this.len || (!this.loop && this.pos >= this.end) ||
        (this.loop && this.loopEnd > this.loopStart && this.pos >= this.loopEnd)) {
      if (this.loop && this.loopEnd > this.loopStart) {
        this.pos = this.loopStart + ((this.pos - this.loopStart) % (this.loopEnd - this.loopStart));
      } else {
        this.lastL = 0; this.lastR = 0; return 0;
      }
    }
    const i = Math.floor(this.pos);
    const f = this.pos - i;
    const ch = this.data.channels;
    const read = (c: Float32Array): number => {
      const a = c[i] ?? 0;
      const b = c[i + 1] ?? a;
      return a * (1 - f) + b * f;
    };
    this.lastL = read(ch[0]);
    this.lastR = ch.length > 1 ? read(ch[1]) : this.lastL;
    // mono mix is the mean across all channels (so a 2-channel read = (L+R)/2).
    let s = 0;
    for (const c of ch) s += read(c);
    s /= ch.length;
    this.pos += rate * this.step;
    return s;
  }
}
