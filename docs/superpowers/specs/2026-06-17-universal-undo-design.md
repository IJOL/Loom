# Universal Undo Layer — Design

**Date:** 2026-06-17
**Status:** Approved (design), pending spec review
**Topic:** Make undo/redo cover *every* session mutation automatically, and add Undo/Redo buttons to the header.

## Problem

Undo is "green all over the place": editing notes, moving/creating/deleting clips, and
creating/moving scenes & lanes frequently don't undo. Two independent root causes:

### Root cause 1 — capture is opt-in and fragile

The history engine itself is sound: `createHistory<SavedStateV3>` keeps **full-state
snapshots** (past/future stacks), `snapshot()` = `buildSavedStateV3(...)`, `restore()` =
`applyLoadedStateV3(...)`. The snapshot already contains all notes/clips/scenes/lanes, so
the *data model* for undo is complete.

The failure is in **deciding when to create an undo point**. Every mutation site must
remember to call `withUndo(...)` (discrete) or `beginGesture/commitGesture` (drag/knob).
This opt-in is fragile three ways:

1. It depends on `historyDeps` being present at the call site. The ubiquitous pattern
   `if (hd) withUndo(hd, run); else run();` runs the mutation **without undo, silently**,
   when `historyDeps` is missing/late-bound.
2. Keyboard edits in the note editors (paste, delete, nudge, computer-keyboard note input)
   may not all route through a gesture bracket.
3. **Any new mutation site is un-undoable by default** — the engineering default is wrong.

### Root cause 2 — restore doesn't repaint the view you're editing in

On Ctrl+Z, `restore` → `applyLoadedSessionState` reloads state and calls
`renderWithMixer()` (repaints the clip grid + mixer). But it does **not** re-render the
**open clip editor**. The mounted piano-roll/drum-grid closes over the *old* `clip` object
(`getNotes: () => clip.notes`). So after an undo the state genuinely reverts, but the open
editor still shows the stale notes → "undo doesn't capture notes". The active lane editor
(knobs/labels) has the same staleness. This is why undo "doesn't work" even where capture
*does* fire: **the undo isn't visible in the view you're in.**

## Goal

A single layer that guarantees undo/redo of **all** session state, with no per-site opt-in,
plus visible Undo/Redo buttons in the header. Scope of "state under undo" is unchanged:
`SavedStateV3` (session only — performance/arrangement takes stay out, as today).

## Non-goals

- Granular/surgical restore (we keep the existing full-reload `restore` — it already works
  and the user has not complained about restore behaviour, only about capture + repaint).
- Undoing transport actions (play/stop/clip-launch/scene-launch) — those mutate play-state,
  not `SavedStateV3`, and are not undoable today. Unchanged.
- Undoing Load/demo/New (these clear history today; they remain history boundaries).

## Design

Four pieces.

### 1. Automatic capture layer — `src/save/auto-history.ts`

A module that wraps the existing `HistoryController<SavedStateV3>` + `snapshot`/`restore`
(the current `HistoryDeps`) and captures changes **automatically** from global interaction
events, instead of relying on per-site calls.

State it owns:
- `baseline: SavedStateV3` — the last known-committed state.
- `gestureDepth: number` — >0 while a pointer drag or a focused text field is active.

Core operation:
```
checkpoint():
  if gestureDepth > 0: return            // mid-gesture: defer
  const cur = snapshot()
  if !structurallyEqual(cur, baseline):  // JSON-string equality (snapshot is serialisable)
    history.commit(baseline)             // push the PRE-change state
    baseline = cur
    notifyChange()                       // update button enabled/disabled state
```

Global listeners installed on `document` (capture phase, so we see the event after the
app's own handlers have mutated state — we schedule `checkpoint()` in a microtask):
- `pointerdown` → `gestureDepth++` (snapshot the baseline lazily — baseline is always the
  last committed state, so no extra snapshot needed here; we just suppress checkpoints).
- `pointerup` → `gestureDepth--`; then `checkpoint()` (collapses a whole drag into ONE
  undo step).
- `keyup` / `change` / `drop` → `checkpoint()` (microtask), **unless** the target is a
  text-edit field (handled by focus/blur below). Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z are
  ignored here (the keyboard handler owns them).
- `focusin` on a text-edit target (`isTextEditTarget`) → `gestureDepth++`.
- `focusout` on a text-edit target → `gestureDepth--`; then `checkpoint()` (1 undo per
  field edit, not per character).

Public API:
- `checkpoint()` — for async/programmatic mutations (see §4).
- `undo()` / `redo()` — pop the stack, `restore(...)`, then `baseline = snapshot()` (so the
  restored state is the new baseline and isn't re-detected as a fresh change), then
  `refreshAll()` (§2) + `notifyChange()`.
- `canUndo()` / `canRedo()`.
- `markClean()` — `baseline = snapshot()` without committing (after Load/demo/New).
- `onChange(cb)` — register a listener fired whenever the stacks change (drives the
  buttons' enabled/disabled state).

Coalescing rule summary: **1 undo per pointer gesture (down→up), 1 per text-field edit
(focus→blur), 1 per discrete click/key action.** A click that fires an async op is handled
in §4.

### 2. Universal post-restore refresh — `refreshAll()`

A single function (lives on/near `SessionHost`) invoked after every undo/redo, re-rendering
**all** state-dependent views so the undo is visible wherever you are:
- `renderWithMixer()` — clip grid + mixer + tab bar (already happens via restore).
- **Open clip editor** — if the inspector has a selected clip and its panel is shown,
  `inspector.renderEditor()` (rebuilds the piano-roll/drum-grid against the restored clip).
- **Active lane editor** — if `activeEditLane` is set, re-show it (`showLaneEditor`) so its
  knobs/labels/preset reflect restored engine state.
- Breadcrumb context (already via `render()`).

It must be idempotent and must not *open* panels that were closed (only refresh what's open).

### 3. Neutralise the old opt-in — no edits to 45 sites

To avoid double-counting (an old `withUndo` committing a snapshot *and* the auto layer
detecting the same change), turn the legacy helpers into **history no-ops** in
`src/save/history-wiring.ts` — a single file:
- `withUndo(d, fn)` → just `return fn()` (still runs the mutation; no longer commits).
- `beginGesture` / `commitGesture` / `cancelGesture` → no-ops (the auto layer coalesces via
  global pointerdown/up; text fields via focus/blur).

All existing `if (hd) withUndo(hd, run); else run();` call sites keep working unchanged — the
mutation still runs, and the auto layer captures the result. `historyDeps` presence no longer
affects whether undo records. (`wireHistoryKeyboard` stays, but now drives the auto layer's
`undo()/redo()`.)

### 4. Explicit checkpoints for async / programmatic mutations

Mutations that don't end in a `pointerup` (so the auto listeners can't observe the result)
call `autoHistory.checkpoint()` when they finish. These are few and well-defined:
- Stem separation → lanes.
- Loop / MIDI import → clips/lanes.
- Audio→notes transcription → note lanes.
- Live-take WAV dropped into a new audio channel.

Load / demo-switch / New call `markClean()` instead (history boundary — you can't undo a
Load, same as today, where `applyLoadedState` calls `history.clear()`).

### 5. Header Undo/Redo buttons

Two icon buttons in the transport row (`.row.transport` in `index.html`, beside Play/Stop):
- Undo — icon `↶` (`&#8634;`), `title="Undo (Ctrl+Z)"`, `id="undo-btn"`.
- Redo — icon `↷` (`&#8635;`), `title="Redo (Ctrl+Shift+Z)"`, `id="redo-btn"`.

Behaviour:
- Click → `autoHistory.undo()` / `.redo()` (the exact same path as the keyboard shortcut,
  including `refreshAll()`).
- Enabled/disabled reflect `canUndo()` / `canRedo()`, updated via `autoHistory.onChange(...)`
  and once at boot. A disabled button is greyed and non-interactive.
- All labels/tooltips in **English** (UI-text convention).

## Components & data flow

```
user interaction ─┬─ pointerup / keyup / change / drop / blur(text)
                  │        │
                  │        └─► autoHistory.checkpoint() ──► (state changed?) commit(baseline)
                  │                                              │
async op finishes ┴─ autoHistory.checkpoint() ──────────────────┘
                                                                 │
Ctrl+Z / Undo button ─► autoHistory.undo() ─► restore(prev) ─► refreshAll() ─► notifyChange()
Ctrl+Shift+Z / Redo  ─► autoHistory.redo() ─► restore(next) ─► refreshAll() ─► notifyChange()
                                                                 │
                                                          onChange ─► undo/redo buttons enable/disable
Load / demo / New ─► markClean() (history boundary)
```

`createHistory`, `buildSavedStateV3`, `applyLoadedStateV3` are unchanged. `auto-history.ts`
sits on top; `history-wiring.ts` is reduced to no-op helpers + the keyboard handler now
delegating to the auto layer.

## Wiring (main.ts)

Today main.ts builds `history`, `historyDeps`, calls `wireHistoryKeyboard(historyDeps)`, and
sets `_discreteHistoryDeps`. New plan:
- Build `autoHistory = createAutoHistory({ history, snapshot, restore, refreshAll })`.
- `autoHistory.installGlobalListeners(document)`.
- `wireHistoryKeyboard` delegates undo/redo to `autoHistory`.
- Wire the two header buttons to `autoHistory.undo/redo` + `onChange`.
- Load/New/demo paths call `autoHistory.markClean()`.
- `refreshAll` is supplied by main.ts as a closure over `sessionHost` (renderWithMixer +
  open-editor + active-lane refresh).

## Error handling & edge cases

- **Empty checkpoints:** if `snapshot()` equals `baseline`, nothing is committed (no junk
  undo steps from clicks that change nothing).
- **Async during a gesture:** ignored as a corner case; the explicit §4 checkpoints cover
  the real async paths.
- **rAF render tick:** `startRenderTick` repaints on play-state changes but never triggers a
  checkpoint (we only listen to input events), so playback doesn't spam the undo stack and
  `snapshot()` is not called per frame.
- **Snapshot cost:** one `buildSavedStateV3` + one JSON compare per *interaction* (not per
  frame). Negligible at human interaction rate. If a pathologically large session ever
  shows lag, the diff can later be optimised (dirty-hash); out of scope now.
- **`maxSize`:** unchanged at 100.
- **Text fields with native undo:** `wireHistoryKeyboard` already skips text-edit targets so
  native field undo wins; the auto layer treats a focused text field as a gesture so its
  edits collapse into one app-level undo on blur.

## Testing

Unit (Vitest, pure / DOM-light):
- `auto-history.test.ts`:
  - checkpoint commits the pre-change baseline only when state changed; no-op when equal.
  - gesture bracket (pointerdown→…→pointerup) collapses N intermediate states into 1 undo.
  - text-field focus→blur collapses to 1 undo.
  - undo/redo round-trips state and re-syncs baseline (a checkpoint right after undo is a
    no-op, i.e. undo isn't re-detected as a new change).
  - `markClean` resets baseline without committing.
  - `onChange` fires on commit/undo/redo; `canUndo/canRedo` track the stacks.
- `history-wiring.test.ts`: `withUndo` runs `fn` and does NOT commit; gesture helpers are
  no-ops.

Integration / behavioural (one test per user path — no "(or…)" alternatives):
- Edit notes in the piano-roll → undo restores notes **and** the open editor repaints.
- Toggle a drum-grid cell → undo restores it and the grid repaints.
- Move a clip → undo.
- Create a clip (cell click) → undo.
- Add a scene → undo; delete a scene → undo.
- Add a lane → undo; duplicate a lane → undo; delete a lane → undo.
- Rename a track / scene → undo.
- Knob tweak (gesture) → single undo.
- Header Undo/Redo buttons: enabled/disabled state tracks the stacks; clicking matches the
  keyboard path.

e2e (Playwright, against a fresh `npm run build`): a representative end-to-end — edit notes,
add a lane, move a clip, then Undo×3 via the header buttons and assert the grid + open editor
return to the original.

## Risks

- **Restore is a full reload** (stops voices, re-allocates engines). Pre-existing behaviour,
  unchanged — undo while audio plays may hiccup, as it can today. Accepted.
- **Over-coalescing** two distinct fast actions inside one pointer gesture is impossible
  (a gesture is one pointerdown→pointerup); distinct clicks are distinct gestures. Low risk.
- **Neutralising `withUndo`** could regress a site that relied on commit-before semantics for
  a mutation that somehow never produces an observable input event. Mitigated by the §4
  explicit checkpoints and the behavioural test matrix.
