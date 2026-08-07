import type { NoteSpec, ParamBag } from './types';
import type { ModLite } from './modulation-runtime';

export type MainToWorklet =
  | { type: 'spawn'; note: NoteSpec }
  | { type: 'params'; params: ParamBag }   // dot-id → value
  | { type: 'mods'; mods: ModLite[] }
  | { type: 'config'; maxVoices: number }
  | { type: 'steal'; count: number }
  // Note-off for ONE voice, addressed by the id its spawn carried. This is what
  // lifting a single key sends. Distinct from `steal`, which is "silence the
  // lane" and is addressed by age, not identity — using steal for a key-up is
  // what made lifting one key of a chord kill the whole chord.
  | { type: 'release'; voiceId: number }
  // Per-lane state a renderer needs that is NOT a number, so it cannot travel as
  // a param: which engine sits in each of a LAYERS lane's slots, and where on
  // the keyboard. Sent whole rather than patched — it is small, it changes only
  // when the user edits the rack, and a patch protocol for four slots would be
  // more code than the thing it patches. Held by the lane and handed to every
  // voice at spawn, so a rack edit reaches the next note and never the one
  // already sounding (the same rule every structural param follows).
  | { type: 'structural'; structural: unknown }
  // Dispose: tell the processor to stop running. It answers by returning false
  // from process(), so the audio engine reclaims it instead of calling it forever.
  | { type: 'kill' };

export type WorkletToMain =
  | { type: 'voices'; active: number }
  // Live modulation telemetry: normalised offset (-1..1) per modulated param
  // field, summed over every source. Drives the UI knob rings off the REAL
  // modulation. Posted ~30 Hz while anything modulates, plus one empty snapshot
  // when it stops (so the rings clear).
  | { type: 'modValues'; offsets: Record<string, number> };
