# Remaining work

Audit refreshed 2026-08-06. **WEAVE section re-audited 2026-08-22** — see below,
it had gone stale in the direction that costs the most.

The `specs/` and `plans/` directories were pruned on 2026-08-06 and have filled
up again since. The one draft that is still live —
`specs/2026-07-26-architecture-symmetry-master-plan.md` — is pending review, not
obsolete, and stays where it is. **Every other document in those two directories
describes a round that has since shipped and merged**, and by this repo's own
convention they should be pruned; the rationale is recoverable from git history:
`git log --diff-filter=D --name-only -- docs/superpowers/`.

Left in place rather than deleted, because deletion is the user's call and
because `CLAUDE.md` also says an approved mockup is a committed artifact — and
two of these are mockups whose specs would go with them. The list, so the next
person is deciding rather than surveying: the three **inserts-as-plugins**
documents, **lane-selection-coherence** (design + plan), **scene-countdown-ring**
(design + plan + mockup), **weave-panel-dinamico** (design + plan + mockup),
**weave-evolution-and-debts** (spec + plan), **lane-roles** (design + plan),
**progression-editor** (plan), **layers-per-slot-modulation** (design),
**weave-transport-locks-and-print**, **auto-accompaniment**,
**harmony-that-moves**, and **follower-lane-accompaniment** (design + plan).

## WEAVE — re-audited 2026-08-22, and it had gone stale in the worst direction

**Every one of the three slices this section called "deliberately unfinished" has
shipped.** Checked against the code, not remembered:

- *"The weave state does not persist."* It does: `SavedStateV3.weave`, written
  through `getWeave`/`setWeave` and deep-cloned on save because the live weave
  keeps moving. A save with no weave clears the live one.
- *"The lane pads are drawn but not bound."* They are bound — `weave-wiring`
  builds each lane's `LaneWeaveConfig` from the row.
- *"`Print to scene` is a button with no handler."* `printWeaveScene` exists and
  is wired from `main.ts` through `performance-feature` to the panel, inside
  `withUndo`.

It also said **six macros**. There are four: Space and Motion were removed
because they were the only two that moved parameters rather than notes.

A backlog that lists finished work as open is worse than no backlog: the next
reader implements something that already exists, and stops trusting the file
that told them to. Re-verify this section against the code before acting on it,
which is what this whole document asks for and what nobody did here.

### What is actually open

- **A scene does not choose what a weaving lane plays.** With loops chosen,
  `weave-wiring`'s `build` reads the SELECTION and nothing else, so launching a
  scene decides only *whether* that lane sounds, never *what* — every scene
  sounds the same on it, a scene of empty clips included, and a scene written by
  PRINT plays the weave rather than the print. Known, reported by the user, and
  **not yet decided**: the fix is a design question about what a scene MEANS on a
  weaving lane, not a bug to patch. Documented as a known limitation in the
  manual so a user meets it as a decision rather than a fault.

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

  Two symptoms are now **closed**, both by removing the divergence rather than
  patching the exporter:
  - *Channel filter was live-only* → `ChannelFilter` deleted outright; filtering
    a drums/sampler lane is a `multifilter` insert like every other lane, and
    inserts already export.
  - *Shared-param modulation was unbound offline* → binding moved into the lane
    allocator, which the live host and the exporter **share**, so the exporter
    gained it without being touched. (It also turned out that the six melodic
    engines never bound those destinations **live** either — the panel offered
    FX destinations that were connected to nothing.)

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

## Reference (kept deliberately — not a backlog)

- **Promotion research 2026-07-15** ([report](../promo-research-2026-07-15.md)):
  not feature work. Its three launch-gate repo/licensing items have all landed —
  `index.html` carries the AGPL notice and source link in the header plus a
  "Licence & source" block in the About dialog crediting Strudel's `dough.mjs`,
  `package.json` declares `"license": "AGPL-3.0-or-later"`, and README.md has a
  "Credits — sample sources" section with the counts (68 sample kits, 486 audio
  files, 64 tidal-derived, 3 hand-curated, `gm-percussion` CC0).

  What stays open is the **sample-rights debt itself**: most of the bundled audio
  remains uncleared, the upstream collections state no licence, and the Amen
  Break loop is explicitly not cleared. Both the README and the About dialog now
  say so plainly, which is disclosure, not clearance.

  Read the report's §0 before using any of the rest of it: only 5 of its 13
  research angles were ever fact-checked.
