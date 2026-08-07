# Remaining work

Audit refreshed 2026-08-06.

The `specs/` and `plans/` directories were pruned today. Every document that
remained described work already shipped and merged; none were genuine backlogs.
The one draft that is still live — `specs/2026-07-26-architecture-symmetry-master-plan.md`
— is pending review, not obsolete, and stays where it is.

Recover the rationale for any shipped round from git history:
`git log --diff-filter=D --name-only -- docs/superpowers/`.

## WEAVE — what shipped and what did not

The dynamic panel is in: the pure crossfade core, the three topologies, the six
macros, the minimal harmony rule, the clip-length tools, the step painter, the
`panel` plugin kind and the panel itself as a third view. Spec and plan are in
`specs/2026-08-07-weave-panel-dinamico-design.md` and
`plans/2026-08-07-weave-panel-dinamico.md`; read the plan's **amendment at the
top** before its tasks 5–8, which describe an approach that was built and then
reverted.

Three slices are deliberately unfinished rather than faked:

- **The weave state does not persist.** It lives in `performance-feature.ts`
  rather than in `SessionState`, so it neither saves nor undoes. Its real home
  is the session, and putting it there is the next slice — a module variable
  somewhere less visible would have hidden the gap.
- **The lane pads are drawn but not bound.** Each lane row shows a weaving
  control; moving it does not yet drive that lane's `LaneWeaveConfig`, and the
  gate is not yet handed to the scheduler per lane. Everything underneath is
  written and tested (`createWeaveGate`, `laneWeights`, `blendLoops`) — what is
  missing is the wiring, not the machinery.
- **`Print to scene` is a button with no handler.** `printWeaveScene` from the
  plan was not written; the spec's §6 still describes what it must do, including
  the test that the printed scene plays back what was heard.

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
