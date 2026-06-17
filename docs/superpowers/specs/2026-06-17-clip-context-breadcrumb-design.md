# Clip context breadcrumb + in-place rename — design

**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan
**Mockup:** [2026-06-17-clip-context-breadcrumb-mockup.html](./2026-06-17-clip-context-breadcrumb-mockup.html)

## Problem

When you open a clip in the bottom editor (the session inspector / piano-roll), there is
**no indication of which clip you are editing**. Concretely, today:

- The clip's **name** input is buried in the transport row next to Length/Launch — easy to miss,
  and it gives no hint of which track/scene the clip belongs to.
- **Scenes cannot be renamed at all** from the UI (`sceneLaunchCell` only launches / adds /
  deletes). Their names stay the auto-seeded `Scene N`.
- **Lanes (tracks) cannot be renamed in place** either; the ⚙ button only opens the instrument
  editor. The lane name shows `lane.name ?? id.toUpperCase()` but there is no way to set it.
- There is **no link** between the open editor and its cell in the grid, so it is hard to find
  the clip again among the scenes.

The user's words: "cuesta reconocer qué clip estamos editando … necesitamos una referencia clara
al lane y la scene … hay desorganización con los nombres de clips y scenas, no se modifican o si
se modifican no se ven … que sea fácil encontrar el clip en el grid de escenas".

## Goal

Make the open clip's identity unmistakable and make track/scene/clip names consistently
**editable and visible** everywhere they appear.

## Scope (confirmed with user)

- Rename **clip + scene + track**, all three.
- Rename mechanism: **double-click in place + context menu** (in the grid), plus editing from the
  new editor header.
- UI strings in **English** (per project convention — [[feedback-ui-text-in-english]]).

Out of scope (YAGNI): per-scene clip remapping UI, renaming via keyboard-only flows, colour
editing, reordering. No saved-state schema change.

## Design

### 1. Editor context header (breadcrumb) — the centrepiece

A new header at the top of `#session-inspector`, above the existing controls, structured as three
segments separated by `▸`:

```
TRACK  ▌■ <track name>      ▸   SCENE  <scene name> (row N)      ▸   CLIP  [ <clip name input> ]  [EDITING]
```

- **TRACK segment**: a small colour swatch + the track name. The swatch uses the clip's colour
  fallback / engine accent. The track name is an inline-editable label (click to edit → commits to
  `lane.name`).
- **SCENE segment**: the name of the scene on the clip's row (`state.scenes[clipIdx]`) plus the row
  number `(row N)` for disambiguation. Inline-editable (commits to `scene.name`). If the row has no
  scene yet, show `(row N)` only with a muted "—" name placeholder; editing seeds nothing (rename is
  disabled until a scene exists on that row — scenes are auto-seeded by `ensureScenesForRows`, so in
  practice every clip row has one).
- **CLIP segment**: the **promoted** clip-name `<input>` (this REPLACES the old buried `Name`
  field — there is only one clip-name input, now here), prominent, with an `EDITING` badge so the
  open clip reads as "this is what you're editing". Placeholder = the grid fallback `Clip {N}`.

Editing any of the three names re-renders the grid (`renderWithMixer`) so the change shows
immediately in the cell / lane header / scene button.

### 2. Secondary controls row

The existing transport controls (Length, Launch, Duplicate, Delete) and the edit row (Copy/Paste,
🎲, Vary, Mirror, Reverse, examples, View-as-grid, Chords, tonality) stay exactly as they are,
but move **below** the breadcrumb so the context header is read first. No behavioural change to
those controls. (The old `Name` label/input is removed from the transport row — it lives in the
breadcrumb now.)

### 3. In-place rename in the grid

- **Lane header** (`laneHeader` in `session-ui.ts`): double-click on `.session-lane-name` turns it
  into an `<input>`; Enter / blur commits to `lane.name` and re-renders. The lane context menu gains
  a **"Rename track"** item that does the same (focuses an inline input or prompts — see below).
- **Scene cell** (`sceneLaunchCell`): double-click on the `▶ <name>` button turns the label into an
  `<input>` (the ▶ launch affordance is suppressed while editing so the click doesn't launch);
  Enter / blur commits to `scene.name`. The scene context menu gains **"Rename scene"**.

Inline-edit implementation: a tiny shared helper `beginInlineRename(labelEl, currentValue, commit)`
that swaps the label for an `<input>`, selects its text, and on Enter/blur calls `commit(value)`;
Escape cancels. Used by both lane and scene. This keeps the two call sites consistent and testable.

### 4. Open-clip highlight in the grid

The grid needs to know which clip is open so it can mark it. `renderSessionGrid` already receives
everything via `state` + `laneStates`; we pass the current selection in as well (an optional
`openClip?: { laneId: string; clipIdx: number }` on the render call, sourced from
`SessionInspector.getSelectedClip()`).

- The matching clip cell gets a class `session-cell-editing` → an **amber ring** (distinct from the
  red "playing" ring and the amber "queued" pulse: a static amber outline + soft glow).
- The matching **row** gets a subtle tint so the scene on that row is easy to spot.

When the inspector is closed (clip deleted, panel hidden) the selection clears and the next grid
render shows no highlight.

### 5. "Which scene is this clip in?" — the mapping

A pure helper resolves the breadcrumb's context from a selection:

```ts
// in session.ts (pure, unit-tested)
export function resolveClipContext(state, laneId, clipIdx): {
  lane: SessionLane;
  clip: SessionClip;
  sceneName: string;   // state.scenes[clipIdx]?.name ?? `Scene ${clipIdx+1}`
  rowNumber: number;   // clipIdx + 1
  trackName: string;   // lane.name ?? lane.id.toUpperCase()
  clipName: string;    // clip.name ?? `Clip ${clipIdx+1}`
} | null
```

Rationale: a clip lives at `(laneId, clipIdx)`; by default scene `clipIdx` launches clip
`clipIdx` on every lane (`session-runtime.ts`: `idx = hasExplicit ? clipPerLane[lane.id] : sceneIdx`).
So the scene "containing" a clip, for display, is the scene on its own row. The rare explicit
`clipPerLane` override (a scene pointing at a different row) is **not** reflected in the breadcrumb —
we always show the row's scene. This is the simplest correct mapping for the common case and is
documented here as a deliberate limitation.

## Data model

No schema change. All three name fields already exist and already persist:

- `SessionClip.name?: string`
- `SessionLane.name?: string`
- `SessionScene.name?: string`

Fallback display names (kept consistent across grid + breadcrumb):

| Entity | Fallback shown |
|--------|----------------|
| Clip   | `Clip {row+1}` — shown in BOTH the grid cell and the breadcrumb (the cell currently shows the bare `{row+1}`; align it to `Clip {row+1}` for consistency) |
| Scene  | `Scene {row+1}` (already the seeded default) |
| Track  | `{laneId.toUpperCase()}` (already used) |

## Undo

Every rename wraps the mutation in the existing undo machinery:

- Clip name: already uses `historyDeps.history.beginGesture/commitGesture` on focus/blur — unchanged.
- Track / scene rename: wrap the commit in `withUndo(historyDeps, …)` (a single undoable step),
  mirroring `qEl`/duplicate/delete handlers in `session-inspector.ts`.

## Components / files touched

- **`src/session/session.ts`** — add pure `resolveClipContext` helper.
- **`index.html`** — restructure `#session-inspector` top: add the breadcrumb container
  (`#insp-context`), move Length/Launch/Duplicate/Delete into a secondary row, remove the standalone
  `Name` label (its input moves into the breadcrumb as `#insp-name`).
- **`src/session/session-inspector.ts`** — render the breadcrumb (track swatch + names + clip input);
  wire inline edit of track/scene names from the header; keep the existing clip-name wiring on the
  relocated `#insp-name`; expose the open selection to the grid render path.
- **`src/session/session-ui.ts`** — `laneHeader` + `sceneLaunchCell` get double-click rename and
  context-menu "Rename …"; `clipCell`/row get `session-cell-editing` when it matches `openClip`; new
  callbacks `onRenameLane(laneId, name)`, `onRenameScene(sceneIdx, name)`; `renderSessionGrid`
  accepts `openClip`.
- **`src/session/session-host-callbacks.ts`** / **`session-host.ts`** — implement
  `onRenameLane`/`onRenameScene` (undo + `renderWithMixer`); pass the inspector's selected clip into
  `renderSessionGrid`.
- **`src/styles/_session-inspector.scss`** — `.clip-context` breadcrumb styling (swatch, segments,
  separators, promoted clip input, EDITING badge).
- **`src/styles/_session-grid.scss`** — `.session-cell-editing` amber ring + open-row tint; inline
  rename input styling for lane/scene.
- **`src/session/clip-editors/…`** — no change (the breadcrumb lives in the inspector, above the
  editor router output).

## Testing

Per the project's layered testing convention:

1. **Pure** (`*.test.ts`):
   - `resolveClipContext` returns the right track/scene/clip names + row number, including the
     fallbacks, and `null` for a missing lane/clip.
   - `beginInlineRename` commit/cancel logic (Enter commits, Escape cancels, blur commits) — pure
     DOM, runs under jsdom.
2. **UI wiring** (jsdom, no audio):
   - Double-clicking a lane name / scene button enters edit mode and committing fires
     `onRenameLane` / `onRenameScene` with the typed value.
   - `renderSessionGrid` applies `session-cell-editing` to exactly the cell matching `openClip` and
     to no other cell.
   - Renaming the clip in the breadcrumb updates `clip.name` and triggers a grid re-render
     (cell label changes).
3. **No DSP / scheduling impact** — this is pure UI; no `.dsp`/`.wiring` tests needed.

Visual parity (per [[feedback-mockup-parity-and-honest-done]]): after implementation, load the real
app, open a clip, and compare the breadcrumb + grid highlight side-by-side with the mockup before
calling it done.

## Decisions (resolved)

1. **Clip cell fallback label**: unnamed clips show `Clip {row+1}` in BOTH the grid cell and the
   breadcrumb (the cell's bare `{row+1}` is aligned to `Clip {row+1}`). One fallback, used everywhere.
2. **Context-menu rename**: "Rename track" / "Rename scene" in the context menu triggers the SAME
   in-place inline edit as double-click (focuses the in-place input). It does not open a modal.
