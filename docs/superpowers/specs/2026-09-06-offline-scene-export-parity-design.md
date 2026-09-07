# Offline scene export: one path, faithful by construction

**Date:** 2026-09-06
**Status:** design approved in conversation (approach A of two); awaiting written review
**Scope:** the ⚡ offline REC mode — render the SOUNDING SCENE from start to end,
keep the second of two cycles (the one whose tails and sustains have settled).
Out of scope: WEAVE, FOLLOW, the arrangement/performance view, and the ⏱ live
take, except for one tap fix the parity test needs (§6).

## 1. The problem

The offline export must sound like what comes out of the headphones. Today it
does not, and the reason is structural rather than a list of bugs: the export
synthesises melodic lanes through the PURE kernel (`renderKernelLane`) on the
main thread instead of the AudioWorklet, and feeds it triggers it collected
itself (`collectSceneTriggers`) rather than the ones the live runtime dispatches.
That detour exists because `node-web-audio-api` cannot host our worklet in
tests — not because the browser cannot. A browser's `OfflineAudioContext` hosts
AudioWorklet modules, and the recorder already registers all four on it.

Every divergence found is a consequence of the second path (verified with
GitNexus against the call graph, not only by reading):

| # | Live | Offline today |
| --- | --- | --- |
| 1 | `tickSession` → `createTriggerForLane`, which runs the lane's note-FX chain (arp / chord / random) and carries `layerIndex` | `collectSceneTriggers` calls `tickLane` directly and the recorder consumes the triggers itself. Note-FX never run; `OfflineTrigger` has no `layerIndex`. |
| 2 | Clip envelopes land every sequencer tick (`startAutomationTick` → `tickSessionEnvelopes`), reach the worklet's `ParamSmoother`, and move the note already sounding | One ParamBag snapshot per trigger; automation reaches future voices only. The comment claiming "a voice reads its values at creation" describes a rule the live path no longer follows. |
| 3 | Master compressor, shaper and bus strip carry the session's state | `buildAudioGraph` on the offline context, no `setState` — factory values |
| 4 | LAYERS rack posted on the structural channel by the allocator | `KernelLaneSpec` has no `structural`; a Layers lane renders without its rack |
| 5 | The live context's sample rate | 48 000 Hz fixed |
| 6 | Drums: per-pad sends, per-voice EQ | dropped (documented in the recorder's own header) |
| 7 | Every modulator the lane holds, inside the worklet | `getModLite()` — whatever that projection carries |

Fixing these one by one keeps the second path, and the next live feature
needs its offline twin again. The design removes the path.

## 2. Shape

`OfflineSceneRecorder.record(totalSec)` keeps its contract — `RenderedAudio`
holding the SECOND cycle of two, at the exact musical length — and its first
four phases stay as they are:

1. an `OfflineAudioContext` for `2 · totalSec`, now at the LIVE context's
   sample rate;
2. the four worklet modules registered on it (loom, drums, sampler, duck);
3. `buildAudioGraph` + `createLaneAllocator` against that context;
4. per sounding lane: `ensureLaneResource` → preset → `applyLaneEngineState`
   (awaited drumkit / instrument / preset reloads) → insert rehydration →
   `strip.restore(lane.mixer)`; master inserts; `preloadSceneSamples`.

Phase 5 — "collect triggers and automation, kernel-render, play buffers through
the strips" — is replaced by the offline transport (§3). Phase 6, render and
slice out the second cycle, is unchanged.

Because phase 4 already builds the REAL lane engines against the offline
context, the LAYERS rack (allocator posts `structuralFor`), the modulators
(`applyLaneEngineState` hands them to the engine, which posts them to the
worklet) and the drum per-voice strips all arrive the way they do live. Rows 4,
6 and 7 of the table need no code of their own.

## 3. The offline transport

New module `src/export/offline-transport.ts`. One exported function,
`driveOfflineTransport(ctx, deps)`, pure over the context it is handed: it
never reads `AudioContext` globals, never touches the DOM, and never touches
the live session's `laneStates`.

**State.** It clones the live `LanePlayState` map into a private map re-based
to t = 0: `startTime = 0`, `loopStartedAt = 0`, `lastScheduledAt = -Infinity`,
`nextStepIdx = 0`, `loopCount = 0`, `queued = null`, `queuedStop = null`.
Only lanes with `playing` set are cloned.

**Clock.** The live sequencer ticks every 25 ms with a 200 ms look-ahead
(`TICK_MS`, `LOOKAHEAD_SEC` in `core/sequencer.ts`; the transport imports
both rather than restating them). The offline transport walks
`t = 0, 0.025, 0.050, …` up to `2 · totalSec`, and at each step:

1. `await ctx.suspend(q(t))`, where `q` rounds `t` down to a multiple of the
   128-sample render quantum (`suspend` rejects any other value);
2. `tickSession(states, sessionState, t, LOOKAHEAD_SEC, bpm, triggerForLane,
   noop, undefined, meter, undefined, activeScene, swing)` — the live
   function, no forwarder, no `weaveNotesFor` (out of scope);
3. `tickSessionEnvelopes(states, t, bpm, meter, apply)`;
4. `ctx.resume()`.

`startRendering()` is called once, before the first `suspend` resolves; the
loop registers each next `suspend` before it resumes, which is the standard
way to step an `OfflineAudioContext`. A `suspend` at a time the render has
already passed rejects — the loop treats that as a bug, not a condition to
recover from.

**Triggers.** `triggerForLane` is `createTriggerForLane({ ctx, laneResources:
lanes.resources, seq, getMusicality, getChordDegree })` — the live dispatcher
against the offline allocator. `seq` is the live `Sequencer` (the dispatcher
reads `bpm` and `playbackSeed` from it and writes nothing). Note-FX,
`layerIndex`, velocity and accent are therefore resolved by the same code the
headphones hear, and every engine's `createVoice` builds its worklet nodes on
the offline context (drums, sampler and audio build theirs lazily here, which
is why phase 2 registers all four modules).

**Automation.** `apply(paramId, normalised)` is the unmounted-knob landing
(`landAutomationValue`'s `applyUnmounted` branch, without a knob registry):
an engine param goes through `engine.setBaseValue` after the same
min/max scaling the live landing does; a strip param goes through
`stripAutomationParams(strip).get(id).setValueAtTime(value, t)`. The engine
write reaches the worklet's `ParamSmoother`, so an envelope moves the note
already sounding exactly as it does live. (`onAutomation` on the scheduler
context is a no-op live and stays one here; the envelope tick is the live
mechanism, and the transport rides it the way `startAutomationTick` does.)

## 4. Master state and level

`OfflineRecorderDeps` gains `master: { strip, comp, shaper }` — the state
objects the live graph's `MasterBusStrip`, `MasterCompressor` and
`MasterShaper` report — and `sampleRate`. `recording-feature` reads them from
the live graph at export time. The recorder applies them to the offline graph
after `buildAudioGraph` and before rendering, through the same `restore` /
`setState` calls `applyLoadedStateV3` uses.

The offline `master` gain stays at 1: the export leaves at unity, without the
monitor volume, as a DAW bounce does. This is a decision, not an omission.

Open item, settled during implementation: whether the FX send buses' return
stage (`SendBus`, `setReturnLevel`) holds state the live desk can change that
a save does not carry. If it does, it is copied like the master state; if the
only mutable thing is what a lane's `mixer` already restores, nothing to do.

## 5. What is removed

- `src/export/collect-scene-triggers.ts` and its test
- `src/export/collect-scene-automation.ts` and its test
- `src/export/sample-lane-render.ts` and its test
- the kernel branch of `OfflineSceneRecorder.record` (the merged auto/trig
  walk, `kernelNotesByLane`, `drumHitsByLane`, `sampleSpawnsByLane`, the three
  play-through loops)
- `DrumsWorkletEngine.getOfflineSynthBag` / `getOfflineVoiceMix` and
  `WorkletLaneEngine.getModLite` — each has exactly one caller, the branch
  above (verified by grep; the graph reports UNKNOWN for property calls)

`kernel-lane-render.ts` stays: the golden-WAV loop
(`test/preset-render.dsp.test.ts`), `preset-stability`, and the two listening
tools in `tools/` are its callers, and a per-sample kernel with no
`AudioContext` is the right instrument for them.

## 6. Tests

Node cannot host the worklet, so the six `src/export/offline-*.dsp.test.ts`
suites that render audio through the kernel cannot keep doing so. Two layers
replace them, each covering what the other cannot:

**Pure transport, in node.** A fake `OfflineAudioContext` that records every
`suspend(t)` / `resume()` and a fake `triggerForLane` / `apply`, driven by the
REAL `tickSession` and `tickSessionEnvelopes`. Assertions, all relative or
exact-by-construction:

- suspend times are ascending, quantum-aligned, and cover `[0, 2·totalSec)`;
- a clip's notes fire once each per cycle at their scheduled times, and
  twice over the window (the `lastScheduledAt` dedup holds under the 25/200 ms
  overlap);
- a lane with an enabled arp yields MORE triggers than the same clip without
  it, through the real `createTriggerForLane` against a stub lane resource;
- an envelope on a continuous param produces a monotone sequence of `apply`
  values across the bar, not one value per note;
- a strip envelope lands as `setValueAtTime` calls at the tick times.

The recorder's own assembly (deps in, phases in order, second cycle sliced)
keeps `offline-worklet-registration.test.ts` and gains a test that the master
state reaches the offline graph and that `sampleRate` is the one passed.

**Parity, measured, in Playwright.** `tests/e2e/scene-export-parity.spec.ts`:
load a fixed scene (a melodic lane with an arp, a drum lane, a sampler lane,
one clip envelope on a filter, a non-default master compressor), record it
with the ⏱ live take, then export it ⚡ offline; decode both WAVs in the page
and compare per-bar RMS and spectral centroid as ratios, and the length
exactly. The threshold is a ratio, justified in a comment, wide enough for
real-time jitter and narrow enough to fail on any row of the table in §1.
This is the operational definition of "faithful", and the only place it can
be measured: a browser, the real worklet, the real graph.

For the parity to mean anything, the live take's tap moves from
`masterComp.output` to the soft-clip output (the node `analyser` and the
metering tap already read). Today the take misses the last stage the
headphones hear. `buildAudioGraph` exposes its soft-clip node on `AudioGraph`,
`main.ts` points the tap at it, and the parity test is what proves it.

**The tests that go.** `offline-automation`, `offline-preset`,
`offline-recorder`, `offline-seamless-loop`, `offline-reimport-sync` — each
pins a behaviour the transport tests or the parity test pin again: preset
applied (phase 4, unchanged, covered by the assembly test), automation heard
(transport apply sequence + parity), seamless second cycle (assembly slices
`[cycle, 2·cycle)`; parity length), reimport at known BPM (`addAudioChannel`
is untouched; its own test stays). Deleting them is listed in the plan as
its own step, after the replacements are green, never before.

**Optional spike, not in the plan:** build the loom processor to plain JS for
vitest so `node-web-audio-api` can host it and the offline suites render
again in node. If it works, the parity layer gains a fast sibling; if not,
nothing here depends on it.

## 7. Risks and how each is settled

- **Port messages while suspended.** A voice trigger is a `port.postMessage`
  to the worklet. While an `OfflineAudioContext` is suspended, its render
  thread idles; Chrome delivers the queued messages before the next quantum
  after `resume()`. The first e2e run confirms this before any kernel code is
  deleted (plan step order).
- **Seeded randomness.** The random note-FX draws on `seq.playbackSeed`; live
  and offline share the seed within one session, but the parity scene uses no
  random note-FX so the comparison never depends on it.
- **Render time.** A 16-bar scene at 120 BPM is 32 s of audio, 1 280
  suspend/resume steps. Each is a microtask round-trip; the render remains
  faster than real time by a wide margin.
- **A lane the plugin host could not load** has no engine; the live dispatcher
  already drops its notes silently, and the offline path inherits that.

## 8. Not decided here

- Reverb/delay tails past the loop end are, by the two-cycle rule, folded into
  the start of the returned cycle. Unchanged.
- The offline export's own file name, dialog and destination flow. Unchanged.
