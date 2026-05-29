# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. All work runs in a git worktree allocated in Phase 0. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify how synth engines, insert FX, and modulators are declared and registered. Single SPI (`PluginManifest` + kind-discriminated `PluginFactory`), explicit `bootstrapPlugins()` replacing side-effect imports, master + per-lane insert chains, modulators discovered via the registry. Phase 2 (runtime loading from URL/file) explicitly deferred.

**Architecture:** New `src/plugins/` module owns the SPI. Existing engines migrate via a temporary adapter so the cutover is incremental — one engine per commit. Master `FilterChain` in [src/app/audio-graph.ts](src/app/audio-graph.ts) is replaced by a generic `InsertChain` containing a `multifilter` plugin. After the boot-allocation collapse, `audio-graph.ts` returns ONLY the master signal chain (`master → masterInsertChain → masterComp → analyser → destination`) plus `FxBus` and `SidechainBus` — no boot strips, no boot instrument instances. `src/app/lane-allocator.ts`'s `ensureLaneResource(laneId, engineId)` becomes the SOLE allocation path for every lane, including the three legacy defaults (`tb-303-1`, `drums-1`, `subtractive-1`), driven by `sessionHost.applyLoadedSessionState(state)` reading the default boot session JSON. `LaneResources` in [src/core/lane-resources.ts](src/core/lane-resources.ts) gains an `inserts: InsertChain` field — uniform for all lanes, no boot-lane special case. Persistence: `SessionLane.inserts` and `SessionState.masterInserts` added as optional fields (default `[]` for old v3 saves — no schema bump).

**Tech Stack:** TypeScript strict, Web Audio API, Vite, Vitest (node env — pure tests only). All work happens inside a git worktree branched from `main`; final merge after rebase.

**Spec:** [docs/superpowers/specs/2026-05-27-plugin-system-design.md](../specs/2026-05-27-plugin-system-design.md)

**Replaces:** [docs/superpowers/plans/2026-05-27-plugin-system.md](2026-05-27-plugin-system.md) (stale — codebase moved through Lane Resource Unification, MIDI/preset JSON, sidechain/comp, main.ts→src/app/ refactors).

---

## Constraints from current architecture

These shape what's different from the original spec wording:

1. **Engine modulators are a per-engine property** (`SynthEngine.modulators: ModulationHost`). The plugin SPI doesn't wrap them — the engine keeps owning its host. Modulator plugins (LFO/ADSR) describe a *kind* the host can spawn, not a wholesale replacement.
2. **Shared vs per-voice modulator scope** (`ModulatorScope = 'shared' | 'per-voice'`). The synth-plugin contract must preserve `Voice.getAudioParamRange?` and engine `getSharedAudioParams?()` so existing binder paths keep working.
3. **Presets are JSON in `/public/presets/{engineId}.json`**, loaded async by [preset-loader.ts](src/presets/preset-loader.ts). `PluginManifest.presets` stays `[]` for synth plugins (loader is the source of truth); the plugin SPI doesn't take ownership of the preset cache.
4. **Bootstrap lives in `src/app/`, not `src/main.ts`.** The natural place is a new `src/app/plugin-bootstrap.ts` called from `src/main.ts` before `createAudioGraph()`.
5. **Master signal chain:** today `master → FilterChain → MasterCompressor → analyser → destination`. Master inserts replace `FilterChain` at the same position: `master → MasterInsertChain → MasterCompressor → analyser → destination`. `MasterCompressor` and the analyser are not plugins in phase 1.
6. **ChannelStrip internals (EQ, comp, sidechain, ducker) are NOT touched.** They stay inside the strip; the insert chain attaches upstream of `strip.input`. So a lane signal becomes: `voice.output → LaneInsertChain → strip.input → (strip internals) → master`.
7. **Boot-allocation collapse (Phase G).** Prior to this plan, [src/app/audio-graph.ts:44-68](src/app/audio-graph.ts#L44-L68) eagerly built three `ChannelStrip`s (`bassStrip`, `polyStrip`, `drumBusStrip`) and three instrument instances (`TB303`, `DrumMachine`, `PolySynth`), then called `configureTB303EngineMainInstance`, `configureDrumsEngineSharedFx`, and `setPolySynth` on the singleton engines. `lane-allocator.ts:47-52` then stuffed those three into `LaneResourceMap` keyed by `LANE_ID_BASS`/`LANE_ID_DRUMS`/`LANE_ID_POLY`, with special-case fallbacks at lines 79–81. Phase G collapses this: `audio-graph.ts` returns only the master signal chain (`ctx`, `master`, `analyser`, `masterInsertChain`, `masterComp`, `fx`, `sidechainBus`); `ensureLaneResource(laneId, engineId)` is the only path for ALL lanes (including the three defaults); the default boot session JSON drives initial allocation via `sessionHost.applyLoadedSessionState(state)`. Legacy configurators (`configureTB303EngineMainInstance`, `configureDrumsEngineSharedFx`) are deleted. The boot-lane carve-out in `ensureLaneStrip` disappears.
8. **Phase H per-lane InsertChain has NO boot-lane special case.** Because Phase G already unified allocation, every lane gets an `InsertChain` between `voice.output` and `strip.input` — uniformly. The previous draft's "Inserts available on lanes added via +" limitation is gone.
9. **`SaveManager`'s `SavedStateV3.sessionState` carries the new fields** as optional adds. No schemaVersion bump.

---

## File map

| File | Status | Purpose |
|---|---|---|
| `src/plugins/types.ts` | create | `PluginKind`, `PluginManifest`, `PluginPreset`, `PluginFactory`, `SynthInstance`, `FxInstance`, `ModulatorInstance` |
| `src/plugins/registry.ts` | create | `registerPlugin`, `getPlugin`, `listPlugins`, typed `createInstance` overloads, `_resetRegistry` test hook |
| `src/plugins/registry.test.ts` | create | Registry behavior tests |
| `src/plugins/synth-engine-adapter.ts` | create | `synthEngineAsPlugin(engine, factory)` — transitional bridge |
| `src/plugins/synth-engine-adapter.test.ts` | create | Adapter tests |
| `src/app/plugin-bootstrap.ts` | create | `bootstrapPlugins(extras?)` registering built-in plugins; called from `src/main.ts` before `createAudioGraph` |
| `src/plugins/fx/insert-chain.ts` | create | Generic `InsertChain` class (ordered FX, bypass, reorder, dispose) |
| `src/plugins/fx/insert-chain.test.ts` | create | Wiring/bypass/reorder tests with mock nodes |
| `src/plugins/fx/multifilter.ts` | create | `multifilterPlugin` — single Biquad with type/freq/Q params |
| `src/plugins/fx/distortion.ts` | create | `distortionPlugin` — WaveShaper-based |
| `src/plugins/fx/reverb.ts` | create | `reverbPlugin` — convolver-based (matches existing `FxBus` reverb DSP) |
| `src/plugins/fx/delay.ts` | create | `delayPlugin` — delay + LP feedback (matches existing `FxBus` delay DSP) |
| `src/plugins/modulators/lfo.ts` | create | `lfoPlugin` — wraps `LFOVoice` as a `ModulatorInstance` |
| `src/plugins/modulators/adsr.ts` | create | `adsrPlugin` — wraps `ADSRVoice` as a `ModulatorInstance` |
| `src/session/insert-slot.ts` | create | `InsertSlot` type + `applyInsertSlot` / `snapshotInsertSlot` helpers |
| `src/session/insert-slot.test.ts` | create | Round-trip tests |
| `src/session/lane-insert-ui.ts` | create | DOM panel for an insert chain (used by both lane inspector and master FX) |
| `src/engines/tb303.ts` | modify | Add `export const tb303Plugin: PluginFactory`; keep `tb303Engine` singleton + `registerInstance` method (used by tests). DELETE `configureTB303EngineMainInstance` export in Phase G — dead after collapse. |
| `src/engines/subtractive.ts` | modify | Add `export const subtractivePlugin: PluginFactory` — must create fresh `SubtractiveEngine` since the singleton was dropped |
| `src/engines/fm.ts` | modify | Add `export const fmPlugin` |
| `src/engines/wavetable.ts` | modify | Add `export const wavetablePlugin` |
| `src/engines/karplus.ts` | modify | Add `export const karplusPlugin` |
| `src/engines/drums-engine.ts` | modify | Add `export const drumsPlugin`. DELETE `configureDrumsEngineSharedFx` export in Phase G; `setSharedFx` is called per-instance inside `ensureLaneResource`. |
| `src/main.ts` | modify | Remove the six bare `import './engines/xxx'` side-effect lines; call `bootstrapPlugins()` once before `createAudioGraph()`. Phase G: drop destructuring of `bassStrip`/`polyStrip`/`drumBusStrip`/`synth`/`drums`/`polysynth`/`mainSubtractive`/`drumsEngineInstance` from the `createAudioGraph` return; pass only `ctx`/`master`/`fx`/`sidechainBus`/`getBpm`/`extraIds` to `createLaneAllocator`. |
| `src/app/audio-graph.ts` | modify | Replace `FilterChain` with `InsertChain` (Phase E). Phase G: strip down to MASTER-ONLY — return only `{ ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus }`. Delete all three `ChannelStrip` constructions, all three instrument instances, `configureTB303EngineMainInstance` + `configureDrumsEngineSharedFx` calls, `getEngine('subtractive')` / `setPolySynth` / `getEngine('drums-machine')` lookups, and the eight fields they returned. |
| `src/core/fx.ts` | modify | `FilterChain` becomes internal to the `multifilter` plugin (the existing class can remain dead-code or be deleted after Phase F is done) |
| `src/core/fx-ui.ts` | modify | Master FX UI section that drove `FilterChain` calls `buildLaneInsertUI` against `masterInsertChain` + `sessionState.masterInserts` |
| `src/core/lane-resources.ts` | modify | `LaneResources` gains `inserts: InsertChain`; map dispose path disposes inserts too |
| `src/app/lane-allocator.ts` | modify | Phase G: `ensureLaneResource` becomes the SOLE allocation path for every lane. Shrink `LaneAllocatorDeps` to `{ ctx, master, fx, sidechainBus, getBpm, extraIds }`. Delete the boot-lane prefill block (lines 47–52) and the three `ensureLaneStrip` special cases (lines 79–81). Move `setSharedFx(deps.fx)` per-instance into the `drums-machine` branch of `ensureLaneResource` to fix the latent extra-drum-lane bug. Phase H: `ensureLaneResource` also builds the lane `InsertChain` at allocation and splices it between `engine.createVoice` output and `strip.input` — UNIFORM for all lanes. |
| `src/demo/initial-pattern.ts` | modify | Phase G: drop `drums`/`bassStrip`/`polyStrip` from `InitialPatternDeps`. The FX-send defaults (`bassStrip.setReverbSend(0.1)` etc. at line 132) move into the demo session JSON (`/demos/new.json`) so `applyLoadedSessionState` reapplies them via the persisted lane bus state. |
| `public/demos/new.json` (or current `minimal-techno.json`) | modify | Phase G: add explicit `engineId` for each of the three default lanes (`tb-303-1`/`tb303`, `drums-1`/`drums-machine`, `subtractive-1`/`subtractive`) plus any `bus.reverbSend`/`bus.delaySend` defaults previously hard-coded in `setupInitialPattern`. |
| `src/session/session.ts` | modify | `SessionLane.inserts?: InsertSlot[]`; `SessionState.masterInserts?: InsertSlot[]` |
| `src/session/session-host.ts` | modify | Surface lane `InsertChain`s to UI callers; on lane add, seed `lane.inserts = []`; on lane delete, the LaneResourceMap dispose handles the chain |
| `src/session/session-inspector.ts` | modify | Mount `lane-insert-ui` panel for the active lane |
| `src/save/saved-state-v3.ts` | modify | Round-trip masterInserts (no schema bump — additive optional fields) |
| `src/modulation/modulation-host.ts` | modify | `spawnVoice` / `spawnVoiceFiltered` consult `listPlugins('modulator')` when present, falling back to direct `LFOVoice`/`ADSRVoice` for backward compat during migration |
| `src/modulation/modulation-ui.ts` | modify | Source dropdown reads `listPlugins('modulator')`; destination dropdown adds lane FX and master FX param groups |
| `src/modulation/types.ts` | modify | `ModulatorKind` widened to `string` |
| `src/engines/registry.ts` | unchanged | Stays in place — engines still need to be discoverable by `id` for `getEngine` callers in `audio-graph.ts` / `lane-allocator.ts`. Retirement is Phase 2 work, not in scope here. |

---

## Phase 0 — Worktree setup

The whole plan runs inside an isolated worktree. Use the `superpowers:using-git-worktrees` skill to allocate it.

- [ ] **Step 1: Invoke the worktree skill**

Invoke `superpowers:using-git-worktrees` with:
- Branch name: `feat/plugin-system`
- Base: `main`

The skill creates a worktree (either via native tools or `git worktree add`). Confirm the working directory after the skill returns — every subsequent task runs inside the worktree path.

- [ ] **Step 2: Verify clean baseline**

Inside the worktree:

```bash
git status                  # expect clean working tree
npx vitest run              # baseline green
npx tsc --noEmit            # baseline green
npm run build               # baseline green
```

Stop and report if any baseline command fails — the plan assumes a green starting point.

- [ ] **Step 3: Commit a marker**

No file changes — skip if the worktree skill already produced a checkpoint commit.

---

## Phase A — Plugin SPI scaffolding

### Task 1: Types module

**Files:** create `src/plugins/types.ts`.

- [ ] **Step 1: Write the type definitions**

```ts
// src/plugins/types.ts
import type { EngineParamSpec } from '../engines/engine-params';
import type { VoiceTriggerOptions } from '../engines/engine-types';
import type { ModulatorState } from '../modulation/types';

export type PluginKind = 'synth' | 'fx' | 'modulator';

/** Alias the unified param spec under a kind-neutral name. EngineParamSpec
 *  stays the canonical type. */
export type ParamSpec = EngineParamSpec;

export interface PluginPreset {
  name: string;
  gm?: number[];
  params: Record<string, number>;
  modulators?: ModulatorState[];
}

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly kind: PluginKind;
  readonly version: string;
  readonly params: ParamSpec[];
  /** Static presets bundled with the plugin. May be empty when an external
   *  loader (e.g. `preset-loader.ts`) owns presets for this id. */
  readonly presets: PluginPreset[];
}

export interface SynthInstance {
  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  getAudioParams(): Map<string, AudioParam>;
  getAudioParamRange?(shortId: string): { min: number; max: number } | undefined;
  getSharedAudioParams?(ctx?: AudioContext): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  dispose(): void;
}

export interface FxInstance {
  readonly input: AudioNode;
  readonly output: AudioNode;
  getAudioParams(): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  dispose(): void;
}

export interface ModulatorInstance {
  readonly output: AudioNode;
  getAudioParams(): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  trigger?(time: number, opts: { gateDuration: number; accent?: boolean }): void;
  release?(time: number): void;
  dispose(): void;
}

export type PluginFactory =
  | { kind: 'synth';     manifest: PluginManifest;
      create(ctx: AudioContext, output: AudioNode): SynthInstance }
  | { kind: 'fx';        manifest: PluginManifest;
      create(ctx: AudioContext): FxInstance }
  | { kind: 'modulator'; manifest: PluginManifest;
      create(ctx: AudioContext, bpm: number): ModulatorInstance };
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/types.ts
git commit -m "feat(plugins): plugin SPI type definitions"
```

---

### Task 2: Registry

**Files:** create `src/plugins/registry.ts`, `src/plugins/registry.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/plugins/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPlugin, getPlugin, listPlugins, createInstance, _resetRegistry,
} from './registry';
import type { PluginFactory } from './types';

function synth(id: string): PluginFactory {
  return {
    kind: 'synth',
    manifest: { id, name: id, kind: 'synth', version: '1.0.0', params: [], presets: [] },
    create: () => ({
      trigger: () => {}, release: () => {}, connect: () => {},
      getAudioParams: () => new Map(), getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {}, dispose: () => {},
    }),
  };
}

function fx(id: string): PluginFactory {
  return {
    kind: 'fx',
    manifest: { id, name: id, kind: 'fx', version: '1.0.0', params: [], presets: [] },
    create: () => ({
      input: {} as any, output: {} as any,
      getAudioParams: () => new Map(), getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {}, dispose: () => {},
    }),
  };
}

describe('plugin registry', () => {
  beforeEach(() => _resetRegistry());

  it('register + getPlugin by (kind,id)', () => {
    const p = synth('tb303');
    registerPlugin(p);
    expect(getPlugin('synth', 'tb303')).toBe(p);
    expect(getPlugin('fx', 'tb303')).toBeUndefined();
  });

  it('listPlugins filters by kind', () => {
    registerPlugin(synth('a'));
    registerPlugin(synth('b'));
    registerPlugin(fx('reverb'));
    expect(listPlugins('synth').map((p) => p.manifest.id).sort()).toEqual(['a', 'b']);
    expect(listPlugins('fx').map((p) => p.manifest.id)).toEqual(['reverb']);
    expect(listPlugins().length).toBe(3);
  });

  it('createInstance dispatches by kind', () => {
    registerPlugin(synth('tb303'));
    const inst = createInstance('synth', 'tb303', {} as AudioContext, {} as AudioNode);
    expect(inst).toBeDefined();
    expect(typeof inst!.trigger).toBe('function');
  });

  it('createInstance returns undefined for unknown id', () => {
    expect(createInstance('synth', 'nope', {} as any, {} as any)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL (module missing)**

```bash
npx vitest run src/plugins/registry.test.ts
```

- [ ] **Step 3: Implement the registry**

```ts
// src/plugins/registry.ts
import type {
  PluginFactory, PluginKind, SynthInstance, FxInstance, ModulatorInstance,
} from './types';

const plugins = new Map<string, PluginFactory>();
const key = (kind: PluginKind, id: string) => `${kind}:${id}`;

export function registerPlugin(factory: PluginFactory): void {
  const k = key(factory.kind, factory.manifest.id);
  if (plugins.has(k)) console.warn(`Plugin "${k}" already registered, overwriting.`);
  plugins.set(k, factory);
}

export function getPlugin(kind: PluginKind, id: string): PluginFactory | undefined {
  return plugins.get(key(kind, id));
}

export function listPlugins(kind?: PluginKind): PluginFactory[] {
  const all = Array.from(plugins.values());
  return kind ? all.filter((p) => p.kind === kind) : all;
}

export function createInstance(kind: 'synth',     id: string, ctx: AudioContext, output: AudioNode): SynthInstance | undefined;
export function createInstance(kind: 'fx',        id: string, ctx: AudioContext): FxInstance | undefined;
export function createInstance(kind: 'modulator', id: string, ctx: AudioContext, bpm: number): ModulatorInstance | undefined;
export function createInstance(kind: PluginKind, id: string, ctx: AudioContext, arg?: unknown): unknown {
  const p = plugins.get(key(kind, id));
  if (!p) return undefined;
  if (p.kind === 'synth')     return p.create(ctx, arg as AudioNode);
  if (p.kind === 'fx')        return p.create(ctx);
  if (p.kind === 'modulator') return p.create(ctx, arg as number);
  return undefined;
}

/** Test-only escape hatch. Do not use in app code. */
export function _resetRegistry(): void { plugins.clear(); }
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
npx vitest run src/plugins/registry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/registry.ts src/plugins/registry.test.ts
git commit -m "feat(plugins): kind-discriminated registry with typed createInstance"
```

---

### Task 3: Synth engine adapter

**Files:** create `src/plugins/synth-engine-adapter.ts`, `src/plugins/synth-engine-adapter.test.ts`.

The adapter wraps an existing `SynthEngine` instance + optional factory as a `synth` plugin so the bootstrap can register engines before any engine code is rewritten. Tasks 7–12 replace each adapter call with a native plugin export and the adapter is deleted in Task 13.

- [ ] **Step 1: Write the failing test**

```ts
// src/plugins/synth-engine-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { synthEngineAsPlugin } from './synth-engine-adapter';
import type { SynthEngine, Voice } from '../engines/engine-types';

const mockVoice: Voice = {
  trigger: () => {}, release: () => {}, connect: () => {},
  dispose: () => {}, getAudioParams: () => new Map(),
};

const mockEngine: SynthEngine = {
  id: 'mock', name: 'Mock', type: 'polyhost', polyphony: 'mono', editor: 'piano-roll',
  params: [], presets: [], modulators: {} as any,
  getBaseValue: () => 0, setBaseValue: () => {},
  createVoice: () => mockVoice,
  buildSequencer: () => ({} as any),
  buildParamUI: () => {}, applyPreset: () => {}, dispose: () => {},
};

describe('synthEngineAsPlugin', () => {
  it('produces a synth-kind factory mirroring the engine manifest', () => {
    const f = synthEngineAsPlugin(mockEngine);
    expect(f.kind).toBe('synth');
    expect(f.manifest.id).toBe('mock');
    expect(f.manifest.kind).toBe('synth');
    expect(f.manifest.version).toBe('0.0.0-legacy');
  });

  it('create() returns an instance with synth-instance methods', () => {
    const f = synthEngineAsPlugin(mockEngine);
    if (f.kind !== 'synth') throw new Error('wrong kind');
    const inst = f.create({} as AudioContext, {} as AudioNode);
    expect(typeof inst.trigger).toBe('function');
    expect(typeof inst.setBaseValue).toBe('function');
    expect(typeof inst.applyPreset).toBe('function');
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx vitest run src/plugins/synth-engine-adapter.test.ts
```

- [ ] **Step 3: Implement the adapter**

```ts
// src/plugins/synth-engine-adapter.ts
import type { SynthEngine } from '../engines/engine-types';
import type { PluginFactory, SynthInstance } from './types';

export function synthEngineAsPlugin(engine: SynthEngine): PluginFactory {
  return {
    kind: 'synth',
    manifest: {
      id: engine.id,
      name: engine.name,
      kind: 'synth',
      version: '0.0.0-legacy',
      params: engine.params,
      presets: [],
    },
    create(ctx: AudioContext, output: AudioNode): SynthInstance {
      const voice = engine.createVoice(ctx, output);
      return {
        trigger:                (m, t, o) => voice.trigger(m, t, o),
        release:                (t)       => voice.release(t),
        connect:                (d)       => voice.connect(d),
        getAudioParams:         ()        => voice.getAudioParams(),
        getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
        getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
        getBaseValue:           (id)      => engine.getBaseValue(id),
        setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
        applyPreset:            (name)    => engine.applyPreset(name),
        dispose:                ()        => voice.dispose(),
      };
    },
  };
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx vitest run src/plugins/synth-engine-adapter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/synth-engine-adapter.ts src/plugins/synth-engine-adapter.test.ts
git commit -m "feat(plugins): synth engine → plugin adapter (transitional)"
```

---

## Phase B — Bootstrap, integrate (no behavior change)

### Task 4: Bootstrap module

**Files:** create `src/app/plugin-bootstrap.ts`.

- [ ] **Step 1: Write the bootstrap**

```ts
// src/app/plugin-bootstrap.ts
import { registerPlugin } from '../plugins/registry';
import { synthEngineAsPlugin } from '../plugins/synth-engine-adapter';
import { getEngine } from '../engines/registry';
import type { PluginFactory } from '../plugins/types';

/** Register every built-in plugin. Call once at app start, BEFORE
 *  `createAudioGraph()` (because some downstream code resolves plugins
 *  during graph construction). The `extras` parameter is unused today —
 *  it's the seam where phase 2 (runtime-loaded plugins) hooks in. */
export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  // Synth engines via the transitional adapter. Tasks 7–12 replace each
  // line with a native plugin export.
  for (const id of ['tb303', 'subtractive', 'fm', 'wavetable', 'karplus', 'drums-machine']) {
    const engine = getEngine(id);
    if (engine) registerPlugin(synthEngineAsPlugin(engine));
  }
  // FX + modulator plugins (added in later phases) live here too.
  for (const p of extras) registerPlugin(p);
}
```

- [ ] **Step 2: Wire into `src/main.ts`**

Open [src/main.ts](src/main.ts). Find the block of side-effect imports near the top:

```ts
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import { configureTB303EngineMainInstance, tb303Engine } from './engines/tb303';
…
import './engines/drums-engine';
```

Keep the named imports (`configureTB303EngineMainInstance`, `tb303Engine`, `configureDrumsEngineSharedFx`) — `audio-graph.ts` and `drums-engine.ts` setup still use them. Remove only the bare side-effect lines. The engines still self-register because `plugin-bootstrap.ts` imports `'../engines/registry'` which is transitively touched, AND because each engine file still ends with `registerEngine(...)` / `registerEngineFactory(...)` which runs the first time the module is imported.

**Important:** to guarantee the engine modules ARE evaluated (so they call `registerEngine`), `plugin-bootstrap.ts` must transitively import them. The simplest way: add one named import per engine inside `plugin-bootstrap.ts`:

```ts
// Force-evaluate engine modules so they self-register in the legacy engine
// registry; bootstrapPlugins() then re-wraps them as plugins.
import '../engines/tb303';
import '../engines/subtractive';
import '../engines/fm';
import '../engines/wavetable';
import '../engines/karplus';
import '../engines/drums-engine';
```

Add at the top of `main.ts`:

```ts
import { bootstrapPlugins } from './app/plugin-bootstrap';
```

And place `bootstrapPlugins();` immediately before the first call that builds the audio graph (currently a call to `createAudioGraph()` early in `main.ts`).

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Then run the dev server (`npm run dev`) and confirm in the browser: app boots into Session view; bass plays via `TB-303 1` lane; drums play via `Drums 1`; subtractive plays via `Sub 1`.

- [ ] **Step 4: Commit**

```bash
git add src/app/plugin-bootstrap.ts src/main.ts
git commit -m "feat(plugins): bootstrap via adapter; remove side-effect engine imports"
```

---

### Task 5: Smoke test — bootstrap populates the plugin registry

**Files:** create `src/app/plugin-bootstrap.test.ts`.

- [ ] **Step 1: Write the test**

```ts
// src/app/plugin-bootstrap.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapPlugins } from './plugin-bootstrap';
import { listPlugins, _resetRegistry } from '../plugins/registry';

describe('bootstrapPlugins', () => {
  beforeEach(() => _resetRegistry());

  it('registers all six built-in synth engines as plugins', () => {
    bootstrapPlugins();
    const ids = listPlugins('synth').map((p) => p.manifest.id).sort();
    expect(ids).toEqual(['drums-machine', 'fm', 'karplus', 'subtractive', 'tb303', 'wavetable']);
  });

  it('accepts and registers extras', () => {
    bootstrapPlugins([{
      kind: 'fx',
      manifest: { id: 'noop', name: 'noop', kind: 'fx', version: '1.0.0', params: [], presets: [] },
      create: () => ({
        input: {} as any, output: {} as any,
        getAudioParams: () => new Map(), getBaseValue: () => 0, setBaseValue: () => {},
        applyPreset: () => {}, dispose: () => {},
      }),
    }]);
    expect(listPlugins('fx').map((p) => p.manifest.id)).toEqual(['noop']);
  });
});
```

- [ ] **Step 2: Run — verify PASS**

```bash
npx vitest run src/app/plugin-bootstrap.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/app/plugin-bootstrap.test.ts
git commit -m "test(plugins): bootstrap registers six built-in synths"
```

---

## Phase C — Migrate synth engines to native plugins

Each engine in this phase follows the same shape:

1. Export `xxxPlugin: PluginFactory` from the engine file.
2. Change `plugin-bootstrap.ts` to import and register `xxxPlugin` directly, dropping its `getEngine(id) → synthEngineAsPlugin(...)` line for that id.
3. Verify build + browser smoke.

The engine class and its singleton (where it exists) remain — `audio-graph.ts` and `lane-allocator.ts` still depend on them. The native plugin export is additive.

### Task 6: TB-303 native plugin

**Files:**
- Modify `src/engines/tb303.ts` (add export at bottom, after `registerEngineFactory` on line 272)
- Modify `src/app/plugin-bootstrap.ts`

- [ ] **Step 1: Add native plugin export to `src/engines/tb303.ts`**

Append at the bottom of [src/engines/tb303.ts](src/engines/tb303.ts), after line 272:

```ts
import type { PluginFactory } from '../plugins/types';

export const tb303Plugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'tb303',
    name: 'TB-303',
    kind: 'synth',
    version: '1.0.0',
    params: tb303Engine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new TB303Engine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
```

- [ ] **Step 2: Wire into bootstrap**

In [src/app/plugin-bootstrap.ts](src/app/plugin-bootstrap.ts), replace the `'tb303'` iteration entry with a direct native registration:

```ts
import { tb303Plugin } from '../engines/tb303';
// inside bootstrapPlugins:
registerPlugin(tb303Plugin);
// (drop 'tb303' from the for-loop array)
```

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: TB-303 lane still plays.

- [ ] **Step 4: Commit**

```bash
git add src/engines/tb303.ts src/app/plugin-bootstrap.ts
git commit -m "feat(plugins): tb303 native plugin export"
```

### Task 7: Subtractive native plugin

Same shape as Task 6, with one difference: `subtractive.ts` no longer exports a `subtractiveEngine` singleton ([src/engines/subtractive.ts:499-500](src/engines/subtractive.ts#L499-L500) calls `new SubtractiveEngine()` twice without keeping a reference). The manifest reads `params` from a fresh `new SubtractiveEngine()` (cheap construction, only used at registration time).

- [ ] **Step 1: Add export to `src/engines/subtractive.ts`** (after line 500)

```ts
import type { PluginFactory } from '../plugins/types';

const _subtractiveForMeta = new SubtractiveEngine();
export const subtractivePlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'subtractive',
    name: 'Subtractive',
    kind: 'synth',
    version: '1.0.0',
    params: _subtractiveForMeta.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new SubtractiveEngine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
```

- [ ] **Step 2: Wire into bootstrap** — same pattern as Task 6.

- [ ] **Step 3: Verify** — `vitest`, `tsc`, `build`, browser. Sub 1 plays.

- [ ] **Step 4: Commit**: `feat(plugins): subtractive native plugin export`

### Task 8: FM native plugin

`fmEngine` singleton exists at [src/engines/fm.ts:569](src/engines/fm.ts#L569). Mirror Task 6 exactly, replacing `tb303` / `TB303Engine` with `fm` / `FMEngine` and reading params from `fmEngine.params`.

- [ ] Add `fmPlugin` export to `src/engines/fm.ts`.
- [ ] Wire into `bootstrap`.
- [ ] Verify.
- [ ] Commit: `feat(plugins): fm native plugin export`.

### Task 9: Wavetable native plugin

`wavetableEngine` singleton at [src/engines/wavetable.ts:464](src/engines/wavetable.ts#L464). Mirror Task 6.

- [ ] Add `wavetablePlugin` export.
- [ ] Wire into `bootstrap`.
- [ ] Verify.
- [ ] Commit: `feat(plugins): wavetable native plugin export`.

### Task 10: Karplus native plugin

`karplusEngine` singleton at [src/engines/karplus.ts:427](src/engines/karplus.ts#L427). Mirror Task 6.

- [ ] Add `karplusPlugin` export.
- [ ] Wire into `bootstrap`.
- [ ] Verify.
- [ ] Commit: `feat(plugins): karplus native plugin export`.

### Task 11: Drums native plugin

`drumsEngine` singleton is referenced as `drumsEngine` inside [src/engines/drums-engine.ts:258](src/engines/drums-engine.ts#L258) (the file defines `const drumsEngine = new DrumsEngine()` shortly before the registration calls). Mirror Task 6 but use `id: 'drums-machine'`.

- [ ] Add `drumsPlugin` export.
- [ ] Wire into `bootstrap`.
- [ ] Verify — drums lane still plays through the GM kit picker.
- [ ] Commit: `feat(plugins): drums native plugin export`.

### Task 12: Remove the synth engine adapter

After Tasks 6–11 the adapter is no longer used.

**Files:**
- Delete `src/plugins/synth-engine-adapter.ts`, `src/plugins/synth-engine-adapter.test.ts`
- Modify `src/app/plugin-bootstrap.ts` — drop the adapter import and the legacy fallback loop

- [ ] **Step 1: Delete adapter files**

```bash
git rm src/plugins/synth-engine-adapter.ts src/plugins/synth-engine-adapter.test.ts
```

- [ ] **Step 2: Clean up `plugin-bootstrap.ts`**

Final shape:

```ts
import { registerPlugin } from '../plugins/registry';
import { tb303Plugin }       from '../engines/tb303';
import { subtractivePlugin } from '../engines/subtractive';
import { fmPlugin }          from '../engines/fm';
import { wavetablePlugin }   from '../engines/wavetable';
import { karplusPlugin }     from '../engines/karplus';
import { drumsPlugin }       from '../engines/drums-engine';
import type { PluginFactory } from '../plugins/types';

const BUILTIN: PluginFactory[] = [
  tb303Plugin, subtractivePlugin, fmPlugin, wavetablePlugin, karplusPlugin, drumsPlugin,
  // FX + modulator plugins appended in later phases.
];

export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  for (const p of [...BUILTIN, ...extras]) registerPlugin(p);
}
```

The named imports replace the prior `'../engines/xxx'` bare imports; the engine files still self-register in the legacy engine registry as a side-effect of being imported.

- [ ] **Step 3: Verify** — `vitest`, `tsc`, `build`, browser.

- [ ] **Step 4: Commit**: `chore(plugins): drop transitional synth engine adapter`.

**CHECKPOINT end of Phase C.** All synth engines have native plugin exports. The legacy engine registry coexists for `audio-graph.ts` / `lane-allocator.ts` callers and is NOT retired in this plan.

---

## Phase D — InsertChain + FX plugins

### Task 13: InsertChain class

**Files:** create `src/plugins/fx/insert-chain.ts`, `src/plugins/fx/insert-chain.test.ts`.

`InsertChain` is a generic linear chain of `FxInstance`s with bypass and reorder. It's used both in the master signal path and per-lane.

- [ ] **Step 1: Write the failing tests**

```ts
// src/plugins/fx/insert-chain.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InsertChain } from './insert-chain';
import type { FxInstance } from '../types';

class FakeNode {
  connections: FakeNode[] = [];
  connect(d: FakeNode) { this.connections.push(d); }
  disconnect() { this.connections = []; }
}

function makeFx(): FxInstance {
  const input  = new FakeNode();
  const output = new FakeNode();
  input.connect(output);  // pass-through DSP
  return {
    input: input as unknown as AudioNode,
    output: output as unknown as AudioNode,
    getAudioParams: () => new Map(),
    getBaseValue: () => 0, setBaseValue: () => {}, applyPreset: () => {},
    dispose: () => {},
  };
}

describe('InsertChain', () => {
  let input: FakeNode, output: FakeNode, chain: InsertChain;

  beforeEach(() => {
    input = new FakeNode();
    output = new FakeNode();
    chain = new InsertChain(input as any, output as any);
  });

  it('connects input → output directly when empty', () => {
    expect(input.connections).toContain(output);
  });

  it('one insert: input → fx.input, fx.output → output', () => {
    const fx = makeFx();
    chain.insert(fx);
    expect(input.connections).toContain(fx.input);
    expect((fx.output as any as FakeNode).connections).toContain(output);
  });

  it('two inserts chain serially', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    expect(input.connections).toContain(a.input);
    expect((a.output as any as FakeNode).connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(output);
  });

  it('bypass routes around a slot', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    chain.setBypass(0, true);
    expect(input.connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(output);
  });

  it('remove disposes and rewires', () => {
    const a = makeFx(); const b = makeFx();
    let disposed = false;
    a.dispose = () => { disposed = true; };
    chain.insert(a); chain.insert(b);
    chain.remove(0);
    expect(disposed).toBe(true);
    expect(input.connections).toContain(b.input);
  });

  it('reorder swaps and rewires', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    chain.reorder(0, 1);
    expect(input.connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(a.input);
    expect((a.output as any as FakeNode).connections).toContain(output);
  });

  it('dispose tears down all slots and clears connections', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    chain.dispose();
    expect(chain.list().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx vitest run src/plugins/fx/insert-chain.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/plugins/fx/insert-chain.ts
import type { FxInstance } from '../types';

export interface ChainSlot {
  fx: FxInstance;
  bypass: boolean;
}

export class InsertChain {
  private slots: ChainSlot[] = [];

  constructor(private input: AudioNode, private output: AudioNode) {
    this.rewire();
  }

  list(): readonly ChainSlot[] { return this.slots; }
  size(): number { return this.slots.length; }

  insert(fx: FxInstance, at?: number): void {
    const idx = at ?? this.slots.length;
    this.slots.splice(idx, 0, { fx, bypass: false });
    this.rewire();
  }

  remove(idx: number): void {
    const [slot] = this.slots.splice(idx, 1);
    if (!slot) return;
    slot.fx.dispose();
    this.rewire();
  }

  setBypass(idx: number, bypass: boolean): void {
    const s = this.slots[idx];
    if (!s) return;
    s.bypass = bypass;
    this.rewire();
  }

  reorder(from: number, to: number): void {
    if (from === to) return;
    const [s] = this.slots.splice(from, 1);
    if (!s) return;
    this.slots.splice(to, 0, s);
    this.rewire();
  }

  dispose(): void {
    for (const s of this.slots) s.fx.dispose();
    this.slots = [];
    try { this.input.disconnect(); } catch { /* ok */ }
  }

  private rewire(): void {
    try { this.input.disconnect(); } catch { /* ok */ }
    for (const s of this.slots) {
      try { s.fx.output.disconnect(); } catch { /* ok */ }
    }
    const active = this.slots.filter((s) => !s.bypass).map((s) => s.fx);
    if (active.length === 0) {
      this.input.connect(this.output);
      return;
    }
    this.input.connect(active[0].input);
    for (let i = 0; i < active.length - 1; i++) {
      active[i].output.connect(active[i + 1].input);
    }
    active[active.length - 1].output.connect(this.output);
  }
}
```

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/plugins/fx/insert-chain.ts src/plugins/fx/insert-chain.test.ts
git commit -m "feat(plugins): generic InsertChain with bypass + reorder"
```

---

### Task 14: Multifilter plugin

**Files:** create `src/plugins/fx/multifilter.ts`; modify `src/app/plugin-bootstrap.ts`.

`multifilter` is a single Biquad with type/freq/Q params — the minimum that lets a user add a filter to any chain. The existing master `FilterChain` (stacked filters with per-filter LFO sync) keeps existing semantics until Phase E swaps it for `InsertChain + multifilter`.

- [ ] **Step 1: Write the plugin**

```ts
// src/plugins/fx/multifilter.ts
import type { FxInstance, PluginFactory } from '../types';

export const multifilterPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'multifilter',
    name: 'Filter',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'freq', label: 'Freq', kind: 'continuous', min: 20,  max: 20000, default: 1000, curve: 'exponential', unit: 'Hz' },
      { id: 'q',    label: 'Q',    kind: 'continuous', min: 0.1, max: 24,    default: 1,    curve: 'exponential' },
      { id: 'type', label: 'Type', kind: 'discrete',   min: 0,   max: 3,     default: 0,
        options: [
          { value: 'lowpass',  label: 'LP' },
          { value: 'highpass', label: 'HP' },
          { value: 'bandpass', label: 'BP' },
          { value: 'notch',    label: 'Notch' },
        ] },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const output = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    input.connect(filter).connect(output);

    let typeIdx = 0;
    const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

    const params = new Map<string, AudioParam>([
      ['freq', filter.frequency],
      ['q', filter.Q],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => {
        if (id === 'freq') return filter.frequency.value;
        if (id === 'q')    return filter.Q.value;
        if (id === 'type') return typeIdx;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'freq') filter.frequency.value = v;
        if (id === 'q')    filter.Q.value = v;
        if (id === 'type') { typeIdx = v | 0; filter.type = types[typeIdx] ?? 'lowpass'; }
      },
      applyPreset: () => { /* no presets */ },
      dispose: () => { try { input.disconnect(); filter.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
```

- [ ] **Step 2: Register in bootstrap**

In [src/app/plugin-bootstrap.ts](src/app/plugin-bootstrap.ts), add `multifilterPlugin` to the `BUILTIN` array.

- [ ] **Step 3: Verify** — `vitest`, `tsc`, `build`. Browser unchanged (no UI uses the plugin yet).

- [ ] **Step 4: Commit**: `feat(plugins): multifilter FX plugin`.

### Task 15: Distortion plugin

**Files:** create `src/plugins/fx/distortion.ts`; modify `src/app/plugin-bootstrap.ts`.

- [ ] **Step 1: Write the plugin**

```ts
// src/plugins/fx/distortion.ts
import type { FxInstance, PluginFactory } from '../types';

function makeCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 100;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export const distortionPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'distortion',
    name: 'Dist',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'drive', label: 'Drive', kind: 'continuous', min: 0, max: 1, default: 0.3 },
      { id: 'mix',   label: 'Mix',   kind: 'continuous', min: 0, max: 1, default: 1.0 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeCurve(0.3);
    shaper.oversample = '4x';
    const dry = ctx.createGain(); dry.gain.value = 0;
    const wet = ctx.createGain(); wet.gain.value = 1;
    const output = ctx.createGain();
    input.connect(dry).connect(output);
    input.connect(shaper).connect(wet).connect(output);

    let drive = 0.3;
    let mix   = 1.0;
    const params = new Map<string, AudioParam>([['mix', wet.gain]]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => id === 'drive' ? drive : id === 'mix' ? mix : 0,
      setBaseValue: (id, v) => {
        if (id === 'drive') { drive = v; shaper.curve = makeCurve(v); }
        if (id === 'mix')   { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); shaper.disconnect(); dry.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
```

- [ ] **Step 2: Register in bootstrap.**
- [ ] **Step 3: Verify.**
- [ ] **Step 4: Commit:** `feat(plugins): distortion FX plugin`.

### Task 16: Reverb plugin (DSP-equivalent to current FxBus reverb)

**Files:** create `src/plugins/fx/reverb.ts`; modify `src/app/plugin-bootstrap.ts`.

This plugin reproduces the convolver-based reverb currently inside `FxBus` so a future task can swap `FxBus` to use it instead of inline DSP. For now it's registered but not yet wired into `FxBus` (deferred to phase 2 — not in scope).

- [ ] **Step 1: Write the plugin**

```ts
// src/plugins/fx/reverb.ts
import type { FxInstance, PluginFactory } from '../types';

function makeImpulse(ctx: AudioContext, sec: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * Math.max(0.05, sec));
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

export const reverbPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'reverb',
    name: 'Reverb',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'wet',      label: 'Wet',      kind: 'continuous', min: 0,    max: 1.5, default: 0.9 },
      { id: 'predelay', label: 'PreD',     kind: 'continuous', min: 0,    max: 0.5, default: 0,   unit: 's' },
      { id: 'size',     label: 'Size',     kind: 'continuous', min: 0.05, max: 8,   default: 2.5, unit: 's' },
      { id: 'decay',    label: 'Decay',    kind: 'continuous', min: 0.1,  max: 10,  default: 3 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    let size = 2.5, decay = 3;
    const input    = ctx.createGain();
    const predelay = ctx.createDelay(0.5);
    const conv     = ctx.createConvolver(); conv.buffer = makeImpulse(ctx, size, decay);
    const wet      = ctx.createGain(); wet.gain.value = 0.9;
    const output   = ctx.createGain();
    input.connect(predelay).connect(conv).connect(wet).connect(output);

    const params = new Map<string, AudioParam>([
      ['wet', wet.gain],
      ['predelay', predelay.delayTime],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => {
        if (id === 'wet')      return wet.gain.value;
        if (id === 'predelay') return predelay.delayTime.value;
        if (id === 'size')     return size;
        if (id === 'decay')    return decay;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'wet')      wet.gain.value = v;
        if (id === 'predelay') predelay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01);
        if (id === 'size')     { size = v;  conv.buffer = makeImpulse(ctx, size, decay); }
        if (id === 'decay')    { decay = v; conv.buffer = makeImpulse(ctx, size, decay); }
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); predelay.disconnect(); conv.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
```

- [ ] **Step 2: Register in bootstrap.**
- [ ] **Step 3: Verify.**
- [ ] **Step 4: Commit:** `feat(plugins): reverb FX plugin (not yet wired into FxBus)`.

### Task 17: Delay plugin (DSP-equivalent to current FxBus delay)

**Files:** create `src/plugins/fx/delay.ts`; modify `src/app/plugin-bootstrap.ts`.

- [ ] **Step 1: Write the plugin** — same shape as Task 16, wrapping a delay + LP feedback. Params: `time` (0.01–2s), `feedback` (0–0.95), `wet` (0–1.5), `damping` (200–12000 Hz). Internal: `input → delay → output`; feedback loop `delay → damping → fb → delay`; `wet` controls `delay → wet → output`. Use the same shape as the existing delay in [src/core/fx.ts](src/core/fx.ts) (around line 30).
- [ ] **Step 2: Register in bootstrap.**
- [ ] **Step 3: Verify.**
- [ ] **Step 4: Commit:** `feat(plugins): delay FX plugin (not yet wired into FxBus)`.

---

## Phase E — Master InsertChain replaces FilterChain

The master signal path today: `master → FilterChain → MasterCompressor → analyser → destination` (built in [src/app/audio-graph.ts:30-40](src/app/audio-graph.ts#L30)). After this phase: `master → InsertChain → MasterCompressor → analyser → destination`. The master `InsertChain` starts populated with one `multifilter` plugin instance so existing behavior (a single filter slot) is preserved by default.

### Task 18: AudioGraph holds `masterInsertChain`

**Files:** modify `src/app/audio-graph.ts`, add `src/app/audio-graph.test.ts`.

- [ ] **Step 0: Write the failing test FIRST (TDD)**

Add `src/app/audio-graph.test.ts` asserting the new shape and signal path:

```ts
import { describe, it, expect } from 'vitest';
import { createAudioGraph } from './audio-graph';
import { InsertChain } from '../plugins/fx/insert-chain';

describe('AudioGraph master InsertChain', () => {
  it('exposes masterInsertChain wired between master and masterComp.input', () => {
    const g = createAudioGraph();
    expect(g.masterInsertChain).toBeInstanceOf(InsertChain);
    // No more filterChain field.
    expect((g as any).filterChain).toBeUndefined();
    // masterInsertChain.inputNode is the master GainNode.
    expect(g.masterInsertChain.inputNode).toBe(g.master);
  });
});
```

Run `npx vitest run src/app/audio-graph.test.ts` and confirm it FAILS (today the graph has `filterChain`, not `masterInsertChain`). Only then proceed.

- [ ] **Step 1: Refactor `createAudioGraph()`**

Replace these lines in [src/app/audio-graph.ts](src/app/audio-graph.ts) (~lines 16, 39):

```ts
filterChain: FilterChain;
// …
const filterChain = new FilterChain(ctx, master, masterComp.input);
```

with:

```ts
import { InsertChain } from '../plugins/fx/insert-chain';
// AudioGraph interface:
masterInsertChain: InsertChain;
// inside createAudioGraph:
const masterInsertChain = new InsertChain(master, masterComp.input);
```

Update the returned object accordingly. **Do not** delete the `FilterChain` import yet — it stays in `src/core/fx.ts` for now (Task 27 cleanup).

- [ ] **Step 2: Update every consumer that read `graph.filterChain`**

Find consumers:

```bash
grep -rn "\.filterChain" src/
```

Each consumer needs migrating:
- [src/save/saved-state-v3.ts](src/save/saved-state-v3.ts) — `filterChain` is a dep; replace with `masterInsertChain` (Task 24 handles serialization shape).
- [src/core/fx-ui.ts](src/core/fx-ui.ts) — UI driver; Task 19 replaces it with the generic insert-chain panel.
- [src/main.ts](src/main.ts) — wires deps; rename the local.

The minimal change for the verify-green checkpoint after this task: rename the field and pass-through; don't migrate UI yet (Task 19 does that). The intermediate state means the master FX UI section may briefly stop responding — verify in the browser that master FX UI is the only regression and that lane audio is intact.

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: lanes play. The master FX UI may show stale or non-responsive; that's expected — Task 19 fixes it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(audio-graph): master InsertChain replaces FilterChain (UI temporarily stubbed)"
```

---

## Phase F — Insert UI (shared between master and per-lane)

### Task 19: lane-insert-ui — generic insert-chain panel

**Files:** create `src/session/lane-insert-ui.ts`.

A single component renders any `InsertChain` against any `InsertSlot[]` backing store. Used both by the lane inspector (Task 22) and the master FX panel (this task).

- [ ] **Step 1: Define `InsertSlot` + helpers**

Create [src/session/insert-slot.ts](src/session/insert-slot.ts):

```ts
// src/session/insert-slot.ts
import type { FxInstance } from '../plugins/types';
import type { ModulatorState } from '../modulation/types';

export interface InsertSlot {
  pluginId: string;
  params: Record<string, number>;
  presetName?: string;
  modulators?: ModulatorState[];
  bypass: boolean;
}

export function applyInsertSlot(slot: InsertSlot, inst: FxInstance): void {
  for (const [id, v] of Object.entries(slot.params)) inst.setBaseValue(id, v);
}

export function snapshotInsertSlot(slot: InsertSlot, inst: FxInstance, paramIds: string[]): InsertSlot {
  const params: Record<string, number> = {};
  for (const id of paramIds) params[id] = inst.getBaseValue(id);
  return { ...slot, params };
}
```

Test in [src/session/insert-slot.test.ts](src/session/insert-slot.test.ts):

```ts
import { describe, it, expect } from 'vitest';
import { applyInsertSlot, snapshotInsertSlot, type InsertSlot } from './insert-slot';
import type { FxInstance } from '../plugins/types';

function fakeInst(init: Record<string, number>): FxInstance {
  const v = { ...init };
  return {
    input: {} as any, output: {} as any,
    getAudioParams: () => new Map(),
    getBaseValue: (id) => v[id] ?? 0,
    setBaseValue: (id, x) => { v[id] = x; },
    applyPreset: () => {}, dispose: () => {},
  };
}

describe('insert-slot helpers', () => {
  it('snapshot reads via getBaseValue', () => {
    const inst = fakeInst({ freq: 1234, q: 2 });
    const slot: InsertSlot = { pluginId: 'multifilter', params: {}, bypass: false };
    const snap = snapshotInsertSlot(slot, inst, ['freq', 'q']);
    expect(snap.params).toEqual({ freq: 1234, q: 2 });
  });

  it('apply writes via setBaseValue', () => {
    const inst = fakeInst({});
    const slot: InsertSlot = { pluginId: 'multifilter', params: { freq: 800, q: 5 }, bypass: true };
    applyInsertSlot(slot, inst);
    expect(inst.getBaseValue('freq')).toBe(800);
    expect(inst.getBaseValue('q')).toBe(5);
  });
});
```

- [ ] **Step 2: Write the UI builder**

```ts
// src/session/lane-insert-ui.ts
import { listPlugins, createInstance } from '../plugins/registry';
import { applyInsertSlot, type InsertSlot } from './insert-slot';
import type { InsertChain } from '../plugins/fx/insert-chain';
import { createKnob } from '../core/knob';

const SEND_ONLY_IN_PHASE_1 = new Set<string>();  // reverb/delay live in FxBus; pickable from inserts is fine but skipped in phase 1

export interface LaneInsertUIDeps {
  ctx: AudioContext;
  container: HTMLElement;
  chain: InsertChain;
  slots: InsertSlot[];
  onChange: () => void;
}

export function buildLaneInsertUI(deps: LaneInsertUIDeps): void {
  const { ctx, container, chain, slots, onChange } = deps;
  container.replaceChildren();

  // Render existing slots.
  chain.list().forEach((cs, idx) => {
    const slot = slots[idx];
    if (!slot) return;
    const row = document.createElement('div');
    row.className = 'insert-slot';

    const factory = listPlugins('fx').find((p) => p.manifest.id === slot.pluginId);
    if (factory) {
      const label = document.createElement('span');
      label.textContent = factory.manifest.name;
      row.appendChild(label);

      for (const spec of factory.manifest.params) {
        if (spec.kind !== 'continuous') continue;
        createKnob({
          parent: row,
          label: spec.label,
          min: spec.min, max: spec.max,
          get: () => cs.fx.getBaseValue(spec.id),
          set: (v) => { cs.fx.setBaseValue(spec.id, v); slot.params[spec.id] = v; onChange(); },
        });
      }
    }

    const bypass = document.createElement('button');
    bypass.textContent = slot.bypass ? 'BYP' : 'ON';
    bypass.onclick = () => {
      slot.bypass = !slot.bypass;
      chain.setBypass(idx, slot.bypass);
      onChange();
      buildLaneInsertUI(deps);
    };
    row.appendChild(bypass);

    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.onclick = () => {
      chain.remove(idx);
      slots.splice(idx, 1);
      onChange();
      buildLaneInsertUI(deps);
    };
    row.appendChild(rm);

    container.appendChild(row);
  });

  // + Add insert button → picker.
  const add = document.createElement('button');
  add.textContent = '+ Add insert';
  add.onclick = () => {
    const picker = document.createElement('select');
    picker.appendChild(new Option('—', ''));
    for (const p of listPlugins('fx')) {
      if (SEND_ONLY_IN_PHASE_1.has(p.manifest.id)) continue;
      picker.appendChild(new Option(p.manifest.name, p.manifest.id));
    }
    picker.onchange = () => {
      const pluginId = picker.value;
      if (!pluginId) return;
      const inst = createInstance('fx', pluginId, ctx);
      if (!inst) return;
      const factory = listPlugins('fx').find((p) => p.manifest.id === pluginId)!;
      const params: Record<string, number> = {};
      for (const s of factory.manifest.params) params[s.id] = inst.getBaseValue(s.id);
      const slot: InsertSlot = { pluginId, params, bypass: false };
      slots.push(slot);
      chain.insert(inst);
      onChange();
      buildLaneInsertUI(deps);
    };
    container.appendChild(picker);
  };
  container.appendChild(add);
}
```

This is the minimum functional UI. Future polish (drag-reorder, preset picker per slot) is out of scope for phase 1.

- [ ] **Step 3: Mount on the master FX panel**

In [src/core/fx-ui.ts](src/core/fx-ui.ts), the section that built rows from `filterChain.filters` is replaced by a single call:

```ts
buildLaneInsertUI({
  ctx,
  container: masterFxContainer,
  chain: graph.masterInsertChain,
  slots: sessionState.masterInserts ??= [],
  onChange: () => deps.saveSession?.(),
});
```

The `masterInserts` source-of-truth lives on `SessionState` (Task 23 adds the field). For this task, treat it as a local array initialized to `[]` until persistence lands.

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: master FX panel now shows "+ Add insert". Add a Filter, drag its freq knob, hear the change. Add a Dist, hear chained processing. Remove, bypass.

- [ ] **Step 5: Commit**

```bash
git add src/session/insert-slot.ts src/session/insert-slot.test.ts src/session/lane-insert-ui.ts src/core/fx-ui.ts
git commit -m "feat(plugins): generic insert-chain UI panel; master FX uses it"
```

---

## Phase G — Collapse boot allocation

This phase is refactor-only — no new inserts wiring. It strips `audio-graph.ts` down to the master signal chain, makes `ensureLaneResource(laneId, engineId)` the sole allocation path for every lane, fixes the latent extra-drum-lane `setSharedFx` bug, and migrates boot-eager consumers of `bassStrip`/`polyStrip`/`drumBusStrip` to lazy `laneResources` lookups. The default boot session JSON drives initial allocation via `sessionHost.applyLoadedSessionState`.

### Phase G deferral rule (consumers of `lanes.resources`)

After Phase G, every consumer that reads from `lanes.resources` MUST defer its access until `sessionHost.onStateApplied()` fires OR `applyLoadedSessionState()` has run. There is no boot pre-fill — the map is empty until the boot session JSON is applied.

- Any consumer that calls `lanes.resources.get(LANE_ID_X)` during audio-graph construction or at app start will get `undefined` (or, after Task 22 Step 4, a thrown exception from `stripFor`).
- Boot-eager UI (knob rows, mixer rows, inspector tabs) must subscribe via `sessionHost.onStateApplied(cb)` — see Task 23 Step 4.
- Tests that constructed lanes by hand must either run `applyLoadedSessionState` as setup or call `ensureLaneResource(laneId, engineId)` explicitly.
- Add a dedicated boot-order regression test in `src/session/session-host.test.ts` that asserts `lanes.resources.size === 0` immediately after `createLaneAllocator` and grows to the lane count only after `applyLoadedSessionState`. This locks in the invariant.

A comment restating this invariant ships in `lane-allocator.ts` near `stripFor` (Task 22 Step 4).

### Task 20: Delete legacy engine configurators

**Files:** modify `src/engines/tb303.ts`, `src/engines/drums-engine.ts`, `src/engines/subtractive.ts`.

The three exports `configureTB303EngineMainInstance` ([src/engines/tb303.ts:274](src/engines/tb303.ts#L274)), `configureDrumsEngineSharedFx` ([src/engines/drums-engine.ts:261](src/engines/drums-engine.ts#L261)), and the singleton-only `setPolySynth` call on `subtractive` ([src/engines/subtractive.ts:398](src/engines/subtractive.ts#L398) is the method — the export call is in `audio-graph.ts:58`) exist solely to register the three boot instances with the engine singletons at `audio-graph.ts` construction time. After Phase G these calls are gone; per-instance wiring moves into `ensureLaneResource`. The METHODS `registerInstance`, `setSharedFx`, `setPolySynth`, and `setBusStrip` STAY (tests + per-instance calls still use them). Only the exported configurator FUNCTIONS are deleted.

- [ ] **Step 1: Delete the configurator exports**

In [src/engines/tb303.ts](src/engines/tb303.ts), delete the entire function:

```ts
// DELETE: export function configureTB303EngineMainInstance(output: AudioNode, instance: TB303): void {
//   tb303Engine.registerInstance(output, instance);
// }
```

Keep `registerInstance` method on `TB303Engine` (line 209) — tests and per-lane wiring still use it.

In [src/engines/drums-engine.ts](src/engines/drums-engine.ts), delete:

```ts
// DELETE: export function configureDrumsEngineSharedFx(fx: FxBus): void {
//   drumsEngine.setSharedFx(fx);
// }
```

Keep `setSharedFx` and `setBusStrip` methods on `DrumsEngine` — called per-instance from `ensureLaneResource` after Task 22.

- [ ] **Step 2: Audit `createVoice` for self-provisioning**

Verify each engine's `createVoice(ctx, output)` builds whatever internal resources it needs without needing a singleton-level configure call. Walk:
- `TB303Engine.createVoice` — does it depend on `lastInstance` or `instances` map? It must NOT depend on `registerInstance` having been called; if it does, fix it to create a fresh `TB303(ctx, output)` and register it via `this.registerInstance(output, voice)` inside `createVoice` itself. **Decision rule:** if `TB303Engine.createVoice` depends on `registerInstance`, move the `registerInstance` call inside `createVoice` so it's self-contained (preferred — keeps the engine's invariant local). Otherwise, add the `registerInstance` call in `ensureLaneResource` (Task 22 Step 5, `tb303` branch) before the lane is returned. Pick exactly one site and document it in the engine source — do not split registration across both layers.
- `DrumsEngine.createVoice` — line 170 throws when `sharedFx` is null. After Task 22 `ensureLaneResource` calls `setSharedFx(deps.fx)` BEFORE `createVoice`. Verify the throw path still exists for safety.
- `SubtractiveEngine.createVoice` — does it depend on `polysynth` being pre-set? If yes, restructure so a fresh `PolySynth` is created and `setPolySynth` invoked inside `createVoice`. (Tasks 6–11 already moved this logic into the native plugin; double-check it lands cleanly with no boot dependency.)

- [ ] **Step 3: Find dangling callers**

```bash
grep -rn "configureTB303EngineMainInstance\|configureDrumsEngineSharedFx" src/ test/
```

Expected: zero matches outside the now-deleted exports (consumers are migrated as part of Task 21).

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

Compilation will fail because `audio-graph.ts` still imports the deleted exports. That's expected — Task 21 fixes it. Do not commit yet.

- [ ] **Step 5: Defer commit to Task 24**

Phase G tasks 20–24 land as one or two commits because the intermediate states don't compile. Stage the edits, run final `tsc --noEmit` + `vitest` only after Task 24, commit once at the end.

---

### Task 21: Strip `audio-graph.ts` down to master-only

**Files:** modify `src/app/audio-graph.ts`.

`createAudioGraph()` returns ONLY the master signal chain plus `FxBus` and `SidechainBus`. No strips, no instruments, no configurators.

- [ ] **Step 1: Rewrite the `AudioGraph` interface**

Replace [src/app/audio-graph.ts:12-30](src/app/audio-graph.ts#L12-L30) with:

```ts
export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  masterInsertChain: InsertChain;
  masterComp: MasterCompressor;
  fx: FxBus;
  sidechainBus: SidechainBus;
}
```

Delete the eight fields: `bassStrip`, `polyStrip`, `drumBusStrip`, `synth`, `drums`, `polysynth`, `mainSubtractive`, `drumsEngineInstance`. (`filterChain` was already replaced by `masterInsertChain` in Phase E Task 18.)

- [ ] **Step 2: Strip down `createAudioGraph()`**

Replace the body (currently [src/app/audio-graph.ts:30-68](src/app/audio-graph.ts#L30-L68)) with:

```ts
import { FxBus, MasterCompressor } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { InsertChain } from '../plugins/fx/insert-chain';

export function createAudioGraph(): AudioGraph {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.connect(ctx.destination);

  const masterComp = new MasterCompressor(ctx);
  masterComp.output.connect(analyser);

  const masterInsertChain = new InsertChain(master, masterComp.input);

  const fx = new FxBus(ctx, master);
  const sidechainBus = new SidechainBus(ctx);

  return { ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus };
}
```

Deletions:
- `const bassStrip / polyStrip / drumBusStrip = new ChannelStrip(...)` (lines 44–49).
- `const synth = new TB303(ctx, bassStrip.input); configureTB303EngineMainInstance(...);` (lines 51–52).
- `const drums = new DrumMachine(ctx, fx, drumBusStrip.input);` (line 53).
- `const polysynth = new PolySynth(ctx, polyStrip.input);` (line 54).
- `const mainSubtractive = getEngine('subtractive') ?? null; if (mainSubtractive) setPolySynth?.(polysynth);` (lines 56–59).
- `const drumsEngineInstance = getEngine('drums-machine') ?? null;` (line 60).
- `configureDrumsEngineSharedFx(fx);` (line 41).

Drop the corresponding imports: `TB303`, `DrumMachine`, `PolySynth`, `configureTB303EngineMainInstance`, `configureDrumsEngineSharedFx`, `getEngine`, `LANE_ID_BASS`, `LANE_ID_DRUMS`, `LANE_ID_POLY`, `ChannelStrip`, `FilterChain`.

- [ ] **Step 3: Verify (intermediate)**

```bash
npx tsc --noEmit
```

Many `main.ts` / `lane-allocator.ts` / `saved-state-v3.ts` errors will remain — fixed in Tasks 22 and 23.

---

### Task 22: `ensureLaneResource` becomes the sole allocation path

**Files:** modify `src/app/lane-allocator.ts`.

`ensureLaneResource(laneId, engineId)` becomes the ONLY way a `LaneResources` ever enters the map. No boot pre-fill, no boot-lane special cases. The drums-machine branch additionally calls `setSharedFx(deps.fx)` to fix the latent bug where extra drum lanes never receive a shared `FxBus` (currently `audio-graph.ts:41` wires only the singleton).

- [ ] **Step 1: Shrink `LaneAllocatorDeps`**

In [src/app/lane-allocator.ts:12-26](src/app/lane-allocator.ts#L12-L26):

```ts
export interface LaneAllocatorDeps {
  ctx: AudioContext;
  master: GainNode;
  fx: FxBus;
  sidechainBus: SidechainBus;
  getBpm(): number;
  extraIds: readonly string[];
}
```

Deletions: `bassStrip`, `polyStrip`, `drumBusStrip`, `drums`, `tb303Engine`, `mainSubtractive`, `drumsEngineInstance`.

- [ ] **Step 2: Delete the boot-lane prefill block**

Delete lines 47–52 entirely:

```ts
// DELETE:
// if (deps.drumsEngineInstance && deps.mainSubtractive) {
//   resources.set(LANE_ID_BASS,  { strip: deps.bassStrip,    engine: deps.tb303Engine });
//   resources.set(LANE_ID_DRUMS, { strip: deps.drumBusStrip, engine: deps.drumsEngineInstance });
//   (deps.drumsEngineInstance as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(deps.drumBusStrip);
//   resources.set(LANE_ID_POLY,  { strip: deps.polyStrip,    engine: deps.mainSubtractive });
// }
```

- [ ] **Step 3: Delete the boot-lane fallbacks in `ensureLaneStrip`**

Delete lines 79–81:

```ts
// DELETE:
// if (laneId === 'tb-303-1')      return deps.bassStrip;
// if (laneId === 'drums-1')       return deps.drumBusStrip;
// if (laneId === 'subtractive-1') return deps.polyStrip;
```

The remaining `ensureExtraPoly` logic still applies for extra-poly lanes.

- [ ] **Step 4: Update `stripFor` to drop the singleton drum reference**

Around [src/app/lane-allocator.ts:95-104](src/app/lane-allocator.ts#L95-L104), the function uses `deps.drums.channels` to detect drum-lane track ids. After collapse, `deps.drums` is gone. Replace with a lookup against the lane that owns drum voices:

```ts
const stripFor = (t: string): ChannelStrip => {
  const res = resources.get(t);
  if (res) return res.strip;
  if (t === 'bass')    return resources.get(LANE_ID_BASS)!.strip;
  if (t === 'poly')    return resources.get(LANE_ID_POLY)!.strip;
  if (t === 'drumBus') return resources.get(LANE_ID_DRUMS)!.strip;
  // Drum-voice track names ('kick', 'snare', etc.) → look up the drum lane.
  const drumLane = resources.get(LANE_ID_DRUMS);
  if (drumLane) return drumLane.strip;
  throw new Error(`stripFor: no resource for track "${t}"`);
};
```

Note the throw: if `stripFor` is called BEFORE `applyLoadedSessionState` populates the lane, it fails loudly instead of silently returning undefined. This forces ordering bugs to surface in tests.

**Behavior change warning:** this is a deliberate move from silent-undefined to thrown-exception. Boot-ordering bugs that used to produce silent audio dropouts now surface as runtime errors. Tests that exercised `stripFor` before `applyLoadedSessionState` must be updated: either call `applyLoadedSessionState` (or `ensureLaneResource`) first as test setup, or stub `lanes.resources.get` with the expected `LaneResources`. Audit `src/**/*.test.ts` for direct `stripFor` callers as part of this step.

- [ ] **Step 5: Patch `ensureLaneResource` to call `setSharedFx` per-instance**

Replace [src/app/lane-allocator.ts:125-139](src/app/lane-allocator.ts#L125-L139) with:

```ts
const ensureLaneResource = (laneId: string, engineId: string): void => {
  if (resources.get(laneId)) return;
  const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx,
    { sidechain: { bus: deps.sidechainBus, id: laneId, label: laneId.toUpperCase() } });
  const engine = createEngineInstance(engineId);
  if (!engine) return;
  if (engineId === 'subtractive') {
    const p = new PolySynth(deps.ctx, strip.input);
    p.bpm = deps.getBpm();
    (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
  }
  if (engineId === 'drums-machine') {
    // Latent-bug fix: setSharedFx MUST be called before createVoice (drums-engine.ts:170).
    (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
    (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
  }
  if (engineId === 'tb303') {
    // Registration with TB303Engine.instances happens inside engine.createVoice
    // per the decision in Task 20 Step 2 (createVoice self-registers). If Task 20
    // instead chose to register here, call `(engine as TB303Engine).registerInstance(strip.input, voice)`
    // after engine.createVoice runs (see ensureLaneVoice). Exactly one site, not both.
  }
  resources.set(laneId, { strip, engine });
};
```

- [ ] **Step 6: Verify (intermediate)**

```bash
npx tsc --noEmit
```

`main.ts` / `initial-pattern.ts` / `saved-state-v3.ts` errors remain — fixed in Task 23.

---

### Task 23: Migrate boot-eager consumers of `bassStrip`/`polyStrip`/`drumBusStrip`

**Files:** modify `src/main.ts`, `src/demo/initial-pattern.ts`, `src/save/saved-state-v3.ts`, and any other file whose destructured `audio.*` referenced the deleted fields.

- [ ] **Step 1: Strip `main.ts` destructuring**

Replace [src/main.ts:97-101](src/main.ts#L97-L101):

```ts
const audio = createAudioGraph();
const { ctx, master, analyser, masterInsertChain, fx, masterComp, sidechainBus } = audio;
// REMOVED: bassStrip, polyStrip, drumBusStrip, synth, drums, polysynth, mainSubtractive, drumsEngineInstance
// All of these are now created on-demand via ensureLaneResource(); access via lanes.resources.get(laneId).
```

- [ ] **Step 2: Strip `createLaneAllocator` args**

Replace [src/main.ts:119](src/main.ts#L119):

```ts
const lanes = createLaneAllocator({
  ctx, master, fx, sidechainBus,
  getBpm: () => seq.bpm,
  extraIds: EXTRA_IDS,
});
```

- [ ] **Step 3: Refactor `setupInitialPattern`**

In [src/demo/initial-pattern.ts:105-109](src/demo/initial-pattern.ts#L105-L109), drop the strip + drums params:

```ts
export interface InitialPatternDeps {
  seq: Sequencer;
  bank: PatternBank;
}
```

The FX-send defaults previously at [src/demo/initial-pattern.ts:132-134](src/demo/initial-pattern.ts#L132-L134) (`bassStrip.setReverbSend(0.1)`, `polyStrip.setReverbSend(0.25)`, `polyStrip.setDelaySend(0.15)`, plus the `drums.channels.snare.setReverbSend(0.25)` line at ~line 130) move into the boot session JSON (Task 24). Delete them from `setupInitialPattern`:

```ts
export function setupInitialPattern(deps: InitialPatternDeps): void {
  const { seq, bank } = deps;
  // ...populate seq.bass/seq.drums slots and bank patterns unchanged...
  // DELETED: drums.channels.*.setReverbSend / setDelaySend calls
  // DELETED: bassStrip.setReverbSend(0.1) / polyStrip.setReverbSend(0.25) / polyStrip.setDelaySend(0.15)
  // FX-send defaults now ship in the boot session JSON (see /public/demos/new.json).
}
```

Update [src/main.ts:452](src/main.ts#L452):

```ts
const initialPatternDeps: InitialPatternDeps = { seq, bank };
setupInitialPattern(initialPatternDeps);
```

- [ ] **Step 4: Defer TB-303 knob wiring**

[src/main.ts:320-327](src/main.ts#L320-L327) currently wires `wireLaneKnobs({ laneId: LANE_ID_BASS, engine: tb303Engine, ... })` at boot, but after collapse the `tb-303-1` lane's `ChannelStrip` does not exist until `applyLoadedSessionState` runs. Wrap the call in a post-load hook:

```ts
// Defer until sessionHost has allocated lanes from the boot session JSON.
sessionHost.onStateApplied?.(() => {
  const bassRes = lanes.resources.get(LANE_ID_BASS);
  if (!bassRes) return;
  const synthKnobsRow = $<HTMLDivElement>('synth-knobs');
  synthKnobsRow.innerHTML = '';
  wireLaneKnobs({
    laneId: LANE_ID_BASS,
    engine: bassRes.engine,
    parent: synthKnobsRow,
    // ...
  });
});
```

If `sessionHost.onStateApplied` does not exist yet, add it as a one-shot callback list in [src/session/session-host.ts](src/session/session-host.ts) — fire after `applyLoadedSessionState` completes. Same pattern for drum knobs, polysynth knobs, mixer rows, and any other boot-eager UI that depended on the deleted `audio.*` fields.

- [ ] **Step 5: Patch `SavedStateV3Deps`**

In [src/save/saved-state-v3.ts](src/save/saved-state-v3.ts), the `SavedStateV3Deps` interface today includes `synth`, `drums`, `polysynth`. After collapse these come from `lanes.resources.get(LANE_ID_BASS)?.engine` etc. Either:

- Pass `lanes: LaneAllocator` into `SavedStateV3Deps` and resolve per-lane references inside `buildSavedStateV3` / `applyLoadedStateV3`, OR
- Remove the synth/drums/polysynth references entirely (preferred: per-lane params already flow through `SessionState.lanes[i].engineState`).

```ts
export interface SavedStateV3Deps {
  // ... existing fields minus synth/drums/polysynth ...
  masterInsertChain: InsertChain;  // was filterChain, renamed in Phase E
  master: GainNode;
  // NEW: lane resources for per-lane param snapshot/restore.
  lanes: LaneAllocator;
}
```

`refreshKnobsFromSynth` (if it exists) is rewritten to iterate `lanes.resources` rather than touching the dropped singletons. Defer the actual refactor to fit existing code — the key invariant is "no more global `synth`/`drums`/`polysynth` references after Phase G".

- [ ] **Step 6: Audit every remaining consumer**

```bash
grep -rn "bassStrip\|polyStrip\|drumBusStrip\|mainSubtractive\|drumsEngineInstance" src/
```

Expected after this task: only test files reference these names; no production file destructures them from `audio`. Migrate each remaining occurrence to `lanes.resources.get(LANE_ID_X)?.strip` or `?.engine`, or defer it via `sessionHost.onStateApplied`.

- [ ] **Step 7: Verify (intermediate)**

```bash
npx tsc --noEmit
```

Compilation should now pass. `vitest run` may still fail on tests that constructed `LaneAllocatorDeps` with the deleted fields — fix those test fixtures in this step too.

---

### Task 24: Boot session JSON self-configures every lane

**Files:** modify `public/demos/new.json` (or the current `public/demos/minimal-techno.json` if the rename hasn't landed).

The default boot session must declare all three legacy lanes with explicit `id` + `engineId`, plus the FX-send defaults previously hard-coded in `setupInitialPattern`. After this task `applyLoadedSessionState` calls `ensureLaneResource` for each lane during boot and the app comes up identical to today.

- [ ] **Step 1: Gap-analyze the current demo JSON**

Read whichever file is in use:

```bash
cat public/demos/minimal-techno.json
```

Required top-level shape (matches `SessionState`):

```json
{
  "lanes": [
    {
      "id": "tb-303-1",
      "engineId": "tb303",
      "clips": [/* … */],
      "engineState": { "params": { /* … */ } },
      "enginePresetName": "Default"
    },
    {
      "id": "drums-1",
      "engineId": "drums-machine",
      "clips": [/* … */],
      "engineState": { "params": { "bus.reverbSend": 0.25 } },
      "enginePresetName": "808"
    },
    {
      "id": "subtractive-1",
      "engineId": "subtractive",
      "clips": [/* … */],
      "engineState": { "params": { "bus.reverbSend": 0.25, "bus.delaySend": 0.15 } },
      "enginePresetName": "Default"
    }
  ],
  "scenes": [/* unchanged */],
  "globalQuantize": "1/1"
}
```

If `id` and `engineId` are missing on any lane, add them. If `engineState.params` does not include the bus-send defaults previously set in [src/demo/initial-pattern.ts:130-134](src/demo/initial-pattern.ts#L130-L134) (`drums.channels.snare.setReverbSend(0.25)`, `bassStrip.setReverbSend(0.1)`, `polyStrip.setReverbSend(0.25)`, `polyStrip.setDelaySend(0.15)`), add them under the appropriate lane's `bus.*` namespace.

- [ ] **Step 2: Verify `applyLoadedSessionState` calls `ensureLaneResource` per lane**

Confirm [src/session/session-host.ts:179](src/session/session-host.ts#L179) iterates `this.state.lanes` and calls `this.deps.ensureLaneResource?.(lane.id, lane.engineId)`. If a lane has no `engineId`, log a warning and skip. (This is existing behavior — verify it still works.)

- [ ] **Step 3: Verify boot end-to-end**

```bash
npm run build
npm run dev
```

In the browser: load the default session; confirm the three lanes appear (`TB-303 1`, `Drums 1`, `Sub 1`). For EACH lane, trigger a note/drum hit independently and confirm audio plays correctly through the mixer/analyser — do not assume one passing lane implies the others work. Confirm reverb/delay sends on each lane match the pre-collapse behavior.

Then add an extra `drums-machine` lane via `+`; trigger a kick on the new lane and confirm it plays AND that turning up its reverb/delay sends produces audible reverb/delay (not silence) — this is the explicit verification of the latent-bug fix from Task 22 Step 5 (`setSharedFx` must be called before `createVoice`, so the new lane's drum voices actually reach `FxBus`).

Modulator regression check: if the boot session JSON includes any LFO or ADSR modulators wired to engine params, confirm they still modulate correctly after the collapse. This exercises the surface that Task 31 (modulation host on registry) will later touch.

- [ ] **Step 4: Full regression**

```bash
npm test
```

If `session-add-lane.test.ts` or `lane-allocator` tests pass `bassStrip`/`drums` etc. into constructors, update those fixtures. Add a new regression test:

```ts
// src/app/lane-allocator.test.ts (add to existing suite)
it('drums-machine lane gets sharedFx wired before createVoice', () => {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const fx = new FxBus(ctx, master);
  const sidechainBus = new SidechainBus(ctx);
  // Spy on setSharedFx so we can assert it was called BEFORE createVoice.
  const setSharedFxSpy = vi.spyOn(DrumsEngine.prototype as any, 'setSharedFx');
  const createVoiceSpy = vi.spyOn(DrumsEngine.prototype as any, 'createVoice');
  const lanes = createLaneAllocator({
    ctx, master, fx, sidechainBus,
    getBpm: () => 120,
    extraIds: [],
  });
  lanes.ensureLaneResource('drums-2', 'drums-machine');
  const res = lanes.resources.get('drums-2');
  expect(res).toBeDefined();
  // Latent-bug fix: setSharedFx must run before any createVoice call.
  expect(setSharedFxSpy).toHaveBeenCalledWith(fx);
  // Order check: the spy.mock.invocationCallOrder field is a monotonic counter.
  if (createVoiceSpy.mock.calls.length > 0) {
    expect(setSharedFxSpy.mock.invocationCallOrder[0])
      .toBeLessThan(createVoiceSpy.mock.invocationCallOrder[0]);
  }
  // And the lane can actually create a voice without throwing.
  expect(() => res!.engine.createVoice(ctx, res!.strip.input)).not.toThrow();
});

// SAVE/LOAD round-trip — guards the existing SaveManager snapshot path against
// the collapsed LaneResourceMap shape before Phase I extends it with inserts.
it('save → load round-trip survives the collapsed allocator shape', () => {
  const lanes = createLaneAllocator({ /* …same fixture as above… */ });
  // Boot lanes must come from applyLoadedSessionState, not pre-fill.
  sessionHost.applyLoadedSessionState(bootSessionFixture);
  const snapshot = saveManager.getStateForSave();

  // Fresh allocator + fresh session host, rehydrate from the snapshot.
  const lanes2 = createLaneAllocator({ /* …same fixture… */ });
  const sessionHost2 = createSessionHost({ /* …deps2 wired to lanes2… */ });
  sessionHost2.applyLoadedSessionState(snapshot.sessionState);

  for (const id of ['tb-303-1', 'drums-1', 'subtractive-1']) {
    const res = lanes2.resources.get(id);
    expect(res).toBeDefined();
    expect(() => res!.engine.createVoice(ctx2, res!.strip.input)).not.toThrow();
  }
});
```

This test must pass at the end of Phase G — BEFORE Phase H wires inserts and BEFORE Phase I adds the persistence layer. It validates that the existing `SaveManager` snapshot/restore path is compatible with the collapsed `LaneResourceMap`. If it fails, the collapse silently broke save/load and Phase H must wait until it's repaired.

- [ ] **Step 5: Commit Phase G (Tasks 20–24)**

```bash
git add -A
git commit -m "refactor(plugin-system): collapse boot allocation — audio-graph master-only, ensureLaneResource is the sole allocation path"
```

Single commit because Tasks 20–23 don't compile in isolation. Phase G ends here with the app behaviorally identical to before, but architecturally clean.

---

## Phase H — Per-lane InsertChain in LaneResources

With Phase G done, every lane (including the three legacy defaults) flows through `ensureLaneResource`. Phase H wires an `InsertChain` between `engine.createVoice` output and `strip.input` for ALL lanes — uniformly. No boot-lane carve-out.

### Task 25: `LaneResources` gains `inserts`; `InsertChain` exposes `inputNode`

**Files:** modify `src/core/lane-resources.ts`, `src/core/lane-resources.test.ts`, `src/plugins/fx/insert-chain.ts`, `src/plugins/fx/insert-chain.test.ts`.

- [ ] **Step 0: Write the failing test FIRST (TDD)**

Add a test to `src/core/lane-resources.test.ts` that asserts `dispose(laneId)` cascades to the InsertChain:

```ts
it('LaneResourceMap.dispose(id) calls inserts.dispose() in addition to strip/engine', () => {
  const map = new LaneResourceMap();
  const stripDispose  = vi.fn();
  const engineDispose = vi.fn();
  const insertsDispose = vi.fn();
  const fakeInserts = { dispose: insertsDispose } as unknown as InsertChain;
  map.set('lane-1', {
    strip:   { dispose: stripDispose }  as unknown as ChannelStrip,
    engine:  { dispose: engineDispose } as unknown as SynthEngine,
    inserts: fakeInserts,
  });
  map.dispose('lane-1');
  expect(stripDispose).toHaveBeenCalledOnce();
  expect(engineDispose).toHaveBeenCalledOnce();
  expect(insertsDispose).toHaveBeenCalledOnce();
});
```

Run `npx vitest run src/core/lane-resources.test.ts` and confirm it FAILS (today `LaneResources` has no `inserts` field and `dispose` doesn't call it). Only then proceed to Step 1.

- [ ] **Step 1: Extend `LaneResources`**

In [src/core/lane-resources.ts](src/core/lane-resources.ts):

```ts
import type { InsertChain } from '../plugins/fx/insert-chain';

export interface LaneResources {
  strip:   ChannelStrip;
  engine:  SynthEngine;
  inserts: InsertChain;
}
```

Update `LaneResourceMap.set` to dispose `existing.inserts` whenever a lane is replaced. Update `dispose(laneId)` to call `inserts.dispose()` alongside `strip.dispose()` / `engine.dispose()`.

- [ ] **Step 2: Expose `InsertChain.inputNode`**

In [src/plugins/fx/insert-chain.ts](src/plugins/fx/insert-chain.ts), add a getter so `ensureLaneResource` can hand the chain's input to `engine.createVoice`:

```ts
get inputNode(): AudioNode { return this.input; }
```

Update `src/plugins/fx/insert-chain.test.ts` with an assertion:

```ts
it('exposes inputNode for upstream wiring', () => {
  const input = new FakeNode();
  const output = new FakeNode();
  const chain = new InsertChain(input as any, output as any);
  expect(chain.inputNode).toBe(input);
});
```

- [ ] **Step 3: Verify (intermediate)**

```bash
npx tsc --noEmit
```

Compilation fails inside `lane-allocator.ts` because `LaneResources` now requires `inserts`. Fixed by Task 26.

- [ ] **Step 4: Defer commit to Task 26.**

---

### Task 26: `ensureLaneResource` builds and wires the lane `InsertChain` uniformly

**Files:** modify `src/app/lane-allocator.ts`.

After Phase G, `ensureLaneResource` is the sole allocation path. This task splices an `InsertChain` between `engine.createVoice` output and `strip.input` for every lane. No special case — Task 22 already removed the boot-lane fallbacks.

- [ ] **Step 0: Write the failing integration test FIRST (TDD)**

Before any implementation, add a failing test to `src/app/lane-allocator.test.ts` that asserts the per-lane `InsertChain` is wired between the voice and the strip:

```ts
it('routes engine.createVoice output through the lane InsertChain', () => {
  const lanes = createLaneAllocator({ /* …same fixture as Task 24… */ });
  lanes.ensureLaneResource('tb-303-1', 'tb303');
  const res = lanes.resources.get('tb-303-1')!;

  // The chain has an input and an output node; verify they exist and the
  // output is wired to strip.input.
  expect(res.inserts).toBeDefined();
  expect(res.inserts.inputNode).toBeDefined();

  // Insert a tracking mock FX into the chain.
  const mockFx: FxInstance = makeTrackingFxMock();
  res.inserts.insert(mockFx);

  // Trigger a voice; the audio path must pass through the chain.
  const voice = lanes.ensureLaneVoice('tb-303-1');
  voice.trigger(0, 60, 1);

  // Assert the mock FX saw an upstream connection (i.e. the voice connected
  // to inserts.inputNode, not directly to strip.input).
  expect(mockFx.upstreamConnectCount).toBeGreaterThan(0);
});
```

Run `npx vitest run src/app/lane-allocator.test.ts` and confirm it FAILS (today `LaneResources` has no `inserts` field and `createVoice` connects directly to `strip.input`). Only then proceed to Step 1.

- [ ] **Step 1: Wire the chain inside `ensureLaneResource`**

Update the body from Task 22 Step 5:

```ts
import { InsertChain } from '../plugins/fx/insert-chain';

const ensureLaneResource = (laneId: string, engineId: string): void => {
  if (resources.get(laneId)) return;
  const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx,
    { sidechain: { bus: deps.sidechainBus, id: laneId, label: laneId.toUpperCase() } });
  // The chain's input is a fresh GainNode (unconnected initially); engine.createVoice
  // (or PolySynth / DrumsEngine setOutputTarget) connects upstream to inserts.inputNode.
  // The chain's output is wired to strip.input. Final signal path:
  //   voice → inserts.inputNode → [chain] → strip.input → strip → master.
  const inserts = new InsertChain(deps.ctx.createGain(), strip.input);

  const engine = createEngineInstance(engineId);
  if (!engine) return;

  if (engineId === 'subtractive') {
    // PolySynth output → insert chain → strip.
    const p = new PolySynth(deps.ctx, inserts.inputNode);
    p.bpm = deps.getBpm();
    (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
  }
  if (engineId === 'drums-machine') {
    (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
    (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
    // DrumsEngine routes drum voices into busStrip directly today; replace with
    // chain.inputNode by passing inserts.inputNode to setBusStripOutput or
    // re-targeting drum voices in DrumsEngine.createVoice (see step 2).
  }
  // For tb303 + other voice-based engines, the wiring is via createVoice's
  // `output` argument — handled by ensureLaneVoice below using inserts.inputNode.

  resources.set(laneId, { strip, engine, inserts });
};
```

- [ ] **Step 2: Redirect `ensureLaneVoice` to the chain input**

[src/app/lane-allocator.ts:119](src/app/lane-allocator.ts#L119) currently calls `engine.createVoice(deps.ctx, strip.input)`. Change to `inserts.inputNode`:

```ts
const ensureLaneVoice = (laneId: string): Voice => {
  const res = resources.get(laneId);
  if (!res) throw new Error(`ensureLaneVoice: no resource for "${laneId}"`);
  const voice = res.engine.createVoice(deps.ctx, res.inserts.inputNode);
  return voice;
};
```

- [ ] **Step 3: Handle drums-machine voice routing**

`DrumsEngine` today connects each drum voice (kick/snare/hat/...) directly to `busStrip.input`. After this task, drum voices must connect to `inserts.inputNode` so the lane insert chain processes them.

Either:
- Pass `inserts.inputNode` to `DrumsEngine` via a new `setOutputTarget(node)` method, called inside `ensureLaneResource`, OR
- Refactor `DrumsEngine.createVoice` to take an `output` argument like the other engines.

Use the `setOutputTarget` approach for minimal blast radius:

```ts
// In src/engines/drums-engine.ts
setOutputTarget(node: AudioNode): void { this.outputTarget = node; }
// Inside createVoice, connect each drum voice to this.outputTarget instead of this.busStrip.input.
```

```ts
// In lane-allocator.ts ensureLaneResource, drums-machine branch:
(engine as unknown as { setOutputTarget?(n: AudioNode): void }).setOutputTarget?.(inserts.inputNode);
```

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: every lane plays through its (empty) insert chain. No audible difference yet.

- [ ] **Step 5: Commit Phase H Tasks 25–26**

```bash
git add src/core/lane-resources.ts src/plugins/fx/insert-chain.ts src/plugins/fx/insert-chain.test.ts src/app/lane-allocator.ts src/engines/drums-engine.ts
git commit -m "feat(plugins): per-lane InsertChain wired uniformly for every lane"
```

---

### Task 27: Lane inspector mounts the insert panel for ALL lanes

**Files:** modify `src/session/session-inspector.ts`.

Because Phase G + Task 26 give every lane a wired `InsertChain` with no carve-out, the inspector mounts `buildLaneInsertUI` for every active lane unconditionally.

- [ ] **Step 1: Hook into the inspector**

Find where the inspector renders the active lane. Add a section "Inserts" that always calls:

```ts
const laneRes = laneAllocator.resources.get(activeLaneId);
const sessionLane = sessionState.lanes.find((l) => l.id === activeLaneId);
if (laneRes && sessionLane) {
  sessionLane.inserts ??= [];
  const insertsPanel = document.createElement('div');
  insertsPanel.className = 'lane-inserts';
  buildLaneInsertUI({
    ctx,
    container: insertsPanel,
    chain: laneRes.inserts,
    slots: sessionLane.inserts,
    onChange: () => deps.saveSession?.(),
  });
  inspectorBody.appendChild(insertsPanel);
}
```

No boot-lane branch, no "added via +" notice — every lane gets the full UI.

- [ ] **Step 2: Verify**

Browser: click on any lane in the inspector (TB-303 1, Drums 1, Sub 1, or any added lane) → see the "+ Add insert" panel. Add a Filter to TB-303 1, drag freq, hear the sweep on the TB-303 only.

- [ ] **Step 3: Commit**

```bash
git add src/session/session-inspector.ts
git commit -m "feat(plugins): lane inspector mounts insert-chain panel for all lanes"
```

---

## Phase I — Persistence

### Task 28: SessionLane.inserts + SessionState.masterInserts

**Files:** modify `src/session/session.ts`, `src/save/saved-state-v3.ts`.

`SavedStateV3.schemaVersion` stays at 3 — these are additive optional fields and old saves missing them default to `[]` at load.

- [ ] **Step 1: Extend the types**

In [src/session/session.ts](src/session/session.ts):

```ts
import type { InsertSlot } from './insert-slot';

export interface SessionLane {
  id: string;
  engineId: string;
  name?: string;
  clips: (SessionClip | null)[];
  launchQuantize?: LaunchQuantize;
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
  };
  enginePresetName?: string;
  inserts?: InsertSlot[];           // NEW
}

export interface SessionState {
  lanes: SessionLane[];
  scenes: SessionScene[];
  globalQuantize: LaunchQuantize;
  masterInserts?: InsertSlot[];     // NEW
}
```

- [ ] **Step 2: Normalize on load**

In [src/save/saved-state-v3.ts](src/save/saved-state-v3.ts) `applyLoadedStateV3`, after restoring `sessionState`:

```ts
if (s.sessionState) {
  s.sessionState.masterInserts ??= [];
  for (const lane of s.sessionState.lanes) lane.inserts ??= [];
}
```

- [ ] **Step 3: Write the snapshot path**

When `lane-insert-ui` calls `onChange`, the session host's `saveSession` already writes the current `sessionState`. Adding `inserts` to `SessionLane` automatically flows through `getStateForSave()` because that path uses structural cloning. Verify by reading [src/session/session-host.ts](src/session/session-host.ts) `getStateForSave()` — if it filters fields, add `inserts` to the allowlist.

- [ ] **Step 4: Apply on rehydrate**

When a save is loaded, `lane.inserts[]` needs to be replayed onto the lane's `InsertChain`.

**TDD: write the failing round-trip test first** in `src/session/insert-slot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InsertChain } from '../plugins/fx/insert-chain';
import { applyInsertSlot, captureInsertSlot, rehydrateInsertChain } from './insert-slot';
import type { InsertSlot } from './insert-slot';
import { createInstance } from '../plugins/registry';

describe('insert-slot rehydration', () => {
  it('round-trips a multifilter slot through snapshot and rehydrate', () => {
    const ctx = new AudioContext();
    const sourceChain = new InsertChain(ctx.createGain(), ctx.createGain());
    const inst = createInstance('fx', 'multifilter', ctx)!;
    inst.setBaseValue('freq', 800);
    inst.setBaseValue('q', 5);
    sourceChain.insert(inst);
    const slot: InsertSlot = captureInsertSlot(sourceChain.list()[0]);
    slot.bypass = false;

    const freshChain = new InsertChain(ctx.createGain(), ctx.createGain());
    rehydrateInsertChain(ctx, freshChain, [slot]);

    expect(freshChain.size()).toBe(1);
    const restored = freshChain.list()[0];
    expect(restored.fx.getBaseValue('freq')).toBe(800);
    expect(restored.fx.getBaseValue('q')).toBe(5);
    expect(restored.bypass).toBe(false);
  });
});
```

Run `npx vitest run src/session/insert-slot.test.ts` and confirm it FAILS (today `rehydrateInsertChain` does not exist). Only then implement the helper:

Add a helper in [src/session/insert-slot.ts](src/session/insert-slot.ts):

```ts
import { createInstance } from '../plugins/registry';
import { listPlugins } from '../plugins/registry';
import type { InsertChain } from '../plugins/fx/insert-chain';

export function rehydrateInsertChain(
  ctx: AudioContext, chain: InsertChain, slots: InsertSlot[],
): void {
  for (const slot of slots) {
    const inst = createInstance('fx', slot.pluginId, ctx);
    if (!inst) continue;
    applyInsertSlot(slot, inst);
    chain.insert(inst);
    if (slot.bypass) chain.setBypass(chain.size() - 1, true);
  }
}
```

In the load path (wherever `LaneResources` are rebuilt from session state), call `rehydrateInsertChain` for each lane's chain. Same for `masterInsertChain`.

- [ ] **Step 5: Test**

Add a tiny round-trip test in [src/session/insert-slot.test.ts](src/session/insert-slot.test.ts) that builds a fake AudioContext, a chain with a slot, snapshots, then rehydrates into a fresh chain and asserts param values are restored.

- [ ] **Step 6: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: add a lane, add a Filter to its chain, set freq=500, save, reload → freq=500 after load.

- [ ] **Step 7: Commit**

```bash
git add src/session/session.ts src/session/insert-slot.ts src/session/insert-slot.test.ts src/save/saved-state-v3.ts src/session/session-host.ts
git commit -m "feat(plugins): persist lane and master inserts in SavedStateV3"
```

---

## Phase J — Modulators as plugins + cross-kind destinations

### Task 29: LFO plugin

**Files:** create `src/plugins/modulators/lfo.ts`; modify `src/app/plugin-bootstrap.ts`.

Wraps the existing [LFOVoice](src/modulation/lfo-voice.ts) as a `ModulatorInstance`.

- [ ] **Step 1: Write the plugin**

```ts
// src/plugins/modulators/lfo.ts
import { LFOVoice } from '../../modulation/lfo-voice';
import { makeDefaultLFO } from '../../modulation/types';
import type { ModulatorInstance, PluginFactory } from '../types';

export const lfoPlugin: PluginFactory = {
  kind: 'modulator',
  manifest: {
    id: 'lfo',
    name: 'LFO',
    kind: 'modulator',
    version: '1.0.0',
    params: [],
    presets: [],
  },
  create(ctx, bpm): ModulatorInstance {
    const state = makeDefaultLFO('lfo-tmp');
    const voice = new LFOVoice(ctx, state, () => bpm);
    return {
      output: voice.output,
      getAudioParams: () => new Map(),
      getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {},
      trigger: (t, o) => voice.trigger(t, o),
      release: (t)    => voice.release(t),
      dispose: ()     => voice.dispose(),
    };
  },
};
```

- [ ] **Step 2: Register in bootstrap.**
- [ ] **Step 3: Verify build.**
- [ ] **Step 4: Commit:** `feat(plugins): lfo modulator plugin`.

### Task 30: ADSR plugin

**Files:** create `src/plugins/modulators/adsr.ts`; modify `src/app/plugin-bootstrap.ts`.

Same shape as Task 29, wrapping `ADSRVoice`. Use `makeDefaultADSR('adsr-tmp')`.

- [ ] Write the plugin.
- [ ] Register in bootstrap.
- [ ] Verify.
- [ ] Commit: `feat(plugins): adsr modulator plugin`.

### Task 31: Modulation host consults the registry

**Files:** modify `src/modulation/modulation-host.ts`, `src/modulation/types.ts`.

The host today directly constructs `LFOVoice` or `ADSRVoice` based on `m.kind`. After this task it uses `createInstance('modulator', m.kind, ctx, bpm())` first, falling back to the direct constructor for backward compat.

- [ ] **Step 1: Widen `ModulatorKind`**

In [src/modulation/types.ts:4](src/modulation/types.ts#L4):

```ts
export type ModulatorKind = string;
```

The two callers of `makeDefaultLFO`/`makeDefaultADSR` still pass `'lfo'`/`'adsr'` literals — no behavior change.

- [ ] **Step 2: Patch the host's spawn path**

In [src/modulation/modulation-host.ts](src/modulation/modulation-host.ts) (around line 63 today):

```ts
import { createInstance } from '../plugins/registry';

// inside spawnVoice / spawnVoiceFiltered:
const inst = createInstance('modulator', m.kind, ctx, bpm());
if (inst) {
  out.set(m.id, modulatorInstanceAsVoice(inst, m));
  continue;
}
// fallback (kept until UI is fully on the registry):
out.set(m.id, m.kind === 'lfo'
  ? new LFOVoice(ctx, m, bpm)
  : new ADSRVoice(ctx, m));
```

`modulatorInstanceAsVoice` is a tiny shim exposing `ModulatorVoice` ({ output, trigger, release, dispose, currentValue }):

```ts
function modulatorInstanceAsVoice(inst: ModulatorInstance, m: ModulatorState): ModulatorVoice {
  return {
    output: inst.output,
    trigger: (t, o) => inst.trigger?.(t, o),
    release: (t)    => inst.release?.(t),
    dispose: ()     => inst.dispose(),
    currentValue: () => 0,
  };
}
```

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: open modulation panel, add an LFO, route to TB-303 filter cutoff, hear modulation. Same for ADSR with envelope.

- [ ] **Step 4: Commit**

```bash
git add src/modulation/types.ts src/modulation/modulation-host.ts
git commit -m "feat(plugins): modulation host spawns modulator voices via registry"
```

---

### Task 32: Modulation destinations include FX params

**Files:** modify `src/modulation/modulation-ui.ts` (and the host helper that builds the destination map, if separate).

Today the destination dropdown lists params from the active lane's engine. Extension: also include the params of every FX in the lane's `InsertChain` and the master's `MasterInsertChain`. Keys are namespaced so they don't collide with engine params.

- [ ] **Step 1: Extend the destination map**

Where the modulation UI builds the per-lane destination map, append:

```ts
const laneRes = laneAllocator.resources.get(activeLaneId);
laneRes?.inserts.list().forEach((cs, idx) => {
  for (const [paramId, ap] of cs.fx.getAudioParams()) {
    dest.set(`lane-insert-${idx}:${paramId}`, ap);
  }
});
graph.masterInsertChain.list().forEach((cs, idx) => {
  for (const [paramId, ap] of cs.fx.getAudioParams()) {
    dest.set(`master-insert-${idx}:${paramId}`, ap);
  }
});
```

These keys end up serialized in `ModulationConnection.paramId`. Their format is stable enough for phase 1; phase 2 may revisit if user-friendly persistence is desired.

- [ ] **Step 2: Group in the dropdown UI**

Three optgroups: "Engine" (existing), "Lane FX" (new), "Master FX" (new). Empty groups are hidden.

- [ ] **Step 3: Verify**

Browser: add a multifilter insert to a new lane, open modulation panel, add an LFO, see "Lane FX → freq" as a destination, route it, hear the filter sweep.

- [ ] **Step 4: Commit**

```bash
git add src/modulation/modulation-ui.ts
git commit -m "feat(plugins): modulation destinations include lane + master FX params"
```

---

## Phase K — Wrap-up

### Task 33: Final regression sweep

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: all green. If any test fails, fix the regression and recommit before the rebase.

- [ ] **Step 2: Browser smoke**

Boot the app, exercise:
- All three boot lanes play (TB-303, drums, subtractive).
- Add a Subtractive lane via `+`. Add a Filter insert, drag freq, hear the sweep.
- Add a Distortion insert after the filter, hear chained processing. Reorder, bypass, remove.
- Modulate the filter's freq from an LFO routed via the modulation panel.
- Save the session. Reload the browser. Confirm inserts and modulation routing survive.
- Open Master FX. Confirm the "+ Add insert" panel is there (replaces the old `FilterChain` UI). Add a master multifilter, hear it.

- [ ] **Step 3: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(plugins): regression fixes from end-of-phase sweep"
```

### Task 34: Rebase onto main, merge back

Per user convention (worktree + rebase before merge).

- [ ] **Step 1: Rebase**

Inside the worktree:

```bash
git fetch origin main
git rebase origin/main
```

Resolve conflicts as they arise. Likely zero conflicts because the plan touches new files mostly and additive fields in `session.ts` / `saved-state-v3.ts`.

- [ ] **Step 2: Verify post-rebase**

```bash
npm test
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Merge back to main**

From the main worktree (NOT the feature worktree):

```bash
git checkout main
git merge --no-ff feat/plugin-system
```

(No fast-forward keeps the feature history visible.)

- [ ] **Step 4: Clean up the worktree**

Use the worktree skill's teardown OR:

```bash
git worktree remove <feature worktree path>
git branch -d feat/plugin-system
```

- [ ] **Step 5: Final verification on main**

```bash
npm test
npm run build
```

Plus one last browser smoke test on main.

---

## Self-review

Spec coverage:

- Plugin SPI (types, manifest, factory) → Task 1.
- Kind-discriminated registry + typed create → Task 2.
- Explicit `bootstrapPlugins()` replacing side-effect imports → Tasks 3, 4, 5 (initial via adapter), Tasks 6–11 (per-engine native exports), Task 12 (adapter retired).
- `InsertChain` (generic, bypass, reorder) → Task 13.
- FX plugins (multifilter, distortion, reverb, delay) → Tasks 14, 15, 16, 17.
- Master `InsertChain` replaces `FilterChain` in `audio-graph.ts` → Task 18.
- Shared insert UI panel → Task 19; mounted on master in Task 19, on lane inspector in Task 27.
- Boot-allocation collapse — `audio-graph.ts` master-only, `ensureLaneResource` is the sole allocation path, legacy configurators deleted, latent drums-shared-fx bug fixed, boot session JSON self-configures every lane → Tasks 20, 21, 22, 23, 24.
- Per-lane `InsertChain` inside `LaneResources` — uniform for all lanes, no boot-lane special case (Phase G removed the asymmetry) → Tasks 25, 26, 27.
- Persistence (`SessionLane.inserts`, `SessionState.masterInserts`) → Task 28.
- Modulator plugins (LFO, ADSR) → Tasks 29, 30.
- Modulation host reads from registry → Task 31.
- Modulation destinations include FX params (parity across lane + master) → Task 32.
- Final regression sweep + rebase + merge → Tasks 33, 34.

Out-of-scope (deferred to phase 2, matches the spec):
- Runtime / dynamic plugin loading.
- `FxBus` internal refactor to use `reverbPlugin` / `delayPlugin` (they're registered but `FxBus` still uses inline DSP).
- Per-voice insert chains.
- Retirement of `src/engines/registry.ts` — `lane-allocator.ts` still consumes `createEngineInstance`.
- Preset population for FX plugins.

Type consistency check: `PluginManifest`, `PluginFactory`, `SynthInstance`, `FxInstance`, `ModulatorInstance`, `InsertSlot`, `InsertChain`, `InsertChain.inputNode`, `LaneResources.inserts`, `LaneAllocatorDeps` (shrunken to `{ ctx, master, fx, sidechainBus, getBpm, extraIds }`), `AudioGraph` (master-only: `{ ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus }`), `createInstance`, `applyInsertSlot`, `snapshotInsertSlot`, `rehydrateInsertChain`, `buildLaneInsertUI`, `bootstrapPlugins`, `ensureLaneResource` (sole allocation path) — names are consistent across tasks.

Phase 0 establishes the worktree per the `superpowers:using-git-worktrees` skill, and Task 34 closes the loop with rebase + merge.
