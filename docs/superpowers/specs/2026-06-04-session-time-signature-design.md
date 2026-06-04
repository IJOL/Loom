# Session time signature (global meter)

**Date:** 2026-06-04
**Status:** Design approved (pending written-spec review)
**Area:** `src/core/sequencer.ts`, `src/core/lane-scheduler.ts`, `src/core/pianoroll.ts`,
`src/core/transport-display.ts`, `src/session/clip-editors/clip-editor-drum-grid.ts`,
`src/save/saved-state-v3.ts`, `index.html`, `src/main.ts`
**New module:** `src/core/meter.ts`

> This is **Spec 1 of 3** in an editors overhaul. The agreed order is:
> 1. **Session time signature** (this doc) — the temporal foundation both editors draw on.
> 2. **Editing UX** — mouse marquee selection, copy/paste, group move, computer-keyboard
>    musical typing (ASDF white / QWER black / Z·X octave), in the piano-roll.
> 3. **Flexible drum editor** — selectable resolution + free off-grid placement (polyrhythms),
>    plus selection/copy/paste in the drum grid.
>
> Specs 2 and 3 are separate brainstorming sessions; this doc designs only Spec 1.

## Problem

Everything in the app assumes **4/4**. Timing lives in ticks
(`TICKS_PER_QUARTER = 96`, `TICKS_PER_STEP = 24` = a 16th), and `NoteEvent.start/duration`
already accept **any** tick — so off-grid placement is possible in the data model. But
"a bar = 4 beats = 16 sixteenth-steps" is hard-coded in several places:

- [lane-scheduler.ts:35](../../../src/core/lane-scheduler.ts) — `TICKS_PER_BAR = TICKS_PER_STEP * 16`
- [lane-scheduler.ts:69](../../../src/core/lane-scheduler.ts) — `clipDurSec = clip.lengthBars * 4 * secPerBeat`
- [pianoroll.ts:168](../../../src/core/pianoroll.ts) — bar lines at `s % 16`, beat lines at `s % 4`
- [clip-editor-drum-grid.ts:21](../../../src/session/clip-editors/clip-editor-drum-grid.ts) — `steps = clip.lengthBars * 16`
- [transport-display.ts:17](../../../src/core/transport-display.ts) — `STEPS_PER_BAR = 16`, `STEPS_PER_BEAT = 4`
- [main.ts:267](../../../src/main.ts) + [index.html:71](../../../index.html) — the **Bars** selector encodes
  step counts (`16/32/48/64`), i.e. `bars × 16`.

We want odd and compound meters (3/4, 5/4, 6/8, 7/8, 9/8, 12/8) as a **single global
value**, edited like the BPM, affecting every clip.

## Decisions (locked during brainstorming)

- **Scope:** the meter is **global, one per session** — like BPM, not per-clip or per-lane.
  Rationale: simplest; bar lines stay aligned across lanes; scenes / launch-quantization
  stay coherent; covers ~all real music. Polyrhythmic *feel within a clip* is still possible
  because notes live at free ticks (and becomes a first-class editor feature in Spec 3).
  Per-clip override remains a clean future evolution (global default + optional override).
- **Editor UI:** a single **dropdown of common meters** in the transport row (not a
  numerator-stepper + denominator-select). Initial list:
  `4/4, 3/4, 2/4, 5/4, 6/8, 7/8, 9/8, 12/8`. It is a plain array, trivial to extend.
- **Allowed denominators:** `{2, 4, 8, 16}` only. These are the powers of two that divide
  384 (one whole note in ticks), guaranteeing an **integer number of 16th-steps per bar**.
  `/32` would produce fractional 16th-steps and break the current grid — out of scope, and
  vanishingly rare.
- **Numerator range:** 1–16 (the dropdown stays well inside this).
- **Live meter change:** notes (absolute ticks) are never rewritten. Each clip keeps its
  `lengthBars`; its loop duration is recomputed from the new meter, so the loop window
  grows/shrinks — exactly like changing meter in a DAW.
- **No `schemaVersion` bump:** `timeSignature` is an additive optional field; absent ⇒ 4/4,
  so existing saves load bit-identical in sound. (Matches how `mode`/`arrangement` were added.)

## Non-goals (YAGNI)

- **Beat grouping** (rendering 7/8 as 2+2+3, accented downbeats per group). Spec 1 draws
  **uniform** beat lines, one per denominator pulse. Revisit if wanted.
- **Per-clip / per-lane meter** and **polymeter** (different meters sounding simultaneously).
- **Denominators outside {2,4,8,16}** (no `/32`).
- **Flexible drum-grid resolution / free off-grid placement** — that is Spec 3. In Spec 1 the
  drum grid stays a 16th-note grid; only its *steps-per-bar* becomes meter-aware.
- **Swing rework** — swing keeps operating on 16th positions; unchanged.

## Design

### 1. Data model

```ts
export interface TimeSignature { num: number; den: number; } // den ∈ {2,4,8,16}, num 1..16
```

Lives on the `Sequencer` next to `bpm`/`swing`:

```ts
// src/core/sequencer.ts
meter: TimeSignature = { num: 4, den: 4 };
```

Persisted in `SavedStateV3` as an optional field:

```ts
// src/save/saved-state-v3.ts
timeSignature?: TimeSignature;   // absent ⇒ defaults to 4/4 on load
```

### 2. `src/core/meter.ts` — the single source of truth (pure)

All hard-coded `*16` / `%16` / `*4` math is replaced by calls into this module. With
`TICKS_PER_QUARTER = 96`, one whole note = `96 * 4 = 384` ticks.

```ts
ticksPerBar(m)    = m.num * 384 / m.den   // 4/4=384, 3/4=288, 7/8=336, 6/8=288, 9/8=432
quartersPerBar(m) = ticksPerBar(m) / 96   // 4/4=4,   3/4=3,   7/8=3.5, 6/8=3,   9/8=4.5
stepsPerBar(m)    = ticksPerBar(m) / 24   // 4/4=16,  3/4=12,  7/8=14,  6/8=12,  9/8=18   (16th-steps)
stepsPerBeat(m)   = (384 / m.den) / 24    // 4/4=4,   7/8=2,   6/8=2,   9/8=2             (pulse, in 16ths)
clampMeter(m)     // validate num∈[1,16], den∈{2,4,8,16}; fall back to 4/4 on bad input
COMMON_METERS     // the dropdown list: [{num:4,den:4}, {num:3,den:4}, … ]
```

Because every denominator in `{2,4,8,16}` divides 384, `ticksPerBar` is always a multiple
of 24, so `stepsPerBar` is always an integer.

### 3. Meter-aware consumers (replace the cabled constants)

| File | Today | After |
|------|-------|-------|
| `lane-scheduler.ts` | `TICKS_PER_BAR = TICKS_PER_STEP*16`; `clipDurSec = lengthBars*4*secPerBeat` | `ticksPerBar(m)`; `clipDurSec = lengthBars * quartersPerBar(m) * 60/bpm` |
| `pianoroll.ts` | bar `s%16`, beat `s%4` | bar `s % stepsPerBar(m)`, beat `s % stepsPerBeat(m)` |
| `clip-editor-drum-grid.ts` | `steps = lengthBars*16`; segments `%16`/`%4` | `steps = lengthBars*stepsPerBar(m)`; meter-aware segment marks |
| `transport-display.ts` | `STEPS_PER_BAR=16`, `STEPS_PER_BEAT=4` | from meter (the 16th-rate is unchanged) |

**Threading the meter** — the scheduler already receives a `ctx` carrying `bpm`; add the
meter to that context object so it is read **at schedule time** (a meter change applies on
the next loop cycle, for free). The piano-roll receives it via `PianoRollOpts`; the drum grid
via `ClipEditorDeps`. The clip-editor router passes `seq.meter` through.

### 4. UI

- **Transport row** ([index.html:66](../../../index.html)): add a `<select id="meter">`
  beside BPM, populated from `COMMON_METERS`, labelled `num/den`. On change: set `seq.meter`,
  recompute the default length, re-render the open editor (bar lines) and lanes, refresh the
  transport readout. The next scheduler loop picks up the new meter automatically.
- **Bars selector** ([index.html:71](../../../index.html), [main.ts:267](../../../src/main.ts)):
  change its option values to **bar counts** (1–4) and derive steps via
  `bars * stepsPerBar(seq.meter)` instead of the fixed `16/32/48/64`. `Sequencer.length`
  (kept in 16th-steps for compatibility with existing callers) becomes a derived value:
  `length = defaultBars * stepsPerBar(meter)`, recomputed whenever either input changes.

### 5. Persistence & migration

- `buildSavedStateV3` writes `seq.meter` into `timeSignature`.
- `applyLoadedStateV3` reads it with a `clampMeter(... ?? {num:4,den:4})` default and sets
  the `#meter` select value. Old saves (no field) ⇒ 4/4 ⇒ identical playback.

## Testing

Per the project's relative-assertion rule:

1. **Pure — `meter.test.ts`:** `ticksPerBar` / `stepsPerBar` / `stepsPerBeat` for
   4/4, 3/4, 6/8, 7/8, 9/8; `clampMeter` rejects `/32` and out-of-range numerators and
   falls back to 4/4.
2. **Scheduling — extend `lane-scheduler.test.ts`:** a 1-bar clip in 7/8 has loop duration
   `7/8` of the same clip in 4/4 (ratio assertion, fake clock); a 3/4 clip is `3/4`.
3. **Migration — extend the saved-state tests:** a `SavedStateV3` without `timeSignature`
   loads as 4/4; a round-trip of `{num:7,den:8}` preserves it.
4. **Manual smoke:** set 7/8 → the piano-roll ruler shows 14 sixteenth columns per bar with
   bar lines every 14 and beat lines every 2; the drum grid shows 14 cells per bar; the
   transport readout counts beats up to 7; playback loops audibly shorter than 4/4.

## Touch list (for the implementation plan)

- **New:** `src/core/meter.ts` (+ `meter.test.ts`).
- **Edit:** `sequencer.ts` (add `meter`), `lane-scheduler.ts`, `pianoroll.ts` (+ opts),
  `transport-display.ts`, `clip-editor-drum-grid.ts` (+ deps), `clip-editor-router.ts`
  (pass `seq.meter`), `saved-state-v3.ts`, `index.html` (meter select + Bars-as-bars),
  `main.ts` (wire `#meter`, Bars→bars, re-render on change).
- **Tests:** `meter.test.ts`, `lane-scheduler.test.ts`, saved-state tests.
