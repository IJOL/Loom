# Lane selection coherence — one selected lane, everywhere

**Date:** 2026-08-07
**Branch:** `worktree-lane-selection-coherence`

## The problem

The clip editor and the instrument controls can point at two different lanes at
once. You open lane A's clip, then select lane B some other way, and now the
piano roll shows A while the knobs, presets and engine dropdown below it belong
to B. Every edit lands somewhere other than where the user is looking: a knob
turn changes a lane whose notes are off screen, and the generators, the ▶ and
the record button all act on the clip of a lane that is no longer selected.

The rule already exists in the code and is only half-wired.
`shouldCloseClipEditorOnLaneSwitch` (`src/session/session-host-util.ts`) and
`SessionInspector.closeIfOtherLane` are called from exactly one entry point —
`showLaneEditor`, which the lane-header click reaches. Every other way of
changing lanes bypasses them.

## Root cause

**`activeEditLane` has four writers, not two.** Two of them select a lane, and
only one of those tells the clip editor. The other two clear it to `null`:

| Writer | What it does |
| --- | --- |
| `showLaneEditor` (`session-host-lane-editor.ts`) | selects — closes another lane's clip |
| `SessionHost.focusLane` (`session-host.ts`) | selects — says nothing to the inspector |
| `run` (`session-host-callbacks.ts`) | clears, when the selected lane is deleted |
| `reconcileOpenEditors` (`session-host-persistence.ts`) | clears, when the lane is gone after a state swap |

The two clearing writers are already coherent and must stay that way:
`reconcileOpenEditors` closes the clip inspector in the same pass when the
selected clip's lane or clip no longer exists. They are not selection and do not
route through the funnel's clip rule — they are the teardown path, and the
funnel must not break them.

The two selecting writers are the bug:

- `showLaneEditor` (`src/session/session-host-lane-editor.ts`) — closes a clip
  left open on another lane, then repaints the instrument page.
- `SessionHost.focusLane` (`src/session/session-host.ts`) — sets
  `activeEditLane` and repaints the grid, and says nothing to the inspector.
  Reached by opening a clip (`onClipFocused`) and by the APC/MIDI surface
  (`loom-facade.setActiveLane`).

Separately, the mixer column marks the selected lane (`session-mixer-col-active`)
but clicking it selects nothing.

## Non-goals

- **No clip is ever created** by a lane switch. An empty slot closes the editor;
  it does not fill it.
- **No migration.** Nothing about this changes what a saved session holds.
- **`polyphony` and `polyBlep` are not renamed.** See the blacklist in section 5.

---

## 1 · One door for lane selection

`SessionHost.focusLane(laneId, origin)` becomes the only way the selected lane
changes. Every entry point routes through it:

| Entry point | Today |
| --- | --- |
| Lane header click | `onEditLane` → `showLaneEditor` |
| Clip cell click | inspector `onClipFocused` → `focusLane` |
| Mixer column click | *(does not select)* |
| Engine swap re-route | `engineSwapDeps.onSwapped` → `showLaneEditor` (same lane) |
| APC Key 25 / MIDI | `loom-facade.setActiveLane` → `focusLane` |
| Collapse chevron | `toggleSynthEditor` → `showLaneEditor` (same lane) |
| Undo/redo repaint | `refreshAfterRestore` → `showLaneEditor` |

The engine dropdown is **not** on this list: it reads the selected lane
(`onEngineChange(getActiveLaneId(), …)`) and swaps that lane's engine. It never
changes which lane is selected. What follows a swap — `onSwapped` re-routing the
editor to the new engine's page — is a same-lane call and must stay a no-op for
the clip editor.

`showLaneEditor` stops being an entry point. It becomes what `focusLane` calls
to paint, alongside `renderWithMixer`.

**`showLaneEditor` is two symbols, not one** — the free function in
`session-host-lane-editor.ts` and the `SessionHost.showLaneEditor` method that
delegates to it. Both are touched; callers go through the method.

### Finding every caller is a grep job, not a graph job

The GitNexus call graph reports exactly **one** upstream caller of `focusLane`
(`onClipFocused`). There is a second one — `loom-facade.setActiveLane` at
`src/control/loom-facade.ts:368`, the APC/MIDI surface — and the graph does not
see it, because the call reaches `SessionHost` through a deps object rather than
a direct import. This codebase is built almost entirely out of deps objects, so
the graph systematically under-reports these edges.

Consequence for the work: the list of entry points above was assembled by
grepping for `focusLane` and `showLaneEditor` across `src/`, and any later
re-check must be done the same way. Trusting `impact --direction upstream` to
enumerate them would silently miss the APC path — the exact class of omission
that produced this bug in the first place.

**`origin` is load-bearing, not decoration.** Opening a clip already calls
`focusLane`, and `focusLane` now decides which clip to show. Without knowing the
call came from a clip that was just opened, selecting a clip in lane B would
open it and immediately close it. The existing test
`clip-editor-lane-switch.test.ts` → *"opening a clip never closes the editor it
just opened"* guards exactly this trap and must keep passing.

Origins: `'clip'` (a clip was just opened — do not touch the clip editor),
and `'lane'` (everything else — apply section 2).

## 2 · The clip follows the lane

A new pure function next to `shouldCloseClipEditorOnLaneSwitch`, which it
absorbs and replaces:

```ts
clipToShowOnLaneSwitch(
  state: SessionState,
  nextLaneId: string,
  openClip: { laneId: string; clipIdx: number } | null,
  launchedSceneIdx: number,   // -1 when no scene is launched
): { laneId: string; clipIdx: number } | null
```

Row resolution, in order:

1. the row of the currently open clip, if one is open;
2. otherwise the row of the launched scene (`activeSceneIdx`), if any;
3. otherwise none → return `null`.

Then: if `nextLane.clips[row]` exists, return `{ nextLaneId, row }`; if the slot
is empty, return `null`.

`null` means **close the clip editor**. It never means create.

The instrument page always follows the selected lane, clip or no clip. The only
thing that can end up showing nothing is the clip editor.

**Tested pure, with no DOM:** follows the open clip's row; falls back to the
launched scene; empty slot returns `null`; a lane with fewer clips than the row
index returns `null`; no clip and no launched scene returns `null`; the state is
never mutated (no clip is added by the call).

## 3 · The mixer column selects, and the clip editor gets mute/solo

### 3a · Clicking a mixer column selects its lane

`buildMixerColumn` (`src/core/mixer.ts`) takes an `onSelect(laneId)` callback and
attaches one listener to the column. It has exactly **one** production call site,
`SessionHost.renderWithMixer` (confirmed against the call graph; the only other
caller is `mixer.test.ts`), so threading the callback through is a one-line
change at a single seam. The listener ignores the click when it landed on a live control:

```ts
if ((e.target as Element).closest('button, input, select, .knob')) return;
```

So the fader, the EQ knobs, mute/solo, the insert slots and the preset dropdown
keep doing only their own job — the user chose this over "the whole column
selects", so that moving a fader never yanks them out of the clip they are
editing. The sensitive area is the column background, the track name and the
gaps.

The column already gets `session-mixer-col-active` when selected; it gains a
cursor and hover affordance so the dead zone reads as clickable.

### 3b · Mute and solo in the clip editor header

Two new buttons in `index.html` next to `#insp-play` / `#insp-rec`: `#insp-mute`
and `#insp-solo`, acting on the lane that owns the open clip.

They are **not a second implementation**. They read and write the same
`muteState` / `soloState` records and call the same `applyMuteSolo()` that the
mixer column already uses (`src/core/mixer.ts`). Both pairs of buttons refresh
when either changes — a lane muted from the mixer must not leave the inspector's
button dark, and vice versa.

With no clip open the two buttons are disabled, like `#insp-play` already is.

## 4 · The dead PolySynth is already gone — what survives is live

An earlier draft of this spec had a step here to delete
`src/polysynth/polysynth.ts` and the node-per-note `PolySynth` class, on the
strength of `CLAUDE.md` saying the file "still holds" it.

**That file does not exist.** `src/polysynth/` contains only `poly-params`,
`poly-preset-apply`, `poly-preset-store`, `poly-preset-templates` and
`polysynth-presets` (plus tests). The class was deleted with the worklet
cutover; `CLAUDE.md` is stale on this point and should be corrected when this
work lands. There is no dead code to remove.

What still carries the `PolySynth` name is **not** dead:

- **`PolySynthParams`** (`src/polysynth/poly-params.ts`) is the nested shape that
  USER presets are stored in. `loadUserPolyPresets` / `saveUserPolyPresets`
  serialize it straight into `localStorage`. The TypeScript type may be renamed;
  **the JSON shape and its key may not** — see the blacklist.
- `PolySynthPresetsDeps` and `wirePolyControls` are the live preset surface.
- The rest are comments explaining a branch that no longer runs. They can be
  reworded as part of section 5, since they are what makes the name confusing in
  the first place.

One loose end worth noting, not fixing here: `src/presets/preset-apply.test.ts`
still builds a fake engine with a `getPolySynth()` method to exercise a fallback
whose other branch no longer exists in production. It passes and it is harmless;
it is simply testing a shape nothing produces any more.

## 5 · Rename the "poly" inheritance

"poly" is a historical name. It does not mean polyphony and it does not refer to
any live synth: it is the id of **the instrument page** — the one page that
paints the controls of every non-drum lane (TB-303, Subtractive, FM, Wavetable,
Karplus, Westcoast, Sampler, Audio). There are only two pages, `poly` and
`drums`; the TB-303 used to have a third and it was deleted.

Renamed:

| From | To |
| --- | --- |
| `data-page="poly"` / `data-tab="poly"` | `instrument` |
| `activeLaneId` (`LaneEngineHostState`) | `instrumentPageLaneId` |
| `src/polysynth/` | `src/instrument-presets/` |
| `.poly-section`, `.poly-wave-sel` (SCSS) | `.instrument-section`, `.instrument-wave-sel` |
| 14 `#poly-*` ids in `index.html` | see below |

The 14 ids are a grab-bag and do **not** all belong to the instrument page:

- Instrument page: `poly-active-label`, `poly-engine-row`, `poly-fx-row`,
  `poly-preset-select`, `poly-preset-save`, `poly-preset-load`,
  `poly-preset-delete`, `poly-seq-mode-row`, `poly-tracks`, `poly-add-track`,
  `poly-target-select` → `instrument-*`.
- **MIDI import dialog**, nothing to do with the page: `poly-midi-file`,
  `poly-midi-load`, `poly-midi-tracklist` → `midi-import-file`,
  `midi-import-load`, `midi-import-tracklist`.

### Blacklist — never rename

- **`polyBlep`** — an oscillator anti-aliasing technique
  (`packages/loom-plugin-sdk/src/dsp/osc.ts`, `sync-osc.ts`). Renaming it
  corrupts the DSP.
- **`polyphony`** — a field of the **plugin manifest**, validated by
  `src/plugin-host/manifest-validate.ts` and present in every engine's
  `plugin.json`. It is part of the plugin ABI; renaming it breaks third-party
  plugins.
- **`POLY_PRESETS_KEY = 'tb303-poly-presets-v1'`**
  (`src/polysynth/poly-preset-store.ts`) — the `localStorage` key holding the
  user's saved presets, and the JSON shape stored under it. Changing either
  silently loses every preset the user has saved, and there are no migrations in
  this project. The `PolySynthParams` **type name** may be renamed; the key and
  the serialized shape may not.

A blind find-and-replace over "poly" hits 183 tracked files and would break both.
The rename is surgical, id by id.

### What this rename breaks

Tests that query the renamed ids by name: e2e (`engine-knobs`,
`preset-recovery`, `lane-ui`, `preset-on-load`, `sampler-*`) and a number of unit
tests. Mechanical, but the full suite has to pass — and `npm run build` must run
before `npm run test:e2e`, which serves `dist/` with no build step.

### `instrumentPageLaneId` keeps its current rule

Today `activeLaneId` is written in exactly one place —
`session-host-lane-editor.ts`, inside `if (targetTab === 'poly')` — so selecting
a drum lane deliberately leaves it pointing at the last melodic lane. That is
correct and must not change: the instrument page is not on screen for a drum
lane, and pointing it at one would (a) blank the engine dropdown, because
`drums-machine` is not among its options, (b) mount the instrument page's FX
panel under the drum lane's id, registering `drums-1.fx.*` knobs on a page that
lane does not use, (c) repopulate the melodic preset dropdown for a drum lane,
and (d) aim the engine-swap dropdown at the drum lane.

The rename makes the rule legible instead of implicit. The single writer moves
inside the `focusLane` funnel and states it out loud: *if the selected lane
routes to the instrument page it becomes that lane; if it routes to the drums
page it does not move.* No visible behaviour changes.

---

## Order of work

Four commits, in this order. The first three fix the bug; the rename comes
afterwards **on purpose** — if it turns ugly, the bug is already fixed and is not
held hostage by it.

1. One door: `focusLane` as the single funnel.
2. `clipToShowOnLaneSwitch` and the clip following the lane.
3. Mixer column selects; mute/solo in the clip editor header.
4. The "poly" → "instrument" rename, plus the `CLAUDE.md` correction about
   `polysynth.ts` (section 4).

There is no "delete the dead class" commit: the class is already gone.

## Acceptance criteria

The clip editor and the instrument controls **never** show different lanes. For
each entry point below, selecting lane B while lane A's clip is open leaves the
instrument page on B, and the clip editor either on B's clip in the same row or
closed:

- lane header click
- clip cell click
- mixer column background click
- APC Key 25 / MIDI
- undo/redo repaint

Plus the two teardown paths, which must keep closing both sides together:
deleting the selected lane, and loading a session that no longer contains it.

And the same-lane guarantee, which is the other half of the rule: an engine swap
on the lane whose clip is open must **not** close that clip editor.

Plus:

- Selecting a lane whose row has no clip closes the editor and **adds no clip to
  the session**.
- Clicking a fader, knob, mute, solo, insert slot or preset dropdown inside a
  mixer column does its own job and does **not** change the selected lane.
- Mute and solo in the clip editor header and in the mixer column agree in both
  directions.
- `polyBlep`, `polyphony` and `'tb303-poly-presets-v1'` are untouched after the
  rename, and a preset saved before it still loads after it.
- `npx tsc --noEmit` clean; `npm test` green after `npm run build`.

**One test per user path** — no `(or …)` alternatives, so a broken path cannot
hide behind a working one.

Selection coherence is a *visual* claim: before it is called done, the real
screen gets opened and looked at for each entry point above.
