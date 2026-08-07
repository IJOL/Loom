// Which loops a lane weaves — by id — and how those ids become the material the
// topologies actually fold.
//
// This is the seam between what is REMEMBERED and what is COMPUTED. What gets
// stored and shown is a handful of clip ids and a position; the note arrays are
// looked up at the moment the gate needs them. Storing the notes instead would
// have been a second copy of every clip, stale from the first edit, and it would
// have put the whole session's material inside a panel that is supposed to hold
// a flat summary.
//
// Pure: no DOM, no session objects, no module state.

import type { PanelWeave } from '@loom/plugin-sdk';
import type { NoteEvent } from '../core/notes';
import type { LoopRef } from './topology-types';
import type { LaneWeave } from './weave-state';

export type { PanelWeave };

export type TopologyKind = PanelWeave['kind'];
export const TOPOLOGIES: TopologyKind[] = ['ab', 'queue', 'cloud'];

/** How many loops a topology needs before it has anything to say. Below this it
 *  still resolves — it just cannot cross-fade, which is honest rather than an
 *  error. */
const CORNERS = 4;

/** A first selection for a lane that has none, given the loops it owns.
 *
 *  Every topology is filled from the same list by CYCLING it, so a lane with two
 *  clips can still be put on the cloud and get a sensible square rather than two
 *  empty corners. Returns null when the lane has no loops at all — there is
 *  nothing to weave and pretending otherwise would show a control that governs
 *  nothing. */
export function defaultSelection(kind: TopologyKind, loopIds: string[]): PanelWeave | null {
  if (loopIds.length === 0) return null;
  const at = (i: number) => loopIds[i % loopIds.length];

  if (kind === 'ab') return { kind: 'ab', a: at(0), b: at(1), x: 0 };
  if (kind === 'queue') return { kind: 'queue', loops: [...loopIds], x: 0 };
  return {
    kind: 'cloud',
    corners: Array.from({ length: CORNERS }, (_, i) => at(i)),
    x: 0.5,
    y: 0.5,
  };
}

/** Move a selection to another topology, keeping the loops it already names.
 *
 *  Switching topology is a change of CONTROL, not of material: the user picked
 *  those loops and expects to still be weaving them after flipping the selector.
 *  Rebuilding from the lane's full clip list here would silently throw that
 *  choice away. */
export function retopologise(
  sel: PanelWeave | null, kind: TopologyKind, loopIds: string[],
): PanelWeave | null {
  if (!sel) return defaultSelection(kind, loopIds);
  if (sel.kind === kind) return sel;
  const named = selectionLoopIds(sel);
  return defaultSelection(kind, named.length > 0 ? named : loopIds);
}

/** Every loop id a selection names, in order, without duplicates. */
export function selectionLoopIds(sel: PanelWeave): string[] {
  const ids = sel.kind === 'ab' ? [sel.a, sel.b]
    : sel.kind === 'queue' ? sel.loops
      : sel.corners;
  return [...new Set(ids)];
}

/** Replace one slot of a selection — the A end, a queue entry, a cloud corner.
 *
 *  Out-of-range slots are ignored rather than appended: a caller that asks for
 *  corner 9 has a bug, and growing the square to nine corners would hide it. */
export function setSlot(sel: PanelWeave, slot: number, loopId: string): PanelWeave {
  if (sel.kind === 'ab') {
    if (slot === 0) return { ...sel, a: loopId };
    if (slot === 1) return { ...sel, b: loopId };
    return sel;
  }
  if (sel.kind === 'queue') {
    if (slot < 0 || slot >= sel.loops.length) return sel;
    const loops = [...sel.loops];
    loops[slot] = loopId;
    return { ...sel, loops };
  }
  if (slot < 0 || slot >= sel.corners.length) return sel;
  const corners = [...sel.corners];
  corners[slot] = loopId;
  return { ...sel, corners };
}

/** Names for the slots, so a control can label its ends and corners. Unknown
 *  ids come back as their id — better a raw id than a blank end. */
export function slotNames(sel: PanelWeave, nameOf: (id: string) => string | undefined): string[] {
  const ids = sel.kind === 'ab' ? [sel.a, sel.b]
    : sel.kind === 'queue' ? sel.loops
      : sel.corners;
  return ids.map((id) => nameOf(id) ?? id);
}

/** Turn a stored selection into the live topology state the blend consumes.
 *
 *  A loop whose clip is gone — deleted, or a session loaded over the top — is
 *  substituted by the first one that still resolves rather than dropped. Dropping
 *  a cloud corner would renumber the other three and move the dot's meaning under
 *  the user's hand; substituting keeps the geometry and just repeats a loop. When
 *  NOTHING resolves the answer is null: the lane plays exactly as it did before
 *  the panel existed. */
export function resolveSelection(
  sel: PanelWeave, notesOf: (id: string) => NoteEvent[] | undefined,
): LaneWeave | null {
  const ref = (id: string): LoopRef | null => {
    const notes = notesOf(id);
    return notes ? { id, notes } : null;
  };
  const ids = sel.kind === 'ab' ? [sel.a, sel.b]
    : sel.kind === 'queue' ? sel.loops
      : sel.corners;

  const fallback = ids.map(ref).find((r): r is LoopRef => r !== null);
  if (!fallback) return null;
  const at = (id: string) => ref(id) ?? fallback;

  if (sel.kind === 'ab') {
    return { kind: 'ab', state: { a: at(sel.a), b: at(sel.b), x: sel.x } };
  }
  if (sel.kind === 'queue') {
    return { kind: 'queue', state: { loops: sel.loops.map(at), x: sel.x } };
  }
  // The square is always four corners. A stored selection with the wrong count
  // is padded from the fallback rather than refused — a save written by an older
  // build must not blank the lane.
  const corners = Array.from({ length: CORNERS }, (_, i) =>
    sel.corners[i] !== undefined ? at(sel.corners[i]) : fallback);
  return {
    kind: 'cloud',
    state: { corners: corners as [LoopRef, LoopRef, LoopRef, LoopRef], x: sel.x, y: sel.y },
  };
}
