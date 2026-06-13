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
import { renderDrumGridEditor, LANE_LABELS, type DrumGridModel } from './clip-editor-drum-grid';
import { noteDrumRows } from '../../core/drum-grid-editing';
import { GM_DRUM_MAP } from '../../engines/drum-gm-map';
import { mountWaveformHeader, renderAudioClipEditor } from './clip-waveform-header';
import type { HistoryDeps } from '../../save/history-wiring';
import { mountClipLoopBrace } from '../../core/clip-loop-brace';
import type { LaneResourceMap } from '../../core/lane-resources';
import type { KnobHandle } from '../../core/knob';
import type { EngineUIContext } from '../../engines/engine-types';
import type { SessionState } from '../session';

export interface ClipEditorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  laneStates: Map<string, LanePlayState>;
  midiLabel: (m: number) => string;
  historyDeps?: HistoryDeps;
  triggerForLane?: (
    laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean,
    sample?: import('../session').ClipSample,
    velocity?: number,
  ) => void;
  /** Phase 2a: per-lane resources (to reach the audio lane's engine) +
   *  automation registry + session state, so the audio clip editor can mount
   *  the engine's Gain knob as an automatable control. Optional so non-audio
   *  callers/tests are unaffected. */
  laneResources?: LaneResourceMap;
  automationRegistry?: Map<string, KnobHandle>;
  sessionState?: SessionState;
}

const AUDITION_GATE = 0.25; // seconds — short preview blip, shared by both editors

// In-memory per-clip zoom/scroll. Mirrors the editorOverride map: persists for
// the session, resets on reload. No saved-state schema change.
const viewStateByClip = new Map<string, ViewState>();

/** Decide which editor a lane's clip uses. Precedence: an explicit per-clip
 *  override → a drumkit sampler (variable-size drum grid) → the engine's native
 *  editor → piano-roll. Pure so it can be unit-tested without the DOM. */
export function chooseClipEditor(
  lane: SessionLane,
  engineEditor: 'piano-roll' | 'drum-grid' | undefined,
  override?: 'piano-roll' | 'drum-grid',
  clip?: SessionClip,
): 'piano-roll' | 'drum-grid' {
  // A sampler drumkit edits on the drum grid; a melodic sampler stays on the
  // piano roll. Detection is note-agnostic so a variable-size kit (>8 pads, off
  // the GM map) still routes here: a loaded kit (drumkitId) OR a keymap whose
  // every entry is a single-note pad (loNote===hiNote===rootNote). A melodic
  // instrument uses range zones (loNote<hiNote), so it never trips the second test.
  const sampler = lane.engineState?.sampler;
  const km = sampler?.keymap ?? [];
  const allSingleNote = km.length > 0 && km.every((e) => e.loNote === e.hiNote && e.hiNote === e.rootNote);
  // A loop slice bank is ALSO single-note, but it's edited in the piano-roll. A
  // bundled loop preset carries an instrumentId; a user-imported loop has neither
  // id but DOES carry a waveform slice bank on its clip — recognise both so a
  // sliced loop never falls into the drumkit branch.
  const isLoopClip = !!clip?.waveformRef?.slices?.length;
  const isDrumkitSampler = !isLoopClip && lane.engineId === 'sampler'
    && (!!sampler?.drumkitId || (allSingleNote && !sampler?.instrumentId));
  return override ?? (isDrumkitSampler ? 'drum-grid' : undefined) ?? engineEditor ?? 'piano-roll';
}

/** Build the drum-grid row model for a sampler drumkit lane: one row per pad,
 *  ordered by note, labelled with the GM voice name when the pad sits on a GM
 *  note, else the note name. Returns undefined (→ the editor's default 8 GM rows)
 *  when there are no pads. */
function samplerDrumModel(lane: SessionLane, midiLabel: (m: number) => string): DrumGridModel | undefined {
  const km = lane.engineState?.sampler?.keymap ?? [];
  // Preserve keymap order so the grid rows line up with the per-pad rack columns
  // (which also iterate the keymap). Dedup by note, first occurrence wins.
  const notes: number[] = [];
  const seen = new Set<number>();
  for (const e of km) { if (!seen.has(e.rootNote)) { seen.add(e.rootNote); notes.push(e.rootNote); } }
  if (notes.length === 0) return undefined;
  const labels = notes.map((n) => { const v = GM_DRUM_MAP[n]; return v ? LANE_LABELS[v] : midiLabel(n); });
  return { rows: noteDrumRows(notes), labels };
}

/** An audio-channel clip: lives on an `audio` lane, has a sample, no notes. */
export function isAudioClip(lane: SessionLane, clip: SessionClip): boolean {
  return lane.engineId === 'audio' && !!clip.sample && (clip.notes?.length ?? 0) === 0;
}

/** The three high-level clip kinds the inspector UI cares about. */
export type ClipKind = 'notes' | 'drums' | 'audio';

/** Classify a clip for the inspector's conditional UI. Audio is checked FIRST
 *  (an audio-channel clip never gets a note editor); otherwise reuse the
 *  resolved editor from `chooseClipEditor` so the precedence isn't duplicated. */
export function classifyClip(
  lane: SessionLane,
  clip: SessionClip,
  engineEditor: 'piano-roll' | 'drum-grid' | undefined,
  override?: 'piano-roll' | 'drum-grid',
): ClipKind {
  if (isAudioClip(lane, clip)) return 'audio';
  return chooseClipEditor(lane, engineEditor, override, clip) === 'drum-grid' ? 'drums' : 'notes';
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
  const editor = chooseClipEditor(lane, engine?.editor, override, clip);

  const playheadFrac = (): number => {
    const lp = deps.laneStates.get(lane.id);
    if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
    const stepDur = 60 / deps.seq.bpm / 4;
    const stepsElapsed = Math.max(0, (deps.ctx.currentTime - lp.startTime) / stepDur);
    const clipSteps = clip.lengthBars * stepsPerBar(deps.seq.meter);
    return (stepsElapsed % clipSteps) / clipSteps;
  };

  // Audio-channel clip → waveform-only editor (no note grid). Mount the engine
  // Gain knob in its toolbar (audio lanes show controls here, not in the lane editor).
  if (isAudioClip(lane, clip)) {
    const engine = deps.laneResources?.get(lane.id)?.engine;
    const gain = (engine && deps.automationRegistry)
      ? {
          engine,
          ctx: {
            laneId: lane.id,
            registerKnob: (k: unknown) => {
              const h = k as KnobHandle;
              if (h.meta?.id) deps.automationRegistry!.set(h.meta.id, h);
            },
            registry: deps.automationRegistry as Map<string, unknown>,
            sessionState: deps.sessionState,
            historyDeps: deps.historyDeps,
          } as EngineUIContext,
        }
      : undefined;
    return renderAudioClipEditor(host, clip, deps.seq.meter, { getPlayheadFrac: playheadFrac, gain });
  }

  // Everything else: optional waveform header (when the clip references a buffer)
  // ABOVE the normal note editor.
  let headerHandle: { redraw: () => void } | null = null;
  if (clip.sample || clip.waveformRef) {
    const headerBox = document.createElement('div');
    host.appendChild(headerBox);
    headerHandle = mountWaveformHeader(headerBox, clip, deps.seq.meter, { getPlayheadFrac: playheadFrac });
  }
  const bodyBox = document.createElement('div');
  host.appendChild(bodyBox);

  let bodyHandle: PianoRollHandle | null;
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
    const model = lane.engineId === 'sampler' ? samplerDrumModel(lane, deps.midiLabel) : undefined;
    bodyHandle = renderDrumGridEditor(bodyBox, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition, getPlayheadTick }, model);
  } else {
    bodyHandle = buildPianoRoll(bodyBox, lane, clip, deps);
  }

  mountClipLoopBrace(bodyBox, clip, deps.seq.meter, deps.historyDeps, () => {});
  return { redraw: () => { headerHandle?.redraw(); bodyHandle?.redraw(); } };
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
    gridResolution: clip.gridResolution,
    onResolutionChange: (r) => { clip.gridResolution = r; },
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
