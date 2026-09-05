# Polyphony gain staging + westcoast recalibration

**Date:** 2026-09-05 · **Branch:** `feat/polyphony-gain-staging`

## The problem, measured

A westcoast lane from the user's real session (`west-1`, fold 0.35 + ring 0.3 +
accented notes, contour attack 1 s / decay 1.8 s) renders at:

| voices | raw peak | raw RMS | after the master tail |
|---|---|---|---|
| 1 | 1.33 | 0.48 | peak 0.98 — survives |
| 8 | 5.63 | **1.03** | pinned at 1.00, grinding continuously |
| 39 | 6.86 | 1.20 | same |

At 8 voices the RAW signal's RMS exceeds full scale: sustained overload, not a
stray peak. The master limiter (−2 dB, 20:1) plus the soft-clip (everything
above 0.8 squeezed into 0.15) then distort the whole lane for the whole clip —
that IS the "noise at any polyphony above minimum" the user hears. Reproduced
offline through `renderKernelLane` (tools/repro-west-poly.test.ts), so it is
voice summing, not worklet CPU and not state corruption.

Root causes, in order:
1. **Voices sum raw** — no per-voice headroom anywhere (gain-staging.ts is all
   static category/engine/preset trims).
2. **poly.voices defaults are 24–32** and the knob writes FRACTIONS (kind
   "continuous", grid step = range/200 → values like 0.945 in real saves).
3. **Westcoast runs hot per voice**: 16 of its 24 presets exceed ±1 on a single
   soft mid note (audition battery 2026-09-03); DRONE Sub Fold is a genuine
   runaway (peak 2.58 with live trim, tail that never decays).

## Design

A static gain cannot distinguish one voice from eight — every constant scales
both equally. The system therefore has three parts with distinct jobs:

1. **Defaults + integer knob** (keeps you out of the pileup zone by default)
   - SDK `EngineParamSpec` gains optional `step?: number` (knob quantum);
     `engine-param-grid` uses `spec.step ?? (max−min)/200`; manifest-validate
     accepts a positive number.
   - The five poly manifests declare `poly.voices` with `step: 1` and
     `default: 10` (was 24–32). Range stays 1..64.
2. **Per-voice headroom** (moves the operating point)
   - `POLY_VOICE_HEADROOM = 0.5` in gain-staging.ts (single source of truth),
     applied to the melodic VoiceManager's summed output — the same path live
     worklet and offline kernel render share. Melodic lanes drop ~6 dB, which
     also addresses the standing "bank rides the master knee" issue
     (project_preset_levels_unbalanced). Drums/sampler paths untouched.
3. **Per-lane soft clip** (the only stage that tells a pileup from a note)
   - A knee-0.9 tanh ceiling (same shape as the master curve, scaled) applied
     to the lane's summed output AFTER the headroom, in VoiceManager — so a
     single voice passes untouched and a pileup saturates musically inside its
     own lane instead of grinding the whole master.

4. **Westcoast recalibration**, after 2+3 land (they move its operating point):
   re-measure the bank with the audition tool; adjust the engine's manifest
   `outputTrim` and per-preset params so a std phrase peaks ≈0.35–0.7 and a
   4-voice chord stays under the lane knee; fix DRONE Sub Fold's runaway
   (bounded, decaying tail). Pin with a preset-levels dsp test (pattern:
   plugins/subtractive/preset-levels.dsp.test.ts).

Then re-bless the golden WAVs (deliberate `test:wav-bless`, committed) and run
the full suite.

## Acceptance

- poly.voices knob lands on integers only; fresh melodic lanes default to 10.
- west-1's saved patch at 8 voices renders with raw RMS < 0.7 and no sustained
  master grinding; at 1 voice it sounds materially the same as before (level
  aside).
- Every westcoast preset: std phrase finite, peak in ≈0.35–0.8; DRONE Sub Fold
  tail decays.
- Full suite green; goldens re-blessed in the same branch.
