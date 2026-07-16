/** Flat per-lane subtractive parameter snapshot. Mirrors the PolySynthParams
 *  tree (src/polysynth/polysynth.ts) but flattened to the dot-id vocabulary
 *  used by the SubtractiveEngine param specs, with waves as 0..3 indices. */
export interface SubParams {
  masterTune: number;       // semitones
  osc1Wave: number; osc1Level: number; osc1Detune: number;   // wave 0..3, level 0..1, detune cents
  osc1Pw: number;                                            // pulse width 0.05..0.95 (square only)
  osc2Wave: number; osc2Level: number; osc2Detune: number;
  osc2Pw: number;
  subLevel: number;
  noiseLevel: number; noiseColor: number;                    // color 0..1
  filterCutoff: number; filterResonance: number; filterEnvAmount: number;
  filterDrive: number; filterKeyTrack: number; filterBuiltinEnv: number; // builtinEnv 0/1
  filterAttack: number; filterDecay: number; filterSustain: number; filterRelease: number;
  ampBuiltinEnv: number;                                     // 0/1
  ampAttack: number; ampDecay: number; ampSustain: number; ampRelease: number;
}

/** One scheduled note. beginSec/durationSec are AudioContext seconds; the
 *  processor converts to sample frames. */
export interface NoteSpec {
  midi: number;
  beginSec: number;
  durationSec: number;
  velocity: number;   // 0..1
  accent: boolean;
  slide: boolean;
}

/** Generic engine parameter bag: dot-id (`'filter.cutoff'`, `'op1.ratio'`, …)
 *  → value. Replaces the typed SubParams as the cross-engine param carrier so
 *  one VoiceManager/worklet drives any engine kind. */
export type ParamBag = Record<string, number>;

/** Read a ParamBag value with a default fallback. */
export const param = (b: ParamBag, id: string, d: number): number => (b[id] ?? d);

/** A modulation destination: any SubParams field, plus two synthetic targets:
 *  `ampGain` (a multiplicative output gain — tremolo), and `amp` (the per-voice
 *  AMPLITUDE envelope itself — an ADSR routed here becomes the voice's amp env). */
export type ModTarget = keyof SubParams | 'ampGain' | 'amp' | 'filterEnv';

/** Live, additive modulation offsets, NORMALISED (the sum of LFO `wave×depth`,
 *  roughly -1..1). Keyed by target NAME: a SubParams field for Subtractive, or a
 *  param dot-id ('filter.cutoff', 'osc.morph', 'op1.level'…) for the other
 *  engines — generic, so one VoiceManager path drives every engine. The renderer
 *  scales each to native units at read time. */
export type VoiceModOffsets = Record<string, number>;

/** A pooled, per-sample voice. Pure: no Web Audio. */
export interface VoiceRenderer {
  /** Render one mono sample at absolute time t (seconds). `modOffsets` are the
   *  shared-LFO offsets computed once per sample by the VoiceManager and applied
   *  at read time on top of the voice's spawned-snapshot params. Omitted ⇒ no
   *  modulation. */
  renderSample(t: number, modOffsets?: VoiceModOffsets): number;
  /** Live note-off: end the gate at time t (release tail still plays). */
  noteOff(t: number): void;
  /** True once the release tail has fully decayed at the last rendered t. */
  readonly done: boolean;
}
