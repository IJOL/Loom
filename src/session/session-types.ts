// Session view data model — pure type declarations (no runtime, no side effects).
// Split out of session.ts so the data shapes live in one leaf module that the
// rest of the app can import without pulling in the helper logic.

import type { NoteEvent } from '../core/notes';
import type { ScaleId, StyleId } from '../core/musicality';
import type { LaneRole } from '@loom/plugin-sdk';

export interface MusicalityState {
  key: number;        // pitch class 0-11 (0 = Do … 9 = La)
  scale: ScaleId;
  style: StyleId;
  lock: boolean;      // candado de escala del piano-roll
}
export interface LaneMusicalityOverride { key?: number; scale?: ScaleId; }
// Scale lock defaults OFF: a fresh session must never silently constrain which
// notes the user can place. It's opt-in via the 🔒 toggle in the tonality bar.
export const DEFAULT_MUSICALITY: MusicalityState = { key: 9, scale: 'minor', style: 'acid-techno', lock: false };

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
  /** Palette colour for the clip cell. Set at construction (a random pick or
   *  a deterministic hash of the id for imports); never absent. */
  color: string;
  lengthBars: number;
  launchQuantize?: LaunchQuantize;
  notes: NoteEvent[];
  envelopes?: ClipEnvelope[];
  /** Loop/song audio clip. When present, the scheduler fires one buffer
   *  trigger per clip iteration instead of sequencing `notes`. */
  sample?: ClipSample;
  /** Drum-editor grid resolution key (Spec 3), shared with the piano-roll's
   *  snap control. Set at construction (DEFAULT_RESOLUTION); never absent.
   *  Still clamped on read by the editor, so an unknown value self-corrects. */
  gridResolution: import('../core/drum-grid-editing').ResolutionKey;
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

/** What part a lane plays.
 *
 *  The ONE vocabulary. The tree already held three answers to "what part is
 *  this" — `PatternKind`, `GenKind`, and two hardcoded engineId maps — and the
 *  arranger spec proposed a fourth; they are retired into this one, because a
 *  question with four answers has none.
 *
 *  Percussion is deliberately NOT here: whether a lane is a drum lane is
 *  already answered by `isHarmonic` at the capability door, and a second answer
 *  is the fault this vocabulary exists to reduce.
 *
 *  DEFINED IN THE SDK, re-exported here. An engine declares the part it is
 *  built for (`EngineCapabilities.defaultRole`), so the union is part of the
 *  contract a plugin writes against; the host has no business owning a second
 *  copy of it. This name is the one the session uses. */
export type { LaneRole };

export interface SessionLane {
  id: string;
  engineId: string;
  name?: string;
  /** What part this lane plays, if the user has said so.
   *
   *  Absent means today's behaviour exactly — every melodic shelf offered —
   *  which is what lets this ship without migrating a single saved session.
   *
   *  On the LANE rather than inside WEAVE's own state because more than one
   *  feature wants it: the arranger needs to know which lane is the bass, and a
   *  MIDI import could fill it in from the track it came from. */
  role?: LaneRole;
  /** The lane this one accompanies. Present ⇒ the lane plays nothing of its
   *  own: its notes are derived from the leader's, every scheduling iteration.
   *
   *  Only the leader is stored. WHAT the follower plays — bass, comp, pad, arp
   *  — is the lane's own `role` above, resolved by `laneRoleOf`, because that
   *  answer already exists and a second copy here would be free to disagree
   *  with it.
   *
   *  Mutually exclusive with WEAVE's selection: both decide what the lane
   *  plays, and the inspector clears one when you set the other. */
  follow?: {
    leaderId: string;
    /** The progression, corrected by hand. Present ⇒ it wins over whatever the
     *  analysis inferred, which is the same precedence `activeProgression`
     *  applies to a written progression over a picked one. Absent — the
     *  ordinary case — means the harmony is read from the leader every time. */
    chords?: import('../arranger/progression').Chord[];
  };
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
    /** A LAYERS lane's rack: which engine sits in each slot, its zone and its
     *  gain. Here rather than in `params` because an engine id is not a number —
     *  and the layers' OWN knob values do live in `params`, prefixed `l0.`,
     *  `l1.`… so they save, load, automate and undo like any other param. */
    layers?: import('../audio-dsp/layers/layer-spec').LayerSpec[];
    /** Does this rack level its instruments against one another?
     *
     *  Absent ⇒ yes. The presets a rack draws from span 45 dB end to end, so two
     *  picked at random can differ by thirty — at which point the quieter slot is
     *  not quiet, it is absent. Set false to keep the difference, which is
     *  sometimes the whole point of stacking a whisper under a lead.
     *
     *  Here rather than in `params` for the same reason `layers` is: it changes
     *  each slot's TRIM, which travels with the rack as structure rather than as
     *  a number a knob can turn. */
    layerNormalise?: boolean;
  };
  /** Currently applied preset name for this lane, prefix-tagged with the unified
   *  preset vocabulary: `engine:Name` for any built-in/JSON preset (all engines),
   *  `user:Name` for a subtractive user preset, `sampler:…` for a sampler ref. */
  enginePresetName?: string;
  /** Per-lane insert-chain slots. Added by Task 27 (formally persisted in
   *  Task 28). Empty array when there are none — set at construction
   *  (emptyLane et al.), never absent. */
  inserts: import('./insert-slot').InsertSlot[];
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
   *  Still live: session-host.ts writes these on every scene loop edit, and
   *  core/global-loop.ts + session-runtime.ts read them to drive playback. */
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
  /** Project name shown/edited in File ▸ Project Options. Set at every
   *  construction site (emptySessionState, demo/import loaders); never absent. */
  name: string;
  lanes: SessionLane[];
  scenes: SessionScene[];
  globalQuantize: LaunchQuantize;
  /** Master insert-chain slots. Persisted by Task 28. Empty array when there
   *  are none — set at construction, never absent. */
  masterInserts: import('./insert-slot').InsertSlot[];
  /** Global tonality + style + scale-lock (Spec 1). Set at construction
   *  (DEFAULT_MUSICALITY or an explicit choice); never absent. */
  musicality: MusicalityState;
  /** FX send buses (A=delay, B=reverb). Set at construction (defaultSends());
   *  never absent. */
  sends: import('../core/send-bus').SendBusState[];
}
