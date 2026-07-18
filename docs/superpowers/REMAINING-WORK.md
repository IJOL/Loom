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

- **Channel filter is live-only — not applied in the offline export.** The drums/
  sampler channel filter (cutoff + resonance) is a live Web-Audio `BiquadFilter`
  built in the engines' `ensureWired`/`ensureNode`. The offline scene/WAV render
  path (`export/kernel-lane-render.ts` and the pure renderers) never instantiates
  `ChannelFilter`, so a scene with a dialed-in filter **exports brighter than it
  plays**. Part of the standing "offline render ≠ live" debt.
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
