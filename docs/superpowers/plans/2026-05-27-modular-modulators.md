# Modular Modulators (LFO + ADSR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-engine hardcoded LFOs and envelopes with a routable modulator system: each engine ships ≥1 LFO + 1 ADSR, user can add more, and any modulator can drive any param via destination/depth UI. All modulator controls (and preset selectors) become automatable.

**Architecture:** Pure types + helpers (`src/modulation/`). Audio path uses Web Audio nodes (`OscillatorNode`, `ConstantSourceNode`) summed into destination `AudioParam`s. UI animation polls JS-mirrored `currentValue()` at rAF and pushes an offset to a new `KnobHandle.setModulationOffset()` ring overlay. Universal rule: every interactable control registers with the existing `automationRegistry`.

**Tech Stack:** TypeScript strict, Web Audio API, Vite, Vitest (node env — pure tests only). No new deps.

**Spec:** [docs/superpowers/specs/2026-05-27-modular-modulators-design.md](../specs/2026-05-27-modular-modulators-design.md)

---

## File map

| File | Status | Purpose |
|---|---|---|
| `src/modulation/types.ts` | create | `ModulatorKind`, `ModulationConnection`, `ModulatorState`, `ModulatorVoice`, `ModulationHost` |
| `src/modulation/waveform.ts` | create | `computeWaveform(kind, phase, bipolar)` pure |
| `src/modulation/waveform.test.ts` | create | Tests for waveform math |
| `src/modulation/rate-sync.ts` | create | `effectiveRateHz(state, bpm)`, `SYNC_RATIO_MAP` |
| `src/modulation/rate-sync.test.ts` | create | Tests for rate / sync |
| `src/modulation/adsr-curve.ts` | create | `computeAdsrAt(t, state, gate)` pure |
| `src/modulation/adsr-curve.test.ts` | create | Tests for ADSR sample math |
| `src/modulation/modulation-host.ts` | create | `ModulationHostImpl`, `bindVoiceModulation`, default ctor helpers |
| `src/modulation/modulation-host.test.ts` | create | Tests for host CRUD + serialize/deserialize |
| `src/modulation/lfo-voice.ts` | create | `LFOVoice` (Web Audio + currentValue mirror) |
| `src/modulation/adsr-voice.ts` | create | `ADSRVoice` (Web Audio + currentValue mirror) |
| `src/modulation/modulation-ui.ts` | create | `renderModulatorsPanel(container, deps)` |
| `src/modulation/preset-migration.ts` | create | `migrateWavetablePreset`, `migrateSubtractivePreset`, idempotent |
| `src/modulation/preset-migration.test.ts` | create | Tests for legacy → modulators |
| `src/core/knob.ts` | modify | Add `KnobHandle.setModulationOffset(offsetNorm: number)` + ring SVG overlay; add `createSelectControl` for enum/toggle automatable params |
| `src/core/select-control.ts` | create | `createSelectControl` (discrete-value automatable handle) |
| `src/core/select-control.test.ts` | create | Discrete-value quantisation tests |
| `src/engines/engine-types.ts` | modify | `EngineUIContext.registry: Map<string, unknown>` |
| `src/engines/wavetable.ts` | modify | Adopt `ModulationHost`, drop `wt-attack/decay/sustain/release` params |
| `src/engines/subtractive.ts` | modify | Adopt `ModulationHost`, drop hardcoded LFOs/envelopes |
| `src/engines/fm.ts` | modify | Additive: add `ModulationHost` with no defaults connected |
| `src/engines/karplus.ts` | modify | Additive |
| `src/engines/tb303.ts` | modify | Additive: LFO only, no default connections |
| `src/session/session.ts` | modify | `SessionLane.engineState?: { modulators: ModulatorState[] }` |
| `src/automation/automation-tick.ts` | modify | rAF loop also drives `knob.setModulationOffset()` from active modulators |
| `src/main.ts` | modify | Pass `registry` to `EngineUIContext`; ensure new modulator knobs flow through `registerKnob` |

---

## Verification pattern

Per the existing repo convention (no test framework before Vitest was added in commit `ab506ad`), each task ends with:
- **Typecheck**: `npx tsc --noEmit` → no output.
- **Unit tests**: `npm test` → all green; specific new tests pass.
- **Smoke test** (manual): when a task touches audio or UI, list specific things to verify in the browser at http://localhost:5173/.

Vitest runs in `environment: 'node'`. **No AudioContext mocking** — Web Audio code is verified by smoke test, pure logic is unit-tested.

---

# Phase 1 — Foundation (pure helpers + host)

## Task 1: Core types

**Files:**
- Create: `src/modulation/types.ts`

- [ ] **Step 1: Write the file**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\types.ts`:

```ts
// src/modulation/types.ts
// Pure type definitions for the modular LFO + ADSR system.

export type ModulatorKind = 'lfo' | 'adsr';
export type Waveform = 'sine' | 'triangle' | 'square' | 'saw';

export interface ModulationConnection {
  id: string;          // unique within the modulator
  paramId: string;     // destination param-id (matches automationRegistry keys)
  depth: number;       // -1..+1; final = output * depth * (paramMax - paramMin)
}

export interface ModulatorState {
  id: string;          // 'lfo1', 'adsr1', ...
  kind: ModulatorKind;
  enabled: boolean;
  connections: ModulationConnection[];

  // LFO-only
  rateHz?: number;     // 0.01..40 (free rate)
  waveform?: Waveform;
  bipolar?: boolean;
  syncToBpm?: boolean;
  syncRatio?: string;  // '1/4', '1/8T', '1/4.', ...

  // ADSR-only
  attackSec?: number;
  decaySec?: number;
  sustain?: number;    // 0..1
  releaseSec?: number;
}

export interface ModulatorVoice {
  output: AudioNode;
  trigger(time: number, opts: { gateDuration: number; accent?: boolean }): void;
  release(time: number): void;
  dispose(): void;
  currentValue(): number;   // for UI only; not for audio path
}

export interface ModulationHost {
  modulators: ModulatorState[];
  addModulator(kind: ModulatorKind): ModulatorState;
  removeModulator(id: string): void;
  setConnection(modId: string, conn: ModulationConnection): void;
  removeConnection(modId: string, connId: string): void;
  spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice>;
  serialize(): ModulatorState[];
  deserialize(state: ModulatorState[]): void;
}

// Default modulator factory shapes (used by engines + add buttons).
export function makeDefaultLFO(id: string): ModulatorState {
  return {
    id, kind: 'lfo', enabled: true, connections: [],
    rateHz: 4, waveform: 'sine', bipolar: true,
    syncToBpm: false, syncRatio: '1/4',
  };
}

export function makeDefaultADSR(id: string): ModulatorState {
  return {
    id, kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.01, decaySec: 0.3, sustain: 0.7, releaseSec: 0.3,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/modulation/types.ts
git commit -m "feat(modulation): core types for modular LFO+ADSR system

Types-only commit. Establishes ModulatorState, ModulationConnection,
ModulatorVoice, ModulationHost interfaces plus default factories."
```

---

## Task 2: Waveform helper + tests

**Files:**
- Create: `src/modulation/waveform.ts`
- Create: `src/modulation/waveform.test.ts`

- [ ] **Step 1: Write the failing test**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\waveform.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeWaveform } from './waveform';

describe('computeWaveform — sine', () => {
  it('phase 0 → 0 bipolar', () => {
    expect(computeWaveform('sine', 0, true)).toBeCloseTo(0, 5);
  });
  it('phase 0.25 → +1 bipolar', () => {
    expect(computeWaveform('sine', 0.25, true)).toBeCloseTo(1, 5);
  });
  it('phase 0.5 → 0 bipolar', () => {
    expect(computeWaveform('sine', 0.5, true)).toBeCloseTo(0, 5);
  });
  it('phase 0 → 0.5 unipolar', () => {
    expect(computeWaveform('sine', 0, false)).toBeCloseTo(0.5, 5);
  });
  it('phase 0.25 → 1 unipolar', () => {
    expect(computeWaveform('sine', 0.25, false)).toBeCloseTo(1, 5);
  });
});

describe('computeWaveform — triangle', () => {
  it('phase 0 → -1 bipolar (rising from bottom)', () => {
    expect(computeWaveform('triangle', 0, true)).toBeCloseTo(-1, 5);
  });
  it('phase 0.5 → +1 bipolar (peak)', () => {
    expect(computeWaveform('triangle', 0.5, true)).toBeCloseTo(1, 5);
  });
  it('phase 1 → -1 bipolar (back to bottom)', () => {
    expect(computeWaveform('triangle', 1, true)).toBeCloseTo(-1, 5);
  });
});

describe('computeWaveform — square', () => {
  it('phase 0..0.5 → +1 bipolar', () => {
    expect(computeWaveform('square', 0,    true)).toBe(1);
    expect(computeWaveform('square', 0.49, true)).toBe(1);
  });
  it('phase 0.5..1 → -1 bipolar', () => {
    expect(computeWaveform('square', 0.5,  true)).toBe(-1);
    expect(computeWaveform('square', 0.99, true)).toBe(-1);
  });
});

describe('computeWaveform — saw', () => {
  it('phase 0 → -1, phase 0.5 → 0, phase ~1 → +1 (bipolar ramp)', () => {
    expect(computeWaveform('saw', 0,    true)).toBeCloseTo(-1, 5);
    expect(computeWaveform('saw', 0.5,  true)).toBeCloseTo( 0, 5);
    expect(computeWaveform('saw', 0.99, true)).toBeCloseTo(0.98, 5);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- waveform`
Expected: FAIL with "Cannot find module './waveform'".

- [ ] **Step 3: Implement**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\waveform.ts`:

```ts
// src/modulation/waveform.ts
// Pure phase → value math. JS-side mirror of the Web Audio LFO output
// so the rAF UI loop can animate knob rings without sampling AudioParam values.

import type { Waveform } from './types';

/**
 * @param kind     waveform shape
 * @param phase    0..1 (wraps); 0 = start of cycle
 * @param bipolar  true → output in -1..+1; false → output in 0..1
 */
export function computeWaveform(kind: Waveform, phase: number, bipolar: boolean): number {
  const p = ((phase % 1) + 1) % 1;
  let v: number;
  switch (kind) {
    case 'sine':     v = Math.sin(2 * Math.PI * p); break;
    case 'triangle': v = p < 0.5 ? (-1 + 4 * p) : (3 - 4 * p); break;
    case 'square':   v = p < 0.5 ? 1 : -1; break;
    case 'saw':      v = -1 + 2 * p; break;
  }
  return bipolar ? v : (v + 1) / 2;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- waveform`
Expected: PASS, all 13 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/modulation/waveform.ts src/modulation/waveform.test.ts
git commit -m "feat(modulation): pure waveform helper + tests

computeWaveform(kind, phase, bipolar) — JS mirror of LFO output used
by the rAF UI loop. 13 tests cover sine/triangle/square/saw and
bipolar↔unipolar mapping."
```

---

## Task 3: Rate / BPM-sync helper + tests

**Files:**
- Create: `src/modulation/rate-sync.ts`
- Create: `src/modulation/rate-sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\rate-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { effectiveRateHz, SYNC_RATIO_MAP } from './rate-sync';
import type { ModulatorState } from './types';

function lfo(partial: Partial<ModulatorState>): ModulatorState {
  return {
    id: 'lfo1', kind: 'lfo', enabled: true, connections: [],
    rateHz: 1, waveform: 'sine', bipolar: true,
    syncToBpm: false, syncRatio: '1/4',
    ...partial,
  };
}

describe('effectiveRateHz — free rate', () => {
  it('returns rateHz unchanged when sync disabled', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: false, rateHz: 7.3 }), 120)).toBe(7.3);
  });
  it('defaults to 1 Hz if rateHz missing', () => {
    expect(effectiveRateHz(lfo({ rateHz: undefined }), 120)).toBe(1);
  });
});

describe('effectiveRateHz — BPM sync', () => {
  it('1/4 at 120 BPM = 2 Hz', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/4' }), 120)).toBe(2);
  });
  it('1/8 at 120 BPM = 4 Hz', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/8' }), 120)).toBe(4);
  });
  it('1/16 at 120 BPM = 8 Hz', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/16' }), 120)).toBe(8);
  });
  it('1/1 at 120 BPM = 0.5 Hz (one cycle per bar)', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/1' }), 120)).toBe(0.5);
  });
  it('1/4T at 120 BPM = 3 Hz (triplet)', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: '1/4T' }), 120)).toBe(3);
  });
});

describe('effectiveRateHz — unknown ratio fallback', () => {
  it('unknown ratio collapses to 1 cycle per beat', () => {
    expect(effectiveRateHz(lfo({ syncToBpm: true, syncRatio: 'NOPE' }), 120)).toBe(2);
  });
});

describe('SYNC_RATIO_MAP', () => {
  it('contains common ratios', () => {
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/8');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/16');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4T');
    expect(SYNC_RATIO_MAP).toHaveProperty('1/4.');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- rate-sync`
Expected: FAIL with "Cannot find module './rate-sync'".

- [ ] **Step 3: Implement**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\rate-sync.ts`:

```ts
// src/modulation/rate-sync.ts
// BPM-sync conversion for LFO rate. Cycles-per-beat map mirrors the same
// ratio set the FX delay sync uses.

import type { ModulatorState } from './types';

export const SYNC_RATIO_MAP: Record<string, number> = {
  // straight
  '4/1': 1/16, '2/1': 1/8, '1/1': 1/4, '1/2': 1/2, '1/4': 1,
  '1/8': 2,    '1/16': 4,  '1/32': 8,
  // triplet
  '1/2T': 3/4, '1/4T': 3/2, '1/8T': 3, '1/16T': 6,
  // dotted
  '1/2.': 1/3, '1/4.': 2/3, '1/8.': 4/3, '1/16.': 8/3,
};

export function effectiveRateHz(state: ModulatorState, bpm: number): number {
  if (!state.syncToBpm || !state.syncRatio) return state.rateHz ?? 1;
  const beatHz = bpm / 60;
  const cyclesPerBeat = SYNC_RATIO_MAP[state.syncRatio] ?? 1;
  return beatHz * cyclesPerBeat;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- rate-sync`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/modulation/rate-sync.ts src/modulation/rate-sync.test.ts
git commit -m "feat(modulation): rate-sync helper + tests

effectiveRateHz maps modulator state + BPM to Hz, honouring sync ratios
(straight, triplet, dotted). SYNC_RATIO_MAP mirrors FX delay sync set."
```

---

## Task 4: ADSR curve helper + tests

**Files:**
- Create: `src/modulation/adsr-curve.ts`
- Create: `src/modulation/adsr-curve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\adsr-curve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeAdsrAt } from './adsr-curve';
import type { ModulatorState } from './types';

function adsr(partial: Partial<ModulatorState>): ModulatorState {
  return {
    id: 'adsr1', kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.1, decaySec: 0.2, sustain: 0.5, releaseSec: 0.3,
    ...partial,
  };
}

describe('computeAdsrAt — long gate (gate >= attack+decay)', () => {
  const env = adsr({});
  const gate = 1.0;

  it('t=0 → 0 (start of attack)', () => {
    expect(computeAdsrAt(0, env, gate)).toBeCloseTo(0, 5);
  });
  it('t=attack/2 → 0.5 (mid-attack, linear)', () => {
    expect(computeAdsrAt(0.05, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=attack → 1 (peak)', () => {
    expect(computeAdsrAt(0.1, env, gate)).toBeCloseTo(1, 5);
  });
  it('t=attack+decay/2 → between 1 and sustain', () => {
    expect(computeAdsrAt(0.2, env, gate)).toBeCloseTo(0.75, 5);
  });
  it('t=attack+decay → sustain (0.5)', () => {
    expect(computeAdsrAt(0.3, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=sustain mid-hold → sustain', () => {
    expect(computeAdsrAt(0.7, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=gate (release start) → sustain', () => {
    expect(computeAdsrAt(1.0, env, gate)).toBeCloseTo(0.5, 5);
  });
  it('t=gate+release/2 → between sustain and 0', () => {
    expect(computeAdsrAt(1.15, env, gate)).toBeCloseTo(0.25, 5);
  });
  it('t >> gate+release → 0', () => {
    expect(computeAdsrAt(5, env, gate)).toBe(0);
  });
});

describe('computeAdsrAt — short gate (gate < attack+decay)', () => {
  it('release starts at attack+decay even if gate is shorter', () => {
    // Spec: releaseStart = max(attack+decay, gate); ensures we hit sustain plateau.
    const env = adsr({ attackSec: 0.1, decaySec: 0.2, sustain: 0.5, releaseSec: 0.1 });
    const gate = 0.05;
    expect(computeAdsrAt(0.3, env, gate)).toBeCloseTo(0.5, 5);  // still at sustain
    expect(computeAdsrAt(0.35, env, gate)).toBeCloseTo(0.25, 5); // mid-release
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- adsr-curve`
Expected: FAIL with "Cannot find module './adsr-curve'".

- [ ] **Step 3: Implement**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\adsr-curve.ts`:

```ts
// src/modulation/adsr-curve.ts
// Pure JS mirror of the ADSR curve scheduled into the audio graph.
// Output is unipolar 0..1. The audio side uses linearRampToValueAtTime;
// this helper does the same linear math for UI animation polling.

import type { ModulatorState } from './types';

export function computeAdsrAt(
  t: number,           // seconds since trigger
  state: ModulatorState,
  gateDuration: number,
): number {
  const a = Math.max(0.001, state.attackSec ?? 0.01);
  const d = Math.max(0.001, state.decaySec  ?? 0.1);
  const s = Math.min(1, Math.max(0, state.sustain ?? 0.7));
  const r = Math.max(0.001, state.releaseSec ?? 0.3);

  if (t <= 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);

  const releaseStart = Math.max(a + d, gateDuration);
  if (t < releaseStart) return s;
  const rt = t - releaseStart;
  if (rt >= r) return 0;
  return s * (1 - rt / r);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- adsr-curve`
Expected: PASS, all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add src/modulation/adsr-curve.ts src/modulation/adsr-curve.test.ts
git commit -m "feat(modulation): ADSR curve helper + tests

computeAdsrAt mirrors the linear-ramp envelope scheduled on the audio
side. Handles long-gate (full sustain hold) and short-gate (release
starts after attack+decay) cases."
```

---

## Task 5: ModulationHost implementation + tests

**Files:**
- Create: `src/modulation/modulation-host.ts`
- Create: `src/modulation/modulation-host.test.ts`

- [ ] **Step 1: Write the failing test**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\modulation-host.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ModulationHostImpl } from './modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from './types';

describe('ModulationHostImpl', () => {
  it('starts empty with no defaults', () => {
    const h = new ModulationHostImpl([]);
    expect(h.modulators).toEqual([]);
  });

  it('seeds from provided defaults', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1'), makeDefaultADSR('adsr1')]);
    expect(h.modulators).toHaveLength(2);
    expect(h.modulators[0].id).toBe('lfo1');
    expect(h.modulators[1].kind).toBe('adsr');
  });

  it('addModulator picks the next free id (lfo1 → lfo2 → lfo3)', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1')]);
    h.addModulator('lfo');
    h.addModulator('lfo');
    expect(h.modulators.map(m => m.id)).toEqual(['lfo1', 'lfo2', 'lfo3']);
  });

  it('addModulator assigns kind-specific defaults', () => {
    const h = new ModulationHostImpl([]);
    const lfo = h.addModulator('lfo');
    const adsr = h.addModulator('adsr');
    expect(lfo.rateHz).toBeDefined();
    expect(lfo.waveform).toBeDefined();
    expect(adsr.attackSec).toBeDefined();
    expect(adsr.releaseSec).toBeDefined();
  });

  it('removeModulator drops by id', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1'), makeDefaultLFO('lfo2')]);
    h.removeModulator('lfo1');
    expect(h.modulators.map(m => m.id)).toEqual(['lfo2']);
  });

  it('setConnection adds a new connection or replaces an existing one by id', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1')]);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.5 });
    h.setConnection('lfo1', { id: 'c2', paramId: 'pitch',  depth: 0.1 });
    expect(h.modulators[0].connections).toHaveLength(2);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.9 });
    expect(h.modulators[0].connections.find(c => c.id === 'c1')?.depth).toBe(0.9);
  });

  it('removeConnection drops by connection id', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1')]);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.5 });
    h.setConnection('lfo1', { id: 'c2', paramId: 'pitch',  depth: 0.1 });
    h.removeConnection('lfo1', 'c1');
    expect(h.modulators[0].connections.map(c => c.id)).toEqual(['c2']);
  });

  it('serialize/deserialize round-trips', () => {
    const h = new ModulationHostImpl([makeDefaultLFO('lfo1'), makeDefaultADSR('adsr1')]);
    h.setConnection('lfo1', { id: 'c1', paramId: 'cutoff', depth: 0.5 });
    const snapshot = h.serialize();
    const h2 = new ModulationHostImpl([]);
    h2.deserialize(snapshot);
    expect(h2.modulators).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- modulation-host`
Expected: FAIL with "Cannot find module './modulation-host'".

- [ ] **Step 3: Implement (skeleton only — spawnVoice/bindVoiceModulation come in Task 6)**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\modulation-host.ts`:

```ts
// src/modulation/modulation-host.ts
// State container + CRUD for an engine's modulators. Voice spawning is
// implemented here too but exercised via smoke test (needs Web Audio).

import {
  type ModulationConnection, type ModulationHost,
  type ModulatorKind, type ModulatorState, type ModulatorVoice,
  makeDefaultLFO, makeDefaultADSR,
} from './types';

export class ModulationHostImpl implements ModulationHost {
  modulators: ModulatorState[];

  constructor(defaults: ModulatorState[]) {
    this.modulators = defaults.map((m) => ({ ...m, connections: [...m.connections] }));
  }

  addModulator(kind: ModulatorKind): ModulatorState {
    const prefix = kind === 'lfo' ? 'lfo' : 'adsr';
    const used = new Set(this.modulators.filter(m => m.kind === kind).map(m => m.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    const fresh = kind === 'lfo' ? makeDefaultLFO(id) : makeDefaultADSR(id);
    this.modulators.push(fresh);
    return fresh;
  }

  removeModulator(id: string): void {
    const idx = this.modulators.findIndex((m) => m.id === id);
    if (idx >= 0) this.modulators.splice(idx, 1);
  }

  setConnection(modId: string, conn: ModulationConnection): void {
    const mod = this.modulators.find((m) => m.id === modId);
    if (!mod) return;
    const existing = mod.connections.findIndex((c) => c.id === conn.id);
    if (existing >= 0) mod.connections[existing] = conn;
    else mod.connections.push(conn);
  }

  removeConnection(modId: string, connId: string): void {
    const mod = this.modulators.find((m) => m.id === modId);
    if (!mod) return;
    const idx = mod.connections.findIndex((c) => c.id === connId);
    if (idx >= 0) mod.connections.splice(idx, 1);
  }

  serialize(): ModulatorState[] {
    return this.modulators.map((m) => ({ ...m, connections: m.connections.map((c) => ({ ...c })) }));
  }

  deserialize(state: ModulatorState[]): void {
    this.modulators = state.map((m) => ({ ...m, connections: m.connections.map((c) => ({ ...c })) }));
  }

  spawnVoice(_ctx: AudioContext, _bpm: () => number): Map<string, ModulatorVoice> {
    // Filled in by Task 6 once LFOVoice + ADSRVoice exist.
    return new Map();
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- modulation-host`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/modulation/modulation-host.ts src/modulation/modulation-host.test.ts
git commit -m "feat(modulation): ModulationHostImpl CRUD + serialize tests

State container with add/remove modulator + connection, plus
serialize/deserialize for save/load. spawnVoice is a stub until LFO/
ADSR voices are added in the next task."
```

---

## Task 6: LFOVoice + ADSRVoice + bindVoiceModulation

**Files:**
- Create: `src/modulation/lfo-voice.ts`
- Create: `src/modulation/adsr-voice.ts`
- Modify: `src/modulation/modulation-host.ts` (fill in spawnVoice + bindVoiceModulation)

- [ ] **Step 1: Write LFOVoice**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\lfo-voice.ts`:

```ts
// src/modulation/lfo-voice.ts
// Web Audio LFO voice with a JS-mirrored phase so the rAF UI loop can
// poll currentValue() for knob animation.

import type { ModulatorState, ModulatorVoice } from './types';
import { computeWaveform } from './waveform';
import { effectiveRateHz } from './rate-sync';

export class LFOVoice implements ModulatorVoice {
  output: AudioNode;

  private ctx: AudioContext;
  private osc!: OscillatorNode;
  private gain: GainNode;
  private dc: ConstantSourceNode;
  private state: ModulatorState;
  private bpmGetter: () => number;
  private startedAt: number;

  constructor(ctx: AudioContext, state: ModulatorState, bpm: () => number) {
    this.ctx = ctx;
    this.state = state;
    this.bpmGetter = bpm;
    this.gain = ctx.createGain();
    this.gain.gain.value = state.bipolar !== false ? 1 : 0.5;
    this.dc = ctx.createConstantSource();
    this.dc.offset.value = state.bipolar !== false ? 0 : 0.5;
    this.dc.start();
    this.dc.connect(this.gain);
    this.startedAt = ctx.currentTime;
    this.createOsc(this.startedAt);
    this.output = this.gain;
  }

  private createOsc(time: number): void {
    if (this.osc) {
      try { this.osc.stop(); } catch { /* already stopped */ }
      this.osc.disconnect();
    }
    this.osc = this.ctx.createOscillator();
    this.osc.type = (this.state.waveform ?? 'sine') as OscillatorType;
    this.osc.frequency.value = effectiveRateHz(this.state, this.bpmGetter());
    this.osc.connect(this.gain);
    this.osc.start(time);
  }

  trigger(time: number): void {
    this.startedAt = time;
    this.createOsc(time);
  }

  release(_time: number): void { /* LFOs free-run */ }

  currentValue(): number {
    const t = this.ctx.currentTime - this.startedAt;
    const rate = effectiveRateHz(this.state, this.bpmGetter());
    const phase = t * rate;
    return computeWaveform(this.state.waveform ?? 'sine', phase, this.state.bipolar !== false);
  }

  dispose(): void {
    try { this.osc.stop(); } catch { /* */ }
    try { this.dc.stop(); } catch { /* */ }
    this.osc.disconnect();
    this.dc.disconnect();
    this.gain.disconnect();
  }
}
```

- [ ] **Step 2: Write ADSRVoice**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\adsr-voice.ts`:

```ts
// src/modulation/adsr-voice.ts
// ConstantSourceNode whose offset is automated on every trigger to follow
// the ADSR curve. JS mirror via computeAdsrAt for UI polling.

import type { ModulatorState, ModulatorVoice } from './types';
import { computeAdsrAt } from './adsr-curve';

export class ADSRVoice implements ModulatorVoice {
  output: AudioNode;
  private ctx: AudioContext;
  private src: ConstantSourceNode;
  private state: ModulatorState;
  private triggeredAt = 0;
  private gateDur = 0;

  constructor(ctx: AudioContext, state: ModulatorState) {
    this.ctx = ctx;
    this.state = state;
    this.src = ctx.createConstantSource();
    this.src.offset.value = 0;
    this.src.start();
    this.output = this.src;
  }

  trigger(time: number, opts: { gateDuration: number; accent?: boolean }): void {
    const { attackSec = 0.01, decaySec = 0.1, sustain = 0.7, releaseSec = 0.3 } = this.state;
    const o = this.src.offset;
    o.cancelScheduledValues(time);
    o.setValueAtTime(0, time);
    o.linearRampToValueAtTime(1, time + attackSec);
    o.linearRampToValueAtTime(sustain, time + attackSec + decaySec);
    const releaseAt = Math.max(time + attackSec + decaySec, time + opts.gateDuration);
    o.setValueAtTime(sustain, releaseAt);
    o.linearRampToValueAtTime(0, releaseAt + releaseSec);
    this.triggeredAt = time;
    this.gateDur = opts.gateDuration;
  }

  release(_time: number): void { /* envelope finishes via scheduled ramps */ }

  currentValue(): number {
    const t = this.ctx.currentTime - this.triggeredAt;
    return computeAdsrAt(t, this.state, this.gateDur);
  }

  dispose(): void {
    try { this.src.stop(); } catch { /* */ }
    this.src.disconnect();
  }
}
```

- [ ] **Step 3: Fill in spawnVoice and add bindVoiceModulation in `modulation-host.ts`**

Open `src/modulation/modulation-host.ts`. Add imports at the top:

```ts
import { LFOVoice } from './lfo-voice';
import { ADSRVoice } from './adsr-voice';
```

Replace the stub `spawnVoice` with:

```ts
  spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice> {
    const out = new Map<string, ModulatorVoice>();
    for (const m of this.modulators) {
      if (!m.enabled) continue;
      out.set(m.id, m.kind === 'lfo' ? new LFOVoice(ctx, m, bpm) : new ADSRVoice(ctx, m));
    }
    return out;
  }
```

Append (still inside the module) the audio wiring helper:

```ts
export interface ParamRange { min: number; max: number; }

/**
 * Wires each enabled modulator's connections through a GainNode (depth * range)
 * into the matching AudioParam on the voice. Web Audio sums multiple modulator
 * + automation contributions into the same AudioParam by design.
 */
export function bindVoiceModulation(
  voiceMods: Map<string, ModulatorVoice>,
  modulators: ModulatorState[],
  voiceParamMap: Record<string, AudioParam>,
  paramRanges: Record<string, ParamRange>,
  ctx: AudioContext,
): void {
  for (const mod of modulators) {
    if (!mod.enabled) continue;
    const src = voiceMods.get(mod.id);
    if (!src) continue;
    for (const conn of mod.connections) {
      const dest = voiceParamMap[conn.paramId];
      const range = paramRanges[conn.paramId];
      if (!dest || !range) continue;
      const g = ctx.createGain();
      g.gain.value = conn.depth * (range.max - range.min);
      src.output.connect(g);
      g.connect(dest);
    }
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Tests still pass**

Run: `npm test`
Expected: previous 8 ModulationHostImpl tests still pass + previously-added Vitest tests untouched.

- [ ] **Step 6: Commit**

```bash
git add src/modulation/lfo-voice.ts src/modulation/adsr-voice.ts src/modulation/modulation-host.ts
git commit -m "feat(modulation): LFOVoice + ADSRVoice + bindVoiceModulation

LFOVoice = OscillatorNode + DC offset for unipolar mode, JS mirror via
computeWaveform for currentValue(). ADSRVoice = ConstantSourceNode with
automated offset, JS mirror via computeAdsrAt. bindVoiceModulation
wires each enabled connection through a GainNode (depth*range) into
the destination AudioParam — Web Audio sums automation + modulators
into the same AudioParam by design."
```

---

# Phase 2 — Knob extension

## Task 7: `KnobHandle.setModulationOffset` + SVG ring overlay

**Files:**
- Modify: `src/core/knob.ts`

- [ ] **Step 1: Read the existing knob structure (already familiar)**

The knob already has a `valArc` (the active value arc). We add a SIBLING arc — a thinner amber ring at the modulated position. Position = clamp(value + offset*range, min, max), drawn as an arc from current value to modulated value.

- [ ] **Step 2: Extend KnobHandle and createKnob**

Open `src/core/knob.ts`. Add to the `KnobHandle` interface (around line 27-35):

```ts
export interface KnobHandle {
  el: HTMLElement;
  setValue: (v: number) => void;
  meta: KnobMeta;
  onValueChanged?: (v: number, fromUser: boolean) => void;
  /** Sets the additive modulation offset in normalized -1..+1 (0 = no mod).
   *  Renders as a thin amber ring overlay; does NOT change the base value. */
  setModulationOffset: (offsetNorm: number) => void;
}
```

Inside `createKnob()`, after the `valArc` is added (around line 71), add a modulation-overlay arc:

```ts
const modArc = document.createElementNS(SVG_NS, 'path');
modArc.setAttribute('class', 'knob-modulation');
modArc.style.stroke = '#ffa726';     // amber — design token
modArc.style.opacity = '0';           // hidden until setModulationOffset is called
svg.appendChild(modArc);
```

Then at the end of `createKnob`, BEFORE the `return { ... }`, add the helper + handle method:

```ts
function updateModArc(value: number, offset: number) {
  if (Math.abs(offset) < 1e-4) {
    modArc.style.opacity = '0';
    return;
  }
  const range = opts.max - opts.min;
  const modValue = Math.max(opts.min, Math.min(opts.max, value + offset * range));
  const fromAng = -135 + 270 * (value    - opts.min) / range;
  const toAng   = -135 + 270 * (modValue - opts.min) / range;
  modArc.setAttribute('d', arcPath(cx, cy, trackR + 2, Math.min(fromAng, toAng), Math.max(fromAng, toAng)));
  modArc.style.opacity = '0.85';
}

let lastModOffset = 0;
const handle: KnobHandle = {
  el: wrap,
  setValue: (v) => { state.value = v; render(); updateModArc(state.value, lastModOffset); handle.onValueChanged?.(v, false); },
  meta: { id: opts.id, label: opts.label, min: opts.min, max: opts.max },
  setModulationOffset: (offset) => { lastModOffset = offset; updateModArc(state.value, offset); },
};
return handle;
```

(If the existing `return { ... }` literal doesn't match this shape exactly, adapt: hold the literal in `handle`, then add `handle.setModulationOffset = ...` and `return handle`.)

- [ ] **Step 3: Add SCSS for the modulation ring**

Open `c:\Users\nacho\git\tb303-synth\src\styles\_knob.scss`. Append:

```scss
.knob-modulation {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  pointer-events: none;
  transition: opacity 80ms ease;
}
```

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all green.

- [ ] **Step 5: Smoke test**

`npm run dev`, open http://localhost:5173/. Verify the app still boots and existing knobs render unchanged (the modArc is invisible since nothing calls `setModulationOffset` yet).

- [ ] **Step 6: Commit**

```bash
git add src/core/knob.ts src/styles/_knob.scss
git commit -m "feat(knob): add setModulationOffset + amber ring overlay

KnobHandle gains setModulationOffset(offsetNorm). Renders a thin amber
ring outside the existing value arc spanning from base value to
modulated value. Hidden when offset≈0. No callers yet — Task 21 wires
the rAF loop that drives it."
```

---

# Phase 3 — EngineUIContext + UI panel

## Task 8: Extend `EngineUIContext` with `registry`

**Files:**
- Modify: `src/engines/engine-types.ts`
- Modify: `src/main.ts` (where EngineUIContext is constructed)

- [ ] **Step 1: Extend the interface**

Open `c:\Users\nacho\git\tb303-synth\src\engines\engine-types.ts`. Modify `EngineUIContext`:

```ts
export interface EngineUIContext {
  laneId: string;
  idPrefix: string;
  registerKnob: (k: unknown) => void;
  /** Read-only view of every automatable knob registered so far. Used by
   *  the modulation panel to populate destination dropdowns. */
  registry: Map<string, unknown>;
}
```

- [ ] **Step 2: Pass it through in main.ts**

Open `src/main.ts`. Find call sites that construct an `EngineUIContext` (search for `idPrefix:` — the existing engine UI builders take this object). Add `registry: automationRegistry` to each construction.

- [ ] **Step 3: Typecheck + tests**

`npx tsc --noEmit && npm test` — clean.

- [ ] **Step 4: Commit**

```bash
git add src/engines/engine-types.ts src/main.ts
git commit -m "feat(engines): EngineUIContext.registry — pass automationRegistry through

Modulation panel needs read-only access to all registered automatable
params to populate its destination dropdowns."
```

---

## Task 9: Discrete-value control + tests

**Files:**
- Create: `src/core/select-control.ts`
- Create: `src/core/select-control.test.ts`

- [ ] **Step 1: Write the failing test**

Create `c:\Users\nacho\git\tb303-synth\src\core\select-control.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quantiseSelectValue, normaliseSelectIndex } from './select-control';

describe('quantiseSelectValue', () => {
  it('maps 0..1 to option index 0..N-1', () => {
    expect(quantiseSelectValue(0,    4)).toBe(0);
    expect(quantiseSelectValue(0.24, 4)).toBe(0);
    expect(quantiseSelectValue(0.25, 4)).toBe(1);
    expect(quantiseSelectValue(0.5,  4)).toBe(2);
    expect(quantiseSelectValue(0.99, 4)).toBe(3);
    expect(quantiseSelectValue(1,    4)).toBe(3);
  });
  it('handles 2 options (toggle)', () => {
    expect(quantiseSelectValue(0.49, 2)).toBe(0);
    expect(quantiseSelectValue(0.5,  2)).toBe(1);
  });
});

describe('normaliseSelectIndex', () => {
  it('inverse of quantiseSelectValue for the option mid-bucket', () => {
    expect(normaliseSelectIndex(0, 4)).toBeCloseTo(0.125, 5);   // 1/8 = mid of [0..0.25)
    expect(normaliseSelectIndex(3, 4)).toBeCloseTo(0.875, 5);   // 7/8 = mid of [0.75..1)
  });
});
```

- [ ] **Step 2: Run, verify failure**

`npm test -- select-control`
Expected: FAIL with "Cannot find module './select-control'".

- [ ] **Step 3: Implement**

Create `c:\Users\nacho\git\tb303-synth\src\core\select-control.ts`:

```ts
// src/core/select-control.ts
// Discrete-value automatable controls (selects + toggles). The automation
// system feeds 0..1 normalized values; we quantise to an option index. The
// inverse picks the mid-bucket normalized value so the registered current
// value rountrips through automation cleanly.

import type { KnobHandle, KnobMeta } from './knob';

export interface SelectControlOpts {
  id: string;                  // automation registry id
  label?: string;
  options: Array<{ value: string; label: string }>;
  initialValue: string;
  onChange: (value: string, fromUser: boolean) => void;
}

export function quantiseSelectValue(norm: number, optionCount: number): number {
  return Math.max(0, Math.min(optionCount - 1, Math.floor(norm * optionCount)));
}

export function normaliseSelectIndex(idx: number, optionCount: number): number {
  return (idx + 0.5) / optionCount;
}

export function createSelectControl(opts: SelectControlOpts): {
  el: HTMLSelectElement;
  handle: KnobHandle;
} {
  const sel = document.createElement('select');
  sel.className = 'select-control';
  for (const o of opts.options) {
    const optEl = document.createElement('option');
    optEl.value = o.value;
    optEl.textContent = o.label;
    sel.appendChild(optEl);
  }
  sel.value = opts.initialValue;

  const meta: KnobMeta = { id: opts.id, label: opts.label, min: 0, max: 1 };
  const handle: KnobHandle = {
    el: sel,
    meta,
    setValue: (v: number) => {
      const idx = quantiseSelectValue(v, opts.options.length);
      const next = opts.options[idx].value;
      if (sel.value !== next) {
        sel.value = next;
        opts.onChange(next, false);
        handle.onValueChanged?.(v, false);
      }
    },
    setModulationOffset: () => { /* discrete controls don't show a ring */ },
  };

  sel.addEventListener('change', () => {
    const idx = opts.options.findIndex((o) => o.value === sel.value);
    const v = normaliseSelectIndex(Math.max(0, idx), opts.options.length);
    opts.onChange(sel.value, true);
    handle.onValueChanged?.(v, true);
  });

  return { el: sel, handle };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- select-control`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/select-control.ts src/core/select-control.test.ts
git commit -m "feat(core): discrete-value automatable selects/toggles

createSelectControl produces a <select> + KnobHandle pair so dropdowns
and toggles can register with the automation registry. Automation
values 0..1 quantise to option indices; normaliseSelectIndex returns
the mid-bucket value so registered current values roundtrip cleanly."
```

---

## Task 10: `renderModulatorsPanel`

**Files:**
- Create: `src/modulation/modulation-ui.ts`

- [ ] **Step 1: Write the file**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\modulation-ui.ts`:

```ts
// src/modulation/modulation-ui.ts
// Renders the modulators panel inside an engine's buildParamUI. Each
// engine instance has one ModulationHost; this UI mutates host state
// directly, then triggers an onChange callback so the engine can rebuild
// voices (or notify the registry).

import type { KnobHandle } from '../core/knob';
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import { SYNC_RATIO_MAP } from './rate-sync';
import type { ModulationHost, ModulatorState, Waveform } from './types';

export interface ModulationUIDeps {
  engineId: string;
  laneId: string;                         // for param-id prefix matching destination dropdown
  host: ModulationHost;
  registry: Map<string, KnobHandle>;
  registerKnob: (k: KnobHandle) => void;
  onChange: () => void;                   // engine re-renders or rebuilds voice
}

export function renderModulatorsPanel(container: HTMLElement, deps: ModulationUIDeps): void {
  const box = document.createElement('div');
  box.className = 'mod-panel';

  const header = document.createElement('div');
  header.className = 'mod-panel-header';
  header.appendChild(mkAddButton('+ LFO',  () => { deps.host.addModulator('lfo');  deps.onChange(); }));
  header.appendChild(mkAddButton('+ ADSR', () => { deps.host.addModulator('adsr'); deps.onChange(); }));
  box.appendChild(header);

  for (const mod of deps.host.modulators) {
    box.appendChild(renderModCard(mod, deps));
  }
  container.appendChild(box);
}

function mkAddButton(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.className = 'rnd';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderModCard(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const card = document.createElement('div');
  card.className = `mod-card mod-${mod.kind}`;

  // Header: enable toggle, name, delete
  const head = document.createElement('div');
  head.className = 'mod-card-header';
  const title = document.createElement('div');
  title.className = 'mod-card-title';
  title.textContent = mod.id.toUpperCase();
  head.appendChild(title);

  const enableBtn = document.createElement('button');
  enableBtn.className = 'rnd' + (mod.enabled ? ' primary' : '');
  enableBtn.textContent = mod.enabled ? 'ON' : 'OFF';
  enableBtn.addEventListener('click', () => {
    mod.enabled = !mod.enabled;
    deps.onChange();
  });
  head.appendChild(enableBtn);

  const rmBtn = document.createElement('button');
  rmBtn.className = 'rnd';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => { deps.host.removeModulator(mod.id); deps.onChange(); });
  head.appendChild(rmBtn);
  card.appendChild(head);

  // Config row
  card.appendChild(mod.kind === 'lfo' ? renderLfoConfig(mod, deps) : renderAdsrConfig(mod, deps));

  // Routing list
  card.appendChild(renderRoutingList(mod, deps));
  return card;
}

function renderLfoConfig(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mod-card-config';

  // Waveform select (automatable)
  const wave = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.waveform`,
    label: 'WAVE',
    options: [
      { value: 'sine',     label: 'Sine' },
      { value: 'triangle', label: 'Tri'  },
      { value: 'square',   label: 'Sqr'  },
      { value: 'saw',      label: 'Saw'  },
    ],
    initialValue: mod.waveform ?? 'sine',
    onChange: (v) => { mod.waveform = v as Waveform; deps.onChange(); },
  });
  deps.registerKnob(wave.handle);
  row.appendChild(wave.el);

  // Rate knob
  const rate = createKnob({
    id: `${deps.laneId}.mod.${mod.id}.rate`,
    label: 'RATE',
    min: 0.01, max: 40, step: 0.01,
    value: mod.rateHz ?? 4,
    defaultValue: 4,
    onChange: (v) => { mod.rateHz = v; deps.onChange(); },
    format: (v) => v < 1 ? `${v.toFixed(2)}Hz` : `${v.toFixed(1)}Hz`,
  });
  deps.registerKnob(rate);
  row.appendChild(rate.el);

  // Sync toggle (automatable)
  const sync = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.syncToBpm`,
    label: 'SYNC',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on',  label: 'On'  },
    ],
    initialValue: mod.syncToBpm ? 'on' : 'off',
    onChange: (v) => { mod.syncToBpm = v === 'on'; deps.onChange(); },
  });
  deps.registerKnob(sync.handle);
  row.appendChild(sync.el);

  // Sync ratio select (automatable)
  const ratioOpts = Object.keys(SYNC_RATIO_MAP).map((k) => ({ value: k, label: k }));
  const ratio = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.syncRatio`,
    label: 'RATIO',
    options: ratioOpts,
    initialValue: mod.syncRatio ?? '1/4',
    onChange: (v) => { mod.syncRatio = v; deps.onChange(); },
  });
  deps.registerKnob(ratio.handle);
  row.appendChild(ratio.el);

  // Bipolar toggle (automatable)
  const bipolar = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.bipolar`,
    label: 'POLARITY',
    options: [
      { value: 'uni', label: '0..1' },
      { value: 'bi',  label: '-1..+1' },
    ],
    initialValue: (mod.bipolar !== false) ? 'bi' : 'uni',
    onChange: (v) => { mod.bipolar = v === 'bi'; deps.onChange(); },
  });
  deps.registerKnob(bipolar.handle);
  row.appendChild(bipolar.el);

  return row;
}

function renderAdsrConfig(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mod-card-config';

  const mkAdsrKnob = (
    field: 'attackSec' | 'decaySec' | 'sustain' | 'releaseSec',
    label: string, min: number, max: number, def: number,
    fmt: (v: number) => string,
  ) => {
    const k = createKnob({
      id: `${deps.laneId}.mod.${mod.id}.${field}`,
      label, min, max, step: 0.001,
      value: (mod[field] as number | undefined) ?? def,
      defaultValue: def,
      onChange: (v) => { (mod as Record<string, unknown>)[field] = v; deps.onChange(); },
      format: fmt,
    });
    deps.registerKnob(k);
    row.appendChild(k.el);
  };

  const fmtTime = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
  mkAdsrKnob('attackSec',  'A', 0.001, 2,    0.01, fmtTime);
  mkAdsrKnob('decaySec',   'D', 0.001, 4,    0.3,  fmtTime);
  mkAdsrKnob('sustain',    'S', 0,     1,    0.7,  (v) => `${Math.round(v * 100)}%`);
  mkAdsrKnob('releaseSec', 'R', 0.001, 8,    0.3,  fmtTime);

  return row;
}

function renderRoutingList(mod: ModulatorState, deps: ModulationUIDeps): HTMLElement {
  const list = document.createElement('div');
  list.className = 'mod-card-routing';

  for (const conn of mod.connections) {
    list.appendChild(renderConnectionRow(mod, conn, deps));
  }

  // + Destination control: dropdown picks an unused param + initial depth 0.5
  const adder = document.createElement('div');
  adder.className = 'mod-conn-adder';
  const destSel = document.createElement('select');
  destSel.className = 'mod-dest-select';
  const used = new Set(mod.connections.map((c) => c.paramId));
  for (const id of destinationIds(deps.registry, deps.laneId)) {
    if (used.has(id)) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    destSel.appendChild(opt);
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'rnd primary';
  addBtn.textContent = '+ Destination';
  addBtn.addEventListener('click', () => {
    const paramId = destSel.value;
    if (!paramId) return;
    const cid = `c-${Date.now().toString(36)}`;
    deps.host.setConnection(mod.id, { id: cid, paramId, depth: 0.5 });
    deps.onChange();
  });
  adder.appendChild(destSel);
  adder.appendChild(addBtn);
  list.appendChild(adder);

  return list;
}

function renderConnectionRow(mod: ModulatorState, conn: import('./types').ModulationConnection, deps: ModulationUIDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mod-conn-row';

  const label = document.createElement('span');
  label.className = 'mod-conn-target';
  label.textContent = conn.paramId;
  row.appendChild(label);

  const depthKnob = createKnob({
    id: `${deps.laneId}.mod.${mod.id}.conn.${conn.id}.depth`,
    label: 'DEPTH',
    min: -1, max: 1, step: 0.001,
    value: conn.depth, defaultValue: 0,
    onChange: (v) => {
      deps.host.setConnection(mod.id, { ...conn, depth: v });
      deps.onChange();
    },
    format: (v) => v.toFixed(2),
  });
  deps.registerKnob(depthKnob);
  row.appendChild(depthKnob.el);

  const rmBtn = document.createElement('button');
  rmBtn.className = 'rnd';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => { deps.host.removeConnection(mod.id, conn.id); deps.onChange(); });
  row.appendChild(rmBtn);

  return row;
}

function destinationIds(registry: Map<string, KnobHandle>, laneId: string): string[] {
  const prefix = `${laneId}.`;
  return [...registry.keys()].filter((id) => id.startsWith(prefix) && !id.startsWith(`${laneId}.mod.`));
}
```

- [ ] **Step 2: SCSS**

Open `c:\Users\nacho\git\tb303-synth\src\styles\_session-inspector.scss`. Append:

```scss
/* Modulators panel inside engine UI. */
.mod-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 8px;
  margin-top: 12px;
}
.mod-panel-header { display: flex; gap: 6px; margin-bottom: 6px; }
.mod-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 8px;
  margin-bottom: 6px;
}
.mod-card-header { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.mod-card-title { flex: 1; font-size: 11px; letter-spacing: 0.1em; color: var(--amber); }
.mod-card-config { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.mod-card-routing { display: flex; flex-direction: column; gap: 4px; }
.mod-conn-row { display: flex; gap: 6px; align-items: center; }
.mod-conn-target { flex: 1; font-size: 11px; color: var(--text-dim); }
.mod-conn-adder { display: flex; gap: 6px; margin-top: 4px; }
.mod-dest-select { flex: 1; }
```

- [ ] **Step 3: Typecheck + tests**

`npx tsc --noEmit && npm test` — clean. No new tests yet (DOM-driven UI; covered by smoke test in later tasks).

- [ ] **Step 4: Commit**

```bash
git add src/modulation/modulation-ui.ts src/styles/_session-inspector.scss
git commit -m "feat(modulation): renderModulatorsPanel UI

Mod panel with per-engine modulators. Each mod card shows LFO or ADSR
config plus a routing list with depth knob per connection. All
controls (waveform, rate, sync, sync-ratio, bipolar, ADSR fields,
depths) register with the automation registry under
<laneId>.mod.<modId>.<field> ids."
```

---

# Phase 4 — Wavetable migration (first real engine adopter)

## Task 11: Wavetable preset migrator + tests

**Files:**
- Create: `src/modulation/preset-migration.ts`
- Create: `src/modulation/preset-migration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\preset-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { migrateWavetablePreset } from './preset-migration';
import type { EnginePreset } from '../engines/engine-types';

describe('migrateWavetablePreset', () => {
  it('passes through a modern preset with explicit modulators', () => {
    const p: EnginePreset = {
      name: 'P', params: { 'wt-pos': 0.5 },
      modulators: [{ id: 'adsr1', kind: 'adsr', enabled: true, connections: [], attackSec: 0.5 }],
    };
    const out = migrateWavetablePreset(p);
    expect(out.modulators).toBe(p.modulators);
  });

  it('converts wt-attack/decay/sustain/release into an ADSR connected to amp + cutoff', () => {
    const p: EnginePreset = {
      name: 'Legacy',
      params: {
        'wt-pos': 0.3,
        'wt-attack': 0.05, 'wt-decay': 0.4, 'wt-sustain': 0.6, 'wt-release': 1.2,
      },
    };
    const out = migrateWavetablePreset(p);
    expect(out.params['wt-attack']).toBeUndefined();
    expect(out.params['wt-pos']).toBe(0.3);
    expect(out.modulators).toHaveLength(1);
    const m = out.modulators![0];
    expect(m.kind).toBe('adsr');
    expect(m.attackSec).toBe(0.05);
    expect(m.decaySec).toBe(0.4);
    expect(m.sustain).toBe(0.6);
    expect(m.releaseSec).toBe(1.2);
    expect(m.connections.map(c => c.paramId).sort()).toEqual(['wt-amp', 'wt-cutoff']);
  });

  it('is idempotent (running twice yields the same result)', () => {
    const legacy: EnginePreset = {
      name: 'X', params: { 'wt-attack': 0.01, 'wt-decay': 0.3 },
    };
    const once = migrateWavetablePreset(legacy);
    const twice = migrateWavetablePreset(once);
    expect(twice).toEqual(once);
  });
});
```

- [ ] **Step 2: Run, verify failure**

`npm test -- preset-migration`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement**

Create `c:\Users\nacho\git\tb303-synth\src\modulation\preset-migration.ts`:

```ts
// src/modulation/preset-migration.ts
// Converts legacy engine presets (with envelope params baked into params record)
// into the modular form (params + modulators[]). Idempotent.

import type { EnginePreset } from '../engines/engine-types';
import type { ModulatorState } from './types';

export function migrateWavetablePreset(preset: EnginePreset): EnginePreset {
  if (preset.modulators && preset.modulators.length > 0) return preset;
  const p = preset.params;
  const a = p['wt-attack'], d = p['wt-decay'], s = p['wt-sustain'], r = p['wt-release'];
  if (a == null && d == null && s == null && r == null) return preset;

  const cleaned: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'wt-attack' || k === 'wt-decay' || k === 'wt-sustain' || k === 'wt-release') continue;
    cleaned[k] = v;
  }

  const adsr: ModulatorState = {
    id: 'adsr1', kind: 'adsr', enabled: true,
    attackSec: a ?? 0.01,
    decaySec:  d ?? 0.3,
    sustain:   s ?? 0.7,
    releaseSec: r ?? 0.3,
    connections: [
      { id: 'c-amp',    paramId: 'wt-amp',    depth: 1.0 },
      { id: 'c-cutoff', paramId: 'wt-cutoff', depth: 0.5 },
    ],
  };

  return { ...preset, params: cleaned, modulators: [adsr] };
}

export function migrateSubtractivePreset(preset: EnginePreset): EnginePreset {
  // Placeholder for Task 13. Returns preset unchanged for now.
  return preset;
}
```

Also extend `EnginePreset` in `src/engines/engine-types.ts` to add the optional field:

```ts
export interface EnginePreset {
  name: string;
  params: Record<string, number>;
  modulators?: import('../modulation/types').ModulatorState[];
}
```

- [ ] **Step 4: Run tests, verify they pass**

`npm test -- preset-migration` — PASS, 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/modulation/preset-migration.ts src/modulation/preset-migration.test.ts src/engines/engine-types.ts
git commit -m "feat(modulation): wavetable preset migrator (legacy ADSR params → modulator)

Idempotent migrator that converts wt-attack/decay/sustain/release into
an ADSR connected to wt-amp (depth 1) + wt-cutoff (depth 0.5). Modern
presets pass through unchanged. EnginePreset gains optional modulators[]."
```

---

## Task 12: Wavetable adopts `ModulationHost`

**Files:**
- Modify: `src/engines/wavetable.ts`

- [ ] **Step 1: Remove the legacy params**

Open `c:\Users\nacho\git\tb303-synth\src\engines\wavetable.ts`. In the `WT_PARAMS` array, delete the four entries for `wt-attack`, `wt-decay`, `wt-sustain`, `wt-release`.

- [ ] **Step 2: Add `wt-amp` as an automatable param target (the ADSR connects to it)**

Inside the wavetable Voice, ensure there is an `amp` GainNode whose `gain` AudioParam is exposed under the `wt-amp` id. If the existing code already manages an amp gain, expose it via a `voiceParamMap` so `bindVoiceModulation` can reach it. Also expose the filter cutoff via `wt-cutoff`.

Add a static `WT_PARAM_RANGES` map:

```ts
const WT_PARAM_RANGES = {
  'wt-amp':    { min: 0,  max: 1   },
  'wt-cutoff': { min: 20, max: 12000 },
  // include other automatable params as you expose them
} as const;
```

- [ ] **Step 3: Construct a `ModulationHostImpl` with default ADSR connected to amp + cutoff**

In the `WavetableEngine` class:

```ts
import { ModulationHostImpl, bindVoiceModulation } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';

private modHost = new ModulationHostImpl([
  {
    ...makeDefaultADSR('adsr1'),
    connections: [
      { id: 'c-amp',    paramId: 'wt-amp',    depth: 1.0 },
      { id: 'c-cutoff', paramId: 'wt-cutoff', depth: 0.5 },
    ],
  },
  makeDefaultLFO('lfo1'),
]);
```

- [ ] **Step 4: Wire `createVoice` to spawn modulators per voice and bind them**

Inside `createVoice(ctx, output)`, after the voice's nodes are built:

```ts
const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm ?? 120);
const voiceParamMap = { 'wt-amp': ampGain.gain, 'wt-cutoff': filter.frequency };
const paramRanges = WT_PARAM_RANGES as Record<string, { min: number; max: number }>;
bindVoiceModulation(voiceMods, this.modHost.modulators, voiceParamMap, paramRanges, ctx);
```

In the returned Voice's `trigger`, BEFORE the existing osc/filter/amp scheduling, dispatch to each mod voice:

```ts
trigger: (midi, time, opts) => {
  for (const mv of voiceMods.values()) mv.trigger(time, { gateDuration: opts.gateDuration, accent: opts.accent });
  // ... existing trigger logic (oscillator, filter sweep) ...
}
```

Remove the existing hardcoded ampGain/filter envelope scheduling (lines around 80-95 of the current wavetable.ts that schedule the linearRampToValueAtTime curves). The ADSR voice now does it via the bound GainNode.

- [ ] **Step 5: Apply preset migration at apply-time**

In `WavetableEngine.applyPreset(name)`, run the result through `migrateWavetablePreset` before applying:

```ts
import { migrateWavetablePreset } from '../modulation/preset-migration';

applyPreset(name: string): void {
  const raw = this.presets.find((p) => p.name === name);
  if (!raw) return;
  const preset = migrateWavetablePreset(raw);
  // Apply preset.params...
  if (preset.modulators) this.modHost.deserialize(preset.modulators);
  // ...
}
```

Also apply migration to the default presets list at module load if any of the existing wavetable presets has legacy params.

- [ ] **Step 6: Render the modulators panel**

In `WavetableEngine.buildParamUI(container, ctx)`, after the existing knobs are rendered, call:

```ts
import { renderModulatorsPanel } from '../modulation/modulation-ui';

renderModulatorsPanel(container, {
  engineId: this.id,
  laneId: ctx?.laneId ?? 'main',
  host: this.modHost,
  registry: ctx?.registry as Map<string, KnobHandle> ?? new Map(),
  registerKnob: (k) => ctx?.registerKnob(k),
  onChange: () => {
    // For now: just re-render the param panel. Voice nodes already running
    // will keep their current bindings; new triggers see updated mod state.
    container.innerHTML = '';
    this.buildParamUI(container, ctx);
  },
});
```

- [ ] **Step 7: Typecheck + tests**

`npx tsc --noEmit && npm test` — clean.

- [ ] **Step 8: Smoke test**

`npm run dev`. In Session, add a new lane → engine "Wavetable". Click ⚙ on the lane. Verify:
- ADSR1 card visible with A/D/S/R knobs + two routing rows (wt-amp, wt-cutoff).
- LFO1 card visible with rate/wave/sync/bipolar selects.
- Trigger notes in a clip — the note still sounds (amp envelope works).
- Click + Destination on LFO1, pick `<laneId>.wt-cutoff`, set depth to 0.5. Notes should now wobble in brightness.

- [ ] **Step 9: Commit**

```bash
git add src/engines/wavetable.ts
git commit -m "feat(wavetable): adopt ModulationHost — drop hardcoded ADSR params

wt-attack/decay/sustain/release params removed. Replaced by a default
ADSR modulator pre-connected to wt-amp (depth 1) and wt-cutoff (depth
0.5), plus a free LFO. Legacy presets are migrated on apply via
migrateWavetablePreset. Per-voice instancing: each note spawns its
own LFOVoice + ADSRVoice via spawnVoice."
```

---

# Phase 5 — Subtractive migration

## Task 13: Subtractive preset migrator + tests

**Files:**
- Modify: `src/modulation/preset-migration.ts`
- Modify: `src/modulation/preset-migration.test.ts`

- [ ] **Step 1: Append tests**

Add to `src/modulation/preset-migration.test.ts`:

```ts
import { migrateSubtractivePreset } from './preset-migration';

describe('migrateSubtractivePreset', () => {
  it('passes through modern presets with modulators', () => {
    const p = {
      name: 'P', params: { 'sub-pos': 0.5 },
      modulators: [{ id: 'adsr1', kind: 'adsr' as const, enabled: true, connections: [] }],
    };
    expect(migrateSubtractivePreset(p)).toBe(p);
  });

  it('converts amp env params (ampAttack/Decay/Sustain/Release) into amp ADSR', () => {
    const p = {
      name: 'Legacy',
      params: {
        ampAttack: 0.02, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 0.4,
      },
    };
    const out = migrateSubtractivePreset(p);
    const ampAdsr = out.modulators!.find((m) => m.connections.some((c) => c.paramId === 'amp'));
    expect(ampAdsr).toBeDefined();
    expect(ampAdsr!.attackSec).toBe(0.02);
    expect(ampAdsr!.releaseSec).toBe(0.4);
  });

  it('converts filter env params (filterAttack/.../filterEnvAmount) into filter ADSR with depth', () => {
    const p = {
      name: 'Legacy',
      params: {
        filterAttack: 0.01, filterDecay: 0.2, filterSustain: 0.5, filterRelease: 0.3,
        filterEnvAmount: 0.6,
      },
    };
    const out = migrateSubtractivePreset(p);
    const filtAdsr = out.modulators!.find((m) => m.connections.some((c) => c.paramId === 'cutoff'));
    expect(filtAdsr).toBeDefined();
    const cutoffConn = filtAdsr!.connections.find((c) => c.paramId === 'cutoff');
    expect(cutoffConn!.depth).toBe(0.6);
  });
});
```

- [ ] **Step 2: Implement**

In `src/modulation/preset-migration.ts`, replace the `migrateSubtractivePreset` stub:

```ts
export function migrateSubtractivePreset(preset: EnginePreset): EnginePreset {
  if (preset.modulators && preset.modulators.length > 0) return preset;
  const p = preset.params;
  const hasAmp = ['ampAttack', 'ampDecay', 'ampSustain', 'ampRelease'].some((k) => p[k] != null);
  const hasFilt = ['filterAttack', 'filterDecay', 'filterSustain', 'filterRelease'].some((k) => p[k] != null);
  if (!hasAmp && !hasFilt) return preset;

  const drop = new Set([
    'ampAttack', 'ampDecay', 'ampSustain', 'ampRelease',
    'filterAttack', 'filterDecay', 'filterSustain', 'filterRelease', 'filterEnvAmount',
  ]);
  const cleaned: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) if (!drop.has(k)) cleaned[k] = v;

  const modulators: import('./types').ModulatorState[] = [];
  if (hasAmp) {
    modulators.push({
      id: 'adsr-amp', kind: 'adsr', enabled: true,
      attackSec: p.ampAttack ?? 0.01,
      decaySec:  p.ampDecay  ?? 0.3,
      sustain:   p.ampSustain ?? 0.7,
      releaseSec: p.ampRelease ?? 0.3,
      connections: [{ id: 'c-amp', paramId: 'amp', depth: 1.0 }],
    });
  }
  if (hasFilt) {
    modulators.push({
      id: 'adsr-filter', kind: 'adsr', enabled: true,
      attackSec: p.filterAttack ?? 0.01,
      decaySec:  p.filterDecay  ?? 0.3,
      sustain:   p.filterSustain ?? 0.7,
      releaseSec: p.filterRelease ?? 0.3,
      connections: [{ id: 'c-cutoff', paramId: 'cutoff', depth: p.filterEnvAmount ?? 0.5 }],
    });
  }
  return { ...preset, params: cleaned, modulators };
}
```

- [ ] **Step 3: Tests pass**

`npm test -- preset-migration` — 6 cases now.

- [ ] **Step 4: Commit**

```bash
git add src/modulation/preset-migration.ts src/modulation/preset-migration.test.ts
git commit -m "feat(modulation): subtractive preset migrator

Converts amp ADSR and filter ADSR (with filterEnvAmount) from legacy
flat params into modular ADSR modulators on 'amp' and 'cutoff'."
```

---

## Task 14: Subtractive adopts `ModulationHost`

**Files:**
- Modify: `src/engines/subtractive.ts`
- Modify: `src/polysynth/polysynth.ts` (expose AudioParams)

- [ ] **Step 1: Expose voice AudioParams from PolySynth**

Open `src/polysynth/polysynth.ts`. Find the voice class. Add a method that returns a `voiceParamMap`:

```ts
getVoiceParams(voice: PolyVoice): Record<string, AudioParam> {
  return {
    amp:    voice.ampGain.gain,
    cutoff: voice.filter.frequency,
    pitch:  voice.osc1.detune,
    // expose more as needed; these three are the spec's default-target list
  };
}
```

(Implementation detail: depending on PolySynth's existing structure, this may need a small refactor to track voice nodes. Keep it minimal.)

- [ ] **Step 2: Subtractive adopts the host**

Open `src/engines/subtractive.ts`. Inside `SubtractiveEngine`:

```ts
private modHost = new ModulationHostImpl([
  { ...makeDefaultADSR('adsr-amp'),    connections: [{ id: 'c-amp',    paramId: 'amp',    depth: 1.0 }] },
  { ...makeDefaultADSR('adsr-filter'), connections: [{ id: 'c-cutoff', paramId: 'cutoff', depth: 0.5 }] },
  makeDefaultLFO('lfo1'),
  { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
]);
```

In `createVoice(ctx, output)`, after the underlying PolySynth voice is created, spawn modulators and bind:

```ts
const voiceMods = this.modHost.spawnVoice(ctx, () => this.bpm ?? 120);
const polyVoiceParams = this.polysynth.getVoiceParams(voice);
bindVoiceModulation(voiceMods, this.modHost.modulators, polyVoiceParams,
  { amp: { min: 0, max: 1 }, cutoff: { min: 20, max: 12000 }, pitch: { min: -1200, max: 1200 } },
  ctx);
```

In the returned Voice's `trigger`, fire each mod voice:

```ts
for (const mv of voiceMods.values()) mv.trigger(time, { gateDuration, accent });
```

Remove the existing hardcoded LFO classes/instances from PolySynth that were wired to fixed destinations. (If PolySynth's LFOs are tangled into the audio graph, leave them as a no-op disconnected oscillator for now — full removal is a follow-up cleanup.)

- [ ] **Step 3: Wire `migrateSubtractivePreset` into `applyPreset`**

```ts
import { migrateSubtractivePreset } from '../modulation/preset-migration';

applyPreset(name: string): void {
  const raw = this.presets.find((p) => p.name === name);
  if (!raw) return;
  const preset = migrateSubtractivePreset(raw);
  // Apply preset.params...
  if (preset.modulators) this.modHost.deserialize(preset.modulators);
}
```

- [ ] **Step 4: Render the panel in `buildParamUI`**

Same shape as Task 12 Step 6 — call `renderModulatorsPanel(container, { ... })` at the end.

- [ ] **Step 5: Typecheck + tests + smoke**

```
npx tsc --noEmit
npm test
npm run dev
```

In Session, edit a Subtractive lane (default is the "Subtractive 1" lane). Click ⚙. Should see two ADSRs (amp, filter) + two LFOs. Add a destination on LFO1 to cutoff at depth 0.3 — notes should wobble.

- [ ] **Step 6: Commit**

```bash
git add src/engines/subtractive.ts src/polysynth/polysynth.ts
git commit -m "feat(subtractive): adopt ModulationHost

Two ADSRs (amp, filter) and two LFOs by default. The amp ADSR
pre-connects to 'amp' (depth 1.0), the filter ADSR to 'cutoff' (depth
0.5). Legacy presets are migrated on apply. PolySynth exposes
getVoiceParams so the host can bind connections to the right
per-voice AudioParams."
```

---

# Phase 6 — FM, Karplus, TB303 (additive only)

## Task 15: FM additive integration

**Files:**
- Modify: `src/engines/fm.ts`

- [ ] **Step 1: Add a free LFO + ADSR with no default connections**

Open `src/engines/fm.ts`. Add to the FM engine class:

```ts
private modHost = new ModulationHostImpl([
  makeDefaultLFO('lfo1'),
  makeDefaultADSR('adsr1'),
]);
```

(Per-operator envelopes stay — they're identity. The modular pair is additive.)

In `createVoice`, expose the FM voice's main outputs (e.g. `outputGain.gain`, `op1Ratio`, `feedback`, anything the user might want to modulate) in a `voiceParamMap`. Call `bindVoiceModulation` + the per-mod `trigger` loop like Wavetable.

In `buildParamUI`, call `renderModulatorsPanel`.

- [ ] **Step 2: Typecheck + smoke**

`npx tsc --noEmit && npm test` + dev server. Add an FM lane, click ⚙, verify LFO + ADSR cards visible. No default connections — no audible difference until the user adds destinations.

- [ ] **Step 3: Commit**

```bash
git add src/engines/fm.ts
git commit -m "feat(fm): additive modulators (no default connections)

Per-operator envelopes preserved (part of FM identity). 1 LFO + 1
ADSR added as user-routable extras."
```

---

## Task 16: Karplus additive integration

**Files:**
- Modify: `src/engines/karplus.ts`

- [ ] **Step 1: Add host + binding**

Same shape as Task 15. Karplus has no existing envelopes; the LFO+ADSR are pure additions. Expose a `voiceParamMap` with `damping`, `pitch`, `feedback`, etc.

- [ ] **Step 2: Smoke + commit**

```bash
git add src/engines/karplus.ts
git commit -m "feat(karplus): additive modulators

1 LFO + 1 ADSR with no default connections."
```

---

## Task 17: TB303 additive integration (LFO only)

**Files:**
- Modify: `src/engines/tb303.ts`

- [ ] **Step 1: Add LFO only**

Open `src/engines/tb303.ts`. The 303 filter envelope is part of the algorithm — leave it. Add:

```ts
private modHost = new ModulationHostImpl([makeDefaultLFO('lfo1')]);
```

In `createVoice`, expose `cutoff`, `resonance`, `accent` AudioParams in `voiceParamMap`. Call `bindVoiceModulation` + per-mod `trigger`.

In `buildParamUI`, render the panel.

- [ ] **Step 2: Smoke + commit**

```bash
git add src/engines/tb303.ts
git commit -m "feat(tb303): additive LFO modulator

Filter envelope stays embedded (part of 303 character). A free LFO
lets the user drive dub-style cutoff wobbles or accent automation."
```

---

# Phase 7 — Persistence + automation-tick integration

## Task 18: SessionLane.engineState

**Files:**
- Modify: `src/session/session.ts`
- Modify: `src/session/session-migration.ts`

- [ ] **Step 1: Add the field**

Open `src/session/session.ts`. Extend `SessionLane`:

```ts
export interface SessionLane {
  id: string;
  engineId: string;
  name?: string;
  clips: (SessionClip | null)[];
  launchQuantize?: LaunchQuantize;
  engineState?: {
    modulators?: import('../modulation/types').ModulatorState[];
  };
}
```

- [ ] **Step 2: Round-trip on save/load**

The save manager (`src/save/save-wiring.ts`) already serializes `SessionLane[]` via `cloneSessionState`. As long as the new field is plain JSON, it round-trips automatically — verify by inspection of the existing serialize code.

In `src/session/session-host.ts`, after `applyLoadedSessionState` runs, for each lane:

```ts
for (const lane of this.state.lanes) {
  const mods = lane.engineState?.modulators;
  if (mods) {
    const engine = getEngine(lane.engineId);
    // Engines expose modHost as a public field via a small accessor:
    (engine as { modHost?: ModulationHost })?.modHost?.deserialize(mods);
  }
}
```

(Decide on the accessor pattern in the engine classes — either a public `modHost` field or a `setModulators(state)` method. Pick one consistently.)

- [ ] **Step 3: Add a save hook in the engines**

In each engine that has a `modHost`, add a `serializeState()` method that returns `{ modulators: this.modHost.serialize() }`. The save-wiring layer calls this when persisting per-lane state.

In `src/session/session-host.ts`, before serializing the state, walk lanes and write `engineState`:

```ts
private collectEngineState(): void {
  for (const lane of this.state.lanes) {
    const engine = getEngine(lane.engineId) as { serializeState?: () => { modulators: ModulatorState[] } };
    if (engine?.serializeState) lane.engineState = engine.serializeState();
  }
}
```

Call `collectEngineState()` from inside `getStateForSave()` so the save snapshot is current.

- [ ] **Step 4: Typecheck + tests + smoke**

`npx tsc --noEmit && npm test`.

In dev server: Session → add an LFO connection → Save (via the existing save button or `applyLoadedSessionState` cycle) → reload. Modulator connection should still be there.

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/session-host.ts src/session/session-migration.ts
git commit -m "feat(session): persist per-lane engine modulator state

SessionLane.engineState.modulators round-trips through save/load.
Engines expose serializeState() + accept modulator state on load via
modHost.deserialize."
```

---

## Task 19: Preset selector as discrete automatable param

**Files:**
- Modify: `src/engines/engine-selector-ui.ts` (or wherever the preset dropdown lives)
- Modify: `src/polysynth/polysynth-presets.ts`

- [ ] **Step 1: Wrap the preset dropdown in createSelectControl**

Search for where the preset `<select>` is created (likely `polysynth-presets.ts` or `engine-selector-ui.ts`). Replace the manual `<select>` construction with `createSelectControl`:

```ts
const { el: sel, handle } = createSelectControl({
  id: `${laneId}.preset`,
  label: 'PRESET',
  options: engine.presets.map((p) => ({ value: p.name, label: p.name })),
  initialValue: engine.presets[0]?.name ?? '',
  onChange: (v, fromUser) => {
    engine.applyPreset(v);
    if (fromUser) { /* nothing extra */ }
  },
});
registerKnob(handle);
container.appendChild(sel);
```

- [ ] **Step 2: Typecheck + smoke**

Verify: in Session, automating the preset (via the Automation tab's `+ Add` of `<laneId>.preset`) and painting a step-change of values should switch presets at the scheduled step.

- [ ] **Step 3: Commit**

```bash
git add src/engines/engine-selector-ui.ts src/polysynth/polysynth-presets.ts
git commit -m "feat(engines): preset selector is an automatable discrete param

Each engine's preset dropdown registers under <laneId>.preset.
Automation values 0..1 quantise to a preset index. Switching preset
applies the preset's params (which themselves remain automatable)."
```

---

## Task 20: rAF knob jiggle integration

**Files:**
- Modify: `src/automation/automation-tick.ts`

- [ ] **Step 1: Add a modulation-poll pass to the existing rAF loop**

Open `src/automation/automation-tick.ts`. Inside the rAF loop, after the existing automation-value writes, add a section that walks every registered knob whose id starts with `<laneId>.` (any lane) and computes the summed modulation offset by querying each lane's engine `modHost` for its active modulators + connections + currentValue.

Concretely, add a helper:

```ts
function applyModulationToKnobs(deps: AutomationTickDeps): void {
  for (const [paramId, handle] of deps.automationRegistry) {
    // paramId format: 'laneId.fieldOrSubpath' or 'laneId.mod.modId.field'
    // Only animate destinations (not modulator self-knobs).
    if (paramId.includes('.mod.')) continue;
    const dotIdx = paramId.indexOf('.');
    if (dotIdx < 0) continue;
    const laneId = paramId.slice(0, dotIdx);
    const engine = deps.getEngineForLane?.(laneId);
    const host = (engine as { modHost?: ModulationHost } | undefined)?.modHost;
    if (!host) continue;
    let offset = 0;
    for (const mod of host.modulators) {
      if (!mod.enabled) continue;
      for (const conn of mod.connections) {
        if (conn.paramId !== paramId.slice(dotIdx + 1) && conn.paramId !== paramId) continue;
        const voice = deps.getActiveModVoice?.(laneId, mod.id);
        if (!voice) continue;
        offset += voice.currentValue() * conn.depth;
      }
    }
    handle.setModulationOffset(Math.max(-1, Math.min(1, offset)));
  }
}
```

Call `applyModulationToKnobs(deps)` once per rAF frame.

Add to `AutomationTickDeps`:

```ts
getEngineForLane?: (laneId: string) => SynthEngine | undefined;
getActiveModVoice?: (laneId: string, modId: string) => ModulatorVoice | undefined;
```

In `main.ts`, wire these to read from the per-lane voice cache built by `ensureLaneVoice`. (Engines need to expose `getLastVoiceMods()` or similar — keep simple.)

- [ ] **Step 2: Verify knob animation**

Smoke test: open a lane with an LFO connected to cutoff at depth 0.5. Play a note. The cutoff knob should show an amber ring moving in time with the LFO.

- [ ] **Step 3: Commit**

```bash
git add src/automation/automation-tick.ts src/main.ts
git commit -m "feat(automation): drive knob modulation rings from active mod voices

rAF loop now polls each lane's modulator voices and sums their
currentValue * depth into the corresponding destination knob's
setModulationOffset. The amber ring overlay animates in real time."
```

---

## Out of scope (deferred)

- Modulators modulating other modulators.
- Modulation macros (a single knob driving N depths).
- Preset libraries that include modulation matrix.
- Drum-engine modulators.
- Preset-selector filtering by engine context (separate bug — flagged in spec §8.3).

---

## Self-review notes

- Spec §3 (core types) → Task 1
- Spec §4 (LFOVoice + ADSRVoice + bindVoiceModulation) → Tasks 2, 3, 4, 5, 6
- Spec §5 (UI panel + KnobHandle.setModulationOffset) → Tasks 7, 8, 9, 10
- Spec §6 (per-engine integration) → Tasks 11–17
- Spec §7 (save/load) → Task 18
- Spec §8 (automation registry, discrete values, preset selector) → Tasks 9, 19, 20
- Spec §10 (testing) → Tests in Tasks 2, 3, 4, 5, 9, 11, 13
- All task code is self-contained; types defined in Task 1 are reused with consistent names through Task 20.
- No placeholders / TBDs / "implement later" without code.
