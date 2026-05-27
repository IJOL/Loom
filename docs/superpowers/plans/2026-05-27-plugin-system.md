# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc engine registry + hardcoded FX/modulator wiring with one unified plugin SPI covering synth engines, insert FX, and modulators. Same manifest shape for all three, explicit `bootstrapPlugins()` replacing side-effect imports, master + per-lane insert chains, and modulators discovered through the registry.

**Architecture:** New `src/plugins/` module owns the shared SPI (`PluginManifest`, `PluginFactory`, kind-specific instance interfaces). Existing engines migrate via a temporary adapter so the cutover is incremental — one engine per commit. FX gains a generic `InsertChain` class used in master and per-lane positions. Modulator host loses its hardcoded `'lfo' | 'adsr'` switch and reads sources from the registry.

**Tech Stack:** TypeScript strict, Web Audio API, Vite, Vitest (node env — pure tests only).

**Spec:** [docs/superpowers/specs/2026-05-27-plugin-system-design.md](../specs/2026-05-27-plugin-system-design.md)

---

## File map

| File | Status | Purpose |
|---|---|---|
| `src/plugins/types.ts` | create | `PluginKind`, `PluginManifest`, `PluginPreset`, `PluginFactory` discriminated union, `SynthInstance`, `FxInstance`, `ModulatorInstance` |
| `src/plugins/types.test.ts` | create | Compile-time tests for the discriminated factory (smoke) |
| `src/plugins/registry.ts` | create | `registerPlugin`, `getPlugin`, `listPlugins`, typed `createInstance` overloads |
| `src/plugins/registry.test.ts` | create | Registry behavior tests |
| `src/plugins/bootstrap.ts` | create | `bootstrapPlugins(extras?)` registering the built-in array |
| `src/plugins/synth-engine-adapter.ts` | create | `synthEngineAsPlugin(engine: SynthEngine): PluginFactory` — temporary bridge |
| `src/plugins/synth-engine-adapter.test.ts` | create | Adapter contract tests |
| `src/plugins/fx/insert-chain.ts` | create | `InsertChain` class — ordered FX list with bypass + reorder + rewire |
| `src/plugins/fx/insert-chain.test.ts` | create | Wiring + bypass + reorder tests (mock AudioContext) |
| `src/plugins/fx/multifilter.ts` | create | `multifilterPlugin` — wraps the existing `FilterChain` semantics as one FX |
| `src/plugins/fx/distortion.ts` | create | `distortionPlugin` — simple WaveShaper-based distortion |
| `src/plugins/fx/reverb.ts` | create | `reverbPlugin` — wraps the convolver chain currently inside `FxBus` |
| `src/plugins/fx/delay.ts` | create | `delayPlugin` — wraps the delay chain currently inside `FxBus` |
| `src/plugins/modulators/lfo.ts` | create | `lfoPlugin` — wraps existing `LFOVoice` |
| `src/plugins/modulators/adsr.ts` | create | `adsrPlugin` — wraps existing `ADSRVoice` |
| `src/session/insert-slot.ts` | create | `InsertSlot` type + (de)serialization helpers |
| `src/session/insert-slot.test.ts` | create | Round-trip tests |
| `src/session/lane-insert-ui.ts` | create | DOM panel for per-lane insert chain — add/remove/reorder/bypass |
| `src/engines/tb303.ts` | modify | Export `tb303Plugin: PluginFactory`; drop side-effect `registerEngine` calls |
| `src/engines/subtractive.ts` | modify | Same migration |
| `src/engines/fm.ts` | modify | Same migration |
| `src/engines/wavetable.ts` | modify | Same migration |
| `src/engines/karplus.ts` | modify | Same migration |
| `src/engines/drums-engine.ts` | modify | Same migration |
| `src/engines/registry.ts` | modify | Reduced to thin re-export wrappers around `src/plugins/registry.ts`; eventually deleted |
| `src/main.ts` | modify | Remove `import './engines/xxx'` side-effects; call `bootstrapPlugins()`; replace `FilterChain` with master `InsertChain` |
| `src/core/fx.ts` | modify | `FilterChain` becomes internal-only to `multifilterPlugin`; `FxBus` keeps reverb/delay routing but delegates DSP to plugin instances |
| `src/core/fx-ui.ts` | modify | Master FX UI uses the same `lane-insert-ui` panel for the master chain |
| `src/session/session.ts` | modify | `SessionLane.inserts: InsertSlot[]`; `SessionState.masterInserts: InsertSlot[]` |
| `src/session/session-migration.ts` | modify | Default missing `inserts` / `masterInserts` to `[]` |
| `src/session/session-host.ts` | modify | Wire per-lane `InsertChain` between `voice.output` and `ChannelStrip.input` |
| `src/modulation/modulation-host.ts` | modify | Discover modulator kinds via `listPlugins('modulator')`; drop `LFOVoice`/`ADSRVoice` imports |
| `src/modulation/modulation-ui.ts` | modify | Destination dropdown groups: engine params + lane FX params + master FX params |
| `src/modulation/types.ts` | modify | `ModulatorKind` becomes `string` (plugin id), not `'lfo' \| 'adsr'` |

---

## Verification pattern

Each task ends with these three checks before commit. Repeat them as Step N+1, N+2, N+3:

```bash
npx vitest run                # all tests pass
npx tsc --noEmit              # no type errors
npm run build                 # production bundle succeeds
```

Manual browser verification (Step N+4) on every task that changes audio routing or UI: open `http://localhost:5173`, trigger the bass lane, confirm sound is unchanged from baseline (or matches expected change for the current task).

---

## Phase A — Plugin SPI scaffolding

### Task 1: Types module

**Files:**
- Create: `src/plugins/types.ts`
- Create: `src/plugins/types.test.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// src/plugins/types.ts
import type { EngineParamSpec } from '../engines/engine-params';
import type { VoiceTriggerOptions } from '../engines/engine-types';
import type { ModulatorState } from '../modulation/types';

export type PluginKind = 'synth' | 'fx' | 'modulator';

export type ParamSpec = EngineParamSpec;   // alias; old name kept for one cycle

export interface PluginPreset {
  name: string;
  params: Record<string, number>;
  modulators?: ModulatorState[];
}

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly kind: PluginKind;
  readonly version: string;
  readonly params: ParamSpec[];
  readonly presets: PluginPreset[];
}

export interface SynthInstance {
  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  getAudioParams(): Map<string, AudioParam>;
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

- [ ] **Step 2: Write a smoke test**

```ts
// src/plugins/types.test.ts
import { describe, it, expect } from 'vitest';
import type { PluginFactory, PluginManifest } from './types';

describe('PluginFactory discriminator', () => {
  it('narrows by kind', () => {
    const m: PluginManifest = {
      id: 'x', name: 'X', kind: 'synth', version: '1.0.0', params: [], presets: [],
    };
    const f: PluginFactory = {
      kind: 'synth', manifest: m,
      create: () => ({} as any),
    };
    expect(f.kind).toBe('synth');
    expect(f.manifest.kind).toBe('synth');
  });
});
```

- [ ] **Step 3: Run tests + typecheck**

```bash
npx vitest run src/plugins/types.test.ts
npx tsc --noEmit
```

Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/types.ts src/plugins/types.test.ts
git commit -m "feat(plugins): plugin SPI type definitions"
```

---

### Task 2: Registry

**Files:**
- Create: `src/plugins/registry.ts`
- Create: `src/plugins/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/plugins/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPlugin, getPlugin, listPlugins, createInstance, _resetRegistry,
} from './registry';
import type { PluginFactory } from './types';

function makeSynth(id: string): PluginFactory {
  return {
    kind: 'synth',
    manifest: { id, name: id, kind: 'synth', version: '1.0.0', params: [], presets: [] },
    create: () => ({ dispose: () => {} } as any),
  };
}

function makeFx(id: string): PluginFactory {
  return {
    kind: 'fx',
    manifest: { id, name: id, kind: 'fx', version: '1.0.0', params: [], presets: [] },
    create: () => ({ dispose: () => {} } as any),
  };
}

describe('plugin registry', () => {
  beforeEach(() => _resetRegistry());

  it('registers and retrieves by (kind,id)', () => {
    const p = makeSynth('tb303');
    registerPlugin(p);
    expect(getPlugin('synth', 'tb303')).toBe(p);
    expect(getPlugin('fx', 'tb303')).toBeUndefined();
  });

  it('listPlugins filters by kind', () => {
    registerPlugin(makeSynth('a'));
    registerPlugin(makeSynth('b'));
    registerPlugin(makeFx('reverb'));
    expect(listPlugins('synth').map((p) => p.manifest.id).sort()).toEqual(['a', 'b']);
    expect(listPlugins('fx').map((p) => p.manifest.id)).toEqual(['reverb']);
    expect(listPlugins().length).toBe(3);
  });

  it('createInstance dispatches by kind', () => {
    const ctx = {} as AudioContext;
    const dest = {} as AudioNode;
    registerPlugin(makeSynth('tb303'));
    const inst = createInstance('synth', 'tb303', ctx, dest);
    expect(inst).toBeDefined();
  });

  it('createInstance returns undefined for unknown id', () => {
    expect(createInstance('synth', 'nope', {} as any, {} as any)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/plugins/registry.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the registry**

```ts
// src/plugins/registry.ts
import type {
  PluginFactory, PluginKind, SynthInstance, FxInstance, ModulatorInstance,
} from './types';

const plugins = new Map<string, PluginFactory>();

function key(kind: PluginKind, id: string): string {
  return `${kind}:${id}`;
}

export function registerPlugin(factory: PluginFactory): void {
  const k = key(factory.kind, factory.manifest.id);
  if (plugins.has(k)) {
    console.warn(`Plugin "${k}" already registered, overwriting.`);
  }
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
export function createInstance(kind: PluginKind, id: string, ctx: AudioContext, arg?: any): any {
  const p = plugins.get(key(kind, id));
  if (!p) return undefined;
  if (p.kind === 'synth')     return p.create(ctx, arg as AudioNode);
  if (p.kind === 'fx')        return p.create(ctx);
  if (p.kind === 'modulator') return p.create(ctx, arg as number);
  return undefined;
}

/** Test-only escape hatch. Do not use in app code. */
export function _resetRegistry(): void {
  plugins.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/plugins/registry.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/registry.ts src/plugins/registry.test.ts
git commit -m "feat(plugins): registry with kind-discriminated create"
```

---

### Task 3: Synth engine adapter

**Files:**
- Create: `src/plugins/synth-engine-adapter.ts`
- Create: `src/plugins/synth-engine-adapter.test.ts`

The adapter lets us register existing `SynthEngine` instances as `PluginFactory` without rewriting them. It's deleted at the end of Phase B.

- [ ] **Step 1: Write the failing test**

```ts
// src/plugins/synth-engine-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { synthEngineAsPlugin } from './synth-engine-adapter';
import type { SynthEngine } from '../engines/engine-types';

const mockEngine: SynthEngine = {
  id: 'mock',
  name: 'Mock',
  type: 'polyhost',
  polyphony: 'mono',
  editor: 'piano-roll',
  params: [],
  presets: [],
  getBaseValue: () => 0,
  setBaseValue: () => {},
  createVoice: () => ({
    trigger: () => {}, release: () => {}, connect: () => {},
    dispose: () => {}, getAudioParams: () => new Map(),
  }),
  buildSequencer: () => ({} as any),
  buildParamUI: () => {},
  applyPreset: () => {},
  dispose: () => {},
};

describe('synthEngineAsPlugin', () => {
  it('produces a synth-kind factory with matching manifest', () => {
    const f = synthEngineAsPlugin(mockEngine);
    expect(f.kind).toBe('synth');
    expect(f.manifest.id).toBe('mock');
    expect(f.manifest.kind).toBe('synth');
    expect(f.manifest.version).toBe('0.0.0-legacy');
  });

  it('create() returns an instance with the voice methods + engine setters', () => {
    const f = synthEngineAsPlugin(mockEngine);
    if (f.kind !== 'synth') throw new Error('wrong kind');
    const inst = f.create({} as AudioContext, {} as AudioNode);
    expect(typeof inst.trigger).toBe('function');
    expect(typeof inst.setBaseValue).toBe('function');
    expect(typeof inst.applyPreset).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/plugins/synth-engine-adapter.test.ts
```

Expected: FAIL (module not found).

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
      presets: engine.presets,
    },
    create(ctx: AudioContext, output: AudioNode): SynthInstance {
      const voice = engine.createVoice(ctx, output);
      return {
        trigger:        (m, t, o) => voice.trigger(m, t, o),
        release:        (t)       => voice.release(t),
        connect:        (d)       => voice.connect(d),
        getAudioParams: ()        => voice.getAudioParams(),
        getBaseValue:   (id)      => engine.getBaseValue(id),
        setBaseValue:   (id, v)   => engine.setBaseValue(id, v),
        applyPreset:    (name)    => engine.applyPreset(name),
        dispose:        ()        => voice.dispose(),
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/plugins/synth-engine-adapter.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/synth-engine-adapter.ts src/plugins/synth-engine-adapter.test.ts
git commit -m "feat(plugins): synth engine → plugin adapter (transitional)"
```

---

### Task 4: Bootstrap (using adapter)

**Files:**
- Create: `src/plugins/bootstrap.ts`
- Modify: `src/main.ts:9-15` (the engine side-effect imports)

- [ ] **Step 1: Write the bootstrap**

```ts
// src/plugins/bootstrap.ts
import { registerPlugin } from './registry';
import { synthEngineAsPlugin } from './synth-engine-adapter';
import type { PluginFactory } from './types';

// Phase B will replace these with native plugin exports.
import { subtractiveEngine } from '../engines/subtractive';
import { wavetableEngine }   from '../engines/wavetable';
import { fmEngine }          from '../engines/fm';
import { karplusEngine }     from '../engines/karplus';
import { tb303Engine }       from '../engines/tb303';
import { drumsEngine }       from '../engines/drums-engine';

export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  const builtin: PluginFactory[] = [
    synthEngineAsPlugin(tb303Engine),
    synthEngineAsPlugin(subtractiveEngine),
    synthEngineAsPlugin(fmEngine),
    synthEngineAsPlugin(wavetableEngine),
    synthEngineAsPlugin(karplusEngine),
    synthEngineAsPlugin(drumsEngine),
  ];
  for (const p of [...builtin, ...extras]) registerPlugin(p);
}
```

- [ ] **Step 2: Wire `bootstrapPlugins()` into [src/main.ts](src/main.ts)**

Find the block of engine side-effect imports (lines around 9–15):

```ts
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import { configureTB303EngineMainInstance, tb303Engine } from './engines/tb303';
// ...
import './engines/drums-engine';
```

Keep the named imports that other code needs (e.g. `configureTB303EngineMainInstance`, `tb303Engine`, `configureDrumsEngineSharedFx`), but remove the bare `import './engines/xxx'` lines.

Add at the top of main.ts:

```ts
import { bootstrapPlugins } from './plugins/bootstrap';
```

And near the very top of the boot sequence (before any code that calls `getEngine` / `createEngineInstance` / `listEngines`):

```ts
bootstrapPlugins();
```

The existing `registerEngine(...)` calls in each engine file still run because the engine files are imported by `bootstrap.ts` (which imports the engine instances by name). Both registries are now populated.

- [ ] **Step 3: Verify build + tests + browser**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Expected: all green. Then open `http://localhost:5173`, play the bass, confirm sound unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/bootstrap.ts src/main.ts
git commit -m "feat(plugins): bootstrap plugins via adapter; remove side-effect imports"
```

---

## Phase B — Migrate synth engines to native plugin exports

Each engine in this phase follows the same shape. Pattern:

1. Add `export const xxxPlugin: PluginFactory = { kind: 'synth', manifest: {...}, create: (ctx, output) => new XxxInstance(ctx, output) }` at the bottom of the engine file.
2. Update `bootstrap.ts` to use `xxxPlugin` instead of `synthEngineAsPlugin(xxxEngine)`.
3. Verify nothing regressed.
4. (Optional cleanup, deferred to Task 11) Remove the legacy `registerEngine(xxxEngine)` / `registerEngineFactory(...)` calls once the legacy registry is removed.

The native plugin export keeps the existing `SynthEngine` class working — `create` simply wraps `engine.createVoice` the same way the adapter does, but now it lives in the engine file itself and can evolve independently from `SynthEngine`.

### Task 5: TB-303 → native plugin

**Files:**
- Modify: `src/engines/tb303.ts:224-226`
- Modify: `src/plugins/bootstrap.ts:14`

- [ ] **Step 1: Add native plugin export to tb303.ts**

At the bottom of [src/engines/tb303.ts](src/engines/tb303.ts), after `export const tb303Engine`, add:

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
    presets: tb303Engine.presets,
  },
  create(ctx, output) {
    const inst = new TB303Engine();
    const voice = inst.createVoice(ctx, output);
    return {
      trigger:        (m, t, o) => voice.trigger(m, t, o),
      release:        (t)       => voice.release(t),
      connect:        (d)       => voice.connect(d),
      getAudioParams: ()        => voice.getAudioParams(),
      getBaseValue:   (id)      => inst.getBaseValue(id),
      setBaseValue:   (id, v)   => inst.setBaseValue(id, v),
      applyPreset:    (name)    => inst.applyPreset(name),
      dispose:        ()        => { voice.dispose(); inst.dispose(); },
    };
  },
};
```

- [ ] **Step 2: Switch bootstrap to use the native plugin**

In [src/plugins/bootstrap.ts](src/plugins/bootstrap.ts), replace:

```ts
import { tb303Engine } from '../engines/tb303';
// …
synthEngineAsPlugin(tb303Engine),
```

with:

```ts
import { tb303Plugin } from '../engines/tb303';
// …
tb303Plugin,
```

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Plus browser smoke test: bass lane plays correctly.

- [ ] **Step 4: Commit**

```bash
git add src/engines/tb303.ts src/plugins/bootstrap.ts
git commit -m "feat(plugins): tb303 exports native plugin"
```

### Task 6: subtractive → native plugin

Same shape as Task 5. File: [src/engines/subtractive.ts](src/engines/subtractive.ts). Export `subtractivePlugin`, swap bootstrap entry, verify.

- [ ] **Step 1: Add export** (mirror Task 5, replacing `tb303` with `subtractive`, `TB303Engine` with `SubtractiveEngine`)
- [ ] **Step 2: Switch bootstrap** to `subtractivePlugin`
- [ ] **Step 3: Verify** — `vitest`, `tsc`, `build`, browser
- [ ] **Step 4: Commit**: `feat(plugins): subtractive exports native plugin`

### Task 7: FM → native plugin

Same shape. File: [src/engines/fm.ts](src/engines/fm.ts). Export `fmPlugin`, swap bootstrap, verify, commit `feat(plugins): fm exports native plugin`.

### Task 8: wavetable → native plugin

File: [src/engines/wavetable.ts](src/engines/wavetable.ts). Export `wavetablePlugin`, swap, verify, commit `feat(plugins): wavetable exports native plugin`.

### Task 9: karplus → native plugin

File: [src/engines/karplus.ts](src/engines/karplus.ts). Export `karplusPlugin`, swap, verify, commit `feat(plugins): karplus exports native plugin`.

### Task 10: drums → native plugin

File: [src/engines/drums-engine.ts](src/engines/drums-engine.ts). Export `drumsPlugin`, swap, verify, commit `feat(plugins): drums exports native plugin`.

### Task 11: Remove adapter

After all six engines have native plugin exports, the adapter is dead code.

**Files:**
- Delete: `src/plugins/synth-engine-adapter.ts`
- Delete: `src/plugins/synth-engine-adapter.test.ts`
- Modify: `src/plugins/bootstrap.ts` (remove the `synthEngineAsPlugin` import — should already be unused)

- [ ] **Step 1: Delete adapter files**

```bash
git rm src/plugins/synth-engine-adapter.ts src/plugins/synth-engine-adapter.test.ts
```

- [ ] **Step 2: Confirm bootstrap.ts no longer imports the adapter**

Open [src/plugins/bootstrap.ts](src/plugins/bootstrap.ts) and remove any residual `synthEngineAsPlugin` reference (there should be none if all 6 tasks above were done).

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(plugins): drop transitional synth engine adapter"
```

**CHECKPOINT — end of Phase B.** All synth engines now flow through the plugin registry. The old engines/registry.ts still exists and is still populated (via the `registerEngine` calls inside each engine file) for the rest of the app that imports from it. Phase E removes those.

---

## Phase C — Insert chain + FX plugins

### Task 12: InsertChain class

**Files:**
- Create: `src/plugins/fx/insert-chain.ts`
- Create: `src/plugins/fx/insert-chain.test.ts`

`InsertChain` owns the ordered list of `FxInstance`s and rewires Web Audio connections when slots are added, removed, reordered, or bypassed. Modeled on the existing [FilterChain](src/core/fx.ts) (`src/core/fx.ts:274`) but generic over any `FxInstance`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/plugins/fx/insert-chain.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InsertChain } from './insert-chain';
import type { FxInstance } from '../types';

class FakeNode {
  connections: FakeNode[] = [];
  connect(dest: any) { this.connections.push(dest); }
  disconnect() { this.connections = []; }
}

function makeFx(id: string): FxInstance {
  const input = new FakeNode();
  const output = new FakeNode();
  input.connect(output);   // pass-through
  return {
    input: input as any,
    output: output as any,
    getAudioParams: () => new Map(),
    getBaseValue: () => 0,
    setBaseValue: () => {},
    applyPreset: () => {},
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

  it('insert at end: input → fx0.input, fx0.output → output', () => {
    const fx = makeFx('a');
    chain.insert(fx);
    expect(input.connections).toContain(fx.input);
    expect((fx.output as any as FakeNode).connections).toContain(output);
  });

  it('two inserts chain serially', () => {
    const a = makeFx('a'); const b = makeFx('b');
    chain.insert(a); chain.insert(b);
    expect(input.connections).toContain(a.input);
    expect((a.output as any as FakeNode).connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(output);
  });

  it('bypass routes around the slot', () => {
    const a = makeFx('a'); const b = makeFx('b');
    chain.insert(a); chain.insert(b);
    chain.setBypass(0, true);
    expect(input.connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(output);
  });

  it('remove disposes and rewires', () => {
    const a = makeFx('a'); const b = makeFx('b');
    let disposed = false;
    a.dispose = () => { disposed = true; };
    chain.insert(a); chain.insert(b);
    chain.remove(0);
    expect(disposed).toBe(true);
    expect(input.connections).toContain(b.input);
  });

  it('reorder swaps and rewires', () => {
    const a = makeFx('a'); const b = makeFx('b');
    chain.insert(a); chain.insert(b);
    chain.reorder(0, 1);
    expect(input.connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(a.input);
    expect((a.output as any as FakeNode).connections).toContain(output);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/plugins/fx/insert-chain.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement InsertChain**

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
    try { this.input.disconnect(); } catch {}
  }

  private rewire(): void {
    try { this.input.disconnect(); } catch {}
    for (const s of this.slots) {
      try { s.fx.output.disconnect(); } catch {}
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/plugins/fx/insert-chain.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/fx/insert-chain.ts src/plugins/fx/insert-chain.test.ts
git commit -m "feat(plugins): generic InsertChain with bypass + reorder"
```

---

### Task 13: multifilter plugin

**Files:**
- Create: `src/plugins/fx/multifilter.ts`
- Modify: `src/core/fx.ts` (keep `MasterFilter` and the per-filter LFO sync; `FilterChain` class stays usable internally)
- Modify: `src/plugins/bootstrap.ts` (register `multifilterPlugin`)

The `multifilter` plugin wraps the existing `FilterChain` semantics (a stack of `MasterFilter` BiquadFilters with optional BPM-synced LFOs). For phase 1 it exposes a single "frequency" param that maps to a representative filter; deeper UI (multiple stacked filters within one plugin) is deferred — the plugin manifest is intentionally simple, and adding more sub-filters becomes a follow-up.

- [ ] **Step 1: Write the plugin**

```ts
// src/plugins/fx/multifilter.ts
import type { FxInstance, PluginFactory } from '../types';

export const multifilterPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'multifilter',
    name: 'Multifilter',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'freq', label: 'Freq',  kind: 'continuous', min: 20,  max: 20000, default: 1000, curve: 'exponential', unit: 'Hz' },
      { id: 'q',    label: 'Q',     kind: 'continuous', min: 0.1, max: 24,    default: 1,    curve: 'exponential' },
      { id: 'type', label: 'Type',  kind: 'discrete',   min: 0,   max: 3,     default: 0,
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
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;

    // pass-through input/output so the chain can wire around bypass
    const input  = ctx.createGain();
    const output = ctx.createGain();
    input.connect(filter).connect(output);

    const params = new Map<string, AudioParam>([
      ['freq', filter.frequency],
      ['q', filter.Q],
    ]);

    let typeIdx = 0;
    const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

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
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); filter.disconnect(); output.disconnect(); } catch {} },
    };
  },
};
```

- [ ] **Step 2: Register in bootstrap**

In [src/plugins/bootstrap.ts](src/plugins/bootstrap.ts):

```ts
import { multifilterPlugin } from './fx/multifilter';
// …
const builtin: PluginFactory[] = [
  // …existing synth plugins
  multifilterPlugin,
];
```

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/plugins/fx/multifilter.ts src/plugins/bootstrap.ts
git commit -m "feat(plugins): multifilter FX plugin"
```

---

### Task 14: distortion plugin

**Files:**
- Create: `src/plugins/fx/distortion.ts`
- Modify: `src/plugins/bootstrap.ts`

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
    name: 'Distortion',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'drive', label: 'Drive', kind: 'continuous', min: 0, max: 1,    default: 0.3 },
      { id: 'mix',   label: 'Mix',   kind: 'continuous', min: 0, max: 1,    default: 1.0 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeCurve(0.3);
    shaper.oversample = '4x';

    const input  = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = 0;
    wet.gain.value = 1;

    input.connect(dry).connect(output);
    input.connect(shaper).connect(wet).connect(output);

    const params = new Map<string, AudioParam>([
      ['mix', wet.gain],
    ]);

    let drive = 0.3;
    let mix = 1.0;

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => (id === 'drive' ? drive : id === 'mix' ? mix : 0),
      setBaseValue: (id, v) => {
        if (id === 'drive') { drive = v; shaper.curve = makeCurve(v); }
        if (id === 'mix')   { mix = v; wet.gain.value = v; dry.gain.value = 1 - v; }
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); shaper.disconnect(); dry.disconnect(); wet.disconnect(); output.disconnect(); } catch {} },
    };
  },
};
```

- [ ] **Step 2: Register in bootstrap** — add `distortionPlugin` to the builtin array.

- [ ] **Step 3: Verify** — `vitest`, `tsc`, `build`.

- [ ] **Step 4: Commit**: `feat(plugins): distortion FX plugin`

---

### Task 15: Master InsertChain replaces FilterChain in main.ts

**Files:**
- Modify: `src/main.ts:96` (the `FilterChain` constructor call)
- Modify: `src/main.ts:419` (the `filterChain.updateBpm` call)
- Modify: `src/main.ts:784,927` (the deps wiring)
- Modify: `src/core/fx-ui.ts:73,168,216` (FX UI deps and add/remove)

The existing `FilterChain` UI keeps working for now — Task 18 swaps it for the generic insert-chain UI. This task just changes the underlying chain to use `InsertChain` with `multifilterPlugin` instances, so adding a filter goes through `createInstance('fx', 'multifilter', ctx)` instead of `new MasterFilter(ctx)`.

- [ ] **Step 1: Introduce a wrapper in `fx-ui.ts` or `main.ts`**

The least-invasive approach: keep `FxUIDeps.filterChain: FilterChain` working by giving `FilterChain` an internal `InsertChain` and delegating `add()` / `remove()` / `updateBpm()` to it.

Open [src/core/fx.ts](src/core/fx.ts) at line 274 and replace the `FilterChain` class with a version backed by `InsertChain` + `multifilterPlugin`:

```ts
import { InsertChain } from '../plugins/fx/insert-chain';
import { createInstance } from '../plugins/registry';
import type { FxInstance } from '../plugins/types';

export class FilterChain {
  private chain: InsertChain;
  filters: { instance: FxInstance; bpm?: number }[] = [];

  constructor(private ctx: AudioContext, input: AudioNode, output: AudioNode) {
    this.chain = new InsertChain(input, output);
  }

  add(): FxInstance {
    const inst = createInstance('fx', 'multifilter', this.ctx);
    if (!inst) throw new Error('multifilter plugin not registered');
    this.filters.push({ instance: inst });
    this.chain.insert(inst);
    return inst;
  }

  remove(target: FxInstance) {
    const idx = this.filters.findIndex((f) => f.instance === target);
    if (idx < 0) return;
    this.filters.splice(idx, 1);
    this.chain.remove(idx);
  }

  updateBpm(bpm: number) {
    for (const f of this.filters) f.instance.setBpm?.(bpm);
  }
}
```

The signature of `FilterChain.add()` and `remove()` now returns `FxInstance` instead of `MasterFilter`. Adapt [src/core/fx-ui.ts](src/core/fx-ui.ts) at lines 168 and 216 to use the new type.

- [ ] **Step 2: Update fx-ui.ts to drive `FxInstance` instead of `MasterFilter`**

In [src/core/fx-ui.ts](src/core/fx-ui.ts), the rows that build per-filter knobs should now read params via `inst.getBaseValue('freq')` / `inst.setBaseValue('freq', v)` instead of reaching into `mf.filter.frequency.value` directly. Each knob in the row maps to one `ParamSpec.id` of the plugin (`freq`, `q`, `type`).

This is a non-trivial UI rework. The minimal version: build the knobs from `multifilterPlugin.manifest.params` using the existing `createKnob` helper, and pass them `getBaseValue` / `setBaseValue` from the instance.

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: add a filter to the master chain, drag the freq knob, confirm audible change. Remove the filter, confirm signal passes through unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/core/fx.ts src/core/fx-ui.ts
git commit -m "feat(plugins): master FilterChain delegates to multifilter plugin via InsertChain"
```

---

### Task 16: reverb + delay plugins (wrap FxBus internals)

**Files:**
- Create: `src/plugins/fx/reverb.ts`
- Create: `src/plugins/fx/delay.ts`
- Modify: `src/core/fx.ts` (`FxBus` delegates DSP to plugin instances; keeps send routing)
- Modify: `src/plugins/bootstrap.ts`

These plugins are registered so their params are uniformly modulatable, but routing stays as global sends (not in any insert chain). `FxBus` creates one `reverbPlugin` instance and one `delayPlugin` instance at construction.

- [ ] **Step 1: Write reverb plugin**

```ts
// src/plugins/fx/reverb.ts
import type { FxInstance, PluginFactory } from '../types';

function makeImpulse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * Math.max(0.05, durationSec));
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
      { id: 'predelay', label: 'Predelay', kind: 'continuous', min: 0,    max: 0.5, default: 0,    unit: 's' },
      { id: 'size',     label: 'Size',     kind: 'continuous', min: 0.05, max: 8,   default: 2.5,  unit: 's' },
      { id: 'decay',    label: 'Decay',    kind: 'continuous', min: 0.1,  max: 10,  default: 3 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    let size = 2.5, decay = 3;
    const input = ctx.createGain();
    const predelay = ctx.createDelay(0.5);
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, size, decay);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    const output = ctx.createGain();
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
        if (id === 'size')     { size = v; conv.buffer = makeImpulse(ctx, size, decay); }
        if (id === 'decay')    { decay = v; conv.buffer = makeImpulse(ctx, size, decay); }
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); predelay.disconnect(); conv.disconnect(); wet.disconnect(); output.disconnect(); } catch {} },
    };
  },
};
```

- [ ] **Step 2: Write delay plugin**

```ts
// src/plugins/fx/delay.ts
import type { FxInstance, PluginFactory } from '../types';

export const delayPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'delay',
    name: 'Delay',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'time',     label: 'Time',     kind: 'continuous', min: 0.01, max: 2,    default: 0.375, unit: 's' },
      { id: 'feedback', label: 'Feedback', kind: 'continuous', min: 0,    max: 0.95, default: 0.45 },
      { id: 'wet',      label: 'Wet',      kind: 'continuous', min: 0,    max: 1.5,  default: 0.8 },
      { id: 'damping',  label: 'Damping',  kind: 'continuous', min: 200,  max: 12000, default: 4500, curve: 'exponential', unit: 'Hz' },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain(); fb.gain.value = 0.45;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 4500;
    const wet = ctx.createGain(); wet.gain.value = 0.8;
    const output = ctx.createGain();

    input.connect(delay);
    delay.connect(damp).connect(fb).connect(delay);
    delay.connect(wet).connect(output);

    const params = new Map<string, AudioParam>([
      ['time', delay.delayTime],
      ['feedback', fb.gain],
      ['wet', wet.gain],
      ['damping', damp.frequency],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => {
        if (id === 'time')     return delay.delayTime.value;
        if (id === 'feedback') return fb.gain.value;
        if (id === 'wet')      return wet.gain.value;
        if (id === 'damping')  return damp.frequency.value;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'time')     delay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01);
        if (id === 'feedback') fb.gain.value = v;
        if (id === 'wet')      wet.gain.value = v;
        if (id === 'damping')  damp.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
      },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); delay.disconnect(); damp.disconnect(); fb.disconnect(); wet.disconnect(); output.disconnect(); } catch {} },
    };
  },
};
```

- [ ] **Step 3: Refactor FxBus to host the plugin instances**

In [src/core/fx.ts](src/core/fx.ts), the existing `FxBus` class internals (convolver, predelay, dly, dlyFeedback, …) are replaced by holding one `reverbPlugin` instance and one `delayPlugin` instance. The public surface (`reverbInput`, `delayInput`, `setReverbWet`, `setDelayFeedback`, etc.) stays unchanged — the setters delegate to `inst.setBaseValue(id, v)`.

The send wiring remains: `reverbInput → reverbInst.input → reverbInst.output → output` (same for delay). Each ChannelStrip's `reverbSend` still connects to `fxBus.reverbInput`.

- [ ] **Step 4: Register in bootstrap** — add `reverbPlugin`, `delayPlugin` to the builtin array.

- [ ] **Step 5: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: confirm reverb wet/decay still respond to UI, delay sync still works.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/fx/reverb.ts src/plugins/fx/delay.ts src/core/fx.ts src/plugins/bootstrap.ts
git commit -m "feat(plugins): reverb + delay as plugins; FxBus delegates DSP"
```

---

## Phase D — Per-lane inserts, persistence, UI

### Task 17: InsertSlot type + serialization

**Files:**
- Create: `src/session/insert-slot.ts`
- Create: `src/session/insert-slot.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/session/insert-slot.test.ts
import { describe, it, expect } from 'vitest';
import { applyInsertSlot, snapshotInsertSlot, type InsertSlot } from './insert-slot';
import type { FxInstance } from '../plugins/types';

function fakeInst(initial: Record<string, number>): FxInstance {
  const v = { ...initial };
  return {
    input: {} as any, output: {} as any,
    getAudioParams: () => new Map(),
    getBaseValue: (id) => v[id] ?? 0,
    setBaseValue: (id, x) => { v[id] = x; },
    applyPreset: () => {},
    dispose: () => {},
  };
}

describe('insert-slot helpers', () => {
  it('snapshot reads params via getBaseValue', () => {
    const inst = fakeInst({ freq: 1234, q: 2 });
    const slot: InsertSlot = {
      pluginId: 'multifilter',
      params: {},
      bypass: false,
    };
    const snap = snapshotInsertSlot(slot, inst, ['freq', 'q']);
    expect(snap.params).toEqual({ freq: 1234, q: 2 });
  });

  it('apply writes params via setBaseValue', () => {
    const inst = fakeInst({});
    const slot: InsertSlot = {
      pluginId: 'multifilter',
      params: { freq: 800, q: 5 },
      bypass: true,
    };
    applyInsertSlot(slot, inst);
    expect(inst.getBaseValue('freq')).toBe(800);
    expect(inst.getBaseValue('q')).toBe(5);
  });
});
```

- [ ] **Step 2: Implement**

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
  for (const [id, v] of Object.entries(slot.params)) {
    inst.setBaseValue(id, v);
  }
}

export function snapshotInsertSlot(slot: InsertSlot, inst: FxInstance, paramIds: string[]): InsertSlot {
  const params: Record<string, number> = {};
  for (const id of paramIds) params[id] = inst.getBaseValue(id);
  return { ...slot, params };
}
```

- [ ] **Step 3: Verify**

```bash
npx vitest run src/session/insert-slot.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/session/insert-slot.ts src/session/insert-slot.test.ts
git commit -m "feat(plugins): InsertSlot type + apply/snapshot helpers"
```

---

### Task 18: SessionLane gains `inserts`, persistence migration

**Files:**
- Modify: `src/session/session.ts:26-35,43-47,60-62`
- Modify: `src/session/session-migration.ts`

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
  inserts: InsertSlot[];                          // NEW
  engineState?: {
    modulators?: import('../modulation/types').ModulatorState[];
  };
}

export interface SessionState {
  lanes: SessionLane[];
  scenes: SessionScene[];
  globalQuantize: LaunchQuantize;
  masterInserts: InsertSlot[];                    // NEW
}

export function emptyLane(id: string, engineId: string): SessionLane {
  return { id, engineId, clips: [], inserts: [] };
}

export function emptySessionState(): SessionState {
  return {
    lanes: [
      { id: 'bass',  engineId: 'tb303',          name: 'TB-303 1',      clips: [], inserts: [] },
      { id: 'drums', engineId: 'drums-machine',  name: 'Drums 1',       clips: [], inserts: [] },
      { id: 'main',  engineId: 'subtractive',    name: 'Subtractive 1', clips: [], inserts: [] },
    ],
    scenes: [],
    globalQuantize: '1/1',
    masterInserts: [],
  };
}
```

- [ ] **Step 2: Add migration for old saves**

In [src/session/session-migration.ts](src/session/session-migration.ts), wherever a `SessionState` is normalized after deserialization, add:

```ts
if (!Array.isArray(state.masterInserts)) state.masterInserts = [];
for (const lane of state.lanes ?? []) {
  if (!Array.isArray(lane.inserts)) lane.inserts = [];
}
```

- [ ] **Step 3: Update existing tests**

Existing session migration tests (`session-migration.test.ts`, `session-add-lane.test.ts`) need to either assert the new defaults or be patched to construct lanes with `inserts: []`. Walk the failures and fix them.

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/session-migration.ts src/session/*.test.ts
git commit -m "feat(plugins): SessionLane.inserts + SessionState.masterInserts with migration"
```

---

### Task 19: Wire per-lane InsertChain in audio routing

**Files:**
- Modify: `src/session/session-host.ts` (around the voice creation + ChannelStrip wiring)

This is the audio-routing change: between `voice.output` and `ChannelStrip.input`, insert one `InsertChain` per lane. The chain is empty by default for existing lanes (matches their `inserts: []`).

- [ ] **Step 1: Find the lane construction in session-host.ts**

Look for where `createVoice(ctx, ...)` or `createInstance('synth', engineId, ...)` connects to a `ChannelStrip`. The exact line depends on current code — search for `extraStrips` and `ChannelStrip` references near [src/session/session-host.ts:42](src/session/session-host.ts#L42) and [:282](src/session/session-host.ts#L282).

- [ ] **Step 2: Introduce a `laneInsertChains: Map<string, InsertChain>` on the host**

For each lane added/created, build:

```ts
import { InsertChain } from '../plugins/fx/insert-chain';
import { createInstance } from '../plugins/registry';
import { applyInsertSlot } from './insert-slot';

const laneOut = ctx.createGain();                       // existing voice output target
const chain = new InsertChain(laneOut, channelStrip.input);
this.laneInsertChains.set(laneId, chain);

// Re-create chain content from session state:
for (const slot of lane.inserts) {
  const inst = createInstance('fx', slot.pluginId, ctx);
  if (!inst) continue;
  applyInsertSlot(slot, inst);
  chain.insert(inst);
  if (slot.bypass) chain.setBypass(chain.list().length - 1, true);
}
```

The exact insertion point depends on what already plays the role of "lane output node". If the engine voice already connects directly to the ChannelStrip, change it to connect to `laneOut` instead.

- [ ] **Step 3: Add a dispose path** — when a lane is removed, call `chain.dispose()` and drop the map entry.

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: confirm all lanes still play (empty chain = pass-through). Verify by inspecting the audio graph in the browser dev tools that the chain is in place.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts
git commit -m "feat(plugins): per-lane InsertChain between voice and ChannelStrip"
```

---

### Task 20: Lane insert UI

**Files:**
- Create: `src/session/lane-insert-ui.ts`
- Modify: `src/session/session-inspector.ts` (mount the new panel)

The UI is a vertical list of slots. Each slot row: plugin name, bypass toggle, remove (×), reorder handle, and a row of knobs auto-generated from `manifest.params`. Below the list: a `+ Add insert` button that opens a popover with `listPlugins('fx').filter(p => p.manifest.id !== 'reverb' && p.manifest.id !== 'delay')` (excluding send-only plugins).

- [ ] **Step 1: Build a minimal API**

```ts
// src/session/lane-insert-ui.ts
import { listPlugins, createInstance } from '../plugins/registry';
import { applyInsertSlot, snapshotInsertSlot, type InsertSlot } from './insert-slot';
import type { InsertChain } from '../plugins/fx/insert-chain';
import { createKnob } from '../core/knob';

const SEND_ONLY = new Set(['reverb', 'delay']);

export interface LaneInsertUIDeps {
  ctx: AudioContext;
  container: HTMLElement;
  chain: InsertChain;
  slots: InsertSlot[];                  // source of truth in session state
  onChange: () => void;                 // notify session to persist
}

export function buildLaneInsertUI(deps: LaneInsertUIDeps): void {
  // Render: for each slot in deps.slots, render a row.
  // Render: + Add insert button → opens picker → listPlugins('fx') filtered.
  // Picker pick:
  //   - const inst = createInstance('fx', pluginId, deps.ctx);
  //   - const slot: InsertSlot = { pluginId, params: {}, bypass: false };
  //   - snapshot params from the fresh instance into slot.params (use manifest.params ids).
  //   - deps.chain.insert(inst);
  //   - deps.slots.push(slot);
  //   - deps.onChange();
  //   - re-render this panel.
  // Each knob: createKnob({ get: () => inst.getBaseValue(id), set: v => { inst.setBaseValue(id, v); slot.params[id] = v; deps.onChange(); } })
  // Bypass toggle, remove, drag-reorder all mutate deps.slots + call corresponding chain methods + deps.onChange().
  // ...
}
```

The implementation follows the existing UI patterns in [src/core/fx-ui.ts](src/core/fx-ui.ts) and [src/session/session-inspector.ts](src/session/session-inspector.ts). Mirror the existing master FX panel layout for visual consistency.

- [ ] **Step 2: Mount in lane inspector**

In [src/session/session-inspector.ts](src/session/session-inspector.ts), in the lane inspector body, add a new section "Inserts" that calls `buildLaneInsertUI({ ctx, container, chain, slots: lane.inserts, onChange: () => saveSession() })`. Look up the `chain` from `sessionHost.laneInsertChains.get(lane.id)`.

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser:
- Open lane inspector, see empty "Inserts" section with "+ Add insert" button.
- Click + → see `Multifilter` and `Distortion` (not Reverb/Delay).
- Add Multifilter, hear bass go through filter, drag freq knob, hear change.
- Add Distortion after Multifilter, hear chain of both.
- Reorder, bypass, remove. All should respond.
- Reload page → chain persists (Task 18 persistence is exercised here).

- [ ] **Step 4: Commit**

```bash
git add src/session/lane-insert-ui.ts src/session/session-inspector.ts
git commit -m "feat(plugins): lane insert UI panel"
```

---

### Task 21: Master FX UI uses the same panel

**Files:**
- Modify: `src/core/fx-ui.ts` (replace the bespoke FilterChain UI with a call to `buildLaneInsertUI` against the master chain)
- Modify: `src/main.ts` (expose the master `InsertChain` from `FxBus` or alongside it; pass it to the panel)

The current [src/core/fx-ui.ts](src/core/fx-ui.ts) builds rows from `filterChain.filters` directly. After this task, the master FX area instead delegates to `buildLaneInsertUI` with `slots = sessionState.masterInserts` and `chain = masterInsertChain`.

The master chain should include `multifilter` and `distortion` (same picker filter as the lane one).

- [ ] **Step 1: Construct a master `InsertChain` in main.ts**

```ts
const masterInsertIn  = ctx.createGain();
const masterInsertOut = ctx.createGain();
const masterChain = new InsertChain(masterInsertIn, masterInsertOut);
// hook masterInsertOut to wherever master output currently goes
// hook masterInsertIn to wherever master input currently came from
```

The cleanest place is between the mixer sum and the final destination. The existing `FilterChain` already lives in that position, so this is a drop-in replacement.

- [ ] **Step 2: Delete the bespoke filter rows in fx-ui.ts** and call `buildLaneInsertUI` against `masterChain` + `sessionState.masterInserts`.

- [ ] **Step 3: Persistence**

On `saveSession()`, snapshot each slot's param values via `snapshotInsertSlot` using the manifest's param ids, so reloads preserve master FX state. This was done in Task 17/18 for the per-lane case; reuse the same logic for the master.

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: master FX area now has the same look as lane inserts. Add a multifilter, hear it. Reload, persists.

- [ ] **Step 5: Commit**

```bash
git add src/core/fx-ui.ts src/main.ts
git commit -m "feat(plugins): master FX UI uses generic insert chain panel"
```

---

## Phase E — Modulators as plugins + cleanup

### Task 22: LFO + ADSR plugins

**Files:**
- Create: `src/plugins/modulators/lfo.ts`
- Create: `src/plugins/modulators/adsr.ts`
- Modify: `src/plugins/bootstrap.ts`

Each plugin wraps the existing voice class with the `ModulatorInstance` interface. The voice classes themselves don't need changes — only the wrapping.

- [ ] **Step 1: LFO plugin**

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
    params: [
      { id: 'rate',  label: 'Rate',  kind: 'continuous', min: 0.01, max: 40, default: 4, unit: 'Hz' },
      { id: 'depth', label: 'Depth', kind: 'continuous', min: 0,    max: 1,  default: 1 },
    ],
    presets: [],
  },
  create(ctx, bpm): ModulatorInstance {
    const state = makeDefaultLFO('lfo-tmp');
    const voice = new LFOVoice(ctx, state, bpm);
    return {
      output: voice.output,
      getAudioParams: () => new Map(),     // LFOVoice exposes no automatable params yet
      getBaseValue: () => 0,
      setBaseValue: () => {},
      applyPreset: () => {},
      setBpm: (b) => { (voice as any).updateBpm?.(b); },
      trigger: (t, o) => voice.trigger(t, o),
      release: (t)    => voice.release(t),
      dispose: ()     => voice.dispose(),
    };
  },
};
```

- [ ] **Step 2: ADSR plugin** — same pattern, wrap `ADSRVoice`, use `makeDefaultADSR`. Params: `attack`, `decay`, `sustain`, `release`.

- [ ] **Step 3: Register in bootstrap** — add `lfoPlugin`, `adsrPlugin` to the builtin array.

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/modulators/lfo.ts src/plugins/modulators/adsr.ts src/plugins/bootstrap.ts
git commit -m "feat(plugins): lfo + adsr exposed as modulator plugins"
```

---

### Task 23: Modulation host reads from registry

**Files:**
- Modify: `src/modulation/modulation-host.ts:10-11,21-26,63`
- Modify: `src/modulation/types.ts:4`

- [ ] **Step 1: Loosen ModulatorKind**

In [src/modulation/types.ts](src/modulation/types.ts):

```ts
export type ModulatorKind = string;   // plugin id; was 'lfo' | 'adsr'
```

- [ ] **Step 2: Replace direct LFOVoice/ADSRVoice construction**

In [src/modulation/modulation-host.ts](src/modulation/modulation-host.ts), lines 10–11, drop:

```ts
import { LFOVoice } from './lfo-voice';
import { ADSRVoice } from './adsr-voice';
```

And around line 63, replace the `new LFOVoice(...) | new ADSRVoice(...)` switch with:

```ts
import { createInstance } from '../plugins/registry';
// …
const inst = createInstance('modulator', m.kind, ctx, bpm());
if (inst) out.set(m.id, instAsModulatorVoice(inst, m));
```

`instAsModulatorVoice` is a tiny adapter that exposes the `ModulatorVoice` shape the rest of the modulation system expects — it just forwards `output`, `trigger?`, `release?`, `dispose`, and `currentValue` (the last can return 0 if the plugin doesn't track it; UI only).

The `addModulator(kind)` method around line 21 changes from hardcoding `'lfo'` / `'adsr'` defaults to calling `makeDefaultLFO` / `makeDefaultADSR` only for those specific kinds, falling back to a generic empty state for other kinds:

```ts
function makeDefault(kind: ModulatorKind, id: string): ModulatorState {
  if (kind === 'lfo')  return makeDefaultLFO(id);
  if (kind === 'adsr') return makeDefaultADSR(id);
  return { id, kind, enabled: true, connections: [] };
}
```

- [ ] **Step 3: Update source dropdown in modulation-ui.ts**

In [src/modulation/modulation-ui.ts](src/modulation/modulation-ui.ts), the dropdown that adds a new modulator should iterate `listPlugins('modulator')` and produce one entry per plugin id.

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: open modulation panel, add an LFO, route to a synth param, hear modulation. Same for ADSR.

- [ ] **Step 5: Commit**

```bash
git add src/modulation/modulation-host.ts src/modulation/modulation-ui.ts src/modulation/types.ts
git commit -m "feat(plugins): modulation host discovers sources via plugin registry"
```

---

### Task 24: Destination dropdown includes FX params

**Files:**
- Modify: `src/modulation/modulation-ui.ts`

Today the destination dropdown only includes engine params for the active lane. Extend it to also list:
- The lane's FX insert params: walk `sessionHost.laneInsertChains.get(laneId).list()`, and for each `slot.fx.getAudioParams().keys()` add an entry.
- The master FX params: walk `masterChain.list()` similarly.

The dropdown groups them visually under headings: "Engine", "Lane FX", "Master FX".

The binder ([src/modulation/connection-binder.ts](src/modulation/connection-binder.ts)) already accepts a `destMap: Map<string, AudioParam>` — extend the map passed to it with the FX param entries (keyed by `${pluginId}:${paramId}` to avoid collision with engine params).

- [ ] **Step 1: Construct the extended destination map**

Where the modulation UI / host builds the dest map for a lane, append:

```ts
const chain = host.laneInsertChains.get(laneId);
let slotIdx = 0;
for (const slot of chain?.list() ?? []) {
  for (const [paramId, ap] of slot.fx.getAudioParams()) {
    dest.set(`insert${slotIdx}:${paramId}`, ap);
  }
  slotIdx++;
}
// same for master
```

(The exact key format is an implementation detail; persistence uses these as `ModulationConnection.paramId`.)

- [ ] **Step 2: Populate the dropdown**

The dropdown gets the same set of keys, grouped by prefix. Engine params keep their existing display.

- [ ] **Step 3: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: add a multifilter insert, open modulation panel, see "Lane FX → freq" as a destination, route an LFO to it, hear the filter sweep.

- [ ] **Step 4: Commit**

```bash
git add src/modulation/modulation-ui.ts src/modulation/modulation-host.ts
git commit -m "feat(plugins): modulation destinations include lane + master FX params"
```

---

### Task 25: Retire `src/engines/registry.ts`

**Files:**
- Modify: `src/engines/registry.ts` (reduce to thin compatibility re-export, or delete)
- Modify: every file that imports from `../engines/registry`

After Phase B all engines export plugin factories that get registered through `bootstrapPlugins`. The old `registerEngine` / `registerEngineFactory` calls inside each engine file are dead writes (their values are never read because consumers now use the plugin registry).

- [ ] **Step 1: Grep for legacy registry consumers**

```bash
grep -rn "from '../engines/registry'" src/
grep -rn "from './registry'" src/engines/
```

Update each consumer to use `src/plugins/registry` instead. Method mapping:

- `getEngine(id)` → `getPlugin('synth', id)?.manifest` (read-only access to id/name/etc.) or, if the caller needed the full `SynthEngine`, switch to using the plugin instance via `createInstance`.
- `createEngineInstance(id)` → `createInstance('synth', id, ctx, output)` (note signature change: now takes `ctx`/`output`).
- `listEngines('polyhost')` → `listPlugins('synth')` (every synth plugin is implicitly polyhost in phase 1; if some are tab-only, add `manifest.editor` or a similar discriminator).

- [ ] **Step 2: Delete `registerEngine` / `registerEngineFactory` calls from each engine file**

For each engine (tb303, subtractive, fm, wavetable, karplus, drums), remove the two registry calls near the bottom of the file. Keep the `tb303Engine` / `subtractiveEngine` named exports because some callers (e.g. `configureTB303EngineMainInstance`) still use them.

- [ ] **Step 3: Delete or reduce `src/engines/registry.ts`**

If nothing imports it: `git rm src/engines/registry.ts`.

If something still needs the named `listEngines` / `getEngine` symbols: reduce the file to a re-export shim:

```ts
// src/engines/registry.ts
// Compatibility shim — delegates to the plugin registry.
import { listPlugins, getPlugin } from '../plugins/registry';

export function listEngines() {
  return listPlugins('synth').map((p) => p.manifest);
}

export function getEngine(id: string) {
  return getPlugin('synth', id)?.manifest;
}
```

(Note: the return shape is `PluginManifest`, not `SynthEngine`. Callers that need engine internals must migrate to `createInstance`.)

- [ ] **Step 4: Verify**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Browser: full smoke — bass, drums, subtractive, FM, wavetable, karplus all play. Modulation works. Master + lane inserts work.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(plugins): retire legacy src/engines/registry.ts"
```

---

## Self-review

Spec section / requirement → task that implements it:

- Plugin SPI (types, manifest, factory) → Task 1.
- Registry (kind-discriminated create) → Task 2.
- Explicit `bootstrapPlugins()` replacing side-effect imports → Tasks 3, 4 (initial via adapter), Tasks 5–10 (per-engine native exports), Task 11 (adapter retired).
- FX `InsertChain` + master + per-lane → Tasks 12, 15, 19, 21.
- FX plugins (`multifilter`, `distortion`, `reverb`, `delay`) → Tasks 13, 14, 16.
- Lane `inserts` in session state + migration → Tasks 17, 18.
- Lane + master insert UI → Tasks 20, 21.
- Modulator plugins (`lfo`, `adsr`) → Task 22.
- Modulation host reads from registry → Task 23.
- Modulation destinations include FX params (paridad total) → Task 24.
- Cleanup of legacy engine registry → Task 25.

Type consistency check: `PluginManifest`, `PluginFactory`, `SynthInstance`, `FxInstance`, `ModulatorInstance`, `InsertSlot`, `InsertChain`, `createInstance` signatures, `applyInsertSlot`, `snapshotInsertSlot`, `buildLaneInsertUI` — names are consistent across tasks.

Phase 2 (runtime loading) is not in this plan, as expected per the spec's non-goals.
