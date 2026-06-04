# Sampler per-pad params + modulation

**Date:** 2026-06-04
**Status:** Design approved (pending written-spec review)
**Area:** `src/engines/sampler.ts`, `src/samples/*`, `src/engines/drum-voice-rack.ts`, sampler keymap UI
**Part of:** the "redesign drums to unify synth + sample kits" effort. This is **Spec A** (the foundation). **Spec B** (unified drum presets that select the engine synth↔sampler) is a separate, later spec.

## Problem

The Sampler engine shapes sound with **global** params (gain, amp attack/release, pitch, filter cutoff/resonance) applied to **every** pad/voice on the lane. Per pad, the only control is `rootNote` (+ an optional `gain`/trim on the keymap entry). So when a sampler lane is a **drumkit** (8 single-note pads at GM notes, via `engineState.sampler.drumkitId`), you cannot tune just the kick, shorten just the hat, or filter just the snare — every pad shares one filter, one envelope, one pitch.

The synthesized drum machine (`drums-machine`) just got a full **per-voice rack** (TUNE/DECAY/character + level/pan/sends per voice) + per-voice mute/solo. The sampler — the *other* drum engine — has none of that. This spec brings the sampler to parity: **per-pad params + modulation**, "not just the root key."

## Goals

1. Each **keymap entry (pad/zone)** gets its own sound-shaping params: `tune, cutoff, res, attack, decay, level, pan, rev, dly`.
2. The `SamplerVoice` reads the **triggered pad's** params at trigger time (not lane-global ones).
3. A **shared LFO/ADSR modulator host** (currently empty) routable to **per-pad** destinations, applied via the per-voice binding (like FM/Karplus). The amp envelope (attack/decay) is a per-pad **param**, not a modulator.
4. **Drumkit pads reuse the synth `drum-voice-rack`** — a sample drumkit exposes `<voice>.<leaf>` param ids (GM voice names) and renders the SAME 8-column rack + M/S as the synth drums. Melodic samplers get a per-zone inline UI.
5. Per-pad params **persist** and survive the drumkit reload-by-id.

## Non-goals (YAGNI / deferred)

- **Spec B** (unified drum presets selecting synth↔sampler engine, relaxing the `swapLaneEngineFlow` drum guard) — separate spec.
- Sampler extras: START offset, REVERSE, CHOKE groups — not in this set (possible follow-up).
- Per-pad *modulators* (each pad its own LFO/ADSR) — we use ONE shared host with per-pad destinations.
- New bundled drumkits or sample import changes.

## Decisions (from brainstorm)

- Param set per pad: **standard drum set** — TUNE, CUTOFF, RES, ATTACK, DECAY, LEVEL, PAN, REV, DLY — **plus playback: LOOP (on/off), LOOP START, RETRIGGER (mono on/off)**.
- Scope: **per keymap entry** — applies to drumkits AND melodic (UI adapts).
- Modulators: **one shared LFO/ADSR host per lane → per-pad destinations**; amp env is a per-pad param.
- UI: **reuse `drum-voice-rack` for drumkits**; per-zone inline for melodic.

### Plan split: A1 (now) + A2 (later)

Discovered during planning: true **per-pad LFO/ADSR modulation** needs the modulator binding to run at **trigger time** (the existing per-voice binding runs at `createVoice`, before the pad/note is known, so it produces *uniform* modulation, not per-pad). That is a non-trivial extension of a binding subsystem with a delicate bug history. So this spec ships in two plans:

- **Plan A1 (this one):** per-pad **params** (incl. the per-pad amp envelope = "decay per pad") + per-pad **mixer** + **loop/retrigger** + **rack reuse** + **persistence**. No LFO/ADSR panel. Delivers the bulk of the value ("shape each pad, not just root key").
- **Plan A2 (deferred):** the shared LFO/ADSR modulator panel with **per-pad destinations** (trigger-time binding). Separate plan.

`PadParams` gains `loop: 0|1`, `loopStart: 0..1`, `retrig: 0|1`. Loop uses `AudioBufferSourceNode.loop`/`loopStart`; retrig=mono cuts the previous voice of the same pad and restarts (the base for a future CHOKE).

## Architecture

### Per-pad param store

A pad's params attach to its identity, NOT to the regenerated keymap (drumkits reload by id → fresh keymap each load). So the store is keyed by **pad key**:

- **Drumkit pads:** keyed by the GM **note** (kick=36, snare=38, …) — stable across reload-by-id.
- **Melodic zones:** keyed by the entry's **rootNote** (distinct per zone in practice).

```ts
// One pad's editable sound params (defaults below).
interface PadParams {
  tune: number;    // semitones, -24..24, default 0  (adds to repitch)
  cutoff: number;  // 0..1, default 1                  (60..18000 Hz exp)
  res: number;     // 0..1, default 0
  attack: number;  // s, default 0.005
  decay: number;   // s (release), default 0.08
  level: number;   // 0..1.5, default 1
  pan: number;     // -1..1, default 0
  rev: number;     // 0..1, default 0
  dly: number;     // 0..1, default 0
}
type PadParamStore = Record<number, Partial<PadParams>>; // key = pad note/root
```

The `SamplerEngine` owns a `PadParamStore`. `getPadParam(note, leaf)` returns the stored value or the `PadParams` default. The `SamplerVoice` is created/triggered for a note → it reads that note's pad params (resolved from the engine) at trigger time.

The lane keeps a small set of **global** params: `gain` (master), `poly.voices`. The sound-shaping ones (pitch/filter/amp) become per-pad. (Back-compat: a melodic lane with one zone behaves like today, its single zone holding the params.)

### EngineParamSpec ids

Per-pad params are exposed as engine params with id `<padKey>.<leaf>`:

- **Drumkit lane:** padKey = GM voice name (`kick`, `snare`, `closedHat`, …) — so ids are `kick.tune`, `snare.cutoff`, etc., **identical to the synth drums' id scheme**. This is what lets the drumkit reuse `drum-voice-rack`. A small `noteToVoice` map (GM) bridges the note-keyed store and the voice-named ids.
- **Melodic lane:** padKey = `zone<rootNote>` (e.g. `zone60.cutoff`), rendered inline per keymap row.

`SamplerEngine.params` is **dynamic**: it reflects the current keymap (8 voice columns for a GM kit; N zones for melodic). `getBaseValue`/`setBaseValue` parse `<padKey>.<leaf>` → resolve the note → read/write the `PadParamStore`. **All 9 leaves live in `PadParamStore`** (base values); `level`/`pan`/`rev`/`dly` are *applied* via per-voice nodes (see Per-pad mixer below), and `cutoff`/`res`/`level`/`pan` double as modulatable AudioParams on the live voice.

### Per-pad mixer (level/pan/rev/dly)

Unlike the synth drums (which already had 8 ChannelStrips), the sampler routes all voices through ONE lane strip. Two options for per-pad level/pan/sends:

- **(chosen) Per-pad gain/pan/send nodes inside the SamplerVoice**, driven by the pad's params at trigger. `level`→amp peak scale, `pan`→a per-voice `StereoPanner`, `rev`/`dly`→per-voice send gains into the shared `FxBus`. This keeps the lane's single strip and adds per-voice routing in the voice (cheap; voices are short-lived).

So a SamplerVoice grows: `src → filter → ampGain → panner → output`, plus `panner → revSend → fxBus.reverbInput` and `→ dlySend → fxBus.delayInput`. The engine must receive the shared `FxBus` (a `setSharedFx` like the drums engine).

### Modulation

- The sampler's `modHost` (currently `new ModulationHostImpl([])`) gains default `lfo1` + `adsr1` (via `makeDefaultLFO`/`makeDefaultADSR`), like the other polyhost engines.
- Per-voice modulator binding (the path FM/Karplus use): when a pad-voice spawns for a note, the shared modulators bind to **that voice's** AudioParams, filtered by destinations targeting that pad (`<voice>.cutoff`, `<voice>.level`, `<voice>.pan`). The voice exposes those AudioParams via `getAudioParams()` keyed by the pad-prefixed id.
- The destination dropdown lists per-pad AudioParam destinations for the current kit.
- Amp env (attack/decay) stays a per-pad param (shapes the voice's amp envelope), not a modulator destination.

## UI

### Drumkit: reuse `drum-voice-rack`

When the sampler lane is a drumkit, `buildParamUI` renders the per-pad rack via the SAME `renderDrumVoiceRack(engine, ctx, host)` used by the synth drums. It works because the sampler drumkit exposes `<voice>.<leaf>` params + the mute/solo surface (`getDrumVoiceMute/Solo`, etc.) — the rack is engine-agnostic over that contract. `drum-voice-rack`'s `CURATED_SYNTH` map needs a sampler-aware curated set (TUNE/CUTOFF/DECAY curated; RES/ATTACK in advanced); approach: make the rack read the curated/advanced split from the engine (a small `getRackLayout()` contract) instead of a hard-coded synth map, so both engines drive it.

Mute/solo: the sampler reuses the same per-voice mute/solo (its per-voice gain/strip is muted), exposing the same `getDrumVoiceMute/Solo`/`setDrumVoiceMute`/`toggleDrumVoiceSolo`/`getDrumVoiceMutes` contract.

### Melodic: per-zone inline params

The existing keymap list (each `sampler-keymap-row`) gains an expandable per-zone param block (the same 9 knobs, ids `zone<root>.<leaf>`), rendered with `wireEngineParams` filtered to that zone.

## Persistence

- Per-pad params persist in `engineState.sampler.padParams: Record<number, Partial<PadParams>>` (keyed by note/root), mirrored on edit (a new `mirrorPadParams`).
- On load: the drumkit reloads by id (regenerates the keymap), THEN `applyEngineState` re-applies `padParams` into the engine store by note. Ordering mirrors the existing drumkit-reload → keymap path.
- Per-pad mute persists via the existing `engineState.drumMutes` contract (reused). Modulators persist via the modHost serialize (existing path). Solo is live-only.

## Testing

1. **Pure / unit:**
   - `getPadParam(note, leaf)` returns stored value or default; `setBaseValue('kick.tune', v)` writes the kick-note store; `getBaseValue` round-trips.
   - `noteToVoice` / id parsing: `kick.cutoff` ↔ note 36; `zone60.level` ↔ root 60.
   - Persistence: `mirrorPadParams` + replay restores per-pad params keyed by note after a drumkit reload.
2. **DSP real (`sampler-per-pad.dsp.test.ts`):** load a kit; render two pads; assert per-pad independence — TUNE up on kick raises its pitch without changing the snare; CUTOFF down on snare darkens only the snare (relative centroid); DECAY short shortens only that pad's tail.
3. **Modulation wiring (`.wiring.test.ts`):** an LFO routed to `kick.cutoff` produces a live gain bridge into the kick voice's filter AudioParam; a different pad is unaffected.
4. **UI (jsdom):** a drumkit sampler renders the 8-column `drum-voice-rack` with M/S; a melodic sampler renders per-zone param blocks; editing a knob calls `setBaseValue` + mirrors.

## Risk / blast radius

- `SamplerVoice` grows (panner + sends + per-pad reads) — verify the existing sampler DSP tests stay green; keep the melodic single-zone path behaving as today.
- `SamplerEngine.params` becomes **dynamic** (depends on the keymap) — `wireEngineParams`, the automation registry, and the modulation destination dropdown must tolerate a changing param list. Re-render the rack when the kit/keymap changes.
- `drum-voice-rack` gains an engine-driven layout contract (`getRackLayout()`); the synth drums must keep its current curated/advanced split. Covered by the existing rack test + a new sampler rack test.
- Make the per-voice modulator binding work for the sampler (it currently has an empty modHost and no binding) — model on FM/Karplus; verify no regression to the existing sampler voice.

## Open questions resolved during brainstorm

- Modulation scope → per-pad params + LFO/ADSR modulators (full parity).
- Param set → standard drum set (TUNE/CUTOFF/RES/ATTACK/DECAY/LEVEL/PAN/REV/DLY).
- Pad scope → per keymap entry (kits AND melodic).
- Modulators → one shared host → per-pad destinations; amp env is a per-pad param.
- UI → reuse `drum-voice-rack` for drumkits; per-zone inline for melodic.
