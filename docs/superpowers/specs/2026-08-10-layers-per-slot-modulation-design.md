# LAYERS: a slot must contain its instrument

**Date:** 2026-08-10
**Status:** approved in conversation, not started.
**Branch:** `worktree-arranger-auto-accompaniment`.

## The rule this round exists to honour

> A slot must contain everything that synth brings with its preset. LAYERS may
> add things of its own on top, but **an instantiated engine cannot depend on
> anything living outside its box.**

An instrument in a slot has to sound exactly as it would on a lane of its own,
because it carries with it everything it needs.

## What is broken today, measured

Converting a subtractive lane to layered halves it and changes its character.
Measured at the master with every other lane muted, twice from a clean reload:

| | RMS | Peak |
| --- | --- | --- |
| Before converting | 0.0438 / 0.0444 | 0.751 / 0.750 |
| After converting | 0.0223 / 0.0225 | 0.504 / 0.504 |
| Ratio | **0.51** | 0.67 |

The cause is not the params — those are carried, and two test files prove they
arrive and that each slot hears its own. It is the **modulators**.

`plugins/subtractive/plugin.json` ships two ADSRs by default: one connected to
`amp` and one to `filter.env`. LAYERS ships a single LFO
(`LAYERS_DEFAULT_MODULATORS`). So a converted lane loses its amplitude envelope
and its filter envelope — which is both the halving and the change of character.

## Why the obvious fix is the wrong one

Carrying the lane's modulators across, targets unprefixed, makes the symptom go
away. `LayersRenderer` hands the lane's modulation offsets to every layer
unchanged, so an envelope aimed at `amp` would reach all of them.

It is wrong for exactly the reason the rule above exists: that envelope would
belong to the LANE and be shared by every slot. Two instruments could never have
different envelopes, and a slot would sound according to something outside
itself. It buys silence on the symptom at the price of entrenching the fault.

That approach was written and backed out. Do not re-introduce it.

## What to build

**Each slot owns its own modulators**, scoped to that slot's engine, exactly as
if it were a lane of that engine.

Three problems to solve, in the order they bite:

### 1. Naming a slot's synthetic targets

`amp` and `filter.env` are not declared params — they are in
`SYNTHETIC_TARGETS` (`audio-dsp/param-index.ts`) and resolved through the dot-id
mapper. The declared params take a prefix cleanly (`l0.filter.cutoff`); these
have no name for "layer 0's amp" at all.

This is the piece everything else waits on. Whatever the answer, `subIndex` and
the mapper have to agree about it, and the DSP tests in
`layers-params.dsp.test.ts` are where the agreement gets pinned.

### 2. A slot's preset must include its modulators

An engine preset already carries `modulators` (`EnginePreset.modulators`), and
`applyLayerPreset` currently applies only `params`. Once a slot can hold
modulators, recalling a preset into it must bring them — which is what makes
"change a layer's preset" change the whole instrument rather than only its
knobs.

### 3. Conversion carries them into slot 0 and slot 1

`convertLaneToLayers` copies the lane's live patch today and deliberately does
NOT copy modulators (there is a comment saying so and why). Once slots can hold
them, it copies them into both slots — read from the LIVE host, the way
duplicating a lane does, because `engineState.modulators` is not kept in step.

## Acceptance

Things a person checks, plus the measurement that started this.

1. Converting a subtractive lane is inaudible: the same clip through the same
   scene, every other lane muted, reads within a few percent on RMS and peak.
   The number to beat is the 0.51 above.
2. Two slots holding the same engine with DIFFERENT envelope presets sound
   different from each other — the property that carrying lane-level modulators
   could never have.
3. Recalling a preset into a slot changes its envelope, not only its knobs.
4. A slot's sound does not change when the lane's own modulators change.

## What already works, and has tests

Do not re-litigate these — they are measured, from both ends:

- The preset write reaches the engine under the slot's prefix and mirrors into
  the lane (`src/engines/layers-rack-preset.test.ts`).
- Each slot hears its own params, the gains balance the two, one end is exactly
  one instrument, and a live gain reaches a note already sounding
  (`src/audio-dsp/layers/layers-params.dsp.test.ts`).
- Each slot plays at its OWN engine's output trim. LAYERS declares 1 and
  subtractive declares 0.25, so every layered lane used to be four times too
  loud; the trim now travels with the slot in the structural payload.
- Converting brings slot 1 up SILENT, so it changes nothing you hear and a
  preset recalled into slot 0 is audible immediately.
