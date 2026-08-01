// @loom/plugin-sdk — types.ts
// The plugin-facing half of the host's audio-dsp type vocabulary. A plugin
// compiles against THESE; src/audio-dsp/types.ts re-exports them so the host and
// every plugin speak one language with one owner.

// EngineParamGroup is DEFINED in manifest.ts, next to the EngineParamSpec it
// groups — re-exported here so both the DSP vocabulary and the manifest ABI
// resolve it from one name.
export type { EngineParamGroup } from './manifest';

/** One scheduled note. beginSec/durationSec are AudioContext seconds; the
 *  processor converts to sample frames. */
export interface NoteSpec {
  midi: number;
  beginSec: number;
  durationSec: number;
  velocity: number;   // 0..1
  accent: boolean;
  slide: boolean;
  /** Caller-assigned handle so this ONE voice can be released later
   *  (VoiceManager.releaseVoice). A held live note — a key you are still
   *  pressing — has no known duration, so its note-off arrives as a separate
   *  message and needs a way to name its voice. Sequenced notes carry their own
   *  duration and never need it, so it is optional. */
  voiceId?: number;
}

/** Generic engine parameter bag: dot-id (`'filter.cutoff'`, `'op1.ratio'`, …)
 *  → value. Replaces the typed SubParams as the cross-engine param carrier so
 *  one VoiceManager/worklet drives any engine kind. */
export type ParamBag = Record<string, number>;

/** Read a ParamBag value with a default fallback. */
export const param = (b: ParamBag, id: string, d: number): number => (b[id] ?? d);

/** Live, additive modulation offsets, NORMALISED (the sum of LFO `wave×depth`,
 *  roughly -1..1). Keyed by target NAME: a SubParams field for Subtractive, or a
 *  param dot-id ('filter.cutoff', 'osc.morph', 'op1.level'…) for the other
 *  engines — generic, so one VoiceManager path drives every engine. The renderer
 *  scales each to native units at read time. */
export type VoiceModOffsets = Record<string, number>;

/** The per-voice slice of a driver:'gate' modulator (an ADSR) the worklet hands
 *  to a renderer at spawn: its envelope times plus how deep it drives each
 *  param dot-id. This is the shape ModEnvHost consumes — an envelope spec, not
 *  a modulator kernel's input. See ModLiteLike for that. */
export interface ModEnvSpec {
  attackSec?: number;
  decaySec?: number;
  sustain?: number;
  releaseSec?: number;
  depthByParam: Record<string, number>;
}

/** The input a driver:'time' modulator kernel's `valueAt(m, t, origin)`
 *  receives — the resolved wire-format modulator state, limited to the fields
 *  a kernel may legitimately read. TRIG and SCOPE are excluded on purpose: the
 *  runtime already resolves them into the `origin` argument before calling the
 *  kernel, so a kernel never needs to re-derive a phase origin itself.
 *  Gate-only (ADSR) fields are excluded too — driver:'gate' never reaches a
 *  kernel (see the design doc §3.3): that road stays the per-voice envelope
 *  ModEnvHost drives from ModEnvSpec. */
export interface ModLiteLike {
  id: string;
  kind: string;
  enabled: boolean;
  /** The built-in LFO's own fields, carried with their wire-format defaults
   *  even for a non-LFO kind. A plugin modulator's OWN settings live in
   *  `params` below, not here — these three exist for the LFO kernel. */
  rateHz: number;
  waveform: 'sine' | 'triangle' | 'square' | 'saw';
  bipolar?: boolean;
  /** A plugin modulator's own settings (ModulatorState.params, carried
   *  through unchanged) — where a plugin kernel finds its own rate/shape. */
  params?: Record<string, number>;
}

/** A pooled, per-sample voice. Pure: no Web Audio. */
export interface VoiceRenderer {
  /** Render one mono sample at absolute time t (seconds). `modOffsets` are the
   *  shared-LFO offsets computed once per sample by the VoiceManager and applied
   *  at read time on top of the voice's spawned-snapshot params. Omitted ⇒ no
   *  modulation. */
  renderSample(t: number, modOffsets?: VoiceModOffsets): number;
  /** Live note-off: end the gate at time t (release tail still plays). */
  noteOff(t: number): void;
  /** Receive the lane's LIVE param bag — the smoothed copy the VoiceManager
   *  mutates in place as knobs move. A voice that implements this reads its
   *  CONTINUOUS params from here each sample, so a knob turn reaches a note that
   *  is already sounding (an analogue filter is always in the signal path; ours
   *  used to be a photograph taken at trigger).
   *
   *  STRUCTURAL params must NOT be read from here: waveform, unison size, filter
   *  model/type and envelope TIMES stay frozen at trigger. Envelope times are
   *  excluded on purpose — our envelopes are a closed-form function of elapsed
   *  time, not a charging capacitor, so re-reading the attack mid-note makes the
   *  amplitude jump. See the design spec.
   *
   *  Optional: a renderer without it keeps the trigger-time snapshot behaviour. */
  setLiveParams?(live: ParamBag): void;
  /** True once the release tail has fully decayed at the last rendered t. */
  readonly done: boolean;
}
