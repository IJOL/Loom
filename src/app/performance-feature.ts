// Performance view integration. Owns the RecState + ArrangementState lifecycle
// and wires them into the live transport, the lookahead loop, the REC button,
// and the mode toggle. main.ts builds this once at boot and threads the
// resulting recHooks + mode/arrangement accessors where needed.

import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import {
  createRecState, armRec, disarmRec, startRecording, stopRecording,
  markParamTouched, tickRecAutomation, arrangementNow,
  type RecState,
} from '../performance/rec-state';
import {
  emptyArrangementState,
  type ArrangementState,
} from '../performance/performance';
import {
  finalizeArrangement, setArrangementLengthBars,
  addAutomationCurve, removeAutomationCurve,
  effectiveDurationSec, arrangementLoopWindowSec,
} from '../performance/arrangement-ops';
import type { AutoBrush } from '../automation/automation-painter';
import {
  createArrangementPlayState, startArrangement, startArrangementAt, stopArrangement,
  tickArrangement, arrangementPlayhead,
  type ArrangementPlayState,
} from '../performance/arrangement-runtime';
import {
  launchClipAtTime, stopLane, stopAll,
  type RecHooks,
} from '../session/session-runtime';
import { renderPerformanceView } from '../performance/performance-ui';
import { buildMiniMaster } from '../core/master-strip';
import { createLevelMeter } from '../core/level-meter';
import { arrangementFromSession } from '../performance/arrangement-from-session';
import { createHistory } from '../core/history';
import { moveEvent, resizeEvent, deleteEvent } from '../performance/arrangement-edit';

export interface PerformanceFeatureDeps {
  ctx: AudioContext;
  seq: Sequencer;
  sessionHost: SessionHost;
  automationRegistry: Map<string, KnobHandle>;
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
  /** Optional master meter tap — feeds the compact master VU in the Performance
   *  toolbar (the full master strip is hidden with the session root in Perf). */
  masterMeterAnalyser?: AnalyserNode;
  /** Optional #volume input — the Performance mini master fader proxies it. */
  volInput?: HTMLInputElement;
}

export interface PerformanceFeature {
  rec: RecState;
  arrangement: ArrangementState;
  arrangementPlayState: ArrangementPlayState;
  recHooks: RecHooks;
  getMode: () => 'session' | 'performance';
  setMode: (m: 'session' | 'performance') => void;
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
  /** Toggle the Performance "take" arm (clip launches + knob automation).
   *  Returns the new armed state. Called by main's unified REC button. */
  toggleTakeRec: () => boolean;
}

export function createPerformanceFeature(deps: PerformanceFeatureDeps): PerformanceFeature {
  const { ctx, seq, sessionHost, automationRegistry, onRegisterKnob, onPerformanceEdited } = deps;

  const rec = createRecState();
  const arrangement = emptyArrangementState(seq.bpm);
  const arrangementPlayState = createArrangementPlayState();
  const recHooks: RecHooks = { rec, arrangement };
  let mode: 'session' | 'performance' = 'session';

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
  const laneIds = () => sessionHost.state.lanes.map((l) => l.id);

  // VU meters built into the performance toolbar register here so we can tear
  // them down before each re-render (renderPerformanceView wipes the host),
  // mirroring the mixer row's disposal channel — otherwise each refresh would
  // leak the meter's analyser registration with the shared RAF loop.
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
    if (rec.armed && seq.isPlaying()) startRecording(rec, ctx.currentTime);
    return rec.armed;
  }

  const flashToast = (msg: string) => {
    const t = document.createElement('div');
    t.className = 'perf-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('fade'); }, 1700);
    setTimeout(() => { t.remove(); }, 2200);
  };

  const beforeEdit = () => commitArrUndo();

  function editBands(laneId: string, fn: (events: import('../performance/performance').ArrangementClipEvent[]) => import('../performance/performance').ArrangementClipEvent[]) {
    const lane = arrangement.lanes.find((l) => l.laneId === laneId);
    if (!lane) return;
    lane.clipEvents = fn(lane.clipEvents);
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
    const wrap = document.createElement('div');
    wrap.className = 'perf-lane-ctrls';
    const mkBtn = (cls: string, text: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = document.createElement('button');
      b.className = `perf-lane-btn ${cls}`;
      b.textContent = text;
      if (get()) b.classList.add('active');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        set(!get());
        b.classList.toggle('active', get());
        md.applyMuteSolo();
      });
      return b;
    };
    const m = mkBtn('mute', 'M', () => !!md.muteState[laneId], (v) => { md.muteState[laneId] = v; });
    const s = mkBtn('solo', 'S', () => !!md.soloState[laneId], (v) => { md.soloState[laneId] = v; });
    const vu = createLevelMeter({ analyser: strip.getMeterAnalyser() });
    perfDisposables.push(vu);
    wrap.append(m, s, vu.el);
    return wrap;
  }

  function refreshPerformanceView() {
    const host = document.getElementById('performance-view-root');
    if (!host) return;
    // Tear down the previous toolbar's VU meter(s) before renderPerformanceView
    // wipes the host (host.innerHTML = ''), so they don't leak their analyser
    // registration with the shared RAF loop across re-renders.
    for (const d of perfDisposables) d.dispose();
    perfDisposables = [];
    const findClip = (id: string) => {
      for (const lane of sessionHost.state.lanes)
        for (const c of lane.clips) if (c?.id === id) return c;
      return null;
    };
    renderPerformanceView(host, arrangement, {
      onPlay: () => beginArrangement(),
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
      laneIds: laneIds(),
      pxPerBar,
      getBrush: () => brush,
      setBrush: (b) => { brush = b; },
      painterDeps: { seq, getAutoAbsSubIdx: () => 0 },
      onSetLengthBars: (bars) => { beforeEdit(); setArrangementLengthBars(arrangement, bars); refreshPerformanceView(); },
      onZoom: (px) => { pxPerBar = px; scheduleZoomRefresh(); },
      onAddCurve: (paramId) => { beforeEdit(); addAutomationCurve(arrangement, paramId, laneIds()); refreshPerformanceView(); },
      onRemoveCurve: (paramId) => { beforeEdit(); removeAutomationCurve(arrangement, paramId, laneIds()); refreshPerformanceView(); },
      onEdited: () => { onPerformanceEdited?.(); },
      loopEnabled: !!arrangement.loopEnabled,
      loopStartBar: arrangement.loopStartBar ?? 0,
      loopEndBar: arrangement.loopEndBar ?? Math.ceil(effectiveDurationSec(arrangement) / ((60 / arrangement.bpm) * 4)),
      onSetLoop: (enabled, startBar, endBar) => {
        beforeEdit();
        arrangement.loopEnabled = enabled; arrangement.loopStartBar = startBar; arrangement.loopEndBar = endBar;
        refreshPerformanceView();
      },
      onMoveBand: (laneId, index, newAtSec) => { commitArrUndo(); editBands(laneId, (evs) => moveEvent(evs, index, newAtSec, arrangement.bpm)); },
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

  function setMode(next: 'session' | 'performance') {
    if (mode === next) return;
    if (seq.isPlaying()) seq.stop();
    if (arrangementPlayState.isPlaying) stopArrangement(arrangementPlayState);
    // seq.stop()/stopArrangement only halt FUTURE look-ahead triggers; a clip's
    // already-scheduled whole-loop source (the 'audio' channel) plays on. Silence
    // live voices so switching modes doesn't leave an audio/stem clip ringing.
    stopAll(sessionHost.laneStates, sessionHost.deps.liveVoices, ctx.currentTime);
    mode = next;
    document.querySelectorAll('#mode-toggle .mode-btn').forEach((b) => {
      b.classList.toggle('on', (b as HTMLElement).dataset.mode === next);
    });
    const sessionRoot = document.getElementById('session-view-root');
    const perfRoot = document.getElementById('performance-view-root');
    if (sessionRoot) sessionRoot.hidden = next !== 'session';
    if (perfRoot) perfRoot.hidden = next !== 'performance';
    if (next === 'performance') refreshPerformanceView();
  }
  document.querySelectorAll('#mode-toggle .mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      setMode((b as HTMLElement).dataset.mode as 'session' | 'performance');
    });
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

  function setArrangement(a: ArrangementState) {
    Object.assign(arrangement, a);
    refreshPerformanceView();
  }

  function copyFromSession() {
    const built = arrangementFromSession(sessionHost.state, seq.bpm, seq.meter);
    setArrangement(built);
    setMode('performance');
  }

  function arrangementOnLaunchClip(laneId: string, clipId: string, atCtx: number) {
    const state = sessionHost.state;
    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    const clip = lane.clips.find((c) => c?.id === clipId);
    if (!clip) return;
    // Honour the arrangement's exact start time (startedAtCtx + atSec). Never
    // re-quantize to the session bar grid — that snapped the first event to the
    // next absolute bar boundary, leaving a silent first bar. Clamp to now so the
    // very first event (atSec 0, already a hair in the past once the tick fires)
    // schedules immediately rather than at a past time.
    launchClipAtTime(sessionHost.laneStates, lane, clip, Math.max(atCtx, ctx.currentTime));
  }
  function arrangementOnStopLane(laneId: string) {
    stopLane(sessionHost.laneStates, laneId, {
      ...recHooks, nowCtx: ctx.currentTime, silence: sessionHost.deps.liveVoices,
    });
  }
  function arrangementApplyAutomation(paramId: string, valueNorm: number) {
    const k = automationRegistry.get(paramId);
    if (!k) return;
    const v = k.meta.min + valueNorm * (k.meta.max - k.meta.min);
    k.setValue(v);
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
    if (mode === 'performance') {
      tickArrangement({
        ps: arrangementPlayState, state: arrangement, nowCtx, lookaheadSec,
        bpm: arrangement.bpm || seq.bpm,
        onLaunchClip: arrangementOnLaunchClip,
        onStopLane: arrangementOnStopLane,
        applyAutomation: arrangementApplyAutomation,
        loopWindow: arrangementLoopWindowSec(arrangement),
        onArrangementEnd: () => { stopAll(sessionHost.laneStates, sessionHost.deps.liveVoices, ctx.currentTime); stopArrangement(arrangementPlayState); deps.onArrangementEnd?.(); },
      });
    }
  }

  function onPlay(): boolean {
    if (mode === 'performance') {
      if (rec.armed) {
        disarmRec(rec);
        deps.onRecVisualChanged?.();
        flashToast('REC disarmed: Performance is playing');
      }
      beginArrangement();
      return true;
    }
    if (rec.armed) startRecording(rec, ctx.currentTime);
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

  // The playhead RAF only runs while actually animating (Performance mode AND
  // playing). It used to re-queue itself unconditionally and never cancel, so it
  // did 3 DOM lookups + a style write every frame forever — even sitting idle in
  // Session mode. ensurePlayheadLoop() (re)starts it when playback begins; the
  // loop parks itself (one final pass to hide the cursor) when playback stops.
  let playheadRaf = 0;
  function rafPlayhead() {
    const animating = mode === 'performance' && arrangementPlayState.isPlaying;
    const el = document.getElementById('perf-playhead');
    if (el) {
      const host = document.getElementById('performance-view-root');
      const rulerTrack = host?.querySelector('.perf-ruler .perf-track') as HTMLElement | null;
      if (animating && host && rulerTrack) {
        const barSec = (60 / (arrangement.bpm || seq.bpm)) * 4;
        const lw = arrangementLoopWindowSec(arrangement);
        let sec = arrangementPlayhead(arrangementPlayState, ctx.currentTime);
        if (lw.active) sec = lw.startSec + ((sec - lw.startSec) % (lw.endSec - lw.startSec));
        const bars = sec / barSec;
        // Position against the REAL ruler-track rect so the cursor lines up with
        // bar 1 regardless of the host padding, the label column, the toolbar
        // height or horizontal scroll. (The old hardcoded 90/26 offsets ignored
        // all of these → the cursor sat ~20px left of bar 1 and over the toolbar.)
        const hostRect = host.getBoundingClientRect();
        const trackRect = rulerTrack.getBoundingClientRect();
        el.style.left = `${(trackRect.left - hostRect.left) + bars * pxPerBar - rulerTrack.scrollLeft}px`;
        el.style.top = `${trackRect.top - hostRect.top}px`;
        el.style.display = 'block'; // '' would fall back to the CSS display:none
      } else {
        el.style.display = 'none';
      }
    }
    playheadRaf = animating ? requestAnimationFrame(rafPlayhead) : 0;
  }
  function ensurePlayheadLoop() {
    if (playheadRaf === 0) playheadRaf = requestAnimationFrame(rafPlayhead);
  }
  function beginArrangement() {
    // With an active A-B loop, Play starts at A (the marked point), not at 0.
    const lw = arrangementLoopWindowSec(arrangement);
    if (lw.active && lw.startSec > 0) {
      startArrangementAt(arrangementPlayState, ctx.currentTime, arrangement, lw.startSec, arrangementOnLaunchClip);
    } else {
      startArrangement(arrangementPlayState, ctx.currentTime);
    }
    ensurePlayheadLoop();
  }

  refreshPerformanceView();

  return {
    rec, arrangement, arrangementPlayState, recHooks,
    getMode: () => mode,
    setMode,
    setArrangement,
    refreshPerformanceView,
    onLookahead,
    onPlay,
    onStop,
    copyFromSession,
    toggleTakeRec,
  };
}
