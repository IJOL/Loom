// src/export/offline-recorder.ts
// Offline backend: rebuild the master graph + the sounding lanes against an
// OfflineAudioContext, apply each lane's sound state + inserts, preload samples,
// batch-schedule every note (reusing the live trigger path), then render.
// Implements the Phase 1 SceneRecorder so orchestrator/encoder/download reuse.

import type { RenderedAudio, SceneRecorder } from './types';
import type { SessionState, SessionClip } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';
import type { TimeSignature } from '../core/meter';
import { buildAudioGraph } from '../app/audio-graph';
import { createLaneAllocator } from '../app/lane-allocator';
import { createTriggerForLane } from '../app/trigger-dispatch';
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
      // Offline export batch-renders through OfflineAudioContext, so the
      // real-time dropout problem the worklet solves does not apply here, and
      // worklet message delivery during startRendering is unreliable. Keep
      // subtractive on the proven legacy node-per-note engine. (Phase 4 cutover
      // will revisit once the legacy engine is removed.)
      subtractiveBackend: 'legacy',
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

    // Batch-schedule every note through the reused trigger path.
    const trigger = createTriggerForLane({
      ctx: offlineCtx as unknown as AudioContext,
      laneResources: lanes.resources,
      seq: { bpm } as never,
    });
    const laneClips: SoundingLaneClip[] = sounding.map(
      (s) => ({ laneId: s.laneId, engineId: s.engineId, clip: s.clip }),
    );
    // Clip automation is applied per-trigger: a setBaseValue BEFORE the triggers
    // at the same time, so each new voice captures the automated base value — the
    // same audible result as the live host (a voice reads filter.cutoff etc. at
    // creation; the live rAF only updates the base for FUTURE voices).
    const triggers = collectSceneTriggers(laneClips, bpm, meter, totalSec);
    const autos = collectSceneAutomation(laneClips, bpm, totalSec);
    type MergedEv =
      | { time: number; kind: 'auto'; auto: OfflineAutomationPoint }
      | { time: number; kind: 'trig'; trig: OfflineTrigger };
    const merged: MergedEv[] = [
      ...autos.map((a): MergedEv => ({ time: a.time, kind: 'auto', auto: a })),
      ...triggers.map((t): MergedEv => ({ time: t.time, kind: 'trig', trig: t })),
    ];
    // Sort by time; at equal time automation runs first so the trigger sees it.
    merged.sort((x, y) => x.time - y.time || (x.kind === y.kind ? 0 : x.kind === 'auto' ? -1 : 1));
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
        trigger(t.laneId, t.midi, t.time, t.gateSec, t.accent, t.slidingIn, t.sample);
      }
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
