// SessionUICallbacks factory for SessionHost — the clip-grid / scene / lane
// interaction handlers. Extracted from session-host.ts (the body was already
// written in terms of `self`, so it lifts out verbatim with `self` as a param).

import type { SessionHost } from './session-host';
import type { SessionUICallbacks } from './session-ui';
import { stepsPerBar } from '../core/meter';
import { ensureScenesForRows } from '../core/scene-ensure';
import { confirmDialog } from '../core/dialog';
import {
  emptyLane, emptyClip, audioClip, emptyScene,
  moveClip, copyClip, duplicateLane, duplicateScene,
  deleteClipAt, deleteLane, laneHasContent, sceneHasContent, deleteScene,
  type SessionState, type SessionLane, type SessionClip, type ClipSlot,
} from './session';
import {
  launchClip, launchScene, stopLane, stopAll, emptyLanePlayState, buildSceneFromPlaying,
} from './session-runtime';
import { rehydrateLane } from './session-host-persistence';
import { getEngine, getEngineParamIds } from '../engines/registry';
import { withUndo } from '../save/history-wiring';
import { nextLaneSlug } from './session-host-util';
import { buildStemAudioLane } from './stem-lane-builder';

/** Build the clip-grid / scene callbacks bound to a SessionHost instance.
 *  SessionHost.buildCallbacks() assigns the result to `this.callbacks`. */
export function buildSessionCallbacks(self: SessionHost): SessionUICallbacks {
  const { ctx, seq, playBtn, resetAutomationPosition } = self.deps;

  // Build the stop hooks for a per-lane stop: recording hooks (when present)
  // PLUS the live-voice silencer so the lane's still-sounding voices (the long
  // 'audio' clip especially) are released the instant Stop is pressed.
  const stopHooks = () => ({
    ...(self.deps.recHooks ?? {}),
    nowCtx: ctx.currentTime,
    ...(self.deps.liveVoices ? { silence: self.deps.liveVoices } : {}),
  });

  return {
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
        stopLane(self.laneStates, lane.id, stopHooks());
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
      if (lane.engineId === 'audio') {
        // Audio channels hold one WAV per clip — pick the file now (the channel
        // itself was created empty). Same load path as dropping a WAV here.
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.style.display = 'none';
        input.addEventListener('change', () => {
          const f = input.files?.[0];
          input.remove();
          if (f) self.loadAudioFileIntoCell(laneId, clipIdx, f);
        });
        document.body.appendChild(input);
        input.click();
        return;
      }
      const hd = self.deps.historyDeps;
      const run = () => {
        const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
        const clip: SessionClip = emptyClip(defaultLen);
        // Single placement seam: grows lane.clips AND re-seeds scenes so the row
        // gets a ▶ (the "▶ missing" bug was this path skipping ensureScenesForRows).
        self.placeClipEnsuringScene(laneId, clipIdx, clip);
        self.inspector.setSelectedClip({ laneId, clipIdx });
        self.inspector.openInspector();
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onCellDropAudio(laneId, clipIdx, file) {
      self.loadAudioFileIntoCell(laneId, clipIdx, file);
    },
    onAddAudioChannel() { self.callbacks.onAddLane('audio'); },
    onStopLane(laneId) {
      stopLane(self.laneStates, laneId, stopHooks());
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
      stopAll(self.laneStates, self.deps.liveVoices, ctx.currentTime);
      self.renderWithMixer();
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
        // Instrument lane is born EMPTY (no phantom clips); emptyLane gives clips:[].
        self.state.lanes.push(lane);
        self.laneStates.set(newId, emptyLanePlayState(newId));

        // Allocate a fresh ChannelStrip + engine instance for the new lane so
        // triggerForLane can find it via laneResources immediately.
        self.deps.ensureLaneResource?.(newId, engineId);
        // Seed ≥1 launchable scene even though the lane has no clips yet.
        ensureScenesForRows(self.state);
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onDuplicateLane(laneId: string) {
      const src = self.state.lanes.find((l) => l.id === laneId);
      if (!src) return;
      const hd = self.deps.historyDeps;
      const run = () => {
        const used = new Set(self.state.lanes.map((l) => l.id));
        const newId = nextLaneSlug(used, src.engineId);
        const clone = duplicateLane(self.state, laneId, newId);
        self.laneStates.set(newId, emptyLanePlayState(newId));
        rehydrateLane(self, clone); // allocate strip+engine, rehydrate inserts/preset/state
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onDuplicateScene(sceneIdx: number) {
      const hd = self.deps.historyDeps;
      const run = () => { duplicateScene(self.state, sceneIdx); self.renderWithMixer(); };
      if (hd) withUndo(hd, run); else run();
    },
    onCaptureScene() {
      // Build BEFORE withUndo so an empty capture (nothing playing) commits nothing.
      const scene = buildSceneFromPlaying(self.state, self.laneStates);
      if (!scene) return;
      const hd = self.deps.historyDeps;
      const run = () => { self.state.scenes.push(scene); self.renderWithMixer(); };
      if (hd) withUndo(hd, run); else run();
    },
    /** Create one AUDIO lane per separated stem, as a single undoable action.
     *  Each lane plays the whole stem natively (warp off), its downbeat trimmed to
     *  `opts.anchorSec` so it lands on bar 1. With `opts.replace` the whole session
     *  is swapped for a clean one holding only the stems (1 scene). */
    onAddStemLanes(
      stems: { label: string; sampleId: string; durationSec: number; warpRef?: boolean }[],
      opts: { replace?: boolean; anchorSec?: number; warpMarkers?: import('./session').WarpMarker[]; warpGroupId?: string } = {},
    ) {
      const hd = self.deps.historyDeps;
      const anchorSec = opts.anchorSec ?? 0;
      const build = (stem: { label: string; sampleId: string; durationSec: number; warpRef?: boolean }, id: string) =>
        buildStemAudioLane(stem, id, {
          bpm: seq.bpm, meter: seq.meter, anchorSec,
          warpMarkers: opts.warpMarkers, warpGroupId: opts.warpGroupId, warpRef: stem.warpRef,
        });

      const runReplace = () => {
        const lanes = stems.map((s, i) => build(s, `audio-stem-${i + 1}`));
        const scene = emptyScene('Stems');
        scene.clipPerLane = Object.fromEntries(lanes.map((l) => [l.id, 0]));
        const newState: SessionState = {
          lanes,
          scenes: [scene],
          globalQuantize: self.state.globalQuantize,
        };
        self.applyLoadedSessionState(newState);
        self.deps.checkpointHistory?.();
      };

      const runAdd = () => {
        for (const stem of stems) {
          const used = new Set(self.state.lanes.map((l) => l.id));
          const newId = nextLaneSlug(used, 'audio');
          const lane = build(stem, newId);
          self.state.lanes.push(lane);
          self.laneStates.set(newId, emptyLanePlayState(newId));
          self.deps.ensureLaneResource?.(newId, 'audio');
        }
        ensureScenesForRows(self.state);
        self.renderWithMixer();
        self.deps.checkpointHistory?.();
      };

      // Each separation gets a fresh 'Transcription' scene for its note lanes.
      self.resetTranscriptionScene();
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
        if (!(await confirmDialog(`Delete track «${label}» and all its clips?`, { danger: true, okLabel: 'Delete' }))) return;
      }
      // Stop the lane BEFORE disposing it: cut in-flight voices/loops (symmetry
      // with onDeleteScene; avoids the analogue of the "New leaves synths" bug).
      stopLane(self.laneStates, laneId, stopHooks());
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
        if (!(await confirmDialog(`Delete scene «${label}»?`, { danger: true, okLabel: 'Delete' }))) return;
      }
      const hd = self.deps.historyDeps;
      const run = () => {
        // Stop whatever is sounding/queued on that row before compacting.
        for (const lp of self.laneStates.values()) {
          const lane = self.state.lanes.find((l) => l.id === lp.laneId);
          const clipInRow = lane?.clips[sceneIdx];
          if (clipInRow && (lp.playing?.id === clipInRow.id || lp.queued?.id === clipInRow.id)) {
            stopLane(self.laneStates, lp.laneId, stopHooks());
          }
        }
        deleteScene(self.state, sceneIdx); // COMPACTING (front A · session.ts)
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onRenameLane(laneId, name) {
      const hd = self.deps.historyDeps;
      const run = () => {
        const lane = self.state.lanes.find((l) => l.id === laneId);
        if (!lane) return;
        lane.name = name || undefined;
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onRenameScene(sceneIdx, name) {
      const hd = self.deps.historyDeps;
      const run = () => {
        const scene = self.state.scenes[sceneIdx];
        if (!scene) return;
        scene.name = name || undefined;
        self.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onToggleDrumsExpanded() { /* drum-bus expand removed — drum-grid editor shows all voices */ },
  };
}
