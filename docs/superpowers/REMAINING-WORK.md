# Remaining work

Audit refreshed 2026-07-18. **No outstanding design work.** Every spec, plan and
mockup that lived here has been implemented and pruned from the tree per
convention — recover any of them from git history if you need the rationale
(`git log --diff-filter=D --name-only -- docs/superpowers/`).

Shipped and pruned in this pass: the AudioWorklet engine rewrite (spec + 5 phase
plans), GM Percussion kit, drums/sampler channel filter, FM layout + musicality,
MIDI live-record, computer-keyboard-as-MIDI, transport hotkeys, REC count-in,
desktop menu chrome, session-view reorder, breakbeat/big-beat examples, the
audio channel, and the sampler per-pad modulation spec — along with the sampler
and compact-insert-FX mockups.

## Known code debts (not feature work, tracked nowhere else)

Small, isolated, and verified against the code at some point — kept here only so
they are not silently forgotten. Verify against the code before acting.

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
- **Preset selectors are not automatable.** The per-lane preset `<select>`s are
  plain elements — not wrapped in `createSelectControl`, not registered under a
  `<laneId>.preset` automation id — so a preset change cannot be automated or
  recorded like every other control.

## Reference (kept deliberately — not a backlog)

- **Promotion research 2026-07-15** ([report](../promo-research-2026-07-15.md)):
  not feature work, but it carries the launch-gate repo/licensing items (sample
  credits, licence notice + Strudel credit in the shipped `index.html`, README
  kit counts). Read its §0 first: only 5 of its 13 research angles were ever
  fact-checked, so verify each item before acting.
