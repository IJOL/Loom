# Remaining work

Audit refreshed 2026-06-10 (evening) against the codebase. Implemented design docs
are removed from the tree per convention — recover them from git history. What stays
below is the **outstanding** work only.

## Needs a user decision first (do NOT implement blind)

- **Audio channel — dirección** ([plan](plans/2026-06-05-audio-channel.md),
  [spec](specs/2026-06-05-audio-channel-design.md)): core shipped (audio engine,
  waveform header, warp toggle); "✂ Slice → pads" was deliberately reverted. Open:
  the one-shot-WSOLA vs sliced→bank default direction, **plus** the audio-lane's own
  trim/warp UI and multi-zone auto-spread on multi-sample import (the old Sampler
  "Parte B3" — the only piece of that plan not yet built).

## Feature work with a spec, ready to plan

- **Sampler per-pad LFO/ADSR (Plan A2)**
  ([spec](specs/2026-06-04-sampler-per-pad-modulation-design.md)): per-pad params
  shipped without modulation; needs trigger-time modulator binding (destinations must
  be `zone<note>.<leaf>`, not GM `<voice>.<leaf>`).

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

- **Sampler — Parte B (editable waveform) — DONE 2026-06-10** (`8edac81..6564df9`):
  draggable trim + loop handles + clickable loop badge in the per-pad "Selected
  sample" viewer, wired to the per-pad store, trigger plays the trimmed window +
  `[loopStart,loopEnd]`. B1 (per-zone knob placement) is settled by the shipped
  selected-zone panel. Only B3 (audio-lane trim/warp + multi-zone auto-spread)
  remains, folded into the audio-channel item above. (Spec/plan pruned per
  convention; the approved mockup stays in `mockups/`.)
- Performance takes surface + persist (was the only High item).
- The whole 2026-06-06 five-front UX program (A header/transport, B session
  management, C/E editors declutter + master strip, D sampler families) — all
  merged; docs pruned 2026-06-10.
- `seq.pattern` substrate fully removed — only a historical comment remains.
  `session-migration.ts` survives as the load-time normaliser by design.
