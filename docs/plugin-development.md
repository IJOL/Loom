# Writing plugins

A practical guide to adding an FX insert, a modulator or a note-FX to Loom
through the plugin SPI.

**Synths are not in that list, and that is the most important thing on this
page.** A synth engine is not a plugin you write against this SPI — see
[Synth engines are not plugins](#synth-engines-are-not-plugins) before you start
one.

## The four kinds

A plugin is an audio unit packaged with its manifest.

| Kind | Does | Instance |
| --- | --- | --- |
| `fx` | Processes audio in → out | `FxInstance` with `input` / `output` |
| `modulator` | Generates a control signal for `AudioParam`s | `ModulatorInstance` with `output` |
| `notefx` | Transforms notes before they reach the engine | no instance — declares `defaultParams()` |
| `synth` | *Metadata bridge only.* See the warning below | `SynthInstance` (never constructed) |

`fx` and `modulator` share the same shape:

- a static **manifest**: `id`, `name`, `kind`, `version`, `params[]`, `presets[]`
- a **factory function** `create(ctx, …)` that builds one instance
- a unified **param spec** (`EngineParamSpec`, aliased `ParamSpec`) — the params
  are the source of truth for the UI knobs, modulation, presets and automation

The types live in [`src/plugins/types.ts`](../src/plugins/types.ts), the registry
in [`src/plugins/registry.ts`](../src/plugins/registry.ts), and the bootstrap in
[`src/app/plugin-bootstrap.ts`](../src/app/plugin-bootstrap.ts).

## Auto-discovery

The bootstrap scans two `import.meta.glob` trees, resolved by Vite at build time:

- `src/engines/*.ts`
- `src/plugins/**/*.ts`

(`*.test.ts` is excluded from both.) From every module it collects **any export
shaped like a `PluginFactory`** — `kind` is `synth`, `fx` or `modulator`, there is
a `manifest.id` string, and `create` is a function — and registers it. The
`BUILTIN` array is built from those globs alone: **do not edit
`plugin-bootstrap.ts` and do not maintain a list anywhere.**

For `fx` and `modulator` that is the whole story. Dropping the file in the folder
with an exported factory is the only step; none of the eleven shipped inserts or
the two shipped modulators calls `registerPlugin` itself.

**Note-FX are the exception.** A `NoteFxFactory` has `defaultParams()` and no
`create()`, so the shape check skips it. Those files call `registerPlugin` at
module scope themselves ([`src/plugins/notefx/arp.ts`](../src/plugins/notefx/arp.ts)),
and the glob's only job for that category is to evaluate the module — which is
why it has to cover the whole plugin tree, not just `fx/` and `modulators/`.

---

## Writing an FX plugin

`kind: 'fx'`. The instance exposes `input` and `output` instead of
`trigger`/`release`. Complete examples in [`src/plugins/fx/`](../src/plugins/fx/):

- [`multifilter.ts`](../src/plugins/fx/multifilter.ts) — biquad, and the
  reference for `getAudioParamRange`
- [`distortion.ts`](../src/plugins/fx/distortion.ts) — waveshaper with a dry/wet
  split; the clearest small template
- [`reverb.ts`](../src/plugins/fx/reverb.ts) — convolver, with its impulse in
  `reverb-ir.ts`
- [`delay.ts`](../src/plugins/fx/delay.ts) — delay with damping in the feedback
  loop
- [`modulated-delay.ts`](../src/plugins/fx/modulated-delay.ts) — not a plugin;
  the shared DSP that `chorus.ts` and `flanger.ts` are both built on. The example
  to follow when two plugins want the same engine underneath.

Minimal template:

```ts
export const myFxPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'my-fx', name: 'My FX', kind: 'fx', version: '1.0.0',
    params: [
      { id: 'amount', label: 'Amount', kind: 'continuous', min: 0, max: 1, default: 0.5 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const node = ctx.createGain();
    input.connect(node).connect(output);
    let amount = 0.5;
    return {
      input, output,
      getAudioParams: () => new Map([['amount', node.gain]]),
      getBaseValue: (id) => id === 'amount' ? amount : 0,
      setBaseValue: (id, v) => { if (id === 'amount') { amount = v; node.gain.value = v; } },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); node.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
```

Two optional members are worth knowing about:

- **`getAudioParamRange(shortId)`** — the native modulation range for a param.
  The binder uses `max − min` as the peak gain at depth 1; omit it and it falls
  back to `0..1`. A frequency-type param should expose a `.detune` `AudioParam`
  from `getAudioParams()` and return a span in cents here, so a bipolar LFO
  sweeps the filter exponentially instead of summing ±1 Hz, which is inaudible.
- **`setBpm(bpm)`** — implement it if the effect is tempo-synced; the host calls
  it on every tempo change.

A param only needs to be in `getAudioParams()` if it is a real `AudioParam`.
`distortion`'s `drive` rebuilds a waveshaper curve, so it lives in
`setBaseValue` only and is not modulatable; `mix` is a gain and is.

### Where it shows up

Automatically, in all four insert racks. The picker is an unfiltered
`listPlugins('fx')` ([`lane-insert-ui.ts:218`](../src/session/lane-insert-ui.ts)),
and the same builder serves the lane inspector, the master rack and both send
racks. Its continuous params become modulation and automation destinations by
being declared, without any further step.

Separately, `FxBus` seeds send A with `delay` and send B with `reverb` when it is
constructed ([`src/core/fx.ts:30`](../src/core/fx.ts)). That is a default, not a
restriction — both remain ordinary inserts you can add anywhere.

---

## Writing a modulator plugin

`kind: 'modulator'`. It produces a control signal (typically a
`ConstantSourceNode`) that the binder connects through a depth gain:

```ts
export const myModPlugin: PluginFactory = {
  kind: 'modulator',
  manifest: { id: 'my-mod', name: 'MyMod', kind: 'modulator', version: '1.0.0', params: [], presets: [] },
  create(ctx, bpm): ModulatorInstance {
    const output = ctx.createConstantSource();
    output.offset.value = 0;
    output.start();
    return {
      output,
      getAudioParams: () => new Map(),
      getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {},
      trigger: (t) => { /* on note-on */ },
      release: (t) => { /* on note-off */ },
      dispose: () => { try { output.stop(); } catch { /* ok */ } },
    };
  },
};
```

**Know the ceiling before you invest in one.** A third kind of modulator is not
currently reachable:

- The MODULATORS panel offers exactly two buttons, **+ LFO** and **+ ADSR**
  ([`modulation-ui.ts:63`](../src/modulation/modulation-ui.ts)). There is no UI
  that adds any other kind.
- `ModulationHost` hardcodes `LFOVoice` and `ADSRVoice`, and routes any other
  kind through `createInstance` — which its own comment calls a stateless stub
  whose `currentValue()` returns 0
  ([`modulation-host.ts:85`](../src/modulation/modulation-host.ts)).
- Inside the worklet, `ModLite.kind` is typed `'lfo' | 'adsr'`
  ([`modulation-runtime.ts:24`](../src/audio-dsp/modulation-runtime.ts)), so a
  custom modulator cannot reach a melodic engine's params at all.

Adding a genuinely new modulator kind means changing those three places. The SPI
is ready for it; the host is not.

---

## Writing a note-FX plugin

`kind: 'notefx'` — a transform applied to a lane's notes before they reach the
engine. Two ship: `arp` (arpeggiator) and `chord` (chord spread).

The factory is deliberately small — it declares an id and the default params, and
nothing else:

```ts
export const myNoteFxPlugin: NoteFxFactory = {
  kind: 'notefx',
  manifest: { id: 'my-notefx', name: 'My Note FX', kind: 'notefx', version: '1.0.0' },
  defaultParams: () => ({ ...MY_PROCESSOR_DEFAULTS }),
};
registerPlugin(myNoteFxPlugin);   // REQUIRED — the shape check skips notefx
```

The processor that does the work lives in [`src/notefx/`](../src/notefx/) and is
wired into the per-lane chain there. State is persisted in
`lane.engineState.noteFx`.

---

## Synth engines are not plugins

Registering a `kind: 'synth'` `PluginFactory` will get your synth into the engine
selector, because the selector reads `listPlugins('synth')`
([`engine-selector-ui.ts:42`](../src/engines/engine-selector-ui.ts)). It will
then play **silence**, with no error.

Nothing calls `create()` on a synth factory. Since the Phase 4 worklet cutover,
the lane allocator's only synth paths are the worklet ones
([`lane-allocator.ts:90`](../src/app/lane-allocator.ts) builds a
`WorkletLaneEngine` for ids in `WORKLET_ENGINE_IDS`; `:111-116` build the
dedicated drums / sampler / audio worklet engines), and an id that matches
neither returns `null` — no engine, no sound. `createInstance` is called for
`fx` and `modulator` only.
The synth entries in the registry are a **metadata bridge**: `bootstrapPlugins`
builds one factory per registered engine descriptor so `listPlugins('synth')`
keeps working, and that factory's `create()` throws by design
([`plugin-bootstrap.ts:81`](../src/app/plugin-bootstrap.ts)) to catch exactly
this mistake.

An engine is instead **two halves in two places** — a metadata descriptor on the
main thread and a per-sample renderer inside the worklet bundle — and there are
**four** steps, three of which fail silently if skipped:

1. `src/engines/<id>.ts` — build it with `createDescriptorEngine(...)`, register
   with `registerEngineFactory(id, …)` + `registerEngine(...)` at module scope.
2. `src/audio-dsp/<id>-renderer.ts` — the pure per-sample renderer, calling
   `registerRenderer(id, ctor)` at module scope.
3. A side-effect `import '../audio-dsp/<id>-renderer';` in
   [`src/audio-worklet/loom-processor.ts`](../src/audio-worklet/loom-processor.ts).
4. The id added to `WORKLET_ENGINE_IDS` in
   [`src/app/lane-allocator.ts`](../src/app/lane-allocator.ts).

The full recipe, with what each omission looks like from the outside, is in
[the developer guide](manual/11-developer-guide.md) under "Add a synth engine".
Follow that, not this file.

### Presets for an engine

Create `public/presets/<engineId>.json`:

```json
{
  "engineId": "my-engine",
  "presets": [
    {
      "name": "BASS Square Punch",
      "gm": [33, 34, 35],
      "params": { "filter.cutoff": 600, "filter.resonance": 8, "osc.wave": 1 }
    }
  ]
}
```

The id does not need registering anywhere. `src/main.ts:103` derives the list
from the registry —

```ts
const ENGINE_IDS_FOR_PRESETS = listPlugins('synth').map((p) => p.manifest.id);
```

— so once the engine is registered and the JSON exists, the preset loader reads
it at boot. `gm` maps presets to GM program numbers for MIDI import. The keys in
`params` are that engine's own param ids.

---

## Param specs

`manifest.params: ParamSpec[]` is the single source of truth. It drives:

- **Knobs and selects** — the inspector builds controls from it automatically
- **Automation ids** — each continuous param becomes `${laneId}.${spec.id}`
  (e.g. `subtractive-1.filter.cutoff`)
- **Modulation destinations** — continuous params appear in the dropdown
- **Presets** — preset JSON uses the same `id` keys

Full shape ([`src/engines/engine-params.ts`](../src/engines/engine-params.ts)):

```ts
interface EngineParamSpec {
  id: string;              // dot-namespaced: 'filter.cutoff', 'amp.attack'
  label: string;           // user-facing
  kind: 'continuous' | 'discrete';
  min: number;             // continuous: range; discrete: 0
  max: number;             // continuous: range; discrete: options.length - 1
  default: number;
  curve?: 'linear' | 'exponential' | 'log';
  unit?: string;
  color?: string;          // knob ring colour (carries the Send A/B colour code)
  group?: string;          // params sharing a group render together in one row
  options?: Array<{ value: string; label: string }>;   // discrete only
  selectStyle?: 'radio' | 'dropdown';                  // discrete only
  showLabel?: boolean;                                 // discrete only
}
```

`validateSpec` is the contract a new spec has to satisfy: an id and a label are
required, a continuous param needs `max > min`, and a discrete one needs at
least two options.

Naming conventions, which the modulation panel groups by and the preset JSON
uses:

- `filter.cutoff`, `filter.resonance`, `filter.envAmount`
- `amp.attack`, `amp.decay`, `amp.sustain`, `amp.release`, `amp.gain`
- `osc.wave`, `osc.detune`, `osc.level`
- `bus.reverbSend`, `bus.delaySend`, `bus.eq.low` (the drums bus)
- `opN.ratio`, `opN.detune`, `opN.level` (FM)

---

## Persistence

`SessionLane.engineState` holds the per-lane state, and inserts live beside it:

```ts
interface SessionLane {
  id: string;
  engineId: string;
  engineState?: {
    params?: Record<string, number>;        // values for ParamSpec ids
    modulators?: ModulatorState[];          // LFO/ADSR + connections
    noteFx?: NoteFxState[];
    // …sampler keymap, drum mutes, kit mode
  };
  enginePresetName?: string;                // 'engine:LEAD Bright Saw'
  inserts?: InsertSlot[];                   // the lane's FX chain
}
```

A save is assembled by `buildSavedStateV3`
([`src/save/saved-state-v3.ts:63`](../src/save/saved-state-v3.ts)) from
`sessionHost.getStateForSave()`; the deep clone is `cloneSessionState`
([`session-core.ts:12`](../src/session/session-core.ts)), which is the
`JSON.parse(JSON.stringify(...))`. Anything in `SessionState` persists for free —
you never touch the SaveManager for a new plugin.

The **load** is `applyLoadedSessionState`
([`session-host-persistence.ts:50`](../src/session/session-host-persistence.ts)),
and its ordering is load-bearing:

1. Silence live voices, then run `migrateLoadedSessionState`.
2. Per lane: allocate or swap the engine resource.
3. Rehydrate the lane's insert chain (`rehydrateInsertChain`).
4. Apply `enginePresetName` **inside `withoutParamMirror`**.
5. `applyEngineState` replays the saved `engineState.params`.
6. Rehydrate the master rack and the send buses, then announce the new
   destination set once.

Step 4's guard is the invariant to remember: **a saved param beats its lane
preset on load.** Applying the preset unguarded would mirror its base values into
`engineState.params` a line before the saved ones are restored.

Your plugin gets all of this for free if `setBaseValue` writes both the state and
the node, and `getBaseValue` returns the current value.

---

## Modulation

The binder ([`src/modulation/connection-binder.ts:44`](../src/modulation/connection-binder.ts))
builds one gain bridge per connection:

```text
modulator.output → GainNode(depth × (max − min)) → target.getAudioParams().get(paramId)
```

That is the **FX and channel-strip path**. To make an FX param modulatable,
declare it `kind: 'continuous'` in the manifest *and* return it from
`getAudioParams()`.

For a **synth engine** the rule is different: declaring the param continuous in
the spec is enough. Modulation for the six melodic engines is applied per sample
inside the worklet by `ModulationRuntime`, and `getAudioParams()` on those
engines is deliberately empty
([`worklet-lane-engine.ts:150`](../src/engines/worklet-lane-engine.ts)). Only
Drums and Sampler expose shared `AudioParam`s, via `getSharedAudioParams()`.

---

## The registry

```ts
import { registerPlugin, getPlugin, listPlugins, createInstance } from '../plugins/registry';

registerPlugin(myFxPlugin);                       // done by the bootstrap for fx/modulator
const factory = getPlugin('fx', 'my-fx');         // the factory for one id
const allFx = listPlugins('fx');                  // every registered FX
const inst = createInstance('fx', 'my-fx', ctx);  // build an instance
```

The registry is keyed `${kind}:${id}`, so the same id under two kinds cannot
collide.

---

## Checklist

- [ ] `src/plugins/{fx,modulators}/<name>.ts` exporting a `PluginFactory` — the
      glob finds it, you do not register it by hand
- [ ] Note-FX only: call `registerPlugin` yourself at module scope
- [ ] Continuous params you want modulatable are also in `getAudioParams()`
- [ ] `getAudioParamRange` for anything frequency-shaped
- [ ] `dispose()` disconnects every node it created
- [ ] `npx tsc --noEmit`, then the tests
- [ ] Browser smoke test: add the insert, move a param, modulate it, save and
      reload

## Tests worth writing

- **Manifest** — import the plugin, assert `manifest.params` has the expected ids
- **Round trip** — `setBaseValue` every param, `getBaseValue` returns what was
  written
- **Modulation** — `getAudioParams()` includes every continuous param you intend
  to be modulatable
- **Dispose** — after `dispose()` the nodes are disconnected

[`src/plugins/registry.test.ts`](../src/plugins/registry.test.ts) and
[`src/plugins/fx/insert-chain.test.ts`](../src/plugins/fx/insert-chain.test.ts)
are the patterns to copy.

---

## Quick reference

- **SPI types** — [`src/plugins/types.ts`](../src/plugins/types.ts)
- **Registry** — [`src/plugins/registry.ts`](../src/plugins/registry.ts)
- **Bootstrap** — [`src/app/plugin-bootstrap.ts`](../src/app/plugin-bootstrap.ts)
- **FX plugins** — [`src/plugins/fx/`](../src/plugins/fx/)
- **Modulator plugins** — [`src/plugins/modulators/`](../src/plugins/modulators/)
- **Note-FX plugins** — [`src/plugins/notefx/`](../src/plugins/notefx/) +
  [`src/notefx/`](../src/notefx/)
- **Engine descriptors** — [`src/engines/`](../src/engines/), built on
  [`descriptor-engine.ts`](../src/engines/descriptor-engine.ts)
- **Param spec** — [`src/engines/engine-params.ts`](../src/engines/engine-params.ts)
- **Preset loader** — [`src/presets/preset-loader.ts`](../src/presets/preset-loader.ts)
- **Modulation host** — [`src/modulation/modulation-host.ts`](../src/modulation/modulation-host.ts)
- **Lane allocator** — [`src/app/lane-allocator.ts`](../src/app/lane-allocator.ts)
- **Automation destinations** — [`automation-destinations.md`](automation-destinations.md)
