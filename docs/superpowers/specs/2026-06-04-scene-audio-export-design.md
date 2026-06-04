# Scene Audio Export — Design

**Date:** 2026-06-04
**Status:** Approved design, pending implementation plan
**Branch:** `worktree-scene-audio-export`

## Goal

Let the user export the **currently-playing scene** of Loom to an audio file, played
through **once** (no infinite looping), so they can save or share a render of what
they hear.

User's phrasing: *"obtener wav o mp3 o lo que se pueda de la escena actual, hasta
final sin bucle."*

## Decisions (locked)

| Question | Decision |
|----------|----------|
| What is "the current scene"? | The set of clips currently sounding — one `lp.playing` per lane in `laneStates`. Both backends read the same source, so they render the same material. |
| Duration ("hasta el final") | `sceneDur = max(clipDurSec)` over the sounding lanes; shorter clips **loop to fill** that window. |
| FX tail | Fixed **2 s** appended after `sceneDur` so reverb/delay tails don't cut off abruptly. No silence auto-trim in v1. |
| File format | **WAV PCM 16-bit stereo** now, behind an `AudioEncoder` interface so 24-bit / 32-float / MP3 can be plugged in later without reworking the rest. |
| Capture backends | **Both** — A (real-time) and C (offline) — behind one shared export pipeline. |
| Phasing | One spec, two phases: **Phase 1 = real-time** (ships value, low risk, fixes the shared pipeline); **Phase 2 = offline** (additive, reuses the pipeline). |
| Default backend | **Real-time is the default** (ground truth); offline is an explicit option. |
| When export finishes | **Stop the transport** (`seq.stop()`, Play button back to ▶). |
| No scene playing | Export disabled with a "Lanzá una escena primero" hint. No cold export in v1. |
| Clean start | Real-time **re-launches** the current scene so all lanes align on the next quantize boundary; recording starts at that boundary → WAV begins at beat 1. |

## Why these tradeoffs

- **Real-time first, as ground truth.** Engines and lanes are bound to the *live*
  `AudioContext` (voices are wired to live `ChannelStrip` nodes via the lane
  allocator). Tapping the live master output reuses the entire audible graph —
  engines, FX, sidechain, master compressor — so the file sounds *identical* to
  playback. Low risk, isolated.
- **Offline second, additive.** Faster than real-time and deterministic, but it
  requires building a **parallel** audio graph from `SessionState` and a **batch**
  scheduler. It is higher risk, so it is layered on top of a working Phase 1 and
  validated against it (A↔C parity test). If Phase 2 stalls, export still works.
- **WAV now.** Lossless, no new dependency — the repo already has a Float32→Int16
  PCM WAV writer in tests (`test/wav.ts`) to adapt. MP3 would need an encoder lib
  (e.g. lamejs) and is deferred behind the `AudioEncoder` interface.

## Architecture

All new code lives in an isolated subsystem **`src/export/`**. The only touch to the
existing audio graph is exposing the master-output tap point.

```
src/export/
  scene-duration.ts     // sceneDur from laneStates (sounding lanes) + tail
  audio-encoder.ts      // interface AudioEncoder { encode(channels: Float32Array[], sampleRate: number): Blob }
  wav-encoder.ts        // WAV PCM 16-bit stereo (browser adaptation of test/wav.ts)
  download.ts           // Blob -> <a download> -> click; filename "loom-scene-<ts>.wav"
  scene-recorder.ts     // interface SceneRecorder { record(): Promise<RenderedAudio> }
  realtime-recorder.ts  // Phase 1: backend A (live tap + AudioWorklet)
  offline-renderer.ts   // Phase 2: backend C (parallel graph + batch scheduler)
  recorder-worklet.ts   // AudioWorkletProcessor: accumulates PCM, posts it back
  export-scene.ts       // orchestrator: pick backend, run, encode, download, error-handle
```

### Shared contract (used by both backends)

- `RenderedAudio = { channels: Float32Array[]; sampleRate: number }` — what any
  backend returns.
- `scene-duration.ts` → how many seconds to capture.
- `audio-encoder` + `download` → turn `RenderedAudio` into a file. Identical for
  both backends.
- `export-scene.ts` does not know *how* the buffer was filled; it calls
  `recorder.record()` and proceeds. This is what makes Phase 2 purely additive.

The only backend-specific part is **filling `channels`**: A records the live output
in real time; C renders a parallel offline graph.

## Phase 1 — Real-time backend (`realtime-recorder.ts`)

Raw PCM capture via **AudioWorklet** (not `MediaRecorder`, which would yield lossy
webm/opus). Data flow:

1. **Prepare the tap.** `ctx.audioWorklet.addModule(recorder-worklet)` (once,
   cached). Create a 2-channel `AudioWorkletNode`; connect
   `masterComp.output → recorderNode`. **Do not** connect it to `ctx.destination`
   (must not duplicate audible output). The worklet only accumulates and posts.
2. **Re-launch the scene aligned.** Call `launchScene` for the current scene so all
   lanes queue at the same `boundary` (next quantize boundary). Capture that
   `boundary` as an absolute time on the `ctx` clock.
3. **Define the window.** `recordStart = boundary`,
   `recordEnd = boundary + sceneDur + tail`. Send `{ startTime, endTime }` to the
   worklet. The worklet drops samples before `startTime` and stops at `endTime`,
   using the render quantum's frame/time for sample accuracy.
4. **Start transport.** If stopped, `seq.start()`. The scene begins at the boundary;
   the worklet records exactly that window.
5. **Accumulate.** The processor pushes each 128-frame × 2-channel block to an
   internal buffer and, at `endTime`, posts the data (in chunks to bound memory on
   long scenes) and signals "done".
6. **Close.** The orchestrator disconnects `recorderNode`, concatenates chunks into
   `Float32Array[2]`, returns `RenderedAudio`, then encodes → downloads. On finish,
   **stop the transport**.

**Transport / user state during recording.** Disable scene-change / stop controls so
the capture isn't contaminated; show a "Grabando… Xs" indicator. On finish, stop the
transport (Play → ▶).

**Accuracy & drift.** Everything references the `AudioContext` `currentTime` (not
wall-clock), so start/end are sample-accurate even though the scheduler's `setTimeout`
has jitter — jitter only affects the look-ahead, not scheduled times.

**Memory.** Stereo Float32 @ 48 kHz ≈ 0.38 MB/s. A 2-min scene ≈ 46 MB in RAM before
encoding — acceptable; chunked posting keeps peaks bounded.

## Phase 2 — Offline backend (`offline-renderer.ts`)

Reuses the entire Phase 1 pipeline (duration, encoder, download, UI); only changes how
`channels` is filled.

Build a **parallel** graph on `OfflineAudioContext(2, (sceneDur+tail)·sr, sr)` that
mirrors the live graph, batch-schedule **all** scene notes up front, then
`await ctx.startRendering()` → `AudioBuffer` → `RenderedAudio`.

**Components:**

1. **`buildOfflineGraph(offlineCtx, state)`** — instantiate against the offline
   context: master gain → master `InsertChain` → `MasterCompressor` →
   `offlineCtx.destination`, the `SidechainBus`, and for each sounding lane its
   strip + engine + insert chain. Requires **parameterizing the audio-graph /
   lane-allocator / sidechain factories by context** (today they assume the live
   `ctx`). `engine.createVoice(ctx, output)` is already context-agnostic — that part
   is free. Presets / `engineState` are applied per lane as in the live path.
2. **`scheduleSceneOffline(...)` (batch scheduler)** — instead of the `setTimeout`
   tick, walk each sounding clip and, for the window `[0, sceneDur)`, **expand** its
   notes by repeating the clip enough times to fill the window, then
   `voice.trigger(midi, absTime, opts)` for every note at its absolute offline time,
   **including slide/accent** with the same rules as `tickLane`. **Extract the
   note→event math from `tickLane` into a shared pure function** reused by both the
   live tick and the offline batch, so slide/accent/gate rules are not duplicated.
3. **Sampler pre-load.** If any sounding lane is a Sampler, its buffers must be
   decoded and ready before rendering (IndexedDB is async). The orchestrator
   `await`s the buffer cache before `startRendering()`.
4. **FX tail.** Same as A: `sceneDur + tail` sets the `OfflineAudioContext` length.

**Risks the implementation must handle / document:**

- Engines using `ScriptProcessorNode` do **not** render correctly offline; if any
  engine uses one, that lane renders wrong → detect or document it. (AudioWorklets do
  work offline but require `addModule` on the offline context too.)
- Any mismatch between the batch scheduler and the live tick would show as an A↔C
  difference; the key test compares A vs C of the same scenario and requires
  closeness (relative RMS / peaks), reusing the `wav-diff` approach.

## UI

A transport-bar control next to Play: an **"Export ⤓"** button opening a small menu
with two items — **"Tiempo real"** (default, listed first) and **"Offline (rápido)"**.
During a run the button shows state (`Grabando… 12s` / `Renderizando…`) and the rest
of the transport is disabled. On finish it triggers the download and (real-time) stops
the transport.

## Error handling (degrade gracefully; never break live audio)

- **No scene sounding** → export disabled + tooltip "Lanzá una escena primero".
- **AudioWorklet `addModule` fails / unsupported** → clear message; the live graph is
  untouched (tap is disconnected in `finally`).
- **Offline fails mid-render** (incompatible engine, sampler without buffers,
  exception) → caught, reported, and **suggests using real-time**; the live session is
  unaffected.
- **Very long scene** (memory) → non-blocking warning above a configurable threshold
  (e.g. > 10 min).
- In all cases, `try/finally` guarantees the tap is disconnected and the transport is
  re-enabled.

## Testing (four layers, per repo convention)

1. **Pure** — `scene-duration.test.ts` (max-clip + tail, different meters, no clips →
   0), `wav-encoder.test.ts` (correct WAV header, Float32→Int16 with clipping, stereo
   interleave).
2. **DSP real** — `offline-renderer.dsp.test.ts`: render a known scene through the
   `OfflineAudioContext`, assert non-silent signal with expected *relative* energy;
   write a WAV to `test/output/` for inspection.
3. **A↔C parity** — the headline test: same scenario through both backends, compare
   relative RMS / peaks (reuse the `wav-diff` approach); require closeness, not exact
   equality (noise/karplus randomness).
4. **e2e (Playwright)** — launch a scene, click Export → Tiempo real, await the
   download, validate the `.wav` downloads with a valid size/header. (Remember:
   `npm run build` before e2e — it serves `dist/`.)

Assertions are always **relative** (ratios), never absolute magnitudes, per repo
convention.

## Out of scope (v1)

- MP3 / other formats (interface is ready; no encoder shipped).
- Silence auto-trim.
- Cold export with no scene playing.
- Exporting a full arrangement / multiple scenes / stems per lane.
- Bit depths other than 16-bit (interface allows them later).
