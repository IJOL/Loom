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
import { weaveLoopNotes, weaveLoopContext, rehookOnArrival } from './weave-loops';
import { macroNeutral } from '../weave/weave-catalog';
import { isHarmonic } from '../plugins/capabilities';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { ticksPerBar, type TimeSignature } from '../core/meter';
import { applyFlow, flowAt } from '../weave/flow';
import { fillSteps } from '../automation/automation-steps';
import { TICKS_PER_QUARTER } from '../core/notes';
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
  /** Advance the master flow to where the clock now says it is.
   *
   *  Called per look-ahead tick, from the AUDIO clock rather than from the
   *  panel's animation: a weave that stopped travelling because the panel was
   *  closed — or because the tab went to the background and rAF throttled —
   *  would be a scene that quietly freezes behind your back. */
  advance: (nowSec: number) => void;
  /** Adopt a loaded weave, IN PLACE.
   *
   *  The state object is shared by reference with the panel and with the session
   *  host — that is what stops a knob moving a copy nobody plays — so replacing
   *  it wholesale would leave both holding the old one. Its contents are swapped
   *  instead, and every cached source dropped. */
  replace: (next: WeaveState) => void;
}

export interface WeaveWiringDeps {
  getLaneStates: () => Map<string, LanePlayState>;
  getMeter: () => TimeSignature;
  /** The tempo the flow measures its journey in. A getter for the same reason
   *  as the meter: both move while the transport runs. */
  getBpm?: () => number;
  // There was an `onFlowAdvanced` here, for whoever paints the panel to follow
  // the journey. Nobody ever passed it, and nobody should: the panel reads the
  // position from its OWN animation frame, which is both cheaper than a callback
  // per tick and the only way a panel that is closed costs nothing.
  /** The session itself, for the clips a lane's selection names. A getter, not
   *  a value: New and Open replace the whole object. */
  /** Land one step of the row on its destination. Through the host's playback
   *  door, the same one the Space and Motion macros use. Absent in fixtures
   *  with no audio graph, where the row simply writes nowhere. */
  writeStep?: (destId: string, normalised: number) => void;
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
    return weaveLoopNotes(loopId, loopContext(laneId));
  };

  /** The lane's loop context, macros included. Built here and in panel-context
   *  from the SAME function, because one lists the loops and the other resolves
   *  them: a lane that strayed to another style in one and not the other would
   *  offer loops it then refuses to play. */
  const loopContext = (laneId: string) => {
    const session = deps.getState?.();
    const lanes = session?.lanes ?? [];
    return weaveLoopContext(
      lanes.find((l) => l.id === laneId),
      session?.musicality ?? DEFAULT_MUSICALITY,
      state.lanes[laneId]?.forcedStyle,
      {
        styleMix: macro('styleMix'),
        darkness: macro('darkness'),
        // The lane's POSITION, so the draw is stable while the session is: a
        // lane must not change style because another was renamed.
        laneIndex: Math.max(0, lanes.findIndex((l) => l.id === laneId)),
        seed: state.seed,
      },
    );
  };

  /** The two macros that rewrite notes. A getter, so a knob moved while the
   *  transport runs reaches the next bar rather than the next launch. */
  const noteMacros = () => ({ density: macro('density'), energy: macro('energy') });

  /** Both at their neutral ⇒ the macro layer is the identity, so a lane with no
   *  weave keeps the untouched scheduling path and the feature costs nothing
   *  until someone opens the panel. */
  const noteMacrosAreNeutral = () =>
    macro('density') === macroNeutral('density') && macro('energy') === macroNeutral('energy');

  // A `lanesEngineId` used to sit here, for the one question this file asked
  // about a lane's instrument: is it LAYERS. That question is gone — every
  // woven note names its loop now, and routing by that name is LAYERS' own
  // business — so the helper and its import went with it.

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
        // The lane's own context, so the scale Darkness chose is the scale the
        // melodic blend walks its degrees in. Reading the session's here instead
        // would let Darkness pick the loops and then blend them in another key.
        const m = loopContext(laneId);
        // EVERY woven note says which loop it survived from, on every lane.
        //
        // It used to be asked of the engine — only a LAYERS lane was tagged,
        // since only LAYERS routes by it — and that was the wrong question. The
        // tag is one field on a note that every other engine ignores; what is
        // exclusive to LAYERS is ROUTING by it, and that decision belongs where
        // the routing happens. Asking here meant the panel could only COLOUR the
        // handover on a layered lane, and the handover is the whole point of the
        // drawing: on an ordinary lane every hit came out the same colour and
        // showed nothing about what the fader was doing.
        return createWeaveSource(cfg, {
          barTicks,
          melodic: melodicLane(laneId),
          key: m.key,
          scale: m.scale,
          // Where degree 0 sits. Three is the octave the blend counts from; it
          // only has to agree with itself, since both sides of a pair are
          // converted through the same base.
          octaveBase: 3,
        }, true, noteMacros);
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

  // The starting line 'free' counts from lives in WeaveState now, not here.
  // There were two of them — this one for the clock, none for the hand — and
  // "cosas raras" is what a hand on the fader looked like: a slider sends its
  // absolute value on every pointer move, and with no starting line each move
  // added to the answer of the last. One journey, one line.
  let lastFlow = -1;

  /** The step row, evaluated against the bar and written to its destination.
   *
   *  A row of knobs under the pattern is what the old sequencers gave you, and
   *  the point is that it moves a PARAMETER — a cutoff, a resonance — in time
   *  with the loop rather than in time with a curve of its own.
   *
   *  The shape comes from `fillSteps`, the clip painter's, because there is only
   *  one right answer to "what is the value between two steps" and it already
   *  lives somewhere. The write goes through the destination catalogue by the
   *  PLAYBACK door — the same one Space and Motion use — so the value reaches
   *  the audio object and never the lane's saved sound: the row owns the value,
   *  and stamping its momentary position into a preset is the bug that door
   *  exists to avoid. */
  let lastStepWritten = -1;
  const tickSteps = (bars: number) => {
    const s = state.steps;
    if (!s?.on || !s.destId || s.values.length === 0) { lastStepWritten = -1; return; }

    const phase = bars - Math.floor(bars);
    // Resolved at the resolution of the row itself: asking fillSteps for one
    // value per step and reading the one under the playhead. Any finer is a
    // number nothing can hear, and every tick that lands on the same step is a
    // write nobody needs.
    const n = s.values.length;
    const idx = Math.min(n - 1, Math.floor(phase * n));
    const sub = s.mode === 'hold' ? idx : Math.min(255, Math.floor(phase * 256));
    if (sub === lastStepWritten) return;
    lastStepWritten = sub;

    const curve = fillSteps(s.values, s.mode, s.mode === 'hold' ? n : 256);
    deps.writeStep?.(s.destId, curve[sub] ?? 0);
  };

  return {
    state,

    advance(nowSec) {
      // Disconnected means disconnected: not contributing AND not travelling.
      // A flow that went on moving lane positions while the panel was off would
      // be changing the scene behind the user's back, and they would find it
      // somewhere else entirely when they switched back on.
      if (state.bypass) { lastFlow = -1; return; }

      const bpm = deps.getBpm?.() ?? 120;
      const barSec = ticksPerBar(deps.getMeter()) * ((60 / bpm) / TICKS_PER_QUARTER);
      if (!(barSec > 0)) return;

      // The step row runs off the SAME clock reading as the flow, and before
      // it: it moves a parameter in time with the loop, which is a different
      // job from moving the loops, and it must keep running while the flow sits
      // at a speed of Off.
      tickSteps(nowSec / barSec);

      const speed = state.flow?.speedBars ?? 0;
      if (!(speed > 0)) {
        lastFlow = -1;
        return;
      }

      const laneIds = (deps.getState?.().lanes ?? []).map((l) => l.id);
      // The SAME starting line the panel's own gesture uses, out of the state
      // both share. Only 'free' has one; the other two say where a lane IS.
      const base = state.flow.base && new Map(Object.entries(state.flow.base));

      const pos = flowAt(nowSec / barSec, speed);
      // A lap of 64 bars moves the position by ~0.0005 per tick, which is below
      // what any topology can act on and still costs a full source rebuild. The
      // journey is quantised to a thousandth so the ticks that change nothing
      // cost one compare.
      if (Math.abs(pos - lastFlow) < 0.001) return;
      lastFlow = pos;

      // A lane that wrapped has finished a leg: A→B re-hooks onto a fresh loop
      // rather than crossing the same two again, which is the difference
      // between an endless journey and a loop of a loop.
      const rehook = (laneId: string) => {
        const entry = state.lanes[laneId];
        const next = rehookOnArrival(entry?.weave, loopContext(laneId), state.seed, laneId);
        if (next && entry) state.lanes[laneId] = { ...entry, weave: next };
      };

      if (applyFlow(state.lanes, laneIds, pos, state.flow.drift, base, rehook)) {

        sources.clear();

      }
    },

    notesFor(laneId) {
      // Bypassed, the panel contributes NOTHING: every lane schedules exactly as
      // it did before WEAVE existed. Checked here rather than inside the source
      // because "nothing to say" is already this function's own answer — the
      // additive path is the one that was always there.
      if (state.bypass) return undefined;
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

    replace(next) {
      // Mutated, not reassigned: `state` is handed out by reference to the panel
      // and to the session host at boot, and swapping the variable here would
      // leave both of them reading the object nobody writes any more.
      for (const k of Object.keys(state.lanes)) delete state.lanes[k];
      Object.assign(state.lanes, next.lanes ?? {});
      for (const k of Object.keys(state.macros)) delete state.macros[k];
      Object.assign(state.macros, next.macros ?? {});
      state.seed = Number.isFinite(next.seed) ? next.seed : 1;
      // Unconditional, like the rest: a save with no flow must CLEAR the live
      // one, not leave the previous session still travelling.
      state.flow = next.flow ?? { drift: 'together', speedBars: 0 };
      lastFlow = -1;
      sources.clear();
    },
  };
}
