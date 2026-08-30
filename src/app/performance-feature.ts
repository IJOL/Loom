// Performance view integration. Owns the RecState + ArrangementState lifecycle
// and wires them into the live transport, the lookahead loop, the REC button,
// and the mode toggle. main.ts builds this once at boot and threads the
// resulting recHooks + mode/arrangement accessors where needed.

import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import type { DestinationRegistry } from '../automation/destination-registry';
import { createArrangementPlayback } from './arrangement-playback';
import {
  createRecState, armRec, disarmRec, startRecording, stopRecording,
  markParamTouched, tickRecAutomation, arrangementNow,
  type RecState,
} from '../performance/rec-state';
import {
  emptyArrangementState, stepsPerSec,
  type ArrangementState,
} from '../performance/performance';
import {
  finalizeArrangement, setArrangementLengthBars, recomputeDurationSec,
  addAutomationCurve, removeAutomationCurve, writeAutomationSample,
  effectiveDurationSec, seedClipEventsFromSounding,
} from '../performance/arrangement-ops';
import type { AutoBrush } from '../automation/automation-painter';
import {
  createArrangementPlayState, stopArrangement,
  type ArrangementPlayState,
} from '../performance/arrangement-runtime';
import { stopAll, type RecHooks } from '../session/session-runtime';
import { html } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
import { renderPerformanceView } from '../performance/performance-ui';
import { wirePanelViews, type PanelViewHandle } from './panel-views';
import { createPanelContext } from './panel-context';
import { defaultWeaveState, type WeaveState } from '../weave/weave-state';
import { buildMiniMaster } from '../core/master-strip';
import { createLevelMeter } from '../core/level-meter';
import { arrangementFromSession } from '../performance/arrangement-from-session';
import { createHistory } from '../core/history';
import { songBarSec } from '../core/song-position';
import { moveEvent, resizeEvent, deleteEvent, clampMove } from '../performance/arrangement-edit';
import { findBand, setBandMuted, duplicateBand, splitBandAt } from '../performance/band-ops';
import { attachPerfGestures } from '../performance/perf-gestures';
import { attachPerfActions } from '../performance/perf-keys';
import { attachPerfDrop } from '../performance/perf-ingest';
import { getOrCreateLane } from '../performance/arrangement-ops';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { sampleCache } from '../samples/sample-cache';
import { sampleStore } from '../samples/store-singleton';
import { arrangementPlayhead } from '../performance/arrangement-runtime';
import { newBandId } from '../performance/performance';
import { clipLoopSec } from '../core/launch-timing';
import { ticksPerBar } from '../core/meter';

export interface PerformanceFeatureDeps {
  ctx: AudioContext;
  seq: Sequencer;
  sessionHost: SessionHost;
  automationRegistry: Map<string, KnobHandle>;
  /** The one destination catalogue (Task 4/9) — the Performance "+
   *  Automation" header's list source. Required: an absent one used to
   *  render the header silently empty. */
  destinations: DestinationRegistry;
  /** Called by registerKnob — performance also wants the knob events. */
  onRegisterKnob: (registerExtra: (k: KnobHandle) => void) => void;
  /** Repaint the (main-owned) shared REC button after Performance changes the
   *  take's armed state (e.g. auto-disarm when Performance starts playing). */
  onRecVisualChanged?: () => void;
  /** Optional: snapshot current state for undo after a performance edit
   *  (length/zoom/add/remove/draw). Undefined keeps edits working without undo. */
  onPerformanceEdited?: () => void;
  /** Called when arrangement playback reaches the end of the song (song mode):
   *  lets the host stop the transport engine and reset the Play button so a
   *  fresh Play restarts from the top rather than toggling a stale ■. */
  onArrangementEnd?: () => void;
  /** TIMELINE WINS — the same door as SessionHost.deps.onGridLaunch: main wires
   *  both to weaveWiring.suspendForGrid, so a take drives a weaving lane exactly
   *  the way a scene does. Passed straight through to arrangement-playback. */
  onTimelineLaunch?: (laneId: string | null) => void;
  /** Optional master meter tap — feeds the compact master VU in the Performance
   *  toolbar (the full master strip is hidden with the session root in Perf). */
  masterMeterAnalyser?: AnalyserNode;
  /** Optional #volume input — the Performance mini master fader proxies it. */
  volInput?: HTMLInputElement;
  /** Land a take curve whose knob is unmounted. Late-bound: automation-writes
   *  is built AFTER this feature, so main hands in a closure. Absent in test
   *  fixtures with no audio graph. */
  applyUnmounted?: (
    paramId: string, normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
  getTargetRanges?: () => ReadonlyMap<string, { min: number; max: number }>;
  /** Handed straight to a panel plugin's context. main supplies its OWN
   *  undoable engine-swap wrapper and its own preset path, so a panel goes
   *  through the same doors the lane selectors do rather than getting a second
   *  set of its own. */
  swapLaneEngine?: (laneId: string, engineId: string) => void;
  applyLanePreset?: (laneId: string, presetName: string) => void;
  /** Freeze the weave into a new scene; returns how many lanes were written. */
  printWeaveScene?: () => number;
  /** The app's unified stop — the one that also finalizes a live take and
   *  resets the Play button. A panel that unplugs itself stops the transport
   *  with it, so switching WEAVE off cannot uncover the scene underneath. */
  stopTransport?: () => void;
  /** Where the chord walk is, threaded to a panel so it can draw it from the
   *  same cursor the fold reads rather than counting its own bars. */
  weaveChordNow?: () => { bar: number; bars: number; degree: number } | null;
  /** Passed through to a panel's context: the mixer's own mute/solo tables, so
   *  a panel's M and S buttons and the desk's are the same two buttons. */
  muteState?: Record<string, boolean>;
  soloState?: Record<string, boolean>;
  applyMuteSolo?: () => void;
  /** A lane's fader, through the same strip door the mixer column uses. */
  laneLevel?: (laneId: string) => number;
  setLaneLevel?: (laneId: string, level: number) => void;
  /** The app's ONE writer of the project's key/scale/style — the same one
   *  Project Options uses, undo and toolbar chip included. */
  setMusicality?: (m: import("../session/session-types").MusicalityState) => void;
  /** WEAVE's note source, threaded to a panel so it can draw the woven bar. */
  weaveNotesFor?: (laneId: string) => (() => readonly { start: number; duration: number; midi: number; velocity: number }[] | undefined) | undefined;
  /** The ONE weave state, shared with the session host's gate. Absent in test
   *  fixtures, which get a fresh one. */
  weave?: WeaveState;
  /** Called after a macro moves: drops the cached gates so the next tick folds
   *  against the new value instead of answering from the old one. */
  onWeaveChanged?: () => void;
  /** The panel taking a lane back from the grid — the way out of the suspension
   *  a scene launch puts a weaving lane into. */
  resumeWeaving?: (laneId: string) => void;
}

export interface PerformanceFeature {
  rec: RecState;
  arrangement: ArrangementState;
  arrangementPlayState: ArrangementPlayState;
  recHooks: RecHooks;
  /** 'session', 'performance', or the id of a registered panel plugin. It is a
   *  string rather than a union because the host cannot know which panels
   *  exist until the plugins have loaded. */
  getMode: () => string;
  setMode: (m: string) => void;
  setArrangement: (a: ArrangementState) => void;
  refreshPerformanceView: () => void;
  /** Called from inside the sequencer's session tick — also fires
   *  tickRecAutomation and (when in performance mode) tickArrangement. */
  onLookahead: (nowCtx: number, lookaheadSec: number) => void;
  /** Called from the patched seq.start to decide if Performance owns Play. */
  onPlay: () => boolean;
  /** Called from the patched seq.stop. */
  onStop: () => boolean;
  /** Build the arrangement from the current session (scenes in order) and
   *  switch to Performance. */
  copyFromSession: () => void;
  /** Wipe the take back to empty and return to Session mode (used by "New"). */
  resetArrangement: () => void;
  /** Toggle the Performance "take" arm (clip launches + knob automation).
   *  Returns the new armed state. Called by main's unified REC button. */
  toggleTakeRec: () => boolean;
  /** Create a timeline automation curve for paramId — same operation as the
   *  header's "+ Automation" button, undoable via the arrangement history.
   *  Exposed whole (not beforeEdit/commitArrUndo) so callers outside this file
   *  (the knob context menu) can't get the undo-snapshot sequencing wrong. */
  addCurve: (paramId: string) => void;
  /** Build a tab and a root for every registered panel plugin. Call AFTER
   *  loadPlugins() resolves — before that the registry is empty and the tabs
   *  would be built from nothing. */
  mountPanels: () => void;
}

export function createPerformanceFeature(deps: PerformanceFeatureDeps): PerformanceFeature {
  const { ctx, seq, sessionHost, automationRegistry, destinations, onRegisterKnob, onPerformanceEdited } = deps;

  const rec = createRecState();
  const arrangement = emptyArrangementState(seq.bpm);
  const arrangementPlayState = createArrangementPlayState();
  const recHooks: RecHooks = { rec, arrangement };
  // A mode is 'session', 'performance', or the id of a registered panel plugin.
  let mode: string = 'session';

  // The session history deliberately excludes the arrangement; give the arrangement
  // its OWN undo stack so timeline edits (and length/brace) are undoable without
  // coupling to session undo.
  const arrHistory = createHistory<ArrangementState>({ maxSize: 100 });
  const snapArr = (): ArrangementState => JSON.parse(JSON.stringify(arrangement));
  const restoreArr = (s: ArrangementState) => { setArrangement(s); };
  /** Snapshot before a discrete arrangement edit. */
  const commitArrUndo = () => arrHistory.commit(snapArr());
  let pxPerBar = 80;
  let brush: AutoBrush = 'line';
  /** The selected band ids — runtime state, never persisted (spec §1). */
  const bandSelection = new Set<string>();
  const laneIds = () => sessionHost.state.lanes.map((l) => l.id);

  // Everything the take DOES while it plays — launching clips, landing curves on
  // knobs, handing the song anchor back and forth, moving the cursor — lives in
  // app/arrangement-playback. This file keeps the take's lifecycle: arming,
  // recording, mode switching, undo and the view rebuild.
  const playback = createArrangementPlayback({
    ctx, seq, sessionHost, automationRegistry, arrangement,
    ps: arrangementPlayState, recHooks,
    getPxPerBar: () => pxPerBar,
    isPerformanceMode: () => mode === 'performance',
    onArrangementEnd: () => deps.onArrangementEnd?.(),
    onTimelineLaunch: deps.onTimelineLaunch,
    // The mixer's booleans land on the SAME tables the desk's own buttons
    // write, through the same applyMuteSolo — one owner, two writers.
    applyMixerFlag: (laneId, kind, on) => {
      const md = sessionHost.deps.mixerDeps;
      if (!md) return;
      const table = kind === 'mute' ? md.muteState : md.soloState;
      if (table[laneId] === on) return;
      table[laneId] = on;
      md.applyMuteSolo();
    },
    applyUnmounted: deps.applyUnmounted,
    getTargetRanges: deps.getTargetRanges,
  });

  // VU meters built into the performance toolbar register here so we can tear
  // them down before each re-render (renderPerformanceView swaps in freshly
  // built meter elements), mirroring the mixer row's disposal channel —
  // otherwise each refresh would leak the meter's analyser registration with
  // the shared RAF loop.
  let perfDisposables: { dispose(): void }[] = [];

  // Coalesce zoom re-renders into one per animation frame. The slider uses
  // 'change' (one event on release), but a wheel-zoom can fire many notches in
  // quick succession; without this each one did a full synchronous re-render.
  let zoomRaf = 0;
  const scheduleZoomRefresh = () => {
    if (zoomRaf !== 0) return;
    zoomRaf = requestAnimationFrame(() => { zoomRaf = 0; refreshPerformanceView(); });
  };

  onRegisterKnob((k) => {
    const prev = k.onValueChanged;
    k.onValueChanged = (v, fromUser) => {
      if (prev) prev(v, fromUser);
      if (fromUser && rec.recording) markParamTouched(rec, k.meta.id!);
    };
  });

  // The REC button + its 3-mode selector are owned by main.ts (take/live/offline
  // dispatcher). Performance only owns the *take* mode, exposed here. Returns the
  // new armed state so main can repaint the shared button.
  function toggleTakeRec(): boolean {
    if (rec.armed) { finishRecordingIfActive(); disarmRec(rec); } else armRec(rec);
    if (rec.armed && seq.isPlaying()) beginTake();
    return rec.armed;
  }

  /** Starts the take and seeds it with whatever is already sounding, so arming
   *  REC over a running scene records what the user hears instead of waiting
   *  for a promotion that a re-launch of that same scene never produces. */
  function beginTake(): void {
    startRecording(rec, ctx.currentTime);
    const sounding = [...sessionHost.laneStates.values()]
      .filter((lp) => lp.playing)
      .map((lp) => ({ laneId: lp.laneId, clipId: lp.playing!.id }));
    seedClipEventsFromSounding(arrangement, sounding);
  }

  const flashToast = (msg: string) => {
    const t = renderElement(html`<div class="perf-toast">${msg}</div>`);
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('fade'); }, 1700);
    setTimeout(() => { t.remove(); }, 2200);
  };

  const beforeEdit = () => commitArrUndo();

  /** Create a timeline automation curve for paramId, undoably. The one
   *  implementation behind both the header "+ Automation" button and the
   *  knob context menu's timeline path — see addCurve on the interface. */
  function addCurve(paramId: string): void {
    beforeEdit();
    addAutomationCurve(arrangement, paramId, laneIds(), seq.meter);
    refreshPerformanceView();
  }

  function editBands(laneId: string, fn: (events: import('../performance/performance').ArrangementClipEvent[]) => import('../performance/performance').ArrangementClipEvent[]) {
    const lane = arrangement.lanes.find((l) => l.laneId === laneId);
    if (!lane) return;
    lane.clipEvents = fn(lane.clipEvents);
    // Every band edit (resize/move/delete) routes through here, so this is the one
    // place the arrangement's own length has to catch up with its content.
    recomputeDurationSec(arrangement);
    refreshPerformanceView();
  }

  // Per-lane header controls (mute/solo + VU) for the Performance lane rows,
  // reusing the session mixer's ChannelStrip + mute/solo state. Null when the
  // lane has no allocated strip. The VU registers in perfDisposables so it's torn
  // down with the rest of the view on each re-render.
  function buildLaneHeader(laneId: string): HTMLElement | null {
    const md = sessionHost.deps.mixerDeps;
    const strip = sessionHost.deps.laneResources?.get(laneId)?.strip;
    if (!md || !strip) return null;
    // One-shot build (renderElement): the view rebuilds this header on every
    // re-render, so the buttons patch only themselves in between.
    const toggle = (kind: 'mute' | 'solo', get: () => boolean, set: (v: boolean) => void) => (e: Event) => {
      e.stopPropagation();
      set(!get());
      (e.currentTarget as HTMLElement).classList.toggle('active', get());
      md.applyMuteSolo();
      // A mute performance is part of the take: while recording, the press
      // lands as a 0/1 sample on the lane's mixer curve (sampleAutomationAt
      // holds the last value, so one press sustains until the next).
      if (rec.recording) {
        const subIdx = Math.floor(
          arrangementNow(rec, ctx.currentTime) * stepsPerSec(arrangement.bpm) * AUTOMATION_SUB_RES,
        );
        writeAutomationSample(arrangement, `${laneId}.mixer.${kind}`, get() ? 1 : 0, subIdx, laneIds());
      }
    };
    // Launch-solo/mute (accent pair): the ARRANGEMENT stops driving lanes —
    // musically, at the bar. Distinct from the mixer's audio m/s beside them.
    const launch = playback.getLaunchState();
    const vu = createLevelMeter({ analyser: strip.getMeterAnalyser() });
    perfDisposables.push(vu);
    return renderElement(html`<div class="perf-lane-ctrls"><button
        class=${'perf-lane-btn launch-solo' + (launch.solo === laneId ? ' active' : '')}
        title="Launch-solo: the take drives only this lane"
        @click=${(e: Event) => {
          e.stopPropagation();
          playback.setLaunchSolo(launch.solo === laneId ? null : laneId);
          refreshPerformanceView();
        }}
      >S▸</button><button
        class=${'perf-lane-btn launch-mute' + (launch.muted.has(laneId) ? ' active' : '')}
        title="Launch-mute: the take stops driving this lane"
        @click=${(e: Event) => {
          e.stopPropagation();
          playback.setLaunchMute(laneId, !launch.muted.has(laneId));
          refreshPerformanceView();
        }}
      >M▸</button><button
        class=${'perf-lane-btn mute' + (md.muteState[laneId] ? ' active' : '')}
        @click=${toggle('mute', () => !!md.muteState[laneId], (v) => { md.muteState[laneId] = v; })}
      >M</button><button
        class=${'perf-lane-btn solo' + (md.soloState[laneId] ? ' active' : '')}
        @click=${toggle('solo', () => !!md.soloState[laneId], (v) => { md.soloState[laneId] = v; })}
      >S</button>${vu.el}</div>`);
  }

  /** The gesture layer's band-move: same-lane bands move by delta
   *  (id-addressed, processed away from the drag direction so clamps do not
   *  cascade); a single band dropped on another lane row re-lanes. One undo
   *  entry per gesture. */
  function moveBandsBy(
    ids: ReadonlySet<string>, deltaSec: number, targetLaneId: string | null,
    mode: 'clamp' | 'ripple', snap: boolean,
  ) {
    commitArrUndo();
    if (targetLaneId && ids.size === 1) {
      const only = [...ids][0];
      const found = findBand(arrangement.lanes, only);
      const target = arrangement.lanes.find((l) => l.laneId === targetLaneId);
      if (found && target && found.lane !== target) {
        const ev = found.lane.clipEvents[found.index];
        found.lane.clipEvents = found.lane.clipEvents.filter((e) => e.id !== only);
        target.clipEvents = clampMove(
          [...target.clipEvents, { ...ev, laneId: targetLaneId }],
          target.clipEvents.length, ev.atSec + deltaSec, arrangement.bpm, snap,
        );
        recomputeDurationSec(arrangement);
        refreshPerformanceView();
        return;
      }
    }
    for (const lane of arrangement.lanes) {
      const mine = lane.clipEvents.filter((e) => ids.has(e.id)).map((e) => ({ id: e.id, at: e.atSec }));
      mine.sort((a, b) => (deltaSec > 0 ? b.at - a.at : a.at - b.at));
      for (const { id } of mine) {
        const idx = lane.clipEvents.findIndex((e) => e.id === id);
        if (idx < 0) continue;
        lane.clipEvents = moveEvent(
          lane.clipEvents, idx, lane.clipEvents[idx].atSec + deltaSec, arrangement.bpm, mode, snap,
        );
      }
    }
    recomputeDurationSec(arrangement);
    refreshPerformanceView();
  }

  let gesturesDetach: (() => void) | null = null;
  let actionsDetach: (() => void) | null = null;
  let dropDetach: (() => void) | null = null;

  /** Copied bands, offsets relative to the earliest — plain data, fresh ids on
   *  paste. Runtime state, never persisted. */
  let bandClipboard: Array<{
    laneId: string; clipId: string; relAtSec: number; durSec: number;
    offsetSec?: number; muted?: boolean;
  }> = [];

  /** Where the playhead sits, playing or stopped (the paste target). */
  function playheadSec(): number {
    if (arrangementPlayState.isPlaying) return arrangementPlayhead(arrangementPlayState, ctx.currentTime);
    return Math.max(0, ctx.currentTime - sessionHost.songAnchorSec);
  }

  /** Apply `fn` to every lane that holds one of `ids`, as ONE undo entry. */
  function editSelectedBands(
    ids: ReadonlySet<string>,
    fn: (events: import('../performance/performance').ArrangementClipEvent[], id: string) =>
      import('../performance/performance').ArrangementClipEvent[],
  ): void {
    commitArrUndo();
    for (const lane of arrangement.lanes) {
      for (const ev of [...lane.clipEvents]) {
        if (!ids.has(ev.id)) continue;
        lane.clipEvents = fn(lane.clipEvents, ev.id);
      }
    }
    recomputeDurationSec(arrangement);
    refreshPerformanceView();
  }

  function deleteBands(ids: ReadonlySet<string>): void {
    editSelectedBands(ids, (evs, id) => evs.filter((e) => e.id !== id));
    bandSelection.clear();
  }

  function copyBands(ids: ReadonlySet<string>): void {
    const all = arrangement.lanes.flatMap((l) => l.clipEvents.filter((e) => ids.has(e.id)));
    if (all.length === 0) return;
    const t0 = Math.min(...all.map((e) => e.atSec));
    bandClipboard = all.map((e) => ({
      laneId: e.laneId, clipId: e.clipId, relAtSec: e.atSec - t0,
      durSec: e.untilSec - e.atSec, offsetSec: e.offsetSec, muted: e.muted,
    }));
  }

  function pasteAtPlayhead(): void {
    if (bandClipboard.length === 0) return;
    commitArrUndo();
    const at = playheadSec();
    bandSelection.clear();
    for (const item of bandClipboard) {
      const lane = arrangement.lanes.find((l) => l.laneId === item.laneId);
      if (!lane) continue;
      const ev = {
        id: newBandId(), clipId: item.clipId, laneId: item.laneId,
        atSec: at + item.relAtSec, untilSec: at + item.relAtSec + item.durSec,
        offsetSec: item.offsetSec, muted: item.muted,
      };
      lane.clipEvents = clampMove([...lane.clipEvents, ev], lane.clipEvents.length, ev.atSec, arrangement.bpm);
      if (lane.clipEvents.some((e) => e.id === ev.id)) bandSelection.add(ev.id);
    }
    recomputeDurationSec(arrangement);
    refreshPerformanceView();
  }

  function refreshPerformanceView() {
    const host = document.getElementById('performance-view-root');
    if (!host) return;
    // The gesture layer attaches ONCE to the persistent host — pointerdown is
    // delegated, so re-renders never strand it (see perf-gestures.ts).
    gesturesDetach ??= attachPerfGestures(host, {
      pxPerBar: () => pxPerBar,
      barSec: () => songBarSec(arrangement.bpm, seq.meter),
      getSelection: () => bandSelection,
      setSelection: (ids) => { bandSelection.clear(); for (const id of ids) bandSelection.add(id); },
      moveBands: moveBandsBy,
      refresh: refreshPerformanceView,
    });
    dropDetach ??= attachPerfDrop(host, {
      bpm: () => arrangement.bpm,
      meter: () => seq.meter,
      pxPerBar: () => pxPerBar,
      importFile: async (file) => {
        try {
          const bytes = await file.arrayBuffer();
          const buffer = await ctx.decodeAudioData(bytes.slice(0));
          const asset = buildSampleAsset({
            id: newSampleId(), name: file.name, mime: file.type || 'audio/wav',
            bytes, buffer, createdAt: Date.now(),
          });
          sampleCache.put(asset.id, buffer);   // audible immediately
          void sampleStore.put(asset);         // persisted for reload
          return { sampleId: asset.id, durationSec: buffer.duration };
        } catch (err) {
          console.warn('[arrange-drop] decode failed for', file.name, err);
          return null;
        }
      },
      addLoopLane: (input) => {
        // The session half: the stems door builds the Audio lane + the
        // bar-fitted audioChannelClip (originalBpm IS the fit), undoably.
        sessionHost.addStemLanes([input], { replace: false });
        const lane = sessionHost.state.lanes[sessionHost.state.lanes.length - 1];
        const clip = lane?.clips.find((c) => !!c);
        return lane && clip ? { laneId: lane.id, clipId: clip.id } : null;
      },
      addBand: (laneId, clipId, atSec, durSec) => {
        commitArrUndo();
        const rec = getOrCreateLane(arrangement, laneId);
        rec.clipEvents = [
          ...rec.clipEvents,
          { id: newBandId(), clipId, laneId, atSec, untilSec: atSec + durSec },
        ].sort((a, b) => a.atSec - b.atSec); // the runtime pointers expect order
        recomputeDurationSec(arrangement);
      },
      refresh: refreshPerformanceView,
    });
    actionsDetach ??= attachPerfActions(host, {
      isActive: () => mode === 'performance',
      getSelection: () => bandSelection,
      playheadSec,
      deleteBands,
      duplicateBands: (ids) => editSelectedBands(ids, (evs, id) => duplicateBand(evs, id)),
      toggleMuteBands: (ids) => editSelectedBands(ids, (evs, id) => {
        const ev = evs.find((e) => e.id === id);
        return ev ? setBandMuted(evs, id, !ev.muted) : evs;
      }),
      splitBandsAt: (ids, sec) => editSelectedBands(ids, (evs, id) => splitBandAt(evs, id, sec, arrangement.bpm)),
      copyBands,
      pasteAtPlayhead,
    });
    // Tear down the previous toolbar's VU meter(s) before renderPerformanceView
    // rebuilds them (each render constructs fresh meters and lit swaps the old
    // elements out), so they don't leak their analyser registration with the
    // shared RAF loop across re-renders.
    for (const d of perfDisposables) d.dispose();
    perfDisposables = [];
    const findClip = (id: string) => {
      for (const lane of sessionHost.state.lanes)
        for (const c of lane.clips) if (c?.id === id) return c;
      return null;
    };
    renderPerformanceView(host, arrangement, {
      onPlay: () => playback.begin(),
      onStop: () => stopArrangement(arrangementPlayState),
      onGoToSession: () => setMode('session'),
      resolveClipColor: (id) => findClip(id)?.color ?? '',
      resolveClipName: (id) => {
        for (const lane of sessionHost.state.lanes)
          for (const c of lane.clips)
            if (c?.id === id) return c.name || lane.name || lane.engineId || 'Clip';
        return 'missing';
      },
      registry: automationRegistry,
      destinations,
      laneIds: laneIds(),
      // The meter, read from its owner on every render. Nothing caches it, so a
      // meter chosen while Performance is on screen lands on the very next paint.
      meter: seq.meter,
      pxPerBar,
      getBrush: () => brush,
      setBrush: (b) => { brush = b; },
      onSetLengthBars: (bars) => { beforeEdit(); setArrangementLengthBars(arrangement, bars, seq.meter); refreshPerformanceView(); },
      onZoom: (px) => { pxPerBar = px; scheduleZoomRefresh(); },
      onAddCurve: (paramId) => addCurve(paramId),
      onRemoveCurve: (paramId) => { beforeEdit(); removeAutomationCurve(arrangement, paramId, laneIds()); refreshPerformanceView(); },
      onEdited: () => { onPerformanceEdited?.(); },
      loopEnabled: !!arrangement.loopEnabled,
      loopStartBar: arrangement.loopStartBar ?? 0,
      loopEndBar: arrangement.loopEndBar ?? Math.ceil(effectiveDurationSec(arrangement, seq.meter) / songBarSec(arrangement.bpm, seq.meter)),
      onSetLoop: (enabled, startBar, endBar) => {
        beforeEdit();
        arrangement.loopEnabled = enabled; arrangement.loopStartBar = startBar; arrangement.loopEndBar = endBar;
        // Reflect Performance A–B loop back into the active scene's global loop so
        // Session shows the same region when the user returns. setGlobalLoop early-
        // returns when activeScene() is null, so this is safe to call unconditionally.
        sessionHost.setGlobalLoop(enabled, startBar, endBar);
        refreshPerformanceView();
      },
      onSeek: (sec) => playback.seekTo(sec),
      resolveClipInfo: (id) => {
        const clip = findClip(id);
        if (!clip) return null;
        const loopSec = clipLoopSec(clip, arrangement.bpm, seq.meter);
        if (clip.sample) return { kind: 'audio', sampleId: clip.sample.sampleId, loopSec };
        return {
          kind: 'notes', loopSec, notes: clip.notes,
          lengthTicks: clip.lengthBars * ticksPerBar(seq.meter),
        };
      },
      selection: bandSelection,
      onResizeBand: (laneId, index, edge, newSec) => { commitArrUndo(); editBands(laneId, (evs) => resizeEvent(evs, index, edge, newSec, arrangement.bpm)); },
      onDeleteBand: (laneId, index) => { commitArrUndo(); editBands(laneId, (evs) => deleteEvent(evs, index)); },
      buildMaster: () => (deps.masterMeterAnalyser && deps.volInput)
        ? buildMiniMaster({
            volInput: deps.volInput,
            masterMeterAnalyser: deps.masterMeterAnalyser,
            registerDisposable: (d) => perfDisposables.push(d),
          })
        : null,
      buildLaneHeader,
    });
  }

  function setMode(requested: string) {
    // A save made with a panel plugin installed names a mode this build may
    // never have heard of. Honouring it blindly would hide every view and leave
    // a blank screen, so an unknown mode falls back to Session.
    const known = requested === 'session' || requested === 'performance'
      || panelViews.ids.includes(requested);
    const next = known ? requested : 'session';
    if (mode === next) return;
    // Global transport: carry the shared song anchor across the view switch so
    // neither view resets to 0. Done BEFORE the stop/silence below (which only
    // halts playback — the POSITION is preserved). Leaving Performance pushes the
    // Arrangement clock into the shared anchor; entering Performance pulls it the
    // other way so the Arrangement playhead shows the preserved position pre-Play.
    if (mode === 'performance') sessionHost.setSongAnchor(arrangementPlayState.startedAtCtx);
    if (next === 'performance') arrangementPlayState.startedAtCtx = sessionHost.songAnchorSec;
    if (next === 'performance') {
      // No meter to refresh here: seq.meter is the one owner and every reader
      // (ruler, length field, A–B window, playhead) takes it from there at use
      // time. It used to be COPIED into the arrangement on this line, which held
      // only until the next use of the Meter selector — that lives in the
      // always-visible transport row, so it fires without any view switch and
      // left this copy stale while the session moved on.
      //
      // bpm is deliberately NOT refreshed the same way: it is the take's own
      // (its curves are stored per step, so their seconds belong to the tempo
      // they were recorded at). It is normalised once on the way in — see
      // setArrangement — so every reader can trust the stored value.
      //
      // Reflect the active scene's global loop into the Performance A–B loop so
      // the brace shows the same region the user already set in Session.
      const g = sessionHost.globalLoopForUI();
      if (g.enabled) {
        arrangement.loopEnabled = true;
        arrangement.loopStartBar = g.startBar;
        arrangement.loopEndBar = g.endBar;
      }
    }
    // Session and Performance are two different playback engines, so moving
    // between them has to stop the one being left. A PANEL is not a third
    // engine — it is a control surface over the session that is already
    // playing — so entering or leaving one must not silence anything. Stopping
    // there was the difference between "I pressed play, opened Weave, and
    // nothing sounds" and an instrument you can actually perform with.
    const isPanel = (m: string) => panelViews.ids.includes(m);
    const enginesChanged = !isPanel(mode) && !isPanel(next);
    if (enginesChanged) {
      if (seq.isPlaying()) seq.stop();
      if (arrangementPlayState.isPlaying) stopArrangement(arrangementPlayState);
      // seq.stop()/stopArrangement only halt FUTURE look-ahead triggers; a clip's
      // already-scheduled whole-loop source (the 'audio' channel) plays on. Silence
      // live voices so switching modes doesn't leave an audio/stem clip ringing.
      stopAll(sessionHost.laneStates, sessionHost.deps.liveVoices, ctx.currentTime);
    }
    mode = next;
    document.querySelectorAll('#mode-toggle .mode-btn').forEach((b) => {
      b.classList.toggle('on', (b as HTMLElement).dataset.mode === next);
    });
    const sessionRoot = document.getElementById('session-view-root');
    const perfRoot = document.getElementById('performance-view-root');
    if (sessionRoot) sessionRoot.hidden = next !== 'session';
    if (perfRoot) perfRoot.hidden = next !== 'performance';
    // A panel plugin is a third kind of view. It hides and shows like the other
    // two rather than being rebuilt, because it holds live state.
    panelViews.show(next);
    if (next === 'performance') refreshPerformanceView();
  }

  // Built AFTER the plugins have loaded, so their buttons exist before this
  // listener sweep picks them up.
  // The weave state is OWNED by app/weave-wiring, which the session host also
  // reads — the panel and the scheduler have to see the same object or a knob
  // would move a copy nobody plays. It still does not persist; that is the
  // slice left, and its home is the SessionState.
  const weave = deps.weave ?? defaultWeaveState();

  // Deliberately NOT wired here. loadPlugins() resolves long after this
  // function runs, so a registry read now would find nothing and the tabs would
  // be built from an empty list. main.ts calls mountPanels() once the plugins
  // are in — the same two-step every other plugin-fed surface uses.
  let panelViews: PanelViewHandle = {
    ids: [], show: () => {}, refreshVisible: () => {}, dispose: () => {},
  };

  // A panel renders the session as it stands, and New / a save / a demo replace
  // that session wholesale. Entering a panel already rebuilds it; the one on
  // SCREEN when the swap lands is the one nothing would have told.
  // Optional call because the fixtures here hand in a hand-built session host
  // with only the members their subject touches; a panel repaint is not one of
  // the things any of them is testing.
  sessionHost.onStateApplied?.(() => panelViews.refreshVisible());

  function mountPanels(): void {
    panelViews.dispose();
    panelViews = wirePanelViews(
      (id) => setMode(id),
      (refresh) => createPanelContext({
        sessionHost, seq, ctx, weave, refresh,
        onMacroChanged: () => deps.onWeaveChanged?.(),
        onWeaveChanged: () => deps.onWeaveChanged?.(),
        swapLaneEngine: deps.swapLaneEngine,
        applyLanePreset: deps.applyLanePreset,
        printWeaveScene: deps.printWeaveScene,
        stopTransport: deps.stopTransport,
        weaveChordNow: deps.weaveChordNow,
        // The desk's own tables, by reference. A panel muting a copy would look
        // like it worked and change nothing.
        muteState: deps.muteState,
        soloState: deps.soloState,
        applyMuteSolo: deps.applyMuteSolo,
        laneLevel: deps.laneLevel,
        setLaneLevel: deps.setLaneLevel,
        // The project's musical ground and the tempo, through the app's own
        // writers. The panel is a second VIEW of them, never a second copy.
        setMusicality: deps.setMusicality,
        // The weave source, so the panel can DRAW the bar it is about to play
        // from the same fold the scheduler reads.
        weaveNotesFor: deps.weaveNotesFor,
        // …and the way back: the panel's own gestures take a lane back from a
        // scene that spoke for it.
        resumeWeaving: deps.resumeWeaving,
        // The ONE catalogue, already here for the timeline's own automation
        // picker. The step row asks the same list, so it can move anything a
        // knob can and nothing it cannot.
        destinations: () => destinations.list(),
      }),
    );
  }

  document.querySelectorAll('#mode-toggle .mode-btn').forEach((b) => {
    const m = (b as HTMLElement).dataset.mode;
    // A panel's own button already got its listener from wirePanelViews;
    // adding a second here would switch twice per click.
    if (!m || panelViews.ids.includes(m)) return;
    b.addEventListener('click', () => setMode(m));
  });

  document.addEventListener('keydown', (e) => {
    if (mode !== 'performance') return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      // Always preventDefault+stopPropagation in Performance mode so session undo
      // never fires silently when the arrangement history stack is empty.
      e.preventDefault(); e.stopPropagation();
      const prev = arrHistory.undo(snapArr());
      if (prev) restoreArr(prev);
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault(); e.stopPropagation();
      const next = arrHistory.redo(snapArr());
      if (next) restoreArr(next);
    }
  }, true); // capture phase so it beats the session handler

  /** The ONE door a foreign ArrangementState comes in by: the save loader
   *  (saved-state-v3 → deps.setArrangement), the arrangement's own undo restore,
   *  Copy-from-session and New. */
  function setArrangement(a: ArrangementState) {
    Object.assign(arrangement, a);
    // Unlike the meter, bpm is genuinely the TAKE's own: an automation curve is
    // stored per step, so how many seconds it covers depends on the tempo it was
    // recorded at. It stays a stored field rather than being derived from seq.
    //
    // What it must not be is unusable. A falsy bpm makes a bar Infinity seconds
    // long, which collapses the A-B window (end <= start) and inflates
    // effectiveDurationSec — while the tick and the playhead, which used to
    // paper over it with `arrangement.bpm || seq.bpm`, kept running at the
    // sequencer's tempo. That guard existed at two sites and not at the five
    // others reading the same field (arrangement-ops' barSecOf, the band
    // move/resize snap, the ruler), which is the disagreement. Normalising here,
    // where a take arrives, makes the field trustworthy everywhere instead of
    // making every reader guard it — so the guards are gone.
    if (!(arrangement.bpm > 0)) arrangement.bpm = seq.bpm;
    refreshPerformanceView();
  }

  function copyFromSession() {
    // seq.meter here sizes the SOURCE clips; the take itself stores seconds.
    const built = arrangementFromSession(sessionHost.state, seq.bpm, seq.meter);
    setArrangement(built);
    setMode('performance');
  }

  /** Wipe the take back to empty and return to Session mode. Called by the
   *  "New session" button: without it New cleared the session but left the old
   *  arrangement in the Performance timeline, where every band turned into an
   *  orphaned "missing" (its clipEvents pointed at deleted clips). */
  function resetArrangement() {
    setArrangement({ ...emptyArrangementState(seq.bpm), loopEnabled: false, loopStartBar: 0, loopEndBar: undefined });
    setMode('session');
  }

  function onLookahead(nowCtx: number, lookaheadSec: number) {
    tickRecAutomation({
      rec, state: arrangement, nowCtx, bpm: seq.bpm,
      laneIds: sessionHost.state.lanes.map((l) => l.id),
      readValue: (id) => {
        const k = automationRegistry.get(id);
        if (!k) return 0.5;
        const range = k.meta.max - k.meta.min;
        if (range === 0) return 0.5;
        const dv = k.el.getAttribute('data-value-norm') ?? '';
        const n = parseFloat(dv);
        return Number.isFinite(n) ? n : 0.5;
      },
    });
    // The mode gate stays here; app/arrangement-playback owns what happens
    // inside it (clip launches, automation, the anchor hand-off, the cursor).
    if (mode === 'performance') playback.tick(nowCtx, lookaheadSec);
  }

  function onPlay(): boolean {
    if (mode === 'performance') {
      if (rec.armed) {
        disarmRec(rec);
        deps.onRecVisualChanged?.();
        flashToast('REC disarmed: Performance is playing');
      }
      playback.begin();
      return true;
    }
    if (rec.armed) beginTake();
    return false;
  }

  /** Close the take: clamp open clip events, compute durationSec, refresh the
   *  view so a recorded take actually surfaces. (durationSec staying 0 → the UI
   *  keeps the empty-state forever, which was the bug.) */
  function finishRecordingIfActive(): void {
    if (!rec.recording) return;
    finalizeArrangement(arrangement, arrangementNow(rec, ctx.currentTime));
    stopRecording(rec);
    refreshPerformanceView();
  }

  function onStop(): boolean {
    if (mode === 'performance') {
      stopArrangement(arrangementPlayState);
      return true;
    }
    finishRecordingIfActive();
    return false;
  }

  refreshPerformanceView();

  return {
    rec, arrangement, arrangementPlayState, recHooks,
    getMode: () => mode,
    setMode,
    setArrangement,
    refreshPerformanceView,
    mountPanels,
    onLookahead,
    onPlay,
    onStop,
    copyFromSession,
    resetArrangement,
    toggleTakeRec,
    addCurve,
  };
}
