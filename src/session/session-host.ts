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
import { renderSessionGrid, type SessionUICallbacks } from './session-ui';
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
  setActivePolyTarget: (target: PolySynth, label: string) => void;
  setCurrentSynthLane: (laneId: string) => void;
  polysynth: PolySynth;
  mixerDeps: MixerColumnDeps;
  getAppMode: () => 'classic' | 'session';
  midiLabel: (m: number) => string;
}

export class SessionHost {
  state: SessionState = emptySessionState();
  laneStates = new Map<string, LanePlayState>();
  private inspector!: SessionInspector;
  private callbacks!: SessionUICallbacks;

  // Expose inspector roll for the automation tick in main.ts
  get inspectorRoll() { return this.inspector?.roll ?? null; }

  constructor(private deps: SessionHostDeps) {}

  init(): void {
    this.inspector = new SessionInspector({
      ctx: this.deps.ctx,
      seq: this.deps.seq,
      state: this.state,
      laneStates: this.laneStates,
      renderWithMixer: () => this.renderWithMixer(),
      midiLabel: this.deps.midiLabel,
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
            },
            laneId, clip, stepInClip, stepTime, stepDur,
          ),
      );
    };

    this.buildCallbacks();
    this.wireToolbar();
    this.wireBackPill();
    this.startRenderTick();
    this.renderWithMixer();
  }

  // ── Public API for save/load ─────────────────────────────────────────────

  getStateForSave(): SessionState {
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
    this.renderWithMixer();
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private laneToTrackId(laneId: string): string {
    if (laneId === 'bass')  return 'bass';
    if (laneId === 'drums') return 'drumBus';
    if (laneId === 'main')  return 'poly';
    return laneId;
  }

  private render(): void {
    const hostEl = document.getElementById('session-grid');
    if (!hostEl) return;
    renderSessionGrid(hostEl, this.state, this.laneStates, this.callbacks);
  }

  renderWithMixer(): void {
    this.render();
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

  // ── Callbacks ────────────────────────────────────────────────────────────

  private buildCallbacks(): void {
    const self = this;
    const { ctx, seq, playBtn, resetAutomationPosition,
            ensureExtraPoly, setActivePolyTarget, setCurrentSynthLane,
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
      onAddSynthLane() {
        const used = new Set(self.state.lanes.map((l) => l.id));
        let newId = '';
        for (let i = 1; i <= 16; i++) {
          const candidate = `poly${i}`;
          if (!used.has(candidate)) { newId = candidate; break; }
        }
        if (!newId) { alert('Max 16 extra poly lanes reached.'); return; }

        const lane = emptyLane(newId, 'subtractive');
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
        ensureExtraPoly(newId);
        self.renderWithMixer();
      },
      onAddClipRow()   { /* Task 11 */ },
      onEditLane(laneId) {
        if (laneId === 'main') {
          setActivePolyTarget(polysynth, 'MAIN');
        } else if (laneId.startsWith('poly')) {
          setActivePolyTarget(ensureExtraPoly(laneId), laneId.toUpperCase());
        }
        const targetTab =
          laneId === 'bass'  ? '303' :
          (laneId === 'drums' || laneId.startsWith('drum:')) ? 'drums' :
          'poly';
        document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
          t.classList.toggle('active', t.dataset.tab === targetTab && !t.classList.contains('synth-tab'));
        });
        if (laneId.startsWith('poly') || laneId === 'main') {
          setCurrentSynthLane(laneId === 'main' ? 'main' : laneId);
        } else {
          document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
            p.hidden = p.dataset.page !== targetTab;
          });
        }
        document.getElementById('session-view')!.hidden = true;
        document.getElementById('back-to-session')!.hidden = false;
        document.querySelector<HTMLElement>('.tab-bar')!.hidden = false;
      },
      onToggleDrumsExpanded() { /* drum-bus expand removed — drum-grid editor shows all voices */ },
    };
  }

  // ── Toolbar / back-pill wiring ────────────────────────────────────────────

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
    document.getElementById('session-add-synth')?.addEventListener('click',
      () => this.callbacks.onAddSynthLane());
  }

  private wireBackPill(): void {
    // Reparent the back-pill into the tab-bar so it sits inline with the
    // synth tabs (it used to be a floating fixed-position button that the
    // user could easily miss).
    const pill = document.getElementById('back-to-session');
    const tabBar = document.querySelector<HTMLElement>('.tab-bar');
    if (pill && tabBar && pill.parentElement !== tabBar) {
      tabBar.insertBefore(pill, tabBar.firstChild);
    }
    document.getElementById('back-to-session')!.addEventListener('click', () => {
      // Always do explicit DOM restoration first — this guarantees that the
      // back-pill works even if main.ts's __reapplyModeVisibility helper is
      // missing (e.g. in the pure-session HTML route).
      document.querySelectorAll<HTMLElement>('.page').forEach((p) => { p.hidden = true; });
      const tabBar = document.querySelector<HTMLElement>('.tab-bar');
      if (tabBar) tabBar.hidden = true;
      const sessionView = document.getElementById('session-view');
      if (sessionView) sessionView.hidden = false;
      const backPill = document.getElementById('back-to-session');
      if (backPill) backPill.hidden = true;
      // Then let main re-hide any Classic-only panels (mixer, copy, presets)
      // and re-render the mixer columns.
      const w = window as unknown as { __reapplyModeVisibility?: () => void };
      if (w.__reapplyModeVisibility) w.__reapplyModeVisibility();
      this.renderWithMixer();
    });
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
