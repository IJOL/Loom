# Synthesis Engines — Design Spec

## Overview

Add multiple synthesis techniques to the TB-303 synth app via a **Plugin Architecture**. Iconic synths (DX7/FM, ARP 2600) get their own tabs; generic techniques (wavetable, granular, additive, phase distortion, vector, formant) become selectable engines within the existing PolySynth host.

## Decisions

| Decision | Choice |
|----------|--------|
| Integration model | Hybrid: tabs for iconic synths, engines for generic techniques |
| Fidelity | Progressive: functional first, iterate toward faithful |
| Build order | Wavetable → FM → Granular → Physical Modeling → Additive → Phase Distortion → Vector → Formant |
| Polyphony | Configurable per engine (each declares its capability) |
| ARP 2600 style | Semi-modular: normalled connections with cable override |
| Sequencer | Each tab/engine has its own specialized sequencer |
| Pattern slots | Shared global system (all tracks switch together as a scene) |
| Constraints | Balance case by case, no single priority forced |
| Architecture | Plugin Architecture with shared interface + registry |

---

## 1. Engine Interface & Registry

### SynthEngine interface

```typescript
interface ParamDef {
  id: string
  label: string
  min: number
  max: number
  default: number
  curve?: 'linear' | 'exponential' | 'log'
  unit?: string
}

interface Voice {
  trigger(midi: number, time: number, options: { accent?: boolean; slide?: boolean; velocity?: number }): void
  release(time: number): void
  connect(dest: AudioNode): void
  dispose(): void
}

interface EngineSequencer {
  getStepAt(index: number): object
  setLength(n: number): void
  highlight(step: number): void
  serialize(): object
  deserialize(data: object): void
}

interface SynthEngine {
  id: string
  name: string
  type: 'polyhost' | 'tab'
  polyphony: number | 'mono'
  params: ParamDef[]
  createVoice(ctx: AudioContext, output: AudioNode): Voice
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer
  buildParamUI(container: HTMLElement): void
  dispose(): void
}
```

### Registry

A global `Map<string, SynthEngine>` where each engine self-registers on import. The PolySynth reads the registry to populate the engine selector dropdown; the tab system reads entries with `type: 'tab'`.

---

## 2. PolySynth Engine Plugins

Each lives in `src/engines/<id>.ts` and self-registers.

### Wavetable

- Buffer of N waveforms (sine, saw, square, PWM, vocal, organ, brass — generated algorithmically)
- "Morph" knob interpolates between adjacent tables using `PeriodicWave`
- Polyphonic (8 voices)
- Sequencer: step grid with morph position per step

### Granular

- Generates grains from an internal oscillator or generated buffer (no external samples in v1)
- Parameters: grain size (10-500ms), density (1-50 grains/s), pitch scatter, position
- Monophonic by default; optional 2-4 voices
- Sequencer: step grid with density/position per step

### Additive

- 16 individually controllable partials (amplitude + detuning)
- UI: vertical bar sliders for each partial
- Polyphonic up to 4 voices (16 oscillators x 4 = 64 oscs max)
- Sequencer: step grid with "spectral morph" between partial presets per step

### Phase Distortion

- Oscillator with phase distorted by an envelope curve (Casio CZ style)
- Parameters: waveform shape, PD depth, PD envelope (dedicated ADSR)
- Polyphonic (8 voices)
- Sequencer: step grid with PD depth per step

### Vector

- 4 sources (each can be a simple engine: wavetable, PD, saw, square)
- X/Y joystick mixes 4 amplitudes
- Polyphonic (4 voices)
- Sequencer: step grid with X/Y position per step

### Formant

- 5 parallel resonant filters with frequency/amplitude/Q tuned to vowels (A, E, I, O, U)
- Morph knob transitions between vowels
- Source: harmonically rich oscillator (saw/pulse)
- Polyphonic (6 voices)
- Sequencer: step grid with vowel target per step

---

## 3. Tab Synths

### DX7 / FM Synth

**Phase 1:**
- 4 operators, 8 algorithms (stacks, Y-shapes, parallel — most common topologies)
- Per operator: freq ratio, detune, output level, ADSR
- Feedback on operator 4
- Polyphonic (8 voices = 32 oscillators)
- UI: visual algorithm diagram + per-operator knob panel
- Sequencer: step grid with velocity + per-step algorithm switching

**Phase 2:**
- 6 operators, 32 algorithms
- 8-stage rate/level envelopes (faithful to YM2128)
- Key scaling, velocity sensitivity, LFO

### ARP 2600 (Semi-modular)

**Phase 1:**
- 3 VCOs (saw/square/sine/tri, sync, PWM)
- Noise generator (white/pink)
- VCF: LP24 (Moog-style ladder)
- VCA
- 1 ADSR envelope, 1 AR envelope
- 1 LFO, sample & hold
- Normalled routing: VCOs → mixer → VCF → VCA, ADSR → VCF cutoff, AR → VCA
- Monophonic
- Sequencer: step grid with gate/pitch + CV lanes for cutoff, PWM, etc.

**Phase 2:**
- Patch point overrides via SVG cable UI
- Dragging a cable from an output to an input disconnects the normalled path and uses custom routing
- Visual bezier cables, right-click to delete

**Phase 3:**
- Spring reverb, ring modulator, lag processor, voltage processors

---

## 4. System Integration

### PolySynth as Host

- Engine selector dropdown replaces param panel with the selected engine's UI
- Voice allocator delegates to engine's `createVoice()` instead of its own oscillators
- Channel strip, mixer, sends, EQ remain unchanged — engine feeds the same input point
- Presets stored per engine in `src/engines/<id>-presets.ts`

### Tabs

- Added as collapsible/expandable sections like TB-303 and Drums
- Each tab creates its own AudioContext nodes, connects to master output
- Share global transport (play/stop/bpm) and pattern slot system

### Pattern Slots (Scenes)

- Serializing a slot includes: bass steps, drum steps, poly steps + engine id + engine step data, DX7 steps, ARP steps
- Switching slot triggers deserialization for each tab/engine

### Sequencer Coordination

- Central clock broadcasts `onStep(stepIndex, time)` to all registered engine sequencers
- Each engine sequencer decides what to do with the step (trigger notes, change params, etc.)
- All sequencers respect the global step count and transport state

---

## 5. File Structure

```
src/
  engines/
    registry.ts            — Map<string, SynthEngine>, register(), getEngine()
    engine-types.ts        — interfaces: SynthEngine, Voice, EngineSequencer, ParamDef
    wavetable.ts
    wavetable-presets.ts
    granular.ts
    additive.ts
    phase-distortion.ts
    vector.ts
    formant.ts
    fm/
      fm-engine.ts         — FMEngine (tab)
      fm-operators.ts      — Operator DSP logic
      fm-algorithms.ts     — 8 (then 32) algorithm topologies
      fm-presets.ts
      fm-sequencer.ts
      fm-ui.ts
    arp2600/
      arp-engine.ts        — ARP2600Engine (tab)
      arp-modules.ts       — VCO, VCF, VCA, Env, LFO, S&H classes
      arp-normalling.ts    — default signal routing
      arp-patcher.ts       — SVG cable UI (phase 2)
      arp-sequencer.ts
      arp-ui.ts
  synth.ts                 — TB-303 (unchanged)
  polysynth.ts             — refactored to use engine registry
  sequencer.ts             — adds onStep broadcast to registered engines
  main.ts                  — adds tabs for FM and ARP, engine selector in poly
```

---

## 6. Implementation Roadmap

| Phase | Engine | Type | Est. Cycles |
|-------|--------|------|-------------|
| 1 | Engine system (interfaces + registry + poly host refactor) | Infrastructure | 1 |
| 2 | Wavetable | PolySynth engine | 1 |
| 3 | FM / DX7 (4-op, 8 algorithms) | Tab | 2 |
| 4 | Granular | PolySynth engine | 1 |
| 5 | Physical Modeling (Karplus-Strong) | PolySynth engine | 1 |
| 6 | Additive | PolySynth engine | 1 |
| 7 | Phase Distortion | PolySynth engine | 1 |
| 8 | ARP 2600 (fixed routing + normalled) | Tab | 2 |
| 9 | Vector | PolySynth engine | 1 |
| 10 | Formant | PolySynth engine | 1 |
| 11 | ARP 2600 patcher (SVG cables) | Tab extension | 1-2 |
| 12 | DX7 expansion (6-op, 32 algos, 8-stage EG) | Tab extension | 1 |

Total: ~14-15 cycles. Each phase is independently shippable.

---

## 7. Key Constraints & Notes

- No external audio samples in v1 — all synthesis is algorithmic/oscillator-based
- Each engine must call `dispose()` cleanly when switched away from (no orphan AudioNodes)
- Engine sequencers receive the same `onStep` tick as the main sequencer — timing is shared, interpretation is independent
- Physical Modeling (Karplus-Strong) is not in the original priority list as a named engine but was chosen for the order — it uses delay-line feedback to simulate plucked strings and is CPU-light
- The registry pattern means adding a 9th or 10th engine in the future requires zero changes to host code — just a new file that calls `register()`
