// Session view data model (Ableton-style clip grid).
// Pure types and pure helpers only — no audio side effects.

import type { NoteEvent } from '../core/notes';
import { barCountFor } from '../core/slice-clip';

export type LaunchQuantize =
  | 'immediate' | '1/4' | '1/2' | '1/1' | '2/1' | '4/1';

export interface ClipEnvelope {
  paramId: string;
  values: number[];
  enabled?: boolean;
  stepped?: boolean;
}

export interface LoopSlice {
  start: number;   // seconds into the buffer
  end: number;     // seconds
  note: number;    // MIDI row this slice maps to (editor row + the note that fires it)
}

/** Audio bound to a loop/song clip (each clip carries its own sample). Distinct
 *  from the per-lane one-shot keymap: loop/song clips play this buffer directly
 *  when the clip is launched, instead of sequencing notes against a keymap. */
export interface ClipSample {
  sampleId: string;
  mode: 'loop' | 'song';
  /** Loop: convenience metadata to suggest lengthBars on import. Song: optional. */
  originalBpm?: number;
  /** Per-clip warp/sync on/off. */
  warp?: boolean;
  /** How a warped loop plays. Only 'stretch' is honored: one WSOLA-stretched
   *  buffer per iteration (pitch preserved). The scheduler always plays the
   *  whole buffer for an audio clip; absent ⇒ varispeed fill. */
  warpMode?: 'stretch';
  trimStart: number;   // seconds into the buffer
  trimEnd: number;     // seconds (buffer end if not trimmed)
  gain?: number;       // linear, default 1
}

export interface SessionClip {
  id: string;
  name?: string;
  color?: string;
  lengthBars: number;
  launchQuantize?: LaunchQuantize;
  notes: NoteEvent[];
  envelopes?: ClipEnvelope[];
  /** Loop/song audio clip. When present, the scheduler fires one buffer
   *  trigger per clip iteration instead of sequencing `notes`. */
  sample?: ClipSample;
  /** Drum-editor grid resolution key (Spec 3). Additive/optional; absent ⇒ '1/16'.
   *  Clamped on read by the editor, so an unknown value self-corrects. */
  gridResolution?: import('../core/drum-grid-editing').ResolutionKey;
  /** Loop sub-region (Phase A). When loopEnabled, the scheduler repeats only
   *  [loopStartTick, loopEndTick) instead of the whole clip. Ticks are on the
   *  TICKS_PER_QUARTER grid (same as NoteEvent.start). Absent ⇒ whole clip. */
  loopEnabled?: boolean;
  loopStartTick?: number;
  loopEndTick?: number;
  /** Display-only source buffer for the waveform header (Mode-2 sliced clips
   *  whose audio now lives in the bank keymap). The scheduler IGNORES this — it
   *  is purely for the editor's waveform strip + slice markers. Absent ⇒ no header. */
  waveformRef?: { sampleId: string; slices?: LoopSlice[] };
}

export interface SessionLane {
  id: string;
  engineId: string;
  name?: string;
  clips: (SessionClip | null)[];
  launchQuantize?: LaunchQuantize;
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
    noteFx?: import('../notefx/notefx-types').NoteFxState[];
    sampler?: { keymap: import('../samples/types').KeymapEntry[]; drumkitId?: string; padParams?: Record<number, Record<string, number>> };
    /** Per-voice drum mute flags (drums-machine). Solo is live-only, not saved. */
    drumMutes?: Record<string, boolean>;
    /** Which drum source the Drums lane plays. Absent ⇒ 'synth' (façade default). */
    kitMode?: 'synth' | 'sample';
  };
  /** Currently applied preset name for this lane (`factory:Name` /
   *  `user:Name` / `engine:Name` — same shape as `polyPresetName` values). */
  enginePresetName?: string;
  /** Per-lane insert-chain slots. Added by Task 27 (formally persisted in
   *  Task 28). Defaults to [] when absent so consumers can write `??= []`
   *  and then push to the same array without losing the reference. */
  inserts?: import('./insert-slot').InsertSlot[];
}

export interface SessionScene {
  id: string;
  name?: string;
  clipPerLane: Record<string, number | null>;
}

export interface SessionState {
  lanes: SessionLane[];
  scenes: SessionScene[];
  globalQuantize: LaunchQuantize;
  /** Master insert-chain slots. Persisted by Task 28. Defaults to [] when absent. */
  masterInserts?: import('./insert-slot').InsertSlot[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

export const CLIP_COLOR_PALETTE: readonly string[] = [
  '#f4b8b8', '#f4c8a8', '#f4e0a8', '#d8e8a8',
  '#a8e8b8', '#a8e0d8', '#a8c8e8', '#b8b8e8',
  '#c8a8e0', '#e0a8d0', '#e0b8b8', '#c8c8a8',
];

export function pickRandomClipColor(rng: () => number = Math.random): string {
  const i = Math.min(CLIP_COLOR_PALETTE.length - 1, Math.floor(rng() * CLIP_COLOR_PALETTE.length));
  return CLIP_COLOR_PALETTE[i];
}

let nextIdCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(nextIdCounter++).toString(36)}`;
}

export function emptyClip(lengthBars: number): SessionClip {
  return { id: nextId('clip'), lengthBars, notes: [], color: pickRandomClipColor() };
}

/** Build a loop/song audio clip (carries clip.sample). lengthBars is derived so
 *  the clip spans roughly the sample's natural length at the given bpm — a loop
 *  then plays near its natural speed; the user refines it in the clip editor. */
export function audioClip(opts: {
  name: string;
  sampleId: string;
  durationSec: number;
  bpm: number;
  mode?: 'loop' | 'song';
}): SessionClip {
  const barSec = (4 * 60) / opts.bpm;
  const lengthBars = Math.max(1, Math.round(opts.durationSec / barSec));
  return {
    id: nextId('clip'),
    name: opts.name,
    color: pickRandomClipColor(),
    lengthBars,
    notes: [],
    sample: {
      sampleId: opts.sampleId,
      mode: opts.mode ?? 'loop',
      trimStart: 0,
      trimEnd: opts.durationSec,
    },
  };
}

/** Build an audio-channel clip: a whole-loop ClipSample warped to the session
 *  tempo via pitch-preserving WSOLA. lengthBars = whole-bar count at the loop's
 *  native BPM, so at that BPM it plays near-identical to the source. */
export function audioChannelClip(opts: {
  name: string;
  sampleId: string;
  durationSec: number;
  originalBpm: number;
  projectMeter: import('../core/meter').TimeSignature;
}): SessionClip {
  const lengthBars = barCountFor(opts.durationSec, opts.originalBpm, opts.projectMeter);
  return {
    id: nextId('clip'),
    name: opts.name,
    color: pickRandomClipColor(),
    lengthBars,
    notes: [],
    sample: {
      sampleId: opts.sampleId,
      mode: 'loop',
      originalBpm: opts.originalBpm,
      warp: true,
      warpMode: 'stretch',
      trimStart: 0,
      trimEnd: opts.durationSec,
      gain: 1,
    },
  };
}

export function emptyLane(id: string, engineId: string): SessionLane {
  return { id, engineId, clips: [] };
}

export function emptyScene(name: string): SessionScene {
  return { id: nextId('scene'), name, clipPerLane: {} };
}

export function emptySessionState(): SessionState {
  return {
    lanes: [
      { id: 'tb-303-1',      engineId: 'tb303',          name: '303 1',   clips: [] },
      { id: 'drums-1',       engineId: 'drums-machine',  name: 'Drums 1', clips: [] },
      { id: 'subtractive-1', engineId: 'subtractive',    name: 'Sub 1',   clips: [] },
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}

export function cloneSessionState(s: SessionState): SessionState {
  return JSON.parse(JSON.stringify(s)) as SessionState;
}

export function clipRowCount(s: SessionState): number {
  let maxClips = 0;
  for (const lane of s.lanes) maxClips = Math.max(maxClips, lane.clips.length);
  return Math.max(maxClips, s.scenes.length);
}

export interface ClipSlot { laneId: string; clipIdx: number; }

export function canDropClip(s: SessionState, from: ClipSlot, to: ClipSlot): boolean {
  if (from.laneId === to.laneId && from.clipIdx === to.clipIdx) return false;
  const srcLane = s.lanes.find((l) => l.id === from.laneId);
  if (!srcLane) return false;
  const srcClip = srcLane.clips[from.clipIdx];
  if (!srcClip) return false;
  const dstLane = s.lanes.find((l) => l.id === to.laneId);
  if (!dstLane) return false;
  const dstClip = dstLane.clips[to.clipIdx];
  return dstClip == null;
}

function padToIndex<T>(arr: (T | null)[], idx: number): (T | null)[] {
  if (arr.length > idx) return arr;
  return [...arr, ...Array(idx - arr.length + 1).fill(null)];
}

function reEvaluateEnvelopes(
  clip: SessionClip,
  destEngineParamIds: ReadonlySet<string>,
): SessionClip {
  if (!clip.envelopes || clip.envelopes.length === 0) return clip;
  return {
    ...clip,
    envelopes: clip.envelopes.map((env) => ({
      ...env,
      values: [...env.values],
      enabled: destEngineParamIds.has(env.paramId),
    })),
  };
}

/** After a lane's engine changes, re-evaluate every clip's automation
 *  envelopes against the new engine's param set: an envelope whose paramId
 *  is absent from `paramIds` is disabled (kept, not deleted — mirrors
 *  reEvaluateEnvelopes used by moveClip/copyClip). Mutates the lane in place. */
export function reconcileLaneEnvelopes(
  lane: SessionLane,
  paramIds: ReadonlySet<string>,
): void {
  for (const clip of lane.clips) {
    if (!clip?.envelopes) continue;
    for (const env of clip.envelopes) {
      env.enabled = paramIds.has(env.paramId);
    }
  }
}

export function moveClip(
  s: SessionState,
  from: ClipSlot,
  to: ClipSlot,
  destEngineParamIds: ReadonlySet<string>,
): SessionState {
  if (!canDropClip(s, from, to)) {
    throw new Error(`moveClip: invalid drop from ${from.laneId}:${from.clipIdx} to ${to.laneId}:${to.clipIdx}`);
  }
  const out = cloneSessionState(s);
  const srcLane = out.lanes.find((l) => l.id === from.laneId)!;
  const dstLane = out.lanes.find((l) => l.id === to.laneId)!;
  const movingClip = srcLane.clips[from.clipIdx]!;
  srcLane.clips[from.clipIdx] = null;
  dstLane.clips = padToIndex(dstLane.clips, to.clipIdx);
  dstLane.clips[to.clipIdx] = from.laneId === to.laneId
    ? movingClip
    : reEvaluateEnvelopes(movingClip, destEngineParamIds);
  return out;
}

export function copyClip(
  s: SessionState,
  from: ClipSlot,
  to: ClipSlot,
  destEngineParamIds: ReadonlySet<string>,
): SessionState {
  if (!canDropClip(s, from, to)) {
    throw new Error(`copyClip: invalid drop from ${from.laneId}:${from.clipIdx} to ${to.laneId}:${to.clipIdx}`);
  }
  const out = cloneSessionState(s);
  const srcLane = out.lanes.find((l) => l.id === from.laneId)!;
  const dstLane = out.lanes.find((l) => l.id === to.laneId)!;
  const source = srcLane.clips[from.clipIdx]!;
  // cloneSessionState already deep-cloned `source`; just give the copy a new id.
  const clone: SessionClip = {
    ...source,
    id: nextId('clip'),
    // Deep-clone envelopes to prevent edits to the copy affecting the source
    envelopes: source.envelopes
      ? source.envelopes.map((env) => ({ ...env, values: [...env.values] }))
      : undefined,
  };
  dstLane.clips = padToIndex(dstLane.clips, to.clipIdx);
  dstLane.clips[to.clipIdx] = from.laneId === to.laneId
    ? clone
    : reEvaluateEnvelopes(clone, destEngineParamIds);
  return out;
}
