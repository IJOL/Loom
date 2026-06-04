// src/session/clip-editors/clip-editor-router.ts
// Detects the engine assigned to the lane and dispatches to the matching
// editor (piano-roll or drum-grid). Falls back to piano-roll if engine has
// no explicit preference.

import type { SessionClip, SessionLane } from '../session';
import type { Sequencer } from '../../core/sequencer';
import type { LanePlayState } from '../session-runtime';
import { createPianoRoll, type PianoRollHandle } from '../../core/pianoroll';
import { pianoRollRange } from '../../core/pianoroll-range';
import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';
import { ticksPerBar, stepsPerBar, stepsPerBeat } from '../../core/meter';
import { resolveViewState, type ViewState } from '../../core/pianoroll-zoom';
import { getEngine } from '../../engines/registry';
import { renderDrumGridEditor } from './clip-editor-drum-grid';
import type { HistoryDeps } from '../../save/history-wiring';

export interface ClipEditorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  laneStates: Map<string, LanePlayState>;
  midiLabel: (m: number) => string;
  historyDeps?: HistoryDeps;
  triggerForLane?: (laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => void;
}

const AUDITION_GATE = 0.25; // seconds — short preview blip, shared by both editors

// In-memory per-clip zoom/scroll. Mirrors the editorOverride map: persists for
// the session, resets on reload. No saved-state schema change.
const viewStateByClip = new Map<string, ViewState>();

/** Decide which editor a lane's clip uses. Precedence: an explicit per-clip
 *  override → a drumkit-loaded sampler (8-pad grid) → the engine's native
 *  editor → piano-roll. Pure so it can be unit-tested without the DOM. */
export function chooseClipEditor(
  lane: SessionLane,
  engineEditor: 'piano-roll' | 'drum-grid' | undefined,
  override?: 'piano-roll' | 'drum-grid',
): 'piano-roll' | 'drum-grid' {
  // A sampler lane that has loaded a drumkit edits on the 8-pad drum grid;
  // a plain sampler stays on the piano roll. drumkitId is the single source
  // of truth (set by the sampler kit picker, persisted in engineState).
  const isDrumkitSampler = lane.engineId === 'sampler' && !!lane.engineState?.sampler?.drumkitId;
  return override ?? (isDrumkitSampler ? 'drum-grid' : undefined) ?? engineEditor ?? 'piano-roll';
}

export function renderClipEditor(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  override?: 'piano-roll' | 'drum-grid',
): PianoRollHandle | null {
  host.innerHTML = '';
  const engine = getEngine(lane.engineId);
  const editor = chooseClipEditor(lane, engine?.editor, override);

  if (editor === 'drum-grid') {
    const audition = deps.triggerForLane
      ? (midi: number) => deps.triggerForLane!(lane.id, midi, deps.ctx.currentTime, AUDITION_GATE, false, false)
      : undefined;
    const getPlayheadTick = (): number => {
      const lp = deps.laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const stepDur = 60 / deps.seq.bpm / 4;
      const stepsElapsed = Math.max(0, (deps.ctx.currentTime - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * stepsPerBar(deps.seq.meter);
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    };
    return renderDrumGridEditor(host, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition, getPlayheadTick });
  }
  return buildPianoRoll(host, lane, clip, deps);
}

function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
): PianoRollHandle {
  const getNotes = (): NoteEvent[] => clip.notes ?? [];
  const setNotes = (notes: NoteEvent[]) => { clip.notes = notes; };

  const { ctx, seq, laneStates, historyDeps, triggerForLane } = deps;
  // Full orchestral range (C0..C8), widened so every note already in the clip
  // is visible — no engine-specific narrowing.
  const { minMidi, maxMidi } = pianoRollRange(getNotes());
  return createPianoRoll({
    host,
    getNotes,
    setNotes,
    patternTicks: clip.lengthBars * ticksPerBar(seq.meter),
    stepsPerBar: stepsPerBar(seq.meter),
    stepsPerBeat: stepsPerBeat(seq.meter),
    minMidi,
    maxMidi,
    onChange: () => {},
    auditionNote: triggerForLane
      ? (midi: number) => triggerForLane(lane.id, midi, ctx.currentTime, AUDITION_GATE, false, false)
      : undefined,
    getPlayheadTick: () => {
      const lp = laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const now = ctx.currentTime;
      const stepDur = 60 / seq.bpm / 4;
      const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * stepsPerBar(seq.meter);
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    },
    viewState: resolveViewState(viewStateByClip, clip.id),
    onViewChange: (v) => { viewStateByClip.set(clip.id, v); },
    ...(historyDeps ? {
      onGestureStart:  () => historyDeps.history.beginGesture(historyDeps.snapshot()),
      onGestureEnd:    () => historyDeps.history.commitGesture(),
      onGestureCancel: () => historyDeps.history.cancelGesture(),
    } : {}),
  });
}
