# Loop Capture — round 2 of the Arrange surface

**Date:** 2026-08-30 · **Status:** approved design, pending plan
**Depends on:** the Arrange round (shipped 2026-08-30, `20e9c011`; branch off `b2e04b49` or later)

## What this is

The Arrange view's empty state says "Drop audio loops to start" and shows a disabled
"● Record a loop" button. This round enables that button: a bar-quantized looper-style
capture that records a whole number of bars and lands the result exactly like a dropped
file — a new Audio lane, a session clip fitted to the grid, and a band on the timeline
at the bar where recording started.

Decisions locked with the user before this design:

- **Source is the MASTER first** (resampling); system audio and microphone follow in
  later phases of the same round.
- **Length is press-start / press-stop, bar-quantized**: recording begins at the next
  bar boundary after the first press; the second press cuts at the end of the bar in
  progress. The loop is always a whole number of bars.
- **Monitoring is OFF by default**, with a 🎧 toggle, and only applies to external
  sources — the master is already audible.
- **Landing is the drop path**: new Audio lane + band, one undo entry, no new save
  schema.

## Architecture — three existing pieces plus one new controller

The recorder worklet (`src/export/recorder-worklet.ts`) already supports
**sample-accurate capture windows**: a `window` message carries `startTime`/`endTime`
in AudioContext time, and the processor slices partial render quanta at both edges.
Bar quantization therefore needs **no worklet changes**: the controller computes bar
boundaries in context time and posts them as the window.

### 1. `LoopCaptureController` — `src/performance/loop-capture.ts` (new)

A sibling of `LiveTakeRecorder` (`src/export/live-take.ts`) whose one new
responsibility is quantization. State machine:

```
idle → waiting → recording → finalizing → idle
```

- **● press (idle)**: resolve the source (section below), connect
  `source.node → recorder worklet` (reusing `ensureRecorderWorklet` and the
  connect/teardown pattern of `LiveTakeRecorder`, including the silent
  keep-alive connection to destination). Compute the **next bar boundary** in
  context time — the same transport clock the Arrange playhead reads — and post
  `{type:'window', startTime: <boundary>, endTime: Infinity}`. State `waiting`;
  when the boundary passes, `recording`.
  - If the transport is stopped, start it first (as Play) and anchor the start
    at bar 1 of the arrangement. The bar clock is always the transport's, for
    every source — with an external source this acts as an implicit metronome,
    and the running playhead is where the band will land.
- **● press (recording)**: compute the **end of the current bar** and post a
  second `window` with the same `startTime` and that `endTime`. The worklet
  keeps capturing to the boundary and finalizes itself — the cut is
  sample-exact, with **no tail** (a loop must not carry a reverb tail glued to
  its end). State `finalizing` until `done` arrives.
- **Escape** in `waiting` or `recording`: cancel — teardown, no take.
- **Transport stop (⏹) while recording**: finalize at the end of the **last
  completed bar** (round down — never a bar of dead air). If no bar has
  completed yet, cancel.
- **Leaving the Arrange view**: cancels a `waiting` capture; a `recording` one
  continues — the controller does not depend on the DOM, and the band lands in
  data whether or not the view is showing.

**Delivery**: the worklet's `done` message carries stereo PCM →
`encodeWav` (`src/export/wav-encoder.ts`) → `File` → **the round-1 ingestion
gate unchanged**: `importFile` → `ingestDroppedFile`
(`src/performance/perf-ingest.ts`). No special "skip the fit" case is needed:
a loop of exactly N bars at the session bpm comes out of `fitLoopToBars` with
`stretch = 1` by construction. The band lands at the bar where capture
**started**.

Bar-boundary arithmetic (`nextBarCtxTime`, `barEndCtxTime`, the ⏹ round-down)
lives in pure functions over `(ctxNow, anchorCtxTime, bpm, meter)`, testable
without an AudioContext.

### 2. Sources — `src/performance/capture-sources.ts` (new)

Resolves every source to one shape: `{ node: AudioNode, release(): void }`.
The controller never knows which source it holds — it connects
`node → worklet` and calls `release()` on teardown.

- **Master (resampling)** — the same tap the ⏱ live-take recorder uses
  (`masterComp.output` from the audio graph). `release()` merely disconnects.
  No permissions, no added latency. **Phase 1.**
- **System audio** — `getDisplayMedia` as in stems, but instead of
  `MediaRecorder` (webm, no sample accuracy) the stream enters the graph via
  `MediaStreamAudioSourceNode` and feeds the same worklet, so the bar cut is
  identical to the master path. `src/stems/system-audio-capture.ts` is **not
  modified** — it remains the stems path; only the "request a stream with
  audio or fail with a clear message" gesture is extracted into a shared
  helper both call. **Phase 2.**
- **Microphone** — `getUserMedia({audio})` → `MediaStreamAudioSourceNode` →
  same worklet. **Phase 3.**

**Monitoring 🎧** (default OFF): external sources only. When on, the source
node additionally connects through a `GainNode` to the destination; when off,
only to the worklet. The off default also avoids the obvious mic-on-speakers
feedback loop.

### 3. UI and states

- **●** lives in the `perf-toolbar` next to Loop A–B, with an **inline source
  selector** beside it (`Master ▾`; System / Mic appear as phases land) and
  the 🎧 toggle, shown only for external sources. Inline rather than a dialog:
  a dialog between pressing ● and recording breaks the looper's press-stop
  rhythm, and the source is a sticky choice changed once, not per take. The
  empty-state "● Record a loop" button is enabled and triggers the same action
  with the default source (master).
- **idle** — ● red outline.
- **waiting** — ● blinks; the toolbar readout shows `recording at bar N…`.
- **recording** — ● solid red with a live bar count (`● 3 bars`), and a
  **growing red ghost band** on the `.perf-droplane` strip from the start
  bar — the preview of where the take will land, without inventing rows (the
  real lane does not exist until delivery).
- **finalizing** — ● stays red to the bar edge; then the real band replaces
  the ghost on a new lane.

### 4. Persistence

Almost nothing new, deliberately:

- The take is an ordinary sample asset in IndexedDB (same WAV bytes as a
  dropped file; `sampleRate` = context rate). The lane is an ordinary Audio
  lane; the band is v3 arrangement data already shipped. **A saved session
  with captured loops reloads exactly like one with imported loops.**
- **Undo is free**: delivery goes through the drop gate, so Ctrl+Z removes
  lane + clip + band exactly as it does for a drop.
- The chosen **source and 🎧 state go to `app-prefs`** (machine preference,
  like the Arrange zoom — never into a save file). Capture state
  (waiting/recording) is pure runtime and is never saved.

## Testing

1. **Pure** — `loop-capture.test.ts`: the bar-edge arithmetic and the full
   state machine with fake deps — every transition, Escape in `waiting` and
   `recording`, ⏹ with zero completed bars → cancel, delivery → calls the
   ingestion gate with the WAV and the start bar.
2. **Worklet** — `recorder-worklet.test.ts` gains one case: a **second
   `window` message** fixing the `endTime` of a running capture (the
   quantized-cut mechanism; currently unpinned).
3. **e2e, one test per user path** — the full journey in Playwright: press ●,
   wait ~2 bars, press ● — a new lane appears with its band, the band's
   duration is a whole number of bars (relative assertion:
   `durSec / barSec` ≈ integer), and the lane is audible on relaunch
   (`measureMaster` on the master tap). Master source only:
   `getDisplayMedia` / `getUserMedia` are not scriptable in e2e (permission
   prompts) — phases 2–3 are verified live and documented as such, as
   `system-audio-capture.ts` already is.
4. **No golden WAVs** — capture is not a synthesizer; there is no timbre to pin.

Assertion rule as always: relative ratios, never absolute magnitudes.

## Explicit exclusions

- **Input-latency compensation** (system/mic arrive tens of ms late relative
  to the context clock). The loop is still an exact number of bars; if the
  offset bothers the ear, round 1's left-trim already fixes it by hand, and
  automatic compensation would be its own round with measurement behind it.
- **Count-in / metronome click** — the transport's running audio is the
  count-in for the master source; a click track is a separate feature.
- **Multi-take / loop layering (overdub)** — each capture is one take on one
  new lane. Comping belongs to the deferred F4 round.
- **A dialog-based source picker** — replaced by the inline selector (above).

## Phasing

1. **Phase 1 — master resampling**: controller + toolbar UI + ingestion +
   tests. Internal, zero permissions. The round is shippable here.
2. **Phase 2 — system audio**: shared stream-request helper + source entry +
   🎧. Verified live.
3. **Phase 3 — microphone**: `getUserMedia` source entry. Verified live.
