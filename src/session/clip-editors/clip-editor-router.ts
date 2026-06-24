// src/session/clip-editors/clip-editor-router.ts
// Detects the engine assigned to the lane and dispatches to the matching
// editor (piano-roll or drum-grid). Falls back to piano-roll if engine has
// no explicit preference.

import type { SessionClip, SessionLane, WarpMarker } from '../session';
import { resolveTonality } from '../session';
import { inScale } from '../../core/musicality';
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
import { GM_DRUM_MAP, GM_PERCUSSION_NAMES } from '../../engines/drum-gm-map';
import { mountWaveformHeader, renderAudioClipEditor } from './clip-waveform-header';
import type { HistoryDeps } from '../../save/history-wiring';
import { withUndo } from '../../save/history-wiring';
import type { LaneResourceMap } from '../../core/lane-resources';
import type { KnobHandle } from '../../core/knob';
import type { EngineUIContext } from '../../engines/engine-types';
import type { SessionState } from '../session';
import { detectLoop } from '../../samples/loop-analysis';
import { propagateWarp, propagateLoop } from '../warp-marker-edit';
import { loopAwareStep } from '../../core/clip-loop';
import { isDrumFullKit } from '../../core/clip-drum-fullkit';
import { warpCache } from '../../samples/warp-cache';
import { sampleCache } from '../../samples/sample-cache';

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
  /** When present, the audio clip editor shows a "Transcribe loop" button that
   *  sends the clip's effective loop region to the audio→notes backend. The
   *  router binds the clip; the closure does slice→WAV→transcribe→new note lane. */
  transcribeLoop?: (clip: SessionClip, kind: 'melodic' | 'drums') => void | Promise<void>;
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

// Compact-view seed when a fresh clip uses no pads yet: the basic kit voices
// (kick/snare/closed-hat/open-hat/clap) so there is something to draw on.
const SEED_NOTES = [36, 38, 42, 46, 39];

/** Build the drum-grid row model for a sampler drumkit lane. One row per pad,
 *  in keymap order (dedup by the pad's GM note `loNote`), labelled with the GM percussion name
 *  when known, else the GM voice label, else the bare note name.
 *
 *  `fullKit === true`  ⇒ rows are every keymap pad (the whole kit).
 *  `fullKit === false` ⇒ rows are only the pads the clip uses; for a fresh clip
 *  that uses none yet, a small seed subset (kick/snare/CH/OH/clap when present).
 *
 *  Returns undefined (→ the editor's default 8 GM rows) when there are no pads. */
export function samplerDrumModel(
  lane: SessionLane,
  clip: SessionClip,
  midiLabel: (m: number) => string,
  fullKit: boolean,
): DrumGridModel | undefined {
  const km = lane.engineState?.sampler?.keymap ?? [];
  // Preserve keymap order so the grid rows line up with the per-pad rack columns
  // (which also iterate the keymap). Dedup by the PAD's GM note (loNote, ===hiNote
  // for a single-note drum pad) — NOT rootNote: a repitched pad (root ≠ note) must
  // keep its own row, and the clip's notes + triggers address the pad by its note.
  const allNotes: number[] = [];
  const seen = new Set<number>();
  for (const e of km) { if (!seen.has(e.loNote)) { seen.add(e.loNote); allNotes.push(e.loNote); } }
  if (allNotes.length === 0) return undefined;

  let notes: number[];
  if (fullKit) {
    notes = allNotes;
  } else {
    const used = new Set((clip.notes ?? []).map((n) => n.midi));
    notes = allNotes.filter((n) => used.has(n));
    if (notes.length === 0) notes = allNotes.filter((n) => SEED_NOTES.includes(n));
    if (notes.length === 0) notes = allNotes.slice(0, Math.min(5, allNotes.length));
  }
  const labels = notes.map((n) =>
    GM_PERCUSSION_NAMES[n] ?? (GM_DRUM_MAP[n] ? LANE_LABELS[GM_DRUM_MAP[n]] : midiLabel(n)));
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
    const totalSteps = Math.max(1, clip.lengthBars * stepsPerBar(deps.seq.meter));
    return loopAwareStep(clip, deps.seq.meter, stepsElapsed) / totalSteps;
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
    const warp = (clip.sample?.warpRef)
      ? {
          bpm: deps.seq.bpm,
          getOnsets: (): number[] => {
            const buf = clip.sample ? sampleCache.get(clip.sample.sampleId) : undefined;
            if (!buf) return [];
            return detectLoop(buf, deps.seq.meter).slicePointsSec;
          },
          onMarkersChange: (markers: WarpMarker[], on: boolean): void => {
            const apply = () => {
              const s = clip.sample; if (!s) return;
              s.warpMarkers = markers.map((m) => ({ ...m }));
              s.warp = on;
              const ids = s.warpGroupId
                ? propagateWarp(deps.sessionState!, s.warpGroupId, markers, on)
                : [s.sampleId];
              for (const id of ids) warpCache.invalidate(id);
            };
            if (deps.historyDeps) withUndo(deps.historyDeps, apply); else apply();
          },
        }
      : undefined;
    // Loop overlay: write loop fields (the overlay mutates the clip + wraps undo)
    // then invalidate the warp cache so the new sub-region re-warps. applyToAll
    // propagates the same region across every channel of the warp group.
    const loop = clip.sample
      ? {
          historyDeps: deps.historyDeps,
          onChange: (): void => { const s = clip.sample; if (s) warpCache.invalidate(s.sampleId); },
          applyToAll: (clip.sample.warpGroupId && deps.sessionState)
            ? (enabled: boolean, start: number, end: number): void => {
                const ids = propagateLoop(deps.sessionState!, clip.sample!.warpGroupId!, enabled, start, end);
                for (const id of ids) warpCache.invalidate(id);
              }
            : undefined,
        }
      : undefined;
    const transcribe = deps.transcribeLoop
      ? { run: (kind: 'melodic' | 'drums') => deps.transcribeLoop!(clip, kind) }
      : undefined;
    return renderAudioClipEditor(host, clip, deps.seq.meter, { getPlayheadFrac: playheadFrac, gain, warp, loop, transcribe });
  }

  // Everything else: optional waveform header (when the clip references a buffer)
  // ABOVE the normal note editor.
  let headerHandle: { redraw: () => void } | null = null;
  if (clip.sample || clip.waveformRef) {
    const headerBox = document.createElement('div');
    host.appendChild(headerBox);
    headerHandle = mountWaveformHeader(headerBox, clip, deps.seq.meter, { getPlayheadFrac: playheadFrac });
  }
  const loopBar = document.createElement('div');
  host.appendChild(loopBar);
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
      return loopAwareStep(clip, deps.seq.meter, stepsElapsed) * TICKS_PER_STEP;
    };
    const model = lane.engineId === 'sampler'
      ? samplerDrumModel(lane, clip, deps.midiLabel, isDrumFullKit())
      : undefined;
    // Sampler drumkit lanes get a "Full kit" toggle: build(full) re-derives the
    // row model for the requested view so the editor can swap compact ↔ full in
    // place (an empty kit falls back to a zero-row model).
    const fullKit = lane.engineId === 'sampler'
      ? { build: (full: boolean) => samplerDrumModel(lane, clip, deps.midiLabel, full) ?? { rows: noteDrumRows([]), labels: [] } }
      : undefined;
    bodyHandle = renderDrumGridEditor(bodyBox, clip, deps.historyDeps, deps.seq.meter, {
      auditionNote: audition, getPlayheadTick, fullKit,
      loop: { toolbarHost: loopBar, historyDeps: deps.historyDeps, onChange: () => {} },
    }, model);
  } else {
    bodyHandle = buildPianoRoll(bodyBox, lane, clip, deps, loopBar);
  }
  return combineEditorHandle(headerHandle, bodyHandle);
}

/** Combine the optional waveform-header handle with the body editor (piano-roll
 *  or drum-grid) into ONE PianoRollHandle: forward ALL of the body's
 *  capabilities — getOctaveBase / setOctaveBase live on the piano-roll — and
 *  make redraw() paint BOTH. The spread (not just `{redraw}`) is load-bearing:
 *  the note-randomizer reads & restores the editor octave through this handle,
 *  so dropping the body's methods silently broke "randomize keeps the octave". */
export function combineEditorHandle(
  header: { redraw: () => void } | null,
  body: PianoRollHandle | null,
): PianoRollHandle {
  return { ...(body ?? {}), redraw: () => { header?.redraw(); body?.redraw(); } } as PianoRollHandle;
}

function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  loopBar: HTMLElement,
): PianoRollHandle {
  const getNotes = (): NoteEvent[] => clip.notes ?? [];
  const setNotes = (notes: NoteEvent[]) => { clip.notes = notes; };

  const { ctx, seq, laneStates, historyDeps, triggerForLane } = deps;
  // Full orchestral range (C0..C8), widened so every note already in the clip
  // is visible — no engine-specific narrowing.
  const { minMidi, maxMidi } = pianoRollRange(getNotes());
  const state = deps.sessionState;
  const ton = state ? resolveTonality(lane, state) : undefined;
  const scaleCtx = ton
    ? {
        inScale: (m: number) => inScale(m, ton.key, ton.scale),
        isRoot: (m: number) => (((m % 12) + 12) % 12) === (((ton.key % 12) + 12) % 12),
      }
    : undefined;
  const scaleLock = state?.musicality?.lock ?? false;
  return createPianoRoll({
    host,
    getNotes,
    setNotes,
    patternTicks: clip.lengthBars * ticksPerBar(seq.meter),
    stepsPerBar: stepsPerBar(seq.meter),
    stepsPerBeat: stepsPerBeat(seq.meter),
    minMidi,
    maxMidi,
    scaleCtx,
    scaleLock,
    onScaleLockChange: (lock) => {
      if (state?.musicality) state.musicality.lock = lock;
    },
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
      return loopAwareStep(clip, seq.meter, stepsElapsed) * TICKS_PER_STEP;
    },
    viewState: resolveViewState(viewStateByClip, clip.id),
    onViewChange: (v) => { viewStateByClip.set(clip.id, v); },
    ...(historyDeps ? {
      onGestureStart:  () => historyDeps.beginGesture?.(),
      onGestureEnd:    () => historyDeps.endGesture?.(),
      onGestureCancel: () => historyDeps.endGesture?.(),
    } : {}),
    loop: { toolbarHost: loopBar, clip, meter: seq.meter, historyDeps, onChange: () => {} },
  });
}
