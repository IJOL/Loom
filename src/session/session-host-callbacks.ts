// SessionUICallbacks factory for SessionHost — the clip-grid / scene / lane
// interaction handlers. Extracted from session-host.ts (the body was already
// written in terms of `self`, so it lifts out verbatim with `self` as a param).

import {
  convertLaneToLayers, contrastPresetName, recallLayerPreset, slotChoices,
} from '../engines/layers-rack-ui';
import { laneLayers } from '../engines/layers-engine';
import { pagePresetName } from '../instrument-presets/preset-select-state';
import { snapshotEngineParams } from '../instrument-presets/user-preset-store';
import { commitParamForLane } from '../engines/engine-param-commit';
import { html } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
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
  launchClip, launchScene, stopLane, stopAll, emptyLanePlayState, captureSceneFromPlaying,
} from './session-runtime';
import { rehydrateLane, modulatorsForDuplicatedLane } from './session-host-persistence';
import { getEngine, getEngineParamIds } from '../engines/registry';
import { isAudioEngine } from '../plugins/capabilities';
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
                   queuedStop: null, startTime: 0, nextStepIdx: 0, loopCount: 0,
                   loopStartedAt: 0, lastScheduledAt: -Infinity };
          self.laneStates.set(lane.id, next);
        }
        next.queued = clip;
        next.queuedBoundary = ctx.currentTime;
        resetAutomationPosition();
        seq.start();
        playBtn.classList.add('is-playing');
      } else {
        launchClip(self.laneStates, self.state, lane, clip, ctx.currentTime, seq.bpm,
          seq.meter, self.deps.recHooks);
        self.markQueued(clip.name ?? lane.name ?? lane.id);
      }
      self.renderWithMixer();
    },
    onCellClick(laneId, clipIdx) {
      const lane = self.state.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      if (isAudioEngine(lane.engineId)) {
        // Audio channels hold one WAV per clip — pick the file now (the channel
        // itself was created empty). Same load path as dropping a WAV here.
        // Transient build-once node: rendered detached, appended, self-removes.
        const onPicked = (e: Event) => {
          const picker = e.currentTarget as HTMLInputElement;
          const f = picker.files?.[0];
          picker.remove();
          if (f) self.loadAudioFileIntoCell(laneId, clipIdx, f);
        };
        const input = renderElement<HTMLInputElement>(
          html`<input type="file" accept="audio/*" style="display: none" @change=${onPicked} />`,
        );
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
    // Literal 'audio' by design: this is the menu's explicit "Audio channel"
    // entry (session-grid-templates.ts's EXPLICIT_ENTRY_ENGINE) — it always
    // adds the BUILT-IN channel, never a plugin that merely declares
    // clipContent: 'audio'. A product/UI choice, not a capability check.
    onAddAudioChannel() { self.callbacks.onAddLane('audio'); },
    onStopLane(laneId) {
      stopLane(self.laneStates, laneId, stopHooks());
      self.renderWithMixer();
    },
    onLaunchScene(idx) {
      // Delegate to launchSceneAt so activeSceneIdx + the global-loop driver state
      // (glState) are set — the per-scene global loop is a no-op without an active
      // scene, so launching via the raw launchScene left Global/seek loop dead.
      self.launchSceneAt(idx);
      playBtn.classList.add('is-playing');
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
    onConvertToLayered(laneId: string, opts?: { contrast?: boolean }) {
      // Undoable, because it swaps the lane's instrument and rewrites its
      // params — the two things a user most wants back if they meant something
      // else. The conversion itself lives with the rack, which owns the one
      // door that writes a rack and rebuilds the engine behind it.
      const lane = self.state.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      const hd = self.deps.historyDeps;
      // The SAME resolution the WEAVE panel uses: the live picker's answer
      // first, the saved one as the fallback. Three answers exist and none owns
      // the question, so the rule is to reuse an existing reading rather than
      // add a fourth.
      //
      // Stripped of its vocabulary prefix. What is recorded is the DROPDOWN's
      // value — `factory:LEAD Square`, `user:…`, `sampler:…` — and a layer's
      // preset list carries bare names, so handing it over whole matched no
      // option and the slot came up "— pick —" while playing that very sound.
      const raw = pagePresetName.get(laneId) ?? lane.enginePresetName;
      const presetName = raw?.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
      // The lane's LIVE patch, read off its engine. `engineState.params` is a
      // mirror of EDITS, so a lane sounding a preset applied at boot has almost
      // nothing in it — carrying that is what made a converted lane come up on
      // factory defaults sounding like something else entirely.
      const engine = self.deps.laneResources?.get(laneId)?.engine;
      const patch = engine ? snapshotEngineParams(engine) : undefined;
      // And its ENVELOPES, which are not params and so are not in the patch.
      // Read live for the same reason: `engineState.modulators` is written on
      // save, not kept in step.
      const mods = engine?.modulators?.serialize();
      const run = () => {
        // What the SLOTS will hold, read before the conversion: it puts the
        // lane's engine into both slots and then the lane itself becomes LAYERS,
        // so afterwards `lane.engineId` names the rack rather than the
        // instrument inside it.
        const slotEngineId = lane.engineId;
        // Whether this lane's sound is one the USER built, read BEFORE the
        // conversion — `engineState.params` is a mirror of EDITS, and the
        // conversion fills it with the carried patch, so afterwards every lane
        // looks edited. Empty here means factory defaults and nothing to lose.
        const hadEdits = Object.keys(lane.engineState?.params ?? {}).length > 0;
        // A morph wants four DIFFERENT instruments, one per corner of its pad.
        // From the rack's own list, so a slot still cannot hold a rack, the
        // Sampler or the drum machine — and never the lane's own engine, which
        // is already in slot 0 carrying its patch.
        //
        // Fewer than three others is a small install, not an error: the rack is
        // built as deep as the engines allow and the pad's empty corners simply
        // have no destination to write.
        const spread = opts?.contrast
          ? slotChoices().map((e) => e.id).filter((id) => id !== slotEngineId).slice(0, 3)
          : undefined;
        if (!convertLaneToLayers(lane, presetName, patch, mods, spread)) return;
        // Tell the NEW engine what the rack says, through the door every param
        // write goes through.
        //
        // Writing the gains into engineState alone was not enough: the rack is
        // set, the engine is rebuilt, and the rebuilt engine takes each param
        // from its SPEC default — `l1.gain` defaults to 1 — so slot 1 came up at
        // full level and the lane doubled. Measured at the master: RMS 0.075
        // before converting, 0.147 after, on the same looping scene.
        //
        // After the rebuild, necessarily: the engine written to has to be the
        // one that now exists.
        const built = self.deps.laneResources?.get(laneId)?.engine;
        if (!built) return;
        // Everything the conversion wrote — the copied patch under both
        // prefixes AND the two slots' envelopes — is put onto the rebuilt
        // engine by the rack door itself (main.ts's setRack), because every
        // rack change rebuilds and every rebuild needs it. Only the gains are
        // written here, and only because they must also reach the mirror.
        // Slot 0 keeps the sound the lane already had; every slot after it
        // arrives SILENT, so converting is inaudible and raising a corner is a
        // decision you make.
        const rack = laneLayers(lane);
        rack.forEach((l, i) => {
          if (l.engineId) commitParamForLane(built, self.state, laneId, `l${i}.gain`, i === 0 ? 1 : 0);
        });

        // Only when the caller asks. From the lane menu you are building a rack
        // by hand and the other slots are yours to fill; from the sound pad the
        // whole point of the press was to have somewhere to cross to.
        if (!opts?.contrast) return;

        // Every slot INITIALISED, which is what was missing. A slot with no
        // preset shows "— pick —" while playing whatever the rebuild left in it,
        // and two slots that happen to hold the same sound make a pad that moves
        // and changes nothing — reported as exactly that.
        for (let i = 1; i < rack.length; i++) {
          const held = rack[i].engineId;
          if (!held) continue;
          // A different engine's first preset can never collide with slot 0's,
          // which is the contrast this is for. Only when a slot happens to hold
          // the lane's own engine does it have to avoid one by name.
          const name = contrastPresetName(held, held === slotEngineId ? presetName : undefined);
          // An engine that ships no presets keeps its factory defaults rather
          // than being emptied: a poor corner is better than a silent one.
          if (name) recallLayerPreset(built, self.state, laneId, i, held, name);
        }

        // And slot 0 — but ONLY when there is nothing to lose. A lane with no
        // recorded preset and no edits of its own is on factory defaults, and
        // leaving it there gives the pad a corner whose dropdown reads
        // "— pick —" for ever. A lane whose knobs were turned by hand keeps
        // them: overwriting an unnamed sound the user built is the one thing
        // this must not do.
        if (presetName || hadEdits) return;
        const first = contrastPresetName(slotEngineId, undefined);
        if (first) recallLayerPreset(built, self.state, laneId, 0, slotEngineId, first);
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
        // The clone's engineState.modulators is a JSON copy of the source's, which
        // is no longer kept live (the mirror was removed). Seed it from the
        // source's LIVE host so a lane duplicated after an LFO edit carries the
        // real modulators, not a stale snapshot.
        const srcHost = self.deps.laneResources?.get(laneId)?.engine?.modulators;
        if (srcHost) {
          clone.engineState ??= {};
          clone.engineState.modulators = modulatorsForDuplicatedLane(srcHost, clone.engineState);
        }
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
      // Guard BEFORE withUndo so an empty capture (nothing playing) commits nothing.
      const anyPlaying = self.state.lanes.some((l) => self.laneStates.get(l.id)?.playing);
      if (!anyPlaying) return;
      const hd = self.deps.historyDeps;
      const run = () => { captureSceneFromPlaying(self.state, self.laneStates); self.renderWithMixer(); };
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
        // A stems "replace" swaps only lanes/scenes for a clean set holding the
        // stems — the project's name/tonality/sends/master-rack are untouched,
        // same spirit as preserving globalQuantize below.
        const newState: SessionState = {
          ...self.state,
          lanes,
          scenes: [scene],
          globalQuantize: self.state.globalQuantize,
        };
        self.applyLoadedSessionState(newState);
        self.deps.checkpointHistory?.();
      };

      const runAdd = () => {
        // Literal 'audio' by design: a stem-separation import always lands
        // each stem on the BUILT-IN Audio channel (buildStemAudioLane does
        // the same) — there is no plugin picker in this flow. Not a
        // capability check.
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
        self.deps.checkpointHistory?.();
      };
      if (hd) withUndo(hd, run); else run();
    },
    onAddClipRow()   { /* Task 11 */ },
    onEditLane(laneId) {
      // The column header only ever SELECTS — collapsing is the chevron's job
      // (onToggleSynthEditor). Re-clicking the active lane keeps it open.
      self.showLaneEditor(laneId);
    },
    onToggleSynthEditor() { self.toggleSynthEditor(); },
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
    onSetClipColor(laneId, clipIdx, color) {
      const lane = self.state.lanes.find((l) => l.id === laneId);
      const clip = lane?.clips[clipIdx];
      if (!clip || clip.color === color) return;
      const hd = self.deps.historyDeps;
      const run = () => {
        clip.color = color;
        self.renderWithMixer();
        self.inspector.refreshContext(); // keep the breadcrumb swatch in sync
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
          self.activeEditLane = null;
          self.deps.onActiveLaneChanged?.();
        }
        self.renderWithMixer();
        // The deleted lane's engine params + insert-chain params are no longer
        // targetable — deleteLane/dispose above bypass ensureLaneResource/
        // swapLaneEngine (the only other sites that invalidate), so this is the
        // only place a lane delete gets announced.
        self.deps.onDestinationsChanged?.();
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
    onRenameProject(name) {
      const hd = self.deps.historyDeps;
      const run = () => { self.state.name = name || 'Untitled'; self.renderWithMixer(); };
      if (hd) withUndo(hd, run); else run();
    },
  };
}
