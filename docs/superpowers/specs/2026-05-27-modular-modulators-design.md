# Modular Modulators (LFO + ADSR) Design

> **Goal:** Replace per-engine hardcoded LFOs and envelopes with a modular system. Each engine ships with at least one LFO + one ADSR; the user can add more, and route any of them to any param via a destination/depth UI that mirrors the per-clip automation panel.
>
> **Date:** 2026-05-27
>
> **Status:** Spec — ready for implementation planning.

---

## 1. Motivation

Today every engine hardcodes its envelopes and modulators:

- `Subtractive (PolySynth)` has LFO1 + LFO2 wired to fixed destinations.
- `Wavetable` has `wt-attack/decay/sustain/release` driving filter and amp.
- `FM` has per-operator envelopes embedded.
- `Karplus` has none.
- `TB303` has filter envelope embedded.

The user can tune the envelope times via knobs but can't change WHAT the envelope modulates. Adding a slow LFO to wobble pitch on a wavetable patch requires editing the engine source.

We want: modulators as first-class, routable, per-engine objects with the same connection metaphor as the per-clip automation lanes already in the inspector — the user picks a destination from a dropdown and dials a depth knob, and the destination knob visibly animates as the modulator runs.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│ Engine (Wavetable, Subtractive, FM, Karplus, TB303)      │
│                                                          │
│  ModulationHost                                          │
│   ├─ modulators: ModulatorState[]   (UI state)           │
│   └─ spawnVoice(ctx) → Map<id, ModulatorVoice>           │
│                                                          │
│  per voice (poly):                                       │
│   ├─ ModulatorVoices (one set per active note)           │
│   ├─ bindVoiceModulation():                              │
│   │     for each mod, for each connection:               │
│   │       mod.output → GainNode(depth*range) → AudioParam│
│   └─ engineVoice (osc → filter → amp → output)           │
│                                                          │
│  UI:                                                     │
│   buildParamUI(container, ctx)                           │
│   ├─ engine knobs (existing)                             │
│   └─ renderModulatorsPanel(container, host, registry)    │
└──────────────────────────────────────────────────────────┘

rAF loop:                                                   
  for each registered knob with active modulators:          
    offset = Σ mod.currentValue() * conn.depth              
    knob.setModulationOffset(offset)                        
```

Audio flow uses Web Audio nodes (sample-accurate). The UI animation uses an `rAF` loop polling each modulator's JS-mirrored `currentValue()` — the same separation already used for the automation tick.

---

## 3. Core types

`src/modulation/types.ts`:

```ts
export type ModulatorKind = 'lfo' | 'adsr';

export interface ModulationConnection {
  id: string;            // unique within the modulator
  paramId: string;       // destination, e.g. 'wt-cutoff'
  depth: number;         // -1..+1; final = mod.output * depth * (max - min)
}

export interface ModulatorState {
  id: string;            // 'lfo1', 'adsr1', 'lfo2', ...
  kind: ModulatorKind;
  enabled: boolean;
  connections: ModulationConnection[];

  // LFO-only
  rateHz?: number;       // 0.01..40 (free rate)
  waveform?: 'sine' | 'triangle' | 'square' | 'saw';
  bipolar?: boolean;
  syncToBpm?: boolean;
  syncRatio?: string;    // '1/4', '1/8T', '1/4.', ...

  // ADSR-only
  attackSec?: number;
  decaySec?: number;
  sustain?: number;      // 0..1
  releaseSec?: number;
}

export interface ModulatorVoice {
  output: AudioNode;
  trigger(time: number, opts: { gateDuration: number; accent?: boolean }): void;
  release(time: number): void;
  dispose(): void;
  currentValue(): number;    // for UI poll only
}

export interface ModulationHost {
  modulators: ModulatorState[];
  addModulator(kind: ModulatorKind): ModulatorState;
  removeModulator(id: string): void;
  setConnection(modId: string, conn: ModulationConnection): void;
  removeConnection(modId: string, connId: string): void;
  spawnVoice(ctx: AudioContext): Map<string, ModulatorVoice>;
  serialize(): ModulatorState[];
  deserialize(state: ModulatorState[]): void;
}
```

Notes:
- `connections.depth` is bipolar so a user can invert a modulation source.
- LFO bipolar=true emits −1..+1; bipolar=false emits 0..1.
- Per-voice instancing chosen (the answered question), so every active note has its own LFO+ADSR.

---

## 4. Voice implementations

### LFOVoice

`OscillatorNode` running continuously, recreated on trigger to reset phase per voice. Optional unipolar shift via DC offset summed in.

```ts
class LFOVoice implements ModulatorVoice {
  // see Section 3 of design discussion for the full body
}
```

Effective rate computation:

```ts
function effectiveRateHz(state: ModulatorState, bpm: number): number {
  if (!state.syncToBpm || !state.syncRatio) return state.rateHz ?? 1;
  const beatHz = bpm / 60;
  const cyclesPerBeat = SYNC_RATIO_MAP[state.syncRatio] ?? 1;
  return beatHz * cyclesPerBeat;
}

const SYNC_RATIO_MAP: Record<string, number> = {
  '4/1': 1/16, '2/1': 1/8, '1/1': 1/4, '1/2': 1/2, '1/4': 1,
  '1/8': 2, '1/16': 4, '1/32': 8,
  '1/2T': 3/4, '1/4T': 3/2, '1/8T': 3, '1/16T': 6,
  '1/2.': 1/3, '1/4.': 2/3, '1/8.': 4/3, '1/16.': 8/3,
};
```

LFOs subscribe to BPM changes (same hook as `fx.setBpmSync`).

### ADSRVoice

`ConstantSourceNode` with `offset` automated on trigger.

```ts
class ADSRVoice implements ModulatorVoice {
  // see Section 3 of design discussion for the full body
}
```

### bindVoiceModulation

Wires each modulator's `output` through a `GainNode(depth * paramRange)` into the destination AudioParam on this voice. Web Audio sums multiple sources into one AudioParam by design, so automation + multiple modulators on the same param coexist without extra code.

```ts
function bindVoiceModulation(
  voiceMods: Map<string, ModulatorVoice>,
  modulators: ModulatorState[],
  voiceParamMap: Record<string, AudioParam>,
  paramRanges: Record<string, { min: number; max: number }>,
): void { /* see design discussion */ }
```

---

## 5. UI

`src/modulation/modulation-ui.ts` exports `renderModulatorsPanel(container, deps)`.

Each engine's `buildParamUI` calls it after rendering its own knobs:

```
[Engine knobs row]
[Engine knobs row]
…
┌─ Modulators ─────────────────────────────────────────┐
│ [+ LFO]  [+ ADSR]                                    │
│                                                       │
│ ┌── LFO 1 [ON]  ●─ sine ▾  4Hz / sync 1/4 ▾  bi ☑ ──┐│
│ │ Routing:                                          ││
│ │  cutoff      ▾   depth ●━━━━━●━━━━ +0.45    [×]   ││
│ │  pitch       ▾   depth ●━●━━━━━━━━ +0.12    [×]   ││
│ │  [+ Destination]                                  ││
│ └───────────────────────────────────────────────────┘│
│ ┌── ADSR 1 [ON]   A:10ms  D:300ms  S:70%  R:300ms ──┐│
│ │ Routing:                                          ││
│ │  amp         ▾   depth ●━━━━━━━━●━ +1.00    [×]   ││
│ │  cutoff      ▾   depth ●━━━●━━━━━━ +0.50    [×]   ││
│ │  [+ Destination]                                  ││
│ └───────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

Destination dropdown reads the shared `automationRegistry` filtered by the engine's id prefix (same logic that filters the Automation tab — added in commit `dc9a700`).

`EngineUIContext` gains a `registry` field so engines can pass it through to `renderModulatorsPanel`:

```ts
export interface EngineUIContext {
  laneId: string;
  idPrefix: string;
  registerKnob: (k: unknown) => void;
  registry: Map<string, unknown>;   // NEW — read-only access to all registered knobs
}
```

`KnobHandle` gains a method for the modulation ring overlay:

```ts
interface KnobHandle {
  // ... existing
  setModulationOffset(offsetNormalized: number): void;  // -1..+1
}
```

`createKnob` is updated to draw a secondary amber arc/ring at `value + offset` whenever `setModulationOffset` is called. Subtle motion is preserved; the user's base value indicator remains primary.

---

## 6. Per-engine integration plan

| Engine | Defaults | Migration |
|---|---|---|
| Subtractive | 2 LFOs (4Hz sine, 2Hz tri), 2 ADSRs (filter, amp), filter ADSR pre-connected to cutoff @ 0.5, amp ADSR pre-connected to amp @ 1.0 | Remove hardcoded LFO/ENV classes; existing presets get migrated via `migrateSubtractivePreset` |
| Wavetable | 1 LFO (4Hz sine), 1 ADSR pre-connected to amp@1.0 + cutoff@0.5 | Remove `wt-attack/decay/sustain/release` params; `migrateWavetablePreset` writes the equivalent ADSR |
| FM | 1 LFO + 1 ADSR (no connections by default) | Per-operator envelopes stay (part of FM identity). Modular pair is additive only. |
| Karplus | 1 LFO + 1 ADSR (no connections) | No existing envelopes to migrate. |
| TB303 | 1 LFO (no connections) | Filter envelope stays embedded (part of the 303 character). User can add an LFO for dub-wobble cutoff. |
| Drums | none | The modulation panel does not render for `engine.editor === 'drum-grid'`. |

---

## 7. Save / load

`ModulatorState[]` is part of:

- The engine's preset shape: `EnginePreset.modulators?: ModulatorState[]`.
- The Session lane's live state: `SessionLane.engineState?: { modulators: ModulatorState[] }`.

Loading order on Session boot:
1. `migrateLoadedSessionState` runs (already exists) — passes modulator state through untouched if present.
2. Per-engine preset migrators run lazily when a preset is applied to populate modulators from legacy param shapes (e.g. `wt-attack` → ADSR).

---

## 8. Automation registry interaction

**Universal rule (user requirement): every user-interactable control is automatable.** That means modulator knobs ARE registered:

- LFO `rate`, `depth-per-connection`, `enabled` (boolean → 0/1).
- LFO `waveform`, `bipolar`, `syncToBpm`, `syncRatio` (selects/toggles — see §8.1).
- ADSR `attack`, `decay`, `sustain`, `release`, `enabled`, `depth-per-connection`.

Param-id naming: `<laneId>.mod.<modId>.<field>` e.g. `main.mod.lfo1.rate`, `main.mod.lfo1.conn.cutoff.depth`, `main.mod.adsr1.attack`. Connection-depth params are created/destroyed when the user adds or removes a connection.

Modulators are simultaneously **sources** (their output is wired into other AudioParams) AND **destinations** (their config knobs are normal registered knobs that automation lanes can target).

Modulation and automation coexist on every AudioParam via Web Audio's built-in summation:

```
final = clamp(automation_value + Σ modulator.output * connection.depth, min, max)
```

Visually, the knob shows:
- Base position from the user knob value (or current automation override).
- Amber secondary indicator from the rAF-summed modulation offset.

### 8.1 Discrete-value automation (selects + toggles)

Some controls are not continuous (preset selectors, waveform menus, on/off toggles). Automation values are normalised 0..1; the host quantises to the option index:

- **Toggle** (`enabled`, `bipolar`, `syncToBpm`): `value >= 0.5 → on`.
- **Enum select** (waveform with N options): `optionIdx = Math.min(N-1, Math.floor(value * N))`.

`KnobHandle` already abstracts value → display formatting. We add a sibling `SelectHandle` (or extend `KnobHandle` with `kind: 'select' | 'continuous' | 'toggle'`) so selects can register with the automation registry the same way knobs do.

### 8.2 Preset selectors are automatable too

The preset dropdown on every engine (currently lives in the synth tab) registers as a discrete-value param: `<laneId>.preset` with N options = engine.presets.length. Automating it switches presets at the scheduled step (applying the preset's params, which themselves are then automatable). Applying a preset writes the preset's param values to the corresponding base values; subsequent automation/modulation continues to layer on top.

### 8.3 Related bug — preset filtering (out of scope for this spec but flagged)

The preset selector currently shows ALL presets across all engines instead of filtering by the active lane's engine. This is a pre-existing bug — fix planned in a follow-up. Once the preset selector is also engine-filtered (mirroring what we did for the Automation tab dropdown in commit `dc9a700`), §8.2 above slots in cleanly.

---

## 9. Out of scope

- **Modulating the modulator**: LFO depth modulated by another LFO, etc. Future spec.
- **Modulation macros**: a knob the user assigns to drive multiple destinations at once. Future spec.
- **Mod matrix presets**: cross-preset modulation libraries. Future spec.
- **Drums modulation**: drum kits keep their per-voice envelopes; no modular surface for now.

---

## 10. Testing

Test framework: Vitest in node env (no `AudioContext`). Coverage:

- `effectiveRateHz(state, bpm)`: table of (state, bpm) → expected Hz.
- `computeWaveform(kind, phase, bipolar)`: known points (phase 0/0.25/0.5/0.75) for each waveform.
- `computeAdsrAt(secondsSinceTrigger, state, gateDuration)`: positions in attack/decay/sustain/release.
- `ModulationHostImpl.{add,remove}Modulator`: id uniqueness, default values per kind.
- `ModulationHostImpl.{set,remove}Connection`: id management.
- `ModulationHostImpl.serialize` / `deserialize` round-trip.
- `migrateWavetablePreset` and `migrateSubtractivePreset`: legacy params → modulators, idempotency.

Audio-path verification is manual: smoke test after Phase 1 (define types + host), Phase 2 (LFO+ADSR voices wired into one engine), and Phase 3 (per-engine integration).

---

## 11. File layout

```
src/
  modulation/
    types.ts                 — interfaces, ModulatorState, etc.
    modulation-host.ts       — ModulationHostImpl, bindVoiceModulation
    lfo-voice.ts             — LFOVoice
    adsr-voice.ts            — ADSRVoice
    waveform.ts              — computeWaveform, computeAdsrAt
    rate-sync.ts             — effectiveRateHz, SYNC_RATIO_MAP
    modulation-ui.ts         — renderModulatorsPanel, mod card UI
    preset-migration.ts      — migrate{Wavetable,Subtractive,...}Preset

  core/
    knob.ts                  — extended with setModulationOffset()

  engines/
    engine-types.ts          — EngineUIContext gains `registry`
    subtractive.ts           — uses ModulationHost
    wavetable.ts             — uses ModulationHost
    fm.ts                    — uses ModulationHost
    karplus.ts               — uses ModulationHost
    tb303.ts                 — uses ModulationHost (LFO only by default)
```

---

## 12. Migration order (phases)

1. **Foundation** — `src/modulation/types.ts`, `waveform.ts`, `rate-sync.ts`, `modulation-host.ts`, `lfo-voice.ts`, `adsr-voice.ts`. Pure types + helpers + voice classes. Vitest covers waveform/adsr/rate-sync.
2. **Knob extension** — `KnobHandle.setModulationOffset`, ring overlay rendering.
3. **EngineUIContext + UI panel** — extend `EngineUIContext` with `registry`; build `modulation-ui.ts`.
4. **Wavetable migration** — first engine to fully adopt the system. Drop hardcoded ADSR params, migrate presets. Manual smoke test: load a wavetable patch, verify it sounds the same as before, then move the ADSR off amp and onto something else.
5. **Subtractive migration** — bigger because of the two LFOs and two envelopes.
6. **FM + Karplus + TB303** — additive only (default modulators with no connections).
7. **Persistence + automation registry pass** — Session save schema bump, ensure load round-trips modulators, confirm Automation tab still filters cleanly.
