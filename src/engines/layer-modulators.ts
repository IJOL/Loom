// A slot's modulators, written in the LANE's vocabulary.
//
// The rule this file exists to keep: an instrument in a slot has to sound
// exactly as it would on a lane of its own, because it carries everything it
// needs. Its params already do — they wear the slot's prefix (`l0.filter.cutoff`)
// — and its modulators have to travel the same way, or a converted lane loses
// the amplitude and filter envelopes its preset shipped with and comes out at
// half the level sounding like another instrument.
//
// Prefixing rather than sharing is the whole point. One envelope at the LANE's
// level would be handed to every slot unchanged, so two instruments could never
// have different envelopes and a slot would sound according to its neighbour.
//
// A connection's target is resolved through the SAME mapper the worklet uses
// (makeDotIdMapper), because a stored connection can be written either way: a
// preset carries the bare id (`amp`), while one made in the panel carries the
// lane-qualified one (`subtractive-1.filter.cutoff`). Resolving both to the bare
// target and re-prefixing it is what makes those two the same thing.

import type { ModulatorState } from '../modulation/types';
import { getEngineDescriptor } from './registry';
import { makeDotIdMapper } from './mod-lite';
import { layerPrefix } from '../audio-dsp/layers/layer-spec';

/** One engine's modulators as layer `i` of a LAYERS lane would carry them.
 *
 *  Ids are prefixed too: four slots of the same engine would otherwise all call
 *  their envelope `adsr-amp`, and a modulator set is addressed by id.
 *
 *  A connection whose target this engine does not recognise is DROPPED rather
 *  than carried through unresolved — it would reach the worklet aimed at
 *  something no slot declares and be warned about once per lane, for ever. */
export function prefixModulators(
  mods: readonly ModulatorState[], i: number, engineId: string,
): ModulatorState[] {
  const pre = layerPrefix(i);
  const mapTarget = makeDotIdMapper(getEngineDescriptor(engineId)?.params ?? []);
  return mods.map((m) => ({
    ...m,
    id: `${pre}${m.id}`,
    connections: m.connections
      .map((c) => ({ ...c, paramId: mapTarget(c.paramId) }))
      .filter((c): c is typeof c & { paramId: string } => c.paramId !== null)
      .map((c) => ({ ...c, paramId: `${pre}${c.paramId}` })),
  }));
}

/** The lane's modulator set with layer `i`'s replaced by `mods`.
 *
 *  Replaced, not merged: recalling a second preset into a slot must not leave
 *  the first one's envelopes running alongside. Everything outside this slot —
 *  the other slots, and LAYERS' own — is untouched. */
export function replaceLayerModulators(
  all: readonly ModulatorState[], i: number, mods: readonly ModulatorState[],
): ModulatorState[] {
  const pre = layerPrefix(i);
  return [...all.filter((m) => !m.id.startsWith(pre)), ...mods];
}

/** True for a modulator belonging to any slot — i.e. one this lane holds on
 *  behalf of an instrument inside it, rather than one of its own. */
export function isLayerModulator(id: string): boolean {
  return /^l\d+\./.test(id);
}
