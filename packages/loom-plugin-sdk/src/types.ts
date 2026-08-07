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
  /** Which LAYER of a layered instrument this note belongs to, when something
   *  upstream already knows — a crossfade between loops, a keyboard split made
   *  elsewhere, a note-FX. Absent means the instrument decides for itself, which
   *  for LAYERS means by keyboard zone.
   *
   *  It rides on the note rather than on the lane because it varies per note:
   *  that is the whole point. Every other engine ignores it. */
  layerIndex?: number;
}

/** Generic engine parameter bag: dot-id (`'filter.cutoff'`, `'op1.ratio'`, …)
 *  → value. Replaces the typed SubParams as the cross-engine param carrier so
 *  one VoiceManager/worklet drives any engine kind. */
export type ParamBag = Record<string, number>;

/** Read a ParamBag value with a default fallback. */
export const param = (b: ParamBag, id: string, d: number): number => (b[id] ?? d);

/** The numbering of one lane's DECLARED params. Names stay at the edges — the
 *  manifest, presets, session state, the messages the host posts — and the hot
 *  loop reads a Float64Array by slot. The host builds this once per lane and
 *  hands it to every voice; a plugin resolves the slots it cares about ONCE and
 *  never touches a string again per sample.
 *
 *  An id with no slot is not addressable, and that is the point: it means the
 *  lane never declared it, and the host drops the write with a warning rather
 *  than storing a value nobody reads.
 *
 *  ⚠️ Resolve ONLY ids your manifest declares. The index also numbers the
 *  synthetic MODULATION targets ('amp', 'ampGain', 'filterEnv'), which are not
 *  params: they have real slots, so the -1 guard does NOT fire for them, but
 *  nothing ever writes them into the values array — you would read a permanent
 *  0 instead of your own fallback, silently. Those slots address the modulation
 *  offsets, not the knobs. */
export interface ParamIndex {
  readonly slot: Readonly<Record<string, number>>;
  readonly length: number;
}

/** Resolve a slot, or -1 when the lane does not declare the id. The `-1` guard
 *  is the plugin's job to write once, in setLiveValues, not per sample. */
export const slotOf = (ix: ParamIndex, id: string): number => (ix.slot[id] ?? -1);

/** Live, additive modulation offsets, NORMALISED (the sum of LFO `wave×depth`,
 *  roughly -1..1), addressed by the SAME ParamIndex as the live values. A
 *  renderer reads `mo[this.sCutoff]` with the slot it already resolved in
 *  setLiveValues — modulation targets are the engine's own param ids, plus the
 *  three synthetic ones the index appends, so there is no second numbering.
 *
 *  Undefined means NOTHING is modulating, and that is not the same as an array
 *  of zeroes: the host hands back undefined so a renderer's per-target reads
 *  short-circuit instead of running and finding nothing. Test `mo` once, not
 *  per target.
 *
 *  It used to be a Record keyed by target name, with Subtractive keyed by flat
 *  SubParams fields and everyone else by dot-id. One numbering replaced both. */
export type VoiceModOffsets = Float64Array;

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
   *  Optional: a renderer without it keeps the trigger-time snapshot behaviour.
   *
   *  @deprecated Implement setLiveValues instead. Both are honoured while the
   *  in-tree renderers convert one at a time; the name-keyed bag is a view over
   *  the values array and goes away with the last caller. */
  setLiveParams?(live: ParamBag): void;
  /** The same contract as setLiveParams, addressed by SLOT. `values` is the
   *  lane's live array, mutated in place — keep the reference and read
   *  `values[i]` per sample. `index` is stable for the lane's lifetime, so
   *  resolve every slot you need HERE, once, and never look up a name again in
   *  renderSample. The STRUCTURAL exclusions above apply unchanged.
   *
   *  A renderer that implements this does NOT also get setLiveParams called. */
  setLiveValues?(values: Float64Array, index: ParamIndex): void;
  /** True once the release tail has fully decayed at the last rendered t. */
  readonly done: boolean;
}
