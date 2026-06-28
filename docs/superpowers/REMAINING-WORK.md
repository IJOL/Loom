# Remaining work

Audit refreshed 2026-06-19 against the codebase. Implemented design docs
are removed from the tree per convention — recover them from git history. What stays
below is the **outstanding** work only. A feature's **mockup is archived together with
its spec and plan**: once both are pruned, the mockup is removed too (recover from git);
only a mockup whose spec is still outstanding stays under `mockups/`.

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

- **Drums/sampler channel filter is live-only — not in offline export.** The channel
  filter (cutoff + resonance, shipped 2026-06-28) is a live Web-Audio `BiquadFilter`
  built in the engines' `ensureWired`/`ensureNode`. The offline scene/WAV render path
  (`export/kernel-lane-render.ts`, the pure `DrumVoiceManager` / sampler renderer) never
  instantiates `ChannelFilter`, so a scene with a dialed-in channel filter **exports
  brighter/unfiltered** than it plays. Matches the standing "offline render ≠ live" debt
  ([memory](project_offline_render_preset_fix.md)). The design spec listed this as risk #3;
  the verifying test was deferred. A future export-fidelity pass should apply the same
  lowpass (cutoff→Hz, resonance→Q) in the offline drum/sampler renderers.
- **Preset selectors not automatable.** `#bass-preset-select` / `#poly-preset-select` /
  `#drums-preset-select` are plain `<select>`s, not wrapped in `createSelectControl`
  nor registered under a `<laneId>.preset` automation id (modular-modulators Task 19
  leftover).
- **Swing slider not wired to the scheduler** (documented as such in the manual).

## Reference (kept deliberately)

- **Review findings 2026-06-06** ([spec](specs/2026-06-06-loom-review-findings.md)):
  adversarial-review backlog from the five-front program; most items were addressed
  by the fronts — verify any item against the code before acting on it.
  *(The LoomN C++/JUCE migration spec + plan were cross-repo reference copies; removed
  from this tree 2026-06-19 — they live in the `LoomN` repo. Recover from git if needed.)*

## Closed since the 2026-06-10 audit (docs pruned 2026-06-19)

All merged to main and pushed; spec+plan (+ any mockup) removed from the tree,
recoverable from git history:

- Stems as audio lanes; audio-lane editor; audio-warp engine; audio-warp marker editor.
- West Coast engine; musicality assist (Spec 1).
- Clip context breadcrumb; clip tempo *2//2; duplicate lanes/scenes + capture; universal undo.
- Clip zoom + viewport-anchored loop + Follow; loop-region MOVE (drag interior); performance
  diagnostics (PERF HUD); scene/clip launch loop-sync.
- **Unified FX + Send A/B** (`31b760f`): generic Send A/B return buses (seeded A=delay,
  B=reverb) replacing the fixed REV/DLY sends; reverb/delay demoted to ordinary inserts;
  insertable Compressor + Limiter; one picker for every rack (lane/audio/send/master); delay
  BPM-sync as an insert param; insert params are Performance-automation destinations; dead
  FilterChain/MasterFilter removed.

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
