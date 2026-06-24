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

/** Plays a single SampleData mono-mixed, with fractional read, playbackRate and
 *  an optional loop window. `update(rate)` advances by `rate × srcRate/hostRate`
 *  source samples per host sample and returns the interpolated value, or 0 once
 *  past the end (unless looping). */
export class BufferPlayer {
  private pos = 0;            // fractional sample index into the source
  private step: number;       // src samples advanced per host sample at rate 1
  private len: number;
  private loop = false;
  private loopStart = 0;
  private loopEnd = 0;
  constructor(private data: SampleData, hostSampleRate: number) {
    this.step = data.sampleRate / hostSampleRate;
    this.len = data.channels[0]?.length ?? 0;
  }
  seek(offsetSec: number): void { this.pos = offsetSec * this.data.sampleRate; }
  setLoop(loop: boolean, startSec: number, endSec: number): void {
    this.loop = loop;
    this.loopStart = startSec * this.data.sampleRate;
    this.loopEnd = endSec * this.data.sampleRate;
  }
  /** mono mix of all channels at the current position; advances by rate·step. */
  update(rate: number): number {
    if (this.len === 0) return 0;
    if (this.pos >= this.len || (this.loop && this.loopEnd > this.loopStart && this.pos >= this.loopEnd)) {
      if (this.loop && this.loopEnd > this.loopStart) {
        this.pos = this.loopStart + ((this.pos - this.loopStart) % (this.loopEnd - this.loopStart));
      } else {
        return 0;
      }
    }
    const i = Math.floor(this.pos);
    const f = this.pos - i;
    let s = 0;
    for (const ch of this.data.channels) {
      const a = ch[i] ?? 0;
      const b = ch[i + 1] ?? a;
      s += a * (1 - f) + b * f;
    }
    s /= this.data.channels.length;
    this.pos += rate * this.step;
    return s;
  }
}
