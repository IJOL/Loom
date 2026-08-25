// What a GENERATING lane remembers.
//
// On the LANE (`session-types`), beside `follow`, and NOT inside the weave's
// panel state — decided 2026-08-25. The three producers of `LaneNoteSource` are
// mutually exclusive, so sharing one selection between two of them was on the
// table; it was turned down because it would have tied the generator's life to
// a panel's. Its state would be cleared by `resetWeave`, travel inside
// `s.weave` when saved, and a lane could not keep one set of loops for weaving
// and another for generating.
//
// What it does NOT cost is reuse. Every function that acts on a selection —
// `defaultSelection`, `retopologise`, `redrawQuietest`, `resolveSelection` —
// takes one as an argument rather than reading it out of the weave's state, so
// they all serve this field unchanged.

import type { PanelWeave } from '@loom/plugin-sdk';
import { clampGrid, DEFAULT_GRID, type GridSpec } from './grid';

export interface GeneratorLaneState {
  /** The loops this lane generates FROM, in exactly the shape the weave stores.
   *
   *  The same type on purpose. The material was going to be "the lane's own
   *  clip", and that would have been a fourth answer to a question already
   *  answered three times over — so it is a loop selection instead, and the
   *  three topologies come with it for nothing. "My own clip" is then just
   *  `clip:<id>`, one selection among many, with no code that knows it. */
  selection: PanelWeave | null;
  grid: GridSpec;
}

export function defaultGeneratorState(): GeneratorLaneState {
  // Built fresh, never a shared literal handed out by reference: one lane's
  // grid edits leaking into the next is the bug that pattern prevents.
  return { selection: null, grid: { ...DEFAULT_GRID } };
}

/** Coerce a stored generator into a usable one. */
export function clampGeneratorState(
  g: Partial<GeneratorLaneState> | null | undefined,
): GeneratorLaneState {
  return {
    selection: g?.selection ?? null,
    grid: clampGrid(g?.grid),
  };
}
