// src/core/tempo-map.ts
// A tempo map: tempo changes anchored at musical ticks (Loom's TICKS_PER_QUARTER
// grid). Converts musical position (ticks) ↔ wall-clock seconds for a piecewise-
// constant tempo (the SMF model: each tempo holds until the next change).
//
// The scheduler's time math is normally `tick × (60/bpm)/TPQ` (constant tempo).
// With tempo changes that becomes the integral of the tempo over [0, tick], which
// is what tickToSec() computes. secToTick() is the inverse, for the playhead.

import { TICKS_PER_QUARTER } from './notes';

export interface TempoPoint { tick: number; bpm: number; }
/** A normalized tempo map: sorted, anchored at tick 0, ≥1 entry, all bpm > 0. */
export type TempoMap = TempoPoint[];

export const DEFAULT_TEMPO_BPM = 120;

/** Normalize raw tempo points: drop bad bpm, sort by tick, ensure a tick-0 anchor.
 *  Empty input → a single fallback-bpm point at tick 0. */
export function makeTempoMap(points: TempoPoint[], fallbackBpm = DEFAULT_TEMPO_BPM): TempoMap {
  const valid = points.filter((p) => p.bpm > 0 && isFinite(p.bpm) && p.tick >= 0)
    .sort((a, b) => a.tick - b.tick);
  if (valid.length === 0) return [{ tick: 0, bpm: fallbackBpm }];
  if (valid[0].tick > 0) return [{ tick: 0, bpm: valid[0].bpm }, ...valid];
  return valid;
}

/** A real tempo map varies — more than one distinct tempo. */
export function hasTempoChanges(map: TempoMap): boolean {
  return map.length > 1 && map.some((p) => p.bpm !== map[0].bpm);
}

/** The tempo (bpm) in effect at `tick`. */
export function bpmAtTick(map: TempoMap, tick: number): number {
  let bpm = map[0].bpm;
  for (const p of map) { if (p.tick <= tick) bpm = p.bpm; else break; }
  return bpm;
}

const secPerTick = (bpm: number) => (60 / bpm) / TICKS_PER_QUARTER;

/** Absolute seconds from tick 0 to `tick`, integrating the piecewise-constant map. */
export function tickToSec(map: TempoMap, tick: number): number {
  if (tick <= 0) return 0;
  let sec = 0;
  for (let i = 0; i < map.length; i++) {
    const segStart = map[i].tick;
    if (tick <= segStart) break;
    const segEnd = i + 1 < map.length ? map[i + 1].tick : Infinity;
    const upto = Math.min(tick, segEnd);
    sec += (upto - segStart) * secPerTick(map[i].bpm);
    if (tick <= segEnd) break;
  }
  return sec;
}

/** Inverse of tickToSec: the tick at absolute second `sec` (for the playhead).
 *  Past the end, extends at the final tempo. */
export function secToTick(map: TempoMap, sec: number): number {
  if (sec <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < map.length; i++) {
    const segStart = map[i].tick;
    const segEnd = i + 1 < map.length ? map[i + 1].tick : Infinity;
    const spt = secPerTick(map[i].bpm);
    const segSec = (segEnd - segStart) * spt;
    if (sec <= acc + segSec) return segStart + (sec - acc) / spt;
    acc += segSec;
  }
  const last = map[map.length - 1];
  return last.tick + (sec - acc) / secPerTick(last.bpm);
}

/** Seconds spanned by [startTick, endTick) under the map. */
export function tickRangeSec(map: TempoMap, startTick: number, endTick: number): number {
  return tickToSec(map, endTick) - tickToSec(map, startTick);
}
