/** Flat per-lane subtractive parameter snapshot. Mirrors the PolySynthParams
 *  tree (src/polysynth/polysynth.ts) but flattened to the dot-id vocabulary
 *  used by the SubtractiveEngine param specs, with waves as 0..3 indices. */
export interface SubParams {
  masterTune: number;       // semitones
  osc1Wave: number; osc1Level: number; osc1Detune: number;   // wave 0..3, level 0..1, detune cents
  osc2Wave: number; osc2Level: number; osc2Detune: number;
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

/** A pooled, per-sample voice. Pure: no Web Audio. */
export interface VoiceRenderer {
  /** Render one mono sample at absolute time t (seconds). */
  renderSample(t: number): number;
  /** Live note-off: end the gate at time t (release tail still plays). */
  noteOff(t: number): void;
  /** True once the release tail has fully decayed at the last rendered t. */
  readonly done: boolean;
}
