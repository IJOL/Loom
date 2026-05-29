// SessionHost: owns all Session-view state + DOM wiring.
// main.ts constructs this after the audio graph and trigger functions are ready,
// then calls sessionHost.init() to activate it.

import type { ChannelStrip } from '../core/fx';
import type { DrumMachine, DrumVoice } from '../core/drums';
import type { PatternBank } from '../core/pattern';
import type { PolySynth } from '../polysynth/polysynth';
import type { Sequencer } from '../core/sequencer';
import type { MixerColumnDeps } from '../core/mixer';
import {
  emptySessionState, cloneSessionState, emptyLane,
  type SessionState, type SessionClip,
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
import { importClassicToSession, migrateLoadedSessionState } from './session-migration';
import { getEngine } from '../engines/registry';
import { renderSessionGrid, type SessionUICallbacks } from './session-ui';
import { renderSessionTabBar } from './session-tab-bar';
import { buildMixerColumn } from '../core/mixer';
// session-step-scheduler is superseded by the note-based tickLane path (Phase D.3).
import { SessionInspector } from './session-inspector';
import { withUndo } from '../save/history-wiring';

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
  drums: DrumMachine;
  drumLanes: readonly DrumVoice[];
  markTrackActive: (trackId: string, time: number) => void;
  ensureExtraPoly: (id: string) => PolySynth;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  getLaneEngineId: (laneId: string) => string;
  ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
  showPolyEditor: (laneId: string, target: PolySynth, displayName: string) => void;
  polysynth: PolySynth;
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
}

export class SessionHost {
  state: SessionState = emptySessionState();
  laneStates = new Map<string, LanePlayState>();
  private inspector!: SessionInspector;
  private callbacks!: SessionUICallbacks;
  activeEditLane: string | null = null;

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
    });

    this.deps.seq.sessionTick = (now, look) => {
      tickSession(
        this.laneStates, this.state, now, look, this.deps.seq.bpm,
        (laneId, midi, scheduleTime, gateSec, accent, slidingIn) =>
          this.deps.triggerForLane(laneId, midi, scheduleTime, gateSec, accent, slidingIn),
        (laneId, _clipId, _stepInClip, stepTime) =>
          this.deps.markTrackActive(laneId, stepTime),
      );
    };

    this.buildCallbacks();
    this.wireToolbar();
    this.refreshSynthTabs();
    this.startRenderTick();
    this.renderWithMixer();
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
    this.laneStates.clear();
    for (const lane of this.state.lanes) {
      this.laneStates.set(lane.id, emptyLanePlayState(lane.id));
      // Every lane needs an audio resource (strip + engine instance) — without
      // it, triggerForLane finds nothing and automation knobs never get
      // registered under the lane's id. Built-in lanes are pre-allocated at
      // boot; lanes that arrive via loaded state (demos, save files) are
      // allocated lazily here.
      this.deps.ensureLaneResource?.(lane.id, lane.engineId);
      if (lane.enginePresetName) {
        this.deps.applyPresetForLane?.(lane.id, lane.enginePresetName);
      }
    }
    this.applyEngineState();
    this.renderWithMixer();
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
      const mods = lane.engineState?.modulators;
      if (!mods) continue;
      const engine = this.deps.laneResources?.get(lane.id)?.engine;
      const host = (engine as { modulators?: { deserialize(s: unknown[]): void } } | undefined)?.modulators;
      if (host) host.deserialize(mods);
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
            showPolyEditor,
            polysynth } = this.deps;

    this.callbacks = {
      onClipClick(laneId, clipIdx) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        const clip = lane?.clips[clipIdx];
        if (!lane || !clip) return;
        self.inspector.setSelectedClip({ laneId, clipIdx });
        self.inspector.openInspector();
        void ctx.resume();
        launchClip(self.laneStates, self.state, lane, clip, ctx.currentTime, seq.bpm);
        if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
        self.renderWithMixer();
      },
      onCellClick(laneId, clipIdx) {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane) return;
        const hd = self.deps.historyDeps;
        const run = () => {
          const defaultLen = Math.max(1, Math.floor(seq.length / 16));
          const clip: SessionClip = {
            id: `clip-${Date.now().toString(36)}`,
            lengthBars: defaultLen,
            notes: [],
          };
          while (lane.clips.length <= clipIdx) lane.clips.push(null);
          lane.clips[clipIdx] = clip;
          self.inspector.setSelectedClip({ laneId, clipIdx });
          self.inspector.openInspector();
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
      onStopLane(laneId) { stopLane(self.laneStates, laneId); self.renderWithMixer(); },
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
          for (let r = 0; r < rowCount; r++) {
            lane.clips.push({
              id: `clip-${Date.now().toString(36)}-${r}`,
              lengthBars: Math.max(1, Math.floor(seq.length / 16)),
              notes: [],
            });
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
    });
  }

  // ── Toolbar wiring ─────────────────────────────────────────────────────────

  private wireToolbar(): void {
    document.getElementById('session-import-classic')!.addEventListener('click', () => {
      const fresh = importClassicToSession(this.deps.bank);
      this.state.lanes = fresh.lanes;
      this.state.scenes = fresh.scenes;
      this.state.globalQuantize = fresh.globalQuantize;
      this.laneStates.clear();
      for (const lane of this.state.lanes) {
        this.laneStates.set(lane.id, emptyLanePlayState(lane.id));
      }
      this.renderWithMixer();
    });
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
