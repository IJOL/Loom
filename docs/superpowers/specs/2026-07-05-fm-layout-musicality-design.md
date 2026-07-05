# FM engine — per-operator layout + musicality/intonation pass

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan
**Scope:** The FM melodic engine only — its editor layout, its DSP voicing, and its 24 JSON presets.

## Problem

The FM engine has three concrete defects:

1. **Cramped editor ("amontonado").** For FM, [`worklet-lane-engine.ts` `buildParamUI`](../../../src/engines/worklet-lane-engine.ts) dumps all ~31 controls (algorithm + feedback + 4 operators × 7 params + mix) into a single flat `knob-row` flex-wrap with no grouping. Subtractive has titled sections; FM/Wavetable/Karplus/Westcoast do not. As a side wart, the discrete `Algorithm` param renders as a *knob you twist* in the generic grid, even though its spec asks for a dropdown.
2. **Harsh, out-of-tune sound ("suena fatal / entonación").** [`fm-renderer.ts`](../../../src/audio-dsp/fm-renderer.ts) applies FM as `fmHz += opOut[mod] * fe[mod] * mLvl * FM_DEPTH` with `FM_DEPTH = 4`. With high-ratio operators (11×, 14×) at high level, the frequency deviation is enormous → inharmonic, dirty sidebands and a smeared, detuned‑sounding fundamental. Several presets also stack high modulator levels or use inharmonic ratios where a pitched sound is intended.
3. **No sane default ("no hay un preset sensato").** A fresh FM lane starts from `FM_PARAMS` defaults (a serial 4→3→2→1 cascade at index 4) — no preset is applied — so the out-of-the-box sound is one of the harshest possible.

## Goals

- FM controls read cleanly, grouped **one labelled row per operator** (DX/Dexed style) plus a global row.
- The engine sounds musical and in tune by default and across all presets; no clipping.
- All 24 presets revoiced for musicality + intonation, keeping their names and GM tags.
- Objective per-preset tests (audible, no-clip, in-tune) + a mandatory ear-check in real Chrome.

## Non-goals

- No changes to other engines' layouts (Wavetable/Karplus/Westcoast stay a single flat row — the change is backward-compatible).
- No new operators, algorithms, or params. No pruning/renaming of presets.
- No pitch-model change: linear FM already centres the fundamental; this is timbre/level, not tuning math.

## Design

### 1. Per-operator layout (data-driven groups)

Rather than special-casing FM in the core, extend the param schema so layout emerges from data (matches the repo's data-driven, drop-a-file ethos):

- **`EngineParamSpec` gains an optional `group?: string`** ([`engine-params.ts`](../../../src/engines/engine-params.ts)). Params sharing a `group` render together in one labelled row; the label is the group string. Group order = order of first appearance in `params[]`. Ungrouped params render in the default (first) row — the global/header controls.
- **[`fm.ts`](../../../src/engines/fm.ts)** tags `op1.*` → `"OP1"`, `op2.*` → `"OP2"`, `op3.*` → `"OP3"`, `op4.*` → `"OP4"`. `algorithm`, `feedback`, `amp.mix` stay ungrouped (global row). `poly.voices` continues to live in the existing POLY header.
- **Extract the generic grid builder** from `worklet-lane-engine.ts` (currently 366 lines) into a new focused module **`src/engines/engine-param-grid.ts`**. It builds the grouped rows from an engine's `params[]`, registering each control under `${laneId}.${spec.id}` exactly as today. Keeping it separate keeps the worklet engine lean (file-size budget) and makes the layout unit-testable without a worklet.
- **Algorithm as a real dropdown.** In the grid, discrete specs with `selectStyle: 'dropdown'` (or many/long options) render via `createSelectControl` instead of a knob. Continuous specs stay knobs.
- Engines that declare no `group` render exactly as before (one row) → no visual change for Wavetable/Karplus/Westcoast.

Resulting FM editor:

```
FM   Algorithm [Serial 4→3→2→1 ▾]   FB◯  Mix◯  Voices◯
──────────────────────────────────────────────────────
OP1   Ratio◯ Det◯ Lvl◯ │ Atk◯ Dec◯ Sus◯ Rel◯
OP2   Ratio◯ Det◯ Lvl◯ │ Atk◯ Dec◯ Sus◯ Rel◯
OP3   Ratio◯ Det◯ Lvl◯ │ Atk◯ Dec◯ Sus◯ Rel◯
OP4   Ratio◯ Det◯ Lvl◯ │ Atk◯ Dec◯ Sus◯ Rel◯
```

### 2. Tame the DSP ([`fm-renderer.ts`](../../../src/audio-dsp/fm-renderer.ts))

Timbre/level only — exact constants tuned **by ear** during implementation, bounded by the objective tests:

- **Soft saturation (tanh)** on the summed carrier output before `synthTrim`. Kills hard peaks, prevents clipping (notably the additive algorithm with 4 carriers), and adds analogue-ish warmth. This is the largest perceived-quality win for the least code.
- **Re-evaluate `FM_DEPTH`** (currently 4): likely land ~2.5–4 by ear once the soft-clip is in place. `FB_DEPTH` reviewed alongside.
- **Sane default patch** in `FM_PARAMS` defaults so a fresh FM lane is a clean, in-tune EP/keys voice rather than a harsh cascade.

Update the tuning/FM-depth comment block to reflect the new scaling. Existing `fm-renderer.test.ts` assertions are all relative (RMS, pitch ±1 semitone, feedback Δ>2%) and continue to pass; golden WAVs drift (human-inspection only, never fail CI).

### 3. Revoice the 24 presets ([`public/presets/fm.json`](../../../public/presets/fm.json))

Keep every preset's **name and `gm` tags** (used by MIDI-import GM matching); rewrite the param values:

- **Melodic presets** (EP, Keys, Pads): **integer operator ratios** (1, 2, 3, 4, 7…) for harmonic partials → clean intonation; moderate levels on high-ratio ops so sidebands stay musical.
- **Bells / FX**: keep intentional inharmonicity (e.g. 3.14, 7.13) but controlled, no clipping.
- Coherent envelopes so each note speaks cleanly. No preset may clip or sound detuned.

### 4. Tests & verification

- **New objective per-preset DSP test.** Render every FM preset (real DSP kernel) and assert, one assertion per preset: (a) audible (RMS above a small floor), (b) **no clipping** (peak < 1.0), (c) for melodic (non-bell/FX) presets, the detected fundamental lands within tolerance of the played note (intonation). Relative assertions per the repo rule.
- **Layout unit test** for `engine-param-grid.ts`: an engine whose params declare groups renders one labelled row per group (+ the ungrouped/global row); an engine with no groups renders a single row.
- Existing `fm-renderer.test.ts` stays green (may add cases for the soft-clip if useful).
- **Mandatory ear-check** in real Chrome at `localhost:5173` (VS Code's embedded browser is unfaithful for audio): fresh FM lane + a spread of presets, confirm musical, in tune, no clipping/dropouts.

## Acceptance criteria

1. FM editor shows a global row + four labelled operator rows; Algorithm is a dropdown.
2. Wavetable/Karplus/Westcoast editors are visually unchanged.
3. A fresh FM lane and all 24 presets: audible, no clipping, melodic ones in tune (objective test green).
4. Ear-check in real Chrome confirms the sound is musical and in tune.
5. `npm run build` (tsc) clean; unit suite green.

## Risks / notes

- Golden WAVs for FM will drift — expected, re-bless deliberately if desired (`npm run test:wav-bless`), commit separately.
- Exact `FM_DEPTH`/tanh constants are ear-tuned; the objective tests are the safety net, not the definition of "good".
- Work happens in the `worktree-fm-layout-musicality` git worktree; rebase onto `main` frequently; merge `--ff` only with explicit permission.
