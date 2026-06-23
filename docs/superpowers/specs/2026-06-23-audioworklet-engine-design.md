# AudioWorklet synthesis engine — design (big-bang rewrite)

Date: 2026-06-23
Status: design approved (brainstorming), pending spec review → implementation plan.
Branch context: drafted on `worktree-voice-lifecycle-leak-fix` (the perf-fix branch); see "Background" for why.

## Why (the problem)

Loom synthesises every note by building a fresh **graph of Web Audio nodes**
per trigger (`createVoice()` → oscillators + filters + gains + ConstantSource
envelopes, fire-and-forget). This is idiomatic Web Audio but does **not scale to
dense polyphony**. Diagnosed live (Playwright + a custom Web Audio instrument +
the new PERF "Master" row) on a 17-track MIDI import (`Robert_Miles_Children_d16.mid`):

- Web Audio renders on **one real-time thread on one core** (~2.7 ms budget per
  128-sample quantum). Total machine power / GPU / other cores are irrelevant.
- The failure is **overhead-bound, not compute-bound**: a node per note → graph
  churn (~88 GainNodes/s created), cross-thread node messaging, and **GC pauses
  on the main thread** that starve the `setTimeout` scheduler → notes scheduled
  late → glitches. Scheduler lag was seen up to ~108 ms (vs the 120 ms look-ahead).
- At the dense climax: ~400–435 live generator nodes (~50 voices) → choppy →
  sustained silence; worse over time / on the 2nd loop.

Today's perf fixes (committed on this branch: per-note modulator disposal,
audio-clock cleanup, idle WaveShaper/noise skip, master limiter + soft-clip)
reduced it a lot ("mucho menos / tarda más / clipping gone") but the **dropouts
at peak density remain a capacity ceiling of the node-per-note architecture**.
The architecturally correct fix is to move synthesis into an **AudioWorklet**.

Reference implementation studied: **Strudel's `supradough`** (`packages/supradough/`
in the sibling `strudel` repo). `dough-worklet.mjs` is ONE `AudioWorkletProcessor`
wrapping a full software synth (`dough.mjs`): voices are plain JS objects, notes
arrive as `port.postMessage` → `scheduleSpawn`, and `process()` generates samples
in a per-sample loop with a `clamp(out,-1,1)` built in. No node-per-note, no GC,
no main-thread scheduler. This design mirrors that.

## Decisions (locked during brainstorming 2026-06-23)

1. **Big-bang, no coexistence.** Replace the synthesis layer outright. No
   old-engine/new-engine dual-run in production. (It is still *built* incrementally
   engine-by-engine and cut over once — that is build order, not coexistence.)
2. **DSP in JS/TS now, with a WASM door.** The hot per-sample loop sits behind a
   clean `VoiceRenderer` interface so a JS impl can later be swapped for WASM
   without touching the worklet glue or the rest of Loom. No WASM toolchain now.
3. **Faithful where it matters + fix known bugs.** Port each engine's DSP closely
   enough that the ~20 presets/engine and the demos translate reasonably, while
   fixing known defects in passing (FM tuning, etc.). Not bit-identical.
4. **Mixer/FX stay as Web Audio.** Only per-note *voice synthesis* moves to the
   worklet. The ChannelStrips (EQ, sends A/B with delay/reverb inserts,
   sidechain), master strip, master limiter + soft-clip stay exactly as they are
   — they are 17 *bounded* strips, never the bottleneck.
5. **One AudioWorkletNode per lane.** It replaces the lane's current engine; its
   output feeds that lane's ChannelStrip, unchanged.
6. **Modulation (LFO/ADSR) moves inside the worklet** (per-sample, per-voice).
   This deletes the per-note ConstantSource/binder machinery entirely (the
   original leak).
7. **Global polyphony cap.** A total simultaneous-voice budget across all lanes
   (now trivial with pooled voices) — the lever that ends the peak-density dropouts.

## Goals / non-goals

Goals: stable audio for a dense ~17-lane arrangement (no choppy/silence at the
climax or across loops); keep timing precision; keep test coverage; keep presets/
demos sounding ~the same; keep the mixer/FX/automation/MIDI/save features working.

Non-goals: rewriting the mixer/FX/master; bit-exact sound; WASM (now); porting
WSOLA warp into the per-sample loop (see Sampler/Audio); changing the
session/clip/scene model or the UI.

## Architecture

```
main thread (unchanged data model + scheduler)
  session scheduler (tickSession / tickLane, look-ahead)   ── cheap, stays
     │  note-FX (arp/chord) transform the event stream here  ── stays main-thread
     ▼  postMessage({spawn, midi, beginFrame, gate, vel, accent, slide, params})
  per-lane AudioWorkletNode  ("lane engine")
     │  DoughLike processor: pooled voices, per-sample render loop
     │   - selected engine = a VoiceRenderer (303/Sub/FM/Wave/Karp/West/Drums/Sampler)
     │   - in-worklet modulation (LFO/ADSR per voice/shared) → voice params
     │   - voice manager: pool, allocate/steal/free; per-lane cap
     ▼  lane output
  ChannelStrip (Web Audio)  →  sends A/B (delay/reverb) · sidechain
     →  master strip → master limiter → soft-clip → destination    ── ALL unchanged
  global-voice-cap coordinator (main thread): tracks per-lane active counts,
     enforces the total budget by instructing the busiest lane to steal.
```

### Components

- **DSP kernel** (`src/audio-dsp/` — pure JS/TS, no Web Audio, no worklet
  globals): per-sample primitives — oscillators (saw/sqr/tri/sin, supersaw/unison),
  noise, filters (SVF + biquad), ADSR, the TB-303 slide/accent shaper, FM
  operators, wavetable interpolation, Karplus-Strong delay line, drum primitives,
  sample playback (repitch). Plain classes/functions exposing `renderBlock(out, n)`.
  This is where "faithful + fix bugs" lives. **Directly unit-testable** (call
  `renderBlock` into a `Float32Array`; no AudioContext/worklet needed) — exactly
  how `dough.mjs` is testable.
- **VoiceRenderer interface** — the WASM door. `{ noteOn(...), noteOff(t),
  renderBlock(out, n), done }`. One implementation per engine (JS now; WASM later
  per-engine without touching anything else).
- **Voice manager** (in the worklet) — pre-allocated voice pool (zero per-note
  allocation); allocate on note-on, free on envelope end, steal oldest over cap;
  per-lane hard cap.
- **Worklet processor** (`dough`-style) — wraps the voice manager + the lane's
  selected VoiceRenderer; `process()` runs the per-sample loop, sums voices,
  writes the lane output; `port.onmessage` handles spawn/param/sample/config; a
  final per-lane safety `clamp` is optional (the master soft-clip already exists).
- **Lane integration** — `LaneResourceMap` / `lane-allocator` create an
  AudioWorkletNode (engine) instead of the current engine object; everything
  downstream (ChannelStrip wiring) is unchanged.
- **Scheduler→worklet bridge** — `trigger-dispatch` stops calling
  `engine.createVoice()`; instead posts a sample-accurate spawn message (carrying
  the target `beginFrame` derived from the scheduled audio time) to the lane's
  worklet. The worklet starts the voice at that frame (like dough's `_begin`).
- **Modulation** — the ModulationHost config (mod → param, depth, rate, scope) is
  sent to the worklet as state; LFO/ADSR are computed per-sample inside. Removes
  `voice-mod-binding`/ConstantSource per note.
- **Params / automation** — knob/preset/clip-envelope changes → messages (or a
  per-lane SharedArrayBuffer param block if high-rate automation needs it — see
  Risks re COOP/COEP).
- **Sampler / Audio engines** — decoded buffers transferred to the worklet and
  played/repitched there. **Warp/WSOLA stays a buffer pre-render** (already
  ~offline): warp once on the main thread, the worklet just plays the result.
- **Global polyphony cap** — main-thread coordinator holds the total budget; each
  lane worklet reports its active-voice count; over budget → instruct the busiest
  lane to steal its oldest. Configurable; surfaced in the existing PERF panel.

### What is removed / replaced (the big-bang)

- The per-note `createVoice` dispatch and the per-voice Web Audio node creation in
  every engine (`synth.ts`, `polysynth.ts`, `fm.ts`, `wavetable.ts`, `karplus.ts`,
  `westcoast.ts`, `drums.ts`, sampler/audio voice paths).
- The per-note modulation machinery (`voice-mod-binding`, ADSR/LFO ConstantSource
  voices, the connection binder) — replaced by in-worklet modulation.
- Kept: mixer/FX/master (incl. today's limiter + soft-clip), session/clip/scene
  model, scheduler, note-FX, MIDI import, save/load, undo, presets (as data),
  the PERF panel (gains a worklet-voice-count source).

## Testing

- **DSP kernel + each VoiceRenderer**: pure-JS unit tests — `renderBlock` into a
  buffer; relative/golden assertions reusing the existing DSP-battery style. No
  worklet/AudioContext needed (the kernel is plain code).
- **Polyphony/perf test**: render N voices for T seconds; assert it completes
  within a compute budget and that the global cap bounds active voices.
- **Worklet glue**: thin smoke test (message → spawn → non-silent output) where
  the harness supports it; the heavy logic is already covered by the kernel tests.
- **Parity spot-checks**: per engine, compare a preset's `renderBlock` output
  against the current engine's offline render (relative), to catch gross
  regressions where "faithful" matters.

## Build order (incremental build, single cutover)

1. DSP kernel scaffold + VoiceRenderer interface + voice manager + worklet glue +
   the scheduler→worklet bridge, proven end-to-end with **Subtractive** (the MIDI
   default and the pain point) + in-worklet modulation + global cap.
2. Port the rest: TB-303, FM (fix tuning), Wavetable, Karplus, Westcoast, Drums.
3. Sampler / Audio (buffer transfer + repitch; warp = pre-render).
4. Single cutover: remove the old engine/dispatch/modulation-binding layer.

## Risks / open questions

- **AudioWorklet bundling with Vite**: the processor module must be loaded via
  `audioWorklet.addModule(url)`; needs Vite worklet/asset handling (and to work
  under the `--base=/Loom/` GitHub Pages build).
- **SharedArrayBuffer needs COOP/COEP (cross-origin isolation) headers** — GitHub
  Pages can't easily set them. So default to `postMessage` for events/params;
  only adopt SAB if cross-origin isolation is solved. (Note in plan.)
- **node-web-audio-api / test env may not run AudioWorklet** — mitigated by making
  the DSP kernel pure and testing it directly (the worklet is thin glue).
- **Global-cap coordination latency** — main-thread coordinator reacts a quantum
  late; acceptable (voices are stolen ~immediately on the next message). Could
  move to SAB atomics later.
- **Preset re-tuning** — "faithful where it matters" still implies some presets
  may need touch-ups; budget a pass per engine.
- **Sampler warp pre-render** UX — confirm warping once up-front is acceptable vs
  realtime warp.

## Reference
- Strudel `supradough`: `packages/supradough/dough-worklet.mjs` (the processor)
  and `dough.mjs` (the software synth: per-sample oscillators/filters/FX/voices,
  `scheduleSpawn`). The model this design follows.
- Today's diagnosis + perf fixes: memory `project_voice_lifecycle_graph_leak.md`.
- Prior native alternative (not this path): `project_cpp_juce_migration_brainstorm`
  (LoomN, C++/JUCE).
