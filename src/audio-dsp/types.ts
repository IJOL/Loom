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
  ringLevel: number;        // 0..1 level of the osc1 × osc2 product in the mix
  subLevel: number;
  noiseLevel: number; noiseColor: number;                    // color 0..1
  filterCutoff: number; filterResonance: number; filterEnvAmount: number;
  filterModel: number;      // index into FILTER_MODES (audio-dsp/filter-kinds.ts)
  filterType: number;       // index into THAT mode's own taps, clamped
  filterRouting: number;    // 0 = off, 1 = series, 2 = parallel, 3 = difference
  filterBlend: number;      // 0..1 how much of filter B is in the result
  filter2Model: number; filter2Type: number;
  filter2Cutoff: number; filter2Resonance: number;
  filter2Track: number;     // 0..1 how far B follows A's envelope + key track
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

/** A modulation destination: a param's own dot-id, plus the three synthetic
 *  targets in SYNTHETIC_TARGETS — `amp.gain` (a multiplicative output gain,
 *  i.e. tremolo), `amp` (the per-voice AMPLITUDE envelope itself: an ADSR routed
 *  here BECOMES the voice's amp env) and `filter.env` (the same for the filter).
 *
 *  It used to be `keyof SubParams | …`, which only ever described SUBTRACTIVE's
 *  vocabulary while every other engine already used dot-ids. It is now what it
 *  always was in practice: a name, resolved to a slot at the one boundary that
 *  can do it (ModulationRuntime.bindIndex). ModulationRuntime itself is
 *  deliberately vocabulary-agnostic — it sums whatever names it is handed. */
export type ModTarget = string;

/** The host's renderer interface. It used to add one hook that was deliberately
 *  NOT public — setLiveSubParams, by which Subtractive read a typed SubParams
 *  instead of the dot-id bag, "an internal optimisation no plugin should depend
 *  on". That asymmetry is what the params-by-index work removed: the optimisation
 *  was given to everyone as a Float64Array read by slot, so Subtractive reads
 *  exactly what a plugin reads and the host adds nothing of its own here.
 *
 *  SubParams survives above, but only as the subtractive MODULATION vocabulary
 *  (ModTarget / mod-lite's DOT_TO_FIELD) and as that renderer's own trigger-time
 *  snapshot. It is no longer on the live path. */
export type VoiceRenderer = SdkVoiceRenderer;
