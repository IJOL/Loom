// SPDX-License-Identifier: AGPL-3.0-or-later
// Brought over from mpump's engine/euclidean.ts — https://github.com/gdamdam/mpump
// Copyright (C) 2024-2026 gdamdam, licensed AGPL-3.0-or-later. Loom inherits
// that licence here; see LICENSE.
//
// Euclidean rhythms via Bjorklund's algorithm: spread K hits as evenly as
// possible over N steps. Almost every world rhythm turns out to be one —
// E(3,8) is the Cuban tresillo (x..x..x.), E(5,8) the cinquillo (x.xx.xx.),
// E(4,16) four on the floor — which makes it the cheapest groove primitive
// there is: two numbers instead of sixteen toggles.

import { TICKS_PER_STEP, type NoteEvent } from './notes';
import type { DrumVoice } from './drums';
import { VOICE_MIDI } from '../engines/drum-gm-map';

const NORM = 80;

/** hits/steps arrive from number fields, so they can be fractional or NaN.
 *  `Array(NaN)` throws where a rhythm generator should just fall silent. */
const count = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/**
 * The Bjorklund pattern: `hits` onsets spread over `steps`, rotated left by
 * `rotation` (negative rotates right; it wraps either way).
 */
export function euclid(hits: number, steps: number, rotation = 0): boolean[] {
  const n = count(steps);
  const k = Math.min(count(hits), n);
  if (n === 0) return [];
  if (k === 0) return Array(n).fill(false);
  if (k === n) return Array(n).fill(true);

  // Bjorklund: repeatedly fold the shorter list into the longer one, pairwise,
  // until at most one group is left over. What survives is maximally even.
  let groups: boolean[][] = Array.from({ length: k }, () => [true]);
  let rest: boolean[][] = Array.from({ length: n - k }, () => [false]);
  while (rest.length > 1) {
    const pairs = Math.min(groups.length, rest.length);
    const merged = groups.slice(0, pairs).map((g, i) => [...g, ...rest[i]]);
    rest = (groups.length > rest.length ? groups : rest).slice(pairs);
    groups = merged;
  }

  const flat = [...groups, ...rest].flat();
  const r = ((rotation % n) + n) % n;
  return [...flat.slice(r), ...flat.slice(0, r)];
}

export interface EuclidCycle {
  hits: number;
  steps: number;
  rotation?: number;
  velocity?: number; // 0-127, >= 100 reads as an accent (see notes.ts)
}

export interface EuclidSpec extends EuclidCycle {
  voice: DrumVoice;
}

/**
 * Fill `totalSteps` of a clip with an Euclidean pattern laid on one midi. A
 * cycle shorter than the clip repeats, so `steps` that does not divide the clip
 * length phases against it — a 5-step voice under a 16-step clip is the
 * polyrhythm you actually want, not a mistake.
 *
 * Midi-addressed rather than voice-addressed because a sample drumkit's pad has
 * no DrumVoice behind it; `euclidNotes` is this with the GM lookup done.
 */
export function euclidNotesAt(midi: number, spec: EuclidCycle, totalSteps = spec.steps): NoteEvent[] {
  const cycle = euclid(spec.hits, spec.steps, spec.rotation ?? 0);
  if (cycle.length === 0) return [];
  const out: NoteEvent[] = [];
  for (let i = 0; i < count(totalSteps); i++) {
    if (!cycle[i % cycle.length]) continue;
    out.push({
      start: i * TICKS_PER_STEP,
      duration: TICKS_PER_STEP,
      midi,
      velocity: spec.velocity ?? NORM,
    });
  }
  return out;
}

/** `euclidNotesAt` for one of the synth drum voices, on its canonical GM midi. */
export function euclidNotes(spec: EuclidSpec, totalSteps = spec.steps): NoteEvent[] {
  return euclidNotesAt(VOICE_MIDI[spec.voice], spec, totalSteps);
}
