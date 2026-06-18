# Developer Guide

This chapter is for contributors who want to extend Loom or understand how its internals fit together. Read it alongside `CLAUDE.md` at the repo root, which is the canonical, always-current architecture reference — this chapter expands on it in prose.

## The spine

Three structures hold everything together:

1. **A plugin registry** — engines, FX, and modulators are all plugins. They are discovered at build time via a Vite `import.meta.glob` scan, so adding a new one means dropping a file in the right directory, not editing core wiring.

2. **`SessionState`** — the pure data model: lanes contain clips, scenes reference which clip each lane plays. No audio side-effects live here.

3. **`LaneResourceMap`** — owns the live Web Audio nodes for each lane. One entry per lane, holding a `ChannelStrip`, a `SynthEngine` instance, and an `InsertChain`. The lane allocator in `src/app/lane-allocator.ts` is the sole path for creating and swapping these resources; nothing else should construct them directly.

## The plugin registry

`src/app/plugin-bootstrap.ts` calls `import.meta.glob` at build time over two trees:

```text
src/engines/*.ts          — synth engines
src/plugins/fx/*.ts       — FX inserts
src/plugins/modulators/   — LFO / ADSR modulators
```

Every module in those trees is eagerly imported. Any exported value that satisfies the `PluginFactory` shape (`{ kind, manifest, create }`) is collected and registered via `registerPlugin`. The engine registry (`src/engines/registry.ts`) supports both a **singleton** pattern (`registerEngine`) for shared instances and a **factory** pattern (`registerEngineFactory` / `createEngineInstance`) for per-lane instances that need independent state.

`listEngines()` reads from the singleton map and is the source of metadata (name, type, polyphony, parameter specs) used to populate the lane engine selector. Engines declare their parameters as `EngineParamSpec[]`; voices expose continuous `AudioParam`s via `getAudioParams()`, and engines expose shared ones via `getSharedAudioParams()`. That is the entire surface the modulation and automation systems need — nothing else.

## SessionState data model

`src/session/session.ts` defines three levels:

- **`SessionLane`** — has an `engineId`, a list of `SessionClip | null` slots, and an `engineState` bag that persists knob values, modulator configs, note-FX, sampler keymap, pad params, and kit mode.
- **`SessionClip`** — holds `notes: NoteEvent[]` (the unified note list for both melodic and drum clips), optional `ClipEnvelope[]` for per-clip automation, and an optional `sample` field for loop/song audio clips. Clips also carry `loopEnabled` / `loopStartTick` / `loopEndTick` for sub-region looping, and a `gridResolution` hint for the drum editor.
- **`SessionScene`** — a `clipPerLane` map from lane id to clip slot index (or null for a stopped lane).

Notes carry a `velocity` field (0–127). The `velToColor` function in `src/core/velocity-color.ts` maps velocity to a blue-to-yellow ramp used by both the piano roll and the drum grid.

Saves are written as `schemaVersion: 3` (`SavedStateV3` in `src/save/`). Older saves are normalised by `session-migration.ts` at load time before anything else touches the data.

## LaneResourceMap and the audio graph

The master audio path assembled in `src/app/audio-graph.ts` runs:

```text
master GainNode → insert chain → MasterCompressor → AnalyserNode
                                                   → SidechainBus
```

Each lane's `LaneResources` consists of a `ChannelStrip` (level, EQ, send levels), a `SynthEngine`, and an `InsertChain` of per-lane FX. `LaneResourceMap.replaceEngine` hot-swaps only the engine while keeping the strip and inserts in place — the channel-level resources survive an engine swap.

`ensureLaneResource` in the lane allocator is the only place that constructs a `LaneResources`. Call it once per lane before accessing anything in the map. Test code that needs a lane wired up must call it explicitly as setup.

## The scheduler

The `Sequencer` class (`src/core/sequencer.ts`) fires every 25 ms (the poll interval) and looks **120 ms** ahead. On each tick it calls `sessionTick(now, lookaheadSec)` with `lookaheadSec = 0.12`, and the session host fans that out to `tickLane` for each playing lane.

`tickLane` (`src/core/lane-scheduler.ts`) implements the Chris Wilson two-clocks pattern: for every `NoteEvent` whose absolute schedule time falls in the window `[now, now + lookaheadSec)`, it calls `ctx.onTrigger`. Schedule times are derived by converting clip-tick positions to seconds using the current BPM and projecting onto the absolute timeline from the loop-start anchor. Step duration for a 16th note is `60 / bpm / 4` seconds.

Two important consequences for contributors:

- `bpm` and `length` are mutable at runtime; the next scheduled step picks up the new values immediately.
- Engine params are read at trigger time, not when a note is held. Live knob tweaks apply to the **next** trigger.

When `clip.loopEnabled` is set, `effectiveClipLoop` (`src/core/clip-loop.ts`) constrains the iteration window to `[loopStartTick, loopEndTick)`. The brace UI in `src/core/clip-loop-brace.ts` is the editing surface for that region.

## How-to recipes

### Add a synth engine

1. Create `src/engines/<name>.ts`. Implement `SynthEngine` and export a `PluginFactory` with `kind: 'synth'`.
2. Call `registerEngine(instance)` and `registerEngineFactory(id, () => new YourEngine())` at module scope.
3. Declare params as `EngineParamSpec[]` and implement `getAudioParams()` on each voice so modulation and automation work automatically.
4. That is it. The build-time glob discovers the file; it appears in the lane engine selector without any further wiring.

See [Engines](04-engines.md) for the full engine catalogue.

### Add an FX insert or modulator

1. Create `src/plugins/fx/<name>.ts` or `src/plugins/modulators/<name>.ts`.
2. Export a `PluginFactory` with `kind: 'fx'` or `kind: 'modulator'` respectively, and call `registerPlugin` at module scope.
3. FX inserts mount per-lane and on master automatically; modulators appear in the modulation panel. See [Modulation and Note FX](06-modulation-and-note-fx.md) for the user-facing side.

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
  engines/        SynthEngine abstraction, registry, one file per engine
                  (tb303, subtractive, fm, wavetable, karplus, sampler,
                  drums-engine) + engine-selector UI
  session/        SessionState model + all session UI
                  (session-host, session-ui, session-inspector,
                  clip-editors/, session-migration)
  modulation/     LFO/ADSR voices, ModulationHost, ModulatorScope,
                  connection binder
  plugins/        Plugin SPI + registry
                  fx/       — multifilter, distortion, reverb, delay, InsertChain
                  modulators/ — lfo, adsr
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
  polysynth/      PolySynth poly voice host (used by Subtractive):
                  voice stealing, mono/legato/retrig, per-voice mod bus
  app/            Boot factories: audio-graph, lane-allocator, trigger-dispatch,
                  knob-mounting, mute-solo, bpm-broadcast, engine-swap,
                  plugin-bootstrap, lane-host-wiring
  save/           SaveManager (schemaVersion: 3), auto-history (AutoHistory:
                  snapshot-diff undo/redo + gesture coalescing, wired to the
                  transport-bar ↺/↻ buttons), history-wiring (legacy withUndo /
                  attachKnobUndo — now no-op shims)
  notefx/         Note-FX plugin category (arpeggiator, chord spread) — per-lane
  automation/     Clip envelope recording + read-back helpers
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
```

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
