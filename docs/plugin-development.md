# Writing plugins

Loom has **two** ways to extend it, and they are not interchangeable:

1. **The in-tree SPI** — a file you add inside `src/plugins/` (or `src/engines/`
   for a built-in engine), discovered at build time by a Vite `import.meta.glob`
   scan and compiled into the app bundle. This is how every FX insert, the
   built-in LFO/ADSR modulators, note-FX, and the six built-in melodic engines
   are written. It requires editing this repo.
2. **The external plugin ABI** (`@loom/plugin-sdk`) — a self-contained directory
   under `plugins/`, built with its own CLI into `public/plugins/<id>/`, and
   loaded by the browser **at runtime** from a plain JSON manifest. It needs no
   access to this repo's source at all — only `@loom/plugin-sdk`. This is a real
   drop-in plugin: a `.zip` of `public/plugins/karplus/` could be handed to
   someone else's Loom checkout and it would work. **An external plugin can be
   an engine or a modulator** — both are first-class this way. [`plugins/karplus/`](../plugins/karplus/)
   ships a synth engine, [`plugins/sh/`](../plugins/sh/) ships a modulator, and
   both are built into the app you're running today (`public/plugins/`).

Older versions of this page said "synth engines are not plugins." That was true
of the in-tree SPI's now-deleted node-per-note `kind: 'synth'` shape — it is not
true of the external ABI, and Karplus is the proof: it is a real, selectable,
sounding engine, built entirely outside `src/`. See
["An engine can be a plugin"](#an-engine-can-be-a-plugin-what-changed) below for
what's still true about the in-tree side.

## Which one do I want?

| You're building… | Use | Why |
| --- | --- | --- |
| An FX insert to ship inside Loom itself | In-tree SPI, `kind: 'fx'` | Simplest: drop a file, the glob finds it |
| The built-in LFO/ADSR-style modulator, shipped inside Loom | In-tree, `registerModulator()` | Same registry a plugin modulator uses, called directly |
| A note-FX (arp/chord-style) shipped inside Loom | In-tree SPI, `kind: 'notefx'` | Small, and always ships inside the app |
| A synth engine, and you're a contributor with a repo checkout | Either | In-tree gets you `getAudioParamRange`/`color`/`curve` on params (the external ABI's spec is a subset); external gets you a directory nobody else's PR review has to touch |
| A synth engine, and you're an outside author with no access to this repo's source | External ABI only | It's the only one that doesn't require editing `src/` |
| A **new kind of modulator** (not a time-driven LFO-alike or a gate-driven ADSR-alike) | External ABI (or `registerModulator` directly, in-tree) | The in-tree glob-discovered `PluginFactory` shape has **no modulator kind at all** any more — see below |

---

## The in-tree SPI

A plugin is an audio unit packaged with its manifest, discovered by
`src/app/plugin-bootstrap.ts`'s eager `import.meta.glob` over `src/engines/*.ts`
and `src/plugins/**/*.ts` (`*.test.ts` excluded from both). From every module it
collects **any export shaped like a `PluginFactory`** and registers it via
`registerPlugin`. The types live in
[`src/plugins/types.ts`](../src/plugins/types.ts), the registry in
[`src/plugins/registry.ts`](../src/plugins/registry.ts).

```ts
export type PluginKind = 'engine' | 'fx' | 'notefx';
```

**Only three kinds.** There is no `'synth'` kind any more (renamed to
`'engine'`) and no `'modulator'` kind at all — see
["Modulators moved out of this registry"](#modulators-moved-out-of-this-registry).

- `fx` — processes audio in → out (`FxInstance`, `input`/`output`)
- `engine` — a synth engine's **metadata bridge** (see below — its `create()`
  throws by design; it exists only so `listPlugins('engine')` sees every
  registered engine for the preset loader, not to build a voice)
- `notefx` — transforms notes before they reach the engine, no instance, just
  `defaultParams()`

`fx` and `engine` share the same shape:

- a static **manifest**: `id`, `name`, `kind`, `version`, `params[]`, `presets[]`
- a **factory function** `create(ctx, …)`
- a unified **param spec** (`EngineParamSpec`, aliased `ParamSpec`) — the params
  are the source of truth for the UI knobs, modulation, presets and automation

**Note-FX are the exception to the glob.** A `NoteFxFactory` has
`defaultParams()` and no `create()`, so the shape check skips it. Those files
call `registerPlugin` at module scope themselves
([`src/plugins/notefx/arp.ts`](../src/plugins/notefx/arp.ts)), and the glob's
only job for that category is to evaluate the module — which is why it has to
cover the whole plugin tree, not just `fx/`.

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

## Modulators moved out of this registry

A modulator is **not** a `PluginKind` in `src/plugins/types.ts` any more. It has
its own registry, [`src/modulation/modulator-registry.ts`](../src/modulation/modulator-registry.ts) —
the one door for "what is this modulator and what can it do," for a **built-in**
component registering from code and for a **plugin** component adopted straight
from its validated `plugin.json` (`adoptComponents`,
[`src/plugin-host/loom-api.ts`](../src/plugin-host/loom-api.ts) — see "How a
component is adopted" below), and the caller can't tell which is which:

```ts
export interface ModulatorComponent {
  id: string;
  name: string;
  driver: 'time' | 'gate';        // 'time' = clock-driven (LFO, S&H); 'gate' = note-driven (ADSR)
  scopes: ModulatorScope[];       // ('shared' | 'per-voice')[] — first entry is the default
  idPrefix: string;               // 'lfo' → lfo1, lfo2…
  defaultState(id: string): ModulatorState;
  params?: EngineParamSpec[];     // rendered by the host's generic panel — a
                                   // plugin's compiled main.js cannot import lit-html
  configTemplate?(mod, ctx): TemplateResult;   // built-ins only, e.g. lfo.ts
  createVoice(ctx, opts: { state: ModulatorState; bpm: () => number }): ModulatorVoice;
}
```

The built-in LFO and ADSR call `registerModulator(...)` at module scope in
[`src/plugins/modulators/lfo.ts`](../src/plugins/modulators/lfo.ts) and
`adsr.ts` — note that despite living under `src/plugins/`, they do **not**
export a `PluginFactory` and are not found by the glob's shape check; the glob
only imports the file (which is what makes the module-scope
`registerModulator` call run). If you're adding a **built-in** modulator, that
is the pattern to copy: a `ModulatorComponent` with your own `createVoice` and,
optionally, a hand-built `configTemplate` for a layout the generic grid can't
express (the LFO's FREE/SYNC toggle is why it has one; most modulators don't
need one — see S&H below).

**The old "third kind of modulator is unreachable" ceiling is gone.** Every
caller that used to hardcode `'lfo' | 'adsr'` now asks the registry instead:

- The MODULATORS panel's buttons are built from `listModulators()`
  ([`modulation-ui.ts:64`](../src/modulation/modulation-ui.ts)), not a
  hardcoded `+ LFO` / `+ ADSR` pair.
- `ModulationHostImpl.addModulator`/`spawnVoiceFiltered`
  ([`modulation-host.ts`](../src/modulation/modulation-host.ts)) ask
  `getModulator(kind)` for every kind, never a switch on `'lfo'`/`'adsr'`.
- Inside the worklet, `ModLite.kind` is `string`, not `'lfo' | 'adsr'`
  ([`modulation-runtime.ts:37`](../src/audio-dsp/modulation-runtime.ts)); a
  `driver: 'time'` component's per-sample maths is a `ModulatorKernel`
  registered by `id` into
  [`src/audio-dsp/modulator-kernels.ts`](../src/audio-dsp/modulator-kernels.ts) —
  the same `registerModulatorKernel` door the plugin ABI's `Loom` global
  exposes (see below).

[`plugins/sh/`](../plugins/sh/) — Sample & Hold — is the proof: a `driver:
'time'` modulator the host's core code has never heard of, brought in entirely
through a plugin manifest, with no `configTemplate` of its own (its `rate` and
`bipolar` params render through the generic panel,
[`generic-mod-config.ts`](../src/modulation/generic-mod-config.ts)), and it
shows up as an ordinary `+ S&H` button next to `+ LFO`/`+ ADSR`.
[`tests/e2e/plugin-modulator.spec.ts`](../tests/e2e/plugin-modulator.spec.ts)
drives it end to end: opens a lane, clicks `+ S&H`, asserts the card and its
`Rate` control render.

A **`driver: 'gate'`** component (an ADSR-alike, envelope keyed to the note) is
still host-only: it travels the renderer's per-voice envelope road
(`ModEnvSpec`/`ModEnvHost`), which the external ABI does not open to plugins
yet — `ModEnvHost` is exported from `@loom/plugin-sdk` for an *engine* plugin to
consume (Karplus does, for its own ADSR offsets), but a plugin cannot currently
**author** a new gate-driven modulator kind, only a time-driven one.

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

## An engine can be a plugin: what changed

Registering a `kind: 'engine'` `PluginFactory` **through the in-tree glob**
still gets you nowhere on its own — that part of the old claim survives, just
under the new name. `bootstrapPlugins` wraps every registered engine
**descriptor** in a bridge factory so `listPlugins('engine')` keeps seeing
every engine (`main.ts` derives the preset-loader id list from it:
`listPlugins('engine').map(p => p.manifest.id)`), and that bridge's `create()`
throws on purpose
([`plugin-bootstrap.ts:85-90`](../src/app/plugin-bootstrap.ts)) — a tripwire
for anyone who calls `createInstance('engine', …)` instead of going through the
lane allocator.

**But the engine *selector* was never reading that registry**, and that is the
part the old page got backwards. `melodicSynthEngineIds()`
([`engine-selector-ui.ts:41-45`](../src/engines/engine-selector-ui.ts)) reads
`listEngines('polyhost')` — the **engine** registry
([`src/engines/registry.ts`](../src/engines/registry.ts)), a different map from
the plugin registry entirely. Its own comment explains why this matters: a
runtime plugin registers its engine through the host's `adoptComponents`,
reading straight from its validated manifest, never through the build-time
glob, so it can never appear in `listPlugins('engine')` — reading from the
engine registry instead is "the whole 'a plugin is a first-class engine'
claim."

`adoptEngine` (the external ABI's handler,
[`src/plugin-host/loom-api.ts`](../src/plugin-host/loom-api.ts)) builds a
descriptor with `createDescriptorEngine(...)` from the manifest and calls
`registerEngineFactory` + `registerEngine` — **exactly the same two calls** an
in-tree `src/engines/<id>.ts` file makes at module scope. So a plugin engine
and a built-in one are, from the selector's point of view, indistinguishable:
same registry, same descriptor shape.
[`tests/e2e/plugin-karplus.spec.ts`](../tests/e2e/plugin-karplus.spec.ts)
verifies this end to end — it loads the real page, waits for `#engine-select`
to contain "Karp", and separately proves a missing plugin directory just
removes the option with no console error.

What's still true from the old five-step in-tree recipe — and what a plugin
gets **for free** instead:

| In-tree step (5 steps, 3 fail silently) | Plugin equivalent |
| --- | --- |
| 1. `src/engines/<id>.ts` descriptor + `registerEngineFactory`/`registerEngine` | Done automatically by `adoptEngine` from your `plugin.json`'s `engine` component |
| 2. `src/audio-dsp/<id>-renderer.ts`, `registerRenderer` | Your `dsp.js` calls `Loom.registerRenderer(id, make)` — same function, reached through the global |
| 3. Side-effect import in `loom-processor.ts` | Not needed — the host `addModule`s your `dsp.js` into the worklet at runtime ([`plugin-dsp.ts`](../src/plugin-host/plugin-dsp.ts)) |
| 4. Add the id to `WORKLET_ENGINE_IDS` in `lane-allocator.ts` | Not needed — `WORKLET_ENGINE_IDS.has()` OR's in `isWorkletHosted(id)`, true for **every** id that arrived through a plugin manifest ([`lane-allocator.ts:38-41`](../src/app/lane-allocator.ts), backed by [`plugins/capabilities.ts`](../src/plugins/capabilities.ts)) |

If you're a contributor adding a **built-in** engine (shipping inside the app,
not as a separate directory), the five-step in-tree recipe is unchanged and is
documented in full in
[the developer guide](manual/11-developer-guide.md#add-a-synth-engine) — follow
that for an in-tree engine. Caveat: that chapter's own prose around plugin
kinds (`kind: 'synth'`, `listPlugins('synth')`, the modulator ceiling) predates
this rewrite and has the same drift this page just had; trust its five-step
recipe and its file/line citations, not its framing of what a plugin is.

### Presets for an engine

**In-tree**, create `public/presets/<engineId>.json`:

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

The id does not need registering anywhere. `src/main.ts` derives the list from
the registry — `listPlugins('engine').map((p) => p.manifest.id)` — so once the
engine is registered and the JSON exists, the preset loader reads it at boot.

**A plugin ships its own presets file** instead, named by `plugin.json`'s
`presets` field (Karplus: `"presets": "presets.json"`) and read from the
plugin's own directory. `loadPlugins()` fetches it and calls
`seedEnginePresets(manifest.id, …)` into the **same** preset cache
`public/presets/*.json` fills — *before* the component is adopted (and
therefore before any `main.js` import too), because the engine descriptor
reads `getCachedPresets(id)` the moment `adoptComponents` builds it. You never
touch `public/presets/`.

`gm` maps presets to GM program numbers for MIDI import (both cases). The keys
in `params` are that engine's own param ids.

---

## Param specs

`manifest.params: ParamSpec[]` is the single source of truth. It drives:

- **Knobs and selects** — the inspector builds controls from it automatically
- **Automation ids** — each continuous param becomes `${laneId}.${spec.id}`
  (e.g. `subtractive-1.filter.cutoff`)
- **Modulation destinations** — continuous params appear in the dropdown
- **Presets** — preset JSON uses the same `id` keys

Full host-internal shape
([`src/engines/engine-params.ts`](../src/engines/engine-params.ts)):

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
  group?: string;          // an id from the component's own `groups` table; absent
                            // ⇒ the leading ungrouped row (see "Editor layout" below)
  options?: Array<{ value: string; label: string }>;   // discrete only
  selectStyle?: 'dropdown';                            // discrete only
  showLabel?: boolean;                                 // discrete only
}
```

An in-tree `fx`/`engine`/`notefx` plugin gets this whole shape — it shares the
host's real type. A plugin built against the external, manifest-based
`@loom/plugin-sdk` ABI (e.g. [`plugins/karplus/`](../plugins/karplus/), an
`engine` component) type-checks against a smaller `EngineParamSpec`
([`packages/loom-plugin-sdk/src/manifest.ts`](../packages/loom-plugin-sdk/src/manifest.ts)):
only `id`, `label`, `kind`, `min`, `max`, `default`, `unit?`, `options?` and
`group?`. `curve`, `color`, `drawnBy`, `selectStyle` and `showLabel` are not
declared there — an external engine or modulator manifest cannot set them.

`validateSpec` is the contract a new spec has to satisfy: an id and a label are
required, a continuous param needs `max > min`, and a discrete one needs at
least two options. `manifest-validate.ts` enforces the equivalent checks for an
external manifest (see [Validation](#validation) below) — the two are meant to
agree but are two separate hand-written checkers, not one shared function.

**Every discrete param renders as a select control, everywhere — never a
knob.** ≤4 options draw a radio strip; more than 4, or `selectStyle:
'dropdown'`, draw a native `<select>`. That much holds on every surface a
discrete param can be drawn on: the inspector's grouped grid, the flat
layout (drum rack, sampler pads), the FX insert rack, and a modulator's own
config card.

The strip's *shape* is not universal, though. The engine param grid and the
FX insert rack stack it VERTICALLY, at a fixed ~50px width (a knob's own
footprint), by passing `compact: true` to `createSelectControl`. A
modulator's config card leaves `compact` unset and keeps the base
HORIZONTAL strip — its layout is a row, not a knob grid, and the vertical
shape stretches it. That includes a plugin modulator's own declared
`params`: they render through the same select-control rule, via
`generic-mod-config.ts`, horizontally like every other modulator card. If
you're choosing how many options to give a discrete param, 4 is the
threshold that decides strip vs. dropdown — keep that in mind picking option
counts, not just labels.

Naming conventions, which the modulation panel groups by and the preset JSON
uses:

- `filter.cutoff`, `filter.resonance`, `filter.envAmount`
- `amp.attack`, `amp.decay`, `amp.sustain`, `amp.release`, `amp.gain`
- `osc.wave`, `osc.detune`, `osc.level`
- `bus.reverbSend`, `bus.delaySend`, `bus.eq.low` (the drums bus)
- `opN.ratio`, `opN.detune`, `opN.level` (FM)

### Editor layout: `groups`

`groups` is how an `engine` component lays its params out as labelled
sections instead of one flat list. It means nothing for `fx`, a modulator or
`notefx` — those render through a generic panel with no section layout, so a
`groups` table on anything but an `engine` component is simply never read.
This applies identically whether the engine is in-tree or an external plugin —
`ComponentManifest`'s `engine` arm declares the same `groups?: EngineParamGroup[]`
the host's own `EngineDescriptor` does.

A component that declares no `groups` still renders: every param lands in
one row per raw `group` string (or the leading ungrouped row when a param has
none), in first-appearance order — the same fallback a built-in engine gets
when it has no table either. `groups` exists for when that fallback is not
what you want: named sections, in a chosen order, several packed onto one
line, coloured knob rings.

```ts
interface EngineParamGroup {
  id: string;      // the key an EngineParamSpec's own `group` points at
  title: string;   // the section header
  row?: number;    // groups sharing a row index render side by side,
                    // divided by a rule; default: a row of its own,
                    // in declaration order
  color?: string;   // CSS colour for the section's knob rings; a param's
                    // own `color` (host engines only) wins when both are set
}
```

[`plugins/karplus/plugin.json`](../plugins/karplus/plugin.json) is the
shipped example: STRING and EXCITE share row 0, AMP and POLY share row 1,
and each param points back at its section by id:

```json
{
  "params": [
    { "id": "string.damping", "label": "Damping", "kind": "continuous",
      "min": 0, "max": 1, "default": 0.5, "group": "string" },
    { "id": "excite.time", "label": "Excite", "kind": "continuous",
      "min": 0.001, "max": 0.1, "default": 0.01, "unit": "s", "group": "excite" },
    { "id": "amp.attack", "label": "Attack", "kind": "continuous",
      "min": 0.001, "max": 0.5, "default": 0.005, "unit": "s", "group": "amp" }
  ],
  "groups": [
    { "id": "string", "title": "STRING", "row": 0, "color": "var(--knob-cyan)" },
    { "id": "excite", "title": "EXCITE", "row": 0, "color": "var(--knob-orange)" },
    { "id": "amp",    "title": "AMP",    "row": 1, "color": "var(--knob-purple)" }
  ]
}
```

A group with no member param, or a param whose `group` names no declared
entry, is not an error — see the fallback above — but it is dead weight:
every declared group should have at least one param pointing at it, and vice
versa.

---

## The external plugin ABI

Everything above is the in-tree SPI. This section is the manifest-based ABI: a
plugin directory under `plugins/`, compiled by its own CLI, loaded by the
browser at runtime from `public/plugins/` with no build-time coupling to
Loom's own source.

### Anatomy of a plugin directory

```text
plugins/karplus/
  plugin.json     # the manifest — data only, and the ONLY file every plugin
                   # needs. A component is adopted straight from this, by the
                   # host — see "How a component is adopted" below.
  dsp.ts          # per-sample DSP half — runs in the AudioWorklet + on the
                   # main thread for offline export (optional: omit for a
                   # component with no per-sample signal of its own)
  main.ts         # main-thread CODE (optional: omit unless you have some —
                   # a component's metadata needs none, so most plugins skip
                   # this file entirely; see below)
  presets.json    # optional — this engine's preset bank
```

`npm run build:plugins` (`node tools/loom-plugin/cli.mjs build plugins/*`)
bundles each into `public/plugins/<id>/` with esbuild — `format: 'esm'`,
`target: 'es2022'`, `platform: 'neutral'`, aliasing `@loom/plugin-sdk` to its
source — and **refuses to build a bundle that reaches into `src/`**
([`tools/loom-plugin/build.mjs:76-84`](../tools/loom-plugin/build.mjs)): a
plugin may only import `@loom/plugin-sdk` and its own files. That check is what
makes "drop-in" true rather than aspirational. `npm run build` always runs
`build:plugins` first, so a plugin's build artefacts are never stale in a
production build.

### How a component is adopted

`loadPlugins()` ([`src/plugin-host/plugin-host.ts`](../src/plugin-host/plugin-host.ts))
fetches `plugin.json`, validates it, and then calls
`adoptComponents(manifest.components)`
([`src/plugin-host/loom-api.ts`](../src/plugin-host/loom-api.ts)) — **before**
importing `main`, if the manifest declares one. This is the ONE path a
component enters by: the host builds the engine descriptor or modulator
registration directly from the file it just validated. `globalThis.Loom` has
no `registerComponent` — a component's whole description (id, params,
capabilities or modulator declaration, groups, default modulator set) is DATA,
and data travels in `plugin.json`, not through a function call on a global.
`main.js` exists only for a plugin author's own main-thread CODE; most
plugins — Karplus and S&H both — need none and ship no `main` field at all.

If a plugin fails after its components were adopted (its `main.js` throws, for
instance), the rollback is automatic: whatever `adoptComponents` just
registered for that plugin is undone, so a broken plugin ends up fully absent,
never half-installed with an engine sitting in the selector and no DSP behind
it.

### `plugin.json` — every field

```jsonc
{
  "id": "karplus",           // required, non-empty
  "name": "Karp",            // required — display name
  "version": "1.0.0",        // required (not currently checked against anything)
  "loomApi": 1,               // required — MUST equal LOOM_API_VERSION (currently 1);
                               // the host refuses to load anything else
  "author": "Loom",           // optional
  "main": "main.js",          // optional — entry point for MAIN-THREAD CODE.
                               // Most plugins omit it entirely: a component's
                               // metadata is adopted straight from THIS file
                               // (see "How a component is adopted" above), so
                               // main.js has nothing left to do unless you need
                               // to register something the manifest can't
                               // carry as JSON — a function. Karplus and S&H
                               // both ship none.
  "dsp": "dsp.js",             // optional — entry added to the AudioWorklet (and
                               // imported on the main thread for offline render);
                               // absent means this plugin has no per-sample DSP
  "presets": "presets.json",  // optional — preset file, relative to the plugin dir
  "private": false,           // optional — see "Private plugins" below
  "components": [ /* ComponentManifest[] — see below; REQUIRED, at least one */ ]
}
```

`components` is required even though it's an array a manifest could
theoretically leave empty — a manifest with no components contributes nothing,
and making the field optional would let the old dead shape (`engines: [...]`)
validate, load, and silently register zero components.

#### An `engine` component

```jsonc
{
  "kind": "engine",
  "id": "karplus", "name": "Karp",
  "polyphony": "poly",          // 'mono' | 'poly'
  "params": [ /* EngineParamSpec[] — see "Param specs" above */ ],
  "groups": [ /* EngineParamGroup[], optional — see "Editor layout" above */ ],
  "modulators": [ /* the DEFAULT modulator set a fresh lane on this engine gets */ ],
  "capabilities": {
    "clipContent": "notes",          // required: 'notes' | 'audio'
    "shortLabel": "karplus",         // required — prefix for generated lane ids
    "outputTrim": 0.857,             // required — output balance vs. other engines;
                                       // no default on purpose: an omitted trim would
                                       // otherwise guess 1 and ship louder than everything else
    "defaultNoteView": "pitches",    // optional: 'pitches' | 'pads', default 'pitches'
    "accepts": ["audio-file"],       // optional — drag-and-drop targets, default none
    "acceptsNoteFx": true,           // optional, default true
    "harmonic": true,                // optional, default true — can host a chord accompaniment
    "isRandomizable": true,          // optional, default true — the 🎲 dice
    "gm": { "keywords": ["guitar", "gtr", "pluck", "nylon"], "priority": 10 }  // optional
  }
}
```

`capabilities` is the ONE door the core asks "what can this component do"
through — [`src/plugins/capabilities.ts`](../src/plugins/capabilities.ts):
"two sources, and the caller cannot tell which" (a built-in registers from
code, a plugin from its manifest). An unset field never means undefined
behaviour: every accessor has a named default (see the field comments above),
because an engine the host has never heard of must still behave like an
ordinary melodic instrument, not silently vanish from part of the UI.

#### A `modulator` component

```jsonc
{
  "kind": "modulator",
  "id": "sh", "name": "S&H",
  "params": [
    { "id": "rate", "label": "Rate", "kind": "continuous", "min": 0.1, "max": 20, "default": 6, "unit": "Hz" },
    { "id": "bipolar", "label": "Bipolar", "kind": "discrete", "min": 0, "max": 1, "default": 1,
      "options": [{ "value": "unipolar", "label": "Unipolar" }, { "value": "bipolar", "label": "Bipolar" }] }
  ],
  "modulator": { "driver": "time", "scopes": ["shared", "per-voice"], "idPrefix": "sh" }
}
```

`groups` and `capabilities` are engine-only — a modulator component declares
neither (there's no lane or editor layout to speak of) and
`manifest-validate.ts` returns before checking either once `kind === 'modulator'`.

### Validation

`src/plugin-host/manifest-validate.ts` runs **before a single line of plugin
code is evaluated** — a malformed manifest fails as data, not as a mid-boot
exception, and one bad plugin never takes the app down with it (`loadPlugins()`
records the failure per plugin id and keeps going). Every rejection message it
can produce, so you know what a mistake looks like from the outside:

- Top level: `id`/`name`/`version` must each be a non-empty string; `loomApi`
  must equal the host's `LOOM_API_VERSION` exactly (`"loomApi ... is not
  supported (host speaks 1)"`); `main`/`dsp`/`presets` must each be a
  non-empty string IF PRESENT — none of the three is required, and a manifest
  with none of them is a valid, data-only plugin; `private` must be a boolean
  if present; `components` must be an array.
- Every component: `kind` must be `engine` or `modulator`; `id`/`name` required
  strings; `params` an array, each entry checked like the host's own
  `validateSpec` (id, label, `kind: continuous|discrete`, numeric `min`/`max`/
  `default`, `group` a string if present).
- `engine` only: `polyphony` must be `mono`/`poly`; `groups` (if present) must
  be an array of `{ id, title, row?, color? }` with the same field types as
  above; `capabilities.clipContent` must be `notes`/`audio`,
  `capabilities.shortLabel` a non-empty string, `capabilities.outputTrim` a
  number (no default — see above), `accepts` an array of `'audio-file'`,
  `acceptsNoteFx`/`harmonic`/`isRandomizable` booleans if present, `gm` (if
  present) `{ keywords: string[], priority: number }`.
- `modulator` only: `driver` must be `time`/`gate`; `scopes` a non-empty array
  of `shared`/`per-voice`; `idPrefix` a non-empty string.

`tools/loom-plugin/build.mjs` runs a second, independent (and looser) check at
**build** time, `assertValidManifest` — it exists to fail a broken plugin
before it's even copied into `public/`, not to replace the runtime check above.

### How the DSP half reaches the AudioWorklet

A plugin's compiled JS cannot `import` anything of the host's — esbuild bundles
and hashes every host module, so there is no stable name to import, and a
separately `addModule`'d worklet module does not even share module *instances*
with the main thread or with another worklet module. The meeting point for
CODE is therefore a **global**, `globalThis.Loom`, installed **fresh in every
realm** before any plugin code runs there — and it carries CODE ONLY. A
component's own description is DATA and travels in `plugin.json` instead (see
"How a component is adopted" above), so both realms install the exact same
shape:

- **Main thread**: `installMainThreadLoomApi()`
  ([`src/plugin-host/loom-api.ts`](../src/plugin-host/loom-api.ts)) installs
  `{ apiVersion, registerRenderer, registerModulatorKernel }`. The offline
  exporter runs the same pure renderer kernel on this same thread, which is
  why `registerRenderer` is exposed here too, not only in the worklet.
- **AudioWorklet**: [`loom-processor.ts`](../src/audio-worklet/loom-processor.ts)
  installs the identical `{ apiVersion, registerRenderer, registerModulatorKernel }`
  at module top level, **before** any plugin `dsp.js` is added, because the host `await`s this
  module's own `addModule` first
  ([`main.ts:135-142`](../src/main.ts)).

Your `dsp.js` calls `Loom.registerRenderer(id, (note, params, sampleRate) =>
new MyRenderer(...))` at module scope — the exact same function name the host's
own renderers call internally, just reached through the global instead of an
import. `loadPluginDspModules` (worklet) and `importPluginDspOnMainThread`
(main thread) — both in
[`src/plugin-host/plugin-dsp.ts`](../src/plugin-host/plugin-dsp.ts) — add every
plugin's `dsp.js` to both realms after the host's own worklet module has
registered, so both realms end up with your renderer.

One more wrinkle: `public/` files are static assets, and Vite's dev-server
transform middleware refuses to serve one as an ES module import — so the
loader always fetches the source as text and evaluates it through a `blob:`
URL ([`src/plugin-host/module-loader.ts`](../src/plugin-host/module-loader.ts)),
identically in dev and in the production build. This is also the mechanism a
future user-installed plugin (bytes in IndexedDB, no fixed URL at all) will
need, so it was built as the one path from the start rather than a
build-only fast path plus a separate dev workaround.

[`tests/e2e/worklet-external-module.spec.ts`](../tests/e2e/worklet-external-module.spec.ts)
is a synthetic, isolated proof of exactly this mechanism — a hand-written host
module plus two tiny stub plugins (one loaded from a `blob:` URL, one over
plain HTTP) — with a header comment explaining why the ABI has to be a global.
It is a narrow spike, not a run of any real plugin's actual `dsp.js`; running it
in isolation at the time this page was written passed, but treat it as proof of
the `addModule`-sharing mechanism, not as an end-to-end guarantee for every
plugin. For that, [`tests/e2e/plugin-karplus.spec.ts`](../tests/e2e/plugin-karplus.spec.ts)
and [`tests/e2e/plugin-modulator.spec.ts`](../tests/e2e/plugin-modulator.spec.ts)
load the real app and the real `public/plugins/karplus`/`public/plugins/sh`,
which is closer to what an author should trust.

### Building and installing a plugin

```bash
# Scaffold a new plugin: a minimal but real, audible sine-wave engine
# (amp.level + amp.release params), written to plugins/<name>/
node tools/loom-plugin/cli.mjs new plugins/my-synth        # TypeScript
node tools/loom-plugin/cli.mjs new plugins/my-synth --js   # plain JS

# Build every non-private plugin directory under plugins/ into public/plugins/
# and (re)write public/plugins/index.json — this is what `npm run build` runs
# for you automatically (`build:plugins` in package.json)
node tools/loom-plugin/cli.mjs build plugins/*

# Build ONE plugin by name (works for a private one too, e.g. plugins/audio-probe,
# a test-only fixture — see "Private plugins" below)
node tools/loom-plugin/cli.mjs build plugins/my-synth
```

(`npm run plugin` is an alias for `node tools/loom-plugin/cli.mjs`, so `npm run
plugin -- build plugins/my-synth` also works.)

`plugins/index.json` is the discovery mechanism — the browser cannot list a
directory, so `loadPlugins()` fetches `${base}plugins/index.json`, then each
listed id's `plugin.json`, in order, failing individually and continuing on
error. The build tool regenerates the whole index from whatever exists under
`public/plugins/`, sorted, **excluding any `private: true` manifest**.

#### Private plugins

`plugin.json`'s `private: true` means: buildable by name for tests and tooling,
but never swept by the `plugins/*` glob and never written into `index.json` —
i.e. never reachable to a real user. [`plugins/audio-probe/`](../plugins/audio-probe/)
is the shipped example: an `engine` component with `clipContent: 'audio'` and
no params, built on demand by tests, absent from
[`public/plugins/index.json`](../public/plugins/index.json) (which currently
lists the seven non-private plugins: `fm`, `karplus`, `sh`, `subtractive`,
`tb303`, `wavetable`, `westcoast`).

---

### Worked example: Karplus

[`plugins/karplus/`](../plugins/karplus/) is a complete, currently-shipping
engine plugin — and it ships **no `main.ts`/`main.js` at all**: its directory
is only `plugin.json` + `dsp.ts` + `presets.json`.

**`plugin.json`** declares one `engine` component: 9 params across four groups
(`string`/`excite`/`amp`/`poly`, laid out STRING+EXCITE on row 0 and AMP+POLY
on row 1 — the exact example under ["Editor layout"](#editor-layout-groups)
above), a default modulator set (a shared LFO plus a per-voice ADSR, both
disconnected until the user patches them), and
`capabilities: { clipContent: 'notes', shortLabel: 'karplus', outputTrim: 0.857,
gm: { keywords: [...], priority: 10 } }`. That is the entire main-thread
description — the host adopts it straight from this file (see "How a
component is adopted" above), so there is no metadata-registration code to
write at all.

**`dsp.ts`** is the real work: a per-sample Karplus-Strong string model
(`KarplusRenderer implements VoiceRenderer`), ending in
`Loom.registerRenderer('karplus', (n, p, sr) => new KarplusRenderer(n, p, sr))`.
Its own header comment is worth reading as a template for how to think about
which params should read live vs. frozen: the excitation burst and amp envelope
times are read **once at trigger** (the pluck is over in tens of milliseconds,
long before a knob could move), while `string.damping` and `string.brightness`
drive a real per-sample delay-line loop and are re-read every sample via
`setLiveParams(live: ParamBag)` — `@loom/plugin-sdk`'s equivalent of the host's
own live-param contract (see `CLAUDE.md`'s "Live param tweaks reach the note
already sounding"). It imports only `@loom/plugin-sdk` (`param`, `midiToFreq`,
`velGain01`, `ModEnvHost`, and the `NoteSpec`/`ParamBag`/`VoiceRenderer`/
`VoiceModOffsets`/`ModEnvSpec` types) — nothing from `src/`, which is exactly
what the build's drop-in guard enforces.

**`presets.json`** is the engine's preset bank, seeded into the shared preset
cache before the component is adopted (see ["Presets for an engine"](#presets-for-an-engine)
above) — `adoptComponents` reads `getCachedPresets(id)` the moment it builds
the engine descriptor, so the presets have to already be in the cache by then.

`plugins/karplus/dsp.test.ts` and `karplus-parity.dsp.test.ts` test the pure
renderer directly (no `AudioContext`, no `Loom` global beyond a two-line stub
providing `registerRenderer`) — proof, by construction, that the DSP half needs
nothing from the host beyond that one call.

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
you never touch the SaveManager for a new plugin. This is identical for an
in-tree engine and a plugin engine — a lane's `engineId` is just a string, and
the save format has no idea whether it names something built in or something
loaded from `public/plugins/`.

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
the spec is enough. Modulation for the six built-in melodic engines — and for a
plugin engine like Karplus — is applied per sample inside the worklet by
`ModulationRuntime`, and `getAudioParams()` on those engines is deliberately
empty ([`worklet-lane-engine.ts:150`](../src/engines/worklet-lane-engine.ts)).
Only Drums and Sampler expose shared `AudioParam`s, via `getSharedAudioParams()`.

---

## The registry

```ts
import { registerPlugin, getPlugin, listPlugins, createInstance } from '../plugins/registry';

registerPlugin(myFxPlugin);                       // done by the bootstrap for fx/engine
const factory = getPlugin('fx', 'my-fx');         // the factory for one id
const allFx = listPlugins('fx');                  // every registered FX
const inst = createInstance('fx', 'my-fx', ctx);  // build an instance
```

The registry is keyed `${kind}:${id}` over `PluginKind = 'engine' | 'fx' |
'notefx'`, so the same id under two kinds cannot collide. `createInstance` only
does anything for `'fx'` — calling it with `'engine'` returns the tripwire
throw described above, and `'notefx'` returns `undefined` (there's no
instance, just `defaultParams()`). A modulator is never looked up here at all —
see [`modulator-registry.ts`](../src/modulation/modulator-registry.ts) instead.

---

## Checklist

**In-tree FX / engine / note-FX:**

- [ ] `src/plugins/{fx,notefx}/<name>.ts` (or `src/engines/<id>.ts` for an
      engine) exporting the right factory shape — the glob finds an FX/engine
      one; a note-FX must call `registerPlugin` itself
- [ ] Continuous params you want modulatable are also in `getAudioParams()`
      (FX only — a melodic engine's is deliberately empty)
- [ ] `getAudioParamRange` for anything frequency-shaped (FX only)
- [ ] `dispose()` disconnects every node it created
- [ ] `npx tsc --noEmit`, then the tests
- [ ] Browser smoke test: add the insert, move a param, modulate it, save and
      reload

**External plugin (`plugins/<id>/`):**

- [ ] `plugin.json` validates — `node tools/loom-plugin/cli.mjs build
      plugins/<id>` fails loudly if it doesn't pass `assertValidManifest`, and
      the runtime `manifest-validate.ts` check is stricter still
- [ ] No `main.ts`/`main.js` unless you have real main-thread CODE to
      register — a component's own metadata needs none; the host adopts it
      straight from `plugin.json` (see "How a component is adopted"). Karplus
      and S&H both ship none.
- [ ] `dsp.ts`/`dsp.js` (if you have per-sample DSP) calls
      `Loom.registerRenderer(id, make)` (engine) or a `driver: 'time'`
      modulator's kernel calls `Loom.registerModulatorKernel({...})`
- [ ] Imports only `@loom/plugin-sdk` and your own files — the build's
      drop-in guard rejects anything reaching into `src/`
- [ ] `npm run build:plugins`, then open the app and check `#engine-select`
      (engine) or the MODULATORS panel's `+` buttons (modulator) for your
      component
- [ ] `public/plugins/index.json` lists your id (unless it's deliberately
      `private: true`)

## Tests worth writing

- **Manifest** — import the plugin, assert `manifest.params` has the expected ids
- **Round trip** — `setBaseValue` every param, `getBaseValue` returns what was
  written
- **Modulation** — `getAudioParams()` includes every continuous param you intend
  to be modulatable (FX only)
- **Dispose** — after `dispose()` the nodes are disconnected
- **DSP kernel, no Web Audio** — for an external plugin's `dsp.ts`, stub
  `globalThis.Loom` to just `{ apiVersion: 1, registerRenderer() {} }` and test
  the renderer class directly, as `plugins/karplus/dsp.test.ts` does
- **e2e presence, not absence** — for an external plugin, assert your
  component actually *appears* in the real page (selector option / panel
  button), the way `plugin-karplus.spec.ts` and `plugin-modulator.spec.ts` do.
  This codebase has twice shipped an acceptance test that certified an
  *absence* and stayed green while the plugin it was meant to cover was
  actually broken — see `plugin-modulator.spec.ts`'s header comment.

[`src/plugins/registry.test.ts`](../src/plugins/registry.test.ts) and
[`src/plugins/fx/insert-chain.test.ts`](../src/plugins/fx/insert-chain.test.ts)
are the in-tree patterns to copy.

---

## Quick reference

**In-tree SPI:**

- **SPI types** — [`src/plugins/types.ts`](../src/plugins/types.ts)
- **Registry** — [`src/plugins/registry.ts`](../src/plugins/registry.ts)
- **Bootstrap** — [`src/app/plugin-bootstrap.ts`](../src/app/plugin-bootstrap.ts)
- **FX plugins** — [`src/plugins/fx/`](../src/plugins/fx/)
- **Built-in modulators** — [`src/plugins/modulators/`](../src/plugins/modulators/) +
  [`src/modulation/modulator-registry.ts`](../src/modulation/modulator-registry.ts)
- **Note-FX plugins** — [`src/plugins/notefx/`](../src/plugins/notefx/) +
  [`src/notefx/`](../src/notefx/)
- **Engine descriptors** — [`src/engines/`](../src/engines/), built on
  [`descriptor-engine.ts`](../src/engines/descriptor-engine.ts)
- **Param spec** — [`src/engines/engine-params.ts`](../src/engines/engine-params.ts)
- **Preset loader** — [`src/presets/preset-loader.ts`](../src/presets/preset-loader.ts)
- **Modulation host** — [`src/modulation/modulation-host.ts`](../src/modulation/modulation-host.ts)
- **Lane allocator** — [`src/app/lane-allocator.ts`](../src/app/lane-allocator.ts)
- **Automation destinations** — [`automation-destinations.md`](automation-destinations.md)

**External plugin ABI:**

- **SDK** — [`packages/loom-plugin-sdk/`](../packages/loom-plugin-sdk/)
  (`manifest.ts` for `ComponentManifest`/`EngineParamSpec`/`LoomApi`,
  `types.ts` for `NoteSpec`/`ParamBag`/`VoiceRenderer`)
- **Discovery + load** — [`src/plugin-host/plugin-host.ts`](../src/plugin-host/plugin-host.ts)
- **Validation** — [`src/plugin-host/manifest-validate.ts`](../src/plugin-host/manifest-validate.ts)
- **Runtime handshake (main thread)** — [`src/plugin-host/loom-api.ts`](../src/plugin-host/loom-api.ts)
- **Runtime handshake (worklet)** — [`src/audio-worklet/loom-processor.ts`](../src/audio-worklet/loom-processor.ts)
- **DSP delivery to both realms** — [`src/plugin-host/plugin-dsp.ts`](../src/plugin-host/plugin-dsp.ts)
- **blob: module loading** — [`src/plugin-host/module-loader.ts`](../src/plugin-host/module-loader.ts)
- **Capabilities (the one door for "what can this component do")** —
  [`src/plugins/capabilities.ts`](../src/plugins/capabilities.ts)
- **CLI** — [`tools/loom-plugin/cli.mjs`](../tools/loom-plugin/cli.mjs)
  (`build.mjs` for the esbuild + drop-in guard, `scaffold.mjs` for `new`)
- **Worked examples** — [`plugins/karplus/`](../plugins/karplus/) (engine),
  [`plugins/sh/`](../plugins/sh/) (modulator),
  [`plugins/audio-probe/`](../plugins/audio-probe/) (private, test-only)
- **e2e coverage** — [`tests/e2e/plugin-karplus.spec.ts`](../tests/e2e/plugin-karplus.spec.ts),
  [`tests/e2e/plugin-modulator.spec.ts`](../tests/e2e/plugin-modulator.spec.ts),
  [`tests/e2e/worklet-external-module.spec.ts`](../tests/e2e/worklet-external-module.spec.ts)
