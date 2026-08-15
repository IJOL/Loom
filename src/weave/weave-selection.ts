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
import { abWeights } from './topology-ab';
import { queueWeights } from './topology-queue';
import { cloudWeights } from './topology-cloud';

export type { PanelWeave };

export type TopologyKind = PanelWeave['kind'];

// There was a `TOPOLOGIES` array here — every kind, in a list, with no callers.
// It is gone rather than kept, because what it read as was "the topologies on
// offer", and it is not: the panel offers A→B and Cloud and QUEUE has been
// retired from that list. A zero-caller export that looks like the answer to a
// question something else already answers is how the retired one gets wired
// back in by a future reader in good faith. Queue itself stays — a saved lane
// on it resolves and plays, exactly as before.

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

/** Where along its journey a selection currently sits, 0..1.
 *
 *  The cloud has TWO axes and this reads the horizontal one, because that is
 *  what a single master control can move: fanning a scene along x is a gesture,
 *  and dragging every pad diagonally is not. */
export function positionOf(sel: PanelWeave | null | undefined): number {
  return sel ? sel.x : 0;
}

// A `withPosition` used to sit here. `applyFlow` in ./flow is the ONE writer of
// a position now — the panel's gesture and the host's auto-advance both go
// through it — and a second way to move one was how the two would have ended up
// disagreeing about what a drift mode means.

/** Every loop id a selection names, in order, without duplicates. */
export function selectionLoopIds(sel: PanelWeave): string[] {
  const ids = sel.kind === 'ab' ? [sel.a, sel.b]
    : sel.kind === 'queue' ? sel.loops
      : sel.corners;
  return [...new Set(ids)];
}

/** Every loop id a selection names, in order, WITH its duplicates — one entry per
 *  slot, so an index into this list addresses a slot. `selectionLoopIds` answers
 *  the other question ("what material is in play") and dedupes; a cloud with the
 *  same loop on two corners still has four corners. */
function slotIds(sel: PanelWeave): string[] {
  if (sel.kind === 'ab') return [sel.a, sel.b];
  if (sel.kind === 'queue') return [...sel.loops];
  return [...sel.corners];
}

/** How loudly each slot is sounding right now, in `slotIds` order.
 *
 *  Through the topologies' OWN weight functions rather than re-deriving the
 *  arithmetic: a second copy of "what x means" is how the dice would end up
 *  disagreeing with the blend about which loop the user can hear. They take
 *  resolved refs, and the weights ignore the notes — so an empty array stands in
 *  for material this question does not need. */
export function slotWeights(sel: PanelWeave): number[] {
  const none: NoteEvent[] = [];
  const ref = (id: string): LoopRef => ({ id, notes: none });

  if (sel.kind === 'ab') {
    return abWeights({ a: ref(sel.a), b: ref(sel.b), x: sel.x }).map((w) => w.weight);
  }
  if (sel.kind === 'queue') {
    return queueWeights({ loops: sel.loops.map(ref), x: sel.x }).map((w) => w.weight);
  }
  // Padded to four the same way `resolveSelection` pads: a short save must not
  // make this throw, and the missing corners are silent by construction.
  const corners = Array.from({ length: CORNERS }, (_, i) => ref(sel.corners[i] ?? sel.corners[0] ?? ''));
  return cloudWeights({
    corners: corners as [LoopRef, LoopRef, LoopRef, LoopRef], x: sel.x, y: sel.y,
  }).map((w) => w.weight);
}

/** Put a fresh loop on one slot, leaving the geometry and the position alone. */
function withSlot(sel: PanelWeave, at: number, id: string): PanelWeave {
  if (sel.kind === 'ab') return at === 0 ? { ...sel, a: id } : { ...sel, b: id };
  if (sel.kind === 'queue') {
    return { ...sel, loops: sel.loops.map((cur, i) => (i === at ? id : cur)) };
  }
  return { ...sel, corners: sel.corners.map((cur, i) => (i === at ? id : cur)) };
}

/** Re-deal the ONE loop the lane is not being heard playing.
 *
 *  The dice used to replace every slot at once, which is a CUT: press it while a
 *  crossfade is anywhere but hard against one end and the sound you are listening
 *  to is gone mid-phrase. Replacing only the quiet slot makes the dice something
 *  you can press at any moment — what you hear carries on, and what the lane is
 *  travelling TOWARDS is new.
 *
 *  Ties go to the LATER slot: at the start of an A→B leg both readings are
 *  defensible, and B is the end the journey is heading for.
 *
 *  Never draws a loop the selection already names, or the press would look like
 *  it did nothing. Null when the shelf has nothing else to offer, so a caller can
 *  leave the lane exactly as it was. */
export function redrawQuietest(
  sel: PanelWeave, shelf: readonly string[],
): PanelWeave | null {
  const ids = slotIds(sel);
  if (ids.length === 0) return null;

  const weights = slotWeights(sel);
  let at = 0;
  for (let i = 1; i < ids.length; i++) {
    if ((weights[i] ?? 0) <= (weights[at] ?? 0)) at = i;
  }
  return redrawSlot(sel, at, shelf);
}

/** Put a fresh loop on ONE named slot — the caller has already decided which.
 *
 *  What a CLOUD needs, and what "the quietest" could not give it: a lane
 *  evolving on its journey knows exactly which corner it has just left, and that
 *  is a better answer than a weight comparison taken at whatever instant the
 *  clock happened to fire.
 *
 *  Never draws a loop the selection already names, and null when the shelf has
 *  nothing else to offer — same contract as above, for the same reason. */
export function redrawSlot(
  sel: PanelWeave, at: number, shelf: readonly string[],
): PanelWeave | null {
  const taken = new Set(slotIds(sel));
  const draw = shelf.find((id) => !taken.has(id));
  return draw === undefined ? null : withSlot(sel, at, draw);
}

// A `setSlot` and a `slotNames` used to live here, written for the panel to
// replace an end and to label one. They were dead BY CONSTRUCTION: the panel is
// a plugin, compiled separately, and cannot import this module at all. A
// selection is plain data, so the panel does both with an object spread and its
// own name lookup — which is the right answer, and the reason these two only
// ever had tests for callers.

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
