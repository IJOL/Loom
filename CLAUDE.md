# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Loom** — a browser-based, session-based music workstation built on Web Audio + TypeScript + Vite. It grew out of a Roland TB-303 bass synth + drum machine and still has those at its core, but is now a multi-engine instrument host: **6 melodic engines (TB-303, Subtractive, FM, Wavetable, Karplus, Westcoast) + a Sampler + an Audio-channel engine + a Drum machine** (9 registered engines), arranged as **lanes** that play **clips** in **scenes**, with per-lane modulation, inserts/FX, a mixer with sidechain compression, MIDI import, and global undo. **Synthesis runs in an AudioWorklet** (`src/audio-worklet/` + the pure DSP kernel in `src/audio-dsp/`); the mixer, inserts and master stay native Web Audio nodes. Audio is loaded into IndexedDB by the Sampler, the Audio channel, the sample-based drum kits, and the Stems importer.

Everything is a **plugin behind a registry** — engines, FX, and modulators are discovered at build time, so adding one means dropping a file, not editing the core.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start Vite dev server (hot reload) at <http://localhost:5173>
- `npm run build` — typecheck (`tsc`) + bundle to `dist/`
- `npm run preview` — serve the production build locally
- `npx tsc --noEmit` — typecheck without bundling
- `npm test` — full suite: Vitest unit tests + Playwright e2e tests, colour-free (`NO_COLOR=1` via `cross-env`)
- `npm run test:unit` — Vitest only (no browser)
- `npm run test:fast` — everything except DSP renders (inner-loop TDD), colour-free
- `npm run test:dsp` — only the real-DSP renders (slower, requires `node-web-audio-api`), colour-free
- `npm run test:e2e` — Playwright tests in `tests/e2e/` against `vite preview` on port 4173
- `npm run test:e2e:headed` — same but with a visible browser window for debugging
- `npm run test:wav-diff` — compares `test/output/*.wav` (last run) against `test/golden/*.wav` (committed reference) and prints peak/RMS/L2 deltas. Never fails CI — human inspection tool.
- `npm run test:wav-bless` — overwrites `test/golden/` with the current `test/output/`. Deliberate action; commit the result.
- `npm run build:pages` — the GitHub-Pages build (`--base=/Loom/`); what the deploy actually ships.
- `npm run build:manual` — regenerate `docs/manual/` (+ `manual:shots`, `manual:pdf`).
- `npm run test:watch` — Vitest in watch mode.
- `npm run bump` — manual version bump (versioning is never automatic).

**Test colour convention:** every npm test script is wired with `cross-env NO_COLOR=1` so terminal output stays grayscale. When invoking vitest directly (e.g., a single file), prefer `NO_COLOR=1 npx vitest run path/to/file.test.ts`. Do NOT add `--reporter=...` to override — the npm scripts already do the right thing.

No linter is configured.

## Gotchas (read before running tests / shipping)

- **`test:e2e` / `npm test` serve `dist/` with NO build step.** Playwright boots `vite preview`, which serves the last production build. If you changed `src/` and didn't `npm run build`, the e2e suite tests a **stale bundle** — the newest features fail with "element not found" and it looks like a regression. Always `npm run build` before `npm run test:e2e`.
- **`test:unit` has a flaky teardown.** It occasionally exits non-zero with `ERR_IPC_CHANNEL_CLOSED` (tinypool / `node-web-audio-api` worker shutdown) **after all tests pass**. Vitest is configured to run files serially because `node-web-audio-api` is unsafe under parallel forks; the teardown error is not a test failure — re-run to confirm green.
- **Live param tweaks apply to the *next* trigger, not the held note** — engine params are read at trigger time.

## Testing layout

Four layers, distinct technique per risk class:

1. **Pure** — schemas, scales, migrations, pattern/session/arrangement logic, modulation math. `src/**/*.test.ts` (not `.dsp` or `.wiring`).
2. **Scheduling (mocks)** — the per-lane look-ahead scheduler and session runtime via a fake clock. [src/core/lane-scheduler.test.ts](src/core/lane-scheduler.test.ts) and [src/session/session-runtime.test.ts](src/session/session-runtime.test.ts).
3. **DSP real** — every engine + every drum kit rendered through `OfflineAudioContext` (via [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api), globalized in [test/setup.ts](test/setup.ts)). Files end in `.dsp.test.ts`. Use the shared battery in [test/dsp-battery.ts](test/dsp-battery.ts) (`runStandardEngineBattery`). Each render writes a WAV to `test/output/` (gitignored) for audible inspection; `test/golden/` is the committed reference.
4. **Modulation (objective, end-to-end)** — renders each engine through the REAL in-engine path (`ModulationRuntime` → `VoiceManager` → renderer) with an LFO/ADSR on a continuous param and measures that the rendered sound changes (+ a negative control). [src/audio-dsp/modulation-pipeline.test.ts](src/audio-dsp/modulation-pipeline.test.ts) — it recovered the per-engine modulation coverage the worklet rewrite dropped (the old `.wiring.test.ts` routed LFO/ADSR into a Web-Audio `AudioParam`, which no longer matches how the worklet engines modulate). The few remaining `.wiring.test.ts` (e.g. `core/ducker-subgraph`) still cover Web-Audio subgraph wiring like sidechain.

Assertion rule: **always relative**. Use ratios (`>`, `<`, `> * 2`), never absolute magnitudes. Absolute thresholds are a brittleness smell; if you write one, justify it in a comment.

## Architecture

Source is organised into subsystems under `src/`. The spine: a **registry of engine/fx/modulator plugins**, a **`SessionState`** data model (lanes → clips → scenes), and a **`LaneResourceMap`** that owns the live audio nodes for each lane.

- **[src/core/](src/core/)** — shared DSP primitives and pure logic. `synth.ts` (the original monophonic `TB303` voice), `drums.ts` (`DrumMachine` + the `KITS` parameter bags), `sequencer.ts` (the master clock + `sessionTick`; `onLookahead` lives in `app/performance-feature.ts`), `lane-scheduler.ts` (`tickLane` note-based look-ahead), `lane-resources.ts` (`LaneResourceMap`: per-lane strip + engine + insert chain), `fx.ts` (`ChannelStrip`, `MasterCompressor`, EQ params), `comp-block.ts` (`CompBlock`), `sidechain-bus.ts`, `history.ts` (undo/redo controller), `knob.ts` + `select-control.ts` (automatable UI controls), `pianoroll.ts` (+ zoom/frame), `notes.ts`, `comp-state.ts`, `transport-state.ts`.
- **[src/engines/](src/engines/)** — the `SynthEngine` abstraction ([engine-types.ts](src/engines/engine-types.ts)) + [registry.ts](src/engines/registry.ts). One file per engine: `tb303`, `subtractive`, `fm`, `wavetable`, `karplus`, `sampler`, `audio` (dedicated audio channel), `drums-engine`. Params are declared as `EngineParamSpec[]` ([engine-params.ts](src/engines/engine-params.ts)); voices expose their continuous params via `Voice.getAudioParams()` and engines expose shared ones via `getSharedAudioParams()`. The lane engine selector lives in [engine-selector-ui.ts](src/engines/engine-selector-ui.ts).
- **[src/session/](src/session/)** — the session model and its UI. [session.ts](src/session/session.ts) (`SessionState`/`SessionLane`/`SessionClip`/`SessionScene`; clips hold a unified `notes: NoteEvent[]`; `moveClip`/`copyClip`/clip colors), [session-runtime.ts](src/session/session-runtime.ts) (launch/scene/quantize/`tickSession`), `session-host.ts` (the UI controller that owns lanes), `session-ui.ts` (clip grid + drag), `session-inspector.ts`, `clip-editors/` (router → `piano-roll` or `drum-grid`), `session-engine-state.ts` (mirrors knob/modulator/sampler-keymap edits into `lane.engineState`), `session-migration.ts` (load-time normaliser).
- **[src/modulation/](src/modulation/)** — LFO/ADSR modulators, `ModulationHost`, `ModulatorScope` (shared vs per-voice), and the connection binder that routes a modulator into a target `AudioParam` by id.
- **[src/plugins/](src/plugins/)** — plugin SPI + registry; `fx/` (11 inserts: `multifilter`, `distortion`, `reverb`, `delay`, `compressor`, `limiter`, `tremolo`, `chorus`, `flanger`, `phaser`, `bitcrusher` — chorus/flanger share `modulated-delay.ts` — plus the generic `InsertChain`) and `modulators/` (`lfo`, `adsr`). Discovery is a build-time `import.meta.glob` scan of `src/engines/*` + `src/plugins/**` (`plugin-bootstrap`). Inserts are native Web Audio nodes, NOT worklets — only synthesis lives in the worklet.
- **[src/presets/](src/presets/)** — presets are **JSON assets** in `public/presets/*.json` (20+ per *melodic* engine, GM-tagged; Sampler/Drums have far fewer, and `drum-kits.json` holds 81 kits untagged), loaded/validated by `preset-loader.ts` and applied via `preset-apply.ts`. A preset may carry its own `modulators` (an LFO/ADSR shipped with the sound).
- **[src/midi/](src/midi/)** — pure SMF parser (`midi-parse.ts`) → `midi-to-session.ts` transform, GM matching (`gm-lookup.ts`), plus the import UI + audition.
- **[src/samples/](src/samples/)** — sample types, IndexedDB store + decoded-buffer cache, keymap resolution + repitch, import metadata.
- **[src/performance/](src/performance/)** — the arrangement/record model: `rec-state`, `arrangement-ops`, `arrangement-runtime` (record clip-launches + knob automation, replay them). Takes now surface as timeline bands (`performance-ui.ts` `renderPerformanceView`) and persist in v3 saves (`SavedStateV3.arrangement`).
- **[src/polysynth/](src/polysynth/)** — `PolySynth` (the poly voice host used by Subtractive): voice stealing, mono mode w/ legato/retrig, a modulation bus fanned per voice.
- **[src/app/](src/app/)** — `main.ts` was decomposed into factories here: `audio-graph` (master bus → insert chain → master compressor → analyser + `SidechainBus`), `lane-allocator` (`ensureLaneResource`/`swapLaneEngine` — the sole allocation path), `trigger-dispatch`, `knob-mounting`, `mute-solo`, `bpm-broadcast`, `automation-recording`, `engine-swap`, `performance-feature`, `plugin-bootstrap`, `lane-host-wiring`.
- **[src/save/](src/save/)** — `SaveManager` persists **session-only** state as `schemaVersion: 3` (`saved-state-v3.ts`); `history-wiring.ts` (`withUndo`/`attachKnobUndo`/keyboard) bolts undo onto every mutation site.
- **[src/main.ts](src/main.ts)** — boot + remaining DOM glue: builds the UI, allocates lanes, wires controls, resumes the `AudioContext` on first play.
- **[src/audio-dsp/](src/audio-dsp/)** — the pure DSP kernel the worklet runs: one `*-renderer.ts` per engine (self-registering into `renderer-registry.ts`), `voice-manager.ts`, `scheduler-queue.ts`, `modulation-runtime.ts`, plus primitives (`osc`, `filter`, `ladder`, `sync-osc`, `unison`, `adsr`). Plain JS/TS — unit-testable with no AudioContext.
- **[src/audio-worklet/](src/audio-worklet/)** — the processors + their typed node wrappers: `loom-processor`/`loom-node` (melodic), `drums-*`, `sampler-*`. Processors are referenced ONLY via `?worker&url` and their registered string name — never imported on the main thread (see `processor-name.ts`).
- **[src/export/](src/export/)** — offline scene/WAV render + live take recorder. It must replicate the LIVE path (presets, automation, worklet registration) or exports drift from what you hear.
- **[src/control/](src/control/)** — live-MIDI control surfaces (APC Key 25 profiles, `loom-facade`) + computer-keyboard-as-MIDI + live note recording.
- **[src/stems/](src/stems/)** — stem separation import (the local Demucs service) + system-audio capture.
- Also: `automation/`, `notefx/` (per-lane arp + chord note-FX, replaced the old global `arp/`), `demo/` (baked MIDI demos + picker), `patterns/`, `perf/` (PERF HUD), `styles/` (SCSS).

## TB-303 behaviors that drive the design

These live in the TB-303 engine ([src/core/synth.ts](src/core/synth.ts) + the lane scheduler) and shaped the slide/accent model now shared more broadly:

- **Slide** — a step's `slide` flag means "slide INTO the next step." When the scheduler emits step N it consults step **N-1**'s slide flag; if set it passes `slide: true` to the voice, which ramps pitch and *skips the amp re-attack* so the previous gate keeps holding. Sliding-out steps get an extended duration (1.5× step) so the gate overlaps the next trigger.
- **Accent** — per-step: brightens the filter envelope + bumps Q + raises gain on bass; raises velocity on drums.

## When adding/changing things

- **Add an engine — FOUR steps, not one.** Since the worklet cutover, "drop a file" is NOT enough: the glob makes the engine appear in the selector, but a lane using it stays SILENT at note time unless every step is done.
  1. `src/engines/<id>.ts` — implements `SynthEngine`, calls `registerEngine` + `registerEngineFactory`. Declare params as `EngineParamSpec[]`.
  2. `src/audio-dsp/<id>-renderer.ts` — the per-sample voice renderer, self-registering via `registerRenderer` so `VoiceManager.createRenderer(engineId, …)` can build it.
  3. **Side-effect import that renderer in [src/audio-worklet/loom-processor.ts](src/audio-worklet/loom-processor.ts)** — otherwise it never registers *inside the worklet bundle*.
  4. **Add the id to `WORKLET_ENGINE_IDS` in [src/app/lane-allocator.ts](src/app/lane-allocator.ts)** — the allocator only routes listed ids to the worklet path.
- **Add an FX or modulator** — drop a file in [src/plugins/fx/](src/plugins/fx/) or [src/plugins/modulators/](src/plugins/modulators/) and `registerPlugin`. Inserts mount per-lane and on master; modulators appear in the modulation panel.
- **Add a drum kit** — append an object to the `KITS` array in [src/core/drums.ts](src/core/drums.ts); kits are parameter bags over the same DSP primitives. Add a new drum *voice* by extending the `DrumVoice` union + `DRUM_LANES` + every kit + a `play<Voice>()` method + a `trigger()` case.
- **Add a preset** — add an entry to the relevant `public/presets/<engine>.json` (with an optional `gm` program tag). JSON is the source of truth.
- **Scheduling** — `bpm`/`length` are mutable at runtime; the next scheduled step uses the new values. Step duration is `60 / bpm / 4` (16th notes). The visual playhead is a separate timer matched to the scheduled audio time and may drift under tab throttling, but audio scheduling is unaffected.
- **Session UI** — the clip grid and inspector are rebuilt by `session-host`; clip cells cycle/launch and the inspector auto-renders the engine editor. Don't hand-roll a parallel render path — go through `session-host`.
- **Anything that lists parameters the user can target** (a modulation dropdown, an automation picker, an XY pad axis, a MIDI mapping) MUST call `DestinationRegistry.list()` from [src/automation/destination-registry.ts](src/automation/destination-registry.ts) and `subscribe()` to stay fresh. Do NOT enumerate the knob registry and do NOT build a parallel list — that is how four inconsistent pickers happened. See [docs/automation-destinations.md](docs/automation-destinations.md).

## Design history

Implemented design docs are intentionally **not kept in the tree** — they drift from the code and pollute context; recover them from git history if you need the rationale (`git log --diff-filter=D --name-only -- docs/superpowers/`). As of 2026-07-18 **every spec/plan/mockup has been implemented and pruned**: [docs/superpowers/](docs/superpowers/) holds only [REMAINING-WORK.md](docs/superpowers/REMAINING-WORK.md), which records a couple of small code debts. A future spec/plan re-creates `specs/`/`plans/` under that directory.

## Approved mockups & honest "done" (process — learned the hard way 2026-06-06)

A failed Sampler overhaul (shipped the OLD UI instead of the approved mockup; a loop preset that never played) traced to one root cause: **the approved mockup was never turned into verifiable requirements**, and "tests green" was treated as "done". Rules:

- **An approved mockup is a committed artifact.** When the user approves a mockup, save it in-tree next to its spec (`docs/superpowers/specs/<date>-<topic>-mockup.html`) and link it from the spec. NEVER leave it as a throwaway `public/*-mockup.html` — those get deleted (the Sampler one was lost, uncommitted, forever).
- **The spec must link the mockup and name what it drops.** If a spec defers or excludes any part of the approved *look*, that is the **user's** call → a `⛔ CONFIRMAR` block, not a silent scope cut. Re-scoping "make it like the mockup" into "reorganise the logic on the old UI" is the exact failure to avoid.
- **Visual parity is an acceptance criterion.** For any work with an approved mockup, "done" requires a human look: load the real screen, screenshot, compare side-by-side with the mockup. Automated tests do not check whether it matches what was approved.
- **One test per user path.** No `(or …)` alternatives in test tasks — they let a broken path (e.g. the loop *preset* picker) hide behind a working one (loop *import*). Each path gets its own test.
- **Don't claim a UI feature "done"/"verified" without opening it and looking.** (Complements "lean on code, not the browser" for *debugging* — but for *done-claims on UI*, the browser look is mandatory.)

## Driving Loom in Playwright — load a MIDI + play a scene (exact flow; don't rediscover it)

A real session burned ~20 turns fumbling this. Follow it verbatim.

- **Server:** the build under test is whatever `npm run dev` serves at <http://localhost:5173> (a worktree has its own — run `npm run dev` inside the worktree). The Playwright MCP server's cwd is the **MAIN checkout**: default `browser_snapshot` files land in `<repo-root>/.playwright-mcp/`, but a snapshot taken with a custom `filename` lands in `<repo-root>/` itself — `Glob`/`Grep` to find it.
- **Snapshots are huge** (every lane has an engine/preset dropdown → 2000+ lines, exceeds the token cap). NEVER read a full `browser_snapshot`; save to a file + `Grep` for the ref you need, or query the DOM with `browser_evaluate`. Toolbar refs (e7 ▶, e8 ⏹, the ⬇ MIDI group) are stable across reloads; grid refs are not.
- **Import a MIDI (two steps — the toolbar button is NOT the commit):**
  1. Toolbar **"⬇ MIDI"** → reveals a **"Choose File"** button. Click it → file-chooser modal → `browser_file_upload` with the absolute `.mid` path.
  2. The toolbar then shows a per-track preview + an **"Import MIDI"** button. Click it → opens a **modal `<dialog id="app-dialog">`** whose bottom action buttons are **Cancel / Sustituir (replace) / Añadir (add)**. Click **Sustituir** (or Añadir) — THAT is the commit. The `<dialog>` is modal and intercepts pointer events, so nothing else (incl. ▶) is clickable until you resolve it.
- **Play a SCENE — ALWAYS use the scene launch, not the global transport (user's standing preference):**
  1. Click the **"Session"** view tab.
  2. A scene is a ROW of per-lane clip cells. That row has ~N **per-clip ▶** buttons (one per lane) — do NOT click those, each launches a single clip. The **scene launch** is the row's own **named button `▶ <SceneName>`** at the end of the row (a MIDI import creates a scene named **"MIDI Import"** → click **`▶ MIDI Import`**). That launches ALL clips in the scene = the whole arrangement. (Clicking a clip ▶ instead of the named scene button is the exact mistake that cost ~20 turns, twice.)
- **Audio gating:** only a TRUSTED click (`browser_click`) resumes the AudioContext + counts as the play gesture. A synthetic `.click()` via `browser_evaluate` does NOT — it's fine for dismissing the import dialog (Sustituir), NOT for the scene/transport play.
- **Objective audio measurement (master tap):** no `window.__loom`/audio global exists, so to measure peak/RMS/cortes: `browser_run_code_unsafe` → `page.addInitScript(...)` BEFORE boot, then reload. The init script wraps `window.AudioContext` so each instance does `createAnalyser()`, pre-connects it to `ctx.destination`, and monkeypatches `AudioNode.prototype.connect` to route anything connecting to `destination` THROUGH the analyser; stash analyser→`window.__an`, ctx→`window.__ctx`, and run a rAF max-peak tracker into `window.__peak`. Then per frame `getFloatTimeDomainData` → RMS+peak; **near-silent frames mid-playback = cortes; peak ≥ 1.0 = clipping.** VERIFIED 2026-06-24: dense 16-channel "Children" through the worklet scene = **peak 0.92 (no clip), RMS ~0.23 steady, 0 near-silent frames (no cortes)**.

## Dense-MIDI "cortes"/dropouts — already diagnosed, do NOT re-investigate

Dropouts under dense polyphony were the **node-per-note architectural ceiling** (per-note Web Audio node churn → GC starves the main-thread scheduler), diagnosed at length (memory `project_voice_lifecycle_graph_leak`). **The cure — the AudioWorklet engine rewrite — SHIPPED and is merged on `main`**: the worklet is now the sole synthesis path and the legacy node-per-note layer is deleted. Dense "Children" MIDI runs clean where node-per-note couldn't. If dropouts resurface, they are a NEW bug — don't re-derive the old diagnosis, and don't look for a "worklet build" to compare against.

> **Voice cap REMOVED (commit `96b8fea`):** the spec's "global polyphony cap" was reversed — a finite per-lane cap evicted still-sounding voices (`VoiceManager.spawn` did `slots.shift()` before the voice's release rendered → a step discontinuity → audible **clicks** in dense parts). Now: poly lanes are UNCAPPED, mono lanes (`maxVoices === 1`) still steal their previous voice, global cap = `Infinity`. **Do NOT re-add a finite voice cap — it clicks.** (Details in memory `project_audioworklet_engine_rewrite`.)

## Stems / audio separation — launch + test the worklet Sampler/Audio path

- **Launch the stem-service** (the local Demucs backend the Stems button + transcription call). The venv is gitignored → it lives ONLY in the MAIN checkout (`c:/Users/nacho/git/tb303-synth`), never a worktree; run from there, in the BACKGROUND:

  ```bash
  cd "c:/Users/nacho/git/tb303-synth/tools/stem-service" && ./.venv/Scripts/python.exe -m uvicorn app:app --port 8765
  # then verify by the health endpoint (NOT the log), retrying until it listens:
  curl -s --retry 20 --retry-delay 1 --retry-all-errors http://127.0.0.1:8765/health   # → {"ok":true,"model":"htdemucs.yaml"}
  ```

  The uvicorn/`print` log is block-buffered — DON'T trust it for activity; verify via `/health` above or the browser/network. CORS accepts any localhost port (a worktree dev on 5173/5174 reaches it). GPU = RTX 5070 Ti, Torch cu128.
- **Stems UI trigger = the "☰" button `#stems-open`** in the transport bar (title "Separate a song into stems"), NOT "⊙ Capture" (that's scene-capture). It opens `#stems-modal`: file input `#stems-file`, "Replace the session" `#stems-replace` (default on), "Separate" `#stems-run`.
- **Drive via Playwright:** click `#stems-open` → click `#stems-file` → `browser_file_upload`. ⚠️ The audio file MUST be under the repo root — Playwright's allowed roots are `<repo>` and `<repo>/.playwright-mcp`, so a `~/Downloads` file is rejected: copy it into `.playwright-mcp/` first, upload, then delete it. → click `#stems-run` → wait ~15-30 s (Demucs on GPU; first run downloads the model) → `#stems-status` reads "Done", the modal closes, and 4 audio lanes load as a scene named **"Stems"** → Session → `▶ Stems` to play.
- VERIFIED 2026-06-24: a Solid Sessions mp3 → 4 stems → worklet Sampler/Audio path = audible, peak 0.35, **0 clipping, 0 dropouts, 0 console errors**.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Loom** (10172 symbols, 22127 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Loom/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Loom/clusters` | All functional areas |
| `gitnexus://repo/Loom/processes` | All execution flows |
| `gitnexus://repo/Loom/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
