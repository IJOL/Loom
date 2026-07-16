// src/export/offline-recorder.ts
// Offline backend: rebuild the master graph + the sounding lanes against an
// OfflineAudioContext, apply each lane's sound state + inserts, preload samples,
// collect every note, render the melodic lanes through the PURE audio-dsp kernel
// (the worklet can't run under node-web-audio-api), play each lane's buffer
// through its ChannelStrip/inserts/master, then render the graph.
// Implements the Phase 1 SceneRecorder so orchestrator/encoder/download reuse.
//
// SCOPE NOTE (Phase 4 cutover): every sounding lane is now rendered offline.
// Melodic worklet engines (subtractive/tb303/fm/karplus/wavetable/westcoast) go
// through the per-sample melodic kernel (kernel-lane-render). Drums (synth mode),
// the Sampler, and the Audio channel are rendered through the SAME pure drum/
// sample renderers the worklet uses (sample-lane-render), so a drum/sampler/audio
// scene is NO LONGER silent on an offline export. Per-pad FX sends and per-voice
// drum strip sends/EQ are dropped offline (no FxBus in the kernel), and SAMPLE-
// MODE drum kits (the embedded Sampler) render their hits through the sampler
// resolve path. Both are approximations of the live per-voice mix, not silence.

import type { RenderedAudio, SceneRecorder } from './types';
import type { SessionState, SessionClip } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';
import type { TimeSignature } from '../core/meter';
import { buildAudioGraph } from '../app/audio-graph';
import { createLaneAllocator } from '../app/lane-allocator';
import { WorkletLaneEngine } from '../engines/worklet-lane-engine';
import { DrumsWorkletEngine } from '../engines/drums-worklet-engine';
import { SamplerWorkletEngine } from '../engines/sampler-worklet-engine';
import { AudioWorkletEngine } from '../engines/audio-worklet-engine';
import { renderKernelLane, type KernelNote, type KernelLaneSpec } from './kernel-lane-render';
import {
  renderDrumLane, renderSampleLane,
  type OfflineDrumHit, type OfflineDrumVoiceMix, type OfflineSampleSpawn, type StereoBuffer,
} from './sample-lane-render';
import { applyLaneEngineState } from './apply-lane-engine-state';
import { applyPresetToEngine } from '../presets/preset-apply';
import { preloadSceneSamples } from './preload-scene-samples';
import { collectSceneTriggers, type SoundingLaneClip, type OfflineTrigger } from './collect-scene-triggers';
import { collectSceneAutomation, type OfflineAutomationPoint } from './collect-scene-automation';
import { loadNoteFxForLane } from '../notefx/notefx-registry';
import { fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { fetchInstrumentManifest, loadInstrument, loadPresetZones } from '../samples/instrument-loader';
import { getCachedPresets } from '../presets/preset-loader';
import { mirrorKeymapChange } from '../session/session-engine-state';
import { rehydrateInsertChain } from '../session/insert-slot';
import { velNorm, resolveVelocity, velGain } from '../core/velocity-gain';
import { GM_DRUM_MAP } from '../engines/drum-gm-map';
import { DRUM_LANES } from '../core/drums';
import { DRUM_VOICE_IDS, type DrumVoiceId } from '../audio-dsp/drums/types';
import { extractChannels, loadSamplerWorklet } from '../audio-worklet/sampler-node';
import { loadLoomWorklet } from '../audio-worklet/loom-node';
import { loadDrumsWorklet } from '../audio-worklet/drums-node';
import type { KeymapEntry } from '../samples/types';
import type { ParamBag } from '../audio-dsp/types';

/** Resolve a sample/audio trigger to an OfflineSampleSpawn (spawn + decoded
 *  channels), via the engine's pure resolveSpawn path. Handles the Sampler, the
 *  Audio channel, and sample-mode drums (the embedded Sampler). Returns null for
 *  any engine that can't resolve a spawn. */
function resolveSampleSpawn(
  engine: import('../engines/engine-types').SynthEngine,
  t: OfflineTrigger,
  ctx: AudioContext,
): OfflineSampleSpawn | null {
  const opts = { gateDuration: t.gateSec, velocity: t.velocity, accent: t.accent, sample: t.sample };
  if (engine instanceof AudioWorkletEngine) {
    const r = engine.resolveSpawn(t.time, opts, ctx);
    return r ? { kind: 'audio', spawn: r.spawn, data: extractChannels(r.buffer) } : null;
  }
  // Sample-mode drums delegate to the embedded SamplerWorkletEngine.
  const sampler = engine instanceof SamplerWorkletEngine
    ? engine
    : engine instanceof DrumsWorkletEngine ? engine.getEmbeddedSampler() : null;
  if (!sampler) return null;
  const r = sampler.resolveSpawn(t.midi, t.time, opts, ctx);
  return r ? { kind: r.kind, spawn: r.spawn, data: extractChannels(r.buffer) } : null;
}

export interface OfflineRecorderDeps {
  state: SessionState;
  laneStates: Map<string, LanePlayState>;
  bpm: number;
  meter: TimeSignature;
  swing?: number;
  sampleRate?: number; // default 48000
}

export class OfflineSceneRecorder implements SceneRecorder {
  constructor(private deps: OfflineRecorderDeps) {}

  async record(totalSec: number): Promise<RenderedAudio> {
    const { state, laneStates, bpm, meter, swing } = this.deps;
    const sampleRate = this.deps.sampleRate ?? 48000;

    // Sounding lanes = lanes whose lp.playing is set, with that clip.
    const sounding: { laneId: string; engineId: string; clip: SessionClip }[] = [];
    for (const lane of state.lanes) {
      const lp = laneStates.get(lane.id);
      if (lp?.playing) sounding.push({ laneId: lane.id, engineId: lane.engineId, clip: lp.playing });
    }

    // SEAMLESS LOOP: render TWO cycles and return the SECOND. A single cycle cut to
    // the exact musical length is NOT a seamless loop — release/decay/reverb tails of
    // notes near the loop end get chopped, and the loop start ramps up with no
    // overlapping tail from the previous cycle, so the WAV jumps when it repeats. The
    // 2nd cycle is steady-state (cycle-1's tails already overlap its start), so it
    // loops seamlessly — at the SAME exact musical length (warp ratio stays 1.0).
    const cycleFrames = Math.max(1, Math.round(totalSec * sampleRate));
    const frames = cycleFrames * 2;
    const offlineCtx = new OfflineAudioContext(2, frames, sampleRate);

    // Register the AudioWorklet processor modules on THIS fresh context BEFORE any
    // engine constructs its AudioWorkletNode. A browser throws
    //   InvalidStateError: … Load a script via audioWorklet.addModule() first.
    // when a node is built against a context whose module was never registered, and
    // offlineCtx is brand-new so the live AudioContext's registration does NOT carry
    // over — skipping this was the offline-export "message that flashes and vanishes"
    // bug. Today only the melodic WorkletLaneEngine builds its node in its ctor
    // (worklet-lane-engine.ts) — the exact node that threw; the Drums/Sampler/Audio
    // engines build theirs lazily on createVoice, which this recorder never calls
    // (it renders through the pure kernels). We register all three anyway: cheap,
    // idempotent (per-ctx cached), and future-proof if the offline path ever grows
    // real worklet nodes. allSettled so one module's failure can't abort the render;
    // we log a rejection because otherwise a genuine load failure masquerades as the
    // very "addModule() first" error above with no trace (mirrors main.ts's live
    // boot). Under node-web-audio-api the TS processor can't load, but test/setup.ts
    // stubs AudioWorkletNode so the ctors succeed regardless.
    const workletLoads = await Promise.allSettled([
      loadLoomWorklet(offlineCtx as unknown as BaseAudioContext),
      loadDrumsWorklet(offlineCtx as unknown as BaseAudioContext),
      loadSamplerWorklet(offlineCtx as unknown as BaseAudioContext),
    ]);
    for (const r of workletLoads) {
      if (r.status === 'rejected') {
        console.error('[offline-export] worklet module load failed; export may fail:', r.reason);
      }
    }

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
        // Normal Sampler preset (presets/sampler.json): decode its zone URLs into
        // fresh sampleIds + mirror the resolved keymap (offline parity).
        reloadPreset: async (id, presetName, eng: { setKeymap(k: KeymapEntry[]): void }) => {
          const preset = getCachedPresets('sampler').find((p) => p.name === presetName);
          if (!preset?.zones) return;
          const km = await loadPresetZones(preset.zones, offlineCtx as unknown as AudioContext);
          eng.setKeymap(km);
          mirrorKeymapChange(state, id, km);
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
    // Window covers BOTH cycles so the clip loops twice (the 2nd cycle is the one
    // we keep). frames === cycleFrames * 2, so windowSec === 2 · totalSec.
    const windowSec = frames / sampleRate;
    const triggers = collectSceneTriggers(laneClips, bpm, meter, windowSec, swing);
    const autos = collectSceneAutomation(laneClips, bpm, windowSec);

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
    const drumHitsByLane = new Map<string, OfflineDrumHit[]>();
    const sampleSpawnsByLane = new Map<string, OfflineSampleSpawn[]>();
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
        const engine = lanes.getLaneEngineInstance(t.laneId);
        if (!engine) continue;

        // Melodic worklet lane → the per-sample melodic kernel.
        if (engine instanceof WorkletLaneEngine) {
          if (t.sample) continue;   // melodic engines never carry an audio clip
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
          continue;
        }

        // Drums lane (synth mode) → DrumVoiceManager. Sample-mode kits fall to the
        // embedded Sampler resolve path below.
        if (engine instanceof DrumsWorkletEngine && engine.getKitMode() === 'synth') {
          const voice = GM_DRUM_MAP[t.midi] as DrumVoiceId | undefined;
          if (!voice || !DRUM_VOICE_IDS.includes(voice)) continue;
          if (engine.getOfflineVoiceMix(voice).muted) continue;
          let hits = drumHitsByLane.get(t.laneId);
          if (!hits) { hits = []; drumHitsByLane.set(t.laneId, hits); }
          // Live loudness: vel = 0.65 · velGain(velocity, accent) — same as DrumsVoice.
          hits.push({ voice, beginSec: t.time, velocity: 0.65 * velGain(t.velocity, t.accent) });
          continue;
        }

        // Sampler / Audio lane (or sample-mode drums) → resolve a SampleSpawn and
        // render it through the pure sample renderers.
        const resolved = resolveSampleSpawn(engine, t, offlineCtx as unknown as AudioContext);
        if (!resolved) continue;
        let spawns = sampleSpawnsByLane.get(t.laneId);
        if (!spawns) { spawns = []; sampleSpawnsByLane.set(t.laneId, spawns); }
        spawns.push(resolved);
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

    // Helper: play a rendered stereo pair through a lane's insert chain.
    const playStereo = (laneId: string, st: StereoBuffer): void => {
      const res = lanes.resources.get(laneId);
      if (!res) return;
      const buf = offlineCtx.createBuffer(2, frames, sr);
      buf.getChannelData(0).set(st.l);
      buf.getChannelData(1).set(st.r);
      const node = offlineCtx.createBufferSource();
      node.buffer = buf;
      node.connect(res.inserts.inputNode);
      node.start(0);
    };

    // Drums lanes (synth mode) → DrumVoiceManager → per-voice level/pan → strip.
    for (const [laneId, hits] of drumHitsByLane) {
      const engine = lanes.getLaneEngineInstance(laneId);
      if (!(engine instanceof DrumsWorkletEngine)) continue;
      const voiceParams: Partial<Record<DrumVoiceId, ParamBag>> = {};
      const voiceMix: Partial<Record<DrumVoiceId, OfflineDrumVoiceMix>> = {};
      for (const v of DRUM_LANES) {
        voiceParams[v] = engine.getOfflineSynthBag(v);
        const mix = engine.getOfflineVoiceMix(v);
        voiceMix[v] = { level: mix.level, pan: mix.pan };
      }
      playStereo(laneId, renderDrumLane(hits, voiceParams, voiceMix, frames, sr));
    }

    // Sampler / Audio lanes (+ sample-mode drum hits) → sample renderers → strip.
    for (const [laneId, spawns] of sampleSpawnsByLane) {
      playStereo(laneId, renderSampleLane(spawns, frames, sr));
    }

    // Render → RenderedAudio. Keep the SECOND cycle [cycleFrames, 2·cycleFrames):
    // cycle 1 starts dry (no previous-cycle tail) and its own tails spill past the
    // boundary into cycle 2; cycle 2 therefore starts WITH those overlapping tails
    // and ends where cycle 3 (identical) would continue — a seamless loop.
    const buffer = await offlineCtx.startRendering();
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(buffer.getChannelData(ch).slice(cycleFrames, cycleFrames * 2));
    }
    return { channels, sampleRate: buffer.sampleRate };
  }
}
