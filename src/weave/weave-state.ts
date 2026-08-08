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
import type { StepMode } from '../automation/automation-steps';

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
  /** Where the lanes were when the current journey began, per lane id.
   *
   *  Only 'free' needs it, and it needs it badly: that mode positions each lane
   *  relative to where it already was, so without a fixed starting line every
   *  call adds to the answer of the last one. A slider sends its absolute value
   *  on every pointer move, so dragging it across the panel meant adding the
   *  same amount dozens of times and the lanes ran away — reported as "en free
   *  hace cosas raras".
   *
   *  Shared by the hand and the clock, because they are the same journey. Absent
   *  outside 'free', where the flow says where a lane IS rather than how far it
   *  has come. */
  base?: Record<string, number>;
}

/** A curve you draw that keeps playing after you let go.
 *
 *  The engine is the painter's — `automation/automation-steps` — and so is the
 *  grid; what is different here is WHERE it lives. The clip painter attaches a
 *  curve to a CLIP, and in this panel there are no clips to speak of: the lane's
 *  clip is a vessel the weave fills, and the material is a loop. A curve tied to
 *  the vessel would be tied to the one thing that does not matter.
 *
 *  So it belongs to the weave. It is saved with it, travels with it, and does
 *  not care which clip happens to be in the grid. */
export interface WeaveSteps {
  /** A destination id in the catalogue's own vocabulary. Empty means the curve
   *  is drawn and lands nowhere — a legitimate state: you sketch a shape first
   *  and decide what it moves after. */
  destId: string;
  /** 0..1 each. Their COUNT is the step count; a second number to keep in step
   *  with the array is a second number that can disagree with it. */
  values: number[];
  mode: StepMode;
  /** Off by default. Every other control here is one you hold; this is the one
   *  that goes on writing after your hand leaves, so it starts silent. */
  on: boolean;
}

export function defaultWeaveSteps(): WeaveSteps {
  // A rise rather than a flat line: flat is the one shape that cannot show you
  // whether the curve is running.
  return {
    destId: '',
    values: Array.from({ length: 16 }, (_, i) => i / 15),
    mode: 'hold',
    on: false,
  };
}

export interface WeaveState {
  lanes: Record<string, LaneSelection>;
  macros: Record<string, number>;
  /** Seeds the style draw, so re-rendering a panel or repainting a curve never
   *  moves a lane to a different style behind the user's back. */
  seed: number;
  flow: FlowState;
  steps: WeaveSteps;
  /** WEAVE unplugged from the clock: it contributes no notes and does not
   *  travel. Everything else in Loom carries on exactly as it does with this
   *  panel closed — the transport plays, the lanes play their own clips, the
   *  desk is untouched.
   *
   *  For a while it also stopped and MUTED the lanes it drives, on the reasoning
   *  that silence you can hear beats silence you deduce. Wrong twice: it reached
   *  into the mixer to answer a question about this panel, and it left a session
   *  saved silent with the button unable to undo it. A switch that unplugs one
   *  thing must not reach for another. */
  bypass: boolean;
}

export function defaultWeaveState(): WeaveState {
  // Built fresh each call. Handing out one shared object by reference is how
  // one session's edits leak into the next.
  const macros: Record<string, number> = {};
  for (const m of WEAVE_MACROS) macros[m.id] = m.neutral;
  return {
    lanes: {}, macros, seed: 1,
    flow: { drift: 'together', speedBars: 0 },
    steps: defaultWeaveSteps(),
    bypass: false,
  };
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
