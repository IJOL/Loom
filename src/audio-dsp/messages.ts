import type { NoteSpec, ParamBag } from './types';
import type { ModLite } from './modulation-runtime';

export type MainToWorklet =
  | { type: 'spawn'; note: NoteSpec }
  | { type: 'params'; params: ParamBag }   // dot-id → value
  | { type: 'mods'; mods: ModLite[] }
  | { type: 'config'; maxVoices: number }
  | { type: 'steal'; count: number }
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
