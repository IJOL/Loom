# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. All work runs in a git worktree allocated in Phase 0. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify how synth engines, insert FX, and modulators are declared and registered. Single SPI (`PluginManifest` + kind-discriminated `PluginFactory`), explicit `bootstrapPlugins()` replacing side-effect imports, master + per-lane insert chains, modulators discovered via the registry. Phase 2 (runtime loading from URL/file) explicitly deferred.

**Architecture:** New `src/plugins/` module owns the SPI. Existing engines migrate via a temporary adapter so the cutover is incremental — one engine per commit. Master `FilterChain` in [src/app/audio-graph.ts](src/app/audio-graph.ts) is replaced by a generic `InsertChain` containing a `multifilter` plugin. `LaneResources` in [src/core/lane-resources.ts](src/core/lane-resources.ts) gains an `inserts: InsertChain` field. Persistence: `SessionLane.inserts` and `SessionState.masterInserts` added as optional fields (default `[]` for old v3 saves — no schema bump).

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
7. **`SaveManager`'s `SavedStateV3.sessionState` carries the new fields** as optional adds. No schemaVersion bump.

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
| `src/engines/tb303.ts` | modify | Add `export const tb303Plugin: PluginFactory`; keep `tb303Engine` singleton export (still used by `audio-graph.ts`) |
| `src/engines/subtractive.ts` | modify | Add `export const subtractivePlugin: PluginFactory` — must create fresh `SubtractiveEngine` since the singleton was dropped |
| `src/engines/fm.ts` | modify | Add `export const fmPlugin` |
| `src/engines/wavetable.ts` | modify | Add `export const wavetablePlugin` |
| `src/engines/karplus.ts` | modify | Add `export const karplusPlugin` |
| `src/engines/drums-engine.ts` | modify | Add `export const drumsPlugin` |
| `src/main.ts` | modify | Remove the six bare `import './engines/xxx'` side-effect lines; call `bootstrapPlugins()` once before `createAudioGraph()` |
| `src/app/audio-graph.ts` | modify | Replace `FilterChain` with `InsertChain`; expose it as `masterInsertChain` on the `AudioGraph` |
| `src/core/fx.ts` | modify | `FilterChain` becomes internal to the `multifilter` plugin (the existing class can remain dead-code or be deleted after Phase F is done) |
| `src/core/fx-ui.ts` | modify | Master FX UI section that drove `FilterChain` calls `buildLaneInsertUI` against `masterInsertChain` + `sessionState.masterInserts` |
| `src/core/lane-resources.ts` | modify | `LaneResources` gains `inserts: InsertChain`; map dispose path disposes inserts too |
| `src/app/lane-allocator.ts` | modify | `ensureLaneResource` builds the lane insert chain at allocation, splices it between `voice/engine.createVoice` output and `strip.input` |
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

**Files:** modify `src/app/audio-graph.ts`.

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

## Phase G — Per-lane InsertChain

### Task 20: LaneResources gains `inserts`

**Files:** modify `src/core/lane-resources.ts`.

- [ ] **Step 1: Extend the interface**

```ts
// src/core/lane-resources.ts
import type { InsertChain } from '../plugins/fx/insert-chain';

export interface LaneResources {
  strip:   ChannelStrip;
  engine:  SynthEngine;
  inserts: InsertChain;
}
```

Update `LaneResourceMap.set` to dispose `existing.inserts` along with strip + engine. Update `dispose(laneId)` likewise.

- [ ] **Step 2: Update the test** in `src/core/lane-resources.test.ts` if it asserts the shape; add a passing assertion that `inserts.size()` is callable.

- [ ] **Step 3: Verify** — `tsc` will fail in every caller that constructs `LaneResources` without `inserts`. That's expected; Task 21 fixes the callers.

- [ ] **Step 4: Commit (deferred — Phase G tasks land together in Task 21's commit, since the intermediate state doesn't compile).**

Actually: amending the type ALONE breaks the build. Either combine Task 20 + 21 in one commit or land them together. Recommended: keep them as separate edits in a single working session, run verification only after Task 21, commit once with both changes.

### Task 21: lane-allocator builds and wires the lane InsertChain

**Files:** modify `src/app/lane-allocator.ts`.

Today the lane voice connects directly to `strip.input` ([src/app/lane-allocator.ts:119](src/app/lane-allocator.ts#L119) `const voice = engine.createVoice(deps.ctx, strip.input);`). After this task, an `InsertChain` sits between them: `voice → laneInsertIn → InsertChain → strip.input`.

- [ ] **Step 1: Patch `ensureLaneResource` and the boot allocation block**

Inside [src/app/lane-allocator.ts](src/app/lane-allocator.ts), where each `LaneResources` is constructed (lines 48–51 for the three boot lanes; line 73 for `ensureExtraPoly`; line 127–139 for `ensureLaneResource`), insert one `InsertChain` per lane:

```ts
import { InsertChain } from '../plugins/fx/insert-chain';

// Per LaneResources creation:
const laneInsertIn = deps.ctx.createGain();
const inserts = new InsertChain(laneInsertIn, strip.input);
resources.set(laneId, { strip, engine, inserts });
```

The boot allocations (lines 48–51) use the pre-existing strips (`bassStrip`, `polyStrip`, `drumBusStrip`) — the InsertChain attaches between a NEW `laneInsertIn` gain and `strip.input`. The voice/engine creation point needs to redirect its output target from `strip.input` to `laneInsertIn`.

This requires sourcing the voice's `output` node from somewhere. The voice/engine factories today take `output: AudioNode` as the destination they `.connect()` into during `createVoice`. The simplest change: pass `laneInsertIn` to `createVoice` instead of `strip.input`. So `ensureLaneVoice` at line 119:

```ts
const voice = engine.createVoice(deps.ctx, /* was: strip.input */ resources.get(laneId)!.inserts /* needs to expose its input */ );
```

`InsertChain` needs to expose `input` for this. Add a getter to [src/plugins/fx/insert-chain.ts](src/plugins/fx/insert-chain.ts):

```ts
get inputNode(): AudioNode { return this.input; }
```

Update the test to call `.inputNode`. Then in lane-allocator:

```ts
const voice = engine.createVoice(deps.ctx, resources.get(laneId)!.inserts.inputNode);
```

For the boot lanes (TB-303 / drums / sub-1), the existing voice instances were already created against `strip.input` in [src/app/audio-graph.ts](src/app/audio-graph.ts) (e.g. `new TB303(ctx, bassStrip.input)` at line 51). Two options:

1. Move the existing `TB303` / `DrumMachine` / `PolySynth` allocation point from `audio-graph.ts` to `lane-allocator.ts` so the insert chain sits in between, OR
2. Leave the legacy three (`bass`, `drums`, `subtractive-1`) connected directly to `strip.input` and only wire the `InsertChain` for new lanes added at runtime.

Option 2 is much smaller. Choose it for phase 1: boot lanes' `inserts` exists in `LaneResources` but its `inputNode` is unwired (no voice connects to it). For consistency, keep `InsertChain` constructed but pass-through (no slots) so removing/adding inserts on the boot lanes is a follow-up. **Document this limitation in code comments.**

Actually — for the goal of "per-lane inserts" to be useful, the three boot lanes need real wiring too. Better choice: redo audio-graph.ts boot to NOT pre-create voices, and let `lane-allocator.ts`'s `ensureLaneResource` be the only path. That's a larger surgery. Trade-off acceptable for phase 1?

**Decision for phase 1:** option 2 (limit per-lane inserts to lanes added via the `+` button). The three boot lanes get an `inserts` field but it's not wired into their audio path. This trade-off is documented in the lane-allocator code and surfaced in the lane inspector (the "Inserts" section is hidden for boot lanes). Phase 2 cleans this up alongside the audio-graph restructure.

- [ ] **Step 2: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: add a new Subtractive lane via `+`; the new lane's audio passes through its insert chain (currently empty). Existing three boot lanes unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/core/lane-resources.ts src/plugins/fx/insert-chain.ts src/app/lane-allocator.ts
git commit -m "feat(plugins): per-lane InsertChain in LaneResources (added lanes only)"
```

---

### Task 22: Lane inspector mounts the insert panel

**Files:** modify `src/session/session-inspector.ts`.

- [ ] **Step 1: Hook into the inspector**

Find where the inspector renders the active lane. Add a section "Inserts" that, for non-boot lanes (lanes whose id is NOT in `['tb-303-1', 'drums-1', 'subtractive-1']`), calls `buildLaneInsertUI` against `LaneResources.inserts` and `lane.inserts`. For boot lanes, render a small notice "Inserts available on lanes added via +" (phase-1 limitation).

The active lane → its `LaneResources` lookup: the session host already exposes lane allocator state via deps. Look for `getLaneAllocator()` or similar in [src/session/session-host.ts](src/session/session-host.ts).

- [ ] **Step 2: Verify**

Browser: click on TB-303 1 in lane inspector → see "Inserts available on lanes added via +". Add a Subtractive lane via `+`, switch to it, see the "+ Add insert" button. Add a Filter, drag knob, hear the filter on that lane only.

- [ ] **Step 3: Commit**

```bash
git add src/session/session-inspector.ts
git commit -m "feat(plugins): lane inspector mounts insert-chain panel"
```

---

## Phase H — Persistence

### Task 23: SessionLane.inserts + SessionState.masterInserts

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

When a save is loaded, `lane.inserts[]` needs to be replayed onto the lane's `InsertChain`. Add a helper in [src/session/insert-slot.ts](src/session/insert-slot.ts):

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

## Phase I — Modulators as plugins + cross-kind destinations

### Task 24: LFO plugin

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

### Task 25: ADSR plugin

**Files:** create `src/plugins/modulators/adsr.ts`; modify `src/app/plugin-bootstrap.ts`.

Same shape as Task 24, wrapping `ADSRVoice`. Use `makeDefaultADSR('adsr-tmp')`.

- [ ] Write the plugin.
- [ ] Register in bootstrap.
- [ ] Verify.
- [ ] Commit: `feat(plugins): adsr modulator plugin`.

### Task 26: Modulation host consults the registry

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

### Task 27: Modulation destinations include FX params

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

## Phase J — Wrap-up

### Task 28: Final regression sweep

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

### Task 29: Rebase onto main, merge back

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
- Master InsertChain replaces FilterChain in `audio-graph.ts` → Task 18.
- Shared insert UI panel → Task 19; mounted on master in Task 19, on lane inspector in Task 22.
- Per-lane InsertChain inside `LaneResources` → Tasks 20, 21.
- Persistence (`SessionLane.inserts`, `SessionState.masterInserts`) → Task 23.
- Modulator plugins (LFO, ADSR) → Tasks 24, 25.
- Modulation host reads from registry → Task 26.
- Modulation destinations include FX params (paridad total) → Task 27.
- Final regression sweep + rebase + merge → Tasks 28, 29.

Out-of-scope (deferred to phase 2, matches the spec):
- Runtime / dynamic plugin loading.
- FxBus internal refactor to use `reverbPlugin` / `delayPlugin` (they're registered but FxBus still uses inline DSP).
- Per-voice insert chains.
- Per-lane inserts on the three boot lanes (`tb-303-1`, `drums-1`, `subtractive-1`) — limitation documented at Task 21.
- Retirement of `src/engines/registry.ts` — `audio-graph.ts` still consumes `getEngine`.
- Distortion/preset population for FX plugins.

Type consistency check: `PluginManifest`, `PluginFactory`, `SynthInstance`, `FxInstance`, `ModulatorInstance`, `InsertSlot`, `InsertChain`, `LaneResources.inserts`, `createInstance`, `applyInsertSlot`, `snapshotInsertSlot`, `rehydrateInsertChain`, `buildLaneInsertUI`, `bootstrapPlugins` — names are consistent across tasks.

Phase 0 establishes the worktree per the `superpowers:using-git-worktrees` skill, and Task 29 closes the loop with rebase + merge.
