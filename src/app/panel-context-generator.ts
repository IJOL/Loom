// The four PanelContext members that answer "is this lane generating, and with
// what settings".
//
// Its own file for the reason panel-context-follow.ts is: the switch and the
// controls are ONE thing, the switch does something beyond its own field — it
// seeds the material and clears the lane's weave — and panel-context.ts is at
// its size limit besides.
//
// The control surface is DECLARED as data rather than exposed one accessor at a
// time. The spec has four streams of five controls each still to arrive, and a
// named member per control would mean editing the SDK, the host and the panel
// for every one of them. This way a new control is one line in `PARAMS`.

import type { PanelGeneratorParam, PanelContext } from '@loom/plugin-sdk';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import type { SessionState, SessionLane } from '../session/session';
import { defaultSelection } from '../weave/weave-selection';
import { formatLoopId } from '../weave/loop-ids';
import {
  clampGeneratorState, defaultGeneratorState, type GeneratorLaneState,
} from '../generator/generator-state';

export interface GeneratorDepsUI {
  getState: () => SessionState;
  /** Drop the lane's weave selection. Weaving and generating answer the same
   *  question and the host resolves the generator first, so a selection left
   *  behind would be a control that visibly does nothing. */
  clearWeave: (laneId: string) => void;
  restoreWeave?: (laneId: string) => void;
  onWeaveChanged?: (laneId: string) => void;
  refresh: () => void;
  /** Read at call time, not captured: history is wired in AFTER this context is
   *  built, so a captured one would be undefined for the whole run. */
  history: () => HistoryDeps | undefined;
}

/** One control: where it reads from the state, and where it writes back.
 *
 *  A pair of functions rather than a dotted path string, because a path has to
 *  be parsed and a wrong one fails at runtime — these fail at compile time. */
interface ParamSpec {
  id: string;
  name: string;
  min: number;
  max: number;
  step: number;
  labels?: string[];
  get: (g: GeneratorLaneState) => number;
  set: (g: GeneratorLaneState, v: number) => void;
}

const CONFORM: Array<GeneratorLaneState['chord']['conform']> = ['off', 'scale', 'chord'];

const PARAMS: ParamSpec[] = [
  {
    id: 'div', name: 'DIV', min: 1, max: 16, step: 1,
    get: (g) => g.grid.div, set: (g, v) => { g.grid.div = v; },
  },
  {
    id: 'repeats', name: 'BARS', min: 1, max: 16, step: 1,
    get: (g) => g.grid.repeats, set: (g, v) => { g.grid.repeats = v; },
  },
  {
    id: 'pow2', name: '×2^', min: 0, max: 3, step: 1,
    get: (g) => g.grid.pow2, set: (g, v) => { g.grid.pow2 = v; },
  },
  {
    id: 'cadence', name: 'CADENCE', min: 0, max: 1, step: 0,
    get: (g) => g.cadence.amount, set: (g, v) => { g.cadence.amount = v; },
  },
  {
    id: 'cadenceMod', name: 'CAD MOD', min: 0, max: 1, step: 0,
    get: (g) => g.cadence.mod, set: (g, v) => { g.cadence.mod = v; },
  },
  {
    id: 'phrase', name: 'PHRASE', min: 0, max: 1, step: 0,
    get: (g) => g.cadence.phrase, set: (g, v) => { g.cadence.phrase = v; },
  },
  {
    id: 'conform', name: 'IN KEY', min: 0, max: 2, step: 1, labels: ['OFF', 'SCALE', 'CHORD'],
    get: (g) => Math.max(0, CONFORM.indexOf(g.chord.conform)),
    set: (g, v) => { g.chord.conform = CONFORM[Math.round(v)] ?? 'off'; },
  },
  {
    id: 'chordPitch', name: 'VOICING', min: -7, max: 7, step: 1,
    get: (g) => g.chord.pitch, set: (g, v) => { g.chord.pitch = v; },
  },
  {
    id: 'chordMod', name: 'VOICE MOD', min: 0, max: 1, step: 0,
    get: (g) => g.chord.mod, set: (g, v) => { g.chord.mod = v; },
  },
  {
    id: 'nudge', name: 'NUDGE', min: -1, max: 1, step: 0,
    get: (g) => g.offset.amount, set: (g, v) => { g.offset.amount = v; },
  },
  {
    id: 'nudgeMod', name: 'GROOVE', min: 0, max: 1, step: 0,
    get: (g) => g.offset.mod, set: (g, v) => { g.offset.mod = v; },
  },
  // Named for what it does rather than for the field: past 1 the notes overlap,
  // and an overlap is what makes an engine that declares `"slide": "overlap"`
  // slide. "LENGTH" would have been the honest name for the number and the
  // useless one for the control.
  {
    id: 'length', name: 'HOLD', min: 0.05, max: 4, step: 0,
    get: (g) => g.length.length, set: (g, v) => { g.length.length = v; },
  },
  {
    id: 'lengthMod', name: 'HOLD MOD', min: 0, max: 1, step: 0,
    get: (g) => g.length.mod, set: (g, v) => { g.length.mod = v; },
  },
];

export function generatorMembers(d: GeneratorDepsUI):
Pick<PanelContext, 'generatorOn' | 'setGeneratorOn' | 'generatorParams' | 'setGeneratorParam'> {
  return {
    generatorOn: (laneId) => !!laneOf(d, laneId)?.generator?.selection,
    setGeneratorOn: (laneId, on) => write(d, () => setGeneratorOn(d, laneId, on)),
    generatorParams: (laneId) => generatorParams(d, laneId),
    setGeneratorParam: (laneId, id, value) =>
      write(d, () => setGeneratorParam(d, laneId, id, value)),
  };
}

function write(d: GeneratorDepsUI, run: () => void): void {
  const hd = d.history();
  if (hd) withUndo(hd, run); else run();
}

const laneOf = (d: GeneratorDepsUI, laneId: string): SessionLane | undefined =>
  d.getState().lanes.find((l) => l.id === laneId);

/** The controls, or an EMPTY list for a lane that is not generating — the same
 *  "show no control" convention `roleChoices` and `followChoices` use. */
export function generatorParams(d: GeneratorDepsUI, laneId: string): PanelGeneratorParam[] {
  const lane = laneOf(d, laneId);
  if (!lane?.generator?.selection) return [];
  const g = clampGeneratorState(lane.generator);
  return PARAMS.map((p) => ({
    id: p.id, name: p.name, min: p.min, max: p.max, step: p.step, labels: p.labels,
    value: p.get(g),
  }));
}

export function setGeneratorOn(d: GeneratorDepsUI, laneId: string, on: boolean): void {
  const lane = laneOf(d, laneId);
  if (!lane) return;

  if (!on) {
    // The SELECTION stays and only the switch moves. Coming back to a generator
    // you had already set up is not the same gesture as building a new one, and
    // throwing the material away would make the switch a one-way door with no
    // sign on it — the exact fault `shelvedWeave` exists to fix on the weave's
    // side.
    if (lane.generator) lane.generator.selection = null;
    d.restoreWeave?.(laneId);
  } else {
    const state = lane.generator
      ? clampGeneratorState(lane.generator)
      : defaultGeneratorState();
    if (!state.selection) {
      // Seeded from the lane's OWN clips, so pressing the switch makes a sound
      // rather than opening an empty picker. It is the ordinary A→B selection
      // every other loop control uses — "my own clip" as one selection among
      // many, which is exactly what the material decision settled on.
      const ids = lane.clips
        .filter((c): c is NonNullable<typeof c> => !!c && c.notes.length > 0)
        .map((c) => formatLoopId({ source: 'clip', clipId: c.id }));
      state.selection = defaultSelection('ab', ids);
      // No clips with notes in them: there is nothing to generate FROM, so the
      // switch stays off rather than turning on and playing silence.
      if (!state.selection) return;
    }
    lane.generator = state;
    d.clearWeave(laneId);
  }
  d.onWeaveChanged?.(laneId);
  d.refresh();
}

export function setGeneratorParam(
  d: GeneratorDepsUI, laneId: string, id: string, value: number,
): void {
  const lane = laneOf(d, laneId);
  if (!lane?.generator) return;
  const spec = PARAMS.find((p) => p.id === id);
  // Validated against the list the panel was OFFERED, not trusted. The panel is
  // a plugin and an unknown id here would write a field nobody reads.
  if (!spec || !Number.isFinite(value)) return;

  const next = clampGeneratorState(lane.generator);
  spec.set(next, Math.max(spec.min, Math.min(spec.max, value)));
  // Back through the clamp, so a control's own range and the state's agree even
  // when they disagree — the state's is the one the audio path trusts.
  lane.generator = { ...clampGeneratorState(next), selection: next.selection };
  d.onWeaveChanged?.(laneId);
  // Deliberately NOT d.refresh(): refresh REMOUNTS the panel, which destroys the
  // element a dragging pointer is holding. A slider that could be clicked and
  // not dragged shipped twice on this panel already.
}
