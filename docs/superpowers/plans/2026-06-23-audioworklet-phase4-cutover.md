# AudioWorklet Phase 4 — Single Cutover (delete the legacy node-per-note layer)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **DO NOT START until Phases 1, 2, 2b, 3 are merged AND every engine is verified audibly through the worklet.** This phase deletes the old path; if any engine still relies on it, the app breaks. It is the spec's "single cutover".
>
> **RECONCILE FIRST.** Verify the worklet engines/registry against the real Phases 1–3 implementation before deleting anything.

**Goal:** Remove the now-dead node-per-note synthesis layer and the per-note modulation-binding machinery, leaving the worklet engines as the only synthesis path. Keep all DATA (presets, kits, param specs, keymaps, wavetable/fold/Karplus DSP now living in `src/audio-dsp/`) and the mixer/FX/master (Web Audio).

**Architecture:** A series of deletion + rewire steps, each ending with a green build + full unit suite + a smoke check, so a regression is caught at the step that caused it. Order: (1) repoint the registry/allocator so NOTHING constructs a legacy engine, (2) delete legacy engine classes + voices, (3) delete the per-note modulation binding machinery, (4) delete the legacy shared DSP (`core/synth.ts`, `core/drums.ts` DSP, `audio-clip-voice.ts`), (5) prune dead tests + dead helpers, (6) final verification.

**Tech Stack:** No new code (a few small rewires). Mostly deletions + test pruning.

## Global Constraints

- **Green gate after every step.** `npx tsc --noEmit` + `NO_COLOR=1 npm run test:unit` must pass after each task before the next. A red step is reverted/fixed before proceeding — never deleted-through.
- **Keep DATA + main-thread helpers the worklet engines use:** `EngineParamSpec` arrays (or their extracted `*-params.ts`), `public/presets/*.json` + `preset-loader`, `KITS`/`seedSynthState`/`chokeGroupMates` (drums data), `GM_DRUM_MAP`, `samples/keymap.ts`/`repitchRate`/`samplePlaybackWindow`/warp+stretch caches, `sample-cache`/`sample-store`, the wavetable harmonic data, `westcoast-fold` data, `renderKarplusString` (now in `audio-dsp/karplus-renderer.ts`), `ModulatorState` types + `ModulationHostImpl` STATE + the modulators UI panel (it edits state the worklet engines serialize to `ModLite`).
- **Keep the mixer/FX/master entirely** (Web Audio): `ChannelStrip`, `FxBus`, `MasterBusStrip`, `MasterCompressor`, soft-clip, sidechain, `InsertChain`.
- **Delete only what is dead.** Before deleting a symbol, grep for remaining references (`Grep`); if a non-test, non-legacy file still imports it, that's a missed rewire — fix it first.
- **UI English; one commit per task.**

---

## Inventory — what gets deleted vs kept

**DELETE (legacy synthesis path):**
- Legacy engine classes + their `Voice` inner classes: `SubtractiveEngine`+`SubtractiveVoice` (`src/engines/subtractive.ts`), `TB303Engine` (`src/engines/tb303.ts`) + `TB303` (`src/core/synth.ts`), `FMEngine`+`FMVoice` (`src/engines/fm.ts`), `KarplusEngine`+`KarplusVoice` (`src/engines/karplus.ts`), `WavetableEngine`+`WavetableVoice` (`src/engines/wavetable.ts`), `WestEngine`+`WestVoice` (`src/engines/westcoast.ts`), `DrumsEngine`+`DrumsVoice` (`src/engines/drums-engine.ts`) + `DrumMachine` DSP (`src/core/drums.ts`), `SamplerEngine`+`SamplerVoice` (`src/engines/sampler.ts`), `AudioEngine`+`AudioVoice` (`src/engines/audio.ts`), `audio-clip-voice.ts` (`playAudioClip`), `PolySynth` (`src/polysynth/polysynth.ts`).
- Per-note modulation binding: `src/modulation/voice-mod-binding.ts`, `src/modulation/connection-binder.ts`, `src/modulation/adsr-voice.ts`, the LFO ConstantSource voice + `ModulationHostImpl.spawnVoice/spawnVoiceFiltered`, `src/modulation/active-mods.ts` (`recordVoiceMods`/`getCurrentLaneForVoice`/`getActiveModVoice` + the rAF poll that reads `currentValue()`).
- The Phase-0 per-note leak-cleanup code (it lived inside the deleted voices) and `pending-base-values.ts` if only the legacy engines used it (grep first).

**KEEP:** the worklet engines (`worklet-lane-engine.ts`, `drums-worklet-engine.ts`, `sampler-worklet-engine.ts`, `audio-worklet-engine.ts`), the whole `src/audio-dsp/` + `src/audio-worklet/` kernel, all DATA + main-thread helpers listed in Global Constraints, the mixer/FX/master, the session/clip/scene model, scheduler, note-FX, save/load, undo, the modulators UI panel + `ModulatorState`.

---

## Task 1: Repoint the registry + allocator to worklet engines only

Make the engine registry + lane allocator construct ONLY worklet engines, so nothing instantiates a legacy class. After this, the legacy classes are dead code (unreferenced) — safe to delete in Task 2.

**Files:**
- Modify: `src/engines/registry.ts` (factories), each engine file's `registerEngineFactory(...)` call site, `src/app/lane-allocator.ts`.
- Test: existing registry-boot + allocator tests (update expectations).

- [ ] **Step 1: Grep the construction sites**

Run `Grep` for `new SubtractiveEngine|new FMEngine|new KarplusEngine|new WavetableEngine|new WestEngine|new DrumsEngine|new SamplerEngine|new AudioEngine|new TB303Engine|registerEngineFactory` to enumerate every place a legacy engine is built.

- [ ] **Step 2: Point every factory at the worklet engine**

For each engineId, `registerEngineFactory(id, () => new <Worklet>Engine(...))`. The melodic five + subtractive use `WorkletLaneEngine` (param spec from the extracted `*-params.ts`); `drums-machine` → `DrumsWorkletEngine`; `sampler` → `SamplerWorkletEngine`; `audio` → `AudioWorkletEngine`. The allocator's `createLaneEngine` already routes these (Phases 1–3); remove its fallback to `createEngineInstance` for the legacy melodic path. The factory needs an `AudioContext`/output, which `registerEngineFactory` doesn't provide — so the registry returns a lightweight metadata descriptor (id/name/params/presets) for non-audio callers (engine selector UI) and the allocator builds the real worklet engine with the ctx. Split: a `getEngineDescriptor(id)` (data only) for UI vs `createLaneEngine(id, …)` (audio) in the allocator. Update `engine-selector-ui.ts` to use the descriptor.

- [ ] **Step 3: Run the green gate**

`npx tsc --noEmit` + `NO_COLOR=1 npm run test:unit`. Fix any test that constructed a legacy engine directly (repoint to the worklet engine or a descriptor). The legacy engine classes are now unreferenced by production code (confirm with `Grep` — only their own file + tests reference them).

- [ ] **Step 4: Commit**

```bash
git add src/engines/registry.ts src/app/lane-allocator.ts src/engines/engine-selector-ui.ts src/engines/*.ts
git commit -m "refactor(engines): registry + allocator construct worklet engines only"
```

---

## Task 2: Delete the legacy engine classes + voices

Now that nothing constructs them, delete the legacy classes — but PRESERVE each engine file's exported DATA the worklet path imports (`*_PARAMS`/`*-params.ts`, the modHost default `ModulatorState[]`, `registerEngine` for the descriptor). For Karplus, `renderKarplusString` already moved to `audio-dsp/` (Phase 2 Task 4) — delete the local copy. The Westcoast fold curve + wavetable tables similarly stay as data modules.

**Files:** `src/engines/{subtractive,tb303,fm,karplus,wavetable,westcoast,drums-engine,sampler,audio}.ts`, `src/core/synth.ts`, `src/core/drums.ts`, `src/engines/audio-clip-voice.ts`, `src/polysynth/polysynth.ts`.

- [ ] **Step 1: For each engine file, delete the `class …Voice` + the live-DSP parts of `class …Engine`**, keeping: the `EngineParamSpec[]` export, the default `ModulatorState[]` (move to a tiny `*-modulators.ts` data module if it was inline), and a `registerEngine`/descriptor registration so `getEngineDescriptor` still returns id/name/params/presets. If a whole file becomes pure data, rename mentally to "<engine> data" (no file rename required).

- [ ] **Step 2: Delete `src/core/synth.ts` (`TB303`)**, `src/polysynth/polysynth.ts` (`PolySynth`), `src/engines/audio-clip-voice.ts` (`playAudioClip` — replaced by `audio-clip-renderer.ts`; move `OUTPUT_TRIM` to a shared `audio-dsp` const if still imported). Delete the `DrumMachine` class from `src/core/drums.ts` but keep `KITS`/`BY_ID`/`seedSynthState`/`chokeGroupMates`/`DRUM_LANES`/`listDrumKits`/`DrumVoice` type (data the worklet drums engine uses).

- [ ] **Step 3: Grep for stragglers** — `Grep` each deleted symbol name; rewire/remove any remaining import (e.g. `applyLaneEngineState`, offline-render, save/load, demos). Offline render (`scene-export`/`offline-render`) must now drive the worklet engines (or render through the kernel renderers directly — note this; if offline rendering can't host an AudioWorklet, render via the pure `audio-dsp` renderers into an `OfflineAudioContext` buffer). Flag this as a sub-task if offline render breaks.

- [ ] **Step 4: Green gate** — `npx tsc --noEmit` + `NO_COLOR=1 npm run test:unit`. Delete or repoint legacy `*.dsp.test.ts` (they rendered the old engines through `OfflineAudioContext`) → the equivalent coverage now lives in the `audio-dsp/*-renderer.test.ts` kernel tests, so remove the obsolete DSP tests rather than letting them fail.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(engines): delete legacy node-per-note engine classes + voices"
```

---

## Task 3: Delete the per-note modulation binding machinery

The worklet engines send `ModLite[]` to the worklet (modulation runs per-sample inside it), so the ConstantSource/binder layer is dead.

**Files:** `src/modulation/voice-mod-binding.ts`, `src/modulation/connection-binder.ts`, `src/modulation/adsr-voice.ts`, the LFO voice file, `src/modulation/active-mods.ts`, and `ModulationHostImpl.spawnVoice`/`spawnVoiceFiltered` in `src/modulation/modulation-host.ts`.

- [ ] **Step 1: Grep references** — confirm only the deleted engines + `*.wiring.test.ts` referenced these. The modulators UI panel uses host STATE (`modulators`, `addModulator`, `setConnection`, `serialize`/`deserialize`) — KEEP those on `ModulationHostImpl`; delete only `spawnVoice*`.

- [ ] **Step 2: Delete the files + the rAF mod-poll** — remove `recordVoiceMods`/`getActiveModVoice` and the requestAnimationFrame loop that polled `currentValue()` to sync live LFO oscillators (it drove the deleted ConstantSource voices). Remove `setCurrentLaneForVoice` calls from `trigger-dispatch.ts`/`lane-allocator.ts` (the worklet engines don't need the lane-for-voice global).

- [ ] **Step 3: Delete the modulation `*.wiring.test.ts`** (they asserted ConstantSource→AudioParam bridges that no longer exist). In-worklet modulation is covered by `audio-dsp/modulation-runtime.test.ts` (Phase 1 Task 10).

- [ ] **Step 4: Green gate** — `npx tsc --noEmit` + `NO_COLOR=1 npm run test:unit`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(modulation): delete per-note ConstantSource binding (modulation runs in-worklet)"
```

---

## Task 4: Prune dead helpers + the Phase-0 leak-cleanup scaffolding

The per-note leak-cleanup code (per-voice dispose timers, `tailSec`, `onEnded` plumbing, the idle-WaveShaper/noise skip) lived in the now-deleted voices/PolySynth — gone with them. Sweep for any orphaned helper.

**Files:** grep-driven.

- [ ] **Step 1: Grep for orphans** — `pending-base-values.ts`, `velocity-gain.ts` (KEEP if the worklet engines resolve velocity main-thread — likely yes), any `ModulatorVoice.tailSec`/`onEnded` interface members now unused, `LiveVoiceRegistry` (if the worklet engines no longer create per-note `Voice`s that need registry-based Stop — verify the Stop path: the worklet stops via a message; the registry may be removable or repurposed to post stop-all to the worklets).

- [ ] **Step 2: Decide Stop path** — confirm how Stop/StopAll silences the worklets (post a `silence`/`steal(all)` message per lane). If `LiveVoiceRegistry` is now unused, delete it and replace its Stop callers with a "silence all worklets" broadcast. (Add a `silenceAll()` to each worklet node if missing — a small new method, with a test.)

- [ ] **Step 3: Green gate** — `npx tsc --noEmit` + `NO_COLOR=1 npm run test:unit`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: prune dead voice-lifecycle helpers after the worklet cutover"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full build** — `npm run build` (tsc + bundle) succeeds; `npm run build:pages` succeeds (worklet modules resolve under `--base=/Loom/`).

- [ ] **Step 2: Full suite** — `NO_COLOR=1 npm test` (unit + e2e). Rebuild `dist/` before e2e (`npm run build` — the e2e suite serves the last build). Fix/repoint any remaining legacy-dependent test.

- [ ] **Step 3: Manual full-app pass** — load the boot demo + each engine + a drum kit (synth AND sample) + a Sampler lane + an Audio channel; play. Then the original stress case: import `Robert_Miles_Children_d16.mid`, play several minutes through the climax + 2nd loop. Confirm: no dropouts/silence-with-VU, the global voice cap bounds total voices, the PERF panel reads sane. This is the end-state the whole rewrite targeted.

- [ ] **Step 4: Grep for dead exports** — a final `Grep` sweep for any `export` symbol from a deleted area still referenced nowhere; remove.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(worklet): final cutover verification + dead-export sweep"
```

---

## Self-Review

**Spec coverage:** Build-order step 4 ("single cutover: remove the old engine/dispatch/modulation-binding layer") — registry/allocator repointed (Task 1), legacy engines+voices deleted (Task 2), per-note modulation binding deleted (Task 3), dead lifecycle scaffolding pruned (Task 4), full verification incl. the original MIDI stress case (Task 5). "What is removed/replaced" from the spec maps 1:1 to the Inventory.

**Placeholder scan:** This phase is deletion-driven, so steps are "delete X / repoint Y / grep for stragglers" with exact file/symbol lists and a green gate after each — concrete, not vague. Two flagged decisions (offline-render hosting the worklet vs rendering via the pure kernel; whether `LiveVoiceRegistry` survives) are explicit sub-tasks with a stated resolution path, not TODOs.

**Type/ref consistency:** Every deletion is gated by a `Grep` for remaining references and a green build, so a missed rewire surfaces immediately. DATA kept by the worklet engines (param specs, kits, presets, keymaps, the moved DSP) is enumerated in the Inventory and Global Constraints so it is not deleted with the classes that used to own it.

**Ordering safety:** repoint-before-delete (Task 1 before Task 2) guarantees nothing constructs a legacy engine when it's removed; modulation binding (Task 3) deleted only after the engines that used it are gone; the green gate after every task localises any regression.
