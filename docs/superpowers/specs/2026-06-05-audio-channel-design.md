# Audio channel — design

- **Date:** 2026-06-05
- **Status:** Approved (brainstorming). Next: implementation plan (writing-plans).
- **Branch:** `feat/audio-channel`
- **Context/decisions:** memory `project_audio_channel_direction.md`, `project_loop_tempo_sync_slicer.md`.

## Goal

Introduce a first-class **audio channel** in Loom: a dedicated lane type where you drop a WAV and it plays as a tempo-locked loop **without altering pitch**, with the least-complicated, most-immediate path from "WAV" to "sounding in a scene". A loop is used two ways:

- **Mode 1 — adapted one-shot (no slicing):** the whole loop, adapted to the session BPM via pitch-preserving time-stretch (WSOLA). The home for this is the audio channel.
- **Mode 2 — sliced (option):** the loop is chopped; each slice becomes its **own sample in the bank** (keymap) and the clip is a **normal note clip** (one note per slice) on a **sampler** lane.

The whole thing is one spec; the implementation plan is **phased, with docs (manual + README) last**.

### Why this exists / what was wrong before

The shipped slicer kept slices **clip-local** (`opts.slice`), so they never entered the sample bank, and the import created a clip that — combined with the scene-launch bug below — **didn't actually sound in the app** even though a DSP unit test was green. A raw-`AudioBufferSourceNode` DSP test validates slicing *math* but not the real `engine → scheduler → session-host → output` chain, so "green" did not mean "audible". This spec fixes the model (slices → bank, audio as its own channel), makes a dropped loop **immediately launchable**, and tests through the **real playback path** plus a **Playwright e2e**.

## Constraints (from the codebase)

- Every `SessionLane` maps to a **registered engine** via `engineId` ([session.ts] `SessionLane`); a lane cannot have an unregistered id. So the audio channel is a **new registered engine** `audio`.
- The Sampler already plays audio buffers (`triggerSample`: loop/song + WSOLA `stretch` via `stretch-cache`; `triggerSlice`: region). We **reuse**, not duplicate.
- Scene launch buttons render only for rows that have a `state.scenes[r]` ([session-ui.ts] grid loop); `onAddLane`/imports pad lanes with clips but don't create scenes ([session-host.ts] `onAddLane`) → the play button is missing. This is the "no suena" root cause.

## Section 1 — Architecture of the audio channel

- **`audio` engine (new, registered by factory; `engineId: 'audio'`).** A minimal `SynthEngine` that **only plays audio clips** — no keymap, no notes, no synthesis params. Its `createVoice` plays the `ClipSample` buffer (whole loop) **WSOLA-adapted to tempo** (pitch preserved), reusing `timestretch` + `stretch-cache`.
- **No duplication of the sampler.** Extract the buffer/stretch playback currently in `sampler.ts` `triggerSample` into a shared helper **`src/engines/audio-clip-voice.ts`**; both the Sampler and the `audio` engine use it.
- **Audio clip = a `SessionClip` with `clip.sample` (ClipSample) and NO `notes`** — the clip *is* the audio. ClipSample fields used: `sampleId`, `mode:'loop'`, `warp:true`, `warpMode:'stretch'`, `originalBpm`, `trimStart/trimEnd`, `gain?`.
- **Grid:** an `audio` lane is a normal **column** (lanes × scenes), distinguished by icon/styling and its editor.
- **Playback:** the lane-scheduler already fires one buffer trigger per clip iteration when `clip.sample` is present → the `audio` voice → WSOLA to the clip's bar length at the session BPM.
- **Immediately launchable:** dropping a WAV creates `audio` lane + audio clip + **ensures ≥1 scene** (with its launch button). `onAddLane` is generalized to create scenes when needed (see §4 scene fix).

## Section 2 — Mode 1: drop WAV → sounds adapted to tempo

Import flow (the immediate path):
1. Drop WAV → `importFile` → `sampleStore.put` + `sampleCache.put`.
2. `detectLoop` → `originalBpm` → `barCount`.
3. Create the **audio clip**: `ClipSample {mode:'loop', warp:true, warpMode:'stretch', originalBpm, trimStart:0, trimEnd:dur}`, `lengthBars = barCount`, no notes.
4. Ensure `audio` lane + scene with a play button → **sounds on Play, no extra steps**.

How it adapts to tempo without altering pitch: the clip spans `barCount` bars; at a given BPM that is a duration `gate`. WSOLA stretches the loop's region to fill `gate` (`ratio = gate / region`) **preserving pitch**.
- At the loop's native BPM → `ratio ≈ 1` → **identical to the original**.
- At other BPMs → time-stretched, pitch unchanged.
- The WSOLA buffer is pre-rendered on import and on BPM change (`stretch-resync`, already exists) + self-heals on cache miss; never silent.

Drop targets: a **"+ Audio"** action creates an audio lane; dropping a WAV (on the lane's cell or a drop zone) creates the clip; dropping audio with no audio lane present creates one.

Optional nicety: on import, offer "set session BPM to the loop's BPM" so it tiles with no stretching.

## Section 3 — Mode 2: slice → sampler lane + waveform header

**"Slice → pads" action** (button on the audio clip editor). On a loop:
1. Detect onsets (`detectLoop`) or use embedded Acid/cue/AIFF markers.
2. `sliceBuffer` (already on `main`) extracts **each slice as its own `AudioBuffer`** → stored as a **bank sample** (`sampleCache` + `sampleStore`) → a **keymap** entry on consecutive notes from a base (single-note range, natural pitch).
3. Create a **sampler** lane with those slices in the keymap + a **normal note clip** (one note per slice on the grid) + a scene → launchable.
4. Playback uses the **existing keymap one-shot path** (no `opts.slice`, no scheduler slice branch).

This **replaces** the clip-local slice approach. Cleanup:
- **Delete `src/session/clip-editors/clip-editor-loop.ts`** (the duplicate note editor).
- Retire the now-dead `opts.slice` / `triggerSlice` / scheduler slice-branch / runtime+dispatch slice threading. (If a full revert is risky, leave them unused and flagged for removal — but prefer removal since the new path supersedes them.)

**Waveform as a HEADER on the normal editor** (keep the liked visual, no second note editor):
- New `src/session/clip-editors/clip-waveform-header.ts` — mounts **above** the normal editor when the clip/lane has an associated buffer; draws the waveform, the bar/beat ruler, and slice markers (aligned to the grid).
- **Audio clip (Mode 1, no notes):** editor = **waveform only** (+ tempo/warp controls). No note grid.
- **Sampler sliced clip (Mode 2):** **waveform header + the normal editor** below (drum-grid/piano-roll with the slice notes).
- Routing: `clip-editor-router` mounts the header for sample-backed clips and selects the body editor (none for audio clips; normal editor for sampler clips). `isSliceLoopClip`/`renderLoopEditor` are removed.

## Section 4 — Testing, scene fix, phasing

**Testing — so "green" means "audible":**
1. **Real-path render test (DSP).** Render through the **actual engine + lane-scheduler** into an `OfflineAudioContext`, not raw `BufferSource`s, so a broken `engine→scheduler→output` chain fails the test.
   - Mode 1: audio clip via the `audio` engine at native BPM → ≈ original; at 2× BPM → pitch preserved (autocorrelation pitch ratio ≈ 1) and non-silent.
   - Mode 2: sampler lane (sliced keymap + note clip) rendered through the scheduler → ≈ original; non-silent.
2. **Playwright e2e (the demo).** Drive the real app: add an audio channel, drop a committed fixture WAV (`test/fixtures/loops/drum/*.wav` via `setInputFiles`), launch the scene, assert it is **playing** (transport state / advancing playhead / a visible indicator). This is the only layer that catches "the app is silent." Build `dist/` first (`npm run build`) — e2e serves the built bundle.
3. **Pure unit tests** for new pure helpers: `audio-clip-builder` (WAV meta → audio clip), `ensureScenesForRows`, slice→keymap mapping. (`sliceBuffer` + the recompose DSP test already exist on `main`.)

Assertions are **relative** (ratios/correlation), per the project convention.

**Scene-play-button fix:** pure helper `ensureScenesForRows(state)` that appends the scenes needed to cover the max clip-row count; called from `onAddLane`, the audio drop, and the Slice action. Result: "add a lane / drop a loop → a launchable scene with a play button" always holds.

**Error handling / edge cases:** unsupported/corrupt file → existing decode-failure path (no crash); detection low-confidence → fall back to "whole loop = 1 bar" + manual BPM/bars on the audio clip editor; extreme WSOLA ratio is clamped (already in `timestretch`); stretch render in flight → previous/varispeed plays until ready (no dropout); save/load → audio clips reference the buffer by `sampleId` (already persisted in IndexedDB); slice samples persisted likewise.

**Implementation phases (plan; docs LAST):**
- **A.** `audio` engine + shared `audio-clip-voice` helper + audio clip/lane model + persistence (save/load).
- **B.** Import/drop → audio clip (Mode 1) + `ensureScenesForRows` (launchable) + real-path render test.
- **C.** `clip-waveform-header` + audio-clip editor (waveform-only) + delete `clip-editor-loop.ts`; route accordingly.
- **D.** Mode 2: Slice → sampler lane (slices → bank) + retire `opts.slice` plumbing.
- **E.** Playwright e2e demo.
- **F (last).** Manual (`docs/manual/`) + README.

## New / changed files (summary)

**New:** `src/engines/audio.ts` (engine), `src/engines/audio-clip-voice.ts` (shared buffer/stretch voice), `src/session/clip-editors/clip-waveform-header.ts`, `src/session/audio-clip-builder.ts` (WAV meta → audio clip), `src/core/scene-ensure.ts` (`ensureScenesForRows`), an audio-drop UI hook, Playwright spec `tests/e2e/audio-channel.spec.ts`, real-path render test(s) (`*.dsp.test.ts`), plus unit tests.

**Changed:** `src/engines/sampler.ts` (use the shared `audio-clip-voice`; add the Slice→bank action), `src/session/clip-editors/clip-editor-router.ts` (mount waveform header; route audio vs sampler; remove `isSliceLoopClip`/loop editor), `src/session/session-host.ts` (`onAddLane` + drop + slice call `ensureScenesForRows`; install audio lane/clip), `src/app/lane-allocator.ts` / registry boot (register `audio`), `src/save/saved-state-v3.ts` (persist audio lanes/clips + slice samples if whitelisted), the import UI.

**Deleted:** `src/session/clip-editors/clip-editor-loop.ts` (+ retire `opts.slice`/`triggerSlice`/scheduler slice branch).

## Out of scope / future

- Free off-grid audio-clip arrangement on a timeline (this is loop-in-scene); the Performance view already does linear arrangement.
- Multi-clip audio lanes beyond the scene model (one audio clip per scene cell, as today).
- Real-time (non-offline) time-stretch; warp markers / manual warp anchors.
