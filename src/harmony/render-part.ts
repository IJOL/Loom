// Which renderer plays a progression, given what part the lane plays.
//
// A table rather than a switch, so adding a role is a line here plus a file in
// parts/ — and so the absent cases are visible as absent rather than hidden in
// a default branch.

import type { LaneRole } from '@loom/plugin-sdk';
import type { NoteEvent } from '../core/notes';
import type { Progression } from '../arranger/progression';
import type { PartOptions, PartRenderer } from './part-types';
import { renderPad } from './parts/pad';
import { renderBass } from './parts/bass';
import { renderComp } from './parts/comp';
import { renderArp } from './parts/arp';

/** Partial on purpose: `melody` is not in it, and that absence IS the answer.
 *  A lane marked Melody is the thing being accompanied, not an accompaniment,
 *  so a follower marked Melody has nothing to say. */
const RENDERERS: Partial<Record<LaneRole, PartRenderer>> = {
  pad: renderPad,
  bass: renderBass,
  comp: renderComp,
  arp: renderArp,
};

export function renderPart(
  role: LaneRole | undefined, progression: Progression, o: PartOptions,
): NoteEvent[] {
  // An unmarked lane plays nothing rather than falling back to a part nobody
  // chose. `laneRoleOf` already answers undefined for a percussion lane, so
  // this is also what stops a drum lane from being handed chords it cannot
  // play — without this file ever comparing an engine id.
  if (!role || progression.length === 0) return [];
  return RENDERERS[role]?.(progression, o) ?? [];
}
