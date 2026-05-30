// SessionHost: owns all Session-view state + DOM wiring.
// main.ts constructs this after the audio graph and trigger functions are ready,
// then calls sessionHost.init() to activate it.

import type { ChannelStrip } from '../core/fx';
import type { DrumVoice } from '../core/drums';
import type { PatternBank } from '../core/pattern';
import type { PolySynth } from '../polysynth/polysynth';
import type { Sequencer } from '../core/sequencer';
import type { MixerColumnDeps } from '../core/mixer';
import {
  emptySessionState, cloneSessionState, emptyLane, emptyClip,
  moveClip, copyClip,
  type SessionState, type SessionClip, type ClipSlot,
} from './session';

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

export interface SessionHostDeps {
  ctx: AudioContext;
  seq: Sequencer;
  bank: PatternBank;
  playBtn: HTMLButtonElement;
  resetAutomationPosition: () => void;
  /** Single per-lane trigger entry — encapsulates engineId dispatch +
   *  laneResources lookup. Replaces the old bassTriggerDirect /
   *  bassTriggerForArp / polyTriggerDirect trio. */
  triggerForLane: (laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => void;
  // Phase G: drums removed — triggerForLane now routes drums-machine via
  // res.engine.createVoice() like every other engine.
  drumLanes: readonly DrumVoice[];
  markTrackActive: (trackId: string, time: number) => void;
  ensureExtraPoly: (id: string) => PolySynth;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  getLaneEngineId: (laneId: string) => string;
  ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
  showPolyEditor: (laneId: string, target: PolySynth, displayName: string) => void;
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
  /** Apply a preset to a lane by name. Called by applyLoadedSessionState
   *  for every lane.enginePresetName, and by onLaunchScene for every
   *  scene.presetPerLane entry. Optional so test fixtures without audio
   *  can skip it. */
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

  /** Wire historyDeps into the inspector after construction.
   *  historyDeps closes over saveWiringDeps which closes over sessionHost,
   *  so it can only be built after sessionHost.init() returns. */
  setHistoryDeps(hd: import('../save/history-wiring').HistoryDeps): void {
    this.deps.historyDeps = hd;
    this.inspector?.setHistoryDeps(hd);
  }

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
    });

    this.deps.seq.sessionTick = (now, look) => {
      tickSession(
        this.laneStates, this.state, now, look, this.deps.seq.bpm,
        (laneId, midi, scheduleTime, gateSec, accent, slidingIn) =>
          this.deps.triggerForLane(laneId, midi, scheduleTime, gateSec, accent, slidingIn),
        (laneId, _clipId, _stepInClip, stepTime) =>
          this.deps.markTrackActive(laneId, stepTime),
        this.deps.recHooks,
      );
      if (this.deps.onAfterTick) this.deps.onAfterTick(now, look);
    };

    this.buildCallbacks();
    this.wireToolbar();
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
      this.deps.ensureLaneResource?.(lane.id, lane.engineId);
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
    this._fireStateApplied();
  }

  private collectEngineState(): void {
    for (const lane of this.state.lanes) {
      const engine = this.deps.laneResources?.get(lane.id)?.engine;
      const host = (engine as { modulators?: { serialize(): unknown[] } } | undefined)?.modulators;
      if (host) {
        lane.engineState = {
          modulators: host.serialize() as import('../modulation/types').ModulatorState[],
        };
      }
    }
  }

  private applyEngineState(): void {
    for (const lane of this.state.lanes) {
      const engine = this.deps.laneResources?.get(lane.id)?.engine;
      if (!engine) continue;
      // Apply per-param values (bus sends, EQ, etc.) from engineState.params.
      const params = lane.engineState?.params;
      if (params) {
        for (const [id, v] of Object.entries(params)) {
          if (typeof v === 'number') engine.setBaseValue(id, v);
        }
      }
      // Restore modulator state.
      const mods = lane.engineState?.modulators;
      if (mods) {
        const host = (engine as { modulators?: { deserialize(s: unknown[]): void } } | undefined)?.modulators;
        if (host) host.deserialize(mods);
      }
    }
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
    });
  }

  // ── Callbacks ────────────────────────────────────────────────────────────

  private buildCallbacks(): void {
    const self = this;
    const { ctx, seq, playBtn, resetAutomationPosition,
            showPolyEditor } = this.deps;

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
          playBtn.textContent = '■';
        } else {
          launchClip(self.laneStates, self.state, lane, clip, ctx.currentTime, seq.bpm,
            self.deps.recHooks);
        }
        self.renderWithMixer();
      },
      onCellClick(laneId, clipIdx) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane) return;
        const hd = self.deps.historyDeps;
        const run = () => {
          const defaultLen = Math.max(1, Math.floor(seq.length / 16));
          const clip: SessionClip = emptyClip(defaultLen);
          while (lane.clips.length <= clipIdx) lane.clips.push(null);
          lane.clips[clipIdx] = clip;
          self.inspector.setSelectedClip({ laneId, clipIdx });
          self.inspector.openInspector();
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
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
        if (scene.presetPerLane) {
          for (const [laneId, presetName] of Object.entries(scene.presetPerLane)) {
            self.deps.applyPresetForLane?.(laneId, presetName);
          }
        }
        if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
        self.renderWithMixer();
      },
      onStopAll() { stopAll(self.laneStates); self.renderWithMixer(); },
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
          const defaultLen = Math.max(1, Math.floor(seq.length / 16));
          for (let r = 0; r < rowCount; r++) {
            lane.clips.push(emptyClip(defaultLen));
          }
          self.state.lanes.push(lane);
          self.laneStates.set(newId, emptyLanePlayState(newId));

          // Allocate a fresh ChannelStrip + engine instance for the new lane so
          // triggerForLane can find it via laneResources immediately.
          self.deps.ensureLaneResource?.(newId, engineId);

          self.renderWithMixer();
        };
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

        const lane = self.state.lanes.find((l) => l.id === laneId);

        let polyTarget: PolySynth | null = null;
        if (lane?.engineId === 'subtractive') {
          // Each subtractive lane owns its PolySynth instance — reach it via
          // the engine stored in laneResources.
          const engine = self.deps.laneResources?.get(laneId)?.engine;
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
          showPolyEditor(laneId, polyTarget, displayName);
        } else {
          document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
            p.hidden = p.dataset.page !== targetTab;
          });
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
        self.activeEditLane = laneId;
        self.injectEngineModulatorPanel(laneId, targetTab);
        self.deps.onActiveLaneChanged?.();
      },
      onToggleDrumsExpanded() { /* drum-bus expand removed — drum-grid editor shows all voices */ },
    };
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
      const anchor = page.querySelector<HTMLElement>('#poly-seq-mode-row');
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
    });

    // Phase H: mount the insert-chain panel below the engine controls.
    // Every active lane has an InsertChain (allocated in ensureLaneResource)
    // so there is no boot-lane special case.
    this.inspector.mountLaneInserts(laneId, host);
  }

  // ── Toolbar wiring ─────────────────────────────────────────────────────────

  private wireToolbar(): void {
    document.getElementById('session-launch-scene-1')!.addEventListener('click',
      () => this.callbacks.onLaunchScene(0));
    document.getElementById('session-stop-all')!.addEventListener('click',
      () => this.callbacks.onStopAll());
    // Lane creation moved into the dynamic tab bar (renderSessionTabBar); the
    // duplicate '#session-add-engine' / '#session-add-lane' controls have been
    // removed from the toolbar markup.
  }

  // ── Render tick (rAF loop that re-renders when play state changes) ─────────

  private startRenderTick(): void {
    let lastSig = '';
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.inspector.roll) this.inspector.roll.redraw();
      this.updateEditorPlayhead();
      const sigParts: string[] = [];
      for (const lp of this.laneStates.values()) {
        sigParts.push(`${lp.laneId}:${lp.playing?.id ?? '-'}:${lp.queued?.id ?? '-'}`);
      }
      const next = sigParts.sort().join('|');
      if (next !== lastSig) { lastSig = next; this.renderWithMixer(); }
    };
    requestAnimationFrame(loop);
  }

  private updateEditorPlayhead(): void {
    const host = document.getElementById('insp-roll-host');
    if (!host) return;
    const sel = this.inspector.getSelectedClip();
    const lane = sel ? this.state.lanes.find((l) => l.id === sel.laneId) : null;
    const clip = lane && sel ? lane.clips[sel.clipIdx] : null;
    const lp = lane ? this.laneStates.get(lane.id) : null;
    const playing = !!(lp && clip && lp.playing && lp.playing.id === clip.id);

    if (!playing || !clip) {
      host.querySelectorAll('.step-playhead').forEach((el) => el.classList.remove('step-playhead'));
      return;
    }
    const stepDur = 60 / this.deps.seq.bpm / 4;
    const stepsElapsed = Math.max(0, (this.deps.ctx.currentTime - lp!.startTime) / stepDur);
    const clipSteps = clip.lengthBars * 16;
    const curStep = Math.floor(stepsElapsed) % clipSteps;
    host.querySelectorAll<HTMLElement>('.cells').forEach((cellsEl) => {
      const kids = cellsEl.children;
      for (let i = 0; i < kids.length; i++) {
        kids[i].classList.toggle('step-playhead', i === curStep);
      }
    });
  }
}
