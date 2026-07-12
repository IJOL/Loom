# Session view reorder — design

**Date:** 2026-07-12
**Status:** approved (design), ready for implementation plan
**Approved mockup:** [2026-07-12-session-view-reorder-mockup.html](./2026-07-12-session-view-reorder-mockup.html)

## Goal

Reorganise Loom's Session view so it reads top-to-bottom the way you work:

1. **Scenes** — the clip grid + mixer — always on top.
2. **Synth** — the engine editor of the *active* lane — in the middle, only when open.
3. **Clip** — the piano-roll / note editor — at the bottom, only when a clip is open.

And fold the lane selector into the grid itself: the **column header of each lane** becomes the lane selector. The separate lane-tabs row disappears.

## Current state (as built)

DOM inside `#session-view-root` (a direct child of `.synth`), in document order:

- `.synth-row#synth-tabs` — the **lane tabs** row, built by `renderSessionTabBar` (`src/session/session-tab-bar.ts`): one tab per lane (`onPickLane`→`onEditLane`), an engine `<select>` + `+` button (`onAddLane`, excludes audio), and a separate `+ Audio` button (`onAddAudioChannel`).
- `.page[data-page="303"|"drums"|"poly"]` — the **engine editors**, toggled by `showLaneEditor` (`src/session/session-host-lane-editor.ts`).
- `.session-view#session-view` → `#session-grid` (the scenes grid, incl. the mixer row) then `#session-inspector` (the clip editor) then `#master-fx-panel`.

So today the vertical order is **lane tabs → synth editor → scenes grid → clip**, i.e. the synth sits *above* the scenes. The `order:` rules in `index.html`'s inline `<style>` that once arranged this are **dead** — they target direct children of `.synth`, but those elements now live inside `#session-view-root`.

Two facts make the redesign cheap:

- `renderSessionGrid` (`src/session/session-ui.ts`) already renders a per-lane **column header** (`laneHeader()`), and that header already carries a `⚙` "Edit instrument" button wired to `cb.onEditLane(lane.id)`. The selector affordance already exists in the grid — we just promote it.
- `showLaneEditor` already owns "which lane's editor is open" (`self.activeEditLane`) and toggles the `.page` elements by global `data-page` lookup, so moving the pages in the DOM does not break it.

## Target behaviour (approved)

**Vertical order:** `#session-grid` (scenes) → `.page` engine editor (synth) → `#session-inspector` (clip) → `#master-fx-panel`.

**Column header = lane selector.** Clicking a lane's column header selects that lane and opens its engine editor in the middle zone. The old separate lane-tabs row is removed.

**Active column marked.** The lane whose synth is showing is marked in the grid: its header **label recolours** to the synth-zone hue (cyan `#5bb8c4`, the primary marker), and the whole column — clip cells + mixer strip — gets a soft cyan wash. This ties the column to the editor below.

**Chevron collapse.** The active header shows a `▾`/`▸` chevron. `▾` collapses the synth zone (hides the editor) and becomes `▸`; `▸` reopens it. Clicking the header itself only ever *selects* — the header never collapses on its own; collapse/expand is exclusively the chevron.

**`+` engine picker.** A single `+` control in the header row opens a menu listing every engine, with **Audio channel** as one more option in that list (no separate `+ Audio` button). Picking an instrument engine calls `onAddLane(engineId)`; picking Audio channel calls `onAddAudioChannel()`.

Nothing about scene launching, clip editing, mixer, or the master FX panel changes — only the layout order and the lane-selector surface.

## Approach

Small, contained edits to the existing render path — no new subsystem.

### 1. Layout order (`index.html` + SCSS)
- Move the three `.page` engine-editor blocks *into* `.session-view`, positioned between `#session-grid` and `#session-inspector`.
- Make `.session-view` a `flex-direction: column` container so document order gives scenes → synth → clip → master-fx. (It already carries the view's padding.)
- Remove the dead `.synth > .tab-bar/.synth-row/.page/.session-view` `order:` rules from the inline `<style>` and the now-empty `.tab-bar`.

### 2. Remove the lane-tabs row
- Delete the `#synth-tabs` (`.synth-row`) element and stop building it: drop `SessionHost.refreshSynthTabs()` / the `renderSessionTabBar` call, and remove `src/session/session-tab-bar.ts` once nothing imports it.
- The active-lane highlight that `showLaneEditor` applied to `.session-lane-tab` moves to the grid header (see §3).

### 3. Column header as selector (`session-ui.ts` `laneHeader` + `renderSessionGrid`)
- Make the whole header a click target for `onEditLane(lane.id)` (keep the delete-cross and rename affordances working via `stopPropagation`; single-click selects, rename stays on double-click / context-menu using the existing index-timed disambiguation pattern). The now-redundant `⚙` button is removed.
- Pass the host's `activeEditLane` (and a `synthCollapsed` flag) into `renderSessionGrid` so it can mark the active column (header label + cell/strip wash via a `col-active` class on that lane's cells and its mixer strip) and render the chevron in the correct `▾`/`▸` state on the active header only.
- Add the `+` engine-picker control to the header row: a menu built from `listEngines('polyhost')` plus an explicit **Audio channel** entry, wired to `onAddLane` / `onAddAudioChannel`.

### 4. Collapse state (`session-host.ts` + `session-host-lane-editor.ts`)
- Add a UI-only, non-serialized `synthCollapsed` flag on `SessionHost` (mirrors `masterFxOpen`) with a `toggleSynthEditor()` method the chevron calls.
- Selecting a lane (`showLaneEditor`) opens its editor and clears the collapsed state; the chevron is the only thing that sets it. When collapsed, the `.page` is hidden even though a lane is active.
- `showLaneEditor` drops the `.session-lane-tab` active toggle and instead triggers the grid re-render that marks the active column.

## Non-goals / out of scope

- **The manual.** This change makes the Session-view screenshots stale, and the manual is 62 commits behind its last update (`d022e54`, v0.6, 2026-06-27). Refreshing the manual — auditing `d022e54..HEAD` and rewriting affected chapters + regenerating screenshots/PDF — is a **separate spec/plan** (agreed 2026-07-12). This spec's "done" only requires regenerating the Session-view screenshots that this reorg changes, not the full manual audit.
- No change to audio, scheduling, persistence, or the clip/scene/mixer behaviour.
- No change to which engines exist or how the editor renders a given engine.

## Risks & mitigations

- **Moving `.page` in the DOM.** `showLaneEditor` and preset/param mounting resolve elements by `id`/`data-page` globally, not by position — moving the blocks is safe. Verify the engine editor still opens for 303 / drums / poly (subtractive + FM/Wavetable/Karplus) after the move.
- **Active-highlight regression.** Removing `.session-lane-tab` means the highlight must come from the grid header. Ensure `showLaneEditor` re-renders/marks the header so the active column is always correct after engine swaps and undo/redo (`refreshAfterRestore`).
- **Click vs rename on the header.** Single-click now selects; double-click renames. Reuse the index-timed disambiguation already used for scene launch so a rename double-click doesn't fire a spurious select. Keep delete-cross `stopPropagation`.
- **Tests / e2e referencing the old surface.** Anything that clicks `#synth-tabs` / `.session-lane-tab` / `+ Audio`, or asserts the old order, must be updated. The plan enumerates them (grep `synth-tabs`, `session-lane-tab`, `renderSessionTabBar`, `onAddAudioChannel`).

## Testing

- **Unit (pure/DOM):** `renderSessionGrid` marks the active column when given `activeEditLane`; the `+` menu includes an Audio channel entry that calls `onAddAudioChannel`; the header click calls `onEditLane`; the chevron toggles `synthCollapsed`. Update/'add' `session-ui` tests; update `session-add-lane` if it drove the tab bar.
- **Manual visual parity (mandatory, per project rule):** load the real app, open a lane from a column header, confirm order is scenes → synth → clip, the active column is marked, the chevron collapses/reopens, and the `+` menu adds lanes incl. Audio channel. Screenshot and compare against the approved mockup.
- Full suite green (`npm test`), typecheck clean.

## Acceptance criteria

1. Session view renders scenes (top) → synth (middle, when open) → clip (bottom).
2. Clicking a lane's column header opens that lane's engine editor; the separate lane-tabs row is gone.
3. The active lane's column is marked (header label cyan + column wash).
4. The active header's `▾`/`▸` chevron collapses/reopens the synth zone; the header alone never collapses.
5. A single `+` opens an engine menu that includes Audio channel; it adds lanes correctly.
6. Session-view screenshots used by the app are regenerated; the full manual refresh is tracked as a separate spec.
7. Visual parity with the approved mockup confirmed by a human look; suite + typecheck green.
