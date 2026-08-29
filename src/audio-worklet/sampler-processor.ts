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
import type { SampleSpawn, LivePadParams } from '../audio-dsp/sample/types';
import { ParamSmoother } from '../audio-dsp/param-smoother';
import { stealForCap } from '../audio-dsp/sample/voice-cap';
import type { ParamBag } from '../audio-dsp/types';
import { chokesVoice } from '../engines/sampler-choke';

type SamplerMsg =
  | { type: 'loadSample'; sampleId: string; channels: Float32Array[]; sampleRate: number }
  | { type: 'spawn'; kind: 'sampler' | 'audio'; spawn: SampleSpawn }
  // Live per-pad knob values. Unlike `spawn` (which freezes the trigger), this
  // updates the pad table the SOUNDING voices read, so a knob turn is audible on
  // a note already playing.
  | { type: 'padParams'; padNote: number; params: LivePadParams }
  // Voice budget (poly.voices) — see sampler-node.ts, the canonical protocol.
  | { type: 'config'; maxVoices: number }
  // `atSec` (audio-clock seconds): when present and still in the future, the
  // currently-live voices are note-off'd AT that frame instead of immediately —
  // the gapless scene-switch path (cut the outgoing clip exactly when the
  // incoming one starts). Absent / already-past ⇒ immediate (transport Stop, seek).
  | { type: 'silence'; atSec?: number }
  | { type: 'kill' };

interface Slot {
  r: SamplerRenderer | AudioClipRenderer;
  sampler: boolean;   // true ⇒ SamplerRenderer (has per-pad FX sends); false ⇒ AudioClipRenderer
  chokeGroup: number; // 0 = none; a new hit cuts ringing voices sharing its group (sampler only)
  padNote: number;    // pad identity for the mono self-cut; -1 = audio clip (never choked)
  stolen?: boolean;   // already fading out for the voice cap — don't steal twice
}

class SamplerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }
  private bank = new SampleBank();
  private queue = new SchedulerQueue<{ kind: 'sampler' | 'audio'; spawn: SampleSpawn }>();
  private scheduledOffs = new ScheduledNoteOffs<SamplerRenderer | AudioClipRenderer>();
  /** padNote → its live knob smoother. `.values` is the object voices hold a
   *  reference to and read every sample (mutated in place); `level`/`pan` are
   *  pure amplitude scalars, so an unslewed jump there is a zipper (~16 ms knob
   *  messages) or a click (a fast flick) — the same reason the six melodic
   *  engines ramp. Created lazily: a pad nothing has touched costs nothing. */
  private padSmoothers = new Map<number, ParamSmoother>();
  /** Smoothers currently ramping — the ONLY ones ticked each sample. Swap-and-pop
   *  (never spliced), so a lane at rest (nothing moving) costs one length check
   *  per sample and the render path allocates nothing. */
  private movingPads: ParamSmoother[] = [];
  private live: Slot[] = [];
  /** Voice budget (poly.voices). This processor pools its own voices, so the
   *  melodic VoiceManager cap never applied here — a looping clip or a long pad
   *  at 16ths accumulated without limit, and the per-sample cost scaled with the
   *  leak. Overflow steals the OLDEST voices through their own click-free fades
   *  (SamplerRenderer.choke = 6 ms; AudioClipRenderer.noteOff = ~5 ms), the same
   *  "never drop a voice instantly" rule the melodic steal ramp enforces. */
  private maxVoices = Number.POSITIVE_INFINITY;
  private frame = Math.floor(currentTime * sampleRate);
  // Set by `kill` (lane disposed): process() then returns false so the audio engine
  // reclaims this processor instead of running it forever (see loom-processor.ts).
  private dead = false;
  // Bound once: an inline arrow in the per-sample loop would allocate a fresh
  // closure every sample even with an empty queue — GC pressure on the audio
  // thread (same fix as loom-processor's spawnNote). `this.frame` is current at
  // drain time, so the spawn time derives from it here rather than capturing `t`.
  private readonly spawnVoice = ({ kind, spawn }: { kind: 'sampler' | 'audio'; spawn: SampleSpawn }): void => {
    const t = this.frame / sampleRate;
    const r = kind === 'audio'
      ? new AudioClipRenderer(spawn, this.bank, sampleRate)
      : new SamplerRenderer(spawn, this.bank, sampleRate);
    const chokeGroup = kind === 'sampler' ? (spawn.chokeGroup ?? 0) : 0;
    const padNote = kind === 'sampler' ? (spawn.padNote ?? -1) : -1;
    // Choke BEFORE pushing the new voice (so it never chokes itself): fast-fade
    // every still-ringing voice this hit cuts (shared group, or mono self-cut).
    if (kind === 'sampler' && (chokeGroup > 0 || (spawn.retrig ?? 0) >= 1)) {
      const trig = { chokeGroup, padNote, retrig: spawn.retrig ?? 0 };
      for (const slot of this.live) {
        if (slot.r instanceof SamplerRenderer && chokesVoice(trig, slot)) slot.r.choke(t);
      }
    }
    if (kind === 'sampler' && padNote >= 0) {
      let sm = this.padSmoothers.get(padNote);
      if (!sm) {
        // First hit of this pad before any knob moved: seed the table from the
        // spawn so the voice and the table agree, landing instantly (nothing
        // is sounding yet for this pad — a ramp from silence would be wrong).
        sm = new ParamSmoother(sampleRate);
        sm.reset({
          cutoff: spawn.cutoff, res: spawn.res, level: spawn.level,
          pan: spawn.pan, rev: spawn.rev, dly: spawn.dly,
        });
        this.padSmoothers.set(padNote, sm);
      }
      // The smoother's `values` always carries exactly the 6 LivePadParams
      // fields — every seed/patch above is a complete set (see setBaseValue /
      // setPadStore in sampler-worklet-engine.ts).
      (r as SamplerRenderer).setLivePad(sm.values as unknown as LivePadParams);
    }
    // Voice cap: steal the oldest not-yet-stolen voices before admitting this
    // one (policy + rationale in voice-cap.ts, where a unit test pins it).
    stealForCap(this.live, this.maxVoices, (slot) => {
      if (slot.sampler) (slot.r as SamplerRenderer).choke(t); else slot.r.noteOff(t);
    });
    this.live.push({ r, sampler: kind === 'sampler', chokeGroup, padNote });
  };

  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (e: MessageEvent<SamplerMsg>) => {
      const m = e.data;
      if (m.type === 'kill') {
        this.dead = true;
      } else if (m.type === 'loadSample') {
        this.bank.set(m.sampleId, { channels: m.channels, sampleRate: m.sampleRate });
      } else if (m.type === 'spawn') {
        this.queue.push(Math.floor(m.spawn.beginSec * sampleRate), { kind: m.kind, spawn: m.spawn });
      } else if (m.type === 'config') {
        this.maxVoices = Math.max(1, Math.floor(m.maxVoices));
      } else if (m.type === 'padParams') {
        let sm = this.padSmoothers.get(m.padNote);
        if (!sm) {
          // First-ever value for this pad and no voice has spawned it yet (a
          // knob touched before the pad's first hit): nothing is sounding, so
          // land instantly — mirrors ParamSmoother.reset's boot/construction case.
          sm = new ParamSmoother(sampleRate);
          sm.reset(m.params as unknown as ParamBag);
          this.padSmoothers.set(m.padNote, sm);
        } else {
          sm.setTargets(m.params as unknown as ParamBag);
          if (sm.moving && this.movingPads.indexOf(sm) < 0) this.movingPads.push(sm);
        }
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
    if (this.dead) return false;   // disposed → let the engine reclaim this processor
    const dry = outputs[0];
    const rev = outputs[1];   // reverb send (Send B)
    const dly = outputs[2];   // delay send (Send A)
    const n = dry[0].length;
    for (let i = 0; i < n; i++) {
      const t = this.frame / sampleRate;
      // Advance every pad smoother still ramping (a knob turn in flight). At rest
      // this is one length check — the render path pays exactly what it paid
      // before I2 (2026-07-26 continuous-params review).
      for (let p = this.movingPads.length - 1; p >= 0; p--) {
        const sm = this.movingPads[p];
        sm.tick();
        if (!sm.moving) {
          this.movingPads[p] = this.movingPads[this.movingPads.length - 1];
          this.movingPads.pop();
        }
      }
      // Fire any scheduled note-offs due at this frame (gapless scene switch): the
      // outgoing voices fade exactly at T, the same frame the incoming clip spawns.
      this.scheduledOffs.drainDue(this.frame, sampleRate);
      // Spawn any voices due at this exact frame (sample-accurate start).
      this.queue.drainDue(this.frame, this.spawnVoice);
      let l = 0, rr = 0;
      let revL = 0, revR = 0, dlyL = 0, dlyR = 0;
      for (let s = this.live.length - 1; s >= 0; s--) {
        const slot = this.live[s];
        // Each voice renders its OWN post-pan stereo pair (native stereo image
        // preserved; pan applied in the renderer). No pan here. Read outL/outR
        // fields — a `{l, r}` return here allocated an object per voice per sample.
        slot.r.renderStereoInto(t);
        l += slot.r.outL;
        rr += slot.r.outR;
        // Per-pad reverb/delay sends stay on SEPARATE buses (sampler only). The
        // `slot.sampler` flag is authoritative — the cast avoids an instanceof
        // prototype walk per voice per sample.
        if (slot.sampler) {
          const sv = slot.r as SamplerRenderer;
          revL += sv.sendRevL(); revR += sv.sendRevR();
          dlyL += sv.sendDlyL(); dlyR += sv.sendDlyR();
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
