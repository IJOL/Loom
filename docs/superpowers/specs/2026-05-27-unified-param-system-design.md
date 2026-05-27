# Unified Param System Design

> **Goal:** Replace three coexisting param-naming systems (automation registry IDs, engine `voiceParamMap` keys, hardcoded AudioParam literals) with ONE canonical per-engine param registry. Every modulator, automation lane, and knob shares a single id per param. Eliminate `lookupBare`, `extraPrefixes`, prefix-stripping, and the `main` / `poly` lane-id inconsistency.
>
> **Date:** 2026-05-27
>
> **Status:** Spec — ready for implementation planning.

---

## 1. Motivation

A background code review identified five distinct names for the single concept "TB-303 cutoff frequency" across the codebase, and a class of silent-failure bugs caused by the gap between them:

- `tb303.cutoff` — registry key (main.ts:456).
- `cutoff` — `voiceParamMap` key + `ParamDef.id` (tb303.ts:120, 19).
- `bass.cutoff` — alternate registry id when the lane id prefix kicks in (session-host.ts:372).
- `filter.frequency` — actual AudioParam.
- `synth.params.cutoff` — separate normalized 0..1 state value.

Symptoms:
- **TB-303 voiceParamMap omits 4 of 6 declared params.** `accent`, `envMod`, `decay`, `wave` cannot be modulated; the dropdown lists them, the connection is stored, but `lookupBare` returns `undefined` and the connection is silently discarded.
- **Wavetable has ZERO overlap** between its knob IDs (`wt-morph`, `wt-detune`, `wt-filterCutoff`, `wt-filterRes`) and its `voiceParamMap` (`wt-amp`, `wt-cutoff`). Every wavetable modulation routing silently fails.
- **FM** is 0-indexed in knob IDs (`fm-op0-level`) and 1-indexed in `voiceParamMap` (`fm-op1-level`). Off-by-one.
- **Karplus** uses different vocabulary in each layer (`ks-damping` knob ↔ `ks-loop-cut` voiceParam).
- **TB-303 LFO→resonance is silent in playback** even when routed correctly: `synth.ts:83, 98` calls `filter.frequency.cancelScheduledValues(time) + setValueAtTime + linearRampToValueAtTime` on every trigger, dominating the destination AudioParam and drowning out the summed LFO contribution.

The fix touches the data model, the audio architecture, and the lane wiring. It is a coordinated refactor, not a fix in any one file.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│ SynthEngine                                              │
│   params: EngineParamSpec[]                              │
│   getBaseValue(id) / setBaseValue(id, v)                 │
│   createVoice(ctx, output) → Voice                       │
│                                                          │
│ Voice                                                    │
│   getAudioParams(): Map<id, AudioParam>                  │
│   trigger / release / dispose                            │
│                                                          │
│ ┌─ Per-voice internal audio graph ─────────────────────┐ │
│ │                                                      │ │
│ │   ConstantSourceNode (env)──┐                        │ │
│ │   ConstantSourceNode (env)──┼─→ filter.frequency     │ │
│ │   ConstantSourceNode (env)──┤   (Web Audio summing)  │ │
│ │   LFO via depth gain     ───┤                        │ │
│ │   ADSR via depth gain    ───┘                        │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                            ▲
                            │ id used in all three places:
       ┌────────────────────┼─────────────────────┐
       │                    │                     │
 automation                lane                modulator
 lane registry           host knob            destination
 `<laneId>.filter.cutoff` `<laneId>.filter.cutoff` `<laneId>.filter.cutoff`
```

---

## 3. Core types

`src/engines/engine-params.ts` (new):

```ts
export interface EngineParamSpec {
  id: string;            // dot-namespaced within engine: 'filter.cutoff', 'amp.attack', 'osc1.level'
  label: string;         // user-facing, e.g. 'Cutoff'
  kind: 'continuous' | 'discrete';
  min: number;           // 0..1 for continuous, [0, options.length - 1] for discrete
  max: number;
  default: number;
  curve?: 'linear' | 'exponential' | 'log';
  unit?: string;         // 'Hz', 's', '%', etc.
  options?: Array<{ value: string; label: string }>;   // only when kind === 'discrete'
}
```

`SynthEngine` (in `src/engines/engine-types.ts`) gains:

```ts
export interface SynthEngine {
  // ...existing: id, name, type, polyphony, editor, presets, ...
  /** Single source of truth for which params this engine has. Drives every
   *  knob, automation registry entry, and modulator destination. */
  params: EngineParamSpec[];

  /** Engine-level state read/write (the "base value"). Knobs write via
   *  setBaseValue on user drag; automation also writes here per step. */
  getBaseValue(id: string): number;
  setBaseValue(id: string, value: number): void;

  // ...existing: createVoice, buildSequencer, buildParamUI, applyPreset, dispose.
}
```

The `Voice` interface (also in `engine-types.ts`) gains:

```ts
export interface Voice {
  trigger(midi: number, time: number, options: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  dispose(): void;
  /** Per-voice AudioParams keyed by EngineParamSpec.id. The modulator binder
   *  connects each enabled connection through a depth-gain into the matching
   *  entry. Voices may omit ids whose kind === 'discrete'. */
  getAudioParams(): Map<string, AudioParam>;
}
```

The legacy `voiceParamMap` / `paramRanges` literal in each engine **disappears**. The voice itself answers `getAudioParams()`.

---

## 4. Audio architecture: sum-everything via ConstantSourceNode

Each engine maintains, per voice, a `ConstantSourceNode` per **continuous** param. That node's `offset` AudioParam is the engine's internal "envelope source". All `cancelScheduledValues / setValueAtTime / linearRampToValueAtTime` calls happen on `node.offset`, never on the destination AudioParam (`filter.frequency`, `amp.gain`, etc.).

The node connects directly to the destination AudioParam. The modulator system (LFO/ADSR) also connects to the destination via depth-gains. Web Audio sums all sources.

```ts
// Inside a TB-303 voice creation:
const envCutoff = ctx.createConstantSource();
envCutoff.offset.value = 0;
envCutoff.start();
envCutoff.connect(filter.frequency);

// On every trigger, schedule on envCutoff.offset (NOT filter.frequency):
envCutoff.offset.cancelScheduledValues(time);
envCutoff.offset.setValueAtTime(0, time);
envCutoff.offset.linearRampToValueAtTime(peakHz - baseHz, time + attack);
// ... etc.

// filter.frequency.value stays at baseHz (the resting value).
filter.frequency.value = baseHz;
```

Now LFO and ADSR also connect to `filter.frequency` independently. The final value is:

```
filter.frequency(t) = baseHz + envCutoff(t) + LFO(t)*depth + ADSR(t)*depth
```

Web Audio sums all four. The engine NEVER clobbers the destination's modulation contribution.

**Range semantics**: the engine's env contributes 0..(peak-base) Hz (or whatever). The LFO contributes ±(depth * range) Hz. They share the destination cleanly. AudioParam internal clamping handles overshoot musically.

---

## 5. Lane host wiring (single source of truth)

`src/main.ts` boots a generic lane-host loop:

```ts
function wireLane(laneId: string, engineId: string): void {
  const engine = createEngineInstance(engineId);    // factory
  for (const spec of engine.params) {
    const registryId = `${laneId}.${spec.id}`;
    if (spec.kind === 'continuous') {
      const knob = createKnob({
        id: registryId,
        label: spec.label,
        min: spec.min, max: spec.max, default: spec.default,
        value: engine.getBaseValue(spec.id),
        onChange: (v) => engine.setBaseValue(spec.id, v),
        format: makeFormatter(spec.unit),
      });
      registerKnob(knob);
    } else {
      const sel = createSelectControl({
        id: registryId,
        label: spec.label,
        options: spec.options!,
        initialValue: String(engine.getBaseValue(spec.id)),
        onChange: (v) => engine.setBaseValue(spec.id, /* idx of v */),
      });
      registerKnob(sel.handle);
    }
  }
}
```

When a voice is created for that lane:

```ts
function bindVoiceToModulators(laneId: string, voice: Voice): void {
  const audioParams = voice.getAudioParams();
  // Build (registryId → AudioParam) map for the modulator binder.
  const destMap = new Map<string, AudioParam>();
  for (const [id, ap] of audioParams) {
    destMap.set(`${laneId}.${id}`, ap);
  }
  // ConnectionBinder.apply takes destMap; matches by FULL registry id; no
  // prefix-stripping, no lookupBare.
  binder.apply(voiceMods, modulators, destMap, paramRangesByRegistryId, ctx);
}
```

The modulator destination dropdown lists registry keys filtered by `${laneId}.`. They match `destMap` keys 1:1.

---

## 6. Deletions (cleanup)

The following are removed entirely:

- `lookupBare` (in `connection-binder.ts` and duplicated in `modulation-host.ts`).
- `extraPrefixes` field on `ModulationUIDeps`.
- Per-engine `voiceParamMap` and `paramRanges` literals (replaced by `voice.getAudioParams()`).
- The `onVoice` callback in `polysynth.ts:170` and the hardcoded `{ amp, cutoff, resonance, pitch }` literal.
- `polysynth-ui.ts` walking the polysynth state tree to build `poly.*` knob ids. Replaced by the lane-host loop reading from `subtractiveEngine.params`.
- `cutoffParam`, `resonanceParam`, `ampParam` getters on `src/core/synth.ts:54-59` (no longer needed; the voice exposes them via `getAudioParams`).
- The `idPrefix` field of `EngineUIContext` (was rarely used and confusing; lane host handles all id prefixing now).
- Two-arg `extraPrefixes` argument to `destinationIds` — replaced by single laneId prefix.

The following are simplified:

- `ConnectionBinder.apply` takes `destMap: Map<string, AudioParam>` (full registry ids), no separate `paramRanges` argument — ranges live on `EngineParamSpec` and the binder gets a parallel `rangeMap: Map<string, ParamRange>` from the lane host.

---

## 7. Per-engine refactor plan

In order of decreasing fragility:

**TB-303** (`src/engines/tb303.ts` + `src/core/synth.ts`):
- Declare 6 `EngineParamSpec` entries (cutoff/resonance/envMod/decay/accent/wave).
- `wave` is `discrete` with options `[{ value: 'sawtooth', ... }, { value: 'square', ... }]`.
- Voice creates one `ConstantSourceNode` per continuous param connected to its destination (filter.frequency, filter.Q, amp.gain). Hardcoded synth.ts envelope scheduling moves to these envelope nodes.
- `getAudioParams()` returns `{ 'filter.cutoff': filter.frequency, 'filter.resonance': filter.Q, 'amp.gain': amp.gain }`. Other params are state-only (envMod, decay, accent) — no voice AudioParam exposed.
- Removes `cancelScheduledValues` on the destination AudioParams.

**Wavetable** (`src/engines/wavetable.ts`):
- Declare full `EngineParamSpec[]` covering wave morph, detune, filter cutoff/res, amp env, etc.
- Voice exposes all of them via `getAudioParams()` (continuous params with AudioParam) or via state-only.
- Existing ADSR scheduling moves to a `ConstantSourceNode.offset` per envelope-target.

**FM** (`src/engines/fm.ts`):
- Fix the 0/1-index mismatch. All op IDs become 1-indexed in the spec (`op1.ratio`, `op2.level`, etc.).
- Declare full param list.

**Karplus** (`src/engines/karplus.ts`):
- Declare full param list. Unify vocabulary (drop the `ks-damping` vs `ks-loop-cut` split — pick one).

**Subtractive** (`src/engines/subtractive.ts` + `src/polysynth/polysynth.ts`):
- The biggest one. `polysynth.ts` is the bulk of the param surface (osc1/2/sub/noise, filter, amp, master, lfo1/2).
- Declare ~30-40 `EngineParamSpec` entries spanning the polysynth.
- Polysynth's `trigger()` schedules amp + cutoff envelopes via internal `ConstantSourceNode`s, not directly.
- `polysynth-ui.ts` is **deleted** — the lane host's generic knob-building loop replaces it. Each knob ID is `${laneId}.${spec.id}`, no `poly.*` prefix.
- The two on-board LFOs in polysynth (`lfo1.target`, `lfo2.target`) become **first-class modulators in the engine's ModulationHost**, not standalone audio nodes. Their fixed-destination quirks (off/pitch/filter/amp/etc.) go away — the user just routes them via the modulator UI like any LFO.

**Drums** (`src/engines/drums-engine.ts`):
- Declare `EngineParamSpec[]` for the kit-level params (master gain, master tune) plus per-voice params for each drum (kick.level, snare.level, etc.). Most are state-only; per-voice AudioParams come from each DrumMachine sub-voice as appropriate.

---

## 8. Migration plan (no user data migration)

New app — there is no need to preserve any stored state, in-memory or persisted. Presets are rewritten in-source. Existing localStorage is wiped.

Phases:

1. **Types + interfaces**: `engine-params.ts`, extended `SynthEngine` + `Voice` interfaces. Existing engines fail typecheck.
2. **TB-303 first** (smallest engine, demonstrates the pattern): full refactor. Includes synth.ts internal-node ConstantSource layer.
3. **Lane-host generic loop**: replace hardcoded knob construction in main.ts.
4. **Wavetable**: same pattern as TB-303.
5. **FM + Karplus**: same.
6. **Subtractive (largest)**: polysynth.ts schedules via internal nodes, polysynth-ui.ts deleted, polysynth's LFOs become ModulationHost modulators.
7. **Drums**.
8. **Cleanup**: remove `lookupBare`, `extraPrefixes`, `voiceParamMap`/`paramRanges` literals, `getAudioParams` adapters, `idPrefix` field. Run typecheck — must be clean.

Each phase keeps `npx tsc --noEmit` clean and the existing 68 Vitest tests passing.

---

## 9. Testing

- New unit tests for `EngineParamSpec` consistency: `engine.params` ids and `voice.getAudioParams()` keys agree.
- New tests for the lane-host wiring: registering an engine's params produces the expected registry keys.
- Audio-path testing remains manual smoke (no Web Audio mock).

---

## 10. Out of scope (deferred)

- Modulators modulating other modulators.
- Macros (a single knob driving N depths).
- Custom param ranges in user saves.
- Preset library reorganization.

---

## 11. Success criteria

- `grep lookupBare src/` returns zero matches.
- `grep extraPrefixes src/` returns zero matches.
- `grep voiceParamMap src/` returns zero matches.
- The same `<laneId>.<paramId>` string appears in: the registry key, the automation lane paramId, the modulator destination dropdown, and `voice.getAudioParams()` keys (after the lane-host prefix). No translation between these layers.
- LFO routed to `<laneId>.filter.resonance` is audibly modulating filter Q without being clobbered by the engine's own trigger scheduling.
- All declared params in `engine.params` appear as routable destinations in the modulator panel. No `accent`/`envMod`/`decay`/`wave` style omissions.
