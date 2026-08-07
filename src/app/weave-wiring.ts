// Where WEAVE's live state lives, and how it reaches the scheduler.
//
// It sits here rather than inside the panel because two things need it and
// neither can own it: the session host asks for a gate on every tick, and the
// panel plugin reads and writes the macros. The host is built before the panel
// exists, so the state has to outlive both.

import { defaultWeaveState, type WeaveState } from '../weave/weave-state';
import { createMacroGate, type WeaveGate } from '../weave/weave-runtime';
import { macroNeutral } from '../weave/weave-catalog';
import { ticksPerBar, type TimeSignature } from '../core/meter';
import type { LanePlayState } from '../session/session-runtime';

export interface WeaveWiring {
  state: WeaveState;
  /** Handed to the session host. Returns undefined for a lane WEAVE has nothing
   *  to say about, which is what keeps the whole feature additive: an untouched
   *  session schedules exactly as it did before. */
  gateFor: (laneId: string) => WeaveGate | undefined;
  /** Drop every cached gate. Called when a macro moves so the next tick rebuilds
   *  against the new value rather than answering from the old fold. */
  invalidate: () => void;
}

export interface WeaveWiringDeps {
  getLaneStates: () => Map<string, LanePlayState>;
  getMeter: () => TimeSignature;
}

export function createWeaveWiring(deps: WeaveWiringDeps): WeaveWiring {
  const state = defaultWeaveState();
  const gates = new Map<string, WeaveGate>();

  const density = () => {
    const v = state.macros.density;
    return Number.isFinite(v) ? v : macroNeutral('density');
  };

  return {
    state,

    gateFor(laneId) {
      // At the neutral the macro layer is the identity, so there is nothing to
      // gate and the scheduler keeps its untouched path. This is also what makes
      // the feature free when nobody has opened the panel.
      if (density() === macroNeutral('density')) return undefined;

      let gate = gates.get(laneId);
      if (!gate) {
        gate = createMacroGate(
          // Read the clip at ask time, not at build time: the lane's playing
          // clip changes on every scene launch, and a gate holding the old
          // one would silence the new clip entirely.
          () => deps.getLaneStates().get(laneId)?.playing?.notes ?? [],
          () => ({ density: density() }),
          ticksPerBar(deps.getMeter()),
        );
        gates.set(laneId, gate);
      }
      return gate;
    },

    invalidate() {
      gates.clear();
    },
  };
}
