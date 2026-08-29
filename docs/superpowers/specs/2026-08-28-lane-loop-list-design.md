# The loop list a lane draws from

**Status**: design, awaiting review · **Date**: 2026-08-28 · **Branch**: `feat/lane-loop-list`

## The problem

A weaving lane's material is dealt to it. Which loops arrive is decided by a
seeded hash over everything the lane's role allows — `rehookOnArrival` when an
A→B lane reaches the far end, and the generator's own seeding when GEN is
switched on. The user picks the two loops in the cell by hand, and the moment
the journey hands over, the next one is the machine's choice again.

Asked for, in the user's words: *"las listas de loops han de ser configurables,
se hacen random pero pueden seleccionarse qué loops exactamente y en qué
orden"*, narrowed the same morning to *"la lista de loops de los lanes ab y
gen"*.

So: a lane should be able to carry a written list of loops, and the two things
that draw material — A→B's hand-over and the generator's seeding — should read
that list instead of the shelf.

## What we are building

**One new thing per lane: an ordered list of loop ids, and an editor for it.**

### The state

`LaneSelection` ([weave-state.ts](../../../src/weave/weave-state.ts)) gains:

```ts
/** The loops this lane draws from, in the order they were written.
 *  Absent or empty ⇒ the whole shelf its role allows, exactly as before. */
pool?: string[];
```

It lives on the weave selection because that is what is saved with the session,
undone with everything else, and already keyed per lane. Loop ids are the ones
`loop-ids.ts` already defines — `clip:<id>`, `lib:<style>:<kind>:<index>`,
`chord:<shape>` — so a list can name the lane's own clips and library loops in
the same breath, which is what the cell's dropdown already offers.

Absent is the ordinary case and behaves exactly as today. That is deliberate:
every existing session must sound the same after this ships.

### Who reads it

Two consumers, and no others in this round.

1. **A→B's hand-over.** `rehookOnArrival` ([weave-loops.ts](../../../src/app/weave-loops.ts))
   picks the fresh far loop with a seeded hash over the shelf, avoiding the
   trail. With a pool, it takes **the next entry after the one being left**,
   wrapping at the end. The journey then walks the list in the order it was
   written, and stops being a draw at all.

2. **The generator's seeding.** `setGeneratorOn`
   ([panel-context-generator.ts](../../../src/app/panel-context-generator.ts))
   seeds `state.selection` from the lane's own clips with notes, falling back to
   the shelf (shipped this morning). With a pool it seeds from the pool, ahead
   of both.

The rule between them is one line: **the pool wins where it exists, and where it
does not, nothing changes.**

### The editor

New, in the panel, on the lane row — `plugins/weave/lane-row.ts`.

A compact list under the lane's cell: one row per loop, in order, each showing
its name with **✕** to remove and **↑ ↓** to move; below them a picker that adds
from the same catalogue the cell's slots already offer (`weaveLoopChoices`).

No drag-and-drop. The panel remounts on every write (`refresh()` does
`root.replaceChildren()`), so a drag dies on its second event — that has shipped
as a bug twice already, and buttons do not have the problem.

The list is per lane, and it is shown where the lane's other material decisions
are, so "what this lane may play" reads in one place.

### The ABI

`PanelContext` ([manifest.ts](../../../packages/loom-plugin-sdk/src/manifest.ts))
gains two members, additive:

```ts
/** The loops this lane draws from, in order. Empty ⇒ the whole shelf. */
lanePool(laneId: string): string[];
/** Write it. The host validates every id against what it offers. */
setLanePool(laneId: string, ids: string[]): void;
```

Ids are validated host-side against `weaveLoopChoices` before they are stored:
the panel is a plugin, and an id nobody offers would be a lane pointing at
material that does not exist.

## What is NOT in this round

Named so they are decisions rather than omissions:

- **No scene-level list.** One list per lane is the ask; a shared default with a
  per-lane override is a second question, and a second place to look when
  something sounds wrong.
- **No styles.** *"Listas de loops y estilos"* was the original ask; the style
  half rides on the same shape (`styleForLane` reading a written list instead of
  drifting through the catalogue) and is worth doing once this one has proved
  the shape in use.
- **QUEUE stays retired.** The topology is a cursor over an ordered list, which
  is nearly this feature — and it was withdrawn from the dropdown because it was
  incomprehensible without an editor. If the list editor lands well, bringing
  QUEUE back is a small, separate round, and its case will be much stronger.
- **Cloud does not read the pool.** Its corners evolve through
  `evolveCloudOnLeg`, a different draw with its own rules about which corner is
  safe to replace. Adding it here would double the surface for a topology the
  ask did not name.

## Testing

- **Pure**: `nextFromPool(pool, leaving)` — the successor, wrapping, and what it
  answers for a pool of one, an empty pool, and a `leaving` the pool does not
  contain. Beside `weave-loops.test.ts`.
- **The A→B hand-over**: `rehookOnArrival` with a pool walks the list in order
  across several arrivals, and without a pool draws exactly as it does today
  (the negative control that protects every existing session).
- **The generator**: `setGeneratorOn` seeds from the pool when there is one, from
  its own clips when there is not — extending the three tests written this
  morning.
- **The editor**: a browser look. Add three loops, reorder, remove one, reload
  the page and check the list survived — it is saved state, and "it saved" is
  not something a unit test of the panel can claim.

## Risks

- **A pool naming loops the lane can no longer play** — a clip deleted, a style
  changed. `reseedLaneIfLoopsMoved` already handles this for the cell's
  selection; the pool needs the same treatment or a lane can point at nothing.
- **A pool of one** makes the A→B hand-over a no-op: the lane arrives and
  re-hooks onto the loop it is already on. That is the honest reading of a list
  with one entry, and the editor should probably say so rather than the music
  going still.
