// SessionHost: owns all Session-view state + DOM wiring.
// main.ts constructs this after the audio graph and trigger functions are ready,
// then calls sessionHost.init() to activate it.

import type { ChannelStrip } from '../core/fx';
import type { DrumMachine, DrumVoice } from '../core/drums';
import type { PatternBank } from '../core/pattern';
import type { PolySynth } from '../polysynth/polysynth';
import type { Sequencer } from '../core/sequencer';
import type { SynthEngine } from '../engines/engine-types';
import type { MixerColumnDeps } from '../core/mixer';
import {
  emptySessionState, cloneSessionState, emptyLane,
  type SessionState, type SessionClip,
} from './session';
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
import { scheduleClipStep } from './session-step-scheduler';
import { SessionInspector } from './session-inspector';

export interface SessionHostDeps {
  ctx: AudioContext;
  seq: Sequencer;
  bank: PatternBank;
  playBtn: HTMLButtonElement;
  resetAutomationPosition: () => void;
  bassTriggerDirect: (note: number, time: number, dur: number, accent: boolean, slidingIn: boolean) => void;
  bassTriggerForArp: (note: number, time: number, gate: number, accent: boolean) => void;
  polyTriggerDirect: (note: number, time: number, gate: number, accent: boolean) => void;
  drums: DrumMachine;
  drumLanes: readonly DrumVoice[];
  markTrackActive: (trackId: string, time: number) => void;
  ensureExtraPoly: (id: string) => PolySynth;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  getLaneEngineId: (laneId: string) => string;
  ensureLaneEngine: (laneId: string, engineId: string) => SynthEngine | null;
  ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
  showPolyEditor: (laneId: string, target: PolySynth, displayName: string) => void;
  polysynth: PolySynth;
  mixerDeps: MixerColumnDeps;
  getAppMode: () => 'classic' | 'session';
  midiLabel: (m: number) => string;
  automationRegistry: Map<string, import('../core/knob').KnobHandle>;
  getAutoAbsSubIdx: () => number;
  onActiveLaneChanged?: () => void;
}

export class SessionHost {
  state: SessionState = emptySessionState();
  laneStates = new Map<string, LanePlayState>();
  private inspector!: SessionInspector;
  private callbacks!: SessionUICallbacks;
  activeEditLane: string | null = null;

  // Expose inspector roll for the automation tick in main.ts
  get inspectorRoll() { return this.inspector?.roll ?? null; }

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
    });

    this.deps.seq.sessionTick = (now, look) => {
      tickSession(
        this.laneStates, this.state, now, look, this.deps.seq.bpm,
        (laneId, clip, stepInClip, stepTime, stepDur) =>
          scheduleClipStep(
            {
              ctx: this.deps.ctx,
              state: this.state,
              drums: this.deps.drums,
              drumLanes: this.deps.drumLanes,
              bpm: () => this.deps.seq.bpm,
              bassTriggerDirect: this.deps.bassTriggerDirect,
              bassTriggerForArp: this.deps.bassTriggerForArp,
              polyTriggerDirect: this.deps.polyTriggerDirect,
              markTrackActive: this.deps.markTrackActive,
              ensureExtraPoly: this.deps.ensureExtraPoly,
              extraStrips: this.deps.extraStrips,
              getLaneEngineId: this.deps.getLaneEngineId,
              ensureLaneEngine: this.deps.ensureLaneEngine,
              ensureLaneVoice: this.deps.ensureLaneVoice,
            },
            laneId, clip, stepInClip, stepTime, stepDur,
          ),
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
    }
    this.applyEngineState();
    this.renderWithMixer();
  }

  private collectEngineState(): void {
    for (const lane of this.state.lanes) {
      const engine = this.deps.ensureLaneEngine?.(lane.id, lane.engineId);
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
      const engine = this.deps.ensureLaneEngine?.(lane.id, lane.engineId);
      const host = (engine as { modulators?: { deserialize(s: unknown[]): void } } | undefined)?.modulators;
      if (host) host.deserialize(mods);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private laneToTrackId(laneId: string): string {
    // Lane ids ARE the canonical slugs — no remap needed. Method kept as a
    // single funnel point in case future lane kinds need translation.
    return laneId;
  }

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
      const trackId = this.laneToTrackId(lane.id);
      row.appendChild(buildMixerColumn(trackId, this.deps.mixerDeps));
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
            ensureExtraPoly, showPolyEditor,
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
      },
      onStopLane(laneId) { stopLane(self.laneStates, laneId); self.renderWithMixer(); },
      onLaunchScene(idx) {
        const scene = self.state.scenes[idx];
        if (!scene) return;
        void ctx.resume();
        launchScene(self.laneStates, self.state, scene, idx, ctx.currentTime, seq.bpm);
        if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
        self.renderWithMixer();
      },
      onStopAll() { stopAll(self.laneStates); self.renderWithMixer(); },
      onAddScene() {
        self.state.scenes.push({
          id: `scene-${Date.now().toString(36)}`,
          name: `Scene ${self.state.scenes.length + 1}`,
          clipPerLane: {},
        });
        self.renderWithMixer();
      },
      onAddLane(engineId: string) {
        const prefix =
          engineId === 'tb303'         ? 'bass'  :
          engineId === 'drums-machine' ? 'drums' :
                                         'poly';
        const used = new Set(self.state.lanes.map((l) => l.id));
        let newId = '';
        for (let i = 1; i <= 16; i++) {
          const candidate = `${prefix}${i + 1}`;
          if (!used.has(candidate)) { newId = candidate; break; }
        }
        if (!newId) { alert('No free lane id available for this engine (max 17 lanes per type).'); return; }

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

        if (engineId === 'subtractive') ensureExtraPoly(newId);
        // tb303 + drums-machine lazy-create their instances on first trigger via
        // the engine's createVoice path (Task 14 wires this end-to-end).

        self.renderWithMixer();
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

        let polyTarget: PolySynth | null = null;
        if (laneId === 'subtractive-1') polyTarget = polysynth;
        else if (laneId.startsWith('subtractive-')) polyTarget = ensureExtraPoly(laneId);

        const targetTab =
          laneId === 'tb-303-1'                                  ? '303'   :
          (laneId === 'drums-1' || laneId.startsWith('drum:'))   ? 'drums' :
                                                                   'poly';
        document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
          if (t.classList.contains('session-lane-tab')) {
            t.classList.toggle('active', t.dataset.laneId === laneId);
          } else {
            t.classList.toggle('active', t.dataset.tab === targetTab && !t.classList.contains('synth-tab'));
          }
        });
        const lane = self.state.lanes.find((l) => l.id === laneId);
        const displayName = lane?.name ?? laneId.toUpperCase();
        if (polyTarget) {
          showPolyEditor(laneId, polyTarget, displayName);
        } else {
          document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
            p.hidden = p.dataset.page !== targetTab;
          });
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
    // Pick the engine for this lane.
    const engineId =
      laneId === 'tb-303-1'                                       ? 'tb303' :
      (laneId === 'drums-1' || laneId.startsWith('drum:'))        ? 'drums-machine' :
                                                                    this.deps.getLaneEngineId(laneId);
    // Built-in lanes (tb-303-1 / drums-1 / subtractive-1) use the singleton
    // engine instance the audio graph was wired to at boot. Extra lanes
    // (subtractive-2+, etc.) use a factory-created instance owned by
    // laneEngines — fall back to the singleton only if that lookup fails.
    const isBuiltinLane =
      laneId === 'tb-303-1' || laneId === 'drums-1' || laneId === 'subtractive-1';
    const engine = isBuiltinLane
      ? getEngine(engineId)
      : (this.deps.ensureLaneEngine(laneId, engineId) ?? getEngine(engineId));
    if (!engine) return;

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
      if (this.deps.getAppMode() !== 'session') return;
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
