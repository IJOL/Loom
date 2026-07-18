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
