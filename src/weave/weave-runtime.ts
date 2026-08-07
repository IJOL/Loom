// Turns a lane's weave into the predicate the scheduler asks, once per note.
//
// The blend is computed once per distinct weight set and cached, because
// tickLane asks this for EVERY note in the look-ahead window. Refolding four
// patterns per note would put the crossfade inside the audio budget, which is
// the one place in Loom where being clever costs dropouts.

import type { NoteEvent } from '../core/notes';
import { blendLoops, type BlendOptions } from './blend-clip';
import { laneWeights, type LaneWeaveConfig } from './weave-state';
import { avoidClash } from './harmony-guard';

const hitKey = (tick: number, midi: number) => `${tick}:${midi}`;

export type WeaveGate = (
  note: { midi: number },
  scheduleTime: number,
  clipTick: number,
) => boolean;

export function createWeaveGate(cfg: LaneWeaveConfig, o: BlendOptions): WeaveGate {
  let cacheKey = '';
  let allowed = new Set<string>();

  const refresh = () => {
    const weights = laneWeights(cfg);
    // Rounding keeps a continuously moving fader from busting the cache on
    // every animation frame. 1e-3 of a crossfade is finer than any audible
    // step, and coarse enough that a slow sweep refolds tens of times rather
    // than thousands.
    const key = weights.map((w) => w.weight.toFixed(3)).join(',') + `|${o.barTicks}`;
    if (key === cacheKey) return;
    cacheKey = key;
    allowed = new Set(
      blendLoops(weights, o).map((n: NoteEvent) => hitKey(n.start % o.barTicks, n.midi)),
    );
  };

  return (note, _scheduleTime, clipTick) => {
    refresh();
    // The scheduler counts ticks from the clip start and keeps counting across
    // iterations; the blend only ever describes one bar.
    const inBar = ((clipTick % o.barTicks) + o.barTicks) % o.barTicks;
    return allowed.has(hitKey(inBar, note.midi));
  };
}

export interface LaneWeaveEntry {
  laneId: string;
  cfg: LaneWeaveConfig;
  /** Percussion is skipped by the harmony rule: a drum note picks a voice, not
   *  a pitch, so there is no interval to forbid. */
  melodic: boolean;
}

/** Blends every lane, then lets the leading lane's lowest note veto the
 *  intervals that clash with it.
 *
 *  The leader is NEVER altered. It is the reference, and moving it would make
 *  the rule chase its own tail: a lane adjusting to a root that adjusts to the
 *  lane. */
export function createWeaveNotes(
  entries: LaneWeaveEntry[], o: BlendOptions,
): Map<string, NoteEvent[]> {
  const blended = new Map<string, NoteEvent[]>();
  for (const e of entries) {
    blended.set(e.laneId, blendLoops(laneWeights(e.cfg), { ...o, melodic: e.melodic }));
  }

  const leader = entries.find((e) => e.cfg.harmonyLeader);
  if (!leader) return blended;

  const leaderNotes = blended.get(leader.laneId) ?? [];
  if (leaderNotes.length === 0) return blended;
  // The LOWEST note, because that is what tells the ear which chord this is:
  // the same melody over two different bass notes reads as two different
  // harmonies.
  const root = leaderNotes.reduce((lo, n) => Math.min(lo, n.midi), Infinity);

  for (const e of entries) {
    if (e.laneId === leader.laneId || !e.melodic) continue;
    blended.set(e.laneId, avoidClash(blended.get(e.laneId) ?? [], root, o.key, o.scale));
  }
  return blended;
}
