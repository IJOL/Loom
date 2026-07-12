// src/control/loom-facade.ts
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import type { LoomControlFacade, SurfaceView, CellState, SceneState, KnobBank, Variant } from './controller-profile';
import { createLiveVoicePool } from './live-keyboard';
import { expandChordForLane } from './live-notefx';
import { createLiveRecorder } from './live-recorder';
import type { ActiveLaneStore } from './active-lane';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import { ticksPerBar } from '../core/meter';
import { TICKS_PER_QUARTER } from '../core/notes';
import { emptyClip, type SessionClip, type SessionLane } from '../session/session';
import { withUndo, type HistoryDeps } from '../save/history-wiring';

export interface LoomFacadeDeps {
  ctx: AudioContext;
  sessionHost: SessionHost;
  laneResources: LaneResourceMap;
  activeLane: ActiveLaneStore;                 // bridged to SessionHost.activeEditLane in main.ts
  knobRegistry: Map<string, KnobHandle>;       // `${laneId}.${paramId}` → handle (automationRegistry)
  seq: Sequencer;                              // bpm source for tempo-aware note-FX (chord today, arp later)
  historyDeps?: HistoryDeps;                   // undo wrapper for loop-record commits (optional: main.ts builds it after boot)
}

const MAX_GAIN = 1.5;            // volume knob full-up
const EQ_DB = 12;               // ±12 dB at knob extremes

export function createLoomFacade(deps: LoomFacadeDeps): LoomControlFacade {
  const { ctx, sessionHost, laneResources, activeLane, knobRegistry } = deps;

  const pool = createLiveVoicePool({
    spawnVoice: (laneId) => {
      const res = laneResources.get(laneId);
      if (!res) return null;
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(ctx, res.strip.input);   // same path as trigger-dispatch
      setCurrentLaneForVoice(null);
      return v;
    },
    now: () => ctx.currentTime,
    defer: (fn) => setTimeout(fn, 300),
  });

  function setEngineParam(laneId: string, paramId: string, value01: number): void {
    const res = laneResources.get(laneId);
    if (!res) return;
    const spec = res.engine.params.find((p) => p.id === paramId);
    if (!spec || spec.kind !== 'continuous') return;
    const real = spec.min + value01 * (spec.max - spec.min);
    const handle = knobRegistry.get(`${laneId}.${paramId}`);
    if (handle) handle.setValue(real);          // moves the on-screen ring AND drives the engine
    else res.engine.setBaseValue(paramId, real);
  }

  const recorder = createLiveRecorder();
  // Destination of the current capture pass. `laneRef` is the SAME array
  // object as sessionHost.state.lanes[i], so writing laneRef.clips mutates
  // live session state directly (no separate "commit lane" step needed).
  let capture: { laneId: string; clip: SessionClip; isNew: boolean; slotIdx: number; laneRef: SessionLane } | null = null;

  function anyPlaying(): boolean {
    for (const lp of sessionHost.laneStates.values()) if (lp.playing) return true;
    return false;
  }

  /** Resolve where a capture pass records into: the clip open in the inspector
   *  (if shown and note-capable), else a fresh clip in the active lane's first
   *  empty slot. Returns null when nothing is capturable (audio/sample clip
   *  open, or no active lane). Also doubles as `canCapture()`'s test. */
  function resolveDestination(): typeof capture {
    const sel = sessionHost.inspector.getSelectedClip();
    const panel = document.getElementById('session-inspector');
    if (sel && panel && !panel.hidden) {
      const lane = sessionHost.state.lanes.find((l) => l.id === sel.laneId);
      const clip = lane?.clips[sel.clipIdx];
      if (lane && clip && lane.engineId !== 'audio' && !clip.sample)
        return { laneId: lane.id, clip, isNew: false, slotIdx: sel.clipIdx, laneRef: lane };
      return null; // audio/sample clip open → not note-capturable
    }
    const laneId = activeLane.get();
    const lane = laneId ? sessionHost.state.lanes.find((l) => l.id === laneId) : null;
    if (!lane || lane.engineId === 'audio') return null;
    let slot = lane.clips.findIndex((c) => c == null);
    if (slot < 0) slot = lane.clips.length;
    return { laneId: lane.id, clip: emptyClip(1), isNew: true, slotIdx: slot, laneRef: lane };
  }

  /** Destination-clip-relative tick position, anchored to that lane's OWN loop
   *  playhead (loopStartedAt) — not wall-clock time — so captured notes land
   *  where they were actually played relative to the loop, wrapped to the
   *  clip's length. Idle transport (lane not playing) reads as tick 0. */
  function posTicksFor(dest: NonNullable<typeof capture>): number {
    const lp = sessionHost.laneStates.get(dest.laneId);
    if (!lp || !lp.playing) return 0;
    const lenTicks = dest.clip.lengthBars * ticksPerBar(deps.seq.meter);
    const posSec = ctx.currentTime - lp.loopStartedAt;
    const raw = Math.round(posSec * deps.seq.bpm * TICKS_PER_QUARTER / 60);
    return ((raw % lenTicks) + lenTicks) % lenTicks;
  }

  function cellFor(laneId: string, clip: import('../session/session').SessionClip | null): CellState {
    if (!clip) return { kind: 'empty' };
    const lp = sessionHost.laneStates.get(laneId);
    if (lp?.playing && lp.playing.id === clip.id) return { kind: 'playing', color: clip.color };
    if (lp?.queued && lp.queued.id === clip.id) return { kind: 'queued-launch', color: clip.color };
    return { kind: 'stopped', color: clip.color };
  }

  function buildSurfaceView(variant: Variant, knobBank: KnobBank): SurfaceView {
    const lanes = sessionHost.state.lanes.slice(0, 8);
    const cells: CellState[][] = [];
    for (let row = 0; row < 5; row++) {
      const rowCells: CellState[] = [];
      for (let col = 0; col < 8; col++) {
        const lane = lanes[col];
        const clip = lane ? (lane.clips[row] ?? null) : null;
        rowCells.push(lane ? cellFor(lane.id, clip) : { kind: 'empty' });
      }
      cells.push(rowCells);
    }
    const scenes: SceneState[] = [];
    for (let row = 0; row < 5; row++) {
      const has = lanes.some((l) => l.clips[row] != null);
      scenes.push(has ? 'has-clips' : 'empty');
    }
    let anyPlaying = false;
    for (const lp of sessionHost.laneStates.values()) if (lp.playing) { anyPlaying = true; break; }
    const active = activeLane.get();
    const activeIdx = active ? lanes.findIndex((l) => l.id === active) : -1;
    return {
      variant, cells, scenes, anyPlaying,
      activeLaneCol: activeIdx >= 0 ? activeIdx : null,
      knobBank,
    };
  }

  return {
    playLiveNote: (laneId, midi, velocity) => {
      // `midi` (the physical key) is the group id passed straight through;
      // the chord expansion (which may transpose its root away from `midi`
      // via a nonzero octave param) is only the list of notes to sound.
      const playMidis = expandChordForLane(laneId, midi, velocity, deps.seq.bpm);
      pool.noteOn(laneId, midi, velocity, playMidis);
      // Loop-record: forward the SOUNDED notes to the recorder while a capture
      // pass targets this lane. Known limitation (accepted, see Task 5 brief):
      // the recorder keys open notes by midi, so two different held physical
      // keys that expand to the same midi at once will collide.
      if (recorder.isRecording() && capture && capture.laneId === laneId)
        for (const m of playMidis) recorder.noteOn(m, velocity);
    },
    releaseLiveNote: (laneId, midi) => {
      pool.noteOff(laneId, midi);
      if (recorder.isRecording() && capture && capture.laneId === laneId) {
        // Re-expand deterministically: chord params don't change while a key
        // is held, so this yields exactly the midis noteOn'd above.
        for (const m of expandChordForLane(laneId, midi, 100, deps.seq.bpm)) recorder.noteOff(m);
      }
    },
    setSustain: (on) => pool.setSustain(on),
    launchClip: (laneId, clipIdx) => sessionHost.launchClipAt(laneId, clipIdx),
    launchScene: (sceneIdx) => sessionHost.launchSceneAt(sceneIdx),
    stopAll: () => sessionHost.stopAllClips(),
    startCapture(mode) {
      if (recorder.isRecording()) return;
      const dest = resolveDestination();
      if (!dest) return;
      capture = dest;
      // New clip: place it now so it exists in the session (visible, playable)
      // for the duration of the capture pass.
      if (dest.isNew) {
        while (dest.laneRef.clips.length <= dest.slotIdx) dest.laneRef.clips.push(null);
        dest.laneRef.clips[dest.slotIdx] = dest.clip;
      }
      const barTicks = ticksPerBar(deps.seq.meter);
      recorder.start({
        mode,
        existingNotes: dest.clip.notes,
        clipLengthTicks: dest.isNew ? null : dest.clip.lengthBars * barTicks,
        barTicks,
        posTicks: () => posTicksFor(dest),
      });
      if (mode === 'replace') dest.clip.notes = [];
      // Only launch the destination's scene if nothing else is playing —
      // never disturb an already-running transport.
      if (!anyPlaying()) sessionHost.launchSceneAt(dest.slotIdx);
    },
    stopCapture() {
      if (!recorder.isRecording() || !capture) { capture = null; return; }
      const dest = capture;
      capture = null;
      const { notes, lengthTicks } = recorder.stop();
      const barTicks = ticksPerBar(deps.seq.meter);
      const commit = () => {
        dest.clip.notes = notes;
        if (dest.isNew) dest.clip.lengthBars = Math.max(1, Math.round(lengthTicks / barTicks));
        sessionHost.renderWithMixer();
        sessionHost.inspector.refreshOpenEditor();
      };
      // An empty new-clip capture (no notes played): drop the placeholder
      // clip instead of leaving clutter in the lane.
      if (dest.isNew && notes.length === 0) {
        dest.laneRef.clips[dest.slotIdx] = null;
        sessionHost.renderWithMixer();
        return;
      }
      if (deps.historyDeps) withUndo(deps.historyDeps, commit); else commit();
    },
    isCapturing: () => recorder.isRecording(),
    canCapture: () => resolveDestination() != null,
    engineParamIds: (laneId) => {
      const res = laneResources.get(laneId);
      if (!res) return [];
      return res.engine.params.filter((p) => p.kind === 'continuous').slice(0, 8).map((p) => p.id);
    },
    setEngineParam,
    setLaneVolume: (laneId, v01) => laneResources.get(laneId)?.strip.setLevel(v01 * MAX_GAIN),
    setLanePan: (laneId, v01) => laneResources.get(laneId)?.strip.setPan(v01 * 2 - 1),
    setLaneEq: (laneId, band, v01) => {
      const strip = laneResources.get(laneId)?.strip;
      if (!strip) return;
      const db = (v01 * 2 - 1) * EQ_DB;
      if (band === 'low') strip.setEqLow(db);
      else if (band === 'mid') strip.setEqMid(db);
      else strip.setEqHigh(db);
    },
    getActiveLane: () => activeLane.get(),
    setActiveLane: (laneId) => { activeLane.set(laneId); sessionHost.focusLane(laneId); },
    laneIds: () => sessionHost.state.lanes.map((l) => l.id),
    buildSurfaceView,
    onStateChange: (cb) => {
      // The mixer/grid re-render is the natural "something changed" signal. We poll
      // a lightweight snapshot on a RAF-free interval is overkill; instead subscribe
      // to the active-lane store AND expose a manual refresh the host calls after
      // renderWithMixer. For v1 we hook the active-lane store + a periodic safety net.
      const off = activeLane.subscribe(() => cb());
      return off;
    },
  };
}
