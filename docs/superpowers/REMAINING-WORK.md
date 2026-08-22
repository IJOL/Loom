# Remaining work

Swept 2026-08-22. **Everything in this file is open.** Anything that shipped has
moved to [`archive/`](archive/) — read those as history, never as instructions.

Two things still sit outside the archive: this file, and
`specs/2026-07-26-architecture-symmetry-master-plan.md`, which is pending review
rather than obsolete.

Every item below was re-verified against the code on 2026-08-22 — but verify
again before acting. That is what this list is for, and the WEAVE section below
is what happens when nobody does.

## WEAVE — a scene does not choose what a weaving lane plays

With loops chosen, `weave-wiring`'s `build` reads the SELECTION and nothing
else, so launching a scene decides only *whether* that lane sounds, never
*what*. Every scene sounds the same on it, a scene of empty clips included — and
a scene written by PRINT plays the weave rather than the print.

Reported by the user and **not yet decided**. It is a design question about what
a scene MEANS on a weaving lane, not a bug to patch, which is why it is here
rather than fixed. Carried in the manual as a known limitation so a user meets
it as a decision rather than a fault.

> This section used to list three more slices as unfinished — the weave not
> persisting, the lane pads not bound, PRINT having no handler. All three had
> shipped, and the file went on saying otherwise until 2026-08-22. A backlog
> that lists finished work as open is worse than no backlog: the next reader
> builds something that exists, and then stops trusting the file that sent them.
> Verify against the code before acting on anything below.

## Which preset a lane is on has three answers and no owner

Found while wiring WEAVE's preset dropdown, and worth fixing on its own: there
is no single way to ask "what preset is this lane on". There are three, and they
disagree.

| Where | Written by | Survives a reload |
|---|---|---|
| `lane.enginePresetName` | ONLY engine-swap (which clears it), the drum-kit picker and the MIDI importer | yes |
| `pagePresetName` (module `Map` in `instrument-presets/preset-select-state.ts`) | `recordPagePresetForLane`, from the live dropdown | **no** — module state |
| `lane.engineState.params` | `commitEngineBaseValues` | yes, but it is the SOUND, not the label |

So a melodic lane's recalled sound survives a reload while its NAME does not,
and `engine-param-commit.ts` says as much out loud: *"`enginePresetName` is set
only by engine-swap, the drum-kit picker and the MIDI importer, never by the
live preset picker."* A drums lane behaves differently from a subtractive one
for no reason a user could infer.

WEAVE reads `pagePresetName` first and falls back to `enginePresetName` —
deliberately NOT a fourth answer. The real fix is to give the question one
owner, which means touching the preset vocabulary across drums, sampler and
melodic together; that is a round of its own, not a line in this one.

## Known code debts (not feature work, tracked nowhere else)

Small, isolated, and kept here only so they are not silently forgotten. All
three were re-verified against the code on 2026-07-26 and are still open — but
verify again before acting; that is what this list is for.

- **The offline render is not yet faithful to the live path.** This is the
  standing "offline render ≠ live" debt, and it should be closed as a whole
  rather than one symptom at a time: **whatever you hear is what must be
  exported**. Every drift found so far has the same shape — a node or a runtime
  the live host builds and the offline graph silently omits.

  Confirmed present offline (verified 2026-07-18): engine presets and
  `engineState`, per-lane and master insert chains, `ChannelStrip`, the sidechain
  bus, clip automation, note-FX, worklet registration, and `ModulationRuntime`
  for melodic lanes (`export/kernel-lane-render.ts:64`).

  **Still open: there is no parity test.** Both drifts were found by reading the
  code, not by a failing test, and that is the actual debt — the next node the
  exporter forgets will be found the same slow way. The durable fix is to render
  a scene offline, capture the same scene live, and assert the two match.
- **Performance measures a multi-tempo song in seconds but labels it in
  constant-bpm bars.** `arrangementFromSession` sizes each section with
  `clipLoopSec`, which integrates a clip's `tempoMap` — so an imported
  multi-tempo MIDI gets sections whose SECONDS match what the scheduler actually
  plays (that is the fix; see `arrangement-from-session.ts`). One constant bar
  length is then used to relate those seconds to bar numbers, in both
  directions: `effectiveDurationSec` sizes the timeline by multiplying the
  user's `lengthBars` by `songBarSec(state.bpm, meter)`, and its two readers —
  the Performance ruler (`performance-ui.ts`) and the length field
  (`performance-ui-templates.ts`) — divide the result back by that same
  `songBarSec`. On tempo-mapped material the two disagree: a section boundary falls
  part-way between two drawn bar lines, and the bar number under it is not the
  bar the music is in.

  It cannot be closed where it shows. `ArrangementState` carries `bpm` and takes
  the meter as an argument (deliberately — a stored meter was a stale cache), but
  it has no tempo map, and neither does the ruler, so there is nothing to
  integrate against. Closing it means deciding where a song-level tempo map
  lives and letting the ruler read it — a data-model change, not a view fix.
  Pinned as current behaviour in `arrangement-from-session.test.ts` ("KNOWN DEBT:
  a tempo-mapped section does not land on a ruler bar line") so the next reader
  meets it as a decision rather than a mystery.
- **Preset selectors are not automatable.** The per-lane preset `<select>`s are
  plain elements — not wrapped in `createSelectControl`, not registered under a
  `<laneId>.preset` automation id — so a preset change cannot be automated or
  recorded like every other control.

## Sample rights — open, and disclosure is not clearance

Most of the bundled audio is uncleared: the upstream collections state no
licence, and the Amen Break loop is explicitly not cleared. README.md and the
About dialog both say so plainly, which is honest and is not permission.

The launch-gate items from the 2026-07-15 promotion research have all landed —
the AGPL notice and source link, the licence declaration, the credits section
with its counts — so that report is now
[reference](../promo-research-2026-07-15.md) rather than work. Read its §0
first: only 5 of its 13 research angles were ever fact-checked.
