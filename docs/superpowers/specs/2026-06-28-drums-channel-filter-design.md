# Drums channel filter (cutoff + resonance, modulatable) — design

**Date:** 2026-06-28
**Status:** approved (design), pre-implementation
**Scope owner:** user request — "necesitamos un cutoff y resonance … aplicable a drumkit en versión synth o sample … modulable", later narrowed to **drums only** ("limítalo a los drums", "instrumento drum tanto si es de sampler como synth").

## Goal

Give the **drum instrument** a channel-level **resonant low-pass filter** (cutoff + resonance) that is independent of the per-voice synthesis, present in **both** drum flavours, and **modulatable** (LFO/ADSR) + automatable, like any other param. Nothing else gets it.

## Scope

In scope — two engines:
- **Drums** (`DrumsWorkletEngine`, the synthesised DrumMachine) — always.
- **Sampler** (`SamplerWorkletEngine`) — **always** (drumkit OR melodic; the user chose "siempre en el Sampler" to avoid state-conditional UI; a channel filter is harmless/useful in melodic mode too).

Out of scope (YAGNI): the 6 melodic worklet engines (they already have their own `filter.cutoff`/`filter.resonance`), multimode filter (LP/HP/BP), per-voice channel filters, filter envelope/key-tracking. Just **one LP filter, two knobs**.

## Approach (A — approved)

A plain Web-Audio **`BiquadFilter` (`type: 'lowpass'`)** on the main-thread channel chain, **post-synthesis, before the channel EQ/inserts** (raw drum mix → FILTER → EQ/inserts → master). It is modulated through the **existing `bindEngineModulators` → `getAudioParams()` path that drums already uses** — not a new worklet-side mechanism.

Rejected: (B) filter inside the drums-/sampler-processor worklets — more work across two processors, no audible gain for a channel filter; (C) auto-inserted FX plugin — reads as an "insert", not a fixed instrument control.

## Components

### 1. Audio node + placement
- A single `BiquadFilter` (`lowpass`) per drum/sampler lane, inserted on the channel signal path **after the voice/pad mix and before the channel EQ + inserts**.
  - **Drums:** between the drum bus mix and the bus `ChannelStrip` EQ (the bus the 8 voices sum into; see `DrumsWorkletEngine` bus + `getAudioParams` at [src/engines/drums-worklet-engine.ts:187](../../../src/engines/drums-worklet-engine.ts)).
  - **Sampler:** between the sampler worklet `dryTarget` output and the lane insert/strip ([src/engines/sampler-worklet-engine.ts:136](../../../src/engines/sampler-worklet-engine.ts) `setOutputTarget`). The exact node-wiring point is an implementation detail for the plan; the constraint is "raw mix → filter → EQ/inserts".
- The filter node lives for the life of the lane and is disposed with it.

### 2. Parameters (two new continuous params, per engine)
| Param id | Maps to | Range | Default | Notes |
|---|---|---|---|---|
| `filter.cutoff` | `BiquadFilter.frequency` | 20 Hz – 20 kHz, **log** | **20 kHz (fully open)** | Default = passthrough → zero change to existing drum sound. |
| `filter.resonance` | `BiquadFilter.Q` | ~0.7 – 18 | **0.7 (min)** | Default = no resonant peak. |

Same ids in both engines (conceptually identical to the melodic engines' `filter.cutoff`/`filter.resonance`; no collision — ids are lane-prefixed). Declared as `EngineParamSpec[]` so knobs + automation come for free.

### 3. UI
- A fixed **"CHANNEL FILTER"** section with two knobs (**CUTOFF**, **RES**) in the drums editor and the sampler editor. Always present (per the scope decision), regardless of kit/preset.

### 4. Modulation (the crux)
- **Drums:** add `filter.cutoff`→`biquad.frequency` and `filter.resonance`→`biquad.Q` to the bus `getAudioParams()` map. Drums already runs `bindEngineModulators` ([drums-worklet-engine.ts:487](../../../src/engines/drums-worklet-engine.ts)), so they immediately become LFO/ADSR + automation destinations — no new infra.
- **Sampler:** the Sampler already owns a `ModulationHostImpl` ([sampler-worklet-engine.ts:110](../../../src/engines/sampler-worklet-engine.ts)) (the MODULATORS panel) but `getAudioParams()` returns an empty Map and it does not call `bindEngineModulators`. Add: the filter's two AudioParams to `getAudioParams()`, a range lookup, and the `bindEngineModulators` wiring (mirroring drums). This gives the Sampler its first channel modulation destination.
- Depth scaling: cutoff modulated in the param's native log domain like the melodic `filter.cutoff` (so depth 1 = full sweep); resonance linear over its range. Reuse the existing range-lookup convention.

### 5. Persistence
- Both values persist in the lane's engine state (save v3) like any other engine param. No migration needed (absent → default open/min on load of older saves).

## Compatibility / "change nothing by default"
- Cutoff default **20 kHz** + Q **0.7** = audibly transparent. Existing drum demos, presets and saved sessions sound identical until the user moves a knob. This is an explicit acceptance criterion (golden/relative test below).

## Acceptance criteria & tests (one per user-path)
1. **DSP — drums filter works:** render a drum bus hit with `filter.cutoff` low vs default-open; low-cutoff render has measurably less high-frequency energy (relative ratio).
2. **DSP — sampler filter works:** same assertion for a sampler-drumkit render.
3. **Default is passthrough:** drums rendered with the filter at default (20 kHz / 0.7) matches the no-filter render within a tight relative tolerance (proves we didn't change existing sound).
4. **Modulation — drums:** an LFO routed to `filter.cutoff` on a drums lane measurably changes the rendered sound (mirror `modulation-pipeline.test.ts`: dry vs wet envelope diff).
5. **Modulation — sampler:** same assertion for the sampler lane (its first channel modulation destination — proves the new binding works).
6. **Persistence:** a session saved with non-default cutoff/resonance reloads with those exact values.
7. **UI present:** the CHANNEL FILTER section with CUTOFF + RES renders in both the drums and the sampler editor.

Each is its own test — no "(or …)" alternatives.

## Risks / open implementation questions (for the plan)
- Exact node-insertion point in the drums bus vs the lane strip (drums has an internal bus `ChannelStrip`; sampler uses the lane strip). The plan must trace the precise boundary so the filter sits on the raw mix.
- Sampler `bindEngineModulators` wiring is new for this engine — verify the range-lookup + binder lifecycle (create/dispose on lane swap) matches drums.
- Confirm the offline/export render path includes the new node (it is in the Web-Audio chain, so it should — verify in a test).
