// src/engines/sampler-pad-params.ts
// Per-pad (per-keymap-entry) sound + playback params for the Sampler. A pad is
// identified by its trigger MIDI note. The pad KEY is `zone<note>` — a UNIQUE,
// note-based identity. (GM voice names are NOT used as the identity: doing so
// merged distinct notes — loop slices, multi-note GM voices like tom 41/43/45/47/48
// — into one pad, sharing params + mute/solo. GM is a drumkit DISPLAY concern only,
// applied where the rack is built; loops have nothing to do with GM.)

import type { EngineParamSpec } from './engine-params';

export interface PadParams {
  tune: number;      // semitones, -24..24
  cutoff: number;    // 0..1 (60..18000 Hz exp)
  res: number;       // 0..1
  attack: number;    // s
  decay: number;     // s (release tail)
  level: number;     // 0..1.5
  pan: number;       // -1..1
  rev: number;       // 0..1
  dly: number;       // 0..1
  loop: number;      // 0 = one-shot, 1 = loop while gated
  loopStart: number; // 0..1 of sample duration
  retrig: number;    // 0 = poly, 1 = mono (re-hit cuts previous)
}

export const PAD_DEFAULTS: PadParams = {
  tune: 0, cutoff: 1, res: 0, attack: 0.005, decay: 0.08,
  level: 1, pan: 0, rev: 0, dly: 0, loop: 0, loopStart: 0, retrig: 0,
};

const ON_OFF = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }];
const POLY_MONO = [{ value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }];

/** Per-leaf spec templates; id is filled with `${padKey}.${leaf}` per pad. */
export const PAD_LEAF_SPECS: Array<Omit<EngineParamSpec, 'id'> & { leaf: keyof PadParams }> = [
  { leaf: 'tune',      label: 'TUNE',   kind: 'continuous', min: -24,   max: 24,  default: 0, unit: 'st' },
  { leaf: 'cutoff',    label: 'CUTOFF', kind: 'continuous', min: 0,     max: 1,   default: 1 },
  { leaf: 'res',       label: 'RES',    kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'attack',    label: 'ATTACK', kind: 'continuous', min: 0.001, max: 2,   default: 0.005, unit: 's', curve: 'exponential' },
  { leaf: 'decay',     label: 'DECAY',  kind: 'continuous', min: 0.005, max: 4,   default: 0.08,  unit: 's', curve: 'exponential' },
  { leaf: 'level',     label: 'LEVEL',  kind: 'continuous', min: 0,     max: 1.5, default: 1 },
  { leaf: 'pan',       label: 'PAN',    kind: 'continuous', min: -1,    max: 1,   default: 0 },
  { leaf: 'rev',       label: 'REV',    kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'dly',       label: 'DLY',    kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'loop',      label: 'LOOP',   kind: 'discrete',   min: 0,     max: 1,   default: 0, options: ON_OFF },
  { leaf: 'loopStart', label: 'LSTART', kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'retrig',    label: 'RETRIG', kind: 'discrete',   min: 0,     max: 1,   default: 0, options: POLY_MONO },
];

/** Pad key for a trigger note — a UNIQUE per-note identity (`zone<note>`). */
export function padKeyForNote(note: number): string {
  return `zone${note}`;
}

/** Inverse of padKeyForNote. */
export function noteForPadKey(key: string): number {
  return Number(key.replace(/^zone/, ''));
}

/** The trigger note for a NEW pad when growing a variable-size kit: just above the
 *  current max, skipping any note already in use. Returns 127 if nothing is free. */
export function nextFreePadNote(notes: readonly number[]): number {
  const used = new Set(notes);
  let note = (notes.length ? Math.max(...notes) : 35) + 1;
  while (note < 127 && used.has(note)) note++;
  return note;
}
