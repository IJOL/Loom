# Unified Param System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three coexisting naming systems (automation registry IDs, per-engine `voiceParamMap` keys, hardcoded AudioParam literals) with one canonical per-engine param registry. Same id everywhere: knob, automation, modulator destination, voice AudioParam.

**Architecture:** Each engine declares `params: EngineParamSpec[]`; the voice it creates exposes `getAudioParams(): Map<id, AudioParam>` keyed by those same ids. Engines stop writing scheduled values directly on destination AudioParams — instead each "envelope source" is a `ConstantSourceNode` whose output is connected to the destination, so Web Audio sums the engine's envelope, LFOs, and ADSRs as equal contributors.

**Tech Stack:** TypeScript strict, Web Audio API, Vite, Vitest (node env — pure tests only).

**Spec:** [docs/superpowers/specs/2026-05-27-unified-param-system-design.md](../specs/2026-05-27-unified-param-system-design.md)

---

## File map

| File | Status | Purpose |
|---|---|---|
| `src/engines/engine-params.ts` | create | `EngineParamSpec` interface + helpers |
| `src/engines/engine-params.test.ts` | create | Pure tests for spec validators |
| `src/engines/engine-types.ts` | modify | Replace `ParamDef` with `EngineParamSpec`; extend `SynthEngine` (getBaseValue/setBaseValue/params); extend `Voice` (getAudioParams); drop `idPrefix` from `EngineUIContext` |
| `src/core/synth.ts` | modify | TB-303 uses internal `ConstantSourceNode`s for env writes; never `cancelScheduledValues` on `filter.frequency`/`filter.Q`/`amp.gain` |
| `src/engines/tb303.ts` | modify | Declare full params list; voice.getAudioParams; drop voiceParamMap/paramRanges/configureTB303 hacks |
| `src/main.ts` | modify | Generic lane-host loop replaces hardcoded TB-303 knob construction (lines ~456–469) |
| `src/engines/wavetable.ts` | modify | Declare params, expose getAudioParams; envelopes go through internal ConstantSourceNode |
| `src/engines/fm.ts` | modify | Fix 0/1-index mismatch; declare params; getAudioParams; internal env nodes per operator |
| `src/engines/karplus.ts` | modify | Unify vocabulary (drop ks-damping vs ks-loop-cut split); declare params; getAudioParams |
| `src/engines/subtractive.ts` | modify | Declare ~30 params spanning polysynth; getAudioParams; polysynth's LFOs become ModulationHost modulators |
| `src/polysynth/polysynth.ts` | modify | Internal env nodes; drop the literal `onVoice({amp,cutoff,resonance,pitch})`; expose per-voice AudioParams via voice handle |
| `src/polysynth/polysynth-ui.ts` | **delete** | Generic lane-host loop replaces it |
| `src/polysynth/polysynth-presets.ts` | modify | Drop dependency on polysynth-ui; presets call `engine.setBaseValue` |
| `src/engines/drums-engine.ts` | modify | Declare kit-level + per-voice params; getAudioParams |
| `src/modulation/connection-binder.ts` | modify | Drop `lookupBare`; `apply` takes pre-keyed `destMap: Map<string, AudioParam>` |
| `src/modulation/modulation-host.ts` | modify | Drop the duplicate `lookupBare`; drop `bindVoiceModulation` (replaced by `ConnectionBinder.apply` everywhere) |
| `src/modulation/modulation-ui.ts` | modify | Drop `extraPrefixes`; destination dropdown filters only by laneId |
| `src/engines/engine-selector-ui.ts` | modify | Drop fallback knob-row (now handled by lane-host) |

---

## Verification pattern

Each task ends with:
- `npx tsc --noEmit` → clean.
- `npm test` → all green.
- Manual smoke when relevant.

Audio-path testing is manual (Vitest is in node env, no AudioContext). Pure logic — engine.params declaration, registry id construction, lookup wiring — is unit-tested.

---

# Phase 1 — Foundation types

## Task 1: `EngineParamSpec` + helpers

**Files:**
- Create: `src/engines/engine-params.ts`
- Create: `src/engines/engine-params.test.ts`

- [ ] **Step 1: Write the failing test**

Create `c:\Users\nacho\git\tb303-synth\src\engines\engine-params.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isContinuous, isDiscrete, validateSpec, type EngineParamSpec } from './engine-params';

describe('EngineParamSpec validators', () => {
  it('isContinuous returns true for continuous specs', () => {
    const s: EngineParamSpec = { id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous', min: 0, max: 1, default: 0.5 };
    expect(isContinuous(s)).toBe(true);
    expect(isDiscrete(s)).toBe(false);
  });

  it('isDiscrete returns true for discrete specs with options', () => {
    const s: EngineParamSpec = {
      id: 'osc.wave', label: 'Wave', kind: 'discrete',
      min: 0, max: 1, default: 0,
      options: [{ value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Sqr' }],
    };
    expect(isDiscrete(s)).toBe(true);
    expect(isContinuous(s)).toBe(false);
  });

  it('validateSpec rejects continuous specs missing min/max ordering', () => {
    const bad: EngineParamSpec = { id: 'x', label: 'X', kind: 'continuous', min: 1, max: 0, default: 0 };
    expect(() => validateSpec(bad)).toThrow();
  });

  it('validateSpec rejects discrete specs without options', () => {
    const bad = { id: 'x', label: 'X', kind: 'discrete', min: 0, max: 0, default: 0 } as EngineParamSpec;
    expect(() => validateSpec(bad)).toThrow();
  });

  it('validateSpec accepts a well-formed continuous spec', () => {
    expect(() => validateSpec({ id: 'a.b', label: 'AB', kind: 'continuous', min: 0, max: 1, default: 0.5 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- engine-params
```
Expected: FAIL "Cannot find module './engine-params'".

- [ ] **Step 3: Implement**

Create `c:\Users\nacho\git\tb303-synth\src\engines\engine-params.ts`:

```ts
// src/engines/engine-params.ts
// Canonical per-engine param schema. Drives knob construction, automation
// registry ids, modulator destination ids, and voice AudioParam lookup.
// One id per param, used in every layer.

export interface EngineParamSpec {
  id: string;              // dot-namespaced within engine: 'filter.cutoff', 'amp.attack', 'osc1.level'
  label: string;           // user-facing
  kind: 'continuous' | 'discrete';
  min: number;             // continuous: param range; discrete: 0
  max: number;             // continuous: param range; discrete: options.length - 1
  default: number;         // continuous: initial value; discrete: index of default option
  curve?: 'linear' | 'exponential' | 'log';
  unit?: string;
  options?: Array<{ value: string; label: string }>;   // only when kind === 'discrete'
}

export function isContinuous(s: EngineParamSpec): boolean {
  return s.kind === 'continuous';
}

export function isDiscrete(s: EngineParamSpec): boolean {
  return s.kind === 'discrete';
}

export function validateSpec(s: EngineParamSpec): void {
  if (!s.id || !s.id.length) throw new Error(`spec.id required`);
  if (!s.label) throw new Error(`spec.label required: ${s.id}`);
  if (s.kind === 'continuous') {
    if (!(s.max > s.min)) throw new Error(`spec ${s.id} must satisfy max > min`);
  } else {
    if (!s.options || s.options.length < 2) throw new Error(`spec ${s.id} (discrete) needs at least 2 options`);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

```
npm test -- engine-params
```
Expected: PASS, 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/engines/engine-params.ts src/engines/engine-params.test.ts
git commit -m "feat(engines): EngineParamSpec types + validators

Single source of truth for engine param schema. Each spec carries id
(dot-namespaced within engine), label, kind ('continuous' or 'discrete'),
min/max/default, optional curve/unit/options. Replaces the older
ParamDef interface and the ad-hoc voiceParamMap literals."
```

---

## Task 2: Extend `SynthEngine` + `Voice` interfaces

**Files:**
- Modify: `src/engines/engine-types.ts`

- [ ] **Step 1: Make the changes**

Open `c:\Users\nacho\git\tb303-synth\src\engines\engine-types.ts`. Apply these edits:

a) Replace the entire `ParamDef` interface with a re-export from the new module:

```ts
export type { EngineParamSpec } from './engine-params';
// Back-compat alias: code transitioning to the new name can still reference ParamDef.
export type ParamDef = import('./engine-params').EngineParamSpec;
```

b) Extend the `Voice` interface — add `getAudioParams()`:

```ts
export interface Voice {
  trigger(midi: number, time: number, options: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  dispose(): void;
  /** Per-voice AudioParams keyed by EngineParamSpec.id. The modulator binder
   *  connects each enabled connection through a depth-gain into the matching
   *  entry. Discrete-only params may be absent. */
  getAudioParams(): Map<string, AudioParam>;
}
```

c) Drop `idPrefix` from `EngineUIContext` (the lane-host loop handles all id prefixing now):

```ts
export interface EngineUIContext {
  laneId: string;
  registerKnob: (k: unknown) => void;
  registry: Map<string, unknown>;
}
```

d) Extend the `SynthEngine` interface — add `getBaseValue`/`setBaseValue`. The existing `params` field is now `EngineParamSpec[]` via the alias:

```ts
export interface SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type: 'polyhost' | 'tab';
  readonly polyphony: 'mono' | 'poly';
  readonly editor: 'piano-roll' | 'drum-grid';
  readonly params: import('./engine-params').EngineParamSpec[];
  readonly presets: EnginePreset[];
  /** Read the engine's current scalar state for a param. Knob + automation
   *  read here when re-syncing UI. */
  getBaseValue(id: string): number;
  /** Write the engine's scalar state. Called by the knob (user drag) and by
   *  automation lanes (per step). Engines use this to update internal state
   *  that future triggers read from. */
  setBaseValue(id: string, value: number): void;
  createVoice(ctx: AudioContext, output: AudioNode): Voice;
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer;
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void;
  applyPreset(name: string): void;
  randomize?(): void;
  dispose(): void;
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: errors in every engine file (they don't implement the new fields yet). Tasks 3+ fix them.

- [ ] **Step 3: Commit**

```bash
git add src/engines/engine-types.ts
git commit -m "feat(engines): extend SynthEngine + Voice interfaces

SynthEngine gains getBaseValue/setBaseValue + params now typed
as EngineParamSpec[]. Voice gains getAudioParams() returning a
Map<id, AudioParam>. EngineUIContext drops idPrefix (lane-host handles
all prefixing now). Existing engines fail typecheck until they
implement the new contract — fixed in subsequent tasks."
```

---

# Phase 2 — TB-303 reference implementation

## Task 3: TB-303 internal envelope nodes (`src/core/synth.ts`)

**Files:**
- Modify: `src/core/synth.ts`

The current `synth.ts trigger()` calls `cancelScheduledValues + setValueAtTime + linearRampToValueAtTime` on `filter.frequency`, `filter.Q`, and `amp.gain`. This clobbers any summed modulator contribution. Fix: route each scheduled write through an internal `ConstantSourceNode`, never the destination directly.

- [ ] **Step 1: Add internal env nodes**

Open `c:\Users\nacho\git\tb303-synth\src\core\synth.ts`. In the `TB303` constructor, after the filter + amp + oscillator setup, add:

```ts
// Internal envelope sources: scheduling happens on these nodes' .offset, and
// they sum into the destination AudioParams. The destination filter.frequency
// / filter.Q / amp.gain are NEVER scheduled directly — that would clobber
// summed contributions from external modulators (LFOs, ADSRs).
this.envCutoff = ctx.createConstantSource();
this.envCutoff.offset.value = 0;
this.envCutoff.start();
this.envCutoff.connect(this.filter.frequency);

this.envRes = ctx.createConstantSource();
this.envRes.offset.value = 0;
this.envRes.start();
this.envRes.connect(this.filter.Q);

this.envAmp = ctx.createConstantSource();
this.envAmp.offset.value = 0;
this.envAmp.start();
this.envAmp.connect(this.amp.gain);

// Base values (the "resting" position) stay on the destination params. They
// don't move per trigger — only the env contributions do.
this.filter.frequency.value = 0;   // env writes the actual frequency
this.filter.Q.value = 0;           // env writes the actual Q
this.amp.gain.value = 0;           // env writes the actual gain
```

Declare the new fields at the top of the class:

```ts
private envCutoff!: ConstantSourceNode;
private envRes!: ConstantSourceNode;
private envAmp!: ConstantSourceNode;
```

- [ ] **Step 2: Redirect trigger scheduling**

In `trigger()`, replace every `this.filter.frequency.<schedule>` with `this.envCutoff.offset.<schedule>`. Same for `filter.Q` → `envRes.offset`, `amp.gain` → `envAmp.offset`. Critically: remove every `cancelScheduledValues` call on the destination AudioParams — the cancellation now happens on the env nodes' `offset`.

Concretely, the existing trigger code looks like:

```ts
filter.frequency.cancelScheduledValues(time);
filter.frequency.setValueAtTime(baseHz, time);
filter.frequency.linearRampToValueAtTime(peakHz, time + attack);
filter.frequency.linearRampToValueAtTime(sustainHz, time + attack + decay);
// ... + release ramp ...
filter.Q.cancelScheduledValues(time);
filter.Q.setValueAtTime(q, time);
// ... + accent boost ...
amp.gain.cancelScheduledValues(time);
amp.gain.setValueAtTime(0, time);
amp.gain.linearRampToValueAtTime(peakAmp, time + ampAttack);
// ... + release ramp ...
```

Replace with:

```ts
this.envCutoff.offset.cancelScheduledValues(time);
this.envCutoff.offset.setValueAtTime(baseHz, time);
this.envCutoff.offset.linearRampToValueAtTime(peakHz, time + attack);
this.envCutoff.offset.linearRampToValueAtTime(sustainHz, time + attack + decay);
// ... + release ramp on envCutoff.offset ...
this.envRes.offset.cancelScheduledValues(time);
this.envRes.offset.setValueAtTime(q, time);
// ... + accent boost on envRes.offset ...
this.envAmp.offset.cancelScheduledValues(time);
this.envAmp.offset.setValueAtTime(0, time);
this.envAmp.offset.linearRampToValueAtTime(peakAmp, time + ampAttack);
// ... + release ramp on envAmp.offset ...
```

Drop the existing `cutoffParam`/`resonanceParam`/`ampParam` getters (lines ~54-59) — they're no longer needed since the engine's voice exposes them via `getAudioParams`.

- [ ] **Step 3: Typecheck**

```
npx tsc --noEmit
```
Expected: errors in tb303.ts (the engine still references cutoffParam etc.). Task 4 fixes those.

- [ ] **Step 4: Commit**

```bash
git add src/core/synth.ts
git commit -m "fix(synth): route TB-303 envelopes through internal ConstantSourceNodes

cancelScheduledValues + setValueAtTime + linearRampToValueAtTime no
longer touch filter.frequency / filter.Q / amp.gain directly. Each
destination AudioParam now sees the sum of the engine's env node
contribution + any connected modulator (LFO/ADSR). This eliminates
the silent-clobber bug where LFO routed to filter.Q was wiped by
each trigger's Q scheduling."
```

---

## Task 4: TB-303 engine declares full params + getAudioParams

**Files:**
- Modify: `src/engines/tb303.ts`

- [ ] **Step 1: Declare full param list**

Open `c:\Users\nacho\git\tb303-synth\src\engines\tb303.ts`. Replace the existing `PARAMS` array with the full spec list using `EngineParamSpec`:

```ts
import type { EngineParamSpec } from './engine-params';

const PARAMS: EngineParamSpec[] = [
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0,  max: 1,  default: 0.42, unit: '' },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0,  max: 1,  default: 0.55 },
  { id: 'env.amount',       label: 'Env',       kind: 'continuous', min: 0,  max: 1,  default: 0.5  },
  { id: 'env.decay',        label: 'Decay',     kind: 'continuous', min: 0,  max: 1,  default: 0.4  },
  { id: 'env.accent',       label: 'Accent',    kind: 'continuous', min: 0,  max: 1,  default: 0.6  },
  {
    id: 'osc.wave', label: 'Wave', kind: 'discrete',
    min: 0, max: 1, default: 0,
    options: [{ value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Sqr' }],
  },
];
```

- [ ] **Step 2: Implement `getBaseValue` / `setBaseValue`**

Add to the `TB303Engine` class:

```ts
getBaseValue(id: string): number {
  if (!this.lastInstance) return PARAMS.find(p => p.id === id)?.default ?? 0;
  const p = this.lastInstance.params;
  switch (id) {
    case 'filter.cutoff':    return p.cutoff;
    case 'filter.resonance': return p.resonance;
    case 'env.amount':       return p.envMod;
    case 'env.decay':        return p.decay;
    case 'env.accent':       return p.accent;
    case 'osc.wave':         return p.wave === 'square' ? 1 : 0;
  }
  return 0;
}

setBaseValue(id: string, v: number): void {
  if (!this.lastInstance) return;
  const p = this.lastInstance.params as Record<string, number | string>;
  switch (id) {
    case 'filter.cutoff':    p.cutoff = v;    return;
    case 'filter.resonance': p.resonance = v; return;
    case 'env.amount':       p.envMod = v;    return;
    case 'env.decay':        p.decay = v;     return;
    case 'env.accent':       p.accent = v;    return;
    case 'osc.wave':         p.wave = v >= 0.5 ? 'square' : 'sawtooth'; return;
  }
}
```

- [ ] **Step 3: Voice exposes `getAudioParams()`**

In the `TB303Voice` class (in the same file), add:

```ts
getAudioParams(): Map<string, AudioParam> {
  return new Map<string, AudioParam>([
    ['filter.cutoff',    this.tb303.filter.frequency],
    ['filter.resonance', this.tb303.filter.Q],
    ['amp.gain',         this.tb303.amp.gain],
  ]);
}
```

This requires exposing `filter` and `amp` as public on the TB303 class. In `src/core/synth.ts`, change those fields from `private` to `public readonly`.

- [ ] **Step 4: Drop legacy voiceParamMap + binders + rebindAll**

In `tb303.ts`, delete:
- The `binders: Array<{ ... }> = []` field and any `this.binders.push(...)` calls inside `createVoice`.
- The `rebindAll()` method.
- The local `voiceParamMap` / `paramRanges` literals in `createVoice`.

Replace the bind+record block in `createVoice` with:

```ts
const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm);
recordVoiceMods(voiceMods);
return new TB303Voice(tb, voiceMods);
```

The lane-host (Task 5) will call `voice.getAudioParams()` itself and pass that to the modulator binder.

- [ ] **Step 5: Typecheck**

```
npx tsc --noEmit
```
Expected: errors in main.ts (still references old hardcoded TB-303 knobs). Task 5 fixes.

- [ ] **Step 6: Commit**

```bash
git add src/engines/tb303.ts src/core/synth.ts
git commit -m "feat(tb303): declare unified params + voice.getAudioParams

TB303Engine.params now lists all 6 params (filter.cutoff/resonance,
env.amount/decay/accent, osc.wave) using EngineParamSpec. getBaseValue
/ setBaseValue route to the underlying TB303 instance.params. The
voice exposes its three modulatable AudioParams (filter.frequency,
filter.Q, amp.gain) via getAudioParams. The legacy voiceParamMap and
per-engine ConnectionBinder are gone — the lane-host owns wiring now."
```

---

## Task 5: Lane-host generic loop in `src/main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Write a helper function**

Open `c:\Users\nacho\git\tb303-synth\src\main.ts`. Find the existing TB-303 knob building loop (around lines 456–469 that iterates `SYNTH_KNOB_DEFS` and calls `synth.params[def.id] = v`). DELETE that block.

Replace with a generic helper:

```ts
import { createSelectControl } from './core/select-control';
import { ConnectionBinder } from './modulation/connection-binder';
import type { EngineParamSpec } from './engines/engine-params';
import type { SynthEngine, Voice } from './engines/engine-types';

interface LaneWiringDeps {
  laneId: string;
  engine: SynthEngine;
  parent: HTMLElement;        // container to append knobs into
  formatter?: (id: string, v: number) => string;
}

const laneBinders = new Map<string, ConnectionBinder>();

/** Walks engine.params, builds the knob/select per param, registers it
 *  under `<laneId>.<spec.id>`, and wires onChange to engine.setBaseValue. */
function wireLaneKnobs(deps: LaneWiringDeps): void {
  for (const spec of deps.engine.params) {
    const registryId = `${deps.laneId}.${spec.id}`;
    if (spec.kind === 'continuous') {
      const k = createKnob({
        id: registryId,
        label: spec.label,
        min: spec.min, max: spec.max,
        value: deps.engine.getBaseValue(spec.id),
        defaultValue: spec.default,
        onChange: (v) => deps.engine.setBaseValue(spec.id, v),
        format: deps.formatter ? (v) => deps.formatter!(spec.id, v) : undefined,
      });
      registerKnob(k);
      deps.parent.appendChild(k.el);
    } else {
      const { el, handle } = createSelectControl({
        id: registryId,
        label: spec.label,
        options: spec.options!,
        initialValue: spec.options![Math.round(deps.engine.getBaseValue(spec.id))]?.value
                      ?? spec.options![0].value,
        onChange: (v) => {
          const idx = spec.options!.findIndex((o) => o.value === v);
          deps.engine.setBaseValue(spec.id, idx);
        },
      });
      registerKnob(handle);
      deps.parent.appendChild(el);
    }
  }
}

/** When a voice is created for a lane, register its AudioParams under the
 *  lane-prefixed ids in destMap, and apply the lane's binder. */
function wireVoiceModulation(laneId: string, voice: Voice, ctx: AudioContext, modulators: import('./modulation/types').ModulatorState[], voiceMods: Map<string, import('./modulation/types').ModulatorVoice>, engineParams: EngineParamSpec[]): void {
  const audioParams = voice.getAudioParams();
  const destMap = new Map<string, AudioParam>();
  const rangeMap = new Map<string, { min: number; max: number }>();
  for (const [id, ap] of audioParams) {
    destMap.set(`${laneId}.${id}`, ap);
    const spec = engineParams.find((p) => p.id === id);
    if (spec) rangeMap.set(`${laneId}.${id}`, { min: spec.min, max: spec.max });
  }
  let binder = laneBinders.get(laneId);
  if (!binder) { binder = new ConnectionBinder(); laneBinders.set(laneId, binder); }
  binder.apply(voiceMods, modulators, destMap, rangeMap, ctx);
}
```

- [ ] **Step 2: Hook the helper for the built-in `bass` lane**

Right after `synth` is constructed (`const synth = new TB303(ctx, bassStrip.input);`), find where the existing TB-303 knob row was being built. Replace that whole block with:

```ts
const synthKnobsRow = $<HTMLDivElement>('synth-knobs');
synthKnobsRow.innerHTML = '';
wireLaneKnobs({
  laneId: 'bass',
  engine: tb303Engine,    // the singleton TB303Engine from registerEngine
  parent: synthKnobsRow,
  formatter: (id, v) => id.includes('decay') ? `${(v * 1000).toFixed(0)}ms` : fmtPct(v),
});
```

(`tb303Engine` is exported from `src/engines/tb303.ts` as the singleton — import it.)

- [ ] **Step 3: Typecheck + tests**

```
npx tsc --noEmit
npm test
```
Expected: clean + 68/68. Some Subtractive code may still reference the dropped `idPrefix` — fix those references by removing the field from any literal that builds an `EngineUIContext`.

- [ ] **Step 4: Smoke test**

`npm run dev`, open http://localhost:5173/. Verify the TB-303 lane's knobs render and respond. Routing an LFO to `bass.filter.resonance` should now produce audible wobble (the env-node refactor fixed the clobber).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): generic lane-host knob loop replaces TB-303 hardcoded build

wireLaneKnobs(laneId, engine, parent) walks engine.params, registers
each knob under '<laneId>.<spec.id>'. wireVoiceModulation builds the
destMap for ConnectionBinder from voice.getAudioParams(), prefixing
keys with the lane id so modulator destinations and binder lookup
match 1:1. No more lookupBare, no more per-engine voiceParamMap."
```

---

# Phase 3 — Wavetable

## Task 6: Wavetable internal env + params

**Files:**
- Modify: `src/engines/wavetable.ts`

Wavetable currently schedules amp + filter envelopes directly on `ampGain.gain` and `filter.frequency`. Refactor exactly like TB-303 in Task 3.

- [ ] **Step 1: Add internal env nodes per voice**

In `WavetableVoice` constructor, after the existing `ampGain` and `filter` setup:

```ts
this.envAmp = ctx.createConstantSource();
this.envAmp.offset.value = 0;
this.envAmp.start();
this.envAmp.connect(this.ampGain.gain);

this.envCutoff = ctx.createConstantSource();
this.envCutoff.offset.value = 0;
this.envCutoff.start();
this.envCutoff.connect(this.filter.frequency);

this.ampGain.gain.value = 0;
this.filter.frequency.value = 0;
```

Declare the fields:
```ts
private envAmp!: ConstantSourceNode;
private envCutoff!: ConstantSourceNode;
```

- [ ] **Step 2: Move ramps from ampGain/filter directly onto envAmp.offset/envCutoff.offset**

Find the wavetable `trigger()` body. Every `this.ampGain.gain.linearRampToValueAtTime(...)` and `setValueAtTime(...)` becomes `this.envAmp.offset.linearRampToValueAtTime(...)` etc. Same for `this.filter.frequency.*` → `this.envCutoff.offset.*`. Drop any `cancelScheduledValues` on `ampGain.gain` or `filter.frequency`.

- [ ] **Step 3: Replace PARAMS literal with EngineParamSpec[]**

```ts
const WT_PARAMS: EngineParamSpec[] = [
  { id: 'osc.morph',        label: 'Morph',     kind: 'continuous', min: 0,    max: 1,  default: 0.0 },
  { id: 'osc.detune',       label: 'Detune',    kind: 'continuous', min: -50,  max: 50, default: 0, unit: '¢' },
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0,    max: 1,  default: 0.55 },
  { id: 'filter.resonance', label: 'Res',       kind: 'continuous', min: 0,    max: 1,  default: 0.2 },
  { id: 'amp.attack',       label: 'Attack',    kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', curve: 'exponential' },
  { id: 'amp.decay',        label: 'Decay',     kind: 'continuous', min: 0.001, max: 2, default: 0.3,  unit: 's', curve: 'exponential' },
  { id: 'amp.sustain',      label: 'Sustain',   kind: 'continuous', min: 0,    max: 1,  default: 0.7 },
  { id: 'amp.release',      label: 'Release',   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', curve: 'exponential' },
];
```

Drop the existing `WT_PARAM_RANGES` map — ranges live on the specs now.

- [ ] **Step 4: Implement getBaseValue/setBaseValue + voice.getAudioParams**

```ts
getBaseValue(id: string): number {
  return this.paramValues[id] ?? WT_PARAMS.find(p => p.id === id)?.default ?? 0;
}
setBaseValue(id: string, v: number): void {
  this.paramValues[id] = v;
}
```

(`this.paramValues: Record<string, number>` may need adding to the class if it doesn't exist; check the file.)

In `WavetableVoice`:

```ts
getAudioParams(): Map<string, AudioParam> {
  return new Map<string, AudioParam>([
    ['amp.gain',         this.ampGain.gain],
    ['filter.cutoff',    this.filter.frequency],
    ['filter.resonance', this.filter.Q],
    // osc.morph + osc.detune are not directly AudioParams (they affect wavetable indexing); state-only.
  ]);
}
```

- [ ] **Step 5: Delete the legacy `binders` field, `rebindAll`, `voiceParamMap` + `paramRanges` literals**

Strip everything related to per-engine binder management. The lane-host does it now.

- [ ] **Step 6: Typecheck + tests + commit**

```
npx tsc --noEmit
npm test
```

```bash
git add src/engines/wavetable.ts
git commit -m "feat(wavetable): unified params + internal env nodes

Declares 8 EngineParamSpec entries spanning osc / filter / amp env.
Voice exposes amp.gain, filter.cutoff, filter.resonance via
getAudioParams. Envelope scheduling moves onto internal ConstantSource
nodes so modulator contributions sum cleanly on the destination params."
```

---

# Phase 4 — FM

## Task 7: FM internal envs + unified params

**Files:**
- Modify: `src/engines/fm.ts`

The FM engine has per-operator amp envelopes and a global modulation index. Per-op env scheduling currently writes directly to the operator's amp gain.

- [ ] **Step 1: Per-operator env nodes**

For each operator (op1, op2, op3, op4), in the voice constructor:

```ts
this.opEnvs[i] = ctx.createConstantSource();
this.opEnvs[i].offset.value = 0;
this.opEnvs[i].start();
this.opEnvs[i].connect(this.opAmps[i].gain);
this.opAmps[i].gain.value = 0;
```

In trigger, the op envelope ramps move from `this.opAmps[i].gain.*` to `this.opEnvs[i].offset.*`.

- [ ] **Step 2: Unified, 1-indexed params**

Replace the FM_PARAMS / FM knob defs with:

```ts
const FM_PARAMS: EngineParamSpec[] = [
  { id: 'op1.level',  label: 'Op1 Lvl',  kind: 'continuous', min: 0, max: 1, default: 1   },
  { id: 'op1.ratio',  label: 'Op1 Ratio', kind: 'continuous', min: 0.25, max: 16, default: 1, curve: 'exponential' },
  { id: 'op1.attack', label: 'Op1 Atk', kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'op1.decay',  label: 'Op1 Dec', kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  { id: 'op2.level',  label: 'Op2 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.5 },
  { id: 'op2.ratio',  label: 'Op2 Ratio', kind: 'continuous', min: 0.25, max: 16, default: 2 },
  { id: 'op2.attack', label: 'Op2 Atk', kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'op2.decay',  label: 'Op2 Dec', kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's' },
  // op3, op4 — analogous
  { id: 'amp.mix',    label: 'Mix',     kind: 'continuous', min: 0, max: 1, default: 0.7 },
];
```

(Fill in op3 + op4 entries the same way. If the engine only has 2 operators today, declare just op1+op2.)

This is the unified naming — 1-indexed everywhere. The 0-indexed knob ids and 1-indexed voiceParamMap inconsistency is gone.

- [ ] **Step 3: Implement getBaseValue/setBaseValue/getAudioParams**

```ts
getBaseValue(id: string): number {
  return this.paramValues[id] ?? FM_PARAMS.find(p => p.id === id)?.default ?? 0;
}
setBaseValue(id: string, v: number): void {
  this.paramValues[id] = v;
}
```

In FMVoice:

```ts
getAudioParams(): Map<string, AudioParam> {
  return new Map<string, AudioParam>([
    ['op1.level', this.opAmps[0].gain],
    ['op2.level', this.opAmps[1].gain],
    ['op1.ratio', this.opOscs[0].detune],   // expose ratio via detune AudioParam if applicable
    ['op2.ratio', this.opOscs[1].detune],
    ['amp.mix',   this.mixGain.gain],
  ]);
}
```

Drop the old voiceParamMap/paramRanges/binders.

- [ ] **Step 4: Commit**

```bash
git add src/engines/fm.ts
git commit -m "feat(fm): unified params (1-indexed) + internal env nodes per op

Fixes the 0/1-index mismatch between knob ids and voiceParamMap.
EngineParamSpec entries for op1..op2 (level, ratio, attack, decay)
plus amp.mix. Voice exposes the matching AudioParams via
getAudioParams. Op envelopes route through internal ConstantSource
nodes so the mod system can sum into op level / ratio cleanly."
```

---

# Phase 5 — Karplus

## Task 8: Karplus unified params + internal envs

**Files:**
- Modify: `src/engines/karplus.ts`

Karplus has a single amp envelope and loop filter cutoff. Unify the vocabulary (today `ks-damping` knob vs `ks-loop-cut` voiceParamMap — pick one).

- [ ] **Step 1: Internal env nodes**

In the voice constructor:

```ts
this.envAmp = ctx.createConstantSource();
this.envAmp.offset.value = 0;
this.envAmp.start();
this.envAmp.connect(this.ampGain.gain);
this.ampGain.gain.value = 0;
```

Move amp ramp scheduling onto `envAmp.offset` in trigger.

- [ ] **Step 2: Unified params**

```ts
const KARPLUS_PARAMS: EngineParamSpec[] = [
  { id: 'string.damping',    label: 'Damping',    kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'string.brightness', label: 'Brightness', kind: 'continuous', min: 0, max: 1, default: 0.5 },
  { id: 'excite.tone',       label: 'Exc Tone',   kind: 'continuous', min: 0, max: 1, default: 0.4 },
  { id: 'amp.attack',        label: 'Attack',     kind: 'continuous', min: 0.001, max: 2, default: 0.005, unit: 's' },
  { id: 'amp.release',       label: 'Release',    kind: 'continuous', min: 0.005, max: 4, default: 0.5,   unit: 's' },
  { id: 'amp.level',         label: 'Level',      kind: 'continuous', min: 0, max: 1, default: 0.7 },
];
```

- [ ] **Step 3: getBaseValue/setBaseValue + voice.getAudioParams**

```ts
getAudioParams(): Map<string, AudioParam> {
  return new Map<string, AudioParam>([
    ['amp.level',           this.ampGain.gain],
    ['string.damping',      this.loopFilter.frequency],
    ['excite.tone',         this.exciteFilter.frequency],
  ]);
}
```

(Adjust AudioParam references to actual karplus node names.)

- [ ] **Step 4: Commit**

```bash
git add src/engines/karplus.ts
git commit -m "feat(karplus): unified vocabulary + internal env nodes

EngineParamSpec entries use one consistent vocabulary
(string.damping/brightness, excite.tone, amp.*) instead of the
previous ks-damping (knob) vs ks-loop-cut (voiceParamMap) split.
Voice exposes the AudioParams under the same ids."
```

---

# Phase 6 — Subtractive (largest)

## Task 9: PolySynth internal env nodes + drop hardcoded onVoice

**Files:**
- Modify: `src/polysynth/polysynth.ts`

PolySynth's `trigger()` schedules amp and filter envelopes directly. Same pattern as TB-303.

- [ ] **Step 1: Per-voice internal env nodes**

When a voice is created inside polysynth, add:

```ts
const envAmp = ctx.createConstantSource();
envAmp.offset.value = 0;
envAmp.start();
envAmp.connect(amp.gain);
amp.gain.value = 0;

const envCutoff = ctx.createConstantSource();
envCutoff.offset.value = 0;
envCutoff.start();
envCutoff.connect(filter.frequency);
filter.frequency.value = 0;
```

Move every `amp.gain.<schedule>` and `filter.frequency.<schedule>` in trigger to `envAmp.offset.*` / `envCutoff.offset.*`. Drop the `cancelScheduledValues(time)` calls on `amp.gain` / `filter.frequency`.

- [ ] **Step 2: Voice handle exposes its AudioParams**

Today `onVoice({ amp, cutoff, resonance, pitch })` hardcodes the exposed AudioParams. Replace with: the voice handle (whatever polysynth.trigger returns or accepts as a callback) carries a `getAudioParams()` method, OR PolySynth stores per-voice `{ amp, cutoff, resonance, pitch, drive, ... }` in a `Map<voiceId, Map<string, AudioParam>>` accessible via `polysynth.getVoiceAudioParams(voiceId)`.

Pick the simpler form: the polysynth class gains a `getCurrentVoiceAudioParams(): Map<string, AudioParam> | null` method returning the params of the most-recently-triggered voice. (For polyphony this is approximate but matches what the engine wrapper expects.)

Drop the literal `onVoice({ amp: amp.gain, cutoff: filter.frequency, resonance: filter.Q, pitch: osc1.detune })` callback at line ~170. The PolyVoiceParams type is gone.

- [ ] **Step 3: Commit**

```bash
git add src/polysynth/polysynth.ts
git commit -m "fix(polysynth): internal env nodes + drop hardcoded onVoice literal

Amp and filter envelope ramps now route through ConstantSourceNode
internals; the destination AudioParams (amp.gain, filter.frequency)
never receive cancelScheduledValues so modulators sum cleanly. The
hardcoded { amp, cutoff, resonance, pitch } literal is gone — the
engine's voice will expose the same params via getAudioParams."
```

---

## Task 10: SubtractiveEngine declares full param list

**Files:**
- Modify: `src/engines/subtractive.ts`

- [ ] **Step 1: Declare ~30 specs spanning the polysynth surface**

```ts
const SUB_PARAMS: EngineParamSpec[] = [
  // Oscillators
  { id: 'osc1.level',   label: 'Osc1 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.5 },
  { id: 'osc1.detune',  label: 'Osc1 Det',  kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
  { id: 'osc1.wave',    label: 'Osc1 Wave', kind: 'discrete', min: 0, max: 3, default: 0,
    options: [{value: 'sawtooth', label: 'Saw'}, {value: 'square', label: 'Sqr'}, {value: 'triangle', label: 'Tri'}, {value: 'sine', label: 'Sin'}] },
  { id: 'osc2.level',   label: 'Osc2 Lvl',  kind: 'continuous', min: 0, max: 1, default: 0.0 },
  { id: 'osc2.detune',  label: 'Osc2 Det',  kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
  { id: 'osc2.wave',    label: 'Osc2 Wave', kind: 'discrete', min: 0, max: 3, default: 0,
    options: [{value: 'sawtooth', label: 'Saw'}, {value: 'square', label: 'Sqr'}, {value: 'triangle', label: 'Tri'}, {value: 'sine', label: 'Sin'}] },
  { id: 'sub.level',    label: 'Sub Lvl',   kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'noise.level',  label: 'Noise Lvl', kind: 'continuous', min: 0, max: 1, default: 0 },

  // Filter
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.55 },
  { id: 'filter.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.25 },
  { id: 'filter.envAmount', label: 'Env Amt',   kind: 'continuous', min: 0, max: 1, default: 0.45 },
  { id: 'filter.drive',     label: 'Drive',     kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'filter.keyTrack',  label: 'Key Track', kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'filter.attack',    label: 'F Atk',     kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'filter.decay',     label: 'F Dec',     kind: 'continuous', min: 0.001, max: 4, default: 0.3, unit: 's' },
  { id: 'filter.sustain',   label: 'F Sus',     kind: 'continuous', min: 0, max: 1, default: 0.4 },
  { id: 'filter.release',   label: 'F Rel',     kind: 'continuous', min: 0.005, max: 4, default: 0.4, unit: 's' },

  // Amp env
  { id: 'amp.attack',    label: 'A Atk',  kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
  { id: 'amp.decay',     label: 'A Dec',  kind: 'continuous', min: 0.001, max: 4, default: 0.2,  unit: 's' },
  { id: 'amp.sustain',   label: 'A Sus',  kind: 'continuous', min: 0, max: 1, default: 0.7 },
  { id: 'amp.release',   label: 'A Rel',  kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's' },

  // Master
  { id: 'master.level',  label: 'Level',  kind: 'continuous', min: 0, max: 1, default: 0.7 },
];
```

(If the polysynth surface is larger, add the additional specs. Use the same dotted naming.)

- [ ] **Step 2: Implement getBaseValue/setBaseValue routing to polysynth state**

The polysynth keeps state in `polysynth.params` (a nested object). Write a helper that translates a dot-namespaced id like `filter.cutoff` to a `polysynth.params.filter.cutoff` access:

```ts
getBaseValue(id: string): number {
  return readDotPath(this.polysynth!.params, id) ?? SUB_PARAMS.find(p => p.id === id)?.default ?? 0;
}
setBaseValue(id: string, v: number): void {
  if (!this.polysynth) return;
  writeDotPath(this.polysynth.params, id, v);
}
```

With helpers:

```ts
function readDotPath(obj: Record<string, unknown>, path: string): number {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return 0;
  }
  return typeof cur === 'number' ? cur : 0;
}

function writeDotPath(obj: Record<string, unknown>, path: string, v: number): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!next || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = v;
}
```

- [ ] **Step 3: Voice exposes getAudioParams**

In the SubtractiveVoice (or whatever wraps the polysynth call), implement:

```ts
getAudioParams(): Map<string, AudioParam> {
  // Pull from the polysynth instance's getCurrentVoiceAudioParams (added in Task 9).
  const m = this.polysynth.getCurrentVoiceAudioParams();
  if (!m) return new Map();
  return new Map<string, AudioParam>([
    ['amp.gain',         m.get('amp')!],
    ['filter.cutoff',    m.get('cutoff')!],
    ['filter.resonance', m.get('resonance')!],
    ['osc1.detune',      m.get('pitch')!],
  ]);
}
```

(Adjust based on what polysynth.getCurrentVoiceAudioParams actually returns.)

- [ ] **Step 4: Commit**

```bash
git add src/engines/subtractive.ts
git commit -m "feat(subtractive): declare unified params + voice.getAudioParams

EngineParamSpec[] spans ~22 entries covering oscillators, sub, noise,
filter, amp env, master. getBaseValue/setBaseValue use a dot-path
walker against polysynth.params. Voice exposes filter.cutoff/resonance,
amp.gain, osc1.detune via getAudioParams. The hardcoded onVoice
callback in polysynth is gone."
```

---

## Task 11: Delete `polysynth-ui.ts` + update lane wiring

**Files:**
- Delete: `src/polysynth/polysynth-ui.ts`
- Modify: `src/main.ts`, `src/polysynth/polysynth-presets.ts`, anywhere that imports from polysynth-ui.

- [ ] **Step 1: Delete the file**

```bash
git rm src/polysynth/polysynth-ui.ts
```

- [ ] **Step 2: Remove imports**

Search for `polysynth-ui` across `src/` and remove every import. Replace any call to `buildPolySynthUI` with a `wireLaneKnobs(...)` invocation for the active lane:

In main.ts, where `buildPolySynthUI(polySynthUIDeps)` was called, replace with:

```ts
const polyKnobsRow = document.querySelector<HTMLDivElement>('[data-page="poly"] .knob-row');
if (polyKnobsRow) {
  wireLaneKnobs({
    laneId: 'main',
    engine: subtractiveEngine,
    parent: polyKnobsRow,
  });
}
```

(Adjust the selector / parent element to wherever the legacy polysynth UI used to render.)

- [ ] **Step 3: Update polysynth-presets.ts**

In `src/polysynth/polysynth-presets.ts`, `applyPolyParams` currently writes to `polysynth.params` directly. Refactor `applyPresetByName` to call `engine.setBaseValue(id, v)` for each preset entry. The preset shape changes from a `Record<string, number>` keyed by the legacy poly-path strings to keyed by the new EngineParamSpec ids.

The preset library file `src/polysynth/poly-presets.ts` carries the existing presets. Rewrite each one to use the new ids (drop `ampAttack`, write `amp.attack` etc.). No backwards compat — new app.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(polysynth): delete polysynth-ui — lane-host generic loop replaces it

src/polysynth/polysynth-ui.ts gone (232 lines). Subtractive knobs now
built via wireLaneKnobs reading engine.params. Presets rewritten with
the new dotted param ids; setBaseValue replaces applyPolyParams's
nested-object writes."
```

---

## Task 12: PolySynth's built-in LFOs become ModulationHost modulators

**Files:**
- Modify: `src/engines/subtractive.ts`, `src/polysynth/polysynth.ts`

PolySynth has two on-board LFOs (`lfo1.target`, `lfo2.target`) with fixed destinations (pitch/filter/amp). Replace with modulator-system LFOs routed through the standard panel.

- [ ] **Step 1: Disconnect the polysynth-internal LFOs**

In `polysynth.ts`, find the inline `setupLfo` closures (around the trigger function). Remove the OscillatorNode creation + automatic connect to filter/pitch/amp. The LFO state remains in `params.lfo1`/`params.lfo2` so existing serialised saves don't crash, but the audio nodes are no longer instantiated.

- [ ] **Step 2: Subtractive engine seeds its modHost with two LFOs by default**

In `SubtractiveEngine` constructor, the modHost defaults are already two LFOs + two ADSRs (from Phase 5 work). Leave them.

- [ ] **Step 3: Commit**

```bash
git add src/engines/subtractive.ts src/polysynth/polysynth.ts
git commit -m "refactor(subtractive): polysynth LFOs replaced by ModulationHost

The two hardcoded LFOs inside polysynth.ts no longer create audio
nodes. Their function is replaced by user-routable LFOs in
SubtractiveEngine.modHost. The user assigns destinations via the
modulator panel like any other engine."
```

---

# Phase 7 — Drums

## Task 13: DrumsEngine declares params + getAudioParams

**Files:**
- Modify: `src/engines/drums-engine.ts`

- [ ] **Step 1: Declare params**

```ts
const DRUM_PARAMS: EngineParamSpec[] = [
  // Kit-level
  { id: 'master.level', label: 'Level', kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'master.tune',  label: 'Tune',  kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st' },
  // Per-voice levels (read from DrumMachine.kit state)
  { id: 'kick.level',      label: 'Kick',    kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'snare.level',     label: 'Snare',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'closedHat.level', label: 'CHat',    kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'openHat.level',   label: 'OHat',    kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'clap.level',      label: 'Clap',    kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'cowbell.level',   label: 'Cwbll',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'tom.level',       label: 'Tom',     kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'ride.level',      label: 'Ride',    kind: 'continuous', min: 0, max: 1.5, default: 1 },
];
```

- [ ] **Step 2: getBaseValue/setBaseValue against DrumMachine.kit state**

Implement similar to the dot-path helpers but mapped to `drumMachine.kit.<voice>.level`.

- [ ] **Step 3: Voice exposes getAudioParams**

DrumMachine doesn't have continuous AudioParam destinations per voice in the usual sense. Each voice has its own channel strip. Expose the per-voice channel-strip gain:

```ts
getAudioParams(): Map<string, AudioParam> {
  const out = new Map<string, AudioParam>();
  for (const voice of DRUM_LANES) {
    const channel = this.dm.channels[voice];
    if (channel) out.set(`${voice}.level`, channel.outputGain.gain);
  }
  return out;
}
```

(Adjust the property name to whatever the channel strip exposes.)

- [ ] **Step 4: Commit**

```bash
git add src/engines/drums-engine.ts
git commit -m "feat(drums): declare unified params + getAudioParams

EngineParamSpec list covers kit master (level, tune) and per-voice
levels. Voice exposes each drum voice's channel-strip output gain
under '<voice>.level' ids."
```

---

# Phase 8 — Cleanup

## Task 14: Remove `lookupBare`, `extraPrefixes`, `voiceParamMap`, `bindVoiceModulation`

**Files:**
- Modify: `src/modulation/connection-binder.ts`, `src/modulation/modulation-host.ts`, `src/modulation/modulation-ui.ts`

- [ ] **Step 1: Simplify `ConnectionBinder.apply` signature**

The new signature takes `destMap: Map<string, AudioParam>` (fully-qualified ids like `bass.filter.cutoff`) and `rangeMap: Map<string, ParamRange>`. No lookupBare.

Open `src/modulation/connection-binder.ts`. Replace:

```ts
function lookupBare<T>(map: Record<string, T>, key: string): T | undefined { ... }
```

…with: deletion. And rework `apply`:

```ts
apply(
  voiceMods: Map<string, ModulatorVoice>,
  modulators: ModulatorState[],
  destMap: Map<string, AudioParam>,
  rangeMap: Map<string, ParamRange>,
  ctx: AudioContext,
): void {
  const wanted = new Set<string>();
  for (const mod of modulators) {
    if (!mod.enabled) continue;
    const src = voiceMods.get(mod.id);
    if (!src) continue;
    for (const conn of mod.connections) {
      const dest = destMap.get(conn.paramId);
      const range = rangeMap.get(conn.paramId);
      if (!dest || !range) continue;
      const key = `${mod.id}.${conn.id}`;
      wanted.add(key);
      let active = this.bindings.get(key);
      if (!active) {
        const gain = ctx.createGain();
        gain.gain.value = conn.depth * (range.max - range.min);
        src.output.connect(gain);
        gain.connect(dest);
        this.bindings.set(key, { gain, depth: conn.depth, range, paramId: conn.paramId });
      } else if (active.depth !== conn.depth) {
        active.gain.gain.value = conn.depth * (range.max - range.min);
        active.depth = conn.depth;
      }
    }
  }
  for (const [key, active] of [...this.bindings]) {
    if (!wanted.has(key)) { active.gain.disconnect(); this.bindings.delete(key); }
  }
}
```

Update the existing tests in `connection-binder.test.ts` to use `Map`-shaped destMap/rangeMap.

- [ ] **Step 2: Remove duplicates from modulation-host.ts**

Delete the `lookupBare` and `bindVoiceModulation` exports in `src/modulation/modulation-host.ts`. They're unused after Phase 2.

- [ ] **Step 3: Remove `extraPrefixes` from modulation-ui.ts**

Open `src/modulation/modulation-ui.ts`. In `ModulationUIDeps`, drop the `extraPrefixes?: string[]` field. Update `destinationIds`:

```ts
function destinationIds(registry: Map<string, KnobHandle>, laneId: string): string[] {
  const prefix = `${laneId}.`;
  return [...registry.keys()].filter((id) => id.startsWith(prefix) && !id.includes('.mod.'));
}
```

In each engine's `buildParamUI`, drop the `extraPrefixes: [...]` arg to `renderModulatorsPanel`.

- [ ] **Step 4: Run tests + typecheck**

```
npx tsc --noEmit
npm test
```

Both clean.

- [ ] **Step 5: Verify success criteria via grep**

```
grep -r "lookupBare" src/    # expected: 0 matches
grep -r "extraPrefixes" src/ # expected: 0 matches
grep -r "voiceParamMap" src/ # expected: 0 matches
grep -r "idPrefix" src/      # expected: 0 matches
```

If any returns matches, clean them up.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(modulation): remove lookupBare, extraPrefixes, voiceParamMap

Each layer (registry, voice.getAudioParams, modulator destination
dropdown) uses the same fully-qualified <laneId>.<spec.id> string.
No translation, no prefix-stripping. ConnectionBinder.apply takes
pre-keyed Map<id, AudioParam>. The destination dropdown filters by
laneId prefix only."
```

---

## Out of scope (deferred)

- Modulators modulating other modulators.
- Macros.
- Custom param ranges in saves.
- Engine-specific preset libraries reorganization (touched only as needed when rewriting the few existing inline presets).

---

## Self-review notes

- Spec §3 (core types) → Tasks 1, 2.
- Spec §4 (internal env nodes / Web Audio summing) → Tasks 3, 6, 7, 8, 9.
- Spec §5 (lane host generic loop) → Task 5.
- Spec §6 (deletions: lookupBare, extraPrefixes, voiceParamMap, idPrefix) → Task 14.
- Spec §7 (per-engine refactor) → Tasks 3-13 in order.
- Spec §11 (success criteria) → Task 14 step 5 grep verification.

Each task is self-contained: typecheck + tests pass at the end. Engines fail typecheck mid-refactor between Tasks 2 and 4 (interface extended, not yet implemented) — that's expected and resolves at Task 4 commit.
