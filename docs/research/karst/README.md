# Karst — a teardown, and what it means for Loom

Research notes, 2026-08-23. Karst is Tim Exile's browser-based modular audio
environment (private beta, `app.karst.systems`). This document records what was
measured, how, and which parts are inference rather than fact — because several
of the interesting claims here are read off a topology rather than confirmed by
turning a knob.

Everything else in this directory is raw evidence: JSON dumps of four graph
levels, an accessibility snapshot of the rack, and eleven screenshots.

---

## 1. What it is

A node editor where building the instrument IS the composition. Beta since July
2026; standalone Mac/Windows and VST3/AU promised for Q4 2026. Desktop only —
`index.html` carries an inline gate that blocks touch devices, with a comment
blaming Emscripten × WebKit glitches on iPad.

Pricing, from the in-app banner rather than the press: **building is free and
always will be**; £69 buys a premium content pack plus the app and plugin when
they ship. The coverage reported £69 as the price of entry, which is not what
the product says.

`?wasm=1` is vestigial — the app rewrites its own URL to include it.

## 2. Engine architecture

- **C++ → Emscripten**, one 2.26 MB `karst.wasm`, heap fixed at 512 MiB (it
  warns on the console if `HEAPU8.length !== 536870912`).
- Audio is **not** wired by JS. It uses `emscripten/webaudio.h`:
  `emscriptenRegisterAudioObject(audioCtx)` then
  `karst_wasm_boot(handle, sampleRate, 128)`. The C++ creates the
  AudioWorkletNode from inside the wasm and calls back into JS
  (`karstNodeReady`) to connect it to `destination`.
- **Two threads**: `[karst-s1] worklet thread started` renders;
  `[karst-s2] worker pthread` dispatches commands. Response headers set
  `COOP: same-origin` and `COEP: require-corp`, so the page is cross-origin
  isolated and SharedArrayBuffer/Atomics are real (verified live:
  `crossOriginIsolated = true`).
- `karst.js` is **prepended with stubs** for `AudioWorkletGlobalScope`, which
  does not inherit from `WindowOrWorkerGlobalScope`: `crypto.getRandomValues`
  and `performance.{now,timeOrigin,mark,measure,...}`. Their comment is worth
  reading — patching only `.now()` left a crash class open on the audio thread,
  because the `-O3` build reaches `timeOrigin` and the profiling no-ops through
  Emscripten's clock-glue fallback chain.

### The bridge protocol: JSON both ways

Commands go in as JSON strings via `ccall`. Output is a queue the main thread
drains with `karst_wasm_drain_outbound` on `requestAnimationFrame` — and on a
250 ms `setInterval` when the tab is hidden, plus an explicit
`karst_wasm_set_streaming_paused`. One JSON message per line. Snapshot and frame
messages are coalesced; drops are counted per class.

Message kinds observed: `snapshot`, `frame` (meters, master peak/RMS, per
instrument), `wire_data` (a scope tap per wire, audio with min/max or event),
`knob_live` (`scene` / `intermediate` / `actual` / `highlight`),
`piano_roll_telemetry`, `engine_busy`, `connection_rejected`,
`create_template_rejected`, `library_response`.

**State lives in the engine, not in React.** The UI sends commands, receives
snapshots and diffs them to avoid repainting. This is the opposite split from
Loom, where `SessionState` is the truth in TypeScript.

## 3. The document model

**System → Slot → Instrument → Module.**

- A **Slot** is a rack channel with power and solo; instruments chain inside it.
- Each instrument resolves transport and trigger from `fromPrev.*` (the previous
  instrument in the slot), `fromLink.*` (a Link wire — at most one per
  instrument, enforced by the engine) or `fromGlobal.*`, with an `auto` mode and
  a visible `resolvedSource`. The "auto-connects clocks and triggers" claim is
  literal.
- **`event_core`** is system-managed: it cannot be copied or saved to the
  library. It carries `tick`, `bps`, `playState`, `intertick`, `note.voiceID`,
  `Pitch`, `note.triggerCount`, `note.gateOn`, `note.gateOff`.
- **Structure** = a subpatch, copied by value.
- **Template** = a definition referenced by instances. See §6.

Persistence: Supabase (auth with passkeys/WebAuthn, a `telemetry_events` table,
realtime) plus Cloudflare R2 for document bytes, content-addressed by hash
(`documentHash`, `parentHash`, and the error "documentHash in file does not
match requested hash"). The Get Started system is **3.9 MB of JSON**
(`payloadShape=slim-v1`). The engine logged `FORMAT_VERSION=14` at prescan while
the payload declared `formatVersion: 15` — it supports two versions at once,
matching the binary's "does not match supported system versions %d/%d".

## 4. The palette

Seventeen categories, each type carrying search synonyms
(`filter_diode: ["diode","303","acid","squelch"]`):

| Category | Modules |
|---|---|
| Sources | knob, constant, button, value, header |
| Oscillators | sine, saw, triangle, square, noise, **sync** |
| Filters | 1-pole, SVF 2/4-pole, SEM, Ladder, Diode, Sallen-Key, OB-Xd |
| Envelopes & Dyn | line, AD, ADSR, hold, smoother, peak detector |
| Saturation | waveshaper, clipper, wavefolder, tape |
| Dynamics | comp VCA / FET / Opto / Vari-Mu, limiter, gate |
| Crossover | 2-band, 4-band (LR4, phase-corrected) |
| Math | add, sub, mul, mod, invert, 1/x, div, rectify, pow, sqrt, rsqrt, sin, cos, dB to amp and back, clip min/max |
| Logic & Routing | compare, **order**, router, merge, separator, selector, distributor |
| Pitch | pitch to Hz, Hz to pitch, **pitch_conform** |
| Time | delay, diffuser delay, transport |
| Reverb / FX | Mod, Galactic, Plate, Room, NRev |
| Data | array, table read, table write |
| Containers | structure, piano_roll |
| Other | random, scale_sequence, mono_gate |

`order` is Max/MSP's `trigger`: one inlet, N outlets, guaranteed fan-out order.
There are traces of STK in the binary (`= STK effectMix`).

## 5. The kick, dissected

`GEN: KICK MACHINE` is 21 modules / 32 connections at the instrument level,
whose only sound-making node is a structure called `Kick Voice`:
**72 modules / 81 connections**. The breakdown is the story:

| | count |
|---|---|
| Signal — sine osc, noise osc, 4 AD envelopes, 4-pole filter, waveshaper | **8** |
| Arithmetic and routing — 10 multiply, 6 selector, 5 add, 2 MIDI to Hz, subtract, line, smoother | 26 |
| Literal constants — `-40` x5, `0` x4, `20` x2, `40` x2, and 14 singles | 27 |
| Boundary ports — Pitch, Length, Snap, Thud, Boom, Tone, Body, Body Centre, Body Length, Trigger, plus Name out | 11 |

**89% of the patch is plumbing and loose numbers.** Eight nodes make sound. What
in code is `f0 * Math.pow(f1/f0, dt/sweep)` is, there, a `Line` and five boxes.

## 6. Templates — why this is not unmanageable

A **Structure** is copied by value. A **Template** is referenced. The UI states
it outright:

> Template: Parameter Modulation — **15 instance(s)** — read-only

An instance is `type: template_instance`, `editable: false`. The command
vocabulary in the binary fills in the rules:

| command | rule it implies |
|---|---|
| `create_template_from_structure`, `wrap_as_structure` | a template is promoted from an existing structure |
| `create_template_rejected` → `not_at_root` | templates exist only at the instrument root |
| `set_template_edit_mode` → `edit_template` → `commit_template_edit` | editing is an explicit session with a commit |
| `set_template_active_instance` / `activeInstanceHandle` | while editing you choose which instance you look through |
| "template instance cannot be placed inside a template definition" | no recursion |
| `templateSelections`, `templateSelectionHandle` | the active instance is persisted |

Shared topology, **per-instance values** — confirmed from the Full Panel, where
sibling parameters carry visibly different `PATTERN` and `MOD` numbers (0.571,
0.353, 0.364, 0.734, 0.412, 0.385). Browsing an instance in the Structure view
shows one shared reading, which is exactly why `set_template_active_instance`
has to exist.

## 7. The Chord Machine, all four levels

**Root — 14 modules / 24 connections.** `event_core` feeds **`Mono Gate`**,
which collapses note events to a *monophonic* `pitch` + `gate`. That feeds
`Chord engine IN[Pitch, Gate, TC] → OUT[L, R]`. The structure's inspector reads
**Voice Count: 1** — the chord is intervals, not voices.

**`Chord engine` — 52 modules / 76 connections.** Four `Chord Oscillator`s,
whose notes come from `Base (Mod)` plus `Interval 1/2/3 (Mod)` through three
adds. Scale handling via `Scale Sequence` (outputs `position`, `root`),
`Transpose`, `Use Scale` and a `Modulo`. An `ADSR Envelope` fed by
`Attack/Decay/Sustain/Release (Mod)`. A `Sine Oscillator` as LFO into
`LFO>PW (Mod)` and `PW (Mod)`. Two `Ladder Filter`s with `Cutoff (Mod)` and
`Resonance (Mod)`.

**`Chord Oscillator` — 8 modules.**

```
P → Pitch Conform ─┬ scale ┐
                   └ chord ┴→ Selector(Use Scale) → MIDI to Hz → Square Oscillator(pwm) → Out
```

`pitch_conform` has **two taps, `scale` and `chord`**, and runs per sample inside
the voice. Three arbitrary intervals can never be out of key because the
oscillator is incapable of playing out of key. Attributes: `defaultFreq 110`,
`defaultPwm 0.5`.

**The `(Mod)` wrapper — 6 modules**, identical for all fourteen parameters:
`TC → Order → Parameter Modulation → the knob → Value → out`, with the knob
feeding its current value `C` back into the modulator.

**`Parameter Modulation` (the template) — 12 modules / 11 connections.**

```
TC → Order → Add → Multiply → Modulo(·, 1) → Value → (~, *)
      with three knobs of its own:  Pattern · Skew · Amount
```

*Inference, not verified:* the shape reads as `((TC × Pattern) + Skew) mod 1`
scaled by `Amount` — the classic irrational-multiplier trick that yields an
evenly spread, very-long-period deterministic sequence from a trigger index. The
three modulation inlets every knob exposes (`~`, `*`, `S`) were not confirmed;
offset / factor / step-or-sample is a guess.

**Expanded, one Chord Machine is roughly 330 modules** — built from about 15
distinct primitives and two templates. The complexity is reuse, not authoring.

### The macro wiring

Selecting `Interval 1` shows `min 2 / max 18 / step 1` and a **macro slot**
dropdown listing all 24. **Each knob declares which macro owns it**; the macro
keeps no list of its own — the same inversion as Loom's `capabilities.ts`. The
internal names are more honest than the UI's: what the rack paints as
SHORT/MEDIUM/LONG is **Micro / Meso / Macro**.

### Where the notes actually come from

The Full Panel splits in two, and this is the finding that matters most.

**The note generator is `event_core`** — `PATTERN LENGTH` (METER, REPEATS, ^2),
`Bar Mod`/`Loop Mod` (MULTIPLE, CYCLE, %), `CADENCE`, `OFFSET`, `CHORD`,
`LENGTH`, each with its own `PATTERN` and `MOD`. None of it is in the graph. It
is system-managed, not editable, not buildable from the palette. **It is the one
black box in an otherwise open instrument**, and it is the part that makes the
"GEN:" machines generative.

Its vocabulary is musical rather than statistical: cadence, phrase, div, meter,
repeats, offset, multiple, cycle. Not "density" and "probability".

The sound half — `INTERVALS`, `ENVELOPE`, `FILTER`, `OSCILLATORS`, each with a
`+ PAGE` button — is the graph we walked.

## 8. Engineering practices worth stealing

1. **Glitch-free rebuild, measured.** `request_snapshot` → `reconcile_to_snapshot`,
   with `karst_wasm_get_declick_gain/state`, `test_request_swap_fade` and a
   `swapSilenceBlockCount` counter. Our `STEAL_FADE_SEC` is the same idea at
   voice scale; theirs covers the whole graph and counts the silent blocks.
2. **Feedback regions drop to per-sample scheduling.**
   `GraphExecutor: feedback region of N modules detected; scheduling per-sample
   (see decisions/0025-sub-block-feedback-scheduling.md)` — fired 51 times just
   loading their own starter system.
3. **Event sourcing.** `replayLogTail`, `logCompaction`, `logEntryHistogram`,
   `actionVocabularyVersion`; replay errors are typed.
4. **Migration discipline enforced by the engine.** It *rejects* a foreign
   `formatVersion` with "Migration must run in the TS layer before this file is
   handed to the engine (karst-migration-discipline.md P2)".
5. **A detector for one past regression.** "stale-connection detector: found 2
   stale port ref(s) (SC-ID rename regression window 2026-07-05 → 2026-07-11).
   Report-only; no auto-repair."
6. **Instrumentation.** `?diag=1` renders a browser-capability report with a copy
   button; `?debug=ops`; `window.karstLogs()`, `window.karstMem()`,
   `window.__karstWasmMV` (underruns, perf, drain mode, outbound stats); a freeze
   detector in localStorage; telemetry carrying the last 60 console lines.

Not everything is clean. Loading their own factory system logs
`input port 'in3' not found on module 'add' [DROP; likely dynamic-port config
not applied before wire]` — two connections silently dropped — and a breadcrumb
click produced an impossible path (`module_1455 › module_1455`, 0 modules).

## 9. What we built from this today

`feat/kick-like-karst` (commit `f77bc14f`) gives our synthesised kick the full
Karst control set. Their ten boundary ports, minus the three we already had
under other names (Pitch = tune/start/end, Length = decay, Trigger = the hit):

| theirs | ours | note |
|---|---|---|
| Snap | `SNAP` + `SDEC` | noise transient on its own envelope |
| Thud | `THUD` | short burst an octave *above* the landing note — the knock |
| Boom | `BOOM` | an octave below, decay 1.5x the body — the weight |
| Tone | `TONE` | two cascaded `Svf` lowpasses = 24 dB/oct |
| Body / Body Centre / Body Length | `BODY` / `BCTR` / `BLEN` | resonant shell: noise through a bandpass |
| — | `DRIVE` | their waveshaper, which is not a boundary port |

Two hooks were added to `OneShot` to make it possible: `extra(t)`, a layer
outside the amp envelope carrying its own (choked via `chokeScale`, declaring
`extraDecay`), and `postFx(y)` over the summed voice so filter and saturator see
every layer — their signal order.

Every amount defaults to 0 and TONE defaults to open, and the first test renders
the new param bag against a bag with none of the nine keys and requires the two
to agree **sample for sample**. Full suite: 561 files, 5702 tests, green.

Three mistakes worth remembering, all found by measuring:

- The resonant body was normalised by the bandpass **frequency-response** peak
  (27.9), which is right for a sine on centre and wrong for noise — it buried
  the layer 28x. Measured with noise, the tap is RMS 0.89 / peak 2.61.
- THUD first sat at the landing frequency, where it doubled the note instead of
  knocking.
- Layers that sum in quadrature under a body at full peak barely move a
  broadband RMS (THUD moved it 4%). The tests now measure the **difference
  signal** — render with and without — which is the layer exactly.

## 10. If we wanted the Chord Machine

It is four things, and only one is an engine:

1. **The sound → a plugin engine.** Four PWM pulse oscillators, ladder, ADSR,
   LFO to PW. Nothing among our six does this. Ordinary plugin work.
2. **The intervals → NOT in the engine.** Verified: the worklet has no knowledge
   of the session scale (no scale references anywhere in `src/audio-dsp/`).
   Karst can afford `pitch_conform` inside the oscillator because its engine sees
   `systemScale`. Ours would need the scale pushed into the worklet — a large
   contract change. Upstream already has the place:
   `src/notefx/chord-processor.ts`, which today uses closed `CHORD_INTERVALS`
   where they have a base plus three free intervals. Extending it is cheaper, and
   resolves harmony once instead of four times per sample.
3. **Per-trigger modulation → a plugin modulator, and the highest-value piece.**
   Verified: nothing like it exists (`triggerCount` appears nowhere in
   `src/modulation/` or `src/audio-dsp/`). Precedent: `plugins/sh/`. With
   Pattern/Skew/Amount it reaches **any parameter of any of the nine engines**
   through the `DestinationRegistry`. In Karst this is what makes a machine
   "GEN:"; here it would multiply what already exists rather than adding a ninth
   instrument.
4. **The note generator → not an engine at all.** Cadence/phrase/div is "what
   does this lane play", and that door exists: `WeaveSource`. It would be a third
   producer beside weave and follow, mutually exclusive with both. As an engine
   it would have to invent notes inside the worklet — the second hook that shape
   exists to prevent.

**Recommendation: do (3) first.** Smallest, independent of the other three, and
the only one whose payoff is not confined to one new instrument.

## 11. Open questions

- The `~` / `*` / `S` inlets on every knob. Guessed, not verified.
- The exact `Parameter Modulation` formula.
- Whether `Thud` and `Boom` mean on their kick what we made them mean on ours.
  Our reading came from the names and the graph; the knobs were never turned.
- Scenes and Motion were never exercised — the interpolation between captured
  scenes is the part closest to WEAVE, and the only part that cannot be judged
  without listening.

## 12. Provenance

Everything above came from the public bundle (`index-cUBFgMuP.js`, 1.09 MB) and
`karst.wasm` (2.26 MB) fetched and read directly; the strings and symbols left in
the binary; and a live session driven through Playwright against a real account,
extracting graph levels from the DOM.

Files here: `karst-chord-root.json`, `karst-chord-engine.json`,
`karst-parammod.json`, `karst-chord-fullpanel.json`, `karst-rack-snapshot.md`,
`karst-lib2.md`, and screenshots `karst-01` through `karst-11`.

Build under test: `TS=8606c9f+dirty@2026-08-18T22:50:37.419Z`.
