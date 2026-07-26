# Developer Guide

This chapter is for contributors who want to extend Loom or understand how its internals fit together. Read it alongside `CLAUDE.md` at the repo root, which is the canonical, always-current architecture reference — this chapter expands on it in prose.

## The spine

Three structures hold everything together:

1. **A plugin registry** — engines, FX, and modulators are all plugins. They are discovered at build time via a Vite `import.meta.glob` scan, so adding a new one means dropping a file in the right directory, not editing core wiring.

2. **`SessionState`** — the pure data model: lanes contain clips, scenes reference which clip each lane plays. No audio side-effects live here.

3. **`LaneResourceMap`** — owns the live Web Audio nodes for each lane. One entry per lane, holding a `ChannelStrip`, a `SynthEngine` instance, and an `InsertChain`. The lane allocator in `src/app/lane-allocator.ts` is the sole path for creating and swapping these resources; nothing else should construct them directly.

## Boot

`src/main.ts` is a boot script, not a feature file. It builds the handful of objects everything else needs, then hands them to one wiring module per concern in `src/app/`:

- `bootstrapPlugins()` first, before anything reads the registry (`main.ts:94`), then the preset cache derived from it (`main.ts:103`).
- `createAudioGraph()` (`main.ts:114`) and the three worklet `addModule` calls, which every lane allocation waits on (`main.ts:129`).
- The `Sequencer` (`main.ts:142`), the automation recorder and its knob registry (`main.ts:143`), the `DestinationRegistry` (`main.ts:150`), the lane allocator (`main.ts:172`), and the `SessionHost` (`main.ts:379`).
- Then roughly a dozen `wireX(...)` / `createXFeature(...)` calls, each of which owns one concern end to end and lives in its own file under `src/app/`.

**The order is load-bearing**, and the comments in `main.ts` say why at each step. `wireMenuBar` is deliberately the last statement of boot (`main.ts:813`): its action table names a handle from nearly every feature above, so the bar appearing is the proof that boot ran start to finish.

If you are looking for the code behind a control, it is almost never in `main.ts` — find the `wireX` call that mentions it and open that module.

## The plugin registry

`src/app/plugin-bootstrap.ts` calls `import.meta.glob` at build time over two trees:

```text
src/engines/*.ts       — synth engines
src/plugins/**/*.ts    — the WHOLE plugin tree: fx/, modulators/, notefx/
```

(`*.test.ts` is excluded from both.) Every module in those trees is eagerly imported. Any exported value that satisfies the `PluginFactory` shape (`{ kind, manifest, create }`, with `kind` one of `synth` / `fx` / `modulator`) is collected and registered via `registerPlugin`.

**Note-FX are the exception.** A `NoteFxFactory` declares `defaultParams()` instead of `create()`, so the shape check skips it (`plugin-bootstrap.ts:36`). Those files call `registerPlugin` themselves at module scope — the glob's only job for that category is to evaluate the module. That is why the second glob has to cover the whole plugin tree, not just `fx/` and `modulators/`.

The engine registry (`src/engines/registry.ts`) supports both a **singleton** pattern (`registerEngine`) for shared instances and a **factory** pattern (`registerEngineFactory` / `createEngineInstance`) for per-lane instances that need independent state.

`listEngines()` reads from the singleton map and is the source of metadata (name, type, polyphony, parameter specs) used to populate the lane engine selector.

### What "declaring a param" actually buys you

Engines declare their parameters as `EngineParamSpec[]`, and for the catalogue that is the whole story: `listAutomationTargets` walks `engine.params` and pushes `` `${lane.id}.${spec.id}` `` for every continuous one (`src/automation/automation-targets.ts:120`). Automation and the modulation dropdown both read that catalogue through `DestinationRegistry.list()`. Neither of them calls `getAudioParams()`.

`getAudioParams()` / `getSharedAudioParams()` are a narrower thing — the **Web Audio binding surface**, used only where a modulator has to reach a real `AudioParam` through the depth-gain bridge in `connection-binder.ts`. That means FX inserts, channel strips, and the two engines that still expose shared params, Drums and Sampler. For the six melodic worklet engines `getAudioParams()` returns an empty `Map` on purpose (`src/engines/worklet-lane-engine.ts:150`); their modulation is applied per sample inside the worklet by `ModulationRuntime`.

So: declare the param in the spec and it is automatable and modulatable. Return it from `getAudioParams()` only if it is a genuine `AudioParam` on the main thread.

## SessionState data model

`src/session/session-types.ts` defines three levels (re-exported from `session.ts`, which holds the factories):

- **`SessionLane`** — has an `engineId`, a list of `SessionClip | null` slots, and an `engineState` bag that persists knob values, modulator configs, note-FX, sampler keymap, pad params, and kit mode.
- **`SessionClip`** — holds `notes: NoteEvent[]` (the unified note list for both melodic and drum clips), optional `ClipEnvelope[]` for per-clip automation, and an optional `sample` field for loop/song audio clips. Clips also carry `loopEnabled` / `loopStartTick` / `loopEndTick` for sub-region looping, and a `gridResolution` hint for the drum editor.
- **`SessionScene`** — a `clipPerLane` map from lane id to clip slot index (or null for a stopped lane).

Notes carry a `velocity` field (0–127). The `velToColor` function in `src/core/velocity-color.ts` maps velocity to a blue-to-yellow ramp used by both the piano roll and the drum grid.

Saves are written as `schemaVersion: 3` (`SavedStateV3` in `src/save/`). Older saves are normalised by `session-migration.ts` at load time before anything else touches the data.

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

Each lane's `LaneResources` consists of a `ChannelStrip` (level, EQ, send levels), a `SynthEngine`, and an `InsertChain` of per-lane FX. `LaneResourceMap.replaceEngine` hot-swaps only the engine while keeping the strip and inserts in place — the channel-level resources survive an engine swap.

The lane allocator (`src/app/lane-allocator.ts`) is the only module that constructs a `LaneResources`, in two places: `ensureLaneResource` for a session lane (line 255) and `ensureExtraPoly` for the legacy extra-poly strips (line 169). Call `ensureLaneResource` once per lane before accessing anything in the map. Test code that needs a lane wired up must call it explicitly as setup.

## The scheduler

The `Sequencer` class (`src/core/sequencer.ts`) fires every 25 ms (the poll interval) and looks **200 ms** ahead. On each tick it calls `sessionTick(now, lookaheadSec)` with `lookaheadSec = 0.2`, and the session host fans that out to `tickLane` for each playing lane.

`tickLane` (`src/core/lane-scheduler.ts`) implements the Chris Wilson two-clocks pattern: for every `NoteEvent` whose absolute schedule time falls in the window `[now, now + lookaheadSec)`, it calls `ctx.onTrigger`. Schedule times are derived by converting clip-tick positions to seconds using the current BPM and projecting onto the absolute timeline from the loop-start anchor. Step duration for a 16th note is `60 / bpm / 4` seconds.

Two important consequences for contributors:

- `bpm` and `length` are mutable at runtime; the next scheduled step picks up the new values immediately.
- Engine params are read at trigger time, not when a note is held. Live knob tweaks apply to the **next** trigger.

The scheduler asks `laneLoopRegion` (`src/core/clip-loop.ts:40`) how long one iteration of a clip is, and there are **two** ways the answer comes back shorter than the whole clip. The active scene's global loop wins first: when `GlobalLoopOverride.enabled` is set, `[startBar, endBar)` becomes the region for every lane in the scene, whatever the clips say. Absent that, `effectiveClipLoop` (line 19) applies the clip's own `loopEnabled` / `[loopStartTick, loopEndTick)`. The brace UI in `src/core/clip-loop-brace.ts` is the editing surface for the clip's own region.

That precedence has a consequence worth knowing before you touch clip automation: a clip's envelope array spans the clip's `lengthBars` and is blind to **both** shortenings, so inside a shorter loop the curve slides against the notes. It is written down as known debt at the top of `src/core/clip-envelope-length.ts` and pinned by tests — meet it as a decision, not a mystery.

## How-to recipes

### Add a synth engine

Since synthesis moved into the AudioWorklet, an engine is **two halves in two
places**: a metadata descriptor on the main thread and a per-sample renderer
inside the worklet bundle. There are **four** steps, and skipping any of the last
three gives you an engine that appears in the lane selector and then plays
**silence** — the failure is quiet, so do all four.

1. **Metadata descriptor** — `src/engines/<id>.ts`. Build it with
   `createDescriptorEngine(...)` and register it with `registerEngineFactory(id, …)`
   + `registerEngine(...)` at module scope. Declare params as `EngineParamSpec[]`.
   This half carries no DSP: it describes the parameters and the UI.
2. **Renderer** — `src/audio-dsp/<id>-renderer.ts`, a pure per-sample voice
   renderer that calls `registerRenderer(id, ctor)` at module scope. This is the
   half that makes sound, and it is plain TypeScript — unit-test it directly, no
   `AudioContext` required.
3. **Side-effect import in the worklet** — add `import '../audio-dsp/<id>-renderer';`
   to [`src/audio-worklet/loom-processor.ts`](../../src/audio-worklet/loom-processor.ts).
   The worklet is a separate bundle; without this import the renderer never
   registers *inside it* and `createRenderer` throws
   `no renderer registered for engine '<id>'`.
4. **Route the lane** — add the id to `WORKLET_ENGINE_IDS` in
   [`src/app/lane-allocator.ts`](../../src/app/lane-allocator.ts). The allocator
   only sends listed ids down the worklet path; an unlisted id falls through,
   the lane gets no engine, and nothing sounds.

Two things about the registered descriptor are worth knowing, because they look
like bugs otherwise:

- **Its synthesis surface is inert, not throwing.** `createDescriptorEngine`
  gives you a `createVoice()` that returns a no-op `Voice` with an empty
  `getAudioParams()` (`src/engines/descriptor-engine.ts:48`, `:76`). Nothing on
  the live or offline path calls it — the registered singleton is purely
  metadata, and modulation for these engines runs sample-accurately inside the
  worklet (`src/audio-dsp/modulation-runtime.ts`).
- **The bridged *plugin* does throw.** `bootstrapPlugins` wraps each engine
  descriptor in a synth `PluginFactory` so `listPlugins('synth')` keeps seeing
  every engine, and that wrapper's `create()` throws on purpose
  (`src/app/plugin-bootstrap.ts:81`). It is a tripwire: if you see it, something
  called `createInstance('synth', …)` instead of going through the lane
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

1. Create `src/plugins/fx/<name>.ts`.
2. Export a `PluginFactory` with `kind: 'fx'`. Do **not** call `registerPlugin` — the glob's shape check collects it for you; none of the eleven shipped inserts registers itself.
3. That is all. The "+ Add insert" picker is an unfiltered `listPlugins('fx')` (`src/session/lane-insert-ui.ts:218`), and the same builder serves lanes, the master rack and both send racks, so a new insert appears in all four at once.

Separately from the picker, the `FxBus` seeds send A with `delay` and send B with `reverb` when it is constructed (`src/core/fx.ts:30`). That is a default, not a restriction — both are offered as ordinary inserts too.

### Add a modulator

`kind: 'modulator'` plugins are collected the same way and bound the same way: `ConnectionBinder.apply` builds `modulator.output → GainNode(depth) → targetAudioParam` (`src/modulation/connection-binder.ts:44`).

Be aware of the ceiling before you invest in one. The MODULATORS panel offers exactly two buttons, **+ LFO** and **+ ADSR** (`src/modulation/modulation-ui.ts:63`), so there is no UI path that adds a third kind. `ModulationHost` hardcodes `LFOVoice` / `ADSRVoice` and routes any other kind through `createInstance`, which its own comment describes as a stateless stub whose `currentValue()` returns 0 (`src/modulation/modulation-host.ts:85`). Inside the worklet, `ModLite.kind` is typed `'lfo' | 'adsr'` (`src/audio-dsp/modulation-runtime.ts:24`), so a custom modulator cannot reach a melodic engine's params at all. Adding a genuinely new modulator kind is a change to those three places, not a drop-in.

See [Modulation and Note FX](06-modulation-and-note-fx.md) for the user-facing side.

### Add a note-FX

`kind: 'notefx'` is the fourth plugin kind — a transform applied to notes before they reach the engine, per lane, persisted in `lane.engineState.noteFx`. A `NoteFxFactory` declares `defaultParams()` and has no `create()`, so the bootstrap's shape check ignores it: the file **must** call `registerPlugin` itself at module scope (`src/plugins/notefx/arp.ts:11`). The processor that does the work lives beside it in `src/notefx/`.

### Add a preset

Open `public/presets/<engine>.json` and append an entry. The `gm` field is optional (an integer GM program number for MIDI-import matching). JSON is the source of truth; `preset-loader.ts` validates and `preset-apply.ts` applies it at runtime by calling `engine.applyPreset`. Each engine's JSON keys are its own vocabulary — do not use a generic `setBaseValue` loop.

### Add a synth drum kit

Append an object to the `KITS` array in `src/core/drums.ts`. Kits are parameter bags over shared DSP primitives. To add a new drum *voice* (not just a new kit): extend the `DrumVoice` union, add it to `DRUM_LANES`, add an entry to every kit, implement a `play<Voice>()` method, and add a `trigger()` case.

### Add a sampled drum kit

1. Create a subdirectory `public/drumkits/<id>/` containing WAV files for each voice (e.g. `kick.wav`, `snare.wav`, `closedHat.wav`).
2. Add a manifest file `public/drumkits/<id>.json` with `id`, `name`, and a `samples` array. Each entry needs `voice`, `note` (GM MIDI note number), and `file` (path relative to `public/drumkits/`).
3. Register the kit in `public/drumkits/index.json` by appending `{ "id": "<id>", "name": "<display name>" }`.

The existing kits (`tr808`, `acoustic`, `dirt`) follow this layout exactly and are the reference.

## Source layout tour

```text
src/
  core/           DSP primitives + pure logic (synth, drums, sequencer,
                  lane-scheduler, lane-resources, fx, meter, notes,
                  history, knob, pianoroll, …)
                  velocity-color.ts / velocity-gain.ts / velocity-lane-editing.ts
                    — note-velocity colour ramp, gain curve, lane editing helpers
                  clip-loop.ts / clip-loop-brace.ts
                    — clip sub-region resolver + drag-brace UI primitive
  engines/        SynthEngine abstraction, registry, one file per engine —
                  nine register today: tb303, subtractive, fm, wavetable,
                  karplus, westcoast, sampler, audio (the dedicated audio
                  channel), drums-engine — plus engine-selector UI and
                  engine-param-commit (the one write path for a param edit)
  session/        SessionState model + all session UI
                  (session-host, session-ui, session-inspector,
                  clip-editors/, session-migration)
  modulation/     LFO/ADSR voices, ModulationHost, ModulatorScope,
                  connection binder
  plugins/        Plugin SPI + registry
                  fx/       — eleven inserts: bitcrusher, chorus, compressor,
                              delay, distortion, flanger, limiter, multifilter,
                              phaser, reverb, tremolo. chorus and flanger share
                              modulated-delay.ts; reverb reads reverb-ir.ts.
                              insert-chain.ts is the generic host, not a plugin
                  modulators/ — lfo, adsr
                  notefx/   — arp, chord (the fourth plugin kind; the
                              processors themselves live in src/notefx/)
  presets/        Preset loader + apply logic
                  (JSON assets live in public/presets/)
  midi/           SMF parser, MIDI-to-session transform, GM lookup, import UI
  samples/        Sample types, IndexedDB store, buffer cache, keymap,
                  import metadata
  stems/          Stem-separation client + config + lane-plan builder
                  (talks to the local Python service in tools/stem-service/)
  performance/    Arrangement / record model:
                  arrangement-from-session, arrangement-ops,
                  arrangement-runtime (records clip-launches + knob automation;
                  surfaced via the REC group's take mode — see performance-feature)
  audio-dsp/      THE SYNTHESIS KERNEL. Pure per-sample DSP that the worklet
                  runs: one <id>-renderer.ts per engine (self-registering into
                  renderer-registry.ts), voice-manager, scheduler-queue,
                  modulation-runtime, plus primitives (osc, filter, ladder,
                  sync-osc, unison, adsr). No AudioContext — unit-test directly
  audio-worklet/  The processors + typed node wrappers: loom-processor/loom-node
                  (melodic), drums-*, sampler-*. A processor is referenced ONLY
                  via ?worker&url and its registered name — never imported on
                  the main thread (see processor-name.ts)
  export/         Offline scene/WAV render + the live take recorder
  patterns/       The pattern library (styles x patterns) + its picker UI
  perf/           Performance diagnostics (the PERF HUD)
  polysynth/      LEGACY/vestigial. Not the Subtractive voice host any more —
                  Subtractive is a descriptor engine rendered in the worklet.
                  Only the preset store + the extra-poly path still touch it
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
                  plugin-bootstrap — the build-time glob scan (see above)
  save/           SaveManager (schemaVersion: 3), auto-history (AutoHistory:
                  snapshot-diff undo/redo + gesture coalescing, wired to the
                  transport-bar ↺/↻ buttons), history-wiring (withUndo /
                  attachKnobUndo + the undo keyboard — LIVE and load-bearing:
                  withUndo wraps mutation sites across the app)
  notefx/         Note-FX plugin category (arpeggiator, chord spread) — per-lane
  automation/     Clip envelope recording + read-back, the automation painter
                  and its LFO, the knob right-click menu — and the
                  DestinationRegistry, the ONE catalogue every parameter
                  picker must read (see docs/automation-destinations.md)
  control/        Live MIDI controller subsystem: APC Key 25 profile, live
                  keyboard, LED mediator, profile registry
  demo/           Baked MIDI demos + demo picker
  styles/         SCSS

public/
  presets/        Engine preset JSONs (20+ per engine, GM-tagged)
  drumkits/       Sampled drum kits: index.json + <id>.json manifests + WAVs

tools/
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

**Real DSP** (`*.dsp.test.ts`) — every engine and drum kit is rendered through `OfflineAudioContext` via the [`node-web-audio-api`](https://github.com/ircam-ismm/node-web-audio-api) package, globalised in `test/setup.ts`. Use the shared battery `runStandardEngineBattery` from `test/dsp-battery.ts`. Each render writes a WAV to `test/output/` (gitignored). Compare against the committed reference in `test/golden/` with `npm run test:wav-diff`; promote with `npm run test:wav-bless`.

**Modulation wiring** (`*.wiring.test.ts`) — LFO/ADSR voices connected through a depth-gain bridge into a target `AudioParam`, verified end-to-end.

**Assertion rule:** always write relative assertions (`a > b`, `a > b * 2`). Never hard-code absolute magnitudes — they are a brittleness smell. If you must write one, justify it in a comment.

**Colour-free output:** every `npm test` script runs under `cross-env NO_COLOR=1`. When invoking Vitest directly, prefix with `NO_COLOR=1`. Do not add `--reporter=...` — the scripts already configure the right reporter.

**Key commands:**

| Command | What it runs |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload at <http://localhost:5173> |
| `npm run build` | `tsc` typecheck + Vite bundle to `dist/` |
| `npm test` | Full suite: unit + e2e (always build first) |
| `npm run test:unit` | Vitest only, no browser |
| `npm run test:fast` | Unit tests excluding DSP renders (inner-loop TDD) |
| `npm run test:dsp` | DSP renders only (slow; needs `node-web-audio-api`) |
| `npm run test:e2e` | Playwright against `vite preview` on port 4173 |

**e2e gotcha:** `test:e2e` and `npm test` serve `dist/` with no build step. Playwright boots `vite preview` over the last production bundle. If you changed `src/` without rebuilding, the newest features are absent from the bundle and tests fail with "element not found" — which looks like a regression. Always run `npm run build` before `npm run test:e2e`.

Vitest runs test files serially (`fileParallelism: false`) because `node-web-audio-api`'s `OfflineAudioContext` is not safe under parallel forks. The teardown occasionally exits non-zero with `ERR_IPC_CHANNEL_CLOSED` after all tests pass — that is a tinypool shutdown race, not a test failure; re-run to confirm green.

---

For the definitive, always-up-to-date architecture reference, read `CLAUDE.md` at the repo root. Implemented design docs are intentionally removed from the tree once shipped (they drift); recover rationale from git history when you need it. Unfinished work lives in `docs/superpowers/REMAINING-WORK.md`.
