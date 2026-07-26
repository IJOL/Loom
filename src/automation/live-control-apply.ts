// src/automation/live-control-apply.ts
// Landing a LIVE gesture on a target whose knob is not on screen.
//
// Its sibling `applyAutomationToSession` (automation-apply.ts) does the id
// parsing, the scope resolution and the denormalisation; this adds the ONE thing
// that separates a gesture from a replay — the `lane.engineState.params` mirror,
// which is the only vehicle by which a param value reaches a save.
//
// The two must stay separate. A curve belongs to the clip or to the take, both
// of which already store it, so a replayed value must NOT become the lane's base
// sound (a97d67b: a save taken after playback recorded wherever the envelope
// happened to stop). A user gesture is the opposite: with the lane's editor open
// the mounted knob's onChange commits the value, so the same gesture with the
// editor closed has to commit it too, or one hardware/pointer move produces two
// persistence outcomes decided by which panel happens to be visible (fe44833
// closed exactly this for the MIDI surface).
//
// The mirror therefore lives HERE, at the live-control call site, and never
// inside the shared applyAutomationToSession — playback automation calls that
// one and must keep getting no mirror.
//
// Only the ENGINE branch mirrors: an insert param persists through the slot's
// own serialization in `lane.inserts`, so writing it into the lane's engine
// state would invent a param the engine does not have.
//
// The seven mixer-strip params (`bus.*`) are the same kind of exception, for the
// same reason: they already persist as `lane.mixer` (session-host-persistence
// snapshots strip.serialize()). Mirroring them too would give one number two
// owners, and on load whichever of restore(lane.mixer) / engineState-apply ran
// last would win — a fader that jumps to a value the user never set.

import { applyAutomationToSession, type AutomationApplyDeps } from './automation-apply';
import { commitParamForLane } from '../engines/engine-param-commit';
import { isStripParamId } from '../core/channel-strip-params';
import type { SessionState } from '../session/session';

export interface LiveControlApplyDeps extends AutomationApplyDeps {
  /** The session the mirror lands in. Undefined is tolerated (commitParamForLane
   *  then writes the engine alone) so a caller with no session — the offline
   *  export path builds engines without one — still drives the sound. */
  sessionState: SessionState | undefined;
}

/** Write `normalised` (0..1) onto the param `id` addresses AND persist it.
 *  Returns what applyAutomationToSession returns: false when the target is gone. */
export function applyLiveControlWrite(
  id: string,
  normalised: number,
  deps: LiveControlApplyDeps,
): boolean {
  // Reuses the shared resolution wholesale by handing it a committing view of
  // the engine, rather than re-parsing the id and re-denormalising here. That
  // second copy is what would drift.
  return applyAutomationToSession(id, normalised, {
    ...deps,
    getEngine: (laneId) => {
      const engine = deps.getEngine(laneId);
      if (!engine) return undefined;
      return {
        getBaseValue: (paramId) => engine.getBaseValue(paramId),
        setBaseValue: (paramId, v) => {
          // A strip param drives the sound and persists as lane.mixer; it must
          // not ALSO be stamped into engineState.params.
          if (isStripParamId(paramId)) { engine.setBaseValue(paramId, v); return; }
          commitParamForLane(engine, deps.sessionState, laneId, paramId, v);
        },
      };
    },
  });
}
