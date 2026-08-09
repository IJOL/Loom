// Turns a lane's weave into the notes the scheduler plays for one iteration.
//
// It was a PREDICATE first — "does this clip note fire?" — and that shape could
// not work: a predicate over the clip's own notes can only take hits away, so at
// the far end of a crossfade the lane fell silent instead of handing over to the
// other loop. A crossfade has to be able to let hits IN, which means producing
// notes, not judging them. Found by counting triggers through the real
// transport (app/weave-scheduling.test.ts); the isolated tests all passed.
//
// The blend is computed once per distinct weight set and cached, because this
// runs on the scheduler's tick.

import type { NoteEvent } from '../core/notes';
import { blendLoops, blendLoopsBySource, type BlendOptions } from './blend-clip';
import { laneWeights, type LaneWeaveConfig } from './weave-state';
import { avoidClash } from './harmony-guard';
import { applyNoteMacros } from './macro-notes';


/** A note the weave produced. `layerIndex` names the loop it survived from,
 *  which a layered instrument reads as which of its slots should play it. */
export type WovenNote = NoteEvent & { layerIndex?: number };

/** What the lane should PLAY this bar, or undefined for "play your own clip".
 *
 *  A source, not a predicate. The first shape of this hook asked "does this
 *  clip note fire?", which can only ever take notes AWAY — so at the far end of
 *  a crossfade the lane fell silent instead of handing over to the other loop.
 *  A crossfade has to be able to let hits in. */
export type WeaveSource = () => WovenNote[] | undefined;

/** The two macros that rewrite notes, read at ask time so a knob moved while the
 *  transport runs is heard on the next bar rather than the next launch. */
export type ReadNoteMacros = () => { density: number; energy: number };

const NEUTRAL_NOTE_MACROS: ReadNoteMacros = () => ({ density: 0.5, energy: 0.5 });

export function createWeaveSource(
  cfg: LaneWeaveConfig,
  o: BlendOptions,
  /** True when the lane's instrument has layers, so each hit can name the loop
   *  it came from. False — the ordinary case — and the notes carry nothing,
   *  because a layer index on an engine with no layers is a number nobody
   *  reads. */
  routeByOrigin = false,
  /** The macros, applied ON TOP of the blend. They shape whatever is playing,
   *  and what is playing here is the cross-fade — a lane that was weaving used
   *  to be the one lane the macros could not touch. */
  readMacros: ReadNoteMacros = NEUTRAL_NOTE_MACROS,
): WeaveSource {
  let cacheKey = '';
  let woven: WovenNote[] = [];

  return () => {
    const weights = laneWeights(cfg);
    const m = readMacros();
    // Rounding keeps a continuously moving fader from refolding on every
    // animation frame. 1e-3 of a crossfade is finer than any audible step, and
    // coarse enough that a slow sweep refolds tens of times rather than
    // thousands. Worth caring about: this runs on the scheduler's tick.
    const key = `${weights.map((w) => w.weight.toFixed(3)).join(',')}|${o.barTicks}`
      + `|${m.density.toFixed(3)}|${m.energy.toFixed(3)}`;
    if (key !== cacheKey) {
      cacheKey = key;
      // The sourced fold when the origin is wanted, the plain one when it is
      // not — the same notes either way; the sourced one only also says where
      // each came from. A loop at weight 0 is filtered out before folding, so
      // an origin always names a loop that is genuinely sounding.
      const blended = routeByOrigin
        ? blendLoopsBySource(weights, o).map((n) => ({ ...n, layerIndex: n.from }))
        : blendLoops(weights, o);
      // applyNoteMacros spreads each note, so a layerIndex survives it. Density
      // may drop or split a hit; a split inherits its parent's layer, which is
      // right — the extra hit belongs to the loop the note came from.
      woven = applyNoteMacros(blended, m, o.barTicks) as WovenNote[];
    }
    return woven;
  };
}

/** The MACROS alone, over the clip's own notes.
 *
 *  This is what makes the panel audible before any A/B loops are chosen: with
 *  no weave configured there is nothing to crossfade, but Density still has
 *  something to say about the clip that is playing.
 *
 *  Only Density reaches the sound so far. Now that this is a note SOURCE rather
 *  than a predicate, Energy could too — it moves velocity, which a source can
 *  rewrite and a predicate never could. See REMAINING-WORK.
 *
 *  `readMacros` is called per refresh rather than captured, so a knob moved
 *  while the transport runs is heard on the next note, not the next launch. */
export function createMacroSource(
  getNotes: () => NoteEvent[],
  readMacros: ReadNoteMacros,
  barTicks: number,
): WeaveSource {
  let cacheKey = '';
  let out: NoteEvent[] = [];

  return () => {
    const m = readMacros();
    const notes = getNotes();
    // Keyed on the macros AND the note count, so a clip swap under the same
    // settings still refolds. Rounding keeps a moving knob from refolding on
    // every frame.
    const key = `${m.density.toFixed(3)}|${m.energy.toFixed(3)}|${notes.length}|${barTicks}`;
    if (key !== cacheKey) {
      cacheKey = key;
      out = applyNoteMacros(notes, m, barTicks);
    }
    return out;
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
