// Real AudioWorklet processor for the Sampler + Audio-channel engines: a worklet
// sample bank (decoded channels transferred from the main thread, keyed by
// sampleId) + a SchedulerQueue of fully-resolved spawns feeding per-voice
// SamplerRenderer / AudioClipRenderer instances. Bundled by Vite via the
// ?worker&url import in sampler-node.ts so normal TypeScript imports resolve
// inside the worklet bundle.
//
// Two stereo outputs:
//   outputs[0] = DRY  (each voice equal-power panned)
//   outputs[1] = SEND (per-pad reverb + delay sends summed; the node fans this
//                one stereo bus to both FxBus inputs).
//
// CRITICAL: do NOT import sampler-node.ts here — sampler-node imports this file's
// bundled URL; a reverse import would create a circular bundle dependency. The
// registered name is the plain string literal "sampler-processor", shared with
// the node only as that literal (no symbol import in either direction).
/// <reference path="./worklet-globals.d.ts" />
import { SampleBank } from '../audio-dsp/sample/sample-bank';
import { SchedulerQueue } from '../audio-dsp/scheduler-queue';
import { SamplerRenderer } from '../audio-dsp/sample/sampler-renderer';
import { AudioClipRenderer } from '../audio-dsp/sample/audio-clip-renderer';
import type { SampleSpawn } from '../audio-dsp/sample/types';

type SamplerMsg =
  | { type: 'loadSample'; sampleId: string; channels: Float32Array[]; sampleRate: number }
  | { type: 'spawn'; kind: 'sampler' | 'audio'; spawn: SampleSpawn }
  | { type: 'silence' };

interface Slot {
  r: SamplerRenderer | AudioClipRenderer;
  pan: number;        // -1..1, equal-power on the dry output
  rev: number;        // per-pad reverb send level (sampler only)
  dly: number;        // per-pad delay send level (sampler only)
  sends: boolean;     // whether this voice contributes to the send bus
}

class SamplerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }
  private bank = new SampleBank();
  private queue = new SchedulerQueue<{ kind: 'sampler' | 'audio'; spawn: SampleSpawn }>();
  private live: Slot[] = [];
  private frame = Math.floor(currentTime * sampleRate);

  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (e: MessageEvent<SamplerMsg>) => {
      const m = e.data;
      if (m.type === 'loadSample') {
        this.bank.set(m.sampleId, { channels: m.channels, sampleRate: m.sampleRate });
      } else if (m.type === 'spawn') {
        this.queue.push(Math.floor(m.spawn.beginSec * sampleRate), { kind: m.kind, spawn: m.spawn });
      } else if (m.type === 'silence') {
        // Transport Stop: note-off every live voice now (a long loop/song clip
        // would otherwise play its whole buffer past the Stop). Each renderer's
        // noteOff shortens its gate so it fades out + flips `done` next render.
        const t = this.frame / sampleRate;
        for (const slot of this.live) slot.r.noteOff(t);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const dry = outputs[0];
    const send = outputs[1];
    const n = dry[0].length;
    for (let i = 0; i < n; i++) {
      const t = this.frame / sampleRate;
      // Spawn any voices due at this exact frame (sample-accurate start).
      this.queue.drainDue(this.frame, ({ kind, spawn }) => {
        const r = kind === 'audio'
          ? new AudioClipRenderer(spawn, this.bank, sampleRate)
          : new SamplerRenderer(spawn, this.bank, sampleRate);
        this.live.push({ r, pan: spawn.pan, rev: spawn.rev, dly: spawn.dly, sends: kind === 'sampler' });
      });
      let l = 0;
      let rr = 0;
      let se = 0;
      for (let s = this.live.length - 1; s >= 0; s--) {
        const slot = this.live[s];
        const mono = slot.r.renderSample(t);
        // equal-power pan: -1 → hard left, +1 → hard right.
        const p = (slot.pan + 1) * 0.25 * Math.PI;
        l += mono * Math.cos(p);
        rr += mono * Math.sin(p);
        if (slot.sends && slot.r instanceof SamplerRenderer) se += slot.r.sendRev() + slot.r.sendDly();
        if (slot.r.done) this.live.splice(s, 1);
      }
      dry[0][i] = l;
      dry[1][i] = rr;
      send[0][i] = se;
      send[1][i] = se;
      this.frame++;
    }
    return true;
  }
}

registerProcessor('sampler-processor', SamplerProcessor);
