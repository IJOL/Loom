// Session view data model (Ableton-style clip grid).
// Pure clip/lane/scene FACTORIES. The data shapes live in ./session-types, the
// mutation/query ops (move/copy/duplicate/delete) in ./session-ops, and the
// id/deep-clone helpers in ./session-core.

import { barCountFor } from '../core/slice-clip';
import type { ScaleId } from '../core/musicality';
import { nextId } from './session-core';
import {
  DEFAULT_MUSICALITY,
  type SessionClip, type SessionLane, type SessionScene, type SessionState,
} from './session-types';

// Re-export the data model, ops, and clone helper so existing
// `import { … } from './session'` sites keep working unchanged.
export * from './session-types';
export * from './session-ops';
export { cloneSessionState } from './session-core';

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

export function emptyClip(lengthBars: number): SessionClip {
  return { id: nextId('clip'), lengthBars, notes: [], color: pickRandomClipColor() };
}

/** Deep-clone a clip with a fresh unique id (for copy/capture). */
export function cloneClipWithNewId(clip: SessionClip): SessionClip {
  return { ...(JSON.parse(JSON.stringify(clip)) as SessionClip), id: nextId('clip') };
}

/** Resolve a lane's effective tonality: its override (field-by-field) over the
 *  global musicality, over DEFAULT_MUSICALITY. */
export function resolveTonality(
  lane: Pick<SessionLane, 'musicalityOverride'>,
  state: Pick<SessionState, 'musicality'>,
): { key: number; scale: ScaleId } {
  const g = state.musicality ?? DEFAULT_MUSICALITY;
  const o = lane.musicalityOverride ?? {};
  return { key: o.key ?? g.key, scale: o.scale ?? g.scale };
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
  /** Trim the front of the buffer so the audio's downbeat lands on bar 1.
   *  Also shortens lengthBars to the whole bars AFTER the anchor. Default 0. */
  anchorSec?: number;
  /** false ⇒ native `song` clip (playbackRate 1, full fidelity). true (default)
   *  ⇒ WSOLA-locked `loop`. warpMode stays 'stretch' either way so the editor's
   *  Warp toggle can flip it on without re-deriving. */
  warp?: boolean;
  warpMarkers?: import('./session-types').WarpMarker[];
  warpGroupId?: string;
  warpRef?: boolean;
}): SessionClip {
  const anchorSec = Math.max(0, Math.min(opts.anchorSec ?? 0, opts.durationSec));
  const warp = opts.warp ?? true;
  const playableSec = Math.max(0.001, opts.durationSec - anchorSec);
  const lengthBars = barCountFor(playableSec, opts.originalBpm, opts.projectMeter);
  return {
    id: nextId('clip'),
    name: opts.name,
    color: pickRandomClipColor(),
    lengthBars,
    notes: [],
    sample: {
      sampleId: opts.sampleId,
      mode: warp ? 'loop' : 'song',
      originalBpm: opts.originalBpm,
      warp,
      warpMode: 'stretch',
      trimStart: anchorSec,
      trimEnd: opts.durationSec,
      gain: 1,
      ...(opts.warpMarkers && opts.warpMarkers.length >= 2 ? { warpMarkers: opts.warpMarkers } : {}),
      ...(opts.warpGroupId ? { warpGroupId: opts.warpGroupId } : {}),
      ...(opts.warpRef ? { warpRef: true } : {}),
    },
  };
}

export function emptyLane(id: string, engineId: string): SessionLane {
  return { id, engineId, clips: [] };
}

export function emptyScene(name: string): SessionScene {
  return { id: nextId('scene'), name, clipPerLane: {} };
}

/** A truly empty session: no lanes, no scenes. "New session" wipes to this —
 *  the user builds it from scratch via the "+ Add" control. (Boot loads a demo,
 *  not this.) */
export function emptySessionState(): SessionState {
  // Seed the default tonality so a fresh session has the scale lock ON (matches the
  // migration default for loaded sessions). Without this, lock?? falls to false.
  return { name: 'Untitled', lanes: [], scenes: [], globalQuantize: '1/1', musicality: { ...DEFAULT_MUSICALITY } };
}

/** A populated fixture (one each of three engines, no clips/scenes) for tests
 *  that need lanes to operate on. NOT the New-session state — that is the empty
 *  {@link emptySessionState}. */
export function testSessionState(): SessionState {
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

export function clipRowCount(s: SessionState): number {
  let maxClips = 0;
  for (const lane of s.lanes) maxClips = Math.max(maxClips, lane.clips.length);
  return Math.max(maxClips, s.scenes.length);
}
