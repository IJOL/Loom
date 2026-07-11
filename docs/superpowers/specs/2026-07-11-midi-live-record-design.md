# MIDI live-record → clip (loop-record) — design

- **Date:** 2026-07-11
- **Status:** approved design, not yet implemented
- **Worktree/branch:** `worktree-midi-live-capture`
- **Related:** builds on the live-MIDI control subsystem (`src/control/`, APC Key 25 spec `2026-06-05-apc-key25-midi-control-design.md`). Reuses `live-keyboard.ts` (monitoring) and the controller-profile mediator.

## Problem

Loom can already be **played** live from a MIDI keyboard (any class-compliant device — a Casio CTK-4200, etc. — enters through the generic-keyboard profile; notes drive the active lane's engine via `live-keyboard.ts`). But **nothing captures that performance**: the live keyboard only sounds voices, it never records. The only recording Loom has today is Performance automation (`src/performance/rec-state.ts` — knob automation + clip-launches), not played notes.

Goal: let the user **record what they play on the keyboard into a clip**, playing over the material they already have so they can build parts by ear.

## Scope

This is the **loop-record** phase. (An earlier "free capture without transport" framing was dropped once the requirement became "play the existing material at tempo so I can overdub" — that requires the transport running, i.e. loop-record.)

### In scope
- Record played notes into a clip, synced to playback tempo.
- Destination rule: **open clip** (with Merge/Replace) or **new clip** in the active lane when no clip is open.
- Rec starts playback of the current clip's scene **only when nothing is already playing** (never disturbs live playback).
- Two Rec entry points: on the clip editor header, and in the MIDI Control panel.
- Undo for the whole capture.
- Tests that need **no hardware** (synthetic MIDI events against a running transport).

### Out of scope (explicit, deferred)
- **Quantization** — notes land at their real (tempo-relative) position; no snap.
- **Sustain-pedal fidelity** — the pedal still sustains the *monitored* sound while recording, but is **not** written into the clip; a recorded note's length = key down→up.
- **Dedicated Casio profile** — the generic-keyboard profile already plays; a dedicated profile would only add a nicer label, not needed to record.
- **Audio clips** — recording targets note clips only (melodic + drums). Audio clips disable Rec.
- Count-in / metronome click, punch in/out, per-take comping.

## Behavior (UX)

### The Rec control
- A **`● Rec`** button plus a **`Merge / Replace`** toggle live on the **clip editor header** (next to the `Track ▸ Scene ▸ Clip` breadcrumb). This Rec targets the **open clip**.
- A second **`● Rec`** button lives in the **MIDI Control panel** (same logic; it is the entry point when no clip is open).
- Rec requires the MIDI control subsystem to be **enabled** (it captures from the same event stream). If disabled, the Rec buttons are inert/disabled with a hint.

### Pressing Rec
1. **Playback (never disturb what's live):**
   - If **something is already playing** (`anyPlaying` true) → Rec does **not** launch or restart anything. It captures against the transport already running.
   - If **nothing is playing** → Rec **launches the current clip's scene** (`launchSceneAt(sceneIdx)`) so the user hears the full context (the whole row: drums, bass, …) and there is a clock to sync to. With no open clip, it launches the **currently selected scene**.
2. **Arming/monitoring:** the user keeps playing the keyboard as normal (monitored live through `live-keyboard.ts`, unchanged). Captured notes are **anchored to the playhead** of the destination clip within the loop, so they line up with existing material.
3. **Write mode (open clip):**
   - **Merge / overdub** — captured notes are written into the clip **live**, so on the next loop pass they already sound and the user can layer more on top (**accumulative overdub across loop passes**).
   - **Replace** — the clip's notes are cleared when Rec starts; the user records onto an empty loop.
4. **Stopping capture:** pressing Rec again (or a Stop-capture affordance) stops recording. **Playback keeps running** — the user stops it with the normal transport Stop when they want. Rec never stops playback.

### Destination rule (single source of truth)
- **Open clip** (`sessionHost.inspector.getSelectedClip()` while the inspector panel is shown) → record into it, honoring Merge/Replace.
- **No open clip** → create a **new clip** in the first empty slot of the **active lane** (`activeEditLane`); its length is rounded up to the bar (min 1 bar). Never overwrites an existing clip.
- **Audio destination** → Rec disabled (audio clips don't hold notes).

## Timing & anchoring

- Playback runs at the **current session BPM**; captured note times are stored **tempo-relative (ticks)**, so later BPM changes keep the clip in time.
- A note's start = the destination clip's **play position** at key-down; its end = play position at key-up (real timing, no quantization).
- When recording into an **existing** clip, the clip's **current length is preserved**; notes that fall past the clip end are discarded (we don't restructure a clip the user already shaped). Only a **new** clip derives/rounds its length.
- **Loop wrap in Merge:** because notes are written to the clip live, the running scheduler replays them on the next pass — overdub is a natural consequence, no separate mixdown step.

## Architecture

Keep the pieces small and testable; follow the existing control-subsystem seams. No god-files (source target ≤300 lines).

### New: `src/control/live-recorder.ts` (pure)
A pure state machine — **no audio, no DOM**. Fed abstract events + a "current play position" reader; produces `NoteEvent[]`.
- `start({ mode: 'merge' | 'replace', existingNotes, clipLengthTicks | null, posTicks: () => number })`
- `noteOn(midi, velocity)` / `noteOff(midi)` — pairs them, stamping start/end from `posTicks()`.
- `stop(): { notes: NoteEvent[]; lengthTicks: number }` — merged or replaced set, clamped to clip length (or rounded-to-bar length for a new clip).
- Fully unit-tested: pairing, tempo→ticks stamping, length rounding/clamping, empty capture (no-op), merge vs replace.

### Tap in the mediator (`control-mediator.ts`)
When capture is active, the mediator forwards each `noteOn`/`noteOff` to the recorder **in addition to** the existing `facade.playLiveNote/releaseLiveNote` monitoring call. The sound path is untouched; recording is a parallel observer.

### Facade additions (`loom-facade.ts` / `LoomControlFacade`)
- `startCapture(mode)`:
  - resolve destination (open clip vs new-in-active-lane) and, for a new clip, create it;
  - if `!anyPlaying`, `launchSceneAt(sceneIdxOfDestination)`;
  - hand the recorder a `posTicks()` closure reading the destination clip's live play position from the runtime/scheduler.
- `stopCapture()`: pull `{ notes, lengthTicks }` from the recorder and commit them to the clip's `notes` **as a single undoable action** (via the existing history wiring used by clip edits).
- `isCapturing()` for UI state.

The facade already exposes `launchScene`, `getActiveLane`, and builds `anyPlaying`; the destination/`posTicks` plumbing is the new surface.

### UI
- `control-surface-ui.ts` + `index.html` — the MIDI Control panel `● Rec`.
- Clip editor header — `● Rec` + `Merge/Replace` toggle, wired through the clip-editor router (`src/session/clip-editors/`) / session-host so it targets the open clip. Disabled when the open clip is audio or MIDI control is off.

## Edge cases
- **Rec with MIDI control disabled** → buttons disabled + hint; no capture.
- **Rec, no open clip, active lane has no empty slot** → surface a clear message (no silent drop); do not overwrite.
- **Rec on an audio clip** → disabled.
- **Empty capture** (Rec then Stop, no keys) → no clip mutation, no undo entry.
- **BPM change mid-record** → times are tick-based, so the clip stays in time.
- **Disable MIDI control / page unload while capturing** → capture is abandoned cleanly (no partial commit, or commit-so-far — pick one in the plan; default: abandon).

## Testing (no hardware)
1. **Pure recorder unit tests** — event pairing; seconds/position→ticks; merge vs replace; length round (new) / clamp (existing); empty no-op.
2. **Integration (mocked clock + synthetic events)** — drive `noteOn/noteOff` through the mediator with capture active against a running fake transport; assert the destination clip gains the expected `NoteEvent[]` (pitch, velocity, start/length) and that Merge preserves prior notes while Replace clears them.
3. **Destination-rule tests** — open clip → writes there; no open clip → new clip in active lane; audio clip → disabled.
4. **No-disturb test** — Rec while `anyPlaying` does **not** call `launchScene`; Rec while idle does.

## Open questions for review
- Q1: Abandon vs commit-so-far if MIDI control is disabled mid-capture (default proposed: **abandon**).
- Q2: Is a visible "capturing…" indicator on the transport/clip enough, or do you want a count-in before the first pass? (default: **no count-in**, just start.)
