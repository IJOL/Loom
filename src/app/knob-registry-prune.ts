// Pruning the live-knob registry when the session changes.
//
// The registry is keyed by knob id and only ever grew: loading a save left the
// previous session's lanes in it, so every param picker showed instruments that
// no longer existed. Ids come in three shapes:
//
//   `<laneId>.<param>`        — a lane's engine / insert / bus knob
//   `mix.<laneId>.<param>`    — that lane's mixer strip
//   `fx.<...>`                — master bus and sends; global, never lane-scoped
//
import type { KnobHandle } from '../core/knob';
import { parseAutomationParamId } from '../automation/automation-apply';

/** Ids under these heads belong to the session as a whole, not to any lane. */
const GLOBAL_HEADS = new Set(['fx']);

/** The lane an id belongs to, or null when it is global. */
export function laneOfKnobId(id: string): string | null {
  const parts = id.split('.');
  if (parts.length < 2) return null;
  if (GLOBAL_HEADS.has(parts[0])) return null;
  // `mix.<laneId>.…` puts the lane in the second segment.
  if (parts[0] === 'mix') return parts.length >= 3 ? parts[1] : null;
  return parts[0];
}

/** Drop every handle belonging to a lane outside `keep`. Global knobs survive. */
export function pruneKnobRegistry(
  registry: Map<string, KnobHandle>,
  keep: ReadonlySet<string>,
): void {
  for (const id of [...registry.keys()]) {
    const laneId = laneOfKnobId(id);
    if (laneId !== null && !keep.has(laneId)) registry.delete(id);
  }
}

/** A stable key for an insert slot, independent of which of its params an id
 *  names. JSON-encoded so there is no ambiguity between e.g. scope "a.b" slot
 *  "c" and scope "a" slot "b.c" — a plain-delimiter join can't tell those
 *  apart, JSON.stringify's own escaping can. */
function slotKey(scopeId: string, slotId: string): string {
  return JSON.stringify([scopeId, slotId]);
}

/** Drop knob handles for an insert slot that no longer exists — the actual
 *  leak: deleting an insert from a lane that still exists (or from the
 *  master/send racks, which `pruneKnobRegistry` never touches at all since
 *  they are global) left its knobs in the registry forever.
 *
 *  `validIds` is the current destination catalogue (Task 4). Every id shaped
 *  `<scope>.fx:<slotId>.<param>` it lists proves that (scope, slot) is still
 *  alive, so we collect those pairs and drop any registry id whose insert
 *  scope+slot isn't among them.
 *
 *  Deliberately NOT "delete anything absent from validIds": the registry is
 *  the live write path for controls the destination catalogue does not (and
 *  should not) model — `mix.<laneId>.<param>` mixer knobs (six per track,
 *  never listed by `listAutomationTargets`), `<laneId>.mod.…` modulator
 *  config, and any other id shape. Only ids that parse as an insert param
 *  (`parseAutomationParamId(...).kind === 'insert'`) are ever candidates for
 *  deletion; everything else is left untouched no matter what `validIds`
 *  contains. A leaked entry costs a bounded amount of memory; deleting a live
 *  knob handle silently breaks the control it belongs to. */
export function pruneKnobRegistryToDestinations(
  registry: Map<string, KnobHandle>,
  validIds: ReadonlySet<string>,
): void {
  const aliveSlots = new Set<string>();
  for (const id of validIds) {
    const parsed = parseAutomationParamId(id);
    if (parsed?.kind === 'insert') aliveSlots.add(slotKey(parsed.scopeId, parsed.slotId));
  }
  for (const id of [...registry.keys()]) {
    const parsed = parseAutomationParamId(id);
    if (parsed?.kind !== 'insert') continue; // not an insert-param id: never prunable here
    if (!aliveSlots.has(slotKey(parsed.scopeId, parsed.slotId))) registry.delete(id);
  }
}
