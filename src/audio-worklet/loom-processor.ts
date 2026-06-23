// Real AudioWorklet processor: SchedulerQueue + VoiceManager, one sample at a time.
// Bundled by Vite via the ?worker&url import in loom-node.ts so that normal
// TypeScript imports resolve inside the worklet bundle.
//
// CRITICAL: do NOT import loom-node.ts here — loom-node imports this file's
// bundled URL; a reverse import would create a circular bundle dependency.
// Shared constants (defaultSubParams) live in ../audio-dsp/default-params instead.
/// <reference path="./worklet-globals.d.ts" />
import { VoiceManager } from '../audio-dsp/voice-manager';
import { SchedulerQueue } from '../audio-dsp/scheduler-queue';
import type { MainToWorklet, WorkletToMain } from '../audio-dsp/messages';
import type { NoteSpec, SubParams } from '../audio-dsp/types';
import { defaultSubParams } from '../audio-dsp/default-params';

export const LOOM_PROCESSOR_NAME = 'loom-processor';

class LoomProcessor extends AudioWorkletProcessor {
  private vm = new VoiceManager(sampleRate, defaultSubParams());
  private queue = new SchedulerQueue<NoteSpec>();
  private frame = Math.floor(currentTime * sampleRate);
  private reportCountdown = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MainToWorklet>) => {
      const m = e.data;
      switch (m.type) {
        case 'spawn':  this.queue.push(Math.floor(m.note.beginSec * sampleRate), m.note); break;
        case 'params': this.vm.setParams(m.params as Partial<SubParams>); break;
        case 'config': this.vm.setMaxVoices(m.maxVoices); break;
        case 'steal':  this.vm.steal(m.count); break;
        case 'mods':   /* wired in Task 10 */ break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      this.queue.drainDue(this.frame, (note) => this.vm.spawn(note));
      const s = this.vm.renderSample(this.frame / sampleRate);
      for (let c = 0; c < out.length; c++) out[c][i] = s;
      this.frame++;
    }
    if ((this.reportCountdown -= out[0].length) <= 0) {
      this.reportCountdown = sampleRate / 30; // ~30 Hz voice-count report
      const msg: WorkletToMain = { type: 'voices', active: this.vm.activeCount };
      this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor(LOOM_PROCESSOR_NAME, LoomProcessor);
