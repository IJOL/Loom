# Developer Guide

This chapter is for contributors who want to extend Loom or understand how its internals fit together. Read it alongside `CLAUDE.md` at the repo root, which is the shortest architecture summary the project keeps — this chapter expands on it in prose.

Both drift. Where a document and the code disagree, **the code is right**: every claim below carries the file it was checked against, so you can check it again.

## The spine

Three structures hold everything together:

1. **A plugin registry** — engines, FX and modulators are all plugins, and most of them are no longer in this repository's source at all. A plugin is a directory under `plugins/`, compiled into `public/plugins/<id>/`, and loaded by the browser **at runtime** off a JSON manifest; it compiles against `@loom/plugin-sdk` and talks to the host through one small runtime ABI, `globalThis.Loom`. Six engines, fifteen inserts and one modulator ship that way today. A shrinking in-tree SPI, discovered by a Vite `import.meta.glob` scan, still carries the LFO/ADSR modulators and the note-FX.

2. **`SessionState`** — the pure data model: lanes contain clips, scenes reference which clip each lane plays. No audio side-effects live here.

3. **`LaneResourceMap`** — owns the live Web Audio nodes for each lane. One entry per lane, holding a `ChannelStrip`, a `SynthEngine` instance, and an `InsertChain`. The lane allocator in `src/app/lane-allocator.ts` is the sole path for creating and swapping these resources; nothing else should construct them directly.

## Boot

`src/main.ts` is a boot script, not a feature file. It builds the handful of objects everything else needs, then hands them to one wiring module per concern in `src/app/`:

- `bootstrapPlugins()` first, before anything reads the registry (`main.ts:92`), then `loadPlugins()` — the external plugins, fetched and validated (`main.ts:98`). That second one is a **promise**, and the difference matters: everything the in-tree registry knows is available synchronously, while every engine and insert that arrives from `public/plugins/` lands later. Code that enumerates components at boot sees only the built-ins unless it awaits it, which is written down at `main.ts:647`.
- `createAudioGraph()` (`main.ts:120`) and the worklet `addModule` calls, which every lane allocation waits on (`main.ts:136`–`154`). The order inside that block is load-bearing too: `loom-processor` installs `globalThis.Loom` and must be registered **before** any plugin's `dsp.js` is added, or the plugin has nothing to register its renderer with.
- The `Sequencer` (`main.ts:162`), the `DestinationRegistry` (`main.ts:170`), the lane allocator (`main.ts:192`), and the `SessionHost` (`main.ts:377`).
- Then roughly a dozen `wireX(...)` / `createXFeature(...)` calls, each of which owns one concern end to end and lives in its own file under `src/app/`.

**The order is load-bearing**, and the comments in `main.ts` say why at each step. `wireMenuBar` is deliberately the last statement of boot (`main.ts:810`): its action table names a handle from nearly every feature above, so the bar appearing is the proof that boot ran start to finish.

If you are looking for the code behind a control, it is almost never in `main.ts` — find the `wireX` call that mentions it and open that module.

## How a plugin gets in

### The external ABI — the normal case

The browser cannot list a directory, so **`public/plugins/index.json` is the discovery mechanism**: a flat array of plugin ids, rewritten by `npm run build:plugins`. For each id, `loadPlugins` (`src/plugin-host/plugin-host.ts`) fetches `plugin.json`, validates it as **data** before a single line of the plugin runs (`manifest-validate.ts`), adopts its declared components into the engine / modulator / fx registries, seeds any `presets.json`, and collects its `dsp.js` URL for the worklet.

Two properties of that loop are worth relying on:

- **Failure is contained and complete.** A plugin that throws — even one whose components were already adopted before its own module blew up — is rolled back in full and recorded in the load report. One bad plugin never takes the app down, and never leaves a half-registered engine behind: visible in the selector, silent at note time, is exactly the failure this design refuses to allow.
- **A plugin's JS is loaded through a `blob:` URL**, not a bare `import(url)` (`module-loader.ts`). A plugin is a static asset in `public/`, and Vite's dev middleware refuses to serve one as a module — so the obvious import works in the production build and breaks under `npm run dev`. Fetching the source and evaluating it from a blob behaves identically in both, and is the same mechanism a user-installed plugin will need when its bytes live in IndexedDB instead of at a URL.

The worklet half is symmetrical: `loom-processor.ts` installs `globalThis.Loom` (`registerRenderer`, `registerModulatorKernel`) and the host guarantees that module is `addModule`'d **first**, so every plugin `dsp.js` added afterwards shares the realm and can reach the registry. The ABI deliberately carries no DSP — everything a plugin uses from `@loom/plugin-sdk` is compiled into the plugin's own bundle, which is what lets the ABI stay stable across versions.

### What is left of the in-tree SPI

`src/app/plugin-bootstrap.ts` still calls `import.meta.glob` at build time over `src/engines/*.ts` and `src/plugins/**/*.ts` (`*.test.ts` excluded), and any exported value matching the `PluginFactory` shape (`{ kind, manifest, create }`) is registered. **No insert is found this way any more** — all fifteen are external. What the glob does today is mostly to *evaluate* modules so their module-scope registrations run:

- **Modulators** call `registerModulator` at module scope into `src/modulation/modulator-registry.ts` — their own door, the same one a plugin modulator arrives through. The shape check does not match them.
- **Note-FX** declare `defaultParams()` instead of `create()`, so the shape check skips them too; those files call `registerPlugin` themselves (`src/plugins/notefx/arp.ts:11`).

`bootstrapPlugins` then bridges every registered engine descriptor into the plugin registry, so `listPlugins('engine')` keeps seeing all nine.

The engine registry (`src/engines/registry.ts`) supports both a **singleton** pattern (`registerEngine`) for shared instances and a **factory** pattern (`registerEngineFactory` / `createEngineInstance`) for per-lane instances that need independent state.

### Never ask an engine its name

Anything the core needs to know about a component goes through **one door**, `src/plugins/capabilities.ts` — `clipContent`, `slide`, `outputTrim`, `acceptsNoteFx`, `defaultNoteView`, and so on. A built-in answers from code, a plugin from its manifest, and the caller cannot tell which; that is the whole point, because it is what let six engines move out of `src/` without the core noticing. Every accessor there returns a safe default for an unknown id and never `undefined` — an unregistered engine that blanked its lane's UI would fail silently. **An `engineId === '…'` comparison anywhere outside that file is a bug.**

`listEngines()` reads from the singleton map and is the source of metadata (name, type, polyphony, parameter specs) used to populate the lane engine selector.

### What "declaring a param" actually buys you

Engines declare their parameters as `EngineParamSpec[]`, and for the catalogue that is the whole story: `listAutomationTargets` walks `engine.params` and pushes `` `${lane.id}.${spec.id}` `` for every continuous one (`src/automation/automation-targets.ts:120`). Automation and the modulation dropdown both read that catalogue through `DestinationRegistry.list()`. Neither of them calls `getAudioParams()`.

`getAudioParams()` / `getSharedAudioParams()` are a narrower thing — the **Web Audio binding surface**, used only where a modulator has to reach a real `AudioParam` through the depth-gain bridge in `connection-binder.ts`. That means FX inserts, channel strips, and the two engines that still expose shared params, Drums and Sampler. For the six melodic worklet engines `getAudioParams()` returns an empty `Map` on purpose (`src/engines/worklet-lane-engine.ts:150`); their modulation is applied per sample inside the worklet by `ModulationRuntime`.

So: declare the param in the spec and it is automatable and modulatable. Return it from `getAudioParams()` only if it is a genuine `AudioParam` on the main thread.

That rule is why the lane **mixer** is automatable at all. The seven strip controls — level, pan, sends A and B, and the three EQ bands — were once declared inline by `drums-machine` alone, which is why a drum lane's volume could be automated and a Subtractive lane's could not: the capability belonged to one engine's source file rather than to the mixer. They now live in `src/core/channel-strip-params.ts` and every engine with a `ChannelStrip` spreads `STRIP_PARAM_SPECS` into its own params, keeping the original `bus.*` ids so existing drum-lane envelopes and connections still resolve. One caveat if you touch the binder side: a **modulator** binds to the strip's multiplicative trims, not to the real gains, because a bipolar modulator summed onto a gain can drive it below zero — which inverts phase instead of quietening, and the lane cancels against the rest of the mix. Automation writes the real gains through `setStripParam`.

## SessionState data model

`src/session/session-types.ts` defines three levels (re-exported from `session.ts`, which holds the factories):

- **`SessionLane`** — has an `engineId`, a list of `SessionClip | null` slots, and an `engineState` bag that persists knob values, modulator configs, note-FX, sampler keymap, pad params, and kit mode.
- **`SessionClip`** — holds `notes: NoteEvent[]` (the unified note list for both melodic and drum clips), optional `ClipEnvelope[]` for per-clip automation, and an optional `sample` field for loop/song audio clips. Clips also carry `loopEnabled` / `loopStartTick` / `loopEndTick` for sub-region looping, and a `gridResolution` hint for the drum editor.
- **`SessionScene`** — a `clipPerLane` map from lane id to clip slot index (or null for a stopped lane).

Notes carry a `velocity` field (0–127). The `velToColor` function in `src/core/velocity-color.ts` maps velocity to a blue-to-yellow ramp used by both the piano roll and the drum grid.

Saves are written as `schemaVersion: 3` (`SavedStateV3` in `src/save/`). Older saves are normalised by `session-migration.ts` at load time before anything else touches the data.

**Replacing the session is New plus a load, in that order.** Every route that swaps the whole session — New, the boot demo, the demo picker, a save or autosave load, an import that replaces — calls `resetAllResources` (`src/session/session-host-reset.ts`) *first*, and only then applies the incoming state. The reason is that applying a session only ever pushes the fields the incoming JSON happens to carry, and `ensureLaneResource` is idempotent: a lane id present in both the old and the new state used to keep its live `ChannelStrip`, so level, pan, EQ, sends, mute, compressor and sidechain rode straight through New and through every demo switch — as did the master rack, the send buses, mute/solo and the note-FX chains. The fix is not a longer list of restores at the apply site (that list goes stale the next time something joins the desk); it is that a load starts from a released desk, so anything the new state does not set sits at its constructed default. The one deliberate exception is the master **volume** fader: that is the listening level of the room, not a property of the song.

## LaneResourceMap and the audio graph

The master audio path assembled in `src/app/audio-graph.ts` runs:

```text
master (sum GainNode)
  → MasterBusStrip (EQ / pan / mute)
  → InsertChain (the master rack)
  → MasterShaper (air / glue / width)
  → MasterCompressor (the safety limiter)
  → soft-clip WaveShaper (4x oversampled)
  → AnalyserNode → ctx.destination
```

Two details of that chain are deliberate. The shaper sits **before** the limiter, because air/glue/width are mix decisions and the limiter must be the last thing that sees the signal. The soft-clip after it is the absolute ceiling: identity below ±0.8, then a tanh knee that maps everything above — including overs beyond ±1 — to about ±0.95, so the master output cannot digitally clip.

A second analyser, `masterMeterAnalyser`, taps off the soft-clip and is **not** connected to the destination. It feeds the master VU meter and the PERF peak/clip readout, so both read the true, clip-free output.

`SidechainBus` is not a node in that chain at all. It is a lane-id → tap registry (`src/core/sidechain-bus.ts`): each `ChannelStrip` registers a `GainNode` fed off its post-mute output, and a ducker subgraph reads `getTap(sourceLaneId)` to drive its envelope follower. The allocator hands it to every lane strip it builds.

That follower is an **AudioWorklet** (`duck-processor` / `duck-node`, wrapping the pure `DuckDetector` in `src/audio-dsp/duck-detector.ts`), not a filter chain. It was two `BiquadFilterNode` lowpasses until 2026-07-27: at a 0.25 s release the cutoff is 0.64 Hz, the pole pair sits a hair from z=1, and in the float32 node graph the rounding error accumulated like an integrator — the "envelope" grew without bound with the input at exactly zero, so the duck multiplier drifted past 0 and came back negative, i.e. the ducked lane went silent and then returned phase-inverted and louder. A one-pole follower is a convex combination of the input and itself, so it is bounded by construction at any time constant and returns to zero when the source stops. Keep the multiplier's `[0, 1]` invariant if you touch it; `src/audio-dsp/duck-detector.test.ts` and `src/core/strip-ducker.dsp.test.ts` pin it.

Each lane's `LaneResources` consists of a `ChannelStrip` (level, EQ, send levels), a `SynthEngine`, and an `InsertChain` of per-lane FX. `LaneResourceMap.replaceEngine` hot-swaps only the engine while keeping the strip and inserts in place — the channel-level resources survive an engine swap.

The lane allocator (`src/app/lane-allocator.ts`) is the only module that constructs a `LaneResources`, in exactly one place: `ensureLaneResource` (line 228). The second entry point, `ensureExtraPoly`, went with the `PolySynth` class it existed to feed. Call `ensureLaneResource` once per lane before accessing anything in the map. Test code that needs a lane wired up must call it explicitly as setup.

## The scheduler

The `Sequencer` class (`src/core/sequencer.ts`) fires every 25 ms (the poll interval) and looks **200 ms** ahead. On each tick it calls `sessionTick(now, lookaheadSec)` with `lookaheadSec = 0.2`, and the session host fans that out to `tickLane` for each playing lane.

`tickLane` (`src/core/lane-scheduler.ts`) implements the Chris Wilson two-clocks pattern: for every `NoteEvent` whose absolute schedule time falls in the window `[now, now + lookaheadSec)`, it calls `ctx.onTrigger`. Schedule times are derived by converting clip-tick positions to seconds using the current BPM and projecting onto the absolute timeline from the loop-start anchor. Step duration for a 16th note is `60 / bpm / 4` seconds.

Two important consequences for contributors:

- `bpm` and `length` are mutable at runtime; the next scheduled step picks up the new values immediately.
- **Continuous** engine params reach the note already sounding. Each lane keeps a smoothed live bag (`ParamSmoother`, driven by `VoiceManager`) that every voice re-reads per sample, so turning a knob bends the held note instead of waiting for the next trigger. **Structural** params are the exception and still apply to the next trigger only: waveform, filter model, unison size, and every envelope *time* — the envelopes are closed-form over elapsed time, so re-reading an attack mid-note would step the amplitude. Drums is deliberately outside this: its params are read at trigger time.

The scheduler asks `laneLoopRegion` (`src/core/clip-loop.ts:40`) how long one iteration of a clip is, and there are **two** ways the answer comes back shorter than the whole clip. The active scene's global loop wins first: when `GlobalLoopOverride.enabled` is set, `[startBar, endBar)` becomes the region for every lane in the scene, whatever the clips say. Absent that, `effectiveClipLoop` (line 19) applies the clip's own `loopEnabled` / `[loopStartTick, loopEndTick)`. The brace UI in `src/core/clip-loop-brace.ts` is the editing surface for the clip's own region.

That precedence has a consequence worth knowing before you touch clip automation: a clip's envelope array spans the clip's `lengthBars` and is blind to **both** shortenings, so inside a shorter loop the curve slides against the notes. It is written down as known debt at the top of `src/core/clip-envelope-length.ts` and pinned by tests — meet it as a decision, not a mystery.

## How-to recipes

### Add a synth engine

**Write a plugin. Do not add a file to `src/`.** All six melodic engines are
external plugins, and yours should be too — it needs no access to this repo's
source, and it is a directory no future PR review has to carry. Full walkthrough
in [`docs/plugin-development.md`](../plugin-development.md); the shape:

1. **Scaffold** — `npm run plugin -- new plugins/<id>`.
2. **Declare it in `plugin.json`.** The manifest is the whole declaration: `id`,
   `loomApi: 1`, and a `components` array. An engine component carries `kind:
   "engine"`, `polyphony`, its `params`, a `groups` table (which sections exist,
   their title, order, colour, and which share a row — omit it and the grid falls
   back to first-appearance order, one row per group, no colour), an optional
   `modulators` array shipped with the sound, and a `capabilities` block. Add
   `"dsp": "dsp.js"` and `"presets": "presets.json"` alongside.
3. **Write `dsp.ts`** — the pure per-sample voice renderer, registered with
   `Loom.registerRenderer(id, ctor)` at module scope. It is plain TypeScript with
   no `AudioContext`: unit-test it directly, next to the code, in
   `plugins/<id>/dsp.test.ts`.
4. **Implement the live-params hook** — read your **continuous** params out of
   the live bag every sample so a knob moves the note already sounding; copy the
   **structural** ones — waveform, filter model, unison size, envelope times —
   into your own fields once, at construction, from the trigger-time snapshot.
   The hook is optional, so a renderer that skips it compiles clean and passes
   the whole suite; it is just the one engine whose knobs go dead mid-note. The
   registry-driven test in `src/audio-dsp/live-params.dsp.test.ts` catches it.
5. **Build it** — `npm run build:plugins`. **Nothing you did is visible until
   this runs**: the app loads `public/plugins/`, and the dev server does not
   compile `plugins/` for you. A stale build looks exactly like a broken engine.

There is no `WORKLET_ENGINE_IDS` list to add yourself to any more — it is a live
view over "is this id worklet-hosted", and any plugin id answers yes.

**Adding an engine in-tree is the exception and needs a reason.** The three that
still live in `src/engines/` — `sampler`, `audio`, `drums-machine` — are there
because each owns browser resources an external plugin has no way to hold:
decoded buffers, IndexedDB, per-voice `AudioParam`s. "I have a checkout, so it is
easier" is not that reason.

If you do write one, two things about the registered descriptor look like bugs
and are not:

- **Its synthesis surface is inert, not throwing.** `createDescriptorEngine`
  gives you a `createVoice()` that returns a no-op `Voice` with an empty
  `getAudioParams()` (`src/engines/descriptor-engine.ts:78` → `:48-50`). Nothing on
  the live or offline path calls it — the registered singleton is purely
  metadata, and modulation for these engines runs sample-accurately inside the
  worklet (`src/audio-dsp/modulation-runtime.ts`).
- **The bridged *plugin* does throw.** `bootstrapPlugins` wraps each engine
  descriptor in an engine `PluginFactory` so `listPlugins('engine')` keeps seeing
  every engine, and that wrapper's `create()` throws on purpose
  (`src/app/plugin-bootstrap.ts:90`). It is a tripwire: if you see it, something
  called `createInstance('engine', …)` instead of going through the lane
  allocator.

See [Engines](04-engines.md) for the full engine catalogue.

### Commit an engine param edit through one seam

Any control you build for an engine param must write it with `commitParam` from
[`src/engines/engine-param-commit.ts`](../../src/engines/engine-param-commit.ts),
never `engine.setBaseValue` alone:

```ts
commitParam(engine, ctx, paramId, value);   // engine + the engineState mirror
```

`setBaseValue` moves the sound. It does **not** persist it. The mirror into
`lane.engineState.params` is the only vehicle by which a knob value reaches a
save, and builders that forgot it threw the edit away silently — that was the
knob-loss bug on FM, Wavetable, Karplus, Westcoast and TB-303, fixed by routing
every builder through this one seam.

Two siblings exist for the cases a UI context cannot cover:

- `commitParamForLane(engine, sessionState, laneId, id, v)` — same seam for a
  caller that holds the session directly, e.g. a MIDI control surface writing a
  lane whose editor is closed.
- `commitEngineBaseValues(engine, sessionState, laneId)` — the bulk sibling for
  the programmatic applies that move a whole sound at once (recall a preset,
  load a user preset, Randomize). Those push values straight into the engine, so
  no `onChange` fires and `commitParam` never runs.

`withoutParamMirror(...)` suppresses the mirror. The load path uses it to apply
a lane's preset without clobbering the saved params it is about to replay — a
saved tweak beats its lane preset.

### Add an FX insert

An insert is a plugin like an engine, with one structural difference: **it is not
a worklet**. Only synthesis runs in the worklet; an insert builds ordinary Web
Audio nodes on the main thread.

1. `npm run plugin -- new plugins/<name>`.
2. In `plugin.json`, declare a component with `kind: "fx"` and its `params`.
3. Write `main.ts` — the factory that builds the node graph. The SDK's
   main-thread builders are there for you (`modulated-delay`, `signal-max`,
   `envelope-follower`); they sit **below the dividing line** in
   `packages/loom-plugin-sdk/src/index.ts`, and importing one into a `dsp.ts`
   renderer will not work, because that half runs inside the worklet with no
   `AudioContext`.
4. `npm run build:plugins`.

The "+ Add insert" picker is an unfiltered `listPlugins('fx')`
(`src/session/lane-insert-ui.ts`), and the same builder serves lanes, the master
rack and both send racks, so a new insert appears in all four at once.

Separately from the picker, the `FxBus` seeds send A with `delay` and send B with `reverb` when it is constructed (`src/core/fx.ts:30`). That is a default, not a restriction — both are offered as ordinary inserts too. **Seeding needs the plugin registry to be up**: the FxBus cannot seed a send with an insert that has not loaded yet.

### Add a modulator

A modulator can be a plugin too — `plugins/sh/` (sample & hold) is the shipped
proof. Declare `kind: "modulator"` with a `modulator` block naming its `driver`
(`time` or `gate`), the `scopes` it supports (`shared`, `per-voice`) and an
`idPrefix`; a `time`-driven one also ships a per-sample kernel registered with
`Loom.registerModulatorKernel` inside the worklet. In-tree modulators come
through the same door, `registerModulator` in
`src/modulation/modulator-registry.ts` — the LFO and the ADSR just call it
directly.

Binding is unchanged: `ConnectionBinder.apply` builds `modulator.output →
GainNode(depth × (max − min)) → targetAudioParam`
(`src/modulation/connection-binder.ts:44`) for the native-node targets, while a
worklet engine's params are modulated per sample by `ModulationRuntime`.

See [Modulation and Note FX](06-modulation-and-note-fx.md) for the user-facing side.

### Add a note-FX

`kind: 'notefx'` is the fourth plugin kind — a transform applied to notes before they reach the engine, per lane, persisted in `lane.engineState.noteFx`. A `NoteFxFactory` declares `defaultParams()` and has no `create()`, so the bootstrap's shape check ignores it: the file **must** call `registerPlugin` itself at module scope (`src/plugins/notefx/arp.ts:11`). The processor that does the work lives beside it in `src/notefx/`.

### Add a preset

For one of the six melodic engines, the presets ship **with the plugin**: append an entry to `plugins/<id>/presets.json` and run `npm run build:plugins`. `plugin-host` seeds them at load. For Sampler or Drums, the file is still `public/presets/<engine>.json`.

Either way the `gm` field is optional (an integer GM program number for MIDI-import matching), JSON is the source of truth, `preset-loader.ts` validates and `preset-apply.ts` applies it at runtime by calling `engine.applyPreset`. Each engine's JSON keys are its own vocabulary — do not use a generic `setBaseValue` loop.

### Add a synth drum kit

Append an object to the `KITS` array in `src/core/drums.ts`. Kits are parameter bags over shared DSP primitives. To add a new drum *voice* (not just a new kit): extend the `DrumVoice` union, add it to `DRUM_LANES`, add an entry to every kit, implement a `play<Voice>()` method, and add a `trigger()` case.

### Add a sampled drum kit

1. Create a subdirectory `public/drumkits/<id>/` containing WAV files for each voice (e.g. `kick.wav`, `snare.wav`, `closedHat.wav`).
2. Add a manifest file `public/drumkits/<id>.json` with `id`, `name`, and a `samples` array. Each entry needs `voice`, `note` (GM MIDI note number), and `file` (path relative to `public/drumkits/`).
3. Register the kit in `public/drumkits/index.json` by appending `{ "id": "<id>", "name": "<display name>" }`.

68 sampled kits ship under `public/drumkits/`; `tr808`, `acoustic` and `dirt` are the hand-curated three and the clearest reference for this layout.

## Conventions

**File size: 300 lines of code as a target, 500 as a hard cap.** Lines of *code* — comment lines and blank lines do not count towards either number. The distinction is not pedantry: `src/main.ts` is 816 raw lines and 473 lines of code, which is inside the cap by the rule that applies and over it by the one that does not. A file that is long because it explains itself is fine; a file that is long because it does too much is the thing the cap exists to catch. When one crosses the line, split it by concern — `src/app/` is what that looks like in practice.

**Assertions are relative.** See Testing, below.

## Source layout tour

```text
src/
  core/           DSP primitives + pure logic (drums, sequencer,
                  lane-scheduler, lane-resources, fx, meter, notes,
                  history, knob, pianoroll, …). The reference TB303 class that
                  used to live here (synth.ts) is gone with the last
                  node-per-note path; the renderer is the reference now
                  velocity-color.ts / velocity-gain.ts / velocity-lane-editing.ts
                    — note-velocity colour ramp, gain curve, lane editing helpers
                  clip-loop.ts / clip-loop-brace.ts
                    — clip sub-region resolver + drag-brace UI primitive
                  channel-strip-params.ts
                    — the seven strip params (level, pan, sends A/B, EQ x3)
                      declared ONCE: engine params, automation targets,
                      modulation targets and mixer knob ids all read this
  engines/        SynthEngine abstraction, registry, and the HOST side of an
                  instrument. Only THREE engines still have a file here —
                  sampler, audio (the dedicated audio channel) and drums-engine
                  — because each owns browser resources a plugin cannot hold.
                  The other six arrive from plugins/ and register the same
                  descriptor shape from their manifest. Nine in total.
                  Also: the lane engine wrappers (worklet-lane-engine,
                  sampler-/drums-/audio-worklet-engine), engine-selector UI,
                  engine-param-commit (the one write path for a param edit) and
                  engine-randomize (the 🎲 dice, derived from each engine's
                  declared EngineParamSpec rather than per-engine knowledge)
  plugin-host/    How an external plugin gets in: plugin-host (index.json is
                  the discovery mechanism; validate-as-data, then roll back in
                  full if it throws), manifest-validate, module-loader (blob:
                  URLs, because Vite dev refuses to serve public/ as a module)
                  and loom-api (the main-thread half of globalThis.Loom)
  session/        SessionState model + all session UI
                  (session-host, session-ui, session-inspector,
                  clip-editors/, session-migration)
                  session-host-reset.ts — resetAllResources(): the ONE teardown
                    every route that replaces the session runs FIRST, so a load
                    starts from a released desk
  modulation/     LFO/ADSR voices, ModulationHost, ModulatorScope,
                  connection binder
  plugins/        What is left of the in-tree SPI. There is NO fx/ directory
                  any more — all fifteen inserts are external plugins
                  capabilities.ts — the ONE door through which the core asks
                    what a component can do. An engineId === '…' anywhere else
                    is a bug
                  modulators/ — lfo, adsr (they call registerModulator at
                              module scope, the same door a plugin modulator
                              arrives through)
                  notefx/   — arp, chord, random (the processors themselves
                              live in src/notefx/)
  presets/        Preset loader + apply logic. A melodic engine's presets ship
                  with its plugin; public/presets/ now holds only what the
                  in-tree engines need
  midi/           SMF parser, MIDI-to-session transform, GM lookup, import UI
  samples/        Sample types, IndexedDB store, buffer cache, keymap,
                  import metadata
  stems/          Stem-separation client + config + lane-plan builder
                  (talks to the local Python service in tools/stem-service/)
  performance/    Arrangement / record model:
                  arrangement-from-session, arrangement-ops,
                  arrangement-runtime (records clip-launches + knob automation;
                  surfaced via the REC group's take mode — see performance-feature)
  audio-dsp/      THE SYNTHESIS KERNEL, minus the engines. voice-manager,
                  scheduler-queue, modulation-runtime + modulator-kernels, and
                  renderer-registry — which is now filled AT RUNTIME by plugin
                  dsp.js modules, not by in-tree imports; there is no
                  <id>-renderer.ts per melodic engine any more. The DSP that
                  stayed in-house is drums/ and sample/. The shared primitives
                  (osc, filter, ladder, sync-osc, unison, fold, adsr) moved to
                  packages/loom-plugin-sdk, where a plugin can reach them.
                  No AudioContext — unit-test directly
                  param-index.ts — params are addressed BY INDEX in the audio
                    loop, so a per-sample render does zero name lookups
                  param-smoother.ts — the lane's live param bag: slews only the
                    params still in flight, and is what makes a knob move the
                    note already sounding
                  duck-detector.ts — the sidechain envelope follower (one-pole,
                    asymmetric attack/release), run by the duck worklet
  audio-worklet/  The processors + typed node wrappers: loom-processor/loom-node
                  (melodic), drums-*, sampler-*, duck-* (the sidechain
                  follower). A processor is referenced ONLY via ?worker&url and
                  its registered name — never imported on the main thread
                  (see processor-name.ts)
  export/         Offline scene/WAV render + the live take recorder
  patterns/       The pattern library (styles x patterns) + its picker UI
  perf/           Performance diagnostics (the PERF HUD)
  instrument-presets/
                  The instrument page's USER-PRESET SURFACE, and nothing else:
                  the preset dropdown + Randomize, apply, store, templates and
                  the param id list (poly-params). Was src/polysynth/ before the
                  poly → instrument rename; the PolySynth class it was named
                  after went with the worklet cutover. The `poly` names INSIDE
                  it are load-bearing and must not be renamed: the localStorage
                  key 'tb303-poly-presets-v1' and the JSON shape stored under
                  it. There are no migrations in this project
  app/            Boot wiring, one module per concern (37 files). main.ts calls
                  into these; it does not contain them — see "Boot" above
                  audio spine  — audio-graph, lane-allocator, engine-swap,
                                 trigger-dispatch, live-voice-registry
                  boot wiring  — transport-controls, engine-selector-wiring,
                                 midi-control-wiring, midi-import-wiring,
                                 import-lane-prep, recording-feature,
                                 stems-feature, session-lifecycle,
                                 save-history-wiring, menu-wiring,
                                 xy-panel-wiring, knob-menu-wiring,
                                 automation-writes, lane-host-wiring
                  UI plumbing  — knob-mounting, knob-registry-prune, mute-solo,
                                 bpm-broadcast, track-ids, toolbar-status-chips,
                                 about-dialog, modal-dialog, and the four menu
                                 files (menu-spec / menu-actions / menu-bar /
                                 menu-shortcuts) that menu-wiring mounts
                  features     — performance-feature, arrangement-playback,
                                 automation-recording, stretch-resync,
                                 warp-resync
                  plugin-bootstrap — the build-time glob scan, now mostly a way
                                 to RUN module-scope registrations (see above)
  save/           SaveManager (schemaVersion: 3), auto-history (AutoHistory:
                  snapshot-diff undo/redo + gesture coalescing, wired to the
                  transport-bar ↺/↻ buttons), history-wiring (withUndo /
                  attachKnobUndo + the undo keyboard — LIVE and load-bearing:
                  withUndo wraps mutation sites across the app)
  notefx/         Note-FX processors (arpeggiator, chord spread, random) —
                  per-lane, applied to notes before they reach the engine
  automation/     Clip envelope recording + read-back, the automation painter
                  and its LFO, the knob right-click menu — and the
                  DestinationRegistry, the ONE catalogue every parameter
                  picker must read (see docs/automation-destinations.md)
  control/        Live MIDI controller subsystem: APC Key 25 profile, live
                  keyboard, LED mediator, profile registry
  demo/           Baked MIDI demos + demo picker
  styles/         SCSS

plugins/          PLUGIN SOURCE — 22 shipped directories, each a plugin.json
                  plus its code: six engines (tb303, subtractive, fm, wavetable,
                  karplus, westcoast), fifteen inserts (autowah, bitcrusher,
                  chorus, compressor, delay, distortion, flanger, gate, limiter,
                  multifilter, phaser, reverb, ringmod, tremolo, width) and one
                  modulator (sh). A component that synthesises ships dsp.ts; an
                  insert ships main.ts and builds native nodes on the main
                  thread. Its tests live beside it. audio-probe is private:true
                  — a fixture for the host's own tests, never shipped

packages/
  loom-plugin-sdk/  @loom/plugin-sdk — the surface a plugin author compiles
                  against: manifest + param types, and the shared DSP
                  primitives. One line in src/index.ts divides two species:
                  above it runs per-sample in the worklet, below it builds
                  native Web Audio nodes on the main thread

public/
  plugins/        PLUGIN BUILD OUTPUT — written by `npm run build:plugins`,
                  discovered by the browser through index.json. Versioned,
                  because the deploy publishes it. Editing plugins/ and not
                  rebuilding ships the OLD plugin, silently
  presets/        What the in-tree engines need: sampler, drums-machine and
                  drum-kits.json. A melodic engine's presets ship with its
                  plugin instead
  drumkits/       Sampled drum kits: index.json + <id>.json manifests + WAVs

tools/
  loom-plugin/    The plugin CLI: `new` scaffolds a directory, `build` compiles
                  one (or plugins/*) into public/plugins/ and rewrites the index
  stem-service/   Local Python service (FastAPI + audio-separator / Demucs)
                  exposing an HTTP job queue for stem separation.
                  Run: uvicorn app:app --port 8765
                  Tests: python -m pytest test_app.py (not part of npm test)
  manual/         The pipeline that builds the manual you are reading:
                  assemble.mjs (chapters → one HTML document), shots.mjs
                  (screenshots), pdf.mjs, web.mjs, shot-list.mjs (the
                  hand-maintained list of screenshots + their selectors)
                  and manual.css. Driven by build-manual.mjs
```

### Building the manual

The chapters in `docs/manual/*.md` are the only hand-written source. `index.html`, `Loom-Manual.pdf` and everything in `images/` are generated and committed — never hand-edit them.

| Command | What it regenerates |
| --- | --- |
| `npm run build:manual` | Everything: builds the app, then screenshots + PDF + `index.html` |
| `npm run manual:shots` | Screenshots only |
| `npm run manual:pdf` | The PDF **and** `index.html` (no app build, no server) |

`manual:shots` photographs whatever is already in `dist/` — it does not build. Run `npm run build` immediately before it, or you will capture a stale bundle (the same trap as `test:e2e`, below). A new chapter file is invisible to both outputs until it is added to the `CHAPTERS` array in `tools/manual/assemble.mjs`.

## Testing

Loom has four test layers, one per risk class.

**Pure logic** (`src/**/*.test.ts`, excluding `.dsp` and `.wiring` suffixes) — schemas, scales, migrations, session/arrangement logic, modulation math. These run fast and have no audio dependencies.

**Scheduling with a fake clock** — `src/core/lane-scheduler.test.ts` and `src/session/session-runtime.test.ts` drive the look-ahead scheduler through a mock `AudioContext` clock. The fake clock advances in controlled steps so timing edge-cases are deterministic.

**Real DSP** (`*.dsp.test.ts`) — audio actually rendered and measured, in two techniques. The **pure kernel** is driven sample by sample with no `AudioContext` at all: `src/audio-dsp/drums/new-voices.dsp.test.ts` calls `renderSample()` in a loop and asserts each voice sounds like what it claims to be. `src/audio-dsp/modulation-scope.dsp.test.ts` is the same technique, and so is `src/audio-dsp/live-params.dsp.test.ts` — the registry-driven one that renders every engine in `WORKLET_ENGINE_IDS` twice, moving a knob mid-note in the second render, and fails the engine whose sound does not change. The **Web Audio nodes that stayed native** render through `OfflineAudioContext` via [`node-web-audio-api`](https://github.com/ircam-ismm/node-web-audio-api), globalised in `test/setup.ts`: `comp-block`, `master-comp`, `master-shaper`, `strip-ducker`, `multifilter`, the sample/warp helpers and the offline export. (`src/performance/arrangement.dsp.test.ts` carries the suffix but does neither — it is arrangement maths. Glob for `*.dsp.test.ts` rather than trusting this list to stay complete.)

**A plugin's DSP is tested inside the plugin**, beside the code: `plugins/<id>/dsp.test.ts`, plus `plugins/tb303/tb303-parity.dsp.test.ts`, which pins the 303 against a committed `reference-render.json` so a refactor that changes the sound has to say so out loud. `packages/loom-plugin-sdk/src/sdk-parity.test.ts` guards the primitives those plugins share. They run in the same `npm run test:unit` sweep as everything else.

There is no per-engine WAV battery any more. `test/setup.ts` states the design plainly: the pure DSP kernel is tested directly and the real worklet's audio is verified in the browser via Playwright, because `node-web-audio-api` cannot run our TypeScript processor. `runStandardEngineBattery` in `test/dsp-battery.ts` survives with **no callers**, so nothing writes to `test/output/`, and `npm run test:wav-diff` / `test:wav-bless` do nothing but print "`test/output/ does not exist`". The 90 WAVs in `test/golden/` are orphans of the batteries the worklet cutover removed. Do not reach for that loop expecting it to work; reviving it is a decision, not a step.

**Modulation, objective and end-to-end** — `src/audio-dsp/modulation-pipeline.test.ts` drives the real in-engine path (`ModulationRuntime` → `VoiceManager` → renderer) for each of the six melodic engines, with an LFO at full depth on a continuous param, and asserts the rendered RMS envelope differs measurably from the unmodulated render, plus a negative control. It exists because the worklet rewrite dropped the per-engine coverage the old `.wiring.test.ts` files had. One `.wiring.test.ts` remains — `src/core/ducker-subgraph.wiring.test.ts` — and it covers Web Audio subgraph wiring like the sidechain, which is the only place that pattern still applies.

**Assertion rule:** always write relative assertions (`a > b`, `a > b * 2`). Never hard-code absolute magnitudes — they are a brittleness smell. If you must write one, justify it in a comment.

**Colour-free output:** every `npm test` script runs under `cross-env NO_COLOR=1`. When invoking Vitest directly, prefix with `NO_COLOR=1`. Do not add `--reporter=...` — the scripts already configure the right reporter.

**Key commands:**

| Command | What it runs |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload at <http://localhost:5173> |
| `npm run build` | Every plugin, then `tsc` typecheck + Vite bundle to `dist/` |
| `npm run build:plugins` | `plugins/*` → `public/plugins/` + its `index.json` |
| `npm run plugin -- new plugins/<id>` | Scaffold a new plugin directory |
| `npm test` | Full suite: unit + e2e (always build first) |
| `npm run test:unit` | Vitest only, no browser |
| `npm run test:fast` | Unit tests excluding DSP renders (inner-loop TDD) |
| `npm run test:dsp` | DSP renders only (slow; needs `node-web-audio-api`) |
| `npm run test:e2e` | Playwright against `vite preview` on port 4173 |

**e2e gotcha:** `test:e2e` and `npm test` serve `dist/` with no build step. Playwright boots `vite preview` over the last production bundle. If you changed `src/` without rebuilding, the newest features are absent from the bundle and tests fail with "element not found" — which looks like a regression. Always run `npm run build` before `npm run test:e2e`.

**The same trap has a plugin-shaped twin.** `public/plugins/` is build output, and nothing recompiles it for you — not the dev server, not `vite build` on its own. Change a plugin, reload, and you hear the previous version with no warning; add a new one and its engine is simply missing from the selector. `npm run build:plugins` after every plugin edit, or `npm run build`, which does it first.

Vitest runs test files serially (`fileParallelism: false`) because `node-web-audio-api`'s `OfflineAudioContext` is not safe under parallel forks. The teardown occasionally exits non-zero with `ERR_IPC_CHANNEL_CLOSED` after all tests pass — that is a tinypool shutdown race, not a test failure; re-run to confirm green.

---

`CLAUDE.md` at the repo root is the short-form architecture summary; this chapter is the long form. The convention is that a design doc is pruned from the tree once its work ships (specs drift faster than anything else), so recover rationale from git history when you need it: `git log --diff-filter=D --name-only -- docs/superpowers/`.

What is still open — code debts, and the specs that have come back into `docs/superpowers/` since the last prune — is inventoried in `docs/superpowers/REMAINING-WORK.md`.

(Links to files outside `docs/manual/` are ordinary links: the single-page build turns a link to a sibling *chapter* into an in-page anchor and leaves everything else alone, promoting `../../…` paths to absolute GitHub URLs so they work from the shipped page too. See `rewriteChapterLinks` and `rewriteRepoLinks` in `tools/manual/assemble.mjs`.)
