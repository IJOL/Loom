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
  | { type: 'voices'; active: number };
