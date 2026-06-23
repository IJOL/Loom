// Real AudioWorklet processor for the synth-mode drum machine: a SchedulerQueue
// of hits feeding a DrumVoiceManager that renders 8 mono outputs (one per
// DrumVoice). Bundled by Vite via the ?worker&url import in drums-node.ts so that
// normal TypeScript imports resolve inside the worklet bundle.
//
// CRITICAL: do NOT import drums-node.ts here — drums-node imports this file's
// bundled URL; a reverse import would create a circular bundle dependency. The
// registered name is the plain string literal "drums-processor", shared with the
// node only as that literal (no symbol import either direction).
/// <reference path="./worklet-globals.d.ts" />
import { DrumVoiceManager } from '../audio-dsp/drums/drum-voice-manager';
import { SchedulerQueue } from '../audio-dsp/scheduler-queue';
import { DRUM_VOICE_IDS, type DrumHit, type DrumVoiceId } from '../audio-dsp/drums/types';
import type { ParamBag } from '../audio-dsp/types';

type DrumsMsg =
  | { type: 'hit'; voice: DrumVoiceId; beginSec: number; velocity: number }
  | { type: 'voiceParams'; voice: DrumVoiceId; params: ParamBag };

class DrumsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }
  private vm = new DrumVoiceManager(sampleRate);
  private queue = new SchedulerQueue<DrumHit>();
  private frame = Math.floor(currentTime * sampleRate);

  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (e: MessageEvent<DrumsMsg>) => {
      const m = e.data;
      if (m.type === 'hit') {
        this.queue.push(Math.floor(m.beginSec * sampleRate), {
          voice: m.voice, beginSec: m.beginSec, velocity: m.velocity,
        });
      } else if (m.type === 'voiceParams') {
        this.vm.setVoiceParams(m.voice, m.params);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // numberOfOutputs = 8; outputs[v][0] is voice v's mono buffer for this block.
    const n = outputs[0][0].length;
    // Fire every hit due within this block (block granularity — sub-sample drum
    // timing is inaudible). The manager renders each live voice into its output.
    this.queue.drainDue(this.frame + n - 1, (hit) => this.vm.spawn(hit));
    const mono = DRUM_VOICE_IDS.map((_, v) => outputs[v][0]);
    this.vm.renderInto(mono, this.frame);
    this.frame += n;
    return true;
  }
}

registerProcessor('drums-processor', DrumsProcessor);
