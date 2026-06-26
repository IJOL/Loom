// Real AudioWorklet processor for the Sampler + Audio-channel engines: a worklet
// sample bank (decoded channels transferred from the main thread, keyed by
// sampleId) + a SchedulerQueue of fully-resolved spawns feeding per-voice
// SamplerRenderer / AudioClipRenderer instances. Bundled by Vite via the
// ?worker&url import in sampler-node.ts so normal TypeScript imports resolve
// inside the worklet bundle.
//
// Three stereo outputs (each voice renders a stereo pair — native L/R preserved,
// then the pad pan applied — so a stereo sample / song keeps its image):
//   outputs[0] = DRY     (post-pan L/R)
//   outputs[1] = REVERB SEND (per-pad reverb send, post-pan L/R)
//   outputs[2] = DELAY SEND  (per-pad delay send, post-pan L/R)
// The reverb and delay sends are SEPARATE buses (Send A/B): the node routes
// output[1]→reverbInput and output[2]→delayInput, so a pad's rev level cannot
// bleed into the delay bus (or vice versa).
//
// CRITICAL: do NOT import sampler-node.ts here — sampler-node imports this file's
// bundled URL; a reverse import would create a circular bundle dependency. The
// registered name is the plain string literal "sampler-processor", shared with
// the node only as that literal (no symbol import in either direction).
/// <reference path="./worklet-globals.d.ts" />
import { SampleBank } from '../audio-dsp/sample/sample-bank';
import { SchedulerQueue } from '../audio-dsp/scheduler-queue';
import { ScheduledNoteOffs } from '../audio-dsp/scheduled-noteoffs';
import { SamplerRenderer } from '../audio-dsp/sample/sampler-renderer';
import { AudioClipRenderer } from '../audio-dsp/sample/audio-clip-renderer';
import type { SampleSpawn } from '../audio-dsp/sample/types';

type SamplerMsg =
  | { type: 'loadSample'; sampleId: string; channels: Float32Array[]; sampleRate: number }
  | { type: 'spawn'; kind: 'sampler' | 'audio'; spawn: SampleSpawn }
  // `atSec` (audio-clock seconds): when present and still in the future, the
  // currently-live voices are note-off'd AT that frame instead of immediately —
  // the gapless scene-switch path (cut the outgoing clip exactly when the
  // incoming one starts). Absent / already-past ⇒ immediate (transport Stop, seek).
  | { type: 'silence'; atSec?: number };

interface Slot {
  r: SamplerRenderer | AudioClipRenderer;
  sampler: boolean;   // true ⇒ SamplerRenderer (has per-pad FX sends); false ⇒ AudioClipRenderer
}

class SamplerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }
  private bank = new SampleBank();
  private queue = new SchedulerQueue<{ kind: 'sampler' | 'audio'; spawn: SampleSpawn }>();
  private scheduledOffs = new ScheduledNoteOffs<SamplerRenderer | AudioClipRenderer>();
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
        // Note-off the live voices. A long loop/song clip would otherwise play its
        // whole buffer past the cut. Each renderer's noteOff shortens its gate so
        // it fades out + flips `done` next render.
        const atFrame = m.atSec != null ? Math.floor(m.atSec * sampleRate) : this.frame;
        if (atFrame <= this.frame) {
          // Immediate (transport Stop, seek): cut now.
          const t = this.frame / sampleRate;
          for (const slot of this.live) slot.r.noteOff(t);
        } else {
          // Gapless scene switch: cut the CURRENTLY-live (outgoing) voices exactly
          // at T. Voices spawned later (the incoming clip, beginSec === T) are not
          // captured here, so they start clean while the old ones fade at T.
          this.scheduledOffs.schedule(atFrame, this.live.map((s) => s.r));
        }
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const dry = outputs[0];
    const rev = outputs[1];   // reverb send (Send B)
    const dly = outputs[2];   // delay send (Send A)
    const n = dry[0].length;
    for (let i = 0; i < n; i++) {
      const t = this.frame / sampleRate;
      // Fire any scheduled note-offs due at this frame (gapless scene switch): the
      // outgoing voices fade exactly at T, the same frame the incoming clip spawns.
      this.scheduledOffs.drainDue(this.frame, sampleRate);
      // Spawn any voices due at this exact frame (sample-accurate start).
      this.queue.drainDue(this.frame, ({ kind, spawn }) => {
        const r = kind === 'audio'
          ? new AudioClipRenderer(spawn, this.bank, sampleRate)
          : new SamplerRenderer(spawn, this.bank, sampleRate);
        this.live.push({ r, sampler: kind === 'sampler' });
      });
      let l = 0, rr = 0;
      let revL = 0, revR = 0, dlyL = 0, dlyR = 0;
      for (let s = this.live.length - 1; s >= 0; s--) {
        const slot = this.live[s];
        // Each voice renders its OWN post-pan stereo pair (native stereo image
        // preserved; pan applied in the renderer). No pan here.
        const { l: vl, r: vr } = slot.r.renderStereoInto(t);
        l += vl;
        rr += vr;
        // Per-pad reverb/delay sends stay on SEPARATE buses (sampler only).
        if (slot.sampler && slot.r instanceof SamplerRenderer) {
          revL += slot.r.sendRevL(); revR += slot.r.sendRevR();
          dlyL += slot.r.sendDlyL(); dlyR += slot.r.sendDlyR();
        }
        if (slot.r.done) this.live.splice(s, 1);
      }
      dry[0][i] = l;
      dry[1][i] = rr;
      rev[0][i] = revL; rev[1][i] = revR;
      dly[0][i] = dlyL; dly[1][i] = dlyR;
      this.frame++;
    }
    return true;
  }
}

registerProcessor('sampler-processor', SamplerProcessor);
