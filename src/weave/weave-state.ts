// What WEAVE remembers, per lane and globally.
//
// It lives inside the session so it saves, loads and undoes like everything
// else — a panel whose state sat in a module variable would look like it worked
// until the first reload.

import type { PanelWeave } from '@loom/plugin-sdk';
import type { StyleId } from '../core/musicality';
import type { Chord } from '../arranger/progression';
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
  /** The weave this lane had before it was told to follow somebody.
   *
   *  Follow and weave answer the same question and the host resolves follow
   *  first, so setting a leader has to put the weave away — but PUTTING AWAY is
   *  not the same as throwing out, and it used to be. A lane that had been
   *  woven, pointed at a leader and then set back to "plays its own" came back
   *  with no topology at all: nothing to weave, an empty carrier clip, silence,
   *  and a row reading "Pick a topology to start weaving". Reported as "cuando
   *  un canal se pone a follow después ya nunca recupera el funcionamiento
   *  normal".
   *
   *  Absent means there is nothing to come back to, which is the ordinary case
   *  for a lane that was never weaving in the first place. */
  shelvedWeave?: PanelWeave | null;
  /** How long this lane takes to repeat itself, 0..1.
   *
   *  Not "how much accompaniment" — how many independent WHEELS are turning,
   *  and so how many phrases pass before every one of them stands where it
   *  started. At 0 nothing turns and the lane repeats every phrase. At 1 four
   *  wheels of co-prime period take 420 phrases to come back into line.
   *
   *  Per LANE rather than per scene: the whole point is that parts do not turn
   *  together, and one number for all of them would put them back in step at
   *  the level above the one this is trying to break.
   *
   *  Absent ⇒ one wheel, which is what the accompaniment did before the ladder
   *  existed. A default of 0 would have taken the rotating comp figure away
   *  from every existing session as the price of gaining a knob. */
  arrangeLevel?: number;
  locked: boolean;
  forcedStyle?: StyleId;
  harmonyLeader: boolean;
  /** How fast this lane plays what it is handed. 1 — the default — is as
   *  written; 2 is half time, 0.5 is double time.
   *
   *  On the WEAVE state and not on the clip, which is the whole point. The
   *  ×2 / ÷2 buttons used to reach into the session and rewrite the carrier
   *  clip's bar count, which had two faults: on a weaving lane it changed
   *  NOTHING you could hear — the fold refills whatever room there is, so you
   *  got a bigger room and the same phrase — and what it did change survived
   *  the weave being switched off, leaving an edited clip behind. A tool on top
   *  of the session does not get to do that.
   *
   *  The phrase is always delivered WHOLE: half time stretches it and it takes
   *  the room it needs, which is why the same gesture still grows the carrier
   *  clip. The room is the lane's; the material is the weave's. */
  timeScale?: number;
  /** How many OCTAVES this lane plays what it is handed, up or down. 0 is as
   *  written.
   *
   *  On the WEAVE state for the same reason the tempo is: a tool on top of the
   *  session does not rewrite the session's material. Switch the weave off and
   *  the clip is exactly as you left it — and the octave travels with the lane
   *  rather than with whichever loop happens to be drawn next, which is what
   *  makes it usable at all on a lane that is evolving.
   *
   *  Whole octaves and nothing between. A part that moves by a fifth is a
   *  different part; one that moves by an octave is the same part in a register
   *  where it fits, which is the only thing this is for. */
  octave?: number;
  /** Where the SOUND pad sits on its vertical axis, 0..1. Read only when `sound`
   *  is set — that one is the pad's x AND the switch that says the pad exists at
   *  all, which is why the second axis is a field of its own rather than the two
   *  being one object. Absent ⇒ the top edge, where a rack of two behaves
   *  exactly like the fader this used to be. */
  soundY?: number;
  /** The loops this lane has already travelled through, oldest first.
   *
   *  A journey that only ever draws forward is a journey you cannot re-hear:
   *  land on something good, keep going, and it is gone — the draw is seeded so
   *  it is reproducible from the start, but not reachable from where you are.
   *  Winding the wheel BACK walks this instead of drawing, so the way back is
   *  the way you came.
   *
   *  Capped, because it is saved with the session and a scene left running for
   *  an hour would otherwise carry thousands of ids nobody will wind back to. */
  trail?: string[];
  /** How many legs of the journey this lane has FINISHED.
   *
   *  Monotonic, and deliberately not the trail's length: the trail is capped
   *  because it is saved, so its length stops growing after a while and a
   *  counter taken from it would silently stop counting.
   *
   *  It exists so the style draw can be re-thrown per leg. Without it Style mix
   *  is a coin flipped once — seed and laneIndex never change on their own — so
   *  the macro reads as "does this lane wander" instead of "how often", and
   *  nothing happens automatically at all.
   *
   *  Absent ⇒ 0, which draws exactly what a session drew before this existed. */
  legs?: number;
  /** Which leg of its path a CLOUD lane was walking when it was last looked at.
   *
   *  The square evolves on ARRIVAL at a corner, and nothing else in the state
   *  says when that happens: the position is a coordinate, and a coordinate a
   *  clock has just written cannot be told apart from the same coordinate a
   *  moment earlier. Remembering the leg is what turns a position into an event.
   *
   *  Absent means "not looked at yet", which is deliberately not leg 0 — a lane
   *  whose first sighting counted as an arrival would re-draw a corner the
   *  moment a session loaded. */
  legAt?: number;
  /** The SOUND fader: which instrument this lane's notes are played on, 0..1
   *  between the two slots of its rack.
   *
   *  A second axis, not a second topology. The weave above decides which NOTES
   *  play; this decides what they are played ON, and the two are deliberately
   *  independent — that is what lets loop A be heard on instrument B, and lets
   *  the sound evolve while the notes stand still.
   *
   *  Absent means the lane has no sound fader, which is NOT the same as 0: with
   *  it absent the lane routes each note to the layer of the loop it came from,
   *  which is the other, older way of using a rack. Set, that routing is off —
   *  every note reaches both instruments and this decides the balance. Either
   *  the loop chooses the instrument or the fader does, never both. */
  sound?: number;
}

export function defaultLaneSelection(): LaneSelection {
  return { weave: null, locked: false, harmonyLeader: false };
}

/** Is this selection's POSITION a pair of real numbers?
 *
 *  Asked at the one door a panel's numbers come through, because a position
 *  that is not a number is not caught anywhere downstream: every clamp in this
 *  directory is `Math.min(1, Math.max(0, v))` or its ternary twin, and both
 *  hand NaN straight back. It then reaches `blendLoops`, which writes it into
 *  the note DURATIONS the lane plays — and a note whose duration is NaN makes a
 *  voice that can neither reach its gate-off nor be released by a stop.
 *
 *  `y` is optional (only a cloud has one) but must be a number when present. */
export function finitePosition(w: { x?: number; y?: number }): boolean {
  if (w.x !== undefined && !Number.isFinite(w.x)) return false;
  return w.y === undefined || Number.isFinite(w.y);
}

/** The master flow: one journey the whole scene travels.
 *
 *  `speedBars` is how long a lap takes, and 0 — the default — means the flow
 *  does not move on its own. That default is deliberate: a panel that started
 *  travelling the moment it was opened would change a session nobody touched. */
export interface FlowState {
  drift: DriftMode;
  speedBars: number;
  /** THERE AND BACK: how many laps out before the journey turns round and comes
   *  home. 0 — the default — is the plain journey, which only ever goes forward.
   *
   *  It changes what EVOLVE does at each end rather than replacing it. Going
   *  out, a lane that arrives DRAWS a fresh loop, exactly as it always has;
   *  coming home it walks the trail of the ones it already played, so the way
   *  back is the way you came and the next lap out draws again from there.
   *
   *  Note the count: `laps` laps of TRAVEL, and the turn consumes one boundary
   *  in each direction, so four laps out is three fresh loops and three
   *  retraced. Counting handovers instead would make the control read "3" for
   *  a journey that plainly goes round four times. */
  pingPongLaps?: number;
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
  /** Where the journey stands, 0..1 — the last position applied to the lanes.
   *
   *  The other half of `base`, and the pair is the whole model: a lane sits at
   *  `base + pos`. Without it a gesture cannot tell how far the dial has ALREADY
   *  travelled, and the first drag of a session cancelled itself — base captured
   *  from the new reading put every lane back where it started.
   *
   *  Written by the two things that move the journey, the hand and the clock,
   *  because they are one journey. */
  pos?: number;
  /** OFF by default. On, arriving at the far end is a handover: the loop on the
   *  right becomes the left and new material arrives. Off, the pair you chose is
   *  the pair you keep and the fader simply has two ends. */
  evolve?: boolean;
}

/** A row of steps that moves a PARAMETER in time with the loop — a cutoff, a
 *  resonance, anything the catalogue can name. What the old sequencers did with
 *  a row of knobs under the pattern.
 *
 *  The curve engine is the clip painter's (`automation/automation-steps`) and so
 *  is the grid; what is different is WHERE it lives. The painter attaches a
 *  curve to a CLIP, and in this panel there are barely any clips: a weaving
 *  lane's clip is a vessel the loops fill, so a curve tied to it would be tied
 *  to the one thing that does not matter. This belongs to the weave, saves with
 *  it, and follows the loop. */
export interface WeaveSteps {
  /** A destination id in the catalogue's own vocabulary. Empty means the shape
   *  is drawn and lands nowhere — you sketch first and choose after. */
  destId: string;
  /** 0..1 each. Their COUNT is the step count: a separate number would be a
   *  second one that can disagree with the array. */
  values: number[];
  mode: StepMode;
  /** Off by default. Every other control here is one you hold; this is the one
   *  that keeps writing after your hand leaves. */
  on: boolean;
}

export function defaultWeaveSteps(): WeaveSteps {
  // A rise, not a flat line: flat is the one shape that cannot show you whether
  // the row is running.
  return {
    destId: '',
    values: Array.from({ length: 16 }, (_, i) => i / 15),
    mode: 'hold',
    on: false,
  };
}

/** The rows a fresh weave starts with: ONE, drawn and pointing nowhere.
 *
 *  A list rather than a single row, because one row is one parameter and a
 *  scene worth playing moves several — a cutoff opening while a delay send
 *  swells is two rows, not a compromise between them. Starting with one keeps
 *  the panel as it reads today; the "+" is what makes it a rack. */
export function defaultWeaveStepRows(): WeaveSteps[] {
  return [defaultWeaveSteps()];
}

export interface WeaveState {
  lanes: Record<string, LaneSelection>;
  macros: Record<string, number>;
  /** Seeds the style draw, so re-rendering a panel or repainting a curve never
   *  moves a lane to a different style behind the user's back. */
  seed: number;
  flow: FlowState;
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
  /** The step rack: one row per parameter it moves. */
  steps: WeaveSteps[];
  /** The MASTER lock: keep the arrangement I have.
   *
   *  It freezes what the LOOPS do and nothing else — no lane advances, no lane
   *  hands over, and a hand on the master fader or a lane's wheel writes
   *  nothing. Three things deliberately carry on underneath it:
   *
   *  - **The chord progression.** A lock on the loops is not a lock on the
   *    harmony: the progression decides where the material SITS, not which
   *    material plays, so freezing one is not a wish to freeze the other.
   *  - **The macros.** They are the user's hand, not evolution, and a locked
   *    scene that ignored a rise in Energy would pull apart from the rest.
   *  - **The step rack.** It moves a PARAMETER in time with the loop, which is
   *    a sound moving rather than an arrangement changing.
   *
   *  A lane's own `locked` says the same thing about one lane. Neither is a
   *  mute and neither touches the desk. */
  locked?: boolean;
  // The progression MOVED to MusicalityState (session-types.ts) on
  // 2026-08-25 — `progression` and `chords` used to live here. The comment
  // that stood in their place said this was session harmony parked where it
  // was born, and that it would move if it outgrew WEAVE. It outgrew WEAVE:
  // the chord note-FX and the note generator ask the same question, and a
  // panel is the wrong place for them to look.
}

export function defaultWeaveState(): WeaveState {
  // Built fresh each call. Handing out one shared object by reference is how
  // one session's edits leak into the next.
  const macros: Record<string, number> = {};
  for (const m of WEAVE_MACROS) macros[m.id] = m.neutral;
  return {
    lanes: {}, macros, seed: 1,
    flow: { drift: 'together', speedBars: 0, evolve: false },
    bypass: false,
    locked: false,
    steps: defaultWeaveStepRows(),
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
