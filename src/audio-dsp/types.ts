/** Flat per-lane subtractive parameter snapshot. Mirrors the PolySynthParams
 *  tree (src/polysynth/polysynth.ts) but flattened to the dot-id vocabulary
 *  used by the SubtractiveEngine param specs, with waves as 0..3 indices. */
export interface SubParams {
  masterTune: number;       // semitones
  unisonVoices: number;     // 1..7 stacked copies of osc1/osc2 (read at trigger)
  unisonDetune: number;     // spread across the stack, cents
  unisonDrift: number;      // 0..1 analog per-copy pitch wander
  osc1Wave: number; osc1Level: number; osc1Detune: number;   // wave 0..3, level 0..1, detune cents
  osc1Pw: number; osc1Sync: number;                                            // pulse width 0.05..0.95 (square only)
  osc2Wave: number; osc2Level: number; osc2Detune: number;
  osc2Pw: number; osc2Sync: number;
  subLevel: number;
  noiseLevel: number; noiseColor: number;                    // color 0..1
  filterCutoff: number; filterResonance: number; filterEnvAmount: number;
  filterModel: number;      // 0 = DIG (Svf), 1 = MOG ladder, 2 = 303 diode ladder
  filterType: number;       // 0 = LP, 1 = HP, 2 = BP, 3 = NOTCH
  filterDrive: number; filterKeyTrack: number; filterBuiltinEnv: number; // builtinEnv 0/1
  filterAttack: number; filterDecay: number; filterSustain: number; filterRelease: number;
  ampBuiltinEnv: number;                                     // 0/1
  ampAttack: number; ampDecay: number; ampSustain: number; ampRelease: number;
}

// The plugin-facing half of this module now lives in @loom/plugin-sdk (a plugin
// compiles against it). Re-exported so every existing import keeps working.
export type { NoteSpec, ParamBag, VoiceModOffsets, ModEnvSpec, ParamIndex } from '@loom/plugin-sdk';
export { param, slotOf } from '@loom/plugin-sdk';
import type { VoiceRenderer as SdkVoiceRenderer } from '@loom/plugin-sdk';

/** A modulation destination: any SubParams field, plus two synthetic targets:
 *  `ampGain` (a multiplicative output gain — tremolo), and `amp` (the per-voice
 *  AMPLITUDE envelope itself — an ADSR routed here becomes the voice's amp env). */
export type ModTarget = keyof SubParams | 'ampGain' | 'amp' | 'filterEnv';

/** The host's renderer interface: the published contract plus the one hook that
 *  is deliberately NOT public — Subtractive reads a typed SubParams instead of
 *  the dot-id bag, an internal optimisation no plugin should depend on.
 *  `SubParams` stays declared in this same file. */
export interface VoiceRenderer extends SdkVoiceRenderer {
  /** Subtractive-only: it reads a TYPED SubParams, not the dot-id bag, so the lane
   *  keeps ONE live snapshot and every voice reads through it — refreshed once per
   *  lane per sample, never once per voice. (The engineId special-case mirrors the
   *  one fillOffsets already makes for the same reason.) */
  setLiveSubParams?(live: SubParams): void;
}
