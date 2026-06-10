# Remaining work

Audit of 2026-06-10 against the codebase (refreshes the 2026-05-31 audit).
Implemented design docs are removed from the tree per convention — recover them
from git history. What stays below is the **outstanding** work only.

## Open fronts (docs still in the tree)

- **Frente C — Editores de clips** ([plan](plans/2026-06-06-editores-clips-plan.md),
  [spec](specs/2026-06-06-editores-clips-design.md)). Parts shipped via the editors
  overhaul (variable-kit rows, clip-loop brace); the rest of the plan is unverified —
  re-audit against the code before executing.
- **Frente E — Mixer / master** ([plan](plans/2026-06-06-mixer-master-plan.md),
  [spec](specs/2026-06-06-mixer-master-design.md)). Master strip exists in the session
  mixer row, but the plan's full scope (master FX surface, VU hygiene) is unfinished.
- **Sampler — decisiones pendientes (Parte B)**
  ([plan](plans/2026-06-07-sampler-frontd-gaps.md)). Parte A shipped (the channel
  redesign + the loop-preset fix); B1/B2/B3 need user decisions + brainstorming.
- **Sampler — per-pad LFO/ADSR (Plan A2)**
  ([spec](specs/2026-06-04-sampler-per-pad-modulation-design.md)). Needs trigger-time
  modulator binding; per-pad params shipped without modulation.
- **Audio channel — dirección** ([plan](plans/2026-06-05-audio-channel.md),
  [spec](specs/2026-06-05-audio-channel-design.md)). Core shipped (audio engine,
  waveform editor, warp toolbar); the "✂ Slice → pads" path was deliberately
  reverted in favour of Sampler-side slicing. The remaining direction (one-shot
  WSOLA mode vs sliced→bank) is an open product decision.
- **Programa 5-frentes** ([overview](specs/2026-06-06-loom-ux-overhaul-overview.md),
  [coordinación](specs/2026-06-06-coordinacion-frentes.md),
  [review findings](specs/2026-06-06-loom-review-findings.md)). Frentes A/B/D done
  and pruned; these stay as the index + bug backlog for C/E.
- **LoomN (C++/JUCE)** ([spec](specs/2026-06-01-cpp-juce-migration-design.md),
  [plan](plans/2026-06-01-loomn-foundation-core-model.md)). Cross-repo: Phase 1 done;
  work continues in the `LoomN` repo. Kept here deliberately as the reference copy.

## Low — minor, isolated

- **Preset selectors not automatable.** `#bass-preset-select` / `#poly-preset-select` /
  `#drums-preset-select` are plain `<select>`s, not wrapped in `createSelectControl`
  nor registered under a `<laneId>.preset` automation id (modular-modulators Task 19
  leftover).
- **Swing slider not wired to the scheduler** (documented as such in the manual,
  ch. Transporte).

## Closed since the 2026-05-31 audit (recorded; nothing to do)

- Performance takes surface + persist (was the only High item).
- `seq.pattern` substrate fully removed — only a historical comment remains
  ([src/session/clip-automation-lanes.ts](../../src/session/clip-automation-lanes.ts)).
  `session-migration.ts` survives as the load-time normaliser by design.
