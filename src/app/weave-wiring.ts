// Where WEAVE's live state lives, and how it reaches the scheduler.
//
// It sits here rather than inside the panel because two things need it and
// neither can own it: the session host asks for a gate on every tick, and the
// panel plugin reads and writes the macros. The host is built before the panel
// exists, so the state has to outlive both.
//
// This file is also the one place that turns a REMEMBERED selection (loop ids)
// into the material the blend folds (note arrays). The lookup happens here, at
// ask time, because the clips are the session's and they move underneath.

import { defaultWeaveState, type WeaveState, type LaneWeaveConfig } from '../weave/weave-state';
import { createWeaveSource, createMacroSource, type WeaveSource } from '../weave/weave-runtime';
import { resolveSelection } from '../weave/weave-selection';
import { weaveLoopNotes, weaveLoopContext } from './weave-loops';
import { macroNeutral } from '../weave/weave-catalog';
import { isHarmonic } from '../plugins/capabilities';
import { LAYERS_ENGINE_ID } from '../engines/layers-engine';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { ticksPerBar, type TimeSignature } from '../core/meter';
import type { NoteEvent } from '../core/notes';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

export interface WeaveWiring {
  state: WeaveState;
  /** Handed to the session host. Returns undefined for a lane WEAVE has nothing
   *  to say about, which is what keeps the whole feature additive: an untouched
   *  session schedules exactly as it did before. */
  notesFor: (laneId: string) => WeaveSource | undefined;
  /** Drop every cached source. Called when a macro moves, a loop is chosen or
   *  the topology changes, so the next tick rebuilds against the new value
   *  rather than answering from the old fold. */
  invalidate: () => void;
}

export interface WeaveWiringDeps {
  getLaneStates: () => Map<string, LanePlayState>;
  getMeter: () => TimeSignature;
  /** The session itself, for the clips a lane's selection names. A getter, not
   *  a value: New and Open replace the whole object. */
  getState?: () => SessionState;
}

export function createWeaveWiring(deps: WeaveWiringDeps): WeaveWiring {
  const state = defaultWeaveState();
  const sources = new Map<string, WeaveSource>();

  const macro = (id: string) => {
    const v = state.macros[id];
    return Number.isFinite(v) ? v : macroNeutral(id);
  };

  /** A loop id → its notes, through the SAME module the panel lists from. Two
   *  resolvers would eventually disagree, and the failure would be a loop that
   *  shows in the dropdown and plays silence.
   *
   *  Rebuilt per ask because everything it reads moves: a clip's notes are
   *  edited in place, the lane's style changes, the key changes. */
  const notesOf = (laneId: string) => (loopId: string): NoteEvent[] | undefined => {
    const session = deps.getState?.();
    return weaveLoopNotes(loopId, weaveLoopContext(
      session?.lanes.find((l) => l.id === laneId),
      session?.musicality ?? DEFAULT_MUSICALITY,
      state.lanes[laneId]?.forcedStyle,
    ));
  };

  /** The two macros that rewrite notes. A getter, so a knob moved while the
   *  transport runs reaches the next bar rather than the next launch. */
  const noteMacros = () => ({ density: macro('density'), energy: macro('energy') });

  /** Both at their neutral ⇒ the macro layer is the identity, so a lane with no
   *  weave keeps the untouched scheduling path and the feature costs nothing
   *  until someone opens the panel. */
  const noteMacrosAreNeutral = () =>
    macro('density') === macroNeutral('density') && macro('energy') === macroNeutral('energy');

  const lanesEngineId = (laneId: string): string | undefined =>
    deps.getState?.().lanes.find((l) => l.id === laneId)?.engineId;

  const melodicLane = (laneId: string): boolean => {
    const lane = deps.getState?.().lanes.find((l) => l.id === laneId);
    // Percussion is never transposed: a drum note picks a voice, not a pitch.
    // Asked through the capability door, so a plugin drum machine answers for
    // itself rather than the core keeping a list of ids that mean "drums".
    return lane ? isHarmonic(lane.engineId) : true;
  };

  /** The key and scale the blend walks its degrees in. The session already has
   *  one — the toolbar shows it — and taking a second opinion here is how a
   *  weave would end up in a different key from everything else on screen. */
  const musicality = () => deps.getState?.().musicality ?? DEFAULT_MUSICALITY;

  const build = (laneId: string): WeaveSource | undefined => {
    const barTicks = ticksPerBar(deps.getMeter());
    const sel = state.lanes[laneId]?.weave;

    if (sel) {
      const weave = resolveSelection(sel, notesOf(laneId));
      if (weave) {
        // The crossfade proper. `cfg` is handed by reference and read on every
        // refresh, so dragging the fader moves the blend without rebuilding the
        // source — which is what keeps its cache worth having.
        const cfg: LaneWeaveConfig = {
          weave,
          locked: state.lanes[laneId]?.locked ?? false,
          harmonyLeader: state.lanes[laneId]?.harmonyLeader ?? false,
        };
        const m = musicality();
        // A lane whose instrument HAS layers gets its notes routed by origin:
        // the merged bar comes out shared between the loops' own instruments
        // rather than played by one. Asked of the lane's engine, so it costs
        // nothing on every other lane.
        const layered = lanesEngineId(laneId) === LAYERS_ENGINE_ID;
        return createWeaveSource(cfg, {
          barTicks,
          melodic: melodicLane(laneId),
          key: m.key,
          scale: m.scale,
          // Where degree 0 sits. Three is the octave the blend counts from; it
          // only has to agree with itself, since both sides of a pair are
          // converted through the same base.
          octaveBase: 3,
        }, layered, noteMacros);
      }
    }

    // No loops chosen: the macros still have something to say about the clip
    // that is playing. At the neutrals they say nothing, and the lane keeps the
    // untouched scheduling path.
    if (noteMacrosAreNeutral()) return undefined;
    return createMacroSource(
      // Read the clip at ask time, not at build time: the lane's playing clip
      // changes on every scene launch, and a source holding the old one would
      // silence the new clip entirely.
      () => deps.getLaneStates().get(laneId)?.playing?.notes ?? [],
      noteMacros,
      barTicks,
    );
  };

  return {
    state,

    notesFor(laneId) {
      if (sources.has(laneId)) return sources.get(laneId);
      const source = build(laneId);
      // Only real sources are cached. "Nothing to say" costs one map read and
      // one number compare to re-derive, cheaper than the sentinel a Map needs
      // to remember an absence — and it means a lane starts weaving on the tick
      // after a loop is chosen even if someone forgets to invalidate.
      if (source) sources.set(laneId, source);
      return source;
    },

    invalidate() {
      sources.clear();
    },
  };
}
