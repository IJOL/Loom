# Clip-editors dedup refactor (piano-roll ↔ drum-grid)

**Goal:** remove the ~450 LOC of interaction logic duplicated between the two
canvas clip editors ([core/pianoroll.ts](../../../src/core/pianoroll.ts), 801 LOC;
[clip-editors/clip-editor-drum-grid.ts](../../../src/session/clip-editors/clip-editor-drum-grid.ts),
396 LOC) by extracting shared modules — and, as a side effect of the shared
toolbar, **restore grid quantization control on the notes editor** (today the
piano-roll snap is hardcoded to 16th; the drum-grid already has a `Grid` select).

**Behaviour must be preserved.** This is a refactor: the only intentional UX change
is the new resolution selector on the piano-roll. Verify with `test:fast` per phase
AND a final browser look (both editors' toolbars unchanged; notes resolution works).

**Already shared (don't touch):** `velocity-lane-editing.ts`, the `.editor-grid-control`/
`.editor-help-*` SCSS, `velocity-color.ts`. The pure logic (`piano-roll-editing.ts`,
`drum-grid-editing.ts`) is short, tested, and domain-specific (midi vs row) — do NOT
over-generalize it into leaky generics; the win is in the canvas glue, not here.

## Phases (ROI order; one worktree, TDD, rebase main per phase)

### Phase 1 — Shared toolbar + grid-control + notes quantization  ⭐ highest ROI
- New `src/core/clip-editor-toolbar.ts`: `createToolToggle(onChange)` (✏ Draw / ▭ Select),
  `createHelpButton(legend)` (? + popover), `createGridControl(label, el)` (the
  right-anchored `.editor-grid-control` wrapper), `createResolutionSelect(initial, onChange)`
  (reuses `RESOLUTIONS`/`clampResolution` from `drum-grid-editing.ts`).
- jsdom test for the factories.
- Rewire drum-grid to use them (no UX change). Rewire piano-roll to use them AND mount
  a resolution select that feeds `snapTicks` into the editor (the `snapTicks?` opt already
  exists in `createPianoRoll`; wire it to `resolutionToSnap(resolution)`, default 1/16 =
  current behaviour). Persist on `clip.gridResolution` like the drum-grid.
- Verify: drum-grid toolbar identical; piano-roll gains a working Grid select; snap follows it.

### Phase 2 — Shared keyboard shortcuts dispatch
- `attachEditorShortcuts(wrap, { onTool, selectAll, copy, cut, paste, del, nudge, deselect })`
  covering the identical 1/2 · Ctrl+A · Ctrl+C/X/V · Esc · Delete · arrows dispatch.
  Editor-specific keys (piano note-typing, octave z/x) stay in the piano-roll.
- Unit test the dispatcher; rewire both. Preserve every current shortcut.

### Phase 3 — Shared selection + marquee state machine
- `createMarquee({ hitTest, drawRect })` + a `Set`-based selection holder; pluggable
  hit-test (`notesInRect` vs `rowsInRect`) and shift-click toggle. Rewire both.

### Phase 4 — Shared canvas render helpers
- `drawGridLines(ctx, …)`, `drawNotes(ctx, notes, sel, xForTick, yFor)`, `drawMarquee(…)`,
  and the `{ redraw }` resize+playhead loop, with pluggable coord transforms (yForMidi vs
  yForRow). Frame/strip layout stays editor-specific (too different — out of scope).

## Done
Each phase green on `test:fast`; final `npm run build` + full suite + a browser look at
both editors confirming no UX regression and the notes resolution selector working.
