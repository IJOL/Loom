# Variable-size sample drumkits — design

**Date:** 2026-06-07
**Mockup (visual source of truth):** [../mockups/sampler-mockup.html](../mockups/sampler-mockup.html)
— the Sampler panel, *Drumkit* slide, now demos **14 sounds** with "nº variable" and ＋/－ Pad.

## What the user asked

> "quiero poder hacer drumkits de más de 8 sonidos, poder usarlos en *drums* con más
> sonidos que 8 o menos — drumkits con número variable de sonidos."

A sample drumkit must hold **any** number of pads (more or fewer than 8), and the
drum-machine step editor ("drums") must edit all of them.

## Scope of THIS iteration (stated openly — no silent cut)

**In scope — the functional core:** a sampler-engine drumkit can have N pads (1..N), the
per-pad **rack** shows N columns (already variable), and the **drum-grid clip editor**
renders N rows so every pad is playable/editable. The synth `drums` engine stays a fixed
8-voice machine (its DSP voices are hard-wired — out of scope; the user's "drumkits" are
the *sample* kind).

**Deferred to a follow-up iteration (NOT dropped):** the broader Sampler|Loop visual reorg
in the mockup (top 2-way selector, Melódico⇄Drumkit slide, connecting lines, per-sample
zoom viewer, loop-slicing view). This is pure presentation and is layered on later — the
user drove this incrementally ("veamos qué haces y después veremos"). Calling it out here
so the approved *look* is never silently set aside (the failure mode of 2026-06-06).

## Why the current code blocks it

- `drum-grid-editing.ts` (pure) + `clip-editor-drum-grid.ts` (canvas) are hard-locked to
  **8 rows** and to `DrumVoice`/`GM_DRUM_MAP`/`VOICE_MIDI`: a note maps to its row via
  `GM_DRUM_MAP[n.midi]`, and `FRAME_H`/`rowFromY`/the draw loop assume exactly 8.
- `sampler.ts` `isDrumkit()` only returns true when **every** pad sits on a GM drum note,
  so a kit with >8 pads (notes off the GM map) isn't recognised as a drumkit at all.

## Architecture — a row model

Introduce a small, note-addressed **row model** in `core/drum-grid-editing.ts`:

```ts
export interface DrumRows {
  count: number;
  noteToRow(midi: number): number;   // -1 when the note has no row
  rowToNote(row: number): number;    // canonical midi the row writes
}
export function gmDrumRows(voices?: readonly DrumVoice[]): DrumRows;  // synth + GM kits
export function noteDrumRows(notes: readonly number[]): DrumRows;     // arbitrary pad notes
```

Every pure function drops its `voice`/`voicesInOrder` arg and takes `DrumRows` instead:
`hitInCell`, `hitsInCell`, `rowsInRect`, `rowMove`, `serializeDrumClipboard`,
`pasteDrumClipboard` all resolve rows through `noteToRow`/`rowToNote`. This decouples them
from `DrumVoice` entirely while `gmDrumRows()` preserves today's GM behaviour (incl. alias
notes 35/40/44 collapsing to canonical).

- **Synth drums + bundled GM kits:** `gmDrumRows(DRUM_LANES)` — 8 rows, GM labels. Unchanged.
- **Variable sample drumkit:** `noteDrumRows(keymapRootNotesSorted)` — one row per pad;
  labels = GM voice name when the note is GM, else the note name (`midiLabel`).

`clip-editor-drum-grid.ts` takes a `{ rows: DrumRows; labels: string[] }` (default = GM) and
derives `FRAME_H = RULER_H + ROW_H * rows.count + VEL_LANE_H`, the draw loop, the `rowFromY`
clamp, pencil writes (`rows.rowToNote`), and audition from it.

`clip-editor-router.ts` builds the model per lane: GM for `drums`; for a sampler drumkit it
reads `lane.engineState.sampler.keymap`, sorts pads by `rootNote`, and builds `noteDrumRows`.
Drumkit detection becomes robust: `engineId==='sampler' && (drumkitId set || every keymap
entry is single-note loNote===hiNote===rootNote)` — note-agnostic, so >8/non-GM kits route
to the drum grid.

`sampler.ts`: `isDrumkit()` switches to the structural single-note test; the drumkit branch
of `buildParamUI` gains a small **＋ Pad / － Pad** toolbar above the rack. ＋ clones the last
pad's sample onto the next free note (immediately audible/visible); － drops the last pad
(min 1). Both call `setKeymap` + `mirrorKeymapChange` so the change persists and re-routes.

## Data / persistence

No schema bump. The keymap (`engineState.sampler.keymap`) is already an unbounded array;
`mirrorKeymapChange` already preserves `drumkitId`. Per-pad params keyed by note already work
for arbitrary notes (`padKeyForNote` returns `zone<note>` off the GM map). The rack already
labels unknown voices via `voice.toUpperCase()`.

## Acceptance criteria

1. Load a bundled drumkit → ＋ Pad up to e.g. 12 → the **rack shows 12 columns** and the
   **drum-grid shows 12 rows**; placing a note on row 9+ **sounds** that pad.
2. － Pad shrinks the kit; the grid/rack follow; never below 1 pad.
3. The synth `drums` engine still shows exactly **8 rows** and all existing drum tests stay green.
4. Unit tests cover `gmDrumRows`/`noteDrumRows` and the refactored pure functions, including a
   ≠8-row kit (place, move, copy/paste on a row beyond 8).
5. **Browser look (required, non-automatable):** open the app, build a >8-pad kit, screenshot
   the rack + grid, confirm parity with the mockup's Drumkit view.
