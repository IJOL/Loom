// Session view data model — pure type declarations (no runtime, no side effects).
// Split out of session.ts so the data shapes live in one leaf module that the
// rest of the app can import without pulling in the helper logic.

import type { NoteEvent } from '../core/notes';
import type { ScaleId, StyleId } from '../core/musicality';

export interface MusicalityState {
  key: number;        // pitch class 0-11 (0 = Do … 9 = La)
  scale: ScaleId;
  style: StyleId;
  lock: boolean;      // candado de escala del piano-roll
}
export interface LaneMusicalityOverride { key?: number; scale?: ScaleId; }
// Scale lock defaults OFF: a fresh session must never silently constrain which
// notes the user can place. It's opt-in via the 🔒 toggle in the tonality bar.
export const DEFAULT_MUSICALITY: MusicalityState = { key: 9, scale: 'minor', style: 'acid', lock: false };

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

export interface WarpMarker {
  srcSec: number;  // position in the SOURCE buffer (seconds)
  beat: number;    // musical beat it is pinned to (0-based; beat 0 = clip downbeat)
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
  /** Ableton-style warp markers (srcSec↔beat). When present + warp on, the clip
   *  plays a piecewise time-stretched buffer that locks each beat to the grid. */
  warpMarkers?: WarpMarker[];
  /** Stems separated from one import share this id, so a marker edit on the
   *  reference clip can propagate the same markers to every stem of the import. */
  warpGroupId?: string;
  /** This clip is the editable warp REFERENCE (the drums stem); only the
   *  reference clip shows the draggable marker editor. Absent ⇒ follower. */
  warpRef?: boolean;
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
  /** Per-clip tempo map (tempo changes at ticks on the TICKS_PER_QUARTER grid,
   *  same units as NoteEvent.start). When present with >1 distinct tempo, the
   *  scheduler times notes by integrating it instead of the constant global BPM —
   *  faithful playback of MIDIs with tempo changes. Absent ⇒ constant tempo. */
  tempoMap?: import('../core/tempo-map').TempoPoint[];
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
    sampler?: {
      keymap: import('../samples/types').KeymapEntry[];
      drumkitId?: string;
      /** Mirror of `drumkitId` for bundled melodic/loop presets; mutually
       *  exclusive with `drumkitId` (drumkit wins in the load path). */
      instrumentId?: string;
      /** A normal Sampler preset (presets/sampler.json, by name). Mutually
       *  exclusive with drumkitId/instrumentId; on load its zones are re-fetched
       *  from their URLs so audio self-heals like the bundled-instrument path. */
      presetName?: string;
      padParams?: Record<number, Record<string, number>>;
    };
    /** Per-voice drum mute flags (drums-machine). Solo is live-only, not saved. */
    drumMutes?: Record<string, boolean>;
    /** Which drum source the Drums lane plays. Absent ⇒ 'synth' (façade default). */
    kitMode?: 'synth' | 'sample';
  };
  /** Currently applied preset name for this lane, prefix-tagged with the unified
   *  preset vocabulary: `engine:Name` for any built-in/JSON preset (all engines),
   *  `user:Name` for a subtractive user preset, `sampler:…` for a sampler ref.
   *  (Legacy `factory:Name` from older saves is folded into `engine:` on load by
   *  session-migration.) */
  enginePresetName?: string;
  /** Per-lane insert-chain slots. Added by Task 27 (formally persisted in
   *  Task 28). Defaults to [] when absent so consumers can write `??= []`
   *  and then push to the same array without losing the reference. */
  inserts?: import('./insert-slot').InsertSlot[];
  /** Per-lane mixer ChannelStrip snapshot (level/pan/EQ/sendA/sendB/mute/comp/
   *  sidechain). Optional/additive — absent ⇒ the strip keeps its defaults on
   *  load. Collected on save from the live strip, restored on load. */
  mixer?: import('../core/fx').ChannelState;
  /** Per-lane tonality override (Spec 1). Absent ⇒ inherits the global musicality. */
  musicalityOverride?: LaneMusicalityOverride;
}

export interface SessionScene {
  id: string;
  name?: string;
  clipPerLane: Record<string, number | null>;
  /** Phase 2: per-scene global loop in SONG bars. When enabled, every lane in
   *  the scene restarts together at endBar (the window wins). Absent ⇒ no global
   *  loop (each clip loops independently, exactly Phase 1).
   *  These fields are kept for save-file compatibility but are no longer set by
   *  the Link model. The scheduler ignores them when loopLinked is used instead. */
  globalLoopEnabled?: boolean;
  globalLoopStartBar?: number;
  globalLoopEndBar?: number;
  /** Scene LINK: when true, every clip in this scene shares one loop region.
   *  Editing the loop on any clip propagates loopEnabled/loopStartTick/loopEndTick
   *  to every other clip in the scene (clamped to each clip's own length).
   *  On unlink each clip keeps its current region. */
  loopLinked?: boolean;
}

export interface SessionState {
  /** Project name shown/edited in File ▸ Project Options. Backfilled on load. */
  name?: string;
  lanes: SessionLane[];
  scenes: SessionScene[];
  globalQuantize: LaunchQuantize;
  /** Master insert-chain slots. Persisted by Task 28. Defaults to [] when absent. */
  masterInserts?: import('./insert-slot').InsertSlot[];
  /** Global tonality + style + scale-lock (Spec 1). Optional/additive; absent ⇒
   *  DEFAULT_MUSICALITY (backfilled by session-migration). */
  musicality?: MusicalityState;
  /** FX send buses (A=delay, B=reverb). Optional/additive; absent ⇒ seeded by migration. */
  sends?: import('../core/send-bus').SendBusState[];
}
