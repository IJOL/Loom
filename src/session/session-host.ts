// SessionHost: owns all Session-view state + DOM wiring.
// main.ts constructs this after the audio graph and trigger functions are ready,
// then calls sessionHost.init() to activate it.

import type { SessionHostDeps } from './session-host-deps';
import { ensureScenesForRows } from '../core/scene-ensure';
import {
  emptySessionState, cloneSessionState, emptyLane, emptyClip, emptyScene,
  type SessionState, type SessionClip, type SessionLane,
} from './session';
import { buildSliceClip } from '../core/slice-clip';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';

// nextLaneSlug lives in session-host-util (shared with the extracted sub-modules).
// Re-exported here so existing importers (e.g. session-add-lane.test) keep working.
export { nextLaneSlug } from './session-host-util';
import { nextLaneSlug } from './session-host-util';
import {
  tickSession, launchClip, launchScene, stopAll,
  emptyLanePlayState,
  type LanePlayState,
} from './session-runtime';
import { renderSessionGrid, type SessionUICallbacks } from './session-ui';
import { buildSessionCallbacks } from './session-host-callbacks';
import {
  addAudioChannel as addAudioChannelImpl,
  loadAudioFileIntoCell as loadAudioFileIntoCellImpl,
  importLoopToSampler as importLoopToSamplerImpl,
} from './session-host-audio-import';
import { applyDrumPreset as applyDrumPresetImpl } from './session-host-presets';
import {
  showLaneEditor as showLaneEditorImpl,
  injectEngineModulatorPanel as injectEngineModulatorPanelImpl,
} from './session-host-lane-editor';
import {
  applyLoadedSessionState as applyLoadedSessionStateImpl,
  collectEngineState as collectEngineStateImpl,
  applyEngineState as applyEngineStateImpl,
} from './session-host-persistence';
import { renderSessionTabBar } from './session-tab-bar';
import { buildMixerColumn } from '../core/mixer';
import { buildMasterStrip } from '../core/master-strip';
// session-step-scheduler is superseded by the note-based tickLane path (Phase D.3).
import { SessionInspector } from './session-inspector';
import { withUndo } from '../save/history-wiring';

export type { SessionHostDeps } from './session-host-deps';

export class SessionHost {
  state: SessionState = emptySessionState();
  laneStates = new Map<string, LanePlayState>();
  /** @internal — accessed by the extracted session-host-* sub-modules. */
  inspector!: SessionInspector;
  /** @internal — accessed by the extracted session-host-* sub-modules. */
  callbacks!: SessionUICallbacks;
  activeEditLane: string | null = null;
  /** UI-only flag (NOT serialized): whether the #master-fx-panel under the
   *  grid+inspector is expanded. Toggled by the master strip's FX button via
   *  toggleMasterFx(). Lives alongside activeEditLane (also UI-only). */
  masterFxOpen = false;

  // VU-meter teardown channel: every mixer column / master strip that mounts a
  // level meter registers its dispose() handle here. renderWithMixer disposes
  // and clears the list before it wipes the row (row.innerHTML = ''), so the
  // RAF + retained analyser of the previous render don't leak. Created here
  // because no such channel existed before; without it every re-render of the
  // mixer row (one per play-state change) leaked a meter.
  private mixerDisposables: { dispose(): void }[] = [];
  /** Register a VU-meter (or other per-render) dispose handle so the next
   *  renderWithMixer tears it down before rebuilding the mixer row. */
  registerMixerDisposable(d: { dispose(): void }): void {
    this.mixerDisposables.push(d);
  }

  /** Toggle the Master FX panel open/closed. Reflects the flag into the DOM
   *  (#master-fx-panel.hidden + .master-fx-toggle.active) WITHOUT a full
   *  re-render — renderWithMixer re-applies masterFxOpen so the panel survives
   *  the play-state re-renders. */
  toggleMasterFx(): void {
    this.masterFxOpen = !this.masterFxOpen;
    const panel = document.getElementById('master-fx-panel');
    if (panel) (panel as HTMLElement).hidden = !this.masterFxOpen;
    const btn = document.querySelector('.master-fx-toggle');
    if (btn) btn.classList.toggle('active', this.masterFxOpen);
  }

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
  /** @internal — accessed by the extracted session-host-* sub-modules. */
  _fireStateApplied(): void {
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
    stopAll(this.laneStates, this.deps.liveVoices, this.deps.ctx.currentTime);
    this.renderWithMixer();
  }

  /** Append a scene capturing the currently-playing clips. Wired to the toolbar
   *  button and the Ctrl+I hotkey; same path as the Scenes-header button. */
  captureScene(): void {
    this.callbacks.onCaptureScene();
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

  /** Wire the audio→notes loop transcriber into the inspector after construction
   *  (the closure needs both the stem client and this host, built later). */
  setTranscribeLoop(fn: (clip: SessionClip, kind: 'melodic' | 'drums') => void | Promise<void>): void {
    this._transcribeLoop = fn;
    this.inspector?.setTranscribeLoop(fn);
  }
  private _transcribeLoop?: (clip: SessionClip, kind: 'melodic' | 'drums') => void | Promise<void>;

  constructor(public readonly deps: SessionHostDeps) {}

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
      triggerForLane: this.deps.triggerForLane,
      addNoteLane: (engineId, notes, lengthBars, name) => this.addNoteLane(engineId, notes, lengthBars, name),
      transcribeLoop: this._transcribeLoop,
      placeChordClip: (laneId, clipIdx, clip) => {
        const hd = this.deps.historyDeps;
        const run = () => {
          this.placeClipEnsuringScene(laneId, clipIdx, clip);
          this.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
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

    // Front D · Task 13 — the Sampler's "Importar loop…" control dispatches this
    // event (it has no direct host reference); the host owns the loop slice flow
    // + the `installSamplerClip` seam, so it runs the import on the named lane.
    document.addEventListener('loom:import-loop', (e) => {
      const detail = (e as CustomEvent<{ laneId: string; file: File }>).detail;
      if (detail?.laneId && detail.file) this.importLoopToSampler(detail.laneId, detail.file);
    });

    // A sampler channel's ▶ play button auditions its pad through the lane's audio
    // path (the engine has no triggerForLane handle, so it asks via this event).
    document.addEventListener('loom:audition-note', (e) => {
      const d = (e as CustomEvent<{ laneId: string; note: number }>).detail;
      if (!d?.laneId || typeof d.note !== 'number') return;
      void this.deps.ctx.resume();
      this.deps.triggerForLane(d.laneId, d.note, this.deps.ctx.currentTime, 0.4, false, false);
    });

    // Selecting a bundled LOOP preset loads its slice bank (the engine does that),
    // then asks the host to materialise the playable note clip — one note per slice,
    // ascending — so the loop actually plays. (This was the missing "loop preset that
    // never played" piece.)
    document.addEventListener('loom:loop-loaded', (e) => {
      const d = (e as CustomEvent<{ laneId: string; slicePointsSec: number[]; durationSec: number; originalBpm: number; loopSampleId?: string }>).detail;
      const lane = d && this.state.lanes.find((l) => l.id === d.laneId);
      if (!d || !lane || lane.engineId !== 'sampler') return;
      const built = buildSliceClip({
        slicePointsSec: d.slicePointsSec, durationSec: d.durationSec,
        originalBpm: d.originalBpm, projectMeter: this.deps.seq.meter,
        gridResolution: DEFAULT_RESOLUTION,
      });
      this.installSamplerClip(d.laneId, {
        id: `clip-${Date.now().toString(36)}`,
        name: `${lane.name ?? 'Loop'} loop`,
        lengthBars: built.lengthBars,
        notes: built.notes,
        gridResolution: DEFAULT_RESOLUTION,
        // Display-only waveform header, parity with the user-import path (and
        // what reloadInstrument's self-heal re-points on session reload).
        ...(d.loopSampleId ? { waveformRef: { sampleId: d.loopSampleId, slices: built.slices } } : {}),
      });
      // Conform the project tempo to the loop's own bpm so the sliced REX loop
      // plays back seamlessly without a manual BPM change (the slices re-grid at
      // any other tempo, REX-style). Robust to octave guesses: lengthBars + bpm
      // come from the same originalBpm, so the clip period always matches the loop.
      if (d.originalBpm > 0) this.deps.applyBpm?.(d.originalBpm);
    });
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
    collectEngineStateImpl(this);
    return cloneSessionState(this.state);
  }

  /** Replace the session with a loaded/migrated SessionState (lane allocation +
   *  insert/engine rehydration). Impl in session-host-persistence. */
  applyLoadedSessionState(sess: SessionState): void {
    applyLoadedSessionStateImpl(this, sess);
  }

  /** @internal — push persisted engine state onto live engines (load path).
   *  Kept as a method because tests drive it directly. Impl in session-host-persistence. */
  applyEngineState(): void {
    applyEngineStateImpl(this);
  }

  /** Live drums-page preset pick (ctx-aware). Synth kits go through the engine's
   *  sync applyPreset; sample kits decode the bundled drumkit into the embedded
   *  sampler. Impl (with reloadDrumkit/reloadInstrument) in session-host-presets. */
  applyDrumPreset(laneId: string, name: string): Promise<void> {
    return applyDrumPresetImpl(this, laneId, name);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const hostEl = document.getElementById('session-grid');
    if (!hostEl) return;
    // Ring the clip currently open in the inspector (only while its panel is shown).
    const panel = document.getElementById('session-inspector');
    const openClip = (panel && !panel.hidden)
      ? (this.inspector.getSelectedClip() ?? undefined)
      : undefined;
    renderSessionGrid(hostEl, this.state, this.laneStates, this.callbacks, openClip);
    this.inspector.refreshContext();
  }

  renderWithMixer(): void {
    this.render();
    this.refreshSynthTabs();
    const row = this.callbacks?._mixerRow;
    if (!row) return;
    // Tear down the previous render's VU meters (RAF + retained analyser)
    // before wiping the row, so they don't leak across re-renders.
    for (const d of this.mixerDisposables) d.dispose();
    this.mixerDisposables = [];
    row.innerHTML = '';
    const sp = document.createElement('div');
    sp.className = 'session-spacer';
    row.appendChild(sp);
    for (const lane of this.state.lanes) {
      row.appendChild(buildMixerColumn(lane.id, this.deps.mixerDeps));
    }
    // Last (scenes) column: the master strip when an audio graph is wired,
    // else the old spacer (test fixtures without audio omit volInput/analyser).
    if (this.deps.volInput && this.deps.masterMeterAnalyser && this.deps.masterStrip) {
      row.appendChild(buildMasterStrip({
        volInput: this.deps.volInput,
        masterMeterAnalyser: this.deps.masterMeterAnalyser,
        masterStrip: this.deps.masterStrip,
        isFxOpen: () => this.masterFxOpen,
        onToggleFx: () => this.toggleMasterFx(),
        historyDeps: this.deps.historyDeps,
        registerDisposable: (d) => this.registerMixerDisposable(d),
      }));
    } else {
      const sp2 = document.createElement('div');
      sp2.className = 'session-spacer';
      row.appendChild(sp2);
    }
    // Re-apply the (non-serialized) Master FX open flag to the panel so it
    // survives the play-state re-renders that rebuild the mixer row.
    const mfPanel = document.getElementById('master-fx-panel');
    if (mfPanel) (mfPanel as HTMLElement).hidden = !this.masterFxOpen;
  }

  /** Repaint EVERY state-dependent view after an undo/redo so the change is
   *  visible wherever the user is: the grid + mixer, the open clip editor, and
   *  the active lane editor (knobs/labels/preset). */
  refreshAfterRestore(): void {
    this.renderWithMixer();
    this.inspector.refreshOpenEditor();
    if (this.activeEditLane) this.showLaneEditor(this.activeEditLane);
  }

  /** @internal — accessed by the extracted session-host-* sub-modules. */
  refreshSynthTabs(): void {
    const host = document.getElementById('synth-tabs');
    if (!host) return;
    renderSessionTabBar(host, {
      state: this.state,
      onPickLane: (laneId) => this.callbacks.onEditLane(laneId),
      onAddLane:  (engineId) => this.callbacks.onAddLane(engineId),
      onAddAudioChannel: () => this.callbacks.onAddAudioChannel?.(),
    });
  }

  /** Public entry for the Stems dialog: create one audio lane per separated
   *  stem (delegates to the undoable callbacks impl). With `opts.replace` the
   *  whole session is swapped for a clean stems-only one. */
  addStemLanes(
    stems: { label: string; sampleId: string; durationSec: number; warpRef?: boolean }[],
    opts: { replace?: boolean; anchorSec?: number; warpMarkers?: import('./session').WarpMarker[]; warpGroupId?: string } = {},
  ): void {
    this.callbacks.onAddStemLanes(stems, opts);
  }

  /** Transcription lanes (stems / loop) are launched in their OWN scene, kept
   *  apart from the audio stems so you can A/B audio vs the transcribed notes.
   *  Holds the current batch's scene id; reset per batch (see resetTranscriptionScene)
   *  so each separation/loop gets a fresh scene. */
  private _transcriptionSceneId: string | null = null;

  /** Start a fresh transcription scene for the next batch of addNoteLane calls. */
  resetTranscriptionScene(): void { this._transcriptionSceneId = null; }

  /** Place a transcribed lane's clip in the dedicated 'Transcription' scene
   *  (creating it on first use). The clip goes at the scene's ROW index so the
   *  grid shows it IN that scene (earlier rows are empty cells), and the lane is
   *  mapped to play ONLY in the transcription scene — otherwise scene 0 would
   *  default-launch a row-0 clip (Ableton fallback). */
  private placeTranscriptionLane(lane: SessionLane, clip: SessionClip): void {
    let scene = this._transcriptionSceneId
      ? this.state.scenes.find((s) => s.id === this._transcriptionSceneId)
      : undefined;
    if (!scene) {
      scene = emptyScene('Transcription');
      this.state.scenes.push(scene);
      this._transcriptionSceneId = scene.id;
    }
    const sceneIdx = this.state.scenes.indexOf(scene);
    const clips: (SessionClip | null)[] = [];
    for (let i = 0; i < sceneIdx; i++) clips.push(null); // empty cells in earlier scene rows
    clips.push(clip);
    lane.clips = clips;
    for (const s of this.state.scenes) s.clipPerLane[lane.id] = (s === scene) ? sceneIdx : null;
  }

  /** Create one new lane (melodic or drums) holding a clip of transcribed notes,
   *  as a single undoable action. Used by the "🎵 Notes" transcription flow.
   *  `opts.newScene` launches it in a separate 'Transcription' scene instead of
   *  alongside the stems (used by the stem + loop transcription flows). */
  addNoteLane(
    engineId: string,
    notes: import('../core/notes').NoteEvent[],
    lengthBars: number,
    name: string,
    opts: { newScene?: boolean } = {},
  ): void {
    const hd = this.deps.historyDeps;
    const run = () => {
      const used = new Set(this.state.lanes.map((l) => l.id));
      const newId = nextLaneSlug(used, engineId);
      const lane = emptyLane(newId, engineId);
      lane.name = name;
      const clip = emptyClip(Math.max(1, lengthBars));
      clip.notes = notes;
      clip.name = name;
      this.state.lanes.push(lane);
      this.laneStates.set(newId, emptyLanePlayState(newId));
      this.deps.ensureLaneResource?.(newId, engineId);
      if (opts.newScene) {
        // Land in (and only in) a separate 'Transcription' scene, at its own row.
        this.placeTranscriptionLane(lane, clip);
      } else {
        lane.clips = [clip]; // born with just the note clip; no empty filler
        // Only creation path that historically skipped this — seed a launchable scene.
        ensureScenesForRows(this.state);
        // Launch alongside scene 0 (the stems scene) when one exists.
        if (this.state.scenes[0]) this.state.scenes[0].clipPerLane[newId] = 0;
      }
      this.renderWithMixer();
    };
    if (hd) withUndo(hd, run); else run();
  }

  /** Create a new dedicated 'audio' channel/lane holding the given file as a
   *  single clip. Public so the live-take recorder can drop a finished take
   *  straight into a fresh audio channel. Impl in session-host-audio-import. */
  addAudioChannel(file: File, opts?: { knownBpm?: number }): void {
    addAudioChannelImpl(this, file, opts);
  }

  /** Load a WAV into a specific cell of a sampler/audio lane (drop or, for
   *  audio channels, the cell-click file picker). Impl in session-host-audio-import. */
  loadAudioFileIntoCell(laneId: string, clipIdx: number, file: File): void {
    loadAudioFileIntoCellImpl(this, laneId, clipIdx, file);
  }

  /** Front D · Task 13 — import a loop WAV into the EXISTING sampler lane
   *  (slice → keymap → note clip). Impl in session-host-audio-import. */
  importLoopToSampler(laneId: string, file: File): void {
    importLoopToSamplerImpl(this, laneId, file);
  }

  // ── Callbacks ────────────────────────────────────────────────────────────

  private buildCallbacks(): void {
    this.callbacks = buildSessionCallbacks(this);
  }

  /** Place a clip at a specific row, growing the lane's clip array with nulls as
   *  needed, then guarantee the grid has a launchable scene for that row. The
   *  single seam every clip-placement path funnels through — without the
   *  ensureScenesForRows call a clip in a fresh row would render with NO ▶
   *  (that was the "▶ missing after inserting a clip" bug). */
  /** @internal — accessed by the extracted session-host-* sub-modules. */
  placeClipEnsuringScene(laneId: string, clipIdx: number, clip: SessionClip): void {
    const lane = this.state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    while (lane.clips.length <= clipIdx) lane.clips.push(null);
    lane.clips[clipIdx] = clip;
    ensureScenesForRows(this.state);
  }

  /** Public seam (front D · Sampler): drop a freshly-built clip onto the lane's
   *  first empty slot (or append), select it, and open the inspector — as one
   *  undoable action. Replaces the removed `EngineUIContext.installClip`. */
  installSamplerClip(laneId: string, clip: SessionClip): void {
    const lane = this.state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    const empty = lane.clips.findIndex((c) => c == null);
    const idx = empty >= 0 ? empty : lane.clips.length;
    const hd = this.deps.historyDeps;
    const run = () => {
      this.placeClipEnsuringScene(laneId, idx, clip);
      this.inspector.setSelectedClip({ laneId, clipIdx: idx });
      this.inspector.openInspector();
      this.renderWithMixer();
    };
    if (hd) withUndo(hd, run); else run();
  }

  /** Show a lane's editor: route to its engine's page (poly / 303 / drums),
   *  rebuild the engine param UI + modulator panel + labels. Does NOT toggle.
   *  Impl in session-host-lane-editor. */
  showLaneEditor(laneId: string): void {
    showLaneEditorImpl(this, laneId);
  }

  /** @internal — inject a lane's engine param UI + modulator/note-FX/insert
   *  panels + preset dropdowns into its page. Impl in session-host-lane-editor. */
  injectEngineModulatorPanel(laneId: string, targetTab: string): void {
    injectEngineModulatorPanelImpl(this, laneId, targetTab);
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
      if (next !== lastSig) {
        // Defer the grid rebuild while a track/scene is being renamed inline —
        // renderWithMixer() does host.innerHTML='' and would destroy the open
        // rename input mid-edit. Leave lastSig stale so the NEXT tick re-renders
        // once the edit commits/cancels and the input is gone.
        const renaming = document.activeElement?.classList.contains('inline-rename-input');
        if (!renaming) { lastSig = next; this.renderWithMixer(); }
      }
    };
    requestAnimationFrame(loop);
  }
}
