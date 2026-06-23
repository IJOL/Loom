import type { NoteSpec, SubParams } from './types';
import type { ModLite } from './modulation-runtime';

export type MainToWorklet =
  | { type: 'spawn'; note: NoteSpec }
  | { type: 'params'; params: Partial<SubParams> }
  | { type: 'mods'; mods: ModLite[] }
  | { type: 'config'; maxVoices: number }
  | { type: 'steal'; count: number };

export type WorkletToMain =
  | { type: 'voices'; active: number };
