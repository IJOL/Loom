// Which part a lane plays — the resolver, and the only place the two sources of
// that answer meet.
//
// There are exactly two, and their order is the whole content of this file: the
// mark the USER put on the lane wins, and an engine's declared `defaultRole` is
// what an unmarked lane falls back to. Anything else that wants to know asks
// here, so "the 303 is a bass machine" is stated once, by the 303, in its own
// manifest.
//
// Absent from both is a real answer and not a gap: a general-purpose instrument
// on a lane nobody has marked is offered every melodic shelf, which is what it
// has always been offered.

import type { LaneRole, SessionLane } from './session-types';
import { defaultRoleOf, isHarmonic } from '../plugins/capabilities';

/** The parts, in the order a picker should offer them: low to high, then the
 *  two that are a chord part played differently.
 *
 *  The labels live here rather than in the panel that shows them because the
 *  panel is compiled separately — it would be a second copy of the vocabulary,
 *  free to drift, in a bundle we do not typecheck against this one. */
export const LANE_ROLES: { id: LaneRole; label: string }[] = [
  { id: 'bass',   label: 'Bass' },
  { id: 'comp',   label: 'Comp' },
  { id: 'pad',    label: 'Pad' },
  { id: 'arp',    label: 'Arp' },
  { id: 'melody', label: 'Melody' },
];

export function roleLabel(role: LaneRole): string {
  return LANE_ROLES.find((r) => r.id === role)?.label ?? role;
}

export function laneRoleOf(lane: SessionLane | undefined): LaneRole | undefined {
  if (!lane) return undefined;
  // A drum lane has no role and cannot be given one: it draws percussion
  // whatever anyone says. Answering `undefined` here rather than letting a
  // stale mark through is what stops an engine swap — melodic lane marked Pad,
  // swapped to the drum machine — handing it chord shapes it cannot play.
  if (!isHarmonic(lane.engineId)) return undefined;
  return lane.role ?? defaultRoleOf(lane.engineId);
}
