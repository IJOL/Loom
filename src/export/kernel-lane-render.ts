// src/export/kernel-lane-render.ts
// Offline melodic synthesis through the PURE audio-dsp kernel.
//
// After the Phase 4 cutover the legacy node-per-note engines are gone, so the
// offline scene recorder can no longer batch-render melodic lanes by calling
// engine.createVoice into an OfflineAudioContext. The live path runs the
// AudioWorklet, but node-web-audio-api can't host our worklet (test/setup stubs
// it silent), so offline render drives the same per-sample VoiceManager the
// worklet uses, summing each lane's mono output into a Float32Array. The caller
// then plays that buffer through the lane's ChannelStrip/inserts/master so the
// full Web Audio mix path is preserved.
//
// Pure: no Web Audio. One VoiceManager per lane, a frame-accurate scheduler that
// spawns each note at its begin frame, and (optionally) per-note ParamBag
// snapshots so clip automation is captured exactly as the live host does (a new
// voice reads the automated base value at creation).

import type { NoteSpec, ParamBag } from '../audio-dsp/types';
import type { ModLite } from '../audio-dsp/modulation-runtime';
import { ModulationRuntime } from '../audio-dsp/modulation-runtime';
import { VoiceManager } from '../audio-dsp/voice-manager';
// Side-effect imports: each melodic renderer self-registers into the renderer
// registry. The worklet thread imports these via loom-processor.ts; the offline
// recorder runs on the MAIN thread, so import them here so createRenderer finds
// them when the kernel render runs.
import '../audio-dsp/subtractive-renderer';
import '../audio-dsp/tb303-renderer';
import '../audio-dsp/fm-renderer';
import '../audio-dsp/karplus-renderer';
import '../audio-dsp/wavetable-renderer';
import '../audio-dsp/westcoast-renderer';

/** One scheduled kernel note for a lane. `params` (when present) is the lane's
 *  ParamBag snapshot AT THIS NOTE'S TRIGGER TIME — applied to the VoiceManager
 *  just before the spawn so automation is captured per-note, matching the live
 *  host (params are read at voice creation). */
export interface KernelNote {
  note: NoteSpec;
  params?: ParamBag;
}

export interface KernelLaneSpec {
  engineId: string;
  /** Initial param state (dot-id ParamBag) for the lane. */
  params: ParamBag;
  maxVoices: number;
  /** Shared-LFO modulation set (in-worklet modulation), or [] for none. */
  mods: ModLite[];
  notes: KernelNote[];
}

/** Render one melodic lane's notes into a mono Float32Array of `frames` samples.
 *  Pure: a frame loop over a per-lane VoiceManager. Spawns happen at the note's
 *  begin frame; per-note ParamBag snapshots are applied just before the spawn. */
export function renderKernelLane(
  spec: KernelLaneSpec,
  frames: number,
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(frames);
  const vm = new VoiceManager(sampleRate, spec.engineId, spec.params);
  vm.setMaxVoices(spec.maxVoices);
  if (spec.mods.length > 0) {
    const runtime = new ModulationRuntime(sampleRate);
    runtime.setMods(spec.mods);
    vm.setModulation(runtime);
  }

  // Sort notes by begin time, then walk frames and spawn each as its frame
  // arrives. The VoiceManager itself reaps done voices.
  const pending = [...spec.notes].sort((a, b) => a.note.beginSec - b.note.beginSec);
  let next = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    while (next < pending.length && pending[next].note.beginSec <= t) {
      const kn = pending[next++];
      // Per-note automation: snapshot the lane params at this note's time so the
      // freshly-spawned voice reads the automated values (live host parity).
      if (kn.params) vm.setParams(kn.params);
      vm.spawn(kn.note);
    }
    out[i] = vm.renderSample(t);
  }
  return out;
}
