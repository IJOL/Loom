// src/export/offline-recorder.ts
// Offline backend: rebuild the master graph + the sounding lanes against an
// OfflineAudioContext, apply each lane's sound state + inserts, preload samples,
// collect every note, render the melodic lanes through the PURE audio-dsp kernel
// (the worklet can't run under node-web-audio-api), play each lane's buffer
// through its ChannelStrip/inserts/master, then render the graph.
// Implements the Phase 1 SceneRecorder so orchestrator/encoder/download reuse.
//
// SCOPE NOTE (Phase 4 cutover): only the melodic worklet engines (subtractive/
// tb303/fm/karplus/wavetable/westcoast) have a per-sample kernel renderer wired
// into this offline path. Drums (8-output kernel), Sampler, and the Audio
// channel are NOT yet kernel-rendered offline — their notes/clips are skipped
// here, so an offline export of a drum/sampler/audio scene is silent for those
// lanes. No existing offline DSP test covers those engine types; wiring the
// DrumVoiceManager + sample bank into the offline path is a follow-up.

import type { RenderedAudio, SceneRecorder } from './types';
import type { SessionState, SessionClip } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';
import type { TimeSignature } from '../core/meter';
import { buildAudioGraph } from '../app/audio-graph';
import { createLaneAllocator } from '../app/lane-allocator';
import { WorkletLaneEngine } from '../engines/worklet-lane-engine';
import { renderKernelLane, type KernelNote, type KernelLaneSpec } from './kernel-lane-render';
import { applyLaneEngineState } from './apply-lane-engine-state';
import { applyPresetToEngine } from '../presets/preset-apply';
import { preloadSceneSamples } from './preload-scene-samples';
import { collectSceneTriggers, type SoundingLaneClip, type OfflineTrigger } from './collect-scene-triggers';
import { collectSceneAutomation, type OfflineAutomationPoint } from './collect-scene-automation';
import { loadNoteFxForLane } from '../notefx/notefx-registry';
import { fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { fetchInstrumentManifest, loadInstrument } from '../samples/instrument-loader';
import { mirrorKeymapChange } from '../session/session-engine-state';
import { rehydrateInsertChain } from '../session/insert-slot';
import { velNorm, resolveVelocity } from '../core/velocity-gain';
import type { KeymapEntry } from '../samples/types';

export interface OfflineRecorderDeps {
  state: SessionState;
  laneStates: Map<string, LanePlayState>;
  bpm: number;
  meter: TimeSignature;
  sampleRate?: number; // default 48000
}

export class OfflineSceneRecorder implements SceneRecorder {
  constructor(private deps: OfflineRecorderDeps) {}

  async record(totalSec: number): Promise<RenderedAudio> {
    const { state, laneStates, bpm, meter } = this.deps;
    const sampleRate = this.deps.sampleRate ?? 48000;

    // Sounding lanes = lanes whose lp.playing is set, with that clip.
    const sounding: { laneId: string; engineId: string; clip: SessionClip }[] = [];
    for (const lane of state.lanes) {
      const lp = laneStates.get(lane.id);
      if (lp?.playing) sounding.push({ laneId: lane.id, engineId: lane.engineId, clip: lp.playing });
    }

    const frames = Math.max(1, Math.ceil(totalSec * sampleRate));
    const offlineCtx = new OfflineAudioContext(2, frames, sampleRate);

    // Parallel master graph + lane allocator against the offline ctx.
    const graph = buildAudioGraph(offlineCtx as unknown as AudioContext);
    const lanes = createLaneAllocator({
      ctx: offlineCtx as unknown as AudioContext,
      master: graph.master,
      fx: graph.fx,
      sidechainBus: graph.sidechainBus,
      getBpm: () => bpm,
      extraIds: [],
      // Phase 4 cutover: the legacy node-per-note engines are gone, so offline
      // render drives the same pure audio-dsp kernel the worklet uses (see the
      // kernel-render pass below). The allocator still builds the worklet lane
      // engines (so setBaseValue/applyPreset/getParamBag work to assemble the
      // ParamBag), and the master graph + per-lane ChannelStrip/inserts give the
      // full mix path; only the per-sample synthesis is done by the kernel,
      // because node-web-audio-api can't host our AudioWorklet.
    });

    // Allocate + configure each sounding lane (await drumkit reloads + inserts).
    for (const { laneId, engineId } of sounding) {
      lanes.ensureLaneResource(laneId, engineId);
      const engine = lanes.getLaneEngineInstance(laneId);
      if (!engine) continue;
      const lane = state.lanes.find((l) => l.id === laneId)!;
      // Apply the lane's factory/engine preset FIRST (sets osc/filter/ADSR/kit),
      // then let applyLaneEngineState's params override it — the same order as the
      // live host (main.ts applyPresetToEngine on load). Without this every lane
      // rendered with the engine DEFAULT sound, so an offline take sounded nothing
      // like the live scene.
      if (lane.enginePresetName) applyPresetToEngine(engine, lane.enginePresetName);
      await applyLaneEngineState(engine as never, lane, offlineCtx as unknown as AudioContext, {
        loadNoteFx: (id, st) => loadNoteFxForLane(id, st),
        reloadDrumkit: async (id, kitId, eng: { setKeymap(k: KeymapEntry[]): void }) => {
          const manifest = await fetchDrumkitManifest(kitId);
          const km = await loadDrumkit(manifest, offlineCtx as unknown as AudioContext);
          eng.setKeymap(km);
          mirrorKeymapChange(state, id, km);
        },
        // Bundled melodic instrument: decode into fresh sampleIds + mirror the
        // resolved keymap (offline parity with the drumkit branch). Loop-family
        // instruments materialize a note clip/scene at import time and persist as
        // ordinary clips, so they need no reload here.
        reloadInstrument: async (id, instrumentId, eng: { setKeymap(k: KeymapEntry[]): void }) => {
          const manifest = await fetchInstrumentManifest(instrumentId);
          if (manifest.family !== 'melodic') return;
          const { keymap } = await loadInstrument(manifest, offlineCtx as unknown as AudioContext);
          eng.setKeymap(keymap);
          mirrorKeymapChange(state, id, keymap);
        },
      });
      // Per-lane insert plugin slots → full parity with the live mix.
      const res = lanes.resources.get(laneId);
      if (res?.inserts && lane.inserts && lane.inserts.length > 0) {
        rehydrateInsertChain(offlineCtx as unknown as AudioContext, res.inserts, lane.inserts);
      }
    }

    // Master insert plugin slots.
    if (state.masterInserts && state.masterInserts.length > 0) {
      rehydrateInsertChain(offlineCtx as unknown as AudioContext, graph.masterInsertChain, state.masterInserts);
    }

    // Preload one-shot / clip sample buffers for the sounding lanes.
    await preloadSceneSamples(
      offlineCtx as unknown as AudioContext,
      state.lanes.filter((l) => sounding.some((s) => s.laneId === l.id)),
    );

    // Collect every note + automation point across the window.
    const laneClips: SoundingLaneClip[] = sounding.map(
      (s) => ({ laneId: s.laneId, engineId: s.engineId, clip: s.clip }),
    );
    const triggers = collectSceneTriggers(laneClips, bpm, meter, totalSec);
    const autos = collectSceneAutomation(laneClips, bpm, totalSec);

    // Walk the merged auto/trig stream in time order, applying automation to the
    // worklet lane engine (setBaseValue mutates its dot-id ParamBag) and, at each
    // trigger, snapshotting that lane's CURRENT ParamBag for the spawned kernel
    // voice — exactly the live host's per-note capture (a voice reads its base
    // values at creation; automation only affects FUTURE voices).
    type MergedEv =
      | { time: number; kind: 'auto'; auto: OfflineAutomationPoint }
      | { time: number; kind: 'trig'; trig: OfflineTrigger };
    const merged: MergedEv[] = [
      ...autos.map((a): MergedEv => ({ time: a.time, kind: 'auto', auto: a })),
      ...triggers.map((t): MergedEv => ({ time: t.time, kind: 'trig', trig: t })),
    ];
    // Sort by time; at equal time automation runs first so the trigger sees it.
    merged.sort((x, y) => x.time - y.time || (x.kind === y.kind ? 0 : x.kind === 'auto' ? -1 : 1));

    const kernelNotesByLane = new Map<string, KernelNote[]>();
    for (const ev of merged) {
      if (ev.kind === 'auto') {
        const engine = lanes.getLaneEngineInstance(ev.auto.laneId);
        if (!engine) continue;
        const spec = engine.params.find((p) => p.id === ev.auto.paramId);
        const min = spec?.min ?? 0;
        const max = spec?.max ?? 1;
        engine.setBaseValue(ev.auto.paramId, min + ev.auto.normalised * (max - min));
      } else {
        const t = ev.trig;
        // Audio-clip samples are not synthesised by the melodic kernel; skip them
        // here (drums/sampler/audio offline render is a follow-up — see record()
        // doc note). Only worklet melodic lanes are kernel-rendered.
        if (t.sample) continue;
        const engine = lanes.getLaneEngineInstance(t.laneId);
        if (!(engine instanceof WorkletLaneEngine)) continue;
        let list = kernelNotesByLane.get(t.laneId);
        if (!list) { list = []; kernelNotesByLane.set(t.laneId, list); }
        list.push({
          note: {
            midi: t.midi, beginSec: t.time, durationSec: t.gateSec,
            // The kernel renderer's NoteSpec.velocity is normalised 0..1, exactly
            // like the live WorkletVoice (velNorm(resolveVelocity(...))).
            velocity: velNorm(resolveVelocity(t.velocity, t.accent)),
            accent: t.accent, slide: t.slidingIn,
          },
          params: engine.getParamBag(),
        });
      }
    }

    // Kernel-render each melodic lane and play its mono buffer through the lane's
    // insert chain → ChannelStrip → master (full mix path preserved).
    const sr = offlineCtx.sampleRate;
    for (const [laneId, notes] of kernelNotesByLane) {
      const engine = lanes.getLaneEngineInstance(laneId);
      if (!(engine instanceof WorkletLaneEngine)) continue;
      const res = lanes.resources.get(laneId);
      if (!res) continue;
      const spec: KernelLaneSpec = {
        engineId: engine.id,
        params: engine.getParamBag(),
        maxVoices: engine.getMaxVoices(),
        mods: engine.getModLite(),
        notes,
      };
      const mono = renderKernelLane(spec, frames, sr);
      const buf = offlineCtx.createBuffer(1, frames, sr);
      buf.getChannelData(0).set(mono);
      const srcNode = offlineCtx.createBufferSource();
      srcNode.buffer = buf;
      srcNode.connect(res.inserts.inputNode);
      srcNode.start(0);
    }

    // Render → RenderedAudio.
    const buffer = await offlineCtx.startRendering();
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(buffer.getChannelData(ch).slice(0));
    }
    return { channels, sampleRate: buffer.sampleRate };
  }
}
