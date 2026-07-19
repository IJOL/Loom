// src/control/loom-facade.ts
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import type { LoomControlFacade, SurfaceView, CellState, SceneState, KnobBank, Variant } from './controller-profile';
import { createLiveVoicePool } from './live-keyboard';
import { expandChordForLane } from './live-notefx';
import { createLiveRecorder } from './live-recorder';
import { createLiveArp } from './live-arp';
import type { ActiveLaneStore } from './active-lane';
import type { SessionHost } from '../session/session-host';
import type { LaneResourceMap } from '../core/lane-resources';
import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import { ticksPerBar, type TimeSignature } from '../core/meter';
import { TICKS_PER_QUARTER } from '../core/notes';
import { emptyClip, type SessionClip, type SessionLane } from '../session/session';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { parseAutomationParamId } from '../automation/automation-apply';
import type { DestinationRegistry } from '../automation/destination-registry';

export interface LoomFacadeDeps {
  ctx: AudioContext;
  sessionHost: SessionHost;
  laneResources: LaneResourceMap;
  activeLane: ActiveLaneStore;                 // bridged to SessionHost.activeEditLane in main.ts
  knobRegistry: Map<string, KnobHandle>;       // `${laneId}.${paramId}` → handle (automationRegistry)
  destinations: DestinationRegistry;           // the ONE automation-destination catalogue (built in main.ts)
  seq: Sequencer;                              // bpm source for tempo-aware note-FX (chord today, arp later)
  historyDeps?: HistoryDeps;                   // undo wrapper for loop-record commits (optional: main.ts builds it after boot)
  /** Optional 1-bar count-in before Rec starts from idle: plays a metronome, then
   *  calls onComplete to begin recording. Returns a cancel fn. Absent → no
   *  count-in (immediate capture). */
  countIn?: (bars: number, bpm: number, meter: TimeSignature, onComplete: () => void) => (() => void);
}

const MAX_GAIN = 1.5;            // volume knob full-up
const EQ_DB = 12;               // ±12 dB at knob extremes

export function createLoomFacade(deps: LoomFacadeDeps): LoomControlFacade {
  const { ctx, sessionHost, laneResources, activeLane, knobRegistry, destinations } = deps;

  const spawnVoice = (laneId: string) => {
    const res = laneResources.get(laneId);
    if (!res) return null;
    setCurrentLaneForVoice(laneId);
    const v = res.engine.createVoice(ctx, res.strip.input);   // same path as trigger-dispatch
    setCurrentLaneForVoice(null);
    return v;
  };
  const pool = createLiveVoicePool({
    spawnVoice,
    now: () => ctx.currentTime,
    defer: (fn) => setTimeout(fn, 300),
  });
  // Live arpeggiator: shares the same voice-spawn path as the pool.
  const liveArp = createLiveArp({ spawnVoice, now: () => ctx.currentTime, bpm: () => deps.seq.bpm });

  // `paramId` is EITHER a canonical destination id scoped to `laneId`
  // (`<laneId>.<engineParam>` or `<laneId>.fx:<slotId>.<param>`, as returned
  // by engineParamIds below) OR the legacy bare local id the profile still
  // sends (`cutoff`, `filter.cutoff`). Deciding which by trying to PARSE the
  // id blind is a trap: most engine param ids are themselves dotted
  // (`filter.cutoff`, `osc1.detune` — see engine-params across every engine),
  // so parseAutomationParamId('filter.cutoff') would misread 'filter' as a
  // lane id and drop the param. Checking the `<laneId>.` prefix FIRST avoids
  // that — a bare id never happens to start with this exact lane's own id.
  function setEngineParam(laneId: string, paramId: string, value01: number): void {
    const canonical = paramId.startsWith(`${laneId}.`);
    const parsed = canonical ? parseAutomationParamId(paramId) : null;

    if (parsed?.kind === 'insert') {
      // Scoped to the lane's OWN chain only — master/send racks never appear
      // here because engineParamIds already filtered to `t.laneId === laneId`.
      const chain = laneResources.get(laneId)?.inserts;
      const slot = chain?.list().find((s) => s.id === parsed.slotId);
      if (!slot) return;
      const target = destinations.list().find((t) => t.id === paramId);
      if (!target) return;
      const real = target.min + value01 * (target.max - target.min);
      const handle = knobRegistry.get(paramId);
      if (handle) handle.setValue(real);          // moves the on-screen ring AND drives the fx
      else slot.fx.setBaseValue(parsed.paramId, real);
      return;
    }

    const res = laneResources.get(laneId);
    if (!res) return;
    const localId = parsed?.kind === 'engine' ? parsed.paramId : paramId;
    const spec = res.engine.params.find((p) => p.id === localId);
    if (!spec || spec.kind !== 'continuous') return;
    const real = spec.min + value01 * (spec.max - spec.min);
    const handle = knobRegistry.get(canonical ? paramId : `${laneId}.${localId}`);
    if (handle) handle.setValue(real);          // moves the on-screen ring AND drives the engine
    else res.engine.setBaseValue(localId, real);
  }

  const recorder = createLiveRecorder();
  // Destination of the current capture pass. `laneRef` is the SAME array
  // object as sessionHost.state.lanes[i], so writing laneRef.clips mutates
  // live session state directly (no separate "commit lane" step needed).
  let capture: { laneId: string; clip: SessionClip; isNew: boolean; slotIdx: number; laneRef: SessionLane } | null = null;
  // Set while a count-in is playing (before recording actually starts) so
  // stopCapture can cancel it and isCapturing() reflects the armed state.
  let countInCancel: (() => void) | null = null;
  // While a capture pass is open we hold ONE undo gesture around it: notes are
  // appended to the live clip as they're played (so the grid shows them in real
  // time), which would otherwise make AutoHistory checkpoint on every keyup and
  // splinter the recording into many undo steps. The gesture bracket coalesces
  // the whole pass — clip placement + every note — into a single undo step.
  let recordingGestureOpen = false;
  const closeRecordingGesture = () => {
    if (!recordingGestureOpen) return;
    recordingGestureOpen = false;
    deps.historyDeps?.endGesture?.();
  };

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
      // If the lane has an arp note-FX enabled, the held note drives a live
      // arpeggio (from the current note, octaves collapsed to 1) instead of
      // sounding directly. Sound-only in v1 — arp steps are not recorded yet.
      if (liveArp.start(laneId, midi, velocity)) return;
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
      liveArp.stop(laneId, midi);      // halt the arp if this key started it (no-op otherwise)
      pool.noteOff(laneId, midi);      // no-op when the arp handled the key (no held group)
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
      if (recorder.isRecording() || countInCancel) return;
      const dest = resolveDestination();
      if (!dest) return;
      capture = dest;
      // Open ONE undo gesture for the whole pass (clip placement + count-in +
      // every recorded note) — closed in stopCapture. See recordingGestureOpen.
      deps.historyDeps?.beginGesture?.();
      recordingGestureOpen = true;
      // New clip: place it now so it exists in the session (visible, playable)
      // for the duration of the capture pass.
      if (dest.isNew) {
        while (dest.laneRef.clips.length <= dest.slotIdx) dest.laneRef.clips.push(null);
        dest.laneRef.clips[dest.slotIdx] = dest.clip;
      }
      // The actual "start recording" step — deferred behind the count-in below.
      const beginRecording = () => {
        const barTicks = ticksPerBar(deps.seq.meter);
        recorder.start({
          mode,
          // Snapshot the pre-recording notes: onCapture below appends captured
          // notes into dest.clip.notes live, so the recorder must NOT read that
          // same (now-mutating) array as its merge base — it would double-count.
          existingNotes: [...dest.clip.notes],
          clipLengthTicks: dest.isNew ? null : dest.clip.lengthBars * barTicks,
          barTicks,
          posTicks: () => posTicksFor(dest),
          // Mirror each completed note into the live clip. The session-host RAF
          // loop redraws the open piano-roll from clip.notes every frame, so the
          // note appears on the grid the instant the key is released. stopCapture
          // then overwrites clip.notes with the authoritative (clamped) result.
          onCapture: (note) => { dest.clip.notes.push(note); },
        });
        if (mode === 'replace') dest.clip.notes = [];
        // Nothing playing → launch the full scene for context. Otherwise, if the
        // destination clip isn't the one currently looping on its own lane (lane
        // idle, or playing a DIFFERENT clip), launch just that clip so it gets a
        // real loopStartedAt — without it, posTicksFor() has no playhead to
        // measure against and every captured note piles up at tick 0. Launching
        // only the destination clip (not the scene) never disturbs other lanes'
        // already-running transport. If the destination clip is already the one
        // playing on its lane, leave the transport alone and capture against its
        // running loop.
        if (!anyPlaying()) {
          sessionHost.launchSceneAt(dest.slotIdx);
        } else if (sessionHost.laneStates.get(dest.laneId)?.playing?.id !== dest.clip.id) {
          sessionHost.launchClipAt(dest.laneId, dest.slotIdx);
        }
      };
      // From idle, play a 1-bar count-in first so the performer can get in tempo.
      // Notes played during it still SOUND (playLiveNote is unchanged) but aren't
      // recorded — the recorder isn't started until beginRecording runs. When
      // something is already playing (already in time), or no count-in is wired,
      // record immediately.
      if (!anyPlaying() && deps.countIn) {
        countInCancel = deps.countIn(1, deps.seq.bpm, deps.seq.meter, () => {
          countInCancel = null;
          beginRecording();
        });
      } else {
        beginRecording();
      }
    },
    stopCapture() {
      // Cancel a running count-in (recording never started): stop the metronome,
      // drop the placeholder clip, no commit.
      if (countInCancel) {
        countInCancel();
        countInCancel = null;
        const dest = capture; capture = null;
        if (dest?.isNew) { dest.laneRef.clips[dest.slotIdx] = null; sessionHost.renderWithMixer(); }
        closeRecordingGesture();
        return;
      }
      if (!recorder.isRecording() || !capture) { capture = null; closeRecordingGesture(); return; }
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
        closeRecordingGesture();
        return;
      }
      if (deps.historyDeps) withUndo(deps.historyDeps, commit); else commit();
      // Close the gesture AFTER the commit so AutoHistory's endGesture checkpoint
      // captures the whole recording (pre-record baseline → committed notes) as
      // one undo step.
      closeRecordingGesture();
    },
    isCapturing: () => recorder.isRecording() || countInCancel != null,
    canCapture: () => resolveDestination() != null,
    // Canonical ids, engine params first then this lane's own insert params
    // (listAutomationTargets' declared order — verified in loom-facade.test.ts),
    // sliced to the device bank's 8 knobs. Never reaches master/send racks:
    // the filter below only keeps targets whose laneId is this exact lane.
    engineParamIds: (laneId) => destinations.list()
      .filter((t) => t.laneId === laneId)
      .map((t) => t.id)
      .slice(0, 8),
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
