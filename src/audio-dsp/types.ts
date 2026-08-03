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
 *  SubParams is gone from here entirely: with subtractive out of the tree its
 *  only remaining reader is that plugin's own dsp.ts, where it declares its
 *  trigger-time snapshot for itself. The host holds no engine's param struct. */
export type VoiceRenderer = SdkVoiceRenderer;
