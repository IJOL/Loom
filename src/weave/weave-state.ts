// What WEAVE remembers, per lane and globally.
//
// It lives inside the session so it saves, loads and undoes like everything
// else — a panel whose state sat in a module variable would look like it worked
// until the first reload.

import type { PanelWeave } from '@loom/plugin-sdk';
import type { StyleId } from '../core/musicality';
import type { LoopWeight } from './topology-types';
import { abWeights, type AbState } from './topology-ab';
import { queueWeights, type QueueState } from './topology-queue';
import { cloudWeights, type CloudState } from './topology-cloud';
import { WEAVE_MACROS } from './weave-catalog';
import type { DriftMode } from './flow';

export type LaneWeave =
  | { kind: 'ab'; state: AbState }
  | { kind: 'queue'; state: QueueState }
  | { kind: 'cloud'; state: CloudState };

export interface LaneWeaveConfig {
  weave: LaneWeave;
  /** Freezes WHICH loop plays — the general macros still reach this lane.
   *
   *  Cutting them too was the obvious reading and the wrong one: raise the
   *  scene's energy and a locked lane would stay flat while everything else
   *  lifted, pulling the mix apart on its own. */
  locked: boolean;
  /** Set means this lane ignores the style-mix macro: the user has spoken. */
  forcedStyle?: StyleId;
  harmonyLeader: boolean;
}

/** What a lane REMEMBERS — loops named by id, plus where between them it sits.
 *
 *  `LaneWeaveConfig` above is the same thing RESOLVED: the ids swapped for the
 *  note arrays they point at. Two shapes rather than one because they have
 *  different lifetimes — this one is saved and shown, that one is rebuilt from
 *  the live clips every time the gate needs it. Keeping notes in here would be a
 *  second copy of the session's material, stale from the first clip edit. */
export interface LaneSelection {
  weave: PanelWeave | null;
  locked: boolean;
  forcedStyle?: StyleId;
  harmonyLeader: boolean;
}

export function defaultLaneSelection(): LaneSelection {
  return { weave: null, locked: false, harmonyLeader: false };
}

/** The master flow: one journey the whole scene travels.
 *
 *  `speedBars` is how long a lap takes, and 0 — the default — means the flow
 *  does not move on its own. That default is deliberate: a panel that started
 *  travelling the moment it was opened would change a session nobody touched. */
export interface FlowState {
  drift: DriftMode;
  speedBars: number;
}

export interface WeaveState {
  lanes: Record<string, LaneSelection>;
  macros: Record<string, number>;
  /** Seeds the style draw, so re-rendering a panel or repainting a curve never
   *  moves a lane to a different style behind the user's back. */
  seed: number;
  flow: FlowState;
}

export function defaultWeaveState(): WeaveState {
  // Built fresh each call. Handing out one shared object by reference is how
  // one session's edits leak into the next.
  const macros: Record<string, number> = {};
  for (const m of WEAVE_MACROS) macros[m.id] = m.neutral;
  return { lanes: {}, macros, seed: 1, flow: { drift: 'together', speedBars: 0 } };
}

/** The ONE place that knows which topology a lane uses. Everything downstream
 *  sees a list of weights and nothing else.
 *
 *  Deliberately blind to `locked`: the lock freezes what ADVANCES the position,
 *  not what the position currently means. Reading it here would make a locked
 *  lane fall silent instead of holding its loop. */
export function laneWeights(cfg: LaneWeaveConfig): LoopWeight[] {
  const w = cfg.weave;
  return w.kind === 'ab' ? abWeights(w.state)
    : w.kind === 'queue' ? queueWeights(w.state)
      : cloudWeights(w.state);
}
