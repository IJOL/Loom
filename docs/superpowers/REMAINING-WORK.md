# Remaining work

Audit refreshed 2026-07-26.

The 2026-07-18 pass emptied this directory and recorded "no outstanding design
work". That is no longer true: **nine spec and plan documents live here again**,
all committed after that date. One of them is genuine outstanding design work;
the rest describe work that has shipped but was never marked as such.

## What is in this directory

**Approved, planned, and shipped — but every task checkbox is still unticked.**
Three spec/plan pairs whose features are demonstrably in the tree, while their
plans read as untouched backlogs (0 of 25, 0 of 85 and 0 of 53 tasks ticked
respectively). Tick them or prune them; leaving an all-unchecked list of finished
work is the most misleading state they can be in.

- `specs/2026-07-19-menu-contextual-automatizacion-design.md` +
  `plans/2026-07-19-menu-contextual-automatizacion.md` — shipped as
  `src/automation/knob-automation-menu.ts` and `src/app/knob-menu-wiring.ts`.
- `specs/2026-07-19-registro-destinos-automatizacion-design.md` +
  `plans/2026-07-19-registro-destinos-automatizacion.md` — shipped as
  `src/automation/destination-registry.ts`; the rule it established is written up
  in [docs/automation-destinations.md](../automation-destinations.md).
- `specs/2026-07-21-destinos-multi-strip-labels-design.md` +
  `plans/2026-07-21-multi-strip-destination-labels.md` — shipped as
  `subGroupFor` / `dynamicParamsFor` on `SynthEngine`, covered by
  `src/automation/automation-targets-multistrip.test.ts`.

**Shipped, but the header never caught up.**

- `specs/2026-07-25-clip-axis-automation-lanefx.md` still reads "PENDIENTE DE
  APROBACIÓN". Its requirements are in the tree: `src/core/clip-axis.ts` owns the
  shared zoom/scroll, `src/automation/automation-lfo.ts` is the LFO curve
  generator, and the per-lane COMP/SC section and the px-level alignment landed
  in the commits leading up to this audit.
- `specs/2026-07-25-duplicated-solutions-audit.md` records five "N solutions to
  one problem" concerns. All five collapses have landed, so this one is prunable
  on the owner's word.
- `specs/2026-07-19-mixer-automatizable-design.md` shipped on 2026-07-26 — the
  lane mixer's seven controls are destinations, the fader included. Its **decision
  2 was overridden in the process**: the ids are `<lane>.bus.<param>`, reusing the
  vocabulary `drums-machine` already had for exactly these seven params, not the
  new `<lane>.mix.<param>` the spec prescribed. The spec predates drums having
  them, and a second id family for one set of nodes is the duplication the audit
  above exists to stop. The rationale now lives where the code is,
  `src/core/channel-strip-params.ts`.

Everything else that once lived here was implemented and pruned per convention —
recover the rationale from git history
(`git log --diff-filter=D --name-only -- docs/superpowers/`). That pass covered
the AudioWorklet engine rewrite (spec + 5 phase plans), GM Percussion kit,
drums/sampler channel filter, FM layout + musicality, MIDI live-record,
computer-keyboard-as-MIDI, transport hotkeys, REC count-in, desktop menu chrome,
session-view reorder, breakbeat/big-beat examples, the audio channel, and the
sampler per-pad modulation spec — along with the sampler and compact-insert-FX
mockups.

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
