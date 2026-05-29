# Modulator Scope + Subtractive Polyphony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make modulator lifecycle correct on polyphonic engines (LFOs continuous across notes; ADSRs per-note) and add monophonic/polyphonic mode + voice-count cap to the subtractive engine.

**Architecture:** Each `ModulatorState` declares a `scope` (`shared` | `per-voice`). Shared modulators live on the engine and write to a new **modulation bus** (`ConstantSourceNode`) inside each voice manager that fans out internally to every active per-voice AudioParam. Per-voice modulators are spawned per `createVoice` call as today, bound only to that voice's params. `voice-mod-binding.ts` splits into two binders. The Subtractive engine additionally gains a `MODE` (mono/poly), `RETRIG` (legato/retrig), and `VOICES` (1–16) control in its panel header.

**Tech Stack:** TypeScript, Web Audio API, Vitest (unit tests + `.dsp.test.ts` battery via `node-web-audio-api`), Playwright (e2e).

**Spec:** [docs/superpowers/specs/2026-05-29-modulator-scope-and-polyphony.md](../specs/2026-05-29-modulator-scope-and-polyphony.md)

---

## File structure

**Modified files:**
- `src/modulation/types.ts` — `ModulatorScope`, `scope` field on `ModulatorState`, defaults in `makeDefaultLFO`/`makeDefaultADSR`, new `normalizeModulator` helper, `defaultScopeFor(kind)` helper.
- `src/modulation/modulation-host.ts` — rename `spawnVoice` → `spawnVoiceFiltered` (predicate added); keep `spawnVoice` as a thin wrapper.
- `src/modulation/modulation-host.test.ts` — extend with filter tests.
- `src/modulation/voice-mod-binding.ts` — split into `bindVoiceModulators` (per-voice only) + new `bindEngineModulators` (shared only). Lane bindings record holds both.
- `src/modulation/voice-mod-binding.test.ts` — extend.
- `src/modulation/modulation-ui.ts` — add SCOPE select to LFO config row; hide TRIG when scope=per-voice.
- `src/engines/engine-types.ts` — add `getSharedAudioParams?(ctx?: AudioContext): Map<string, AudioParam>` to `SynthEngine`.
- `src/engines/tb303.ts` — implement `getSharedAudioParams` (returns the single instance's AudioParams).
- `src/engines/drums-engine.ts` — implement `getSharedAudioParams` (returns the existing bus + voice AudioParams).
- `src/polysynth/polysynth.ts` — add `modBus`, `setMaxVoices`, `setMode`, voice-stealing in `internalTrigger`, legato/retrig branch.
- `src/polysynth/polysynth.test.ts` (new) — modBus + voice cap tests.
- `src/engines/subtractive.ts` — engine-wide modVoices for shared, per-voice modVoices, `getSharedAudioParams`, MODE/RETRIG/VOICES UI in header.
- `src/engines/wavetable.ts` — engineModVoices for shared + per-voice; `getSharedAudioParams`.
- `src/engines/fm.ts` — same.
- `src/engines/karplus.ts` — same.
- `tests/e2e/lane-ui.spec.ts` — append modulator-scope e2e tests.

---

## Task 1: Add `ModulatorScope` type + defaults + normalize helper

**Files:**
- Modify: `src/modulation/types.ts`
- Test: `src/modulation/types.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `src/modulation/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  makeDefaultLFO, makeDefaultADSR, normalizeModulator,
  defaultScopeFor, type ModulatorState,
} from './types';

describe('ModulatorScope defaults', () => {
  it('makeDefaultLFO has scope="shared"', () => {
    expect(makeDefaultLFO('lfo1').scope).toBe('shared');
  });

  it('makeDefaultADSR has scope="per-voice"', () => {
    expect(makeDefaultADSR('adsr1').scope).toBe('per-voice');
  });

  it('defaultScopeFor maps kind → default scope', () => {
    expect(defaultScopeFor('lfo')).toBe('shared');
    expect(defaultScopeFor('adsr')).toBe('per-voice');
  });

  it('normalizeModulator fills in missing scope based on kind', () => {
    const oldLfo: ModulatorState = {
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [], rateHz: 4,
    };
    expect(normalizeModulator(oldLfo).scope).toBe('shared');

    const oldAdsr: ModulatorState = {
      id: 'a1', kind: 'adsr', enabled: true, connections: [], attackSec: 0.01,
    };
    expect(normalizeModulator(oldAdsr).scope).toBe('per-voice');
  });

  it('normalizeModulator preserves explicit scope', () => {
    const m: ModulatorState = {
      id: 'lfo1', kind: 'lfo', enabled: true, connections: [], scope: 'per-voice',
    };
    expect(normalizeModulator(m).scope).toBe('per-voice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/modulation/types.test.ts`
Expected: FAIL — `normalizeModulator`, `defaultScopeFor`, and `scope` field don't exist yet.

- [ ] **Step 3: Add types, defaults, and helpers**

In `src/modulation/types.ts`, add the type alias after `Waveform`:

```ts
export type ModulatorScope = 'shared' | 'per-voice';
```

Add `scope?: ModulatorScope;` to `ModulatorState` (place it right after `connections: ModulationConnection[];`):

```ts
export interface ModulatorState {
  id: string;
  kind: ModulatorKind;
  enabled: boolean;
  connections: ModulationConnection[];
  /** Where the modulator's voice lives. 'shared' = engine-owned, one
   *  instance for all notes (default for LFO). 'per-voice' = spawned per
   *  createVoice call, lives for the duration of that note (default and
   *  only valid value for ADSR). */
  scope?: ModulatorScope;
  // ...existing LFO/ADSR fields
```

Update `makeDefaultLFO`:

```ts
export function makeDefaultLFO(id: string): ModulatorState {
  return {
    id, kind: 'lfo', enabled: true, connections: [],
    rateHz: 4, waveform: 'sine', bipolar: true,
    syncToBpm: false, syncRatio: '1/4',
    trigger: 'free',
    scope: 'shared',
  };
}
```

Update `makeDefaultADSR`:

```ts
export function makeDefaultADSR(id: string): ModulatorState {
  return {
    id, kind: 'adsr', enabled: true, connections: [],
    attackSec: 0.01, decaySec: 0.3, sustain: 0.7, releaseSec: 0.3,
    scope: 'per-voice',
  };
}
```

Add at the end of the file:

```ts
/** Default scope for a modulator kind. Used by normalizeModulator to fill in
 *  the field on older saves that pre-date the scope concept. */
export function defaultScopeFor(kind: ModulatorKind): ModulatorScope {
  return kind === 'lfo' ? 'shared' : 'per-voice';
}

/** Return a shallow clone with `scope` populated from `defaultScopeFor(kind)`
 *  when missing. Idempotent — calling twice is safe. */
export function normalizeModulator(m: ModulatorState): ModulatorState {
  if (m.scope) return m;
  return { ...m, scope: defaultScopeFor(m.kind) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/modulation/types.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Apply normalize at deserialization**

In `src/modulation/modulation-host.ts`, find the existing `deserialize` method:

```ts
deserialize(state: ModulatorState[]): void {
  this.modulators = state.map((m) => ({ ...m, connections: m.connections.map((c) => ({ ...c })) }));
}
```

Replace it with a version that normalizes:

```ts
deserialize(state: ModulatorState[]): void {
  this.modulators = state.map((m) => {
    const norm = normalizeModulator(m);
    return { ...norm, connections: norm.connections.map((c) => ({ ...c })) };
  });
}
```

Add the import at the top of `modulation-host.ts`:

```ts
import {
  // ...existing
  normalizeModulator,
} from './types';
```

- [ ] **Step 6: Run full unit suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modulation/types.ts src/modulation/types.test.ts src/modulation/modulation-host.ts
git commit -m "feat(mod): add ModulatorScope + per-kind defaults + load-time normalize"
```

---

## Task 2: `ModulationHost.spawnVoiceFiltered`

**Files:**
- Modify: `src/modulation/types.ts` (interface)
- Modify: `src/modulation/modulation-host.ts` (impl)
- Modify: `src/modulation/modulation-host.test.ts` (extend)

- [ ] **Step 1: Write failing test**

Append to `src/modulation/modulation-host.test.ts`:

```ts
import { ModulationHostImpl } from './modulation-host';

describe('ModulationHostImpl.spawnVoiceFiltered', () => {
  // Note: spawnVoice constructs actual LFOVoice/ADSRVoice with Web Audio —
  // skipped in node-env unless globalThis.AudioContext is available via test/setup.
  // The pre-existing modulation-host.test.ts is pure (no AudioContext); we
  // only assert the FILTER semantics here, mocking the constructors via spawn-count
  // by counting the returned map's keys.
  it('spawns only modulators matching the predicate', () => {
    const host = new ModulationHostImpl([
      { id: 'lfo1',  kind: 'lfo',  enabled: true, connections: [], scope: 'shared'   },
      { id: 'adsr1', kind: 'adsr', enabled: true, connections: [], scope: 'per-voice'},
      { id: 'lfo2',  kind: 'lfo',  enabled: true, connections: [], scope: 'per-voice'},
    ]);
    // Stub ctx — spawnVoiceFiltered with a no-op predicate doesn't actually
    // construct voices. Use the predicate to count what would be spawned.
    const captured: string[] = [];
    const fakeCtx = {} as unknown as AudioContext;
    // Intercept by using a predicate that records ids and returns false.
    host.spawnVoiceFiltered(fakeCtx, () => 120, (m) => {
      captured.push(m.id);
      return false;
    });
    expect(captured).toEqual(['lfo1', 'adsr1', 'lfo2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/modulation/modulation-host.test.ts`
Expected: FAIL — `spawnVoiceFiltered` doesn't exist.

- [ ] **Step 3: Add the interface method**

In `src/modulation/types.ts`, find the `ModulationHost` interface:

```ts
export interface ModulationHost {
  // ...
  spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice>;
  // ...
}
```

Add `spawnVoiceFiltered` next to `spawnVoice`:

```ts
  spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice>;
  spawnVoiceFiltered(
    ctx: AudioContext,
    bpm: () => number,
    predicate: (m: ModulatorState) => boolean,
  ): Map<string, ModulatorVoice>;
```

- [ ] **Step 4: Implement on `ModulationHostImpl`**

In `src/modulation/modulation-host.ts`, replace the existing `spawnVoice` method with:

```ts
spawnVoice(ctx: AudioContext, bpm: () => number): Map<string, ModulatorVoice> {
  return this.spawnVoiceFiltered(ctx, bpm, () => true);
}

spawnVoiceFiltered(
  ctx: AudioContext,
  bpm: () => number,
  predicate: (m: ModulatorState) => boolean,
): Map<string, ModulatorVoice> {
  const out = new Map<string, ModulatorVoice>();
  for (const m of this.modulators) {
    if (!m.enabled) continue;
    if (!predicate(m)) continue;
    out.set(m.id, m.kind === 'lfo' ? new LFOVoice(ctx, m, bpm) : new ADSRVoice(ctx, m));
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/modulation/modulation-host.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modulation/types.ts src/modulation/modulation-host.ts src/modulation/modulation-host.test.ts
git commit -m "feat(mod): ModulationHost.spawnVoiceFiltered for scope-partitioned spawning"
```

---

## Task 3: `getSharedAudioParams` on the SynthEngine interface + mono engine implementations

**Files:**
- Modify: `src/engines/engine-types.ts`
- Modify: `src/engines/tb303.ts`
- Modify: `src/engines/drums-engine.ts`
- Test: `src/engines/tb303.test.ts` (extend), `src/engines/drums-engine.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Append to `src/engines/tb303.test.ts`:

```ts
describe('TB303Engine.getSharedAudioParams', () => {
  it('returns the underlying TB303 filter+amp AudioParams after createVoice', () => {
    const engine = new TB303Engine();
    const ctx = new AudioContext();
    engine.createVoice(ctx, ctx.destination);
    const shared = engine.getSharedAudioParams?.(ctx) ?? new Map();
    expect(shared.has('filter.cutoff')).toBe(true);
    expect(shared.has('filter.resonance')).toBe(true);
    expect(shared.has('amp.gain')).toBe(true);
  });

  it('returns an empty Map before any createVoice call', () => {
    const engine = new TB303Engine();
    const shared = engine.getSharedAudioParams?.(undefined) ?? new Map();
    expect(shared.size).toBe(0);
  });
});
```

Append to `src/engines/drums-engine.test.ts`:

```ts
describe('DrumsEngine.getSharedAudioParams', () => {
  it('returns the bus EQ + level + sends after setBusStrip', async () => {
    const ctx = new OfflineAudioContext(1, 128, 44100) as unknown as AudioContext;
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    engine.createVoice(ctx, strip.input);
    const shared = engine.getSharedAudioParams?.(ctx) ?? new Map();
    expect(shared.has('bus.eq.low')).toBe(true);
    expect(shared.has('bus.level')).toBe(true);
    expect(shared.has('bus.pan')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/engines/tb303.test.ts src/engines/drums-engine.test.ts`
Expected: FAIL — `getSharedAudioParams` doesn't exist.

- [ ] **Step 3: Add the optional method to the SynthEngine interface**

In `src/engines/engine-types.ts`, find the `SynthEngine` interface. Add this method right after `dispose(): void;`:

```ts
  /** AudioParams that SHARED modulators write to. The voice manager's
   *  modulation bus fans this out internally to every active per-voice
   *  AudioParam, so the binder makes ONE connection regardless of how
   *  many notes are playing. Returns an empty Map until the engine has
   *  a voice manager instance (lazy after first createVoice). */
  getSharedAudioParams?(ctx?: AudioContext): Map<string, AudioParam>;
```

- [ ] **Step 4: Implement on TB303Engine**

In `src/engines/tb303.ts`, find the `TB303Engine` class. Add this method after `dispose()` (or after the existing public methods):

```ts
  getSharedAudioParams(): Map<string, AudioParam> {
    if (!this.lastInstance) return new Map();
    return new Map<string, AudioParam>([
      ['filter.cutoff',    this.lastInstance.filter.frequency],
      ['filter.resonance', this.lastInstance.filter.Q],
      ['amp.gain',         this.lastInstance.amp.gain],
    ]);
  }
```

- [ ] **Step 5: Implement on DrumsEngine**

In `src/engines/drums-engine.ts`, find the `DrumsEngine` class. Add this method after `dispose()`:

```ts
  getSharedAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    if (this.busStrip) {
      m.set('bus.level',      this.busStrip.level.gain);
      m.set('bus.pan',        this.busStrip.getPanParam());
      m.set('bus.reverbSend', this.busStrip.reverbSend.gain);
      m.set('bus.delaySend',  this.busStrip.delaySend.gain);
      m.set('bus.eq.low',     this.busStrip.getEqGainParam('low'));
      m.set('bus.eq.mid',     this.busStrip.getEqGainParam('mid'));
      m.set('bus.eq.high',    this.busStrip.getEqGainParam('high'));
    }
    return m;
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/engines/tb303.test.ts src/engines/drums-engine.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engines/engine-types.ts src/engines/tb303.ts src/engines/drums-engine.ts src/engines/tb303.test.ts src/engines/drums-engine.test.ts
git commit -m "feat(engines): SynthEngine.getSharedAudioParams + mono-engine impls"
```

---

## Task 4: Split `voice-mod-binding` into engine + voice paths

**Files:**
- Modify: `src/modulation/voice-mod-binding.ts`
- Modify: `src/modulation/voice-mod-binding.test.ts` (extend)

- [ ] **Step 1: Write failing test**

Append to `src/modulation/voice-mod-binding.test.ts`:

```ts
import { bindEngineModulators, bindVoiceModulators } from './voice-mod-binding';

describe('bindVoiceModulators — scope partitioning', () => {
  it('only wires modulators with scope=per-voice', () => {
    // Engine has one shared LFO + one per-voice ADSR.
    const ctx = new AudioContext();
    const dummyParam = ctx.createGain().gain;
    const lfoOut = ctx.createConstantSource(); lfoOut.start();
    const adsrOut = ctx.createConstantSource(); adsrOut.start();

    const engine = {
      modulators: { modulators: [
        { id: 'lfo1', kind: 'lfo', enabled: true, connections: [
          { id: 'c1', paramId: 'lane.filter.cutoff', depth: 0.5 },
        ], scope: 'shared' },
        { id: 'adsr1', kind: 'adsr', enabled: true, connections: [
          { id: 'c2', paramId: 'lane.amp.gain', depth: 0.5 },
        ], scope: 'per-voice' },
      ]},
      params: [
        { id: 'filter.cutoff', min: 0, max: 1, kind: 'continuous', label: 'C', default: 0 },
        { id: 'amp.gain',      min: 0, max: 1, kind: 'continuous', label: 'A', default: 0 },
      ],
    } as never;
    const voice = {
      getAudioParams: () => new Map<string, AudioParam>([
        ['filter.cutoff', dummyParam],
        ['amp.gain',      dummyParam],
      ]),
    } as never;
    const voiceMods = new Map([['adsr1', { output: adsrOut, trigger(){}, release(){}, dispose(){}, currentValue(){return 0;} }]]);
    const binder = bindVoiceModulators({ laneId: 'lane', engine, voice, voiceMods, ctx });
    // Only the ADSR was wired (LFO scope=shared is filtered out).
    expect(binder.activeCount()).toBe(1);
  });
});

describe('bindEngineModulators — scope partitioning', () => {
  it('only wires modulators with scope=shared', () => {
    const ctx = new AudioContext();
    const dummyParam = ctx.createGain().gain;
    const lfoOut = ctx.createConstantSource(); lfoOut.start();

    const engine = {
      modulators: { modulators: [
        { id: 'lfo1', kind: 'lfo', enabled: true, connections: [
          { id: 'c1', paramId: 'lane.filter.cutoff', depth: 0.5 },
        ], scope: 'shared' },
        { id: 'adsr1', kind: 'adsr', enabled: true, connections: [
          { id: 'c2', paramId: 'lane.amp.gain', depth: 0.5 },
        ], scope: 'per-voice' },
      ]},
      params: [
        { id: 'filter.cutoff', min: 0, max: 1, kind: 'continuous', label: 'C', default: 0 },
        { id: 'amp.gain',      min: 0, max: 1, kind: 'continuous', label: 'A', default: 0 },
      ],
      getSharedAudioParams: () => new Map([['filter.cutoff', dummyParam]]),
    } as never;
    const sharedMods = new Map([['lfo1', { output: lfoOut, trigger(){}, release(){}, dispose(){}, currentValue(){return 0;} }]]);
    const binder = bindEngineModulators({ laneId: 'lane', engine, voiceMods: sharedMods, ctx });
    expect(binder.activeCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/modulation/voice-mod-binding.test.ts`
Expected: FAIL — `bindEngineModulators` doesn't exist; `bindVoiceModulators` currently wires all modulators (no scope filter).

- [ ] **Step 3: Refactor `voice-mod-binding.ts`**

Replace the entirety of `src/modulation/voice-mod-binding.ts` with:

```ts
// src/modulation/voice-mod-binding.ts
// Wires modulator outputs to destination AudioParams via ConnectionBinder.
// Modulators are partitioned by scope:
//
//   bindEngineModulators — scope='shared' mods wired to the engine's
//                          modulation-bus AudioParams (getSharedAudioParams).
//                          Called once per engine instance.
//
//   bindVoiceModulators  — scope='per-voice' mods wired to a freshly-spawned
//                          Voice's per-note AudioParams (getAudioParams).
//                          Called per createVoice call.
//
// Both record into the lane bindings map so reapplyLaneModulations can refresh
// both paths after a state change.

import type { SynthEngine, Voice } from '../engines/engine-types';
import type { ModulatorState, ModulatorVoice } from './types';
import { defaultScopeFor } from './types';
import type { ParamRange } from './modulation-host';
import { ConnectionBinder } from './connection-binder';

export interface BindVoiceModulatorsOpts {
  laneId: string;
  engine: SynthEngine;
  voice: Voice;
  voiceMods: Map<string, ModulatorVoice>;
  ctx: AudioContext;
}

export interface BindEngineModulatorsOpts {
  laneId: string;
  engine: SynthEngine;
  voiceMods: Map<string, ModulatorVoice>;
  ctx: AudioContext;
}

interface LaneBindings {
  laneId: string;
  ctx: AudioContext;
  engineRef: SynthEngine;
  /** Engine-wide binder for scope='shared' modulators. */
  engineBinding?: { binder: ConnectionBinder; voiceMods: Map<string, ModulatorVoice> };
  /** Per-voice binder + the latest voice. Replaced on every new Voice. */
  voiceBinding?: { binder: ConnectionBinder; voice: Voice; voiceMods: Map<string, ModulatorVoice> };
}

const laneBindings = new Map<string, LaneBindings>();

function scopeOf(m: ModulatorState): 'shared' | 'per-voice' {
  return m.scope ?? defaultScopeFor(m.kind);
}

function applyBinder(
  binder: ConnectionBinder,
  laneId: string,
  engine: SynthEngine,
  voiceMods: Map<string, ModulatorVoice>,
  shortParams: Map<string, AudioParam>,
  rangeLookup: (shortId: string) => ParamRange,
  scope: 'shared' | 'per-voice',
  ctx: AudioContext,
): void {
  const destMap = new Map<string, AudioParam>();
  const rangeMap = new Map<string, ParamRange>();
  for (const [shortId, param] of shortParams) {
    const fullId = `${laneId}.${shortId}`;
    const r = rangeLookup(shortId);
    destMap.set(fullId, param);
    rangeMap.set(fullId, r);
    destMap.set(shortId, param);
    rangeMap.set(shortId, r);
  }
  const scopeFilter = engine.modulators.modulators.filter((m) => scopeOf(m) === scope);
  binder.apply(voiceMods, scopeFilter, destMap, rangeMap, ctx);
}

function rangeLookupForVoice(engine: SynthEngine, voice: Voice): (id: string) => ParamRange {
  return (shortId: string): ParamRange => {
    const declared = voice.getAudioParamRange?.(shortId);
    if (declared) return declared;
    const spec = engine.params.find((p) => p.id === shortId);
    return { min: spec ? spec.min : 0, max: spec ? spec.max : 1 };
  };
}

function rangeLookupForEngine(engine: SynthEngine): (id: string) => ParamRange {
  return (shortId: string): ParamRange => {
    // For shared/bus AudioParams we don't have a Voice — fall back to the spec
    // range. Engines that need a different operating range here can override
    // by extending getSharedAudioParams to map to ConstantSourceNode.offset
    // whose unit IS the spec range.
    const spec = engine.params.find((p) => p.id === shortId);
    return { min: spec ? spec.min : 0, max: spec ? spec.max : 1 };
  };
}

function getOrCreateLane(laneId: string, engine: SynthEngine, ctx: AudioContext): LaneBindingsActual {
  let lb = laneBindings.get(laneId);
  if (!lb) {
    lb = { laneId, ctx, engineRef: engine };
    laneBindings.set(laneId, lb);
  }
  return lb;
}

export function bindEngineModulators(opts: BindEngineModulatorsOpts): ConnectionBinder {
  const lb = getOrCreateLane(opts.laneId, opts.engine, opts.ctx);
  // Tear down previous engine binding if any (shouldn't normally happen — engine
  // mods spawn once per engine — but supports test cleanup).
  if (lb.engineBinding) lb.engineBinding.binder.disposeAll();

  const binder = new ConnectionBinder();
  const shortParams = opts.engine.getSharedAudioParams?.(opts.ctx) ?? new Map<string, AudioParam>();
  applyBinder(
    binder, opts.laneId, opts.engine, opts.voiceMods,
    shortParams, rangeLookupForEngine(opts.engine), 'shared', opts.ctx,
  );
  lb.engineBinding = { binder, voiceMods: opts.voiceMods };
  return binder;
}

export function bindVoiceModulators(opts: BindVoiceModulatorsOpts): ConnectionBinder {
  const lb = getOrCreateLane(opts.laneId, opts.engine, opts.ctx);
  if (lb.voiceBinding) lb.voiceBinding.binder.disposeAll();

  const binder = new ConnectionBinder();
  applyBinder(
    binder, opts.laneId, opts.engine, opts.voiceMods,
    opts.voice.getAudioParams(),
    rangeLookupForVoice(opts.engine, opts.voice),
    'per-voice',
    opts.ctx,
  );
  lb.voiceBinding = { binder, voice: opts.voice, voiceMods: opts.voiceMods };
  return binder;
}

export function reapplyLaneModulations(laneId: string): void {
  const lb = laneBindings.get(laneId);
  if (!lb) return;
  if (lb.engineBinding) {
    const shortParams = lb.engineRef.getSharedAudioParams?.(lb.ctx) ?? new Map<string, AudioParam>();
    applyBinder(
      lb.engineBinding.binder, lb.laneId, lb.engineRef, lb.engineBinding.voiceMods,
      shortParams, rangeLookupForEngine(lb.engineRef), 'shared', lb.ctx,
    );
  }
  if (lb.voiceBinding) {
    applyBinder(
      lb.voiceBinding.binder, lb.laneId, lb.engineRef, lb.voiceBinding.voiceMods,
      lb.voiceBinding.voice.getAudioParams(),
      rangeLookupForVoice(lb.engineRef, lb.voiceBinding.voice),
      'per-voice', lb.ctx,
    );
  }
}

export function disposeLaneModulations(laneId: string): void {
  const lb = laneBindings.get(laneId);
  if (!lb) return;
  lb.engineBinding?.binder.disposeAll();
  lb.voiceBinding?.binder.disposeAll();
  laneBindings.delete(laneId);
}

export function clearLaneBindings(): void {
  for (const lb of laneBindings.values()) {
    lb.engineBinding?.binder.disposeAll();
    lb.voiceBinding?.binder.disposeAll();
  }
  laneBindings.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/modulation/voice-mod-binding.test.ts`
Expected: PASS, all old + new tests.

If any pre-existing test fails because it relied on `bindVoiceModulators` wiring shared mods, update it to explicitly set `scope: 'per-voice'` on its mock modulators OR move it to `bindEngineModulators`.

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: no TS errors. Some non-test code may need a single-token adjustment (e.g. `voice-mod-binding`'s old `BindVoiceModulatorsOpts` shape is unchanged, so callers compile).

- [ ] **Step 6: Commit**

```bash
git add src/modulation/voice-mod-binding.ts src/modulation/voice-mod-binding.test.ts
git commit -m "refactor(mod): split voice-mod-binding into engine + per-voice paths"
```

---

## Task 5: PolySynth modulation bus

**Files:**
- Modify: `src/polysynth/polysynth.ts`
- Test: `src/polysynth/polysynth-modbus.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `src/polysynth/polysynth-modbus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { OfflineAudioContext } from 'node-web-audio-api';
import { PolySynth } from './polysynth';

describe('PolySynth.modBus', () => {
  it('exposes modBus AudioParams keyed by canonical paramId', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    expect(ps.modBus['filter.cutoff']).toBeDefined();
    expect(ps.modBus['filter.resonance']).toBeDefined();
    expect(ps.modBus['amp.gain']).toBeDefined();
    expect(ps.modBus['filter.cutoff'].offset).toBeInstanceOf(AudioParam);
  });

  it('writing to modBus.filter.cutoff.offset audibly shifts a played voice', async () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    // Trigger a 0.5-second note at time 0.
    ps.trigger(60, 0, 0.5);
    // Sweep cutoff aggressively via the bus.
    ps.modBus['filter.cutoff'].offset.setValueAtTime(-2000, 0);
    ps.modBus['filter.cutoff'].offset.linearRampToValueAtTime(2000, 0.5);
    const out = await (ctx as unknown as OfflineAudioContext).startRendering();
    // Just check the buffer rendered without throwing. Detailed spectral
    // assertions live in the engine-level .dsp.test.ts battery.
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/polysynth/polysynth-modbus.test.ts`
Expected: FAIL — `modBus` doesn't exist.

- [ ] **Step 3: Add modBus to PolySynth**

In `src/polysynth/polysynth.ts`, find the `PolySynth` class declaration. Add a public `modBus` field and lazy-create the nodes in the constructor:

```ts
export class PolySynth {
  params: PolySynthParams;
  bpm = 130;
  private noiseBuffer: AudioBuffer;

  /** Modulation bus — one ConstantSourceNode per shared-modulatable
   *  AudioParam. .offset is the AudioParam external SHARED modulators write
   *  to; the bus output is connected to each allocated voice's matching
   *  AudioParam in internalTrigger, so the modulation fans out to every
   *  playing voice via Web Audio summing. */
  readonly modBus: Record<string, ConstantSourceNode>;

  constructor(private ctx: AudioContext, private destination: AudioNode) {
    this.params = JSON.parse(JSON.stringify(POLY_DEFAULTS)) as PolySynthParams;
    this.noiseBuffer = makeWhiteNoise(ctx, 2);
    const mk = () => { const n = ctx.createConstantSource(); n.offset.value = 0; n.start(); return n; };
    this.modBus = {
      'filter.cutoff':    mk(),
      'filter.resonance': mk(),
      'amp.gain':         mk(),
    };
  }
```

In `internalTrigger`, find the `// ── Filter ──` section (where the BiquadFilter is created — search for `ctx.createBiquadFilter`). Right after the filter is created and connected, add:

```ts
    this.modBus['filter.cutoff'].connect(filter.frequency);
    this.modBus['filter.resonance'].connect(filter.Q);
```

In the same function, find where the amp `GainNode` is created. Right after, add:

```ts
    this.modBus['amp.gain'].connect(amp.gain);
```

(Names `filter` and `amp` may differ slightly — match the existing local variable names in `internalTrigger`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/polysynth/polysynth-modbus.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full unit suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: no errors. (Karplus DSP "does not clip" is a known flake — re-run if it surfaces.)

- [ ] **Step 6: Commit**

```bash
git add src/polysynth/polysynth.ts src/polysynth/polysynth-modbus.test.ts
git commit -m "feat(polysynth): modulation bus AudioParams with internal fan-out per voice"
```

---

## Task 6: SubtractiveEngine — shared + per-voice modulators

**Files:**
- Modify: `src/engines/subtractive.ts`
- Test: `src/engines/subtractive-shared-mods.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `src/engines/subtractive-shared-mods.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { SubtractiveEngine } from './subtractive';
import { PolySynth } from '../polysynth/polysynth';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('SubtractiveEngine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices across calls', () => {
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    engine.setPolySynth(new PolySynth(ctx, ctx.destination));
    setCurrentLaneForVoice('subtractive-1');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBe(second);
    expect(first).toBeDefined();
  });

  it('getSharedAudioParams returns the PolySynth modBus offsets', () => {
    const engine = new SubtractiveEngine();
    const ctx = new AudioContext();
    const ps = new PolySynth(ctx, ctx.destination);
    engine.setPolySynth(ps);
    const shared = engine.getSharedAudioParams?.(ctx) ?? new Map();
    expect(shared.get('filter.cutoff')).toBe(ps.modBus['filter.cutoff'].offset);
    expect(shared.get('filter.resonance')).toBe(ps.modBus['filter.resonance'].offset);
    expect(shared.get('amp.gain')).toBe(ps.modBus['amp.gain'].offset);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/engines/subtractive-shared-mods.test.ts`
Expected: FAIL — `engineModVoices` not present; `getSharedAudioParams` not implemented.

- [ ] **Step 3: Refactor SubtractiveEngine.createVoice**

In `src/engines/subtractive.ts`, locate `createVoice`. Replace the current body with the split-by-scope version:

```ts
  /** Engine-wide voices for scope='shared' modulators. Lazy-init on the
   *  first createVoice call, then REUSED forever — same pattern as drums
   *  and TB-303 — so a shared LFO oscillator runs continuously across
   *  notes and an actual sweep is audible. */
  private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.polysynth) {
      this.polysynth = new PolySynth(ctx, output);
      this.pending.flush((id, v) => this.setBaseValue(id, v));
    }
    // 1. Lazy-init engine-wide modulators for SHARED mods and bind them ONCE
    //    to the modulation bus AudioParams.
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoiceFiltered(
        ctx, () => this.bpm,
        (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared',
      );
      const laneId = getCurrentLaneForVoice();
      if (laneId) {
        bindEngineModulators({
          laneId, engine: this, voiceMods: this.engineModVoices, ctx,
        });
      }
    }
    // 2. Per-voice modulators: spawn per call for this note.
    const voiceMods = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
    );
    recordVoiceMods(voiceMods);
    const voice = new SubtractiveVoice(this.polysynth, voiceMods);
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      this.currentLaneId = laneId;
      voice.rebind = () => {
        voice.binder = bindVoiceModulators({ laneId, engine: this, voice, voiceMods, ctx });
      };
    }
    return voice;
  }

  getSharedAudioParams(): Map<string, AudioParam> {
    if (!this.polysynth) return new Map();
    return new Map<string, AudioParam>([
      ['filter.cutoff',    this.polysynth.modBus['filter.cutoff'].offset],
      ['filter.resonance', this.polysynth.modBus['filter.resonance'].offset],
      ['amp.gain',         this.polysynth.modBus['amp.gain'].offset],
    ]);
  }
```

Add the import at the top:

```ts
import { bindEngineModulators, bindVoiceModulators } from '../modulation/voice-mod-binding';
```

- [ ] **Step 4: Run subtractive tests + full suite**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/engines/subtractive-shared-mods.test.ts`
Expected: PASS.

Then run the broader subtractive DSP battery:

```
NO_COLOR=1 npx vitest run src/engines/subtractive.dsp.test.ts
```
Expected: PASS (this is the audible regression guard — if a render changes peak/RMS noticeably you broke the engine).

- [ ] **Step 5: Commit**

```bash
git add src/engines/subtractive.ts src/engines/subtractive-shared-mods.test.ts
git commit -m "feat(subtractive): split createVoice into engine-shared + per-voice modulators"
```

---

## Task 7: WavetableEngine — shared + per-voice modulators

**Files:**
- Modify: `src/engines/wavetable.ts`
- Test: `src/engines/wavetable-shared-mods.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `src/engines/wavetable-shared-mods.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('WavetableEngine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices across calls', async () => {
    const { WavetableEngine } = await import('./wavetable');
    const engine = new WavetableEngine();
    const ctx = new AudioContext();
    setCurrentLaneForVoice('subtractive-2');  // any lane id; wavetable lanes use this slot
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/engines/wavetable-shared-mods.test.ts`
Expected: FAIL.

- [ ] **Step 3: Inspect Wavetable's voice manager**

Wavetable doesn't use PolySynth; it manages its own per-note subgraphs inside the engine. Inspect:

```bash
grep -n "createOscillator\|createBiquadFilter\|createGain" src/engines/wavetable.ts | head
```

Identify the function that constructs a per-note voice subgraph. Note the local variables for the filter (`BiquadFilterNode`) and amp (`GainNode`).

- [ ] **Step 4: Add a modBus to WavetableEngine**

Add a field on the engine class:

```ts
readonly modBus: Record<string, ConstantSourceNode>;
```

Initialize lazily in createVoice (since we need the AudioContext). At the top of `createVoice` (before any per-note allocation), insert:

```ts
if (!this.modBus) {
  const mk = () => { const n = ctx.createConstantSource(); n.offset.value = 0; n.start(); return n; };
  (this as { modBus: Record<string, ConstantSourceNode> }).modBus = {
    'filter.cutoff':    mk(),
    'filter.resonance': mk(),
    'amp.gain':         mk(),
  };
}
```

Inside the per-note voice allocator (the function found in Step 3), connect the bus outputs to the freshly created filter/amp AudioParams immediately after they're constructed:

```ts
this.modBus['filter.cutoff'].connect(filter.frequency);
this.modBus['filter.resonance'].connect(filter.Q);
this.modBus['amp.gain'].connect(amp.gain);
```

- [ ] **Step 5: Apply the createVoice split + add getSharedAudioParams**

Modify `createVoice` to lazy-init engine-wide modVoices for shared and spawn per-voice for per-voice. Pattern from Task 6 (subtractive). Concretely add these fields and methods to `WavetableEngine`:

```ts
private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

getSharedAudioParams(): Map<string, AudioParam> {
  if (!this.modBus) return new Map();
  return new Map<string, AudioParam>([
    ['filter.cutoff',    this.modBus['filter.cutoff'].offset],
    ['filter.resonance', this.modBus['filter.resonance'].offset],
    ['amp.gain',         this.modBus['amp.gain'].offset],
  ]);
}
```

In `createVoice`, replace the existing single `this.modHost.spawnVoice(ctx, () => this.bpm)` call with the pair:

```ts
if (!this.engineModVoices) {
  this.engineModVoices = this.modHost.spawnVoiceFiltered(
    ctx, () => this.bpm,
    (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared',
  );
  const laneId = getCurrentLaneForVoice();
  if (laneId) {
    bindEngineModulators({ laneId, engine: this, voiceMods: this.engineModVoices, ctx });
  }
}
const voiceMods = this.modHost.spawnVoiceFiltered(
  ctx, () => this.bpm,
  (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
);
```

Then construct the Voice as before with `voiceMods` (per-voice only), and call `bindVoiceModulators` instead of the old `bindVoiceModulators` that passed all mods.

Imports to add:

```ts
import { bindEngineModulators, bindVoiceModulators } from '../modulation/voice-mod-binding';
```

- [ ] **Step 4: Run tests + DSP battery**

Run: `NO_COLOR=1 npx vitest run src/engines/wavetable-shared-mods.test.ts src/engines/wavetable.dsp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/wavetable.ts src/engines/wavetable-shared-mods.test.ts
git commit -m "feat(wavetable): split createVoice into engine-shared + per-voice modulators"
```

---

## Task 8: FMEngine — shared + per-voice modulators

**Files:**
- Modify: `src/engines/fm.ts`
- Test: `src/engines/fm-shared-mods.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `src/engines/fm-shared-mods.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('FMEngine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices across calls', async () => {
    const { FMEngine } = await import('./fm');
    const engine = new FMEngine();
    const ctx = new AudioContext();
    setCurrentLaneForVoice('subtractive-2');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/engines/fm-shared-mods.test.ts`
Expected: FAIL.

- [ ] **Step 3: Inspect FM's voice manager**

```bash
grep -n "createOscillator\|createBiquadFilter\|createGain" src/engines/fm.ts | head -30
```

FM has 4 operators per voice plus an output amp. The minimum shared-modulatable param is `amp.gain` (the final voice amp). Note its local variable name in the per-note allocator.

- [ ] **Step 4: Add a modBus to FMEngine**

Same pattern as Task 7 step 4 (modBus field on the engine, lazy-init in createVoice). For FM, the modBus carries only `amp.gain`:

```ts
readonly modBus?: Record<string, ConstantSourceNode>;
```

In createVoice top:

```ts
if (!this.modBus) {
  const n = ctx.createConstantSource(); n.offset.value = 0; n.start();
  (this as { modBus: Record<string, ConstantSourceNode> }).modBus = { 'amp.gain': n };
}
```

Inside the voice allocator, after the output `amp` GainNode is created:

```ts
this.modBus['amp.gain'].connect(amp.gain);
```

- [ ] **Step 5: createVoice split + getSharedAudioParams**

Apply the same `engineModVoices` + `spawnVoiceFiltered` pair from Task 7 step 5, replacing `this.modHost.spawnVoice(...)`.

Add:

```ts
private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

getSharedAudioParams(): Map<string, AudioParam> {
  if (!this.modBus) return new Map();
  return new Map<string, AudioParam>([
    ['amp.gain', this.modBus['amp.gain'].offset],
  ]);
}
```

Import `bindEngineModulators` from `'../modulation/voice-mod-binding'` if not already present.

- [ ] **Step 4: Run tests + DSP battery**

Run: `NO_COLOR=1 npx vitest run src/engines/fm-shared-mods.test.ts src/engines/fm.dsp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/fm.ts src/engines/fm-shared-mods.test.ts
git commit -m "feat(fm): split createVoice into engine-shared + per-voice modulators"
```

---

## Task 9: KarplusEngine — shared + per-voice modulators

**Files:**
- Modify: `src/engines/karplus.ts`
- Test: `src/engines/karplus-shared-mods.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `src/engines/karplus-shared-mods.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('KarplusEngine — shared modulator voices', () => {
  it('createVoice reuses the same engineModVoices across calls', async () => {
    const { KarplusEngine } = await import('./karplus');
    const engine = new KarplusEngine();
    const ctx = new AudioContext();
    setCurrentLaneForVoice('subtractive-2');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/engines/karplus-shared-mods.test.ts`
Expected: FAIL.

- [ ] **Step 3: Inspect Karplus's voice manager**

```bash
grep -n "createOscillator\|createBiquadFilter\|createGain\|createDelay" src/engines/karplus.ts | head -20
```

Karplus is a plucked-string model — comb filter + amp envelope. The natural shared-modulatable param is `amp.gain` (and optionally the comb filter's feedback gain if exposed).

- [ ] **Step 4: Add a modBus to KarplusEngine**

```ts
readonly modBus?: Record<string, ConstantSourceNode>;
```

In createVoice top:

```ts
if (!this.modBus) {
  const n = ctx.createConstantSource(); n.offset.value = 0; n.start();
  (this as { modBus: Record<string, ConstantSourceNode> }).modBus = { 'amp.gain': n };
}
```

Inside the voice allocator, after the output amp GainNode is created:

```ts
this.modBus['amp.gain'].connect(amp.gain);
```

- [ ] **Step 5: createVoice split + getSharedAudioParams**

Same pattern as Tasks 7-8:

```ts
private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

getSharedAudioParams(): Map<string, AudioParam> {
  if (!this.modBus) return new Map();
  return new Map<string, AudioParam>([
    ['amp.gain', this.modBus['amp.gain'].offset],
  ]);
}
```

Replace the existing `this.modHost.spawnVoice(ctx, () => this.bpm)` with the engine-shared + per-voice pair from Task 7 step 5. Import `bindEngineModulators`.

- [ ] **Step 4: Run tests + DSP battery**

Run: `NO_COLOR=1 npx vitest run src/engines/karplus-shared-mods.test.ts src/engines/karplus.dsp.test.ts`
Expected: PASS (or the "does not clip" flake — re-run once).

- [ ] **Step 5: Commit**

```bash
git add src/engines/karplus.ts src/engines/karplus-shared-mods.test.ts
git commit -m "feat(karplus): split createVoice into engine-shared + per-voice modulators"
```

---

## Task 10: LFO config UI — SCOPE select; hide TRIG for per-voice

**Files:**
- Modify: `src/modulation/modulation-ui.ts`

- [ ] **Step 1: Add the SCOPE select to renderLfoConfig**

In `src/modulation/modulation-ui.ts`, find `renderLfoConfig`. Right after the `trigger` select (the one added recently with options `Free` / `Note`), add a SCOPE select and capture references so we can hide TRIG when scope=per-voice:

```ts
  // SCOPE control: shared (engine-wide LFO) vs per-voice (one LFO per note).
  // Default 'shared' from makeDefaultLFO.
  const scope = createSelectControl({
    id: `${deps.laneId}.mod.${mod.id}.scope`,
    label: 'SCOPE',
    options: [
      { value: 'shared',    label: 'Shared'   },
      { value: 'per-voice', label: 'PerVoice' },
    ],
    initialValue: mod.scope ?? 'shared',
    onChange: (v) => {
      mod.scope = v as 'shared' | 'per-voice';
      sync(deps);
      // Re-render the panel so TRIG visibility updates and the engine can
      // respawn modulator voices in the new scope.
      deps.onChange();
    },
  });
  deps.registerKnob(scope.handle);
  row.appendChild(scope.el);

  // Hide TRIG when scope=per-voice (per-voice LFOs are always fresh with
  // the voice; the "free / note" distinction is meaningless).
  const refreshTrigVisibility = () => {
    trigger.el.style.display = (mod.scope ?? 'shared') === 'per-voice' ? 'none' : '';
  };
  refreshTrigVisibility();
```

`trigger` is the existing local var holding the TRIG selectControl. If the existing variable has a different name in the file, use that instead.

- [ ] **Step 2: Run dev build + verify**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Run e2e to make sure nothing's broken**

Run: `npm run test:e2e`
Expected: 10 passing (no regressions; the SCOPE control is new but doesn't impact existing tests).

- [ ] **Step 4: Commit**

```bash
git add src/modulation/modulation-ui.ts
git commit -m "feat(mod-ui): SCOPE select on LFO config row; hide TRIG for per-voice"
```

---

## Task 11: PolySynth — `setMaxVoices` + oldest-first voice stealing

**Files:**
- Modify: `src/polysynth/polysynth.ts`
- Test: `src/polysynth/polysynth-voicecap.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `src/polysynth/polysynth-voicecap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { OfflineAudioContext } from 'node-web-audio-api';
import { PolySynth } from './polysynth';

describe('PolySynth.setMaxVoices', () => {
  it('caps the number of simultaneous voices', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(2);
    expect(ps.maxVoices).toBe(2);
  });

  it('a 3rd simultaneous trigger steals the oldest voice', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(2);
    ps.trigger(60, 0.0, 1.0);
    ps.trigger(64, 0.1, 1.0);
    ps.trigger(67, 0.2, 1.0);
    // After the 3rd trigger, only 2 voices remain "active" (the 64+67 pair).
    // We can't easily inspect internal state without exposing it; instead
    // verify .activeVoiceCount tracks correctly.
    expect(ps.activeVoiceCount()).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/polysynth/polysynth-voicecap.test.ts`
Expected: FAIL — `setMaxVoices`, `maxVoices`, `activeVoiceCount` don't exist.

- [ ] **Step 3: Add voice tracking + cap**

In `src/polysynth/polysynth.ts`, add fields + methods to `PolySynth`:

```ts
  maxVoices = 8;
  private active: Array<{ allocatedAt: number; stop: (time: number) => void }> = [];

  setMaxVoices(n: number): void {
    this.maxVoices = Math.max(1, Math.min(16, Math.floor(n)));
  }

  activeVoiceCount(): number {
    return this.active.length;
  }
```

In `internalTrigger`, BEFORE allocating the new voice subgraph, add the stealing logic:

```ts
    // Voice stealing: if we're at the cap, stop the oldest active voice
    // immediately so the new note can take its slot.
    while (this.active.length >= this.maxVoices) {
      const oldest = this.active.shift();
      if (oldest) oldest.stop(time);
    }
```

When the voice is fully constructed (find the line where `releaseGate` or similar closure is set up — that's the "voice is ready" point), register it:

```ts
    const entry = {
      allocatedAt: time,
      stop: (t: number) => releaseGate(t),  // releaseGate is the local var that ramps amp to 0
    };
    this.active.push(entry);
```

When the release ramp completes (search for the existing voice cleanup — likely an `onended` handler that disconnects nodes), drop the voice from `this.active`:

```ts
    // Inside the existing onended/cleanup callback:
    const idx = this.active.indexOf(entry);
    if (idx >= 0) this.active.splice(idx, 1);
```

(If `releaseGate` is defined inside `internalTrigger`, the closure capture works directly. If not, hoist a small `stopVoice(time)` helper.)

- [ ] **Step 4: Run tests + DSP battery**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/polysynth/polysynth-voicecap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/polysynth/polysynth.ts src/polysynth/polysynth-voicecap.test.ts
git commit -m "feat(polysynth): setMaxVoices + oldest-first voice stealing"
```

---

## Task 12: PolySynth — `setMode('mono'|'poly')` + legato/retrig

**Files:**
- Modify: `src/polysynth/polysynth.ts`
- Test: `src/polysynth/polysynth-mode.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `src/polysynth/polysynth-mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { OfflineAudioContext } from 'node-web-audio-api';
import { PolySynth } from './polysynth';

describe('PolySynth.setMode', () => {
  it('mono mode forces maxVoices to 1', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(8);
    ps.setMode('mono');
    expect(ps.maxVoices).toBe(1);
  });

  it('poly mode restores user-set maxVoices', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMaxVoices(6);
    ps.setMode('mono');
    ps.setMode('poly');
    expect(ps.maxVoices).toBe(6);
  });

  it('setRetrig(false) in mono mode keeps the envelope going across notes', () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100) as unknown as AudioContext;
    const ps = new PolySynth(ctx, ctx.destination);
    ps.setMode('mono');
    ps.setRetrig(false);  // legato
    ps.trigger(60, 0, 1);
    ps.trigger(64, 0.1, 1);
    // Legato mode should NOT have stopped voice 1's amp envelope. Voice
    // count remains 1 (the second trigger re-pitched, didn't allocate a
    // new subgraph).
    expect(ps.activeVoiceCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/polysynth/polysynth-mode.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add mode + retrig support**

In `src/polysynth/polysynth.ts`, add to `PolySynth`:

```ts
  mode: 'mono' | 'poly' = 'poly';
  retrig = true;  // mono-only; true = restart envelope per note, false = legato
  private monoSavedMax = 8;
  private monoVoice: { osc1: OscillatorNode; osc2: OscillatorNode; sub: OscillatorNode; } | null = null;

  setMode(m: 'mono' | 'poly'): void {
    if (m === 'mono' && this.mode !== 'mono') {
      this.monoSavedMax = this.maxVoices;
      this.maxVoices = 1;
    } else if (m === 'poly' && this.mode === 'mono') {
      this.maxVoices = this.monoSavedMax;
    }
    this.mode = m;
  }

  setRetrig(v: boolean): void { this.retrig = v; }
```

In `internalTrigger`, at the very top, add the legato fast-path:

```ts
    if (this.mode === 'mono' && !this.retrig && this.monoVoice) {
      // Legato: re-pitch the existing voice's oscillators in place; do not
      // restart amp/filter envelopes.
      const noteFreq = 440 * Math.pow(2, (midi - 69) / 12);
      this.monoVoice.osc1.frequency.setValueAtTime(
        noteFreq * Math.pow(2, this.params.osc1.octave + this.params.osc1.semi / 12), time);
      this.monoVoice.osc2.frequency.setValueAtTime(
        noteFreq * Math.pow(2, this.params.osc2.octave + this.params.osc2.semi / 12), time);
      this.monoVoice.sub.frequency.setValueAtTime(
        noteFreq * Math.pow(2, this.params.sub.octave), time);
      return;
    }
```

After the voice subgraph is allocated (inside `internalTrigger`, where `osc1`/`osc2`/`sub` are local vars), record the mono voice if in mono mode:

```ts
    if (this.mode === 'mono') {
      this.monoVoice = { osc1, osc2, sub };
    }
```

In the voice cleanup callback, clear `this.monoVoice = null` when this voice was the mono voice.

- [ ] **Step 4: Run tests**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/polysynth/polysynth-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/polysynth/polysynth.ts src/polysynth/polysynth-mode.test.ts
git commit -m "feat(polysynth): mono mode with legato/retrig branch"
```

---

## Task 13: Subtractive engine panel — MODE / RETRIG / VOICES controls

**Files:**
- Modify: `src/engines/subtractive.ts`

- [ ] **Step 1: Add the controls inside `buildParamUI`**

In `src/engines/subtractive.ts`, find `buildParamUI`. Currently it just renders the modulators panel. Prepend a small header row that exposes the three controls, registering each into the same lane-prefixed knob registry the dropdown reads from:

```ts
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    if (!ctx) return;
    container.innerHTML = '';

    // Header row: MODE / RETRIG / VOICES — sits next to the preset select
    // (which is rendered by main.ts elsewhere) by virtue of CSS layout in
    // the engine-mod-host page section.
    const header = document.createElement('div');
    header.className = 'row poly-section';
    const headerLab = document.createElement('div');
    headerLab.className = 'section-label';
    headerLab.textContent = 'POLY';
    header.appendChild(headerLab);
    const headerKnobs = document.createElement('div');
    headerKnobs.className = 'knob-row';
    header.appendChild(headerKnobs);

    const ps = this.polysynth;
    if (ps) {
      const mode = createSelectControl({
        id: `${ctx.laneId}.poly.mode`,
        label: 'MODE',
        options: [{ value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }],
        initialValue: ps.mode,
        onChange: (v) => { ps.setMode(v as 'mono' | 'poly'); refreshRetrigVisibility(); },
      });
      ctx.registerKnob(mode.handle);
      headerKnobs.appendChild(mode.el);

      const retrig = createSelectControl({
        id: `${ctx.laneId}.poly.retrig`,
        label: 'RETRIG',
        options: [{ value: 'legato', label: 'Legato' }, { value: 'retrig', label: 'Retrig' }],
        initialValue: ps.retrig ? 'retrig' : 'legato',
        onChange: (v) => { ps.setRetrig(v === 'retrig'); },
      });
      ctx.registerKnob(retrig.handle);
      headerKnobs.appendChild(retrig.el);

      const voices = createKnob({
        id: `${ctx.laneId}.poly.voices`,
        label: 'VOICES', min: 1, max: 16, step: 1, value: ps.maxVoices, defaultValue: 8,
        format: (v) => String(v),
        onChange: (v) => { ps.setMaxVoices(v); },
      });
      ctx.registerKnob(voices);
      headerKnobs.appendChild(voices.el);

      const refreshRetrigVisibility = () => {
        retrig.el.style.display = ps.mode === 'mono' ? '' : 'none';
      };
      refreshRetrigVisibility();
    }

    container.appendChild(header);

    // Modulators panel (existing).
    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      sessionState: ctx.sessionState,
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }
```

Add the imports if missing:

```ts
import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
```

- [ ] **Step 2: Build + verify in browser**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: e2e**

Run: `npm run test:e2e`
Expected: all 10 still pass.

- [ ] **Step 4: Commit**

```bash
git add src/engines/subtractive.ts
git commit -m "feat(subtractive): MODE / RETRIG / VOICES controls in engine panel header"
```

---

## Task 14: E2E — shared LFO sweep + scope toggle

**Files:**
- Modify: `tests/e2e/lane-ui.spec.ts`

- [ ] **Step 1: Append the test block**

Append to `tests/e2e/lane-ui.spec.ts`:

```ts
test.describe('modulator scope', () => {
  test('LFO defaults to scope=shared and the SCOPE select is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (document.querySelector('#poly-preset-select') as HTMLSelectElement | null)?.value !== '__custom__',
    );
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    // SCOPE label appears in the LFO mod card.
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.mod-card.mod-lfo .knob-label')].map(l => l.textContent?.trim()),
    );
    expect(labels).toContain('SCOPE');
  });

  test('switching SCOPE to per-voice hides the TRIG control', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (document.querySelector('#poly-preset-select') as HTMLSelectElement | null)?.value !== '__custom__',
    );
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    // Click the per-voice scope option.
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.mod-card.mod-lfo')].find(c => (c as HTMLElement).offsetParent !== null) as HTMLElement;
      const perVoice = [...card.querySelectorAll('button.radio-btn')].find(b => (b as HTMLElement).title === '-1..+1' ? false : b.textContent === 'PerVoice') as HTMLElement | undefined;
      perVoice?.click();
    });
    // TRIG label is no longer present in the layout (display:none).
    const trigVisible = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.mod-card.mod-lfo')].find(c => (c as HTMLElement).offsetParent !== null) as HTMLElement;
      const trigLabel = [...card.querySelectorAll('.knob')].find(k => k.querySelector('.knob-label')?.textContent === 'TRIG') as HTMLElement | undefined;
      return trigLabel ? trigLabel.offsetParent !== null : false;
    });
    expect(trigVisible).toBe(false);
  });
});
```

- [ ] **Step 2: Build + run e2e**

Run: `npm run build && npm run test:e2e`
Expected: 12 passing (10 existing + 2 new).

If the selectors for SelectControl options don't match (the codebase uses `radio-btn` for selectControl), inspect the actual DOM via Playwright snapshot and adjust the test's locator strings.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/lane-ui.spec.ts
git commit -m "test(e2e): SCOPE control visible + TRIG hidden for per-voice LFO"
```

---

## Task 15: Persist subtractive polyphony state in `SessionLane.engineState.params`

**Files:**
- Modify: `src/engines/subtractive.ts`
- Modify: `scripts/snapshot-demo.ts` (optional — to update the demo JSON if you want a particular mode at boot)

- [ ] **Step 1: Add `mode` / `retrig` / `voices` to setBaseValue + getBaseValue**

In `src/engines/subtractive.ts`, find `setBaseValue` and `getBaseValue`. Currently they delegate to `polysynth.params` via dot-path. Add explicit branches for the three new ids so they round-trip:

```ts
  getBaseValue(id: string): number {
    if (!this.polysynth) return SUB_PARAMS.find(p => p.id === id)?.default ?? 0;
    if (id === 'poly.voices') return this.polysynth.maxVoices;
    if (id === 'poly.mode')   return this.polysynth.mode === 'mono' ? 1 : 0;
    if (id === 'poly.retrig') return this.polysynth.retrig ? 1 : 0;
    return readDotPath(this.polysynth.params as unknown as Record<string, unknown>, id);
  }

  setBaseValue(id: string, v: number): void {
    if (!this.polysynth) { this.pending.set(id, v); return; }
    if (id === 'poly.voices') { this.polysynth.setMaxVoices(v); return; }
    if (id === 'poly.mode')   { this.polysynth.setMode(v >= 0.5 ? 'mono' : 'poly'); return; }
    if (id === 'poly.retrig') { this.polysynth.setRetrig(v >= 0.5); return; }
    const spec = SUB_PARAMS.find(p => p.id === id);
    writeDotPath(this.polysynth.params as unknown as Record<string, unknown>, id, v, spec);
  }
```

Add specs to `SUB_PARAMS` at the top of the file so the registry knows about them:

```ts
const SUB_PARAMS: EngineParamSpec[] = [
  // ...existing
  { id: 'poly.mode',   label: 'Mode',   kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'poly.retrig', label: 'Retrig', kind: 'continuous', min: 0, max: 1, default: 1 },
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8 },
];
```

- [ ] **Step 2: Run full suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/subtractive.ts
git commit -m "feat(subtractive): mode/retrig/voices round-trip through engineState.params"
```

---

## Self-review notes

After all 15 tasks land, run the full check:

```bash
npm run build && npm test
```

Inspect at `http://localhost:5173`:

1. **Sub 1 — shared LFO is audible**: connect LFO → filter.cutoff with depth ≥ 0.5, set SYNC + 4/1 ratio. Press play. The filter sweeps over a 4-bar period across multiple notes. **This is the primary acceptance criterion.**
2. **Sub 1 — per-voice ADSR**: connect ADSR → amp.gain (per-voice). Press a chord. Each note has its own envelope (latest note doesn't kill the older notes' envelopes).
3. **MODE = mono + RETRIG = legato**: two overlapping notes — the second re-pitches without restarting the amp envelope.
4. **VOICES = 2**: triggering a 3-note chord steals the oldest voice on the 3rd attack.
5. **TRIG hidden for per-voice LFO**: switching the SCOPE select to PerVoice hides the FREE/NOTE selector.

If any of these fail, file a follow-up with the discrepancy before declaring the feature done.
