# Flexible drum editor (canvas drum-rack: variable resolution, free placement, selection/clipboard)

**Date:** 2026-06-04
**Status:** Design approved (pending written-spec review)
**Area:** `src/session/clip-editors/clip-editor-drum-grid.ts` (rewritten as a canvas),
`src/session/session.ts` (`SessionClip.gridResolution?`), `src/session/session-migration.ts`,
`src/session/clip-editors/clip-editor-router.ts` (unchanged call site)
**New module:** `src/core/drum-grid-editing.ts` (pure drum-editor logic)
**Reuses:** `src/core/piano-roll-editing.ts` (Spec 2 — clamp / clipboard / quantize)

> **Spec 3 of 3** in the editors overhaul. Spec 1 (session time signature) and Spec 2 (piano-roll
> editing UX) are shipped to main. This is the drum-grid analogue of Spec 2 **plus** the variable
> resolution + free off-grid placement the original brainstorm called for.

## Problem

The drum editor ([clip-editor-drum-grid.ts](../../../src/session/clip-editors/clip-editor-drum-grid.ts))
is a **fixed 16th-note button matrix**: 8 voice rows × `stepsPerBar(meter)` cells, click cycles
off→on→accent→off, Shift+click cycles a roll (×2/×3/×4 sub-hits). Buttons are fixed positions, so
there is **no way to place a hit off-grid** (polyrhythms / arrhythmias), no resolution other than
16ths, and no multi-hit selection / copy-paste. We want all three, matching the piano-roll editing
UX from Spec 2.

## Decisions (locked during brainstorming)

- **Rebuild the drum editor as a canvas** (drum-rack style): rows = the 8 `DRUM_LANES` voices,
  columns drawn at the current snap. This is the only architecture that supports **free off-grid
  placement** (a button matrix cannot) and it reuses Spec 2's canvas editing logic.
- **The data model does NOT change.** Hits stay `NoteEvent`s with each voice's GM midi
  (`VOICE_MIDI`/`GM_DRUM_MAP`). Existing drum clips render identically (default snap 1/16), and the
  **sampler drumkit** (which reuses this editor at GM notes) keeps working unchanged.
- **Resolution selector** in the editor toolbar: `1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32, free`
  (T = triplet). Snap in ticks (TICKS_PER_QUARTER = 96): `96, 48, 32, 24, 16, 12`, and `free` = 1
  tick (snap off, for polyrhythms).
- **Resolution is persisted per clip** as an additive optional field `SessionClip.gridResolution?`
  (a resolution key; absent ⇒ `'1/16'`). `session-migration.ts` leaves it absent-safe and clamps an
  unknown value to `'1/16'`. No top-level `SavedStateV3` shape change (it rides inside `sessionState`).
- **Pencil mode = click-cycle** off→on→accent→off at the snapped cell (accent = velocity 115, shown
  by colour). The old ×2/×3/×4 **roll is dropped** — a roll is now just multiple hits at a finer
  resolution or in free mode. Placing/cycling a hit **auditions** the voice (`triggerForLane`,
  already threaded).
- **Select mode** mirrors Spec 2: marquee, click / Shift-click, group move, Delete, Ctrl/Cmd+C/X/V
  (paste at the mouse), arrow nudge, with a Pencil/Select toggle (keys `1`/`2`).

## Non-goals (YAGNI)

- **Computer-keyboard musical typing** — that was Spec 2 (pitched). Drums have no octave; out.
- **Velocity beyond accent** (a velocity lane / continuous velocity) — accent stays binary (80/115).
- **Per-voice resolution** — resolution is one setting for the whole drum clip.
- A snap selector on the **piano-roll** (it stays 16th-snap) — out of this spec.

## Design

### 1. Canvas drum editor (rewrite of `clip-editor-drum-grid.ts`)

`renderDrumGridEditor(host, clip, historyDeps?, meter?, deps?)` keeps its router-facing role but
renders a canvas: a left voice-label column (8 rows: KICK…RIDE), a time ruler (bar/beat lines from
`stepsPerBar`/`stepsPerBeat`), and a grid canvas with one fixed-height row per voice. Hits are drawn
as blocks in their voice's row at `xForTick(n.start)`; accent (velocity ≥ 100) and selection use
distinct colours (reusing the piano-roll palette). The frame/zoom/scroll plumbing follows the
piano-roll's pattern; pitch-zoom is N/A (8 fixed rows). The same editor serves synth-drums and the
sampler drumkit (rows are always the 8 `DRUM_LANES`, mapped via `GM_DRUM_MAP`).

### 2. Resolution / snap

A toolbar `<select>` lists the 7 resolutions. The chosen key is read from / written to
`clip.gridResolution` (default `'1/16'`). `resolutionToSnap(key)` (pure) → ticks. The snap governs:
the drawn column lines, Pencil placement, and Select-mode move/nudge. `free` (snap = 1) lets hits sit
at any tick — the off-grid path. `1/8T`/`1/16T` draw triplet columns (32 / 16 ticks).

### 3. Pencil mode

Click at `(voiceRow, tick)`: snap the tick to the resolution; find the hits for that voice in
`[snapTick, snapTick + snap)`; cycle **none → normal (vel 80) → accent (vel 115) → none** over the
whole cell cluster (so legacy roll clusters and finer-res duplicates clear in one click). In `free`
mode the placement tick is exact (snap = 1). **Repositioning** an existing hit is done in **Select**
mode (its horizontal move is snapped to the current resolution, so in `free` it moves tick-exact) —
the Pencil only cycles. Every add/accent calls `auditionNote(voiceMidi)`. Undo wraps each mutation.

### 4. Select mode

Reuses Spec 2's interaction model with drum-row awareness:
- **Marquee** → `rowsInRect` (hits whose voice-row index ∈ [r0,r1] and tick ∈ [t0,t1)). Click /
  Shift-click toggle; Ctrl/Cmd+A; Esc clears; selected hits highlighted.
- **Group move**: horizontal = time, clamped via `translateGroup` (reused); vertical = change voice
  by **row index** (`rowMove`, mapping each hit's voice → target voice's GM midi, clamped to the 8
  rows). Snapped to the current resolution horizontally.
- **Delete/Backspace** removes the selection (one undo; `stopPropagation` so it never bubbles to the
  inspector clip-delete — same guard as Spec 2). **Ctrl/Cmd+C/X**, **Ctrl/Cmd+V** pastes at the
  snapped mouse `(row, tick)` via a drum-specific paste (own module-level clipboard). Arrow nudge:
  ←→ by snap, ↑↓ by one voice row.
- **Pencil/Select toggle** (`1`/`2`) in the toolbar, same as the piano-roll.

### 5. Pure logic — `src/core/drum-grid-editing.ts`

DOM-free, unit-tested:
- `RESOLUTIONS` (the 7 keys) + `resolutionToSnap(key): number` + `DEFAULT_RESOLUTION = '1/16'` +
  `clampResolution(x): ResolutionKey`.
- `snapTickToRes(tick, snap): number`.
- `hitInCell(notes, voice, snapTick, snap): NoteEvent | null` (the per-cell find, generalised from
  the current `firstNoteInStep`).
- `rowsInRect(notes, rect, voiceOfMidi, rowOfVoice)` → hits inside a row×tick rect.
- `rowMove(selected, dRows, voicesInOrder)` → new midi per hit when moving by row index (clamped).
- Time clamp / clipboard serialize+paste / record quantize are **reused** from
  `piano-roll-editing.ts` (notes are notes).

### 6. Persistence

`SessionClip` gains `gridResolution?: ResolutionKey` (optional, additive). It round-trips inside
`SavedStateV3.sessionState`; `session-migration.ts` does nothing for absent (editor defaults to
`'1/16'`) and clamps an unknown string to `'1/16'`. No `schemaVersion` bump (additive optional, like
prior clip fields).

## Testing

Per the project's relative-assertion rule (exact integer/geometry assertions, appropriate here):

1. **`drum-grid-editing.test.ts`:** `resolutionToSnap` for all 7 keys (96/48/32/24/16/12/1);
   `clampResolution` rejects junk → `'1/16'`; `snapTickToRes`; `hitInCell` finds / misses within a
   cell window per voice; `rowsInRect` includes/excludes by row and tick edge; `rowMove` clamps at
   the top/bottom voice and maps to the right GM midi.
2. **Existing drum-grid test** (`clip-editor-drum-grid.test.ts`) updated to the canvas API but still
   asserting the data-shape invariants (notes init to `[]`; a placed hit has the voice's GM midi).
3. **Compat:** a pre-existing drum clip with hits on 16ths renders the same hits; a sampler-drumkit
   clip still edits.
4. **Manual smoke:** switch resolutions (incl. triplets + free); Pencil click-cycle accent; place
   off-grid hits in free mode and hear them; marquee-select + move (across voices) + copy/paste at
   the mouse + delete; reload → `gridResolution` persisted.

## Touch list (for the implementation plan)

- **New:** `src/core/drum-grid-editing.ts` (+ `drum-grid-editing.test.ts`).
- **Rewrite:** `src/session/clip-editors/clip-editor-drum-grid.ts` (button matrix → canvas; same
  exported `renderDrumGridEditor` signature, possibly one extra optional `deps` for `auditionNote`).
- **Edit:** `src/session/session.ts` (`SessionClip.gridResolution?`), `src/session/session-migration.ts`
  (clamp/default), `src/session/clip-editors/clip-editor-router.ts` (pass `auditionNote`/`triggerForLane`
  if not already; thread per-clip resolution read/write).
- **Update:** `src/session/clip-editors/clip-editor-drum-grid.test.ts`.
- **No** top-level `SavedStateV3` / `schemaVersion` change.
