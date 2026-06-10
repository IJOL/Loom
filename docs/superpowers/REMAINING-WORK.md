# Remaining work

Audit of 2026-06-10 against the codebase (refreshes the 2026-05-31 audit; corrected
same day — the C/E fronts of the 2026-06-06 program turned out SHIPPED, their docs
pruned). Implemented design docs are removed from the tree per convention — recover
them from git history. What stays below is the **outstanding** work only.

## Needs a user decision first (do NOT implement blind)

- **Sampler — Parte B** ([plan](plans/2026-06-07-sampler-frontd-gaps.md)):
  B1 per-zone knobs vs the clean mockup (expander / always / selected-zone panel —
  current code uses the selected-zone panel); B2 waveform clip editor with draggable
  trim + Loop/Tema toggle + BPM fields; B3 audio-lane trim/warp UI + multi-zone
  auto-spread on multi-sample import.
- **Audio channel — dirección** ([plan](plans/2026-06-05-audio-channel.md),
  [spec](specs/2026-06-05-audio-channel-design.md)): core shipped (audio engine,
  waveform editor, warp toolbar); "✂ Slice → pads" was deliberately reverted. The
  remaining one-shot-WSOLA vs sliced→bank direction is an open product decision.

## Feature work with a spec, ready to plan

- **Sampler per-pad LFO/ADSR (Plan A2)**
  ([spec](specs/2026-06-04-sampler-per-pad-modulation-design.md)): per-pad params
  shipped without modulation; needs trigger-time modulator binding.

## Low — minor, isolated

- **Preset selectors not automatable.** `#bass-preset-select` / `#poly-preset-select` /
  `#drums-preset-select` are plain `<select>`s, not wrapped in `createSelectControl`
  nor registered under a `<laneId>.preset` automation id (modular-modulators Task 19
  leftover).
- **Swing slider not wired to the scheduler** (documented as such in the manual).

## Reference (kept deliberately)

- **Review findings 2026-06-06** ([spec](specs/2026-06-06-loom-review-findings.md)):
  adversarial-review backlog from the five-front program; most items were addressed
  by the fronts — verify any item against the code before acting on it.
- **LoomN (C++/JUCE)** ([spec](specs/2026-06-01-cpp-juce-migration-design.md),
  [plan](plans/2026-06-01-loomn-foundation-core-model.md)): cross-repo reference
  copies; Phase 1 done, work continues in the `LoomN` repo.

## Closed since the 2026-05-31 audit (recorded; nothing to do)

- Performance takes surface + persist (was the only High item).
- The whole 2026-06-06 five-front UX program (A header/transport, B session
  management, C/E editors declutter + master strip, D sampler families) — all
  merged; docs pruned 2026-06-10.
- `seq.pattern` substrate fully removed — only a historical comment remains.
  `session-migration.ts` survives as the load-time normaliser by design.
