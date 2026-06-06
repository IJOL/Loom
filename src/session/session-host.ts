// SessionHost: owns all Session-view state + DOM wiring.
// main.ts constructs this after the audio graph and trigger functions are ready,
// then calls sessionHost.init() to activate it.

import type { ChannelStrip } from '../core/fx';
import type { DrumVoice } from '../core/drums';
import type { PolySynth } from '../polysynth/polysynth';
import type { Sequencer } from '../core/sequencer';
import { stepsPerBar } from '../core/meter';
import type { MixerColumnDeps } from '../core/mixer';
import { ensureScenesForRows } from '../core/scene-ensure';
import { confirmDialog } from '../core/dialog';
import {
  emptySessionState, cloneSessionState, emptyLane, emptyClip, audioClip, audioChannelClip, emptyScene,
  moveClip, copyClip,
  deleteClipAt, deleteLane, laneHasContent, sceneHasContent, deleteScene,
  type SessionState, type SessionLane, type SessionClip, type ClipSlot,
} from './session';
import { detectLoop } from '../samples/loop-analysis';
import { importFile } from '../samples/import';
import { sliceBuffer } from '../samples/slice-buffer';
import { slicesToKeymap, audioBufferToWavBytes } from '../samples/slice-to-bank';
import { buildSliceClip } from '../core/slice-clip';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import { sampleStore } from '../samples/store-singleton';
import { sampleCache } from '../samples/sample-cache';
import { getNoteFxChain, loadNoteFxForLane } from '../notefx/notefx-registry';
import { applyLaneEngineState } from '../export/apply-lane-engine-state';
import { preloadSceneSamples } from '../export/preload-scene-samples';
import { renderNoteFxPanel } from '../notefx/notefx-ui';
import { syncNoteFx, mirrorKeymapChange, mirrorDrumkitId } from './session-engine-state';
import { fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import type { KeymapEntry } from '../samples/types';
import { findDrumKit } from '../presets/drum-kits-loader';

// ── Pure helper: slug id generation ────────────────────────────────────────
/** Returns the next available slug id for a new lane of the given engineId.
 *  The loop starts at 1, so for engines with no existing lane the first id is
 *  e.g. "fm-4-op-1". For engines that boot with a default lane (tb303 → "tb-303-1",
 *  subtractive → "subtractive-1", drums-machine → "drums-1"), the default is
 *  already in `existingIds` so the first added extra will be "-2". */
export function nextLaneSlug(existingIds: ReadonlySet<string>, engineId: string): string {
  const prefix =
    engineId === 'tb303'         ? 'tb-303'      :
    engineId === 'drums-machine' ? 'drums'       :
    engineId === 'subtractive'   ? 'subtractive' :
    engineId === 'wavetable'     ? 'wavetable'   :
    engineId === 'fm'            ? 'fm-4-op'     :
    engineId === 'karplus'       ? 'karplus'     :
                                   engineId;
  for (let i = 1; i <= 99; i++) {
    const candidate = `${prefix}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${prefix}-overflow`;
}
import {
  tickSession, launchClip, launchScene, stopLane, stopAll,
  emptyLanePlayState,
  type LanePlayState,
} from './session-runtime';
import { migrateLoadedSessionState } from './session-migration';
import { getEngine, getEngineParamIds } from '../engines/registry';
import { renderSessionGrid, type SessionUICallbacks } from './session-ui';
import { renderSessionTabBar } from './session-tab-bar';
import { buildMixerColumn } from '../core/mixer';
// session-step-scheduler is superseded by the note-based tickLane path (Phase D.3).
import { SessionInspector } from './session-inspector';
import { withUndo } from '../save/history-wiring';
import { rehydrateInsertChain } from './insert-slot';
import {
  mountBassPresetSelect,
  mountDrumsPresetSelect,
  populatePolyPresetSelectForLane,
  refreshPolyPresetSelect,
} from '../polysynth/polysynth-presets';

export interface SessionHostDeps {
  ctx: AudioContext;
  seq: Sequencer;
  playBtn: HTMLButtonElement;
  resetAutomationPosition: () => void;
  /** Injected unified stop. When provided, the session's "Stop all" button
   *  delegates to it (so it also finalizes any live-take recording + resets the
   *  Play button) instead of the local stopAll + re-render. */
  onStopAll?: () => void;
  /** Single per-lane trigger entry — encapsulates engineId dispatch +
   *  laneResources lookup. Replaces the old bassTriggerDirect /
   *  bassTriggerForArp / polyTriggerDirect trio. */
  triggerForLane: (
    laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean,
    sample?: import('./session').ClipSample,
    velocity?: number,
  ) => void;
  // Phase G: drums removed — triggerForLane now routes drums-machine via
  // res.engine.createVoice() like every other engine.
  drumLanes: readonly DrumVoice[];
  markTrackActive: (trackId: string, time: number) => void;
  ensureExtraPoly: (id: string) => PolySynth;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  getLaneEngineId: (laneId: string) => string;
  ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
  showPolyEditor: (laneId: string, target: PolySynth, displayName: string) => void;
  /** Update the active-engine-lane tracker (lane-engine-host state). Called
   *  for FM/Wavetable/Karplus when the user opens their inspector — those
   *  engines have no PolySynth so showPolyEditor's path doesn't fire
   *  setActiveEngineLane, which leaves the preset dropdown applying changes
   *  to a stale (typically subtractive-1) lane. Optional so test fixtures
   *  without the lane-host don't need to implement it. */
  setActiveEngineLane?: (laneId: string) => void;
  // Phase G: polysynth removed — per-lane PolySynth instances are reached
  // via laneResources.get(laneId)?.engine.getPolySynth().
  /** @deprecated Phase G removed the singleton polysynth field. */
  polysynth?: PolySynth;
  mixerDeps: MixerColumnDeps;
  midiLabel: (m: number) => string;
  automationRegistry: Map<string, import('../core/knob').KnobHandle>;
  getAutoAbsSubIdx: () => number;
  onActiveLaneChanged?: () => void;
  /** Phase B: per-lane engine + strip map. Optional so test fixtures don't break. */
  laneResources?: import('../core/lane-resources').LaneResourceMap;
  /** Phase E: allocate a fresh ChannelStrip + engine instance and register them
   *  in laneResources under `laneId`. Called by onAddLane for every new lane so
   *  triggerForLane can find the resource immediately. Optional so test fixtures
   *  that don't construct an audio graph don't need to implement it. */
  ensureLaneResource?: (laneId: string, engineId: string) => void;
  /** Replace the live engine for an already-allocated lane (allocator
   *  .swapLaneEngine). Used to reconcile a lane whose engineId changed via
   *  undo/redo or a loaded session. Optional so test fixtures can skip it. */
  swapLaneEngine?: (laneId: string, newEngineId: string) => void;
  /** Apply a preset to a lane by name. Called by applyLoadedSessionState
   *  for every lane.enginePresetName. Optional so test fixtures without
   *  audio can skip it. */
  applyPresetForLane?: (laneId: string, presetName: string) => void;
  /** Optional: when provided, cell-level edits in clip editors are wrapped
   *  with withUndo so each step toggle becomes an undoable entry. */
  historyDeps?: import('../save/history-wiring').HistoryDeps;
  /** Performance view recording hooks. When present, tickSession appends
   *  clip-launches to arrangement.lanes[*].clipEvents while rec.recording. */
  recHooks?: import('./session-runtime').RecHooks;
  /** Performance view per-tick callback. Called after tickSession on every
   *  sequencer lookahead pulse. Used to drive tickRecAutomation and
   *  tickArrangement. */
  onAfterTick?: (now: number, lookahead: number) => void;
  /** Phase H: called when the user edits an insert slot so the session can be
   *  autosaved. Optional — wired after save manager is set up. */
  saveSession?: () => void;
  /** Task 28: master insert chain for rehydrating persisted master inserts on load.
   *  Optional so test fixtures without audio don't need to wire it. */
  masterInsertChain?: import('../plugins/fx/insert-chain').InsertChain;
  /** Option B2: FxBus instance for threading master send instances into the
   *  modulation destination dropdown. Optional so test fixtures without audio
   *  don't need to wire it. */
  fxBus?: import('../core/fx').FxBus;
  /** Scale + root selectors — forwarded to SessionInspector so the 🎲 Notes
   *  button in the clip editor can produce scale-aware randomization. */
  scaleSel?: HTMLSelectElement;
  rootSel?: HTMLSelectElement;
}

export class SessionHost {
  state: SessionState = emptySessionState();
  laneStates = new Map<string, LanePlayState>();
  private inspector!: SessionInspector;
  private callbacks!: SessionUICallbacks;
  activeEditLane: string | null = null;

  // Callback list fired after every applyLoadedSessionState call (boot + demo
  // switches). Consumers that need lane resources (e.g. boot-eager UI that
  // previously relied on audio-graph.ts pre-allocating lanes) register here.
  // Callbacks PERSIST across multiple calls so kit/wave selectors and knob
  // rows rebind correctly on each demo switch.
  private _stateAppliedCallbacks: Array<() => void> = [];
  /** Callback fires every time `applyLoadedSessionState` runs (boot + demo
   *  switches). Use this for UI that must rebind on lane allocation changes. */
  onStateApplied(cb: () => void): void {
    this._stateAppliedCallbacks.push(cb);
  }
  private _fireStateApplied(): void {
    for (const cb of this._stateAppliedCallbacks) cb();
  }

  // Expose inspector roll for the automation tick in main.ts
  get inspectorRoll() { return this.inspector?.roll ?? null; }

  /** Launch (or restart) a clip by lane id + clip index. Used by the MIDI mediator
   *  and any non-UI launcher. Mirrors onClipPlayPause's transport idle/running logic. */
  launchClipAt(laneId: string, clipIdx: number): void {
    const lane = this.state.lanes.find((l) => l.id === laneId);
    const clip = lane?.clips[clipIdx];
    if (!lane || !clip) return;
    void this.deps.ctx.resume();
    if (!this.deps.seq.isPlaying()) {
      let next = this.laneStates.get(lane.id);
      if (!next) {
        next = { laneId: lane.id, playing: null, queued: null, queuedBoundary: 0,
                 startTime: 0, nextStepIdx: 0, loopCount: 0, loopStartedAt: 0,
                 lastScheduledAt: -Infinity };
        this.laneStates.set(lane.id, next);
      }
      next.queued = clip;
      next.queuedBoundary = this.deps.ctx.currentTime;
      this.deps.resetAutomationPosition?.();
      this.deps.seq.start();
    } else {
      launchClip(this.laneStates, this.state, lane, clip,
        this.deps.ctx.currentTime, this.deps.seq.bpm, this.deps.recHooks);
    }
    this.renderWithMixer();
  }

  /** Launch a scene by index (Ableton model). */
  launchSceneAt(sceneIdx: number): void {
    const scene = this.state.scenes[sceneIdx];
    if (!scene) return;
    void this.deps.ctx.resume();
    launchScene(this.laneStates, this.state, scene, sceneIdx, this.deps.ctx.currentTime, this.deps.seq.bpm);
    if (!this.deps.seq.isPlaying()) { this.deps.resetAutomationPosition?.(); this.deps.seq.start(); }
    this.renderWithMixer();
  }

  /** Stop every playing/queued clip. */
  stopAllClips(): void {
    stopAll(this.laneStates);
    this.renderWithMixer();
  }

  /** Make a lane the active/edit lane (single source of truth shared with the APC).
   *  Idempotent; fires onActiveLaneChanged so subscribers (UI + control) stay in sync. */
  focusLane(laneId: string): void {
    if (this.activeEditLane === laneId) return;
    this.activeEditLane = laneId;
    this.deps.onActiveLaneChanged?.();
    this.renderWithMixer();
  }

  /** Wire historyDeps into the inspector after construction.
   *  historyDeps closes over saveWiringDeps which closes over sessionHost,
   *  so it can only be built after sessionHost.init() returns. */
  setHistoryDeps(hd: import('../save/history-wiring').HistoryDeps): void {
    this.deps.historyDeps = hd;
    this.inspector?.setHistoryDeps(hd);
  }

  constructor(public readonly deps: SessionHostDeps) {}

  /** Mode 2: chop an audio clip into per-slice bank samples + a normal note clip
   *  on a NEW sampler lane (the original audio lane is left intact). */
  onSliceToBank(laneId: string, clipIdx: number): void {
    const { ctx, seq } = this.deps;
    const lane = this.state.lanes.find((l) => l.id === laneId);
    const clip = lane?.clips[clipIdx];
    if (!lane || !clip?.sample) return;
    void ctx.resume();
    void (async () => {
      const srcId = clip.sample!.sampleId;
      const buf = sampleCache.get(srcId) ?? await sampleCache.ensureLoaded(ctx, srcId, sampleStore);
      if (!buf) return;
      const det = detectLoop(buf, seq.meter);
      const cuts = sliceBuffer(ctx, buf, det.slicePointsSec);
      const sliceIds: string[] = [];
      for (const cut of cuts) {
        const id = newSampleId();
        const bytes = await audioBufferToWavBytes(cut.buffer);
        await sampleStore.put(buildSampleAsset({
          id, name: `${clip.name ?? 'slice'} ${sliceIds.length + 1}`,
          mime: 'audio/wav', bytes, buffer: cut.buffer, createdAt: Date.now(),
        }));
        sampleCache.put(id, cut.buffer);
        sliceIds.push(id);
      }
      const km = slicesToKeymap(sliceIds);
      const built = buildSliceClip({
        slicePointsSec: det.slicePointsSec, durationSec: buf.duration,
        originalBpm: clip.sample!.originalBpm ?? det.originalBpm,
        projectMeter: seq.meter, gridResolution: DEFAULT_RESOLUTION,
      });
      const noteClip: SessionClip = {
        id: `clip-${Date.now().toString(36)}`,
        name: `${clip.name ?? 'Loop'} sliced`,
        color: clip.color,
        lengthBars: built.lengthBars,
        notes: built.notes,
        gridResolution: DEFAULT_RESOLUTION,
        waveformRef: { sampleId: srcId, slices: built.slices }, // waveform + slice markers above the notes
      };
      const hd = this.deps.historyDeps;
      const run = () => {
        const used = new Set(this.state.lanes.map((l) => l.id));
        const newId = nextLaneSlug(used, 'sampler');
        const newLane = emptyLane(newId, 'sampler');
        newLane.name = `${lane.name ?? 'Audio'} slices`;
        newLane.engineState = { sampler: { keymap: km } };
        const rows = Math.max(this.state.scenes.length, 1);
        const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
        for (let r = 0; r < rows; r++) newLane.clips.push(r === 0 ? noteClip : emptyClip(defaultLen));
        this.state.lanes.push(newLane);
        this.laneStates.set(newId, emptyLanePlayState(newId));
        this.deps.ensureLaneResource?.(newId, 'sampler');
        const eng = this.deps.laneResources?.get(newId)?.engine as unknown as { setKeymap?(k: typeof km): void };
        eng?.setKeymap?.(km);
        mirrorKeymapChange(this.state, newId, km);
        ensureScenesForRows(this.state);
        this.inspector.setSelectedClip({ laneId: newId, clipIdx: 0 });
        this.inspector.openInspector();
        this.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    })();
  }

  init(): void {
    this.inspector = new SessionInspector({
      ctx: this.deps.ctx,
      seq: this.deps.seq,
      state: this.state,
      laneStates: this.laneStates,
      renderWithMixer: () => this.renderWithMixer(),
      midiLabel: this.deps.midiLabel,
      automationRegistry: this.deps.automationRegistry,
      getAutoAbsSubIdx: this.deps.getAutoAbsSubIdx,
      historyDeps: this.deps.historyDeps,
      laneResources: this.deps.laneResources,
      saveSession: this.deps.saveSession,
      scaleSel: this.deps.scaleSel,
      rootSel: this.deps.rootSel,
      triggerForLane: this.deps.triggerForLane,
      onSliceToBank: (laneId, clipIdx) => this.onSliceToBank(laneId, clipIdx),
    });

    this.deps.seq.sessionTick = (now, look) => {
      tickSession(
        this.laneStates, this.state, now, look, this.deps.seq.bpm,
        (laneId, midi, scheduleTime, gateSec, accent, slidingIn, sample, velocity) =>
          this.deps.triggerForLane(laneId, midi, scheduleTime, gateSec, accent, slidingIn, sample, velocity),
        (laneId, _clipId, _stepInClip, stepTime) =>
          this.deps.markTrackActive(laneId, stepTime),
        this.deps.recHooks,
        this.deps.seq.meter,
      );
      if (this.deps.onAfterTick) this.deps.onAfterTick(now, look);
    };

    this.buildCallbacks();
    this.refreshSynthTabs();
    this.startRenderTick();
    // Phase G deferral rule: lane resources don't exist until
    // applyLoadedSessionState runs (post-demo-fetch). renderWithMixer calls
    // stripFor() for every lane, which throws if the lane isn't allocated.
    // Defer the first mixer render until lanes are populated. Subsequent
    // applyLoadedSessionState calls (demo picker) re-fire this callback
    // because onStateApplied is repeating.
    this.onStateApplied(() => this.renderWithMixer());
  }

  // ── Public API for save/load ─────────────────────────────────────────────

  getStateForSave(): SessionState {
    this.collectEngineState();
    return cloneSessionState(this.state);
  }

  applyLoadedSessionState(sess: SessionState): void {
    const migrated = migrateLoadedSessionState(sess);
    this.state.lanes = migrated.lanes ?? [];
    this.state.scenes = migrated.scenes ?? [];
    this.state.globalQuantize = migrated.globalQuantize ?? '1/1';
    this.state.masterInserts = migrated.masterInserts ?? [];
    this.laneStates.clear();
    // Free audio resources for lanes that vanished in the new state (e.g.
    // undo of add-lane). Keeping orphans around accumulates ChannelStrips and
    // engine instances each time the user cycles add → undo → add.
    const keep = new Set(this.state.lanes.map((l) => l.id));
    for (const id of this.deps.laneResources?.ids() ?? []) {
      if (!keep.has(id)) this.deps.laneResources?.dispose(id);
    }
    for (const lane of this.state.lanes) {
      this.laneStates.set(lane.id, emptyLanePlayState(lane.id));
      // Every lane needs an audio resource (strip + engine instance) — without
      // it, triggerForLane finds nothing and automation knobs never get
      // registered under the lane's id. Built-in lanes are pre-allocated at
      // boot; lanes that arrive via loaded state (demos, save files) are
      // allocated lazily here.
      // Allocate lazily, OR reconcile a lane whose engineId changed (undo/redo
      // or a loaded session): if a resource exists but its live engine differs
      // from the lane's engineId, swap it in place rather than skip (the
      // idempotent ensureLaneResource would otherwise leave the old engine).
      const existing = this.deps.laneResources?.get(lane.id);
      if (existing && existing.engine.id !== lane.engineId) {
        this.deps.swapLaneEngine?.(lane.id, lane.engineId);
      } else {
        this.deps.ensureLaneResource?.(lane.id, lane.engineId);
      }
      // Task 28: rehydrate persisted insert slots into the lane's chain.
      if (lane.inserts && lane.inserts.length > 0) {
        const laneRes = this.deps.laneResources?.get(lane.id);
        if (laneRes?.inserts) {
          rehydrateInsertChain(this.deps.ctx, laneRes.inserts, lane.inserts);
        }
      }
      if (lane.enginePresetName) {
        this.deps.applyPresetForLane?.(lane.id, lane.enginePresetName);
      }
    }
    this.applyEngineState();
    // Task 28: rehydrate master insert chain before firing state-applied callbacks
    // so the UI rebuild (rebuildMasterInserts) sees a populated chain.
    const masterChain = this.deps.masterInsertChain;
    if (masterChain && this.state.masterInserts && this.state.masterInserts.length > 0) {
      while (masterChain.size() > 0) masterChain.remove(0);
      rehydrateInsertChain(this.deps.ctx, masterChain, this.state.masterInserts);
    }
    this.renderWithMixer();
    // Decode every referenced audio buffer (audio clips, sampler keymaps, slice
    // banks) into the cache so loaded sessions sound on first Play, not just on
    // offline export. Fire-and-forget: editors render regardless; audio comes
    // alive once decode resolves.
    void preloadSceneSamples(this.deps.ctx, this.state.lanes);
    this._fireStateApplied();
  }

  private collectEngineState(): void {
    for (const lane of this.state.lanes) {
      const engine = this.deps.laneResources?.get(lane.id)?.engine;
      const host = (engine as { modulators?: { serialize(): unknown[] } } | undefined)?.modulators;
      if (host) {
        // Preserve params (mirrored live by mirrorParamChange on every knob
        // change) and only refresh modulators from the live engine. Replacing
        // the whole engineState object here dropped every per-lane knob value
        // on save, so non-303 lanes loaded back with default sound params.
        if (!lane.engineState) lane.engineState = {};
        lane.engineState.modulators =
          host.serialize() as import('../modulation/types').ModulatorState[];
      }
      // Mirror the lane's note-FX chain so it persists on save.
      if (!lane.engineState) lane.engineState = {};
      lane.engineState.noteFx = getNoteFxChain(lane.id).serialize();
    }
  }

  private applyEngineState(): void {
    for (const lane of this.state.lanes) {
      const engine = this.deps.laneResources?.get(lane.id)?.engine;
      if (!engine) continue;
      void applyLaneEngineState(engine as never, lane, this.deps.ctx, {
        loadNoteFx: (laneId, state) => loadNoteFxForLane(laneId, state),
        // Live: fire-and-forget the drumkit reload (the editor renders regardless;
        // audio comes alive once the fetch/decode resolves).
        reloadDrumkit: (laneId, kitId, eng) => { void this.reloadDrumkit(laneId, kitId, eng); },
      });
    }
  }

  /** Re-load a bundled drumkit by id into a sampler lane (fresh sampleIds +
   *  decoded cache), then re-mirror the resolved keymap. Fire-and-forget from
   *  applyEngineState; the drum-grid editor renders its 8 rows regardless and
   *  audio comes alive once the fetch/decode completes. */
  private async reloadDrumkit(
    laneId: string,
    kitId: string,
    engine: { setKeymap(k: KeymapEntry[]): void },
  ): Promise<void> {
    try {
      const manifest = await fetchDrumkitManifest(kitId);
      const km = await loadDrumkit(manifest, this.deps.ctx);
      engine.setKeymap(km);
      mirrorKeymapChange(this.state, laneId, km);
    } catch (err) {
      console.warn(`[drumkit] failed to reload '${kitId}' for ${laneId}:`, err);
    }
  }

  /** Live drums-page preset pick (ctx-aware). Synth kits go through the engine's
   *  sync applyPreset; sample kits decode the bundled drumkit into the embedded
   *  sampler here (we hold the AudioContext), mirror the sub-state, then rebuild
   *  the inspector engine-body so the panel swaps. */
  async applyDrumPreset(laneId: string, name: string): Promise<void> {
    const entry = findDrumKit(name);
    const engine = this.deps.laneResources?.get(laneId)?.engine as unknown as {
      applyPreset(n: string): void;
      setKitMode(m: 'synth' | 'sample'): void;
      setKeymap(k: KeymapEntry[]): void;
    } | undefined;
    if (!entry || !engine) return;

    engine.applyPreset(name);        // sets kitMode (+ synth loadKitDefaults)
    if (entry.kind === 'sample' && entry.drumkitId) {
      engine.setKitMode('sample');   // belt-and-suspenders before the async decode
      try {
        const manifest = await fetchDrumkitManifest(entry.drumkitId);
        const km = await loadDrumkit(manifest, this.deps.ctx);
        engine.setKeymap(km);
        mirrorKeymapChange(this.state, laneId, km);
        mirrorDrumkitId(this.state, laneId, entry.drumkitId);
      } catch (err) {
        console.warn(`[drumkit] failed to load '${entry.drumkitId}' for ${laneId}:`, err);
      }
    } else {
      // Synth kit: drop any stale drumkit sub-state so a later load doesn't
      // re-trigger the sample self-heal.
      mirrorDrumkitId(this.state, laneId, undefined);
    }

    const lane = this.state.lanes.find((l) => l.id === laneId);
    if (lane) {
      if (!lane.engineState) lane.engineState = {};
      const prevMode = lane.engineState.kitMode;
      if (prevMode && prevMode !== entry.kind && lane.engineState.params) {
        // Per-voice ids (e.g. 'kick.tune') mean different things + ranges in
        // synth vs sample mode; bus.* is mode-agnostic. Drop the per-voice keys
        // so a kit-mode switch doesn't replay stale cross-mode values into the
        // other source on the next load.
        for (const id of Object.keys(lane.engineState.params)) {
          if (!id.startsWith('bus.')) delete lane.engineState.params[id];
        }
      }
      lane.engineState.kitMode = entry.kind;
      lane.enginePresetName = `engine:${name}`;
    }

    // Rebuild the inspector engine-body so the synth rack <-> sampler panel swaps
    // immediately (this also re-pushes current knob values). Only when this lane
    // is the one being edited.
    if (this.activeEditLane === laneId) this.injectEngineModulatorPanel(laneId, 'drums');
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const hostEl = document.getElementById('session-grid');
    if (!hostEl) return;
    renderSessionGrid(hostEl, this.state, this.laneStates, this.callbacks);
  }

  renderWithMixer(): void {
    this.render();
    this.refreshSynthTabs();
    const row = this.callbacks?._mixerRow;
    if (!row) return;
    row.innerHTML = '';
    const sp = document.createElement('div');
    sp.className = 'session-spacer';
    row.appendChild(sp);
    for (const lane of this.state.lanes) {
      row.appendChild(buildMixerColumn(lane.id, this.deps.mixerDeps));
    }
    const sp2 = document.createElement('div');
    sp2.className = 'session-spacer';
    row.appendChild(sp2);
  }

  private refreshSynthTabs(): void {
    const host = document.getElementById('synth-tabs');
    if (!host) return;
    renderSessionTabBar(host, {
      state: this.state,
      onPickLane: (laneId) => this.callbacks.onEditLane(laneId),
      onAddLane:  (engineId) => this.callbacks.onAddLane(engineId),
      onAddAudioChannel: (file) => this.callbacks.onAddAudioChannel?.(file),
    });
  }

  /** Public entry for the Stems dialog: create one Sampler lane per separated
   *  stem (delegates to the undoable callbacks impl). With `opts.replace` the
   *  whole session is swapped for a clean stems-only one. */
  addStemLanes(
    stems: { label: string; sampleId: string; durationSec: number }[],
    opts: { replace?: boolean } = {},
  ): void {
    this.callbacks.onAddStemLanes(stems, opts);
  }

  /** Create one new lane (melodic or drums) holding a clip of transcribed notes,
   *  as a single undoable action. Used by the "🎵 Notas" transcription flow. */
  addNoteLane(
    engineId: string,
    notes: import('../core/notes').NoteEvent[],
    lengthBars: number,
    name: string,
  ): void {
    const hd = this.deps.historyDeps;
    const seq = this.deps.seq;
    const run = () => {
      const used = new Set(this.state.lanes.map((l) => l.id));
      const newId = nextLaneSlug(used, engineId);
      const lane = emptyLane(newId, engineId);
      lane.name = name;
      const rows = Math.max(this.state.scenes.length, 1);
      const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
      const clip = emptyClip(Math.max(1, lengthBars));
      clip.notes = notes;
      clip.name = name;
      for (let r = 0; r < rows; r++) lane.clips.push(r === 0 ? clip : emptyClip(defaultLen));
      this.state.lanes.push(lane);
      this.laneStates.set(newId, emptyLanePlayState(newId));
      this.deps.ensureLaneResource?.(newId, engineId);
      // Launch alongside scene 0 (the stems scene) when one exists.
      if (this.state.scenes[0]) this.state.scenes[0].clipPerLane[newId] = 0;
      this.renderWithMixer();
    };
    if (hd) withUndo(hd, run); else run();
  }

  /** Create a new dedicated 'audio' channel/lane holding the given file as a
   *  single clip (decodes + persists the sample, then adds the lane + clip as
   *  one undoable action). Public so the live-take recorder can drop a finished
   *  take straight into a fresh audio channel.
   *
   *  `knownBpm`: for audio WE generated (a live take / offline render captured at
   *  the project tempo), pass the project BPM so the clip locks to the grid with
   *  warp ratio 1.0. Re-running tempo detection on our own render is unreliable
   *  (autocorrelation guesses a wrong multiple) and warps the audio — that was
   *  the "no cuadra / cortado al principio" bug. Omitted ⇒ detect (external WAVs). */
  addAudioChannel(file: File, opts?: { knownBpm?: number }): void {
    const self = this;
    const { ctx, seq } = this.deps;
    void ctx.resume();
    void (async () => {
      try {
        const asset = await importFile(file, ctx);
        await sampleStore.put(asset);
        const buf = await ctx.decodeAudioData(asset.bytes.slice(0));
        sampleCache.put(asset.id, buf);
        const originalBpm = opts?.knownBpm ?? detectLoop(buf, seq.meter).originalBpm;
        const name = file.name.replace(/\.[^.]+$/, '');
        const clip = audioChannelClip({
          name, sampleId: asset.id, durationSec: buf.duration,
          originalBpm, projectMeter: seq.meter,
        });
        const hd = self.deps.historyDeps;
        const run = () => {
          const used = new Set(self.state.lanes.map((l) => l.id));
          const newId = nextLaneSlug(used, 'audio');
          const lane = emptyLane(newId, 'audio');
          lane.name = name;
          const rows = Math.max(self.state.scenes.length, 1);
          const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
          for (let r = 0; r < rows; r++) lane.clips.push(r === 0 ? clip : emptyClip(defaultLen));
          self.state.lanes.push(lane);
          self.laneStates.set(newId, emptyLanePlayState(newId));
          self.deps.ensureLaneResource?.(newId, 'audio');
          ensureScenesForRows(self.state);
          self.inspector.setSelectedClip({ laneId: newId, clipIdx: 0 });
          self.inspector.openInspector();
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      } catch (err) {
        console.warn('Audio channel: could not load loop:', err);
      }
    })();
  }

  // ── Callbacks ────────────────────────────────────────────────────────────

  private buildCallbacks(): void {
    const self = this;
    const { ctx, seq, playBtn, resetAutomationPosition } = this.deps;

    this.callbacks = {
      onClipClick(laneId, clipIdx) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        const clip = lane?.clips[clipIdx];
        if (!lane || !clip) return;
        self.inspector.setSelectedClip({ laneId, clipIdx });
        self.inspector.openInspector();
        // Focus the inspector panel so the user sees where the editor opened
        // (and so keyboard interactions land there, not on the just-clicked cell).
        const panel = document.getElementById('session-inspector');
        panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        self.renderWithMixer();
      },
      onClipPlayPause(laneId, clipIdx) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        const clip = lane?.clips[clipIdx];
        if (!lane || !clip) return;
        void ctx.resume();
        const lp = self.laneStates.get(lane.id);
        const isPlaying = !!(lp?.playing && lp.playing.id === clip.id);
        const isQueued  = !!(lp?.queued  && lp.queued.id  === clip.id);
        if (isPlaying || isQueued) {
          stopLane(self.laneStates, lane.id,
            self.deps.recHooks ? { ...self.deps.recHooks, nowCtx: ctx.currentTime } : undefined);
          self.renderWithMixer();
          return;
        }
        // Launch. If the transport is idle there's no rhythmic grid to sync
        // against — pretend the user picked 'immediate' so the clip starts
        // coincident with the transport's first tick instead of waiting for
        // a wall-clock boundary.
        if (!seq.isPlaying()) {
          let next = self.laneStates.get(lane.id);
          if (!next) {
            next = { laneId: lane.id, playing: null, queued: null, queuedBoundary: 0,
                     startTime: 0, nextStepIdx: 0, loopCount: 0, loopStartedAt: 0,
                     lastScheduledAt: -Infinity };
            self.laneStates.set(lane.id, next);
          }
          next.queued = clip;
          next.queuedBoundary = ctx.currentTime;
          resetAutomationPosition();
          seq.start();
          playBtn.classList.add('is-playing');
        } else {
          launchClip(self.laneStates, self.state, lane, clip, ctx.currentTime, seq.bpm,
            self.deps.recHooks);
        }
        self.renderWithMixer();
      },
      onCellClick(laneId, clipIdx) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane) return;
        if (lane.engineId === 'audio') return; // audio cells are filled by dropping a WAV
        const hd = self.deps.historyDeps;
        const run = () => {
          const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
          const clip: SessionClip = emptyClip(defaultLen);
          while (lane.clips.length <= clipIdx) lane.clips.push(null);
          lane.clips[clipIdx] = clip;
          self.inspector.setSelectedClip({ laneId, clipIdx });
          self.inspector.openInspector();
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      onCellDropAudio(laneId, clipIdx, file) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane || (lane.engineId !== 'sampler' && lane.engineId !== 'audio')) return;
        void ctx.resume();
        void (async () => {
          try {
            const asset = await importFile(file, ctx);
            await sampleStore.put(asset);
            const buf = await ctx.decodeAudioData(asset.bytes.slice(0));
            sampleCache.put(asset.id, buf);
            const name = file.name.replace(/\.[^.]+$/, '');
            const clip = lane.engineId === 'audio'
              ? audioChannelClip({
                  name, sampleId: asset.id, durationSec: buf.duration,
                  originalBpm: detectLoop(buf, seq.meter).originalBpm, projectMeter: seq.meter,
                })
              : audioClip({ name, sampleId: asset.id, durationSec: buf.duration, bpm: seq.bpm });
            const hd = self.deps.historyDeps;
            const run = () => {
              while (lane.clips.length <= clipIdx) lane.clips.push(null);
              lane.clips[clipIdx] = clip;
              ensureScenesForRows(self.state);
              self.inspector.setSelectedClip({ laneId, clipIdx });
              self.inspector.openInspector();
              self.renderWithMixer();
            };
            if (hd) withUndo(hd, run); else run();
          } catch (err) {
            console.warn('Could not load dropped audio:', err);
          }
        })();
      },
      onAddAudioChannel(file: File) { self.addAudioChannel(file); },
      onStopLane(laneId) {
        stopLane(self.laneStates, laneId,
          self.deps.recHooks ? { ...self.deps.recHooks, nowCtx: ctx.currentTime } : undefined);
        self.renderWithMixer();
      },
      onLaunchScene(idx) {
        const scene = self.state.scenes[idx];
        if (!scene) return;
        void ctx.resume();
        launchScene(self.laneStates, self.state, scene, idx, ctx.currentTime, seq.bpm);
        if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.classList.add('is-playing'); }
        self.renderWithMixer();
      },
      onStopAll() {
        if (self.deps.onStopAll) { self.deps.onStopAll(); return; }
        stopAll(self.laneStates); self.renderWithMixer();
      },
      onAddScene() {
        const hd = self.deps.historyDeps;
        const run = () => {
          self.state.scenes.push({
            id: `scene-${Date.now().toString(36)}`,
            name: `Scene ${self.state.scenes.length + 1}`,
            clipPerLane: {},
          });
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      onAddLane(engineId: string) {
        const hd = self.deps.historyDeps;
        const run = () => {
          const used = new Set(self.state.lanes.map((l) => l.id));
          const newId = nextLaneSlug(used, engineId);

          const engineDef = getEngine(engineId);
          const sameKindCount = self.state.lanes.filter((l) => l.engineId === engineId).length;
          const displayName = engineDef ? `${engineDef.name} ${sameKindCount + 1}` : newId;
          const lane = emptyLane(newId, engineId);
          lane.name = displayName;
          const rowCount = Math.max(self.state.scenes.length, 1);
          const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
          for (let r = 0; r < rowCount; r++) {
            lane.clips.push(emptyClip(defaultLen));
          }
          self.state.lanes.push(lane);
          self.laneStates.set(newId, emptyLanePlayState(newId));

          // Allocate a fresh ChannelStrip + engine instance for the new lane so
          // triggerForLane can find it via laneResources immediately.
          self.deps.ensureLaneResource?.(newId, engineId);
          ensureScenesForRows(self.state);
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      /** Create one Sampler lane per separated stem, as a single undoable action.
       *  Each lane gets a melodic keymap zone (so the Sampler instrument editor
       *  SHOWS the stem) + a full-length 'song' audio clip on row 0. With
       *  `opts.replace`, the whole session is swapped for a clean one holding only
       *  the stems (1 scene, every lane launching its clip). Each `stems[i].sampleId`
       *  must already be in the sample store AND decoded into sampleCache by the
       *  caller (stem-import). */
      onAddStemLanes(
        stems: { label: string; sampleId: string; durationSec: number }[],
        opts: { replace?: boolean } = {},
      ) {
        const hd = self.deps.historyDeps;
        const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));

        // One Sampler lane carrying the stem: keymap zone (instrument view) +
        // 'song' audio clips. `rows` = how many scene rows to back-fill with
        // empty clips so the lane lines up with the existing scene grid.
        const buildStemLane = (
          stem: { label: string; sampleId: string; durationSec: number },
          id: string,
          rows: number,
        ): SessionLane => {
          const lane = emptyLane(id, 'sampler');
          lane.name = stem.label;
          lane.engineState = {
            sampler: { keymap: [{ sampleId: stem.sampleId, rootNote: 60, loNote: 0, hiNote: 127 }] },
          };
          const clip = audioClip({
            name: stem.label,
            sampleId: stem.sampleId,
            durationSec: stem.durationSec,
            bpm: seq.bpm,
            mode: 'song',
          });
          for (let r = 0; r < rows; r++) lane.clips.push(r === 0 ? clip : emptyClip(defaultLen));
          return lane;
        };

        const runReplace = () => {
          const lanes = stems.map((s, i) => buildStemLane(s, `sampler-stem-${i + 1}`, 1));
          const scene = emptyScene('Stems');
          scene.clipPerLane = Object.fromEntries(lanes.map((l) => [l.id, 0]));
          const newState: SessionState = {
            lanes,
            scenes: [scene],
            globalQuantize: self.state.globalQuantize,
          };
          // applyLoadedSessionState allocates engine resources AND applies each
          // lane's engineState (the keymap), so the instruments show the stems.
          self.applyLoadedSessionState(newState);
        };

        const runAdd = () => {
          const rows = Math.max(self.state.scenes.length, 1);
          for (const stem of stems) {
            const used = new Set(self.state.lanes.map((l) => l.id));
            const newId = nextLaneSlug(used, 'sampler');
            const lane = buildStemLane(stem, newId, rows);
            self.state.lanes.push(lane);
            self.laneStates.set(newId, emptyLanePlayState(newId));
            self.deps.ensureLaneResource?.(newId, 'sampler');
            // The add path does not run applyEngineState, so push the keymap into
            // the freshly-allocated live engine ourselves (otherwise the instrument
            // editor stays empty until reload).
            const engine = self.deps.laneResources?.get(newId)?.engine as
              | { setKeymap?: (k: import('../samples/types').KeymapEntry[]) => void }
              | undefined;
            engine?.setKeymap?.(lane.engineState!.sampler!.keymap);
          }
          ensureScenesForRows(self.state);
          self.renderWithMixer();
        };

        const run = opts.replace ? runReplace : runAdd;
        if (hd) withUndo(hd, run); else run();
      },
      onMoveClip(from: ClipSlot, to: ClipSlot, copy: boolean) {
        const destLane = self.state.lanes.find((l) => l.id === to.laneId);
        if (!destLane) return;
        const paramIds = getEngineParamIds(destLane.engineId);
        const hd = self.deps.historyDeps;
        const run = () => {
          const next = copy
            ? copyClip(self.state, from, to, paramIds)
            : moveClip(self.state, from, to, paramIds);
          self.state.lanes = next.lanes;
          self.state.scenes = next.scenes;
          self.state.globalQuantize = next.globalQuantize;
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      onAddClipRow()   { /* Task 11 */ },
      onEditLane(laneId) {
        // Toggle off when the user clicks the already-active lane tab.
        if (self.activeEditLane === laneId) {
          document.querySelectorAll<HTMLElement>('.page').forEach((p) => { p.hidden = true; });
          document.querySelectorAll<HTMLButtonElement>('.session-lane-tab').forEach((t) => {
            t.classList.remove('active');
          });
          self.activeEditLane = null;
          self.deps.onActiveLaneChanged?.();
          return;
        }
        self.showLaneEditor(laneId);
      },
      onDeleteClip(laneId, clipIdx) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane || lane.clips[clipIdx] == null) return; // empty cell → no-op
        const hd = self.deps.historyDeps;
        const run = () => {
          deleteClipAt(lane, clipIdx);
          const sel = self.inspector.getSelectedClip();
          if (sel && sel.laneId === laneId && sel.clipIdx === clipIdx) {
            self.inspector.setSelectedClip(null);
            const panel = document.getElementById('session-inspector');
            if (panel) panel.hidden = true;
          }
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      async onDeleteLane(laneId) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane) return;
        if (laneHasContent(lane)) {
          const label = lane.name ?? lane.id;
          if (!(await confirmDialog(`¿Borrar la pista «${label}» y todos sus clips?`, { danger: true, okLabel: 'Borrar' }))) return;
        }
        // Stop the lane BEFORE disposing it: cut in-flight voices/loops (symmetry
        // with onDeleteScene; avoids the analogue of the "New leaves synths" bug).
        stopLane(self.laneStates, laneId,
          self.deps.recHooks ? { ...self.deps.recHooks, nowCtx: ctx.currentTime } : undefined);
        const hd = self.deps.historyDeps;
        const run = () => {
          deleteLane(self.state, laneId);
          self.laneStates.delete(laneId);
          self.deps.laneResources?.dispose(laneId); // frees strip + engine + inserts
          if (self.activeEditLane === laneId) {
            document.querySelectorAll<HTMLElement>('.page').forEach((p) => { p.hidden = true; });
            document.querySelectorAll<HTMLButtonElement>('.session-lane-tab').forEach((t) => t.classList.remove('active'));
            self.activeEditLane = null;
            self.deps.onActiveLaneChanged?.();
          }
          self.refreshSynthTabs();
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      async onDeleteScene(sceneIdx) {
        const scene = self.state.scenes[sceneIdx];
        if (!scene) return;
        if (sceneHasContent(self.state, sceneIdx)) {
          const label = scene.name ?? `Scene ${sceneIdx + 1}`;
          if (!(await confirmDialog(`¿Borrar la escena «${label}»?`, { danger: true, okLabel: 'Borrar' }))) return;
        }
        const hd = self.deps.historyDeps;
        const run = () => {
          // Stop whatever is sounding/queued on that row before compacting.
          for (const lp of self.laneStates.values()) {
            const lane = self.state.lanes.find((l) => l.id === lp.laneId);
            const clipInRow = lane?.clips[sceneIdx];
            if (clipInRow && (lp.playing?.id === clipInRow.id || lp.queued?.id === clipInRow.id)) {
              stopLane(self.laneStates, lp.laneId,
                self.deps.recHooks ? { ...self.deps.recHooks, nowCtx: ctx.currentTime } : undefined);
            }
          }
          deleteScene(self.state, sceneIdx); // COMPACTING (front A · session.ts)
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      onToggleDrumsExpanded() { /* drum-bus expand removed — drum-grid editor shows all voices */ },
    };
  }

  /** Show a lane's editor: route to its engine's page (poly / 303 / drums),
   *  rebuild the engine param UI + modulator panel + labels. Does NOT toggle.
   *  Used by onEditLane (non-toggle path) and by the post-engine-swap re-route. */
  showLaneEditor(laneId: string): void {
    const lane = this.state.lanes.find((l) => l.id === laneId);

    let polyTarget: PolySynth | null = null;
    if (lane?.engineId === 'subtractive') {
      // Each subtractive lane owns its PolySynth instance — reach it via
      // the engine stored in laneResources.
      const engine = this.deps.laneResources?.get(laneId)?.engine;
      const getPS = (engine as unknown as { getPolySynth?(): PolySynth | null })?.getPolySynth;
      polyTarget = getPS ? getPS.call(engine) ?? null : null;
    }

    const targetTab =
      lane?.engineId === 'tb303'          ? '303'   :
      (lane?.engineId === 'drums-machine' || laneId.startsWith('drum:')) ? 'drums' :
                                                                           'poly';
    document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
      if (t.classList.contains('session-lane-tab')) {
        t.classList.toggle('active', t.dataset.laneId === laneId);
      } else {
        t.classList.toggle('active', t.dataset.tab === targetTab && !t.classList.contains('synth-tab'));
      }
    });
    const displayName = lane?.name ?? laneId.toUpperCase();
    if (polyTarget) {
      this.deps.showPolyEditor(laneId, polyTarget, displayName);
    } else {
      document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
        p.hidden = p.dataset.page !== targetTab;
      });
      // FM/Wavetable/Karplus poly lanes: no PolySynth target, so the
      // showPolyEditor path above is skipped — but the preset dropdown,
      // engine selector, and engine-mod-host all need to retarget to
      // this lane. Calling setActiveEngineLane updates _lehState.activeLaneId
      // so that getActiveEngineLaneId() inside polysynth-presets.ts
      // resolves to the right lane when the user picks a preset.
      if (targetTab === 'poly') {
        this.deps.setActiveEngineLane?.(laneId);
      }
    }
    // Hide Subtractive-only knob rows when the active poly lane's engine
    // is NOT subtractive (FM / Wavetable / Karplus render their own
    // controls inside engine-mod-host; the legacy `data-engine="subtractive"`
    // rows shouldn't leak in on top). The toggle runs unconditionally so
    // switching back to a subtractive lane re-shows them.
    const polyPage = document.querySelector('[data-page="poly"]');
    if (polyPage) {
      const subRows = polyPage.querySelectorAll<HTMLElement>('[data-engine="subtractive"]');
      const showSubRows = lane?.engineId === 'subtractive';
      for (const row of subRows) row.style.display = showSubRows ? '' : 'none';
    }
    // Keep #engine-lane-label in sync for non-poly lanes too (no-op if the
    // active page doesn't include it).
    const laneLabelEl = document.getElementById('engine-lane-label');
    if (laneLabelEl) laneLabelEl.textContent = displayName;
    const polyActiveLabel = document.getElementById('poly-active-label');
    if (polyActiveLabel) polyActiveLabel.textContent = displayName;
    this.activeEditLane = laneId;
    this.injectEngineModulatorPanel(laneId, targetTab);
    this.deps.onActiveLaneChanged?.();
  }

  // ── Engine modulator panel injection ─────────────────────────────────────
  // Single source of truth for the modulators UI: every editable lane (bass,
  // drums, and every poly lane regardless of engine) gets its panel injected
  // into the bottom of the currently-shown page.

  private injectEngineModulatorPanel(laneId: string, targetTab: string): void {
    // Phase B: engine comes from laneResources (single source of truth). No
    // more singleton/extra split — every lane has its own instance.
    const lane = this.state.lanes.find((l) => l.id === laneId);
    let engine = this.deps.laneResources?.get(laneId)?.engine;
    if (!engine) {
      // Fallback (e.g. drum sub-voice laneIds starting with `drum:` aren't in
      // laneResources). Use the engine for the lane's declared engineId.
      const engineId = lane?.engineId
        ?? (laneId.startsWith('drum:') ? 'drums-machine' : 'subtractive');
      engine = getEngine(engineId);
      if (!engine) return;
    }

    // Mount or reuse a container. Place the modulators panel BELOW the main
    // synth controls — for poly we anchor on #poly-seq-mode-row so the panel
    // sits between the engine controls and the SEQ MODE / tracks block. For
    // other pages (drums, bass) we fall back to appending at the end.
    const page = document.querySelector<HTMLElement>(`[data-page="${targetTab}"]`);
    if (!page) return;
    let host = page.querySelector<HTMLElement>('.engine-mod-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'engine-mod-host';
      // Place engine body BEFORE the FX row so the engine knobs render above
      // the compressor on every page: poly anchors on #poly-fx-row, while the
      // 303 / drums pages fall back to the FX row that hosts .lane-fx-knobs.
      const anchor = page.querySelector<HTMLElement>('#poly-fx-row')
        ?? page.querySelector<HTMLElement>('#poly-seq-mode-row')
        ?? page.querySelector<HTMLElement>('.lane-fx-knobs')?.closest<HTMLElement>('.row');
      if (anchor) page.insertBefore(host, anchor);
      else page.appendChild(host);
    }
    host.innerHTML = '';

    engine.buildParamUI(host, {
      laneId,
      registerKnob: (k: unknown) => {
        const handle = k as import('../core/knob').KnobHandle;
        if (handle.meta?.id) this.deps.automationRegistry.set(handle.meta.id, handle);
      },
      registry: this.deps.automationRegistry as Map<string, unknown>,
      lookupLaneDisplayName: (id: string) =>
        this.state.lanes.find((l) => l.id === id)?.name,
      sessionState: this.state,
      historyDeps: this.deps.historyDeps,
      // Phase J: thread insert chains so the modulation destination dropdown
      // can expose lane and master FX params.
      laneInserts: this.deps.laneResources?.get(laneId)?.inserts,
      masterInserts: this.deps.masterInsertChain,
      // Option B2: thread FxBus so master send params appear in destination dropdown.
      fxBus: this.deps.fxBus,
      // Live AudioContext for the sampler's audio import (decodeAudioData).
      audioContext: this.deps.ctx,
      // Place a built clip (sampler loop import) onto this lane's first empty
      // slot (or append) and re-render the grid + inspector.
      installClip: (clip) => {
        const lane = this.state.lanes.find((l) => l.id === laneId);
        if (!lane) return;
        const empty = lane.clips.findIndex((c) => c == null);
        const idx = empty >= 0 ? empty : lane.clips.length;
        lane.clips[idx] = clip;
        this.renderWithMixer();
      },
    });

    // Per-lane NOTE FX panel — mounted next to MODULATORS (which buildParamUI
    // rendered into `host`). Drum lanes are not note-transformed, so skip them.
    if (engine.id !== 'drums-machine') {
      const nfHost = document.createElement('div');
      nfHost.className = 'lane-notefx-panel-host';
      host.appendChild(nfHost);
      renderNoteFxPanel(nfHost, {
        laneId,
        chain: getNoteFxChain(laneId),
        onChange: (noteFx) => syncNoteFx(this.state, laneId, noteFx),
        historyDeps: this.deps.historyDeps,
      });
    }

    // Phase H: mount the insert-chain panel below the engine controls.
    // Every active lane has an InsertChain (allocated in ensureLaneResource)
    // so there is no boot-lane special case.
    this.inspector.mountLaneInserts(laneId, host);

    // Populate the correct preset dropdown for each page type.
    // The poly page's #poly-preset-select is populated here for ALL poly-engine
    // lanes (subtractive, fm, wavetable, karplus). For subtractive, the existing
    // showPolyEditor → rebuildEngineParamUI path also populates it (harmless
    // double call). For FM/Wavetable/Karplus, showPolyEditor is NOT called so
    // without this call those engines would show stale Subtractive presets.
    if (targetTab === 'poly') {
      populatePolyPresetSelectForLane(laneId);
      refreshPolyPresetSelect();
    }
    if (targetTab === '303') mountBassPresetSelect(laneId);
    if (targetTab === 'drums') mountDrumsPresetSelect(laneId);
  }

  // ── Render tick (rAF loop that re-renders when play state changes) ─────────

  private startRenderTick(): void {
    let lastSig = '';
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.inspector.roll) this.inspector.roll.redraw();
      const sigParts: string[] = [];
      for (const lp of this.laneStates.values()) {
        sigParts.push(`${lp.laneId}:${lp.playing?.id ?? '-'}:${lp.queued?.id ?? '-'}`);
      }
      const next = sigParts.sort().join('|');
      if (next !== lastSig) { lastSig = next; this.renderWithMixer(); }
    };
    requestAnimationFrame(loop);
  }
}
