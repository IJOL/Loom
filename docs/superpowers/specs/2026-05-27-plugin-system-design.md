# Plugin System — Design

**Date:** 2026-05-27
**Status:** Approved by user (pending spec review)

## Goal

Formalize a single plugin SPI for the three extensible categories of the app — synth engines, insert FX/filters, and modulators — so that adding new ones is a manifest export plus a registration line, and so that the architecture is ready for a future runtime-loading phase.

The current state is uneven:

- Synth engines have a contract (`SynthEngine` in [src/engines/engine-types.ts](../../../src/engines/engine-types.ts)) and a registry, but registration happens via side-effect imports in [src/main.ts](../../../src/main.ts).
- FX live as hand-wired classes in [src/core/fx.ts](../../../src/core/fx.ts) (`FxBus`, `ChannelStrip`, `FilterChain`) with no contract or registry.
- Modulators (LFO, ADSR) are hardcoded inside [src/modulation/modulation-host.ts](../../../src/modulation/modulation-host.ts); adding a new source (e.g. Sample & Hold) requires editing the host.

This spec covers **phase 1 only**: internal SPI hardening. Phase 2 (runtime loading from URL/file) is explicitly deferred.

## Non-goals

- Runtime / dynamic plugin loading (URL, file, drag-and-drop). The architecture is left ready for it, but no loader is built.
- Sandboxing or security model for third-party plugins.
- Public plugin distribution, remote registry, versioned compatibility matrix.
- Drum voices as individual plugins (kick/snare/hat are still part of the drums engine).
- Arbitrary routing / FX matrix (sidechain, parallel, splits). Insert chains are linear.
- MIDI CC / MPE / pitch-bend as modulation sources.
- Hot reload with preserved state.

## Scope

- Categories supported in phase 1: **synth engines, insert FX/filters, modulators**. All three share the same manifest/param/preset machinery, all three expose their params for modulation and automation ("total parity").
- FX placement: **master + per-lane inserts**. Reverb and delay remain global sends on the existing `FxBus` (not converted to inserts).
- Registration is **explicit** via `bootstrapPlugins()` called once during boot; no more `import './engines/xxx'` side-effects in [main.ts](../../../src/main.ts).

## Architecture

### Plugin SPI

New folder `src/plugins/` with the shared contracts. Existing `src/engines/` and `src/modulation/` files are migrated incrementally to implement these contracts.

```ts
// src/plugins/types.ts
export type PluginKind = 'synth' | 'fx' | 'modulator';

export interface PluginManifest {
  readonly id: string;          // 'tb303', 'reverb', 'lfo'
  readonly name: string;        // 'TB-303', 'Reverb', 'LFO'
  readonly kind: PluginKind;
  readonly version: string;     // semver; reserved for phase-2 compat checks
  readonly params: ParamSpec[];
  readonly presets: PluginPreset[];
}

export interface PluginPreset {
  name: string;
  params: Record<string, number>;
  modulators?: ModulatorState[];   // only meaningful for synth/fx targets
}

export type PluginFactory =
  | { kind: 'synth';     manifest: PluginManifest;
      create(ctx: AudioContext, output: AudioNode): SynthInstance }
  | { kind: 'fx';        manifest: PluginManifest;
      create(ctx: AudioContext): FxInstance }
  | { kind: 'modulator'; manifest: PluginManifest;
      create(ctx: AudioContext, bpm: number): ModulatorInstance };
```

Instance interfaces — kind-specific runtime shape, all converge on `getAudioParams()` for modulation:

```ts
interface SynthInstance {
  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  getAudioParams(): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  dispose(): void;
}

interface FxInstance {
  readonly input: AudioNode;
  readonly output: AudioNode;
  getAudioParams(): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  dispose(): void;
}

interface ModulatorInstance {
  readonly output: AudioNode;       // typically a ConstantSourceNode
  getAudioParams(): Map<string, AudioParam>;
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
  applyPreset(name: string): void;
  setBpm?(bpm: number): void;
  trigger?(time: number): void;     // envelope-style modulators
  release?(time: number): void;
  dispose(): void;
}
```

`EngineParamSpec` is renamed to `ParamSpec` (its previous name was only because it shipped with the engine system). Old name kept as a type alias for one transition.

### Registry + bootstrap

```ts
// src/plugins/registry.ts
// Single map keyed by `${kind}:${id}`.
function registerPlugin(factory: PluginFactory): void;
function getPlugin(kind: PluginKind, id: string): PluginFactory | undefined;
function listPlugins(kind?: PluginKind): PluginFactory[];

// Typed create overloads — return type narrows by kind.
function createInstance(kind: 'synth',     id: string, ctx: AudioContext, output: AudioNode): SynthInstance;
function createInstance(kind: 'fx',        id: string, ctx: AudioContext): FxInstance;
function createInstance(kind: 'modulator', id: string, ctx: AudioContext, bpm: number): ModulatorInstance;
```

```ts
// src/plugins/bootstrap.ts
const BUILTIN_PLUGINS: PluginFactory[] = [
  tb303Plugin, subtractivePlugin, fmPlugin, wavetablePlugin, karplusPlugin, drumsPlugin,
  reverbPlugin, delayPlugin, multifilterPlugin, distortionPlugin,
  lfoPlugin, adsrPlugin,
];

export function bootstrapPlugins(extras: PluginFactory[] = []): void {
  for (const p of [...BUILTIN_PLUGINS, ...extras]) registerPlugin(p);
}
```

`bootstrapPlugins()` is called once during app boot. The `extras` parameter is unused today but is the seam where phase 2 (runtime-loaded plugins) hooks in without further refactoring.

### Signal flow

```
SynthInstance(lane).output
  → LaneInsertChain (ordered FxInstance list, possibly empty)
  → ChannelStrip(lane)
  → master mixer
  → MasterInsertChain (ordered FxInstance list, possibly empty)
  → destination

(reverb/delay sends remain attached to ChannelStrip as today, unchanged)
```

An "insert chain" is a linear chain of `FxInstance`s connected `prev.output → next.input`. Each slot has a `bypass` flag that routes around the instance without disposing it.

The existing master `FilterChain` is replaced by a generic insert chain whose default content is a single `multifilter` plugin (which internally is the old `FilterChain` logic). This preserves current behavior with one indirection.

### Persistence

New shape added to session state:

```ts
interface InsertSlot {
  pluginId: string;
  params: Record<string, number>;
  presetName?: string;
  modulators?: ModulatorState[];
  bypass: boolean;
}

interface LaneState {
  // …existing fields
  inserts: InsertSlot[];
}

interface SessionState {
  // …existing fields
  masterInserts: InsertSlot[];
}
```

`session-migration.ts` gains one rule: lanes/sessions without the new fields default to empty arrays. Save format is forward-compatible; no version bump needed beyond the existing migration mechanism.

### Modulator integration

Existing `LFOVoice` and `ADSRVoice` are wrapped as `ModulatorInstance`s and exported as `lfoPlugin` / `adsrPlugin`. The modulation host changes in two places:

1. **Source dropdown** is populated from `listPlugins('modulator')` instead of a hardcoded array.
2. **Instance creation** goes through `createInstance('modulator', id, ctx, bpm)` instead of `new LFOVoice(...) | new ADSRVoice(...)`.

The connection binder ([src/modulation/connection-binder.ts](../../../src/modulation/connection-binder.ts)) is unchanged in shape; it already operates on `(source: AudioNode, target: AudioParam, depth)`.

**Cross-kind destinations**: because `FxInstance.getAudioParams()` is part of the contract, the modulation host's destination dropdown is extended to include the params of FX instances on the same lane (and master FX, for master modulators). This is what "total parity" buys.

## Migration plan

Each step keeps the app working before the next. Ordering is load-bearing — do not reorder without revisiting.

1. **Scaffold `src/plugins/`** with `types.ts`, `registry.ts`, empty `bootstrap.ts`. Rename `EngineParamSpec` → `ParamSpec` (keep old name as type alias).
2. **Synth-to-plugin adapter.** A `synthEngineAsPlugin(engine: SynthEngine): PluginFactory` that wraps an existing engine. No existing engine code is touched yet.
3. **Explicit bootstrap.** Replace the six `import './engines/xxx'` side-effect lines in [main.ts](../../../src/main.ts) with a single `bootstrapPlugins()` call that registers existing engines through the step-2 adapter. App behavior identical. Commit checkpoint.
4. **Migrate engines one by one.** Each engine file stops calling `registerEngine()` and instead exports `xxxPlugin: PluginFactory` directly. Start with TB-303 (most recently refactored, best understood). One commit per engine. Delete the step-2 adapter after the last engine is migrated.
5. **FX as plugins + master insert chain.** Implement `reverb`, `delay`, `multifilter`, `distortion` as `FxPlugin`s. Refactor master `FilterChain` to use the generic insert chain backed by the `multifilter` plugin. Master FX UI reuses the new generic component. Reverb and delay remain sends on `FxBus`, not inserts.
6. **Per-lane insert chain.** Extend `LaneState` with `inserts: InsertSlot[]`. Wire the chain between `SynthInstance.output` and `ChannelStrip.input`. Add the "Inserts" section to the lane inspector UI (add/remove/reorder/bypass). Update `session-migration.ts` to default missing field to `[]`.
7. **Modulators as plugins.** Refactor `LFOVoice` and `ADSRVoice` to implement `ModulatorInstance` and export `lfoPlugin` / `adsrPlugin`. Modulation host reads sources from `listPlugins('modulator')`. Destination dropdown extended to include FX params on the same lane.
8. **Cleanup.** Remove `registerEngine` / `registerEngineFactory` from [src/engines/registry.ts](../../../src/engines/registry.ts) (or reduce that file to a thin re-export for any lingering imports). Delete the old engine registry once nothing imports it.

## UI changes

- **Lane inspector** gains an "Inserts" section: a vertical list of slots, each with a popover-driven plugin picker (`listPlugins('fx')`), auto-generated knobs from `ParamSpec`, a bypass toggle, drag-to-reorder, and remove. Empty state shows a single `+ Add insert` button.
- **Master FX panel**: the existing `FilterChain` UI is replaced by the same generic insert-chain component used in the lane inspector. Reverb/delay knobs unchanged.
- **Modulation panel destination dropdown**: now grouped by source (engine params / lane FX params / master FX params), populated from `getAudioParams()` keys plus the registry-known `ParamSpec` metadata.

## Testing

Each step that touches audio routing or persistence must:

- Keep existing tests green: `tb303.test.ts`, `engine-params.test.ts`, `modulation-host.test.ts`, `session-migration.test.ts`, `connection-binder.test.ts`.
- Add a new contract test for the affected piece — e.g. step 4 (TB-303 as native plugin) adds a `plugin-tb303.test.ts` that constructs the plugin via `createInstance`, asserts `getAudioParams()` contents match `manifest.params`, and round-trips a preset.

Step 6 (per-lane inserts) needs an integration test that builds a session with one lane + one insert, serializes, deserializes, and confirms the chain reconnects.

## Open questions deferred to implementation

- The exact wire format of `InsertSlot.modulators` reuses `ModulatorState[]` — already validated by the unified-modulators design. No new format invented.
- Whether `multifilter` exposes its stacked filters as separate params or as a structured sub-array of slots is an implementation detail; default is to keep it opaque (param flat list) and revisit if users want per-filter modulation.
- Order of plugins in `BUILTIN_PLUGINS` determines dropdown order in the UI — keep stable, matches the spec list.
