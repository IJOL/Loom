// src/notefx/notefx-types.ts
// A note-FX transforms the stream of note events a lane is about to fire.
// 1 note in → 0..N notes out. Pure: no Web Audio.

import type { ScaleId } from '../core/musicality';

export interface NoteFxEvent {
  note: number;      // MIDI note number
  time: number;      // absolute AudioContext seconds
  gate: number;      // seconds the note holds
  accent: boolean;
  /** Optional normalized velocity (1-127). When absent, accent implies 127. */
  velocity?: number;
}

export interface NoteFxContext {
  bpm: number;
  /** Playback seed: changes every time the transport starts so random FX sound
   *  different per run, but stays stable during a single run. */
  seed?: number;
  /** Effective tonality for scale-aware FX. */
  key?: number;
  scale?: ScaleId;
}

export interface NoteFxProcessor {
  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[];
}

export type NoteFxKind = 'arp' | 'chord' | 'random';

export interface NoteFxState {
  id: string;                 // 'arp1', 'chord1', 'random1'…
  kind: NoteFxKind;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}
