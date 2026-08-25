// How a GENERATING lane reaches the scheduler.
//
// The third producer of `LaneNoteSource`, beside the weave's fold and the
// follower's derived part. It sits in its own file rather than inside
// `weave-wiring` — which is where `build` calls it from — because that file is
// already past its size target and the generator is the half that will grow:
// stages 3 to 6 of the spec add four streams and two displacement wheels, and
// none of them has anything to say about a crossfade.
//
// It shares that file's ONE genuinely awkward piece of knowledge, and takes it
// as a dependency rather than rebuilding it: turning a remembered loop id into
// the notes it names is the session's business, and there must not be two
// answers to it.

import type { NoteEvent } from '../core/notes';
import type { TimeSignature } from '../core/meter';
import { ticksPerBar } from '../core/meter';
import type { ScaleId } from '../core/musicality';
import type { LaneNoteSource } from '../session/lane-note-source';
import type { GeneratorLaneState } from '../generator/generator-state';
import { createGeneratorSource } from '../generator/generator-source';
import { clampGrid } from '../generator/grid';
import { clampCadence } from '../generator/cadence';
import { clampChord } from '../generator/chord';
import { blendLoops, type BlendOptions } from '../weave/blend-clip';
import { resolveSelection } from '../weave/weave-selection';
import { laneWeights, type LaneWeaveConfig } from '../weave/weave-state';
import type { Progression } from '../arranger/progression';

export interface GeneratorWiringDeps {
  getMeter: () => TimeSignature;
  /** Which loop ids this lane can resolve, and to what. The weave's own lookup,
   *  handed over rather than repeated. */
  notesOf: (laneId: string) => (loopId: string) => NoteEvent[] | undefined;
  /** The key and scale this lane's material is folded in. */
  tonalityOf: (laneId: string) => { key: number; scale: ScaleId };
  /** False for percussion, which is never transposed. */
  melodic: (laneId: string) => boolean;
  /** How many bars the lane's carrier clip is, if it has one. */
  clipBars: (laneId: string) => number | undefined;
  /** Which repeat of its own clip the lane is on. */
  lap: (laneId: string) => number;
  /** The SONG's chord progression — promoted out of the weave's own state in
   *  2c, so the note-FX, the follower and this all ask one place. */
  progression: () => Progression;
}

/** The generator's MATERIAL: the lane's loops, folded to one bar.
 *
 *  The same fold the weave uses, memoised the same way and for the same reason
 *  — this runs on the scheduler's tick. Deliberately not `createWeaveSource`
 *  itself, tempting though that is: that one also applies the note macros and
 *  can tag each note with the loop it survived from, and neither belongs here.
 *  The generator does not PLAY this material, it READS it — so a handover it
 *  never sounds has no colour to carry, and a Density that thins hits would be
 *  thinning a pool rather than a rhythm.
 *
 *  Array identity is the contract. The source caches its pool against it, so
 *  handing back a fresh array per tick would re-sort the pool on every one. */
function blendedMaterial(cfg: LaneWeaveConfig, o: BlendOptions): () => NoteEvent[] {
  let key = '';
  let notes: NoteEvent[] = [];
  return () => {
    const weights = laneWeights(cfg);
    const k = weights.map((w) => w.weight.toFixed(3)).join(',');
    if (k !== key) { key = k; notes = blendLoops(weights, o); }
    return notes;
  };
}

/** A generating lane's source, or undefined for a lane that is not generating.
 *
 *  Undefined also when nothing the selection names still resolves — every loop
 *  deleted, or a session loaded over the top. The lane then plays its own clip,
 *  exactly as it would if the generator had never been switched on, which is
 *  the same answer the weave gives to the same question. */
export function createGeneratorWiring(deps: GeneratorWiringDeps) {
  return (laneId: string, gen: GeneratorLaneState | undefined): LaneNoteSource | undefined => {
    if (!gen?.selection) return undefined;
    const resolved = resolveSelection(gen.selection, deps.notesOf(laneId));
    if (!resolved) return undefined;

    // Handed by reference and read on every refresh, so moving the position
    // moves the material without rebuilding the source.
    const cfg: LaneWeaveConfig = { weave: resolved, locked: false, harmonyLeader: false };
    const t = deps.tonalityOf(laneId);
    const material = blendedMaterial(cfg, {
      barTicks: ticksPerBar(deps.getMeter()),
      melodic: deps.melodic(laneId),
      key: t.key,
      scale: t.scale,
      // Zero, for the same reason the weave passes zero: the degree conversion
      // is a round trip only when the root is a real root.
      octaveBase: 0,
    });

    // The division is the GRID's, not the meter's. The meter still says how
    // long a bar is; `div` says how many steps that bar is cut into, so the
    // same knob serves 4/4 and 6/8 without either being special.
    const stepsPerBar = () => clampGrid(gen.grid).div;
    const ticksPerStep = () => ticksPerBar(deps.getMeter()) / stepsPerBar();
    const steps = () => Math.max(1, deps.clipBars(laneId) ?? 1) * stepsPerBar();

    return createGeneratorSource({
      material,
      grid: () => clampGrid(gen.grid),
      cadence: () => clampCadence(gen.cadence),
      barTicks: () => ticksPerBar(deps.getMeter()),
      chord: () => clampChord(gen.chord),
      // The SAME tonality the material was folded in, not the session's raw
      // one: if Darkness has moved this lane's scale, conforming against the
      // session's would snap the line out of the key its own notes are in.
      tonality: () => deps.tonalityOf(laneId),
      progression: deps.progression,
      stepsPerBar,
      ticksPerStep,
      steps,
      // Which repeat of its own clip the lane is on, times the iteration's
      // length. The same reading `follow-source` takes for its lap, and a lap
      // rather than a wall clock for the reason the head is absolute at all:
      // it is the one count identical whether the bar was played into or
      // exported offline.
      startStep: () => deps.lap(laneId) * steps(),
    });
  };
}
