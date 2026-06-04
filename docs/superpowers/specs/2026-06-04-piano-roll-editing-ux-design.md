# Piano-roll editing UX (selection, clipboard, group move, computer-keyboard note input)

**Date:** 2026-06-04
**Status:** Design approved (pending written-spec review)
**Area:** `src/core/pianoroll.ts`, `src/session/clip-editors/clip-editor-router.ts`,
`src/session/session-inspector.ts` (deps threading), host audition wiring
**New module:** `src/core/piano-roll-editing.ts` (pure, testable editing logic)

> **Spec 2 of 3** in the editors overhaul. Order (per user): 1·Session time signature (DONE,
> on main) → **2·Editing UX (this doc)** → 3·Flexible drum editor + selection/clipboard in drums.
> Spec 2 is **piano-roll only**; the drum-grid gets its editing UX in Spec 3.

## Problem

The piano-roll ([src/core/pianoroll.ts](../../../src/core/pianoroll.ts)) only edits **one note at a
time**: drag empty space to create + resize, drag a note to move, drag its right edge to resize,
alt/right-click to delete. There is no multi-selection, no clipboard, no way to move a group, and
no way to enter notes from the computer keyboard. This spec adds those editing affordances to the
piano-roll.

## Decisions (locked during brainstorming)

- **Computer-keyboard note input = ALL three behaviors:** live **audition** on every key, **step
  input** when the transport is stopped, and **real-time recording** when it is playing.
- **Keyboard layout = standard piano-typing** (Ableton/FL style): home row = white keys, upper row
  = black keys in their real gaps; `z`/`x` shift the octave.

  ```
   black:    w e     t y u
   white:   a s d f g h j k
            (C D E F G A B C)      z = octave down   x = octave up
   semitone offsets: a0 w1 s2 e3 d4 f5 t6 g7 y8 h9 u10 j11 k12
  ```

  `q`, `r`, `i` (and the rest) are unused. Octave base is the MIDI note of `a` (= C); default 60
  (C4), clamped to the engine's `[minMidi, maxMidi]`; `z`/`x` step it by 12.
- **Create vs select = an explicit tool toggle** (Pencil / Select), not a modifier or a flipped
  default. Hotkeys `1` (pencil) / `2` (select) — digits, so they never collide with the musical
  letter keys. Default tool = **Pencil** (today's behavior). Tool persists for the session.
- **Paste lands at the mouse position** over the grid (snapped), preserving the copied group's
  relative timing and pitch. Clipboard is **app-wide** (works across clips).
- **No persistence changes.** Selection, clipboard, tool mode, octave base, and the insertion
  cursor are all ephemeral runtime state — no `SavedStateV3` / schema change.

## Non-goals (YAGNI)

- The **drum-grid** editor — its selection/clipboard is Spec 3.
- Group **resize** and group **velocity** editing (single-note resize stays in Pencil mode).
- Duplicate (Ctrl+D), nudge-velocity, scale-aware input, sustain-pedal — not in scope.
- True sustain-until-keyup **audition**: audition is a fixed-gate preview blip; the *recorded*
  note length still comes from key hold time (decoupled).

## Design

### 1. Tool mode (Pencil / Select)

A small toolbar mounts in the editor frame (above the grid): two buttons **✏ Pencil** and **▭
Select**, plus an octave readout for keyboard input. Current tool is module-level state in
`pianoroll.ts` (default `'draw'`), toggled by the buttons or keys `1`/`2` when the editor is
focused.

- **Pencil mode** keeps the existing grid pointer handlers verbatim: click/drag empty = create +
  resize; drag a note = move; right-edge = resize; alt/right-click = delete.
- **Select mode** routes the grid pointer handlers to the selection logic (§2–3).

### 2. Selection model (Select mode)

New runtime state in `createPianoRoll`: `const selection = new Set<NoteEvent>()` (references into
the live notes array).

- **Marquee:** pointerdown on empty → drag → a rubber-band rect (drawn on the grid canvas) → on
  up, `selection` = notes intersecting the rect (`notesInRect`, §7). **Shift** = add to selection.
- **Click a note:** selects just it; **Shift+click** toggles it in/out.
- **Click empty (no drag):** clears selection. **Esc:** clears. **Ctrl/Cmd+A:** select all.
- Selected notes are drawn with a distinct highlight (e.g. brighter fill + white outline) in
  `drawGrid`.

### 3. Group move + delete + nudge (Select mode)

- **Drag a selected note** → move the whole selection by the same snapped `(dTick, dMidi)`. The
  delta is clamped once for the group via `translateGroup` (§7) so the most-extreme note stays in
  bounds and the shape is preserved. Dragging an **unselected** note first selects it (then moves).
- **Delete / Backspace** removes every selected note in one undo gesture.
- **Arrow keys:** with a selection, `←/→` nudge it by one snap, `↑/↓` by one semitone (clamped). With
  no selection, `←/→` move the insertion cursor (§5).

### 4. Clipboard (app-wide, cross-clip)

A module-level `let clipboard: ClipboardNote[] | null` (relative form: `{ dStart, midi, duration,
velocity }` against the group's min-start tick).

- **Ctrl/Cmd+C** → `clipboard = serializeClipboard(selection)`. **Ctrl/Cmd+X** → copy then delete.
- **Ctrl/Cmd+V** → paste at the mouse: anchor the group's earliest note `(start, midi)` to the
  snapped mouse `(tick, midi)` via `pasteTranslate`; every other note keeps its relative
  `(dStart, dMidi)`; clamp to bounds; append to notes; the pasted notes become the new selection.
  A `lastMouse` `{tick, midi}` is tracked on grid `pointermove`; if the mouse was never over the
  grid, paste falls back to the insertion cursor / playhead.

### 5. Computer-keyboard note input

Active when the editor frame has **focus** (it gets `tabindex=0`; clicking it focuses; a focus ring
shows). A keydown handler on the frame (not `document`) drives input and `stopPropagation`s the keys
it consumes.

- **Audition (always):** each musical keydown calls `opts.auditionNote(midi)` → host
  `triggerForLane(laneId, midi, now, gate, false)` with a short fixed gate.
- **Stopped → step input:** keydown writes a note at the **insertion cursor** tick (`midi` =
  octave base + key offset, velocity 80, duration = snap) and advances the cursor by one snap. Held
  multiple keys = a chord at one step; the cursor advances when **all** keys release. **Backspace**
  (when there is no selection) deletes the last inserted note and steps the cursor back; with a
  selection, Delete/Backspace remove the selection instead (§3 takes precedence).
- **Playing → real-time record:** keydown starts a note at the current playhead tick
  (`opts.getPlayheadTick`); keyup closes it with `duration = quantizeRecorded(startTick, endTick,
  snap)` (min one snap); appended to `clip.notes`. One undo gesture per recorded note (or per
  record pass).
- **`z` / `x`** shift the octave base by 12 (clamped to `[minMidi, maxMidi]`); the toolbar octave
  readout updates.
- **Insertion cursor:** a distinct vertical marker (not the playhead); positioned by `←/→` (when no
  selection) or by clicking the grid; starts at tick 0.

### 6. Wiring

- `ClipEditorDeps` gains `triggerForLane` (from the host) ; `buildPianoRoll` passes
  `laneId: lane.id` and `auditionNote` into `PianoRollOpts`. The host already owns `triggerForLane`
  ([session-host.ts](../../../src/session/session-host.ts)); thread it through
  `ClipEditorDeps` → `SessionInspector` deps.
- **Key scoping:** the editor handler ignores events when `isTextEditTarget(e.target)`; it consumes
  (`stopPropagation` + `preventDefault`) the keys it handles so they don't reach the global Ctrl+Z
  undo or the inspector's clip-delete (`Delete`/`Backspace` in the focused editor deletes **notes**,
  never the clip).
- No `SavedStateV3` / migration changes.

### 7. Pure, testable logic — `src/core/piano-roll-editing.ts`

All non-canvas logic lives here so it is unit-tested without the DOM:

- `keyToSemitone(key: string): number | null` and `midiForKey(key, octaveBase): number | null` —
  the standard layout map above.
- `notesInRect(notes, rect)` where `rect = {tick0, tick1, midi0, midi1}` → the intersecting notes.
- `translateGroup(notes, dTick, dMidi, bounds)` → the clamped `(dTick, dMidi)` that keeps the whole
  group inside `[0, patternTicks]` × `[minMidi, maxMidi]`.
- `serializeClipboard(selected): ClipboardNote[]` (relative to min-start) and
  `pasteTranslate(clipboard, anchorTick, anchorMidi, bounds): NoteEvent[]` (group anchored to the
  mouse, clamped).
- `quantizeRecorded(startTick, endTick, snap): { start, duration }` (min one snap).

`pianoroll.ts` imports these; the canvas handlers are thin glue around them.

## Testing

Per the project's relative-assertion rule (these are exact integer/geometry assertions, which is
appropriate — no DSP magnitudes):

1. **`piano-roll-editing.test.ts`:** `midiForKey('a',60)===60`, `('w',60)===61`, `('k',60)===72`,
   non-musical key → null; octave clamp at range edges; `notesInRect` includes/excludes correctly
   on rect edges; `translateGroup` clamps a group at tick 0 / top row without deforming;
   `serializeClipboard`→`pasteTranslate` round-trips relative offsets and anchors to a given mouse
   `(tick,midi)`; `quantizeRecorded` snaps and enforces the one-snap minimum.
2. **Existing tests stay green:** the new `auditionNote?`/`laneId?` opts and `ClipEditorDeps`
   `triggerForLane` are added so existing `createPianoRoll` / clip-editor / inspector callers compile
   unchanged (optional fields; test fixtures already stub `triggerForLane`).
3. **Manual smoke:** Pencil unchanged; Select marquee + Shift-add + group drag + Delete; Ctrl+C/X/V
   pastes at the mouse across two clips; type a melody (stopped) at the cursor with `z`/`x` octave;
   play + record a few keys quantized; audition sounds in both modes.

## Touch list (for the implementation plan)

- **New:** `src/core/piano-roll-editing.ts` (+ `piano-roll-editing.test.ts`).
- **Edit:** `src/core/pianoroll.ts` (tool toolbar, selection state + marquee/click, group move,
  clipboard keys, keyboard note input + insertion cursor + octave, highlight drawing, new opts);
  `src/session/clip-editors/clip-editor-router.ts` (pass `laneId` + `auditionNote`);
  `src/session/session-inspector.ts` + `ClipEditorDeps` (thread `triggerForLane`).
- **No** saved-state / schema / migration changes.
