# MIDI live-record → clip (loop-record) + live-input fixes — design

- **Date:** 2026-07-11
- **Status:** approved design, not yet implemented
- **Worktree/branch:** `worktree-midi-live-capture`
- **Related:** builds on the live-MIDI control subsystem (`src/control/`, APC Key 25 spec `2026-06-05-apc-key25-midi-control-design.md`). Reuses `live-keyboard.ts` (monitoring), the controller-profile mediator, and the per-lane note-FX chain (`src/notefx/`).

## Problem

Loom can already be **played** live from a MIDI keyboard (any class-compliant device — a Casio CTK-4200, etc. — enters through the generic-keyboard profile; notes drive the active lane's engine via `live-keyboard.ts`). Three gaps block using it to actually build parts:

1. **No capture.** The live keyboard only sounds voices; nothing records what you play. The only recording Loom has today is Performance automation (`src/performance/rec-state.ts` — knob automation + clip-launches), not played notes.
2. **The keyboard doesn't follow the open clip.** The keyboard plays the MIDI-**active** lane (`activeLane`, mirrored from `SessionHost.activeEditLane`). That only changes from the top engine-selector tab bar (`focusLane` → `onActiveLaneChanged`). **Opening a clip does not change it** — so you edit clip X but the keyboard still plays lane Y.
3. **Note-FX don't apply to live input.** `live-keyboard.ts` creates the voice directly (`engine.createVoice` → `voice.trigger`), bypassing the lane's note-FX chain. The scheduler path applies it (`trigger-dispatch.ts` → `getNoteFxChain(laneId).process(...)`), so **chord/arp shape scheduled clips but not what you play live**.

Goal for this pass: fix (2) and (3, chord only) so live play is coherent, then add (1) loop-record on top.

## Scope

This is the **loop-record** phase plus the two live-input prerequisites it depends on.

### In scope
- **Live-input: keyboard follows the open clip.** Opening/focusing a clip makes that clip's lane the MIDI-active lane.
- **Live-input: note-FX on live input (chord).** MIDI input runs through the lane's note-FX chain, so **chord** shapes what you play — and therefore what gets recorded.
- **Loop-record.** Record played notes into a clip, synced to playback tempo.
  - Destination: **open clip** (with Merge/Replace) or **new clip** in the active lane when no clip is open.
  - Rec starts playback of the current clip's scene **only when nothing is already playing** (never disturbs live playback).
  - Captured notes are the **processed** notes (post note-FX — what actually sounds), see "What is captured".
  - Two Rec entry points: the clip editor header, and the MIDI Control panel.
  - Undo for the whole capture.
- Tests that need **no hardware** (synthetic MIDI events against a running transport).

### Out of scope (explicit, deferred)
- **Live arpeggiator** — routing the arp note-FX to real-time *held* input needs a new real-time arp clock (the scheduler expands a note of *known* gate; a held live key has an unknown gate). Next pass. Chord, being instantaneous, is in.
- **Quantization** — notes land at their real (tempo-relative) position; no snap.
- **Sustain-pedal fidelity** — the pedal still sustains the *monitored* sound while recording, but is **not** written into the clip; a recorded note's length = key down→up.
- **Dedicated Casio profile** — the generic-keyboard profile already plays; a dedicated profile would only add a nicer label.
- **Audio clips** — recording targets note clips only (melodic + drums). Audio clips disable Rec.
- Count-in / metronome click, punch in/out, per-take comping.

## Live-input prerequisites (this pass)

### P1 — keyboard follows the open clip
When a clip is opened/focused (`SessionInspector.openInspector`, reached from every clip click via `setSelectedClip` + `openInspector`), the host's `focusLane(clip.laneId)` runs, so `activeEditLane` updates and `onActiveLaneChanged` mirrors it into the MIDI `activeLane` store. Implemented by giving the inspector an `onClipFocused?(laneId)` dep that `SessionHost` wires to `focusLane`. Idempotent (`focusLane` dedupes when already active).

### P2 — note-FX (chord) on live input
`live-keyboard.ts` monitoring runs the incoming key through the lane's note-FX chain before spawning voices — the same `getNoteFxChain(laneId)` / `chain.process(...)` used by `trigger-dispatch.ts`, restricted to instantaneous processors (chord) this pass. One physical key can expand to several simultaneous voices (a chord); the physical key-up releases all voices in that group.

## Behavior (UX)

### The Rec control
- A **`● Rec`** button plus a **`Merge / Replace`** toggle on the **clip editor header** (next to the `Track ▸ Scene ▸ Clip` breadcrumb). This Rec targets the **open clip**.
- A second **`● Rec`** in the **MIDI Control panel** (same logic; entry point when no clip is open).
- Rec requires MIDI control **enabled**; otherwise the Rec buttons are disabled with a hint.

### Pressing Rec
1. **Playback (never disturb what's live):**
   - If **something is already playing** (`anyPlaying` true) → Rec does **not** launch or restart anything; it captures against the running transport.
   - If **nothing is playing** → Rec **launches the current clip's scene** (`launchSceneAt(clipIdx)` — the clip's row index *is* its scene index) so the user hears the full context and there is a clock. With no open clip, it launches the **currently selected scene**.
2. **Monitoring:** the user keeps playing (monitored live through `live-keyboard.ts`, now via the chord note-FX). Captured notes anchor to the destination clip's **playhead** within the loop.
3. **Write mode (open clip):**
   - **Merge / overdub** — captured notes are written into the clip **live**, so on the next loop pass they already sound and the user layers more on top (accumulative overdub).
   - **Replace** — the clip's notes are cleared when Rec starts; record onto an empty loop.
4. **Stopping:** pressing Rec again stops recording. **Playback keeps running** (stopped with the normal transport Stop). Rec never stops playback.

### What is captured
- The **processed** notes (post note-FX). With chord on, one played key records the whole chord. Consequence (accepted): because the scheduler re-applies the lane's note-FX on playback, leaving chord **on** would double the recorded clip — the normal move is to turn the lane's chord **off** after recording (the clip already contains the chord). Noted in the UI hint.
- Each note's velocity is the played velocity (post note-FX). Length = physical key down→up (pedal not recorded).

### Destination rule (single source of truth)
- **Open clip** (`sessionHost.inspector.getSelectedClip()` while the inspector panel is shown) → record into it, honoring Merge/Replace.
- **No open clip** → new clip in the first empty slot of the **active lane** (`activeEditLane`); length rounded up to the bar (min 1 bar). Never overwrites.
- **Audio destination** → Rec disabled.

## Timing & anchoring
- Playback runs at the current session BPM; captured note times are stored **tempo-relative (ticks, `TICKS_PER_QUARTER = 96`)**, so later BPM changes keep the clip in time.
- Destination clip play position = `ctx.currentTime − LanePlayState.loopStartedAt`, converted to ticks and wrapped modulo the clip length (`lengthBars × ticksPerBar(meter)`).
- A note's start = play position at key-down; end = play position at key-up (real timing, no quantization).
- Into an **existing** clip: current length preserved; notes past the clip end are discarded. Only a **new** clip derives/rounds its length.

## Architecture

Keep pieces small and testable; follow existing control-subsystem seams. No god-files (source target ≤300 lines).

### New: `src/control/live-recorder.ts` (pure)
Pure state machine — **no audio, no DOM**. Fed abstract note events + a "current play position" reader; produces `NoteEvent[]`.
- `createLiveRecorder()` → `{ start, noteOn, noteOff, stop, isRecording }`.
- `start({ mode: 'merge' | 'replace', existingNotes: NoteEvent[], clipLengthTicks: number | null, posTicks: () => number })`.
- `noteOn(midi, velocity)` stamps `start = posTicks()`, tracks the open note; `noteOff(midi)` stamps `end`, emitting a `NoteEvent`.
- `stop(): { notes: NoteEvent[]; lengthTicks: number }` — merged/replaced set; clamped to `clipLengthTicks` (existing) or rounded-to-bar (new).
- Unit-tested: pairing, position→tick stamping, merge vs replace, length clamp/round, empty no-op.

### Chord monitoring + tap (`loom-facade.ts` / `live-keyboard.ts`)
- `playLiveNote` runs the key through the lane's note-FX chain (chord) → a group of `(midi, velocity)`; each spawns a monitored voice keyed by the physical key. `releaseLiveNote` releases the whole group.
- When capture is active, the same processed group is forwarded to the recorder (`noteOn`/`noteOff`), so recording matches what sounds.

### Facade additions (`LoomControlFacade`)
- `startCapture(mode)`: resolve destination (open clip vs new-in-active-lane; create the new clip); if `!anyPlaying`, `launchSceneAt(sceneIdx)`; hand the recorder a `posTicks()` closure for the destination clip.
- `stopCapture()`: pull `{ notes, lengthTicks }` and commit to the clip's `notes` as **one undoable action** (via `withUndo` used by the inspector's note edits), then re-render the open editor.
- `isCapturing()` for UI state.

### UI
- `control-surface-ui.ts` + `index.html` — MIDI Control panel `● Rec`.
- Clip editor header — `● Rec` + `Merge/Replace` toggle, disabled when the open clip is audio or MIDI control is off.

## Edge cases
- **Rec with MIDI control disabled** → buttons disabled + hint; no capture.
- **Rec, no open clip, active lane full** → clear message; never overwrite.
- **Rec on an audio clip** → disabled.
- **Empty capture** → no clip mutation, no undo entry.
- **BPM change mid-record** → tick-based, stays in time.
- **Disable MIDI control / page unload while capturing** → **abandon** (no partial commit) — decided (Q1).

## Testing (no hardware)
1. **Pure recorder unit tests** — pairing; position→ticks; merge vs replace; clamp/round; empty no-op.
2. **Chord-on-live-input test** — a single `noteOn` through the facade with a chord note-FX enabled spawns the expected voice group; the physical `noteOff` releases all.
3. **Keyboard-follows-clip test** — opening a clip fires `focusLane`/`onActiveLaneChanged` with the clip's lane.
4. **Integration (mocked clock + synthetic events)** — drive `noteOn/noteOff` with capture active against a running fake transport; assert the destination clip gains the expected processed `NoteEvent[]`; Merge preserves prior notes, Replace clears them.
5. **Destination-rule tests** — open clip → writes there; no open clip → new clip in active lane; audio → disabled.
6. **No-disturb test** — Rec while `anyPlaying` does **not** call `launchScene`; Rec while idle does.

## Decisions (resolved)
- **Q1 (disable mid-capture):** abandon capture, no partial commit.
- **Q2 (count-in):** none — start immediately; a "capturing…" indicator is enough.
- **What is captured:** processed notes (post note-FX).
- **Arp on live input:** deferred to a follow-up pass (real-time arp clock).
