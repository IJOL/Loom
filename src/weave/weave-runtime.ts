// Turns a lane's weave into the predicate the scheduler asks, once per note.
//
// The blend is computed once per distinct weight set and cached, because
// tickLane asks this for EVERY note in the look-ahead window. Refolding four
// patterns per note would put the crossfade inside the audio budget, which is
// the one place in Loom where being clever costs dropouts.

import type { NoteEvent } from '../core/notes';
import { blendLoops, blendLoopsBySource, type BlendOptions } from './blend-clip';
import { laneWeights, type LaneWeaveConfig } from './weave-state';
import { avoidClash } from './harmony-guard';
import { applyNoteMacros } from './macro-notes';

const hitKey = (tick: number, midi: number) => `${tick}:${midi}`;

/** `false` = the note does not belong to the crossfade at this position.
 *  `true` = it fires, plainly. A NUMBER = it fires, and it came from that loop —
 *  which a layered instrument reads as which of its instruments should play it.
 *
 *  A union rather than a returned object because this is asked once per note
 *  inside the look-ahead: an object per note would put an allocation in the
 *  audio budget, the one place in Loom where being tidy costs dropouts. */
export type WeaveGate = (
  note: { midi: number },
  scheduleTime: number,
  clipTick: number,
) => boolean | number;

export function createWeaveGate(
  cfg: LaneWeaveConfig,
  o: BlendOptions,
  /** True when the lane's instrument has layers, so each surviving hit can be
   *  sent to the one belonging to its loop. False — the ordinary case — and the
   *  gate answers plainly, because naming a layer on an engine that has none
   *  would be a number nobody reads. */
  routeByOrigin = false,
): WeaveGate {
  let cacheKey = '';
  let allowed = new Map<string, number>();

  const refresh = () => {
    const weights = laneWeights(cfg);
    // Rounding keeps a continuously moving fader from busting the cache on
    // every animation frame. 1e-3 of a crossfade is finer than any audible
    // step, and coarse enough that a slow sweep refolds tens of times rather
    // than thousands.
    const key = weights.map((w) => w.weight.toFixed(3)).join(',') + `|${o.barTicks}`;
    if (key === cacheKey) return;
    cacheKey = key;
    allowed = new Map(
      // The sourced fold when the origin is wanted, the plain one when it is
      // not — same notes either way; the sourced one only also says where each
      // came from. A loop at weight 0 was already filtered out, so an origin
      // here always names a loop that is genuinely sounding.
      routeByOrigin
        ? blendLoopsBySource(weights, o).map((n) => [hitKey(n.start % o.barTicks, n.midi), n.from] as const)
        : blendLoops(weights, o).map((n: NoteEvent) => [hitKey(n.start % o.barTicks, n.midi), -1] as const),
    );
  };

  return (note, _scheduleTime, clipTick) => {
    refresh();
    // The scheduler counts ticks from the clip start and keeps counting across
    // iterations; the blend only ever describes one bar.
    const inBar = ((clipTick % o.barTicks) + o.barTicks) % o.barTicks;
    const from = allowed.get(hitKey(inBar, note.midi));
    if (from === undefined) return false;
    return from < 0 ? true : from;
  };
}

/** A gate driven by the MACROS alone, over a clip's own notes.
 *
 *  This is what makes the panel audible before any A/B loops are chosen: with
 *  no weave configured there is nothing to crossfade, but Density still has
 *  something to say about the clip that is playing. It thins and thickens what
 *  is already there.
 *
 *  Only Density reaches the sound through a gate: a gate answers "does this note
 *  fire", so it can add and remove notes but cannot change one. Energy moves
 *  velocity and needs a transform rather than a predicate — see REMAINING-WORK.
 *
 *  `readMacros` is called per refresh rather than captured, so a knob moved
 *  while the transport runs is heard on the next note, not the next launch. */
export function createMacroGate(
  getNotes: () => NoteEvent[],
  readMacros: () => { density: number },
  barTicks: number,
): WeaveGate {
  let cacheKey = '';
  let allowed = new Set<string>();

  return (note, _at, clipTick) => {
    const density = readMacros().density;
    const notes = getNotes();
    // Keyed on the density AND the note count, so a clip swap under the same
    // density still refolds. Rounding keeps a moving knob from refolding on
    // every frame.
    const key = `${density.toFixed(3)}|${notes.length}|${barTicks}`;
    if (key !== cacheKey) {
      cacheKey = key;
      allowed = new Set(
        applyNoteMacros(notes, { density, energy: 0.5 }, barTicks)
          .map((n) => hitKey(n.start % barTicks, n.midi)),
      );
    }
    const inBar = ((clipTick % barTicks) + barTicks) % barTicks;
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
