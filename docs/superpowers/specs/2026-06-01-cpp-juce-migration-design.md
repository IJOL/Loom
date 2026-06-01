# Loom → C++/JUCE migration — design

**Date:** 2026-06-01
**Status:** Design approved (brainstorming complete); not yet planned/implemented.
**Author:** brainstorming session (Nacho + Claude)

## Goal

Migrate **Loom** (today a browser-based Web Audio + TypeScript workstation, ~18k LOC of
production TS, 5 melodic engines + sampler + drums behind a plugin registry) to a **native
C++ / JUCE** application that delivers what the browser cannot:

1. **Low latency / no glitches** — real audio-thread control, WASAPI/ASIO, no GC pauses.
2. **More CPU / voices** — native DSP headroom for higher polyphony and heavier processing.
3. **VST3** — ship as a plugin inside a DAW, and (later) host third-party plugins.
4. **A real native `.exe`** — installable standalone Windows app, no browser dependency.

All four motivations point at the same destination: **JUCE** (C++), the de-facto standard
that produces a standalone `.exe` *and* a VST3 from one codebase, handles WASAPI/ASIO, and
can host third-party plugins.

## Locked decisions

| Topic | Decision |
|---|---|
| **Stack** | C++ / **JUCE**. Build with **CMake**, toolchain **MSVC** on Windows. |
| **UI** | Rewrite **natively in JUCE** (a central `LookAndFeel` imitates the current look). NOT WebView. |
| **Delivery** | **Vertical slice first**: skeleton that *sounds* end-to-end, then port engines/FX/mods one-by-one behind the registry. |
| **Data/assets** | **Reuse current formats 1:1** — C++ model mirrors `SessionState` (`schemaVersion 3`); reads the same session JSON, the same `public/presets/<engine>.json`, and MIDI demos. |
| **DSP** | Lean on **libraries** (JUCE `dsp` + STK/Gamma/SoundPipe where useful), behind our own thin wrappers. |
| **Sound parity** | **Not a goal.** It is acceptable — expected — that it sounds *different* from the web version. The criterion is "sounds good", not "sounds identical". No golden-WAV target, no re-tuning pass, no perceptual thresholds. |

### Consequence of "reuse presets 1:1" + "library DSP" + "parity is not a goal"

Presets are just numbers (cutoff, resonance, etc.), so they **load** fine. The library
filter/oscillator is not the Web Audio node, so the result **sounds different** — and that is
explicitly fine. Golden WAVs are *not* carried over as a correctness target; offline renders
exist only for audible inspection during development.

---

## Section 0 — Repository & workspace layout

The native app lives in a **new, separate project** — not a branch or worktree of `tb303-synth`.

- **New project:** `C:\Users\nacho\git\LoomN` ("N" for native). Its **own git repository**
  (`git init`), independent history, C++/JUCE/CMake from scratch.
- **The web project stays put:** `C:\Users\nacho\git\tb303-synth` is untouched and remains the
  source of session JSON, `public/presets/<engine>.json`, and MIDI demos that LoomN reuses 1:1.

### Claude Code session: bootstrap-and-move (the meaning of "no perder las sesiones")

Claude Code keys its transcripts and memory by project path
(`~/.claude/projects/c--Users-nacho-git-tb303-synth/`). Opening Claude Code inside `LoomN` would
start a *fresh* project with none of this history. There is **no built-in "move session"**, and
the live chat transcript cannot reliably follow the assistant to another project. What *is*
portable is the distilled context: the **spec, the plans, the CLAUDE.md, and the project
memories**. So the strategy is **bootstrap-then-move**, not "stay rooted forever":

1. **Phase 1 runs from this `tb303-synth`-rooted session.** During Phase 1, having the web TS
   source and the demo/preset JSON at hand is genuinely useful (copying fixtures, comparing
   shapes). LoomN files are created via absolute paths; commits use `git -C C:\Users\nacho\git\LoomN …`.
2. **The final task of Phase 1 bootstraps LoomN as a self-sufficient Claude Code project:** it
   writes a `LoomN/CLAUDE.md`, copies the spec + all plans into `LoomN/docs/superpowers/`, and
   seeds LoomN's Claude Code memory directory
   (`~/.claude/projects/c--Users-nacho-git-LoomN/memory/`) with the migration memories + a fresh
   `MEMORY.md` index.
3. **From Phase 2 onward (pure C++), work moves into a Claude Code session opened in `LoomN`.**
   This conversation stays here as the historical record; the new session picks up from the
   spec/plans/memories now living in LoomN.

- **VS Code multi-root workspace** at a stable path (e.g.
  `C:\Users\nacho\git\loom.code-workspace`) with two folders: `tb303-synth` and `LoomN`. Both stay
  visible regardless of which one Claude Code is rooted in, so the web source remains a reference
  while porting.
- **Asset reuse, not duplication (initially):** LoomN reads presets/sessions/demos from the
  `tb303-synth` tree during development via a configurable path; productionizing how assets are
  packaged into the binary (`BinaryData` vs copied-on-build) is decided during planning. The two
  repos stay decoupled — no build dependency from LoomN back onto `tb303-synth`.
- **Tooling note:** GitNexus indexes the `tb303-synth` TypeScript source only; it will not track
  LoomN's C++. It remains useful for referencing the web source while porting, but is not a
  code-intelligence layer for LoomN.

The implementation plan's **first task** is scaffolding `LoomN` (git init + CMake skeleton + JUCE
dependency); its **last task** bootstraps LoomN as a standalone Claude Code project and the
shared `.code-workspace`, after which development continues from within `LoomN`.

---

## Section 1 — Global architecture & the paradigm shift

### From JS look-ahead scheduling to a sample-accurate callback

**Today (Web Audio):** a JS look-ahead timer creates nodes "to sound at time T". The node
graph lives on the browser's audio thread (native underneath); JS only schedules and routes.
This causes node churn and depends on the garbage collector.

**Native (JUCE):** a single function `processBlock(buffer, numSamples)` is called ~hundreds of
times/second on the **real-time audio thread**. We fill every sample of the buffer ourselves.
Events (note-on/off, knob changes, clip launch) reach that thread as a **stream of
sample-stamped events** and are applied at the exact sample within the block.

Direct consequence: the `lane-scheduler` stops "creating future oscillators" and instead
**emits events at the exact sample offset** when a step boundary falls inside the current block.
This is what delivers the latency and precision the browser cannot.

### The audio-thread golden rule

On the `processBlock` thread, **never**: allocate (`new`/`malloc`), block (mutex), or do I/O
(disk/network/log). All of those cause glitches. The professional pattern:

```
  UI thread  ──(lock-free command queue)──►  Audio thread (processBlock)
  (knobs,      AbstractFifo / SPSC queue       (reads only; smooths with
   clips,                                        SmoothedValue, processes)
   transport)
```

The UI never touches audio directly: it pushes *commands* to a lock-free queue; the audio
thread drains them. Parameters are interpolated (`SmoothedValue`) to avoid zipper noise.

### Module map (mirror of the current subsystems, native idiom)

```
core/        Pure model + timing + JSON v3 serialization   (NO JUCE → unit-testable alone)
            └ SessionModel (lanes→clips→scenes), NoteEvent, scales, slide/accent, bpm math

registry/    The soul: registry of engine/fx/modulator plugins   (compile-time auto-registration)

engine/      SynthEngine + Voice; engines as "plugins"
            └ slice: TB303Engine, DrumMachine   (over JUCE dsp / STK)

modulation/  Modulator (LFO/ADSR) + connection matrix to a parameter (shared / per-voice)

fx/          Fx interface + InsertChain (per-lane and master) — designed as a node graph

mix/         ChannelStrip (gain/pan/sends) + master bus

transport/   Transport (sample-accurate position, bpm) + LaneScheduler (slide/accent)

app/         JUCE AudioProcessor (= standalone AND VST3) + device IO (WASAPI→ASIO) + UI↔audio queue

ui/          JUCE GUI (LookAndFeel imitating the look): transport, clip-grid, step editor,
            TB-303 panel, drum grid, mixer
```

### The registry in C++ (keep "drop a file = new engine")

The build-time glob becomes **compile-time static auto-registration**: each engine `.cpp`
declares a static object whose constructor calls `EngineRegistry::add(id, factory)`. At startup
the registry already knows every engine without the core being touched. Same pattern for FX and
modulators. This preserves "drop a file, don't edit the core".

---

## Section 2 — DSP engine & sound

### The `SynthEngine` / `Voice` contract (same spirit as today)

```
  SynthEngine            (one engine = one "plugin" in the registry)
    ├ prepare(sampleRate, blockSize)      // pre-allocate EVERYTHING here, never in processBlock
    ├ noteOn(note, vel, accent, slide, sampleOffset)
    ├ noteOff(note, sampleOffset)
    ├ renderBlock(buffer, numSamples)     // sums its voices into the buffer
    ├ applyPreset(json)                   // same keys as public/presets/<engine>.json
    └ params() -> [ParamSpec]             // mirror of EngineParamSpec[]

  Voice                  (one live note)
    ├ start(...) / release() / isActive()
    └ render(buffer, n)                   // its DSP; exposes its modulation targets
```

The `sampleOffset` is the key novelty: when the scheduler says "this note falls 1/3 into the
block", the engine starts the voice at that exact sample, not at the block start.

### Wrapping the libraries (the practical rule)

Not "one library for everything" — the best tool per block, all behind **our own** interfaces so
they can be swapped without touching engines:

| DSP block | Proposed library | Why |
|---|---|---|
| Filters, EQ, base oscillators, ADSR, gain/pan, oversampling | **JUCE `dsp`** | Mature, sample-accurate, already in the framework |
| Karplus-Strong, physical models | **STK** | Algorithm ready and validated |
| FM, wavetable | **JUCE dsp + thin custom osc** | Mostly a phase accumulator; little code |
| Reverb / Delay | **JUCE dsp** (or custom delay) | Standard |

Engines do **not** know the library: they see `core/dsp/Filter.h`, `Oscillator.h`,
`Envelope.h` (thin wrappers). Swapping the underlying filter touches one wrapper, not 7 engines.

### TB-303 character (sequencing behaviour, kept by hand)

The 303 sound is **behaviour**, not "a filter": slide ramps pitch and *skips the amp re-attack*,
accent raises envelope+Q+gain. That is sequencing logic (today in `src/core/synth.ts` + the
scheduler) and it is ported **by hand** on top of the library filter — the library provides the
filter, we provide the behaviour. Same for the slide/accent shared with drums.

Note: since sound parity is explicitly not a goal, **timbre** is entirely at the library's
discretion. The hand-ported part is the *behaviour* (slide skips re-attack, accent bumps), which
is desired regardless of how the filter itself sounds.

### Offline render for inspection (no parity target)

JUCE can run `processBlock` with no sound card (like the current `OfflineAudioContext`). We keep
a render-to-WAV path purely for **audible inspection** during development (gitignored). There is
**no golden comparison and no parity assertion** — only optional relative safety asserts
(non-silent / non-NaN / non-clipping) if a basic net is wanted.

### What enters the slice

DSP = **TB-303** (with full slide/accent behaviour) + **DrumMachine** (default kit). All other
engines (subtractive, fm, wavetable, karplus, sampler) are ported **afterwards**, one at a time.
The registry makes them appear in the selector without touching the core.

---

## Section 3 — Transport, sample-accurate scheduler, session model

### The data model (`core/`, no JUCE, testable alone)

A 1:1 mirror of `SessionState`, in pure C++ structs that (de)serialize the `schemaVersion 3` JSON:

```
  SessionModel
    ├ lanes:   [ Lane { engineId, engineState, clips[], inserts[], mods[], strip } ]
    ├ scenes:  [ Scene ]
    ├ clips:   Clip { notes: [NoteEvent{pitch,startTick,lengthTick,vel,accent,slide}] }
    └ bpm, length, ...
```

`core/` does **not** depend on JUCE — pure logic, unit-tested with a C++ framework
(Catch2/GoogleTest) the same way the pure `.test.ts` files are today. JSON is read via
`juce::var` or a header-only lib (nlohmann/json) — decidable during planning.

### Transport: a sample-based timeline

```
  Transport
    ├ sampleRate, bpm
    ├ playhead in SAMPLES (not seconds — avoids drift)
    ├ samplesPerStep = sampleRate * 60 / bpm / 4   (16th notes, as today)
    └ advance(numSamples) each processBlock
```

The playhead is measured in **absolute samples**, eliminating the drift the browser suffers
under tab throttling — the audio clock *is* the truth.

### LaneScheduler: from "create future nodes" to "emit offset events"

The most important translation of `src/core/lane-scheduler.ts`:

```
  Each processBlock(numSamples):
    for each lane:
      while the next step falls inside [playhead, playhead+numSamples):
        sampleOffset = stepStartSample - playhead
        consult step N-1 → slide? → pass slide=true   (current rule intact)
        emit noteOn/noteOff to the lane's engine WITH that sampleOffset
      advance the lane's step cursor
```

The **slide** logic (look at step N-1's flag, ramp pitch, skip re-attack, extend duration 1.5×
to overlap the gate) and **accent** are ported **literally** — pure sequencing logic, independent
of Web Audio. Only the *destination* changes: instead of scheduling future `AudioParam` ramps,
the voice is flagged to ramp inside its `render()`.

### The UI ↔ audio crossing (glitch-free)

```
  UI thread                         lock-free queue            Audio thread (processBlock)
  ─────────                         (AbstractFifo)             ───────────────────────────
  launch clip, set knob,     ──►   [Command{type,             drain commands →
  mute/solo, change bpm             laneId, value,            apply to model/voices;
                                    sampleOffset}]            advance transport; render
```

A single place where the UI mutates audio state: push a `Command` to the queue. The audio thread
drains them at the start of each block. No mutex, no allocation on the RT thread.

### What enters the slice

Transport + LaneScheduler complete (little code, de-risks everything). The **model** only needs
to load what the slice uses: lanes with an engine, clips with notes, bpm, basic scenes. Mute/solo
and clip/scene launch enter because they are the "end-to-end sounds". Inserts/FX/mods are wired
in the model but may be **empty** in the slice and filled in when `fx/` and `modulation/` are
ported.

---

## Section 4 — The JUCE layer: AudioProcessor, device I/O, plugin hosting

### One `AudioProcessor`, two products

```
        core/ + engine/ + transport/  (the engine, no JUCE)
                        │
              LoomAudioProcessor : juce::AudioProcessor
                 ├ prepareToPlay(sr, blockSize)  → engine.prepare(...)
                 ├ processBlock(buffer, midi)     → drain UI queue, run scheduler, render
                 └ getStateInformation / set...   → serialize the JSON v3
                        │
            ┌───────────┴───────────┐
   Standalone target            VST3 target
   (.exe, opens WASAPI/ASIO)    (loaded by the DAW)
```

The `AudioProcessor` is the only contact point with JUCE. The engine does not know whether it
runs inside a `.exe` or inside Ableton. **The same `processBlock`** serves both targets — JUCE
generates both binaries from one project. This delivers *native .exe* and *VST3* with no extra
work once the processor exists.

### Device I/O: the path to low latency

In **standalone**, JUCE opens the device via `AudioDeviceManager`:

```
  WASAPI shared    → easy, medium latency        (safe default for the slice)
  WASAPI exclusive → low latency, bypasses Windows mixer
  ASIO             → lowest, pro                  (needs Steinberg SDK, optional)
```

For the **slice** we open **WASAPI** (no external SDK, works on any Windows). ASIO is a later
"build-with-SDK" checkbox — a project flag, not re-architecture. In **VST3** there is no device
I/O: the DAW supplies buffers and clock, so `Transport` must be able to **follow the host**
(read `getPlayHead()`), not only run its own clock. We provide for this in the `Transport`
interface from the start.

### Hosting third-party plugins (objective #3)

JUCE provides `AudioPluginFormatManager` + `AudioProcessorGraph`. The current `InsertChain`
(per-lane and master FX) becomes a **graph of nodes**, where a node can be:
- one of **our** FX (ported reverb/delay/distortion/multifilter), or
- an **external plugin** (VST3/AU) the user loads.

Both live as nodes in the same graph. **This does NOT enter the slice** — it is a later phase —
but `fx/InsertChain` is designed from day 1 as a "list of processing nodes" so adding external
hosting later is plugging in one more node type, not rebuilding the chain.

### State and presets

- **Save/load session:** `getStateInformation` serializes `SessionModel` to the **same JSON v3**.
  A session saved in standalone opens inside the DAW and vice versa.
- **Presets:** `applyPreset(json)` reads the same `public/presets/<engine>.json`. Packaged as
  binary resources (`BinaryData`) or read from disk — decidable during planning.

### What enters the slice

`LoomAudioProcessor` + **standalone** target + **WASAPI** + save/load JSON v3. The VST3 target is
*enabled* (nearly free to keep compiling), but "follow the host clock" and external plugin hosting
are **later phases**. The slice must: open the device, sound the sequenced TB-303 + drums, and
save/load the session.

---

## Section 5 — Native UI in JUCE + build & test strategy

### The UI challenge: ~1,930 lines of SCSS and a rich UI → JUCE components

JUCE has no CSS; the look is achieved with a central **`LookAndFeel`** (the class that draws all
controls). That is the piece that imitates "the current look":

```
  LoomLookAndFeel : juce::LookAndFeel_V4
    └ defines colors, typography, and the drawing of knobs/sliders/buttons/cells
       → a single place capturing the visual identity; all components inherit it
```

Component map (mirror of the web UI), in order of need for the slice:

| JUCE component | Equivalent to | Slice? |
|---|---|---|
| `TransportBar` | play/stop/bpm | ✅ |
| `ClipGrid` (lanes × scenes) | `session-ui.ts` clip grid | ✅ |
| `StepEditor` / `PianoRoll` | `pianoroll.ts` + drum-grid | ✅ (at least drum-grid + step) |
| `TB303Panel` (knobs) | engine editor | ✅ |
| `Knob` + `SelectControl` | `knob.ts` | ✅ (base of everything) |
| `Mixer`, `ModPanel`, `InsertChainUI`, `EngineSelector` | mixer/modulation/fx/selector | ❌ later phase |

The automatable `Knob` is the base: once "knob → push Command to queue → audio reads it smoothed"
is solved, every other control follows the same mold.

### UI philosophy: the UI holds no audio state

The UI **reads** a copy of the model and **writes** only by pushing commands to the queue
(Section 3). It never touches voices or nodes. Visual render (playhead, meters) reads atomic
values published by the audio thread, on a UI `Timer` (~60fps) — exactly as the current visual
playhead is a separate timer from the audio.

### Build strategy

```
  CMake + JUCE (subdir or CPMAddPackage)
    ├ target: loom_core        (static library, NO JUCE → pure tests)
    ├ target: Loom_Standalone  (.exe, WASAPI)
    ├ target: Loom_VST3        (same AudioProcessor)
    └ target: loom_tests       (Catch2/GoogleTest over loom_core)
  Toolchain: MSVC (Visual Studio) on Windows.
```

CMake (not the Projucer) for version control, CI, and modern editors. JUCE enters as a project
dependency, not copied into the repo.

### Test strategy (mirror of the 4 current layers, adapted)

1. **Pure** (model, scales, JSON v3 migration, slide/accent math, scheduler) →
   **Catch2/GoogleTest over `loom_core`**, no JUCE. The bulk goes here: scheduler and JSON v3
   (de)serialization tested thoroughly with a fake clock, as today.
2. **Scheduling** → `LaneScheduler` test advancing simulated sample blocks, verifying `sampleOffset`
   lands where it should (mirror of `lane-scheduler.test.ts`).
3. **DSP real** → offline `processBlock`-to-WAV render for **audible inspection** (gitignored).
   **No golden, no parity assertion** (sounding different is fine), plus optional relative
   non-silent/non-NaN/non-clip safety asserts.
4. **UI** → minimal. Validated mostly **by hand**. No UI e2e investment for the slice.

The key: **the engine (`loom_core`) is tested thoroughly and without JUCE**, like the pure logic
today. The UI is eyeballed. Confidence stays where it matters (timing, data, sequencing) without
the cost of native UI tests.

### Assertion rule (carried over)

Tests assert **relatively** (ratios, `>`/`<`/`>·2`), never absolute magnitudes — the same rule
as the current suite.

---

## The vertical slice = the v1 "done" definition

> A `.exe` (in the new **`LoomN`** repo) that opens WASAPI, loads a `schemaVersion 3` session JSON
> with one **TB-303** lane + one **drums** lane, sequences them with sample-accurate slide/accent,
> shows them in a `ClipGrid` + step editor using the LookAndFeel that imitates the current look,
> lets you tweak TB-303 knobs live (via the lock-free queue), and **sounds**. VST3 compiles from
> the same processor. The `tb303-synth` web repo is untouched and shares a VS Code workspace with
> `LoomN`.

Everything else is a later phase, with the architecture already validated:

- Remaining engines: subtractive, fm, wavetable, karplus, sampler (one at a time, behind the registry).
- FX (`InsertChain` nodes) + modulation (LFO/ADSR + connection matrix).
- Mixer, mod panel, engine selector, full piano-roll UI.
- Hosting external VST3/AU plugins as graph nodes.
- ASIO (build flag + SDK); VST3 "follow host clock".
- MIDI import path (reuse the pure SMF parser logic).

## Out of scope (YAGNI for this design)

- Sound parity with the web version (explicitly a non-goal).
- WebView/hybrid UI (rejected — native JUCE chosen).
- macOS/Linux builds (Windows-first; JUCE keeps the door open but it is not a goal now).
- Re-tuning passes / golden WAV maintenance.

## Open questions to resolve during planning (not blockers)

- JSON library: `juce::var` vs nlohmann/json.
- Test framework: Catch2 vs GoogleTest.
- Preset packaging: `BinaryData` vs read-from-disk.
- Exact STK vs JUCE-dsp split for Karplus/FM/wavetable (decided per engine as they are ported).
