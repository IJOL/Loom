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
import { ModulationRuntime } from '../audio-dsp/modulation-runtime';
import type { MainToWorklet, WorkletToMain } from '../audio-dsp/messages';
import type { NoteSpec } from '../audio-dsp/types';
import { LOOM_PROCESSOR_NAME } from './processor-name';
// Side-effect imports: each renderer self-registers into the renderer-registry
// so VoiceManager.createRenderer(engineId, …) can build any engine's voice.
import '../audio-dsp/subtractive-renderer';
import '../audio-dsp/tb303-renderer';
import '../audio-dsp/fm-renderer';
import '../audio-dsp/karplus-renderer';
import '../audio-dsp/wavetable-renderer';
import '../audio-dsp/westcoast-renderer';

class LoomProcessor extends AudioWorkletProcessor {
  private vm: VoiceManager;
  private mod = new ModulationRuntime(sampleRate);
  private queue = new SchedulerQueue<NoteSpec>();
  private frame = Math.floor(currentTime * sampleRate);
  private reportCountdown = 0;
  // True when the last modulation report carried offsets — lets us post ONE empty
  // snapshot when modulation stops, so the UI knob rings clear instead of freezing.
  private lastModNonEmpty = false;
  // Set by a `kill` message (lane disposed / re-imported). Once true, process()
  // returns false so the audio engine stops scheduling this processor and reclaims
  // it — otherwise the always-true return below keeps it (and its CPU cost) alive.
  private dead = false;

  constructor(options?: unknown) {
    super(options);
    const engineId = (options as { processorOptions?: { engineId?: string } } | undefined)
      ?.processorOptions?.engineId ?? 'subtractive';
    // Start with an empty param bag — each renderer fills its own defaults via
    // param(); the lane engine posts the real values immediately after.
    this.vm = new VoiceManager(sampleRate, engineId, {});
    this.vm.setModulation(this.mod);
    this.port.onmessage = (e: MessageEvent<MainToWorklet>) => {
      const m = e.data;
      switch (m.type) {
        case 'spawn':  this.queue.push(Math.floor(m.note.beginSec * sampleRate), m.note); break;
        case 'params': this.vm.setParams(m.params); break;
        case 'config': this.vm.setMaxVoices(m.maxVoices); break;
        case 'steal':  this.vm.steal(m.count); break;
        case 'mods':   this.mod.setMods(m.mods); break;
        case 'kill':   this.dead = true; break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // Disposed: report zero voices once (so the global voice cap drops this lane's
    // residual count) then return false so the engine reclaims this processor.
    if (this.dead) {
      this.port.postMessage({ type: 'voices', active: 0 } satisfies WorkletToMain);
      return false;
    }
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      this.queue.drainDue(this.frame, (note) => this.vm.spawn(note));
      const s = this.vm.renderSample(this.frame / sampleRate);
      for (let c = 0; c < out.length; c++) out[c][i] = s;
      this.frame++;
    }
    if ((this.reportCountdown -= out[0].length) <= 0) {
      this.reportCountdown = sampleRate / 30; // ~30 Hz report
      this.port.postMessage({ type: 'voices', active: this.vm.activeCount } satisfies WorkletToMain);
      // Live modulation telemetry for the UI knob rings — the REAL per-param
      // offset, summed over every source. Posted while something modulates, plus
      // one empty snapshot on the falling edge so the rings clear (no Object.keys
      // alloc on the audio thread: probe emptiness with a for-in/break).
      // Feed the SAME phase origin the audio uses (most-recent note), so a
      // note-triggered or per-voice LFO's ring reflects the retrigger instead of
      // free-running. Without this the telemetry defaulted to {0,0} and the graph
      // ignored TRIG/SCOPE entirely.
      const offsets = this.mod.activeOffsets(this.frame / sampleRate, this.vm.currentPhaseOrigin());
      // Add the most-recent voice's per-voice ADSR offsets on top of the shared LFO
      // ones, so a knob driven by an ADSR shows its ring (following the last note).
      const adsr = this.vm.lastVoiceAdsrOffsets();
      if (adsr) for (const k in adsr) { if (adsr[k]) offsets[k] = (offsets[k] ?? 0) + adsr[k]; }
      let has = false;
      for (const _k in offsets) { has = true; break; }
      if (has || this.lastModNonEmpty) {
        this.port.postMessage({ type: 'modValues', offsets } satisfies WorkletToMain);
      }
      this.lastModNonEmpty = has;
    }
    return true;
  }
}

registerProcessor(LOOM_PROCESSOR_NAME, LoomProcessor);
