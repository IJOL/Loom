// src/notefx/notefx-types.ts
// A note-FX transforms the stream of note events a lane is about to fire.
// 1 note in → 0..N notes out. Pure: no Web Audio.

export interface NoteFxEvent {
  note: number;      // MIDI note number
  time: number;      // absolute AudioContext seconds
  gate: number;      // seconds the note holds
  accent: boolean;
}

export interface NoteFxContext {
  bpm: number;
}

export interface NoteFxProcessor {
  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[];
}

export type NoteFxKind = 'arp' | 'chord';

export interface NoteFxState {
  id: string;                 // 'arp1', 'chord1', …
  kind: NoteFxKind;
  enabled: boolean;
  params: Record<string, number | string>;
}
