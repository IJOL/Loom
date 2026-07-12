# Rec count-in metronome — design

- **Date:** 2026-07-12
- **Status:** approved design
- **Depends on:** the merged live-record + computer-keyboard work (`main` @ `52274f9`). Builds on `loom-facade.ts` `startCapture`.

## Problem

Pressing `● Rec` from an idle transport starts capturing notes **immediately** — the performer has no time to get in tempo, and the first bar is unusable. The live-record spec explicitly deferred a count-in; this brings it in.

## Goal

When `● Rec` starts recording **from idle** (nothing playing), play a **1-bar metronome count-in** first. During the count-in, played notes **sound** (live monitoring) but are **NOT recorded**. When the count-in bar ends, the real recording begins (launch + recorder start). If something is **already playing**, there is **no** count-in (the performer is already in time) — capture starts immediately as today.

## Decisions (resolved with user)
- Count-in length: **1 bar** (of the active meter).
- Click: a **synthesized blip**, accent on beat 1 (no dependency on a drum kit).
- During the count-in: notes **sound but are not captured**.
- Applies **only** when starting Rec from idle; skipped when something is already playing.
- Always on for v1 (no toggle). A toggle is a possible follow-up.

## Behavior

`startCapture(mode)` gains a count-in phase for the idle path:

- **Idle + count-in available:**
  1. Resolve the destination and place the new clip (as today) so it exists.
  2. Do **NOT** start the recorder or launch yet. Enter a **count-in phase**: schedule `beatsPerBar(meter)` click blips at audio time (`60/bpm` apart), accent on beat 1, and arm a timer for the count-in end.
  3. Played notes during this phase still sound via `playLiveNote` (unchanged monitoring) but the recorder is not running, so nothing is captured.
  4. On count-in end: run the deferred start — `recorder.start(...)`, clear notes if `replace`, `launchSceneAt(dest.slotIdx)` — exactly the current idle-branch logic. Capture now anchors at the launch's `loopStartedAt`, tick 0.
- **Something already playing:** unchanged — no count-in, `recorder.start` + (launchClipAt if the dest lane isn't looping the dest clip) immediately.
- **`stopCapture()` during the count-in phase:** cancel the count-in (clear the timer, stop pending clicks), drop the placed new clip (no clutter), clear state. The recorder was never started, so no notes/undo.
- **`isCapturing()`** returns true during the count-in too (so the `● Rec` button shows `■ Stop` and the user can cancel).

## Architecture

### New `src/control/metronome.ts`
- **Pure:** `countInClickTimes(startSec: number, bpm: number, meter: TimeSignature, bars: number): { times: number[]; accents: boolean[]; endSec: number }` — click at each beat (`60/bpm` apart), `accents[i] = (beatIndex % beatsPerBar === 0)`, `endSec = startSec + bars*beatsPerBar*(60/bpm)`. Fully unit-tested (exact values).
- **Impure:** `createCountIn(ctx: AudioContext, out: AudioNode): (bars: number, bpm: number, meter: TimeSignature, onComplete: () => void) => (() => void)` — schedules a short osc blip per click time (accent = higher pitch/gain), and a timer that fires `onComplete` at `endSec`; returns a **cancel** fn that clears the timer (pending clicks are short and harmless, but stop scheduled nodes if convenient). The osc blip: `osc(square) → gain(short AD env ~40ms) → out`, ~1500 Hz accented / ~1000 Hz normal. (DSP → verified by ear, not unit-tested.)

### Facade (`loom-facade.ts`)
- `LoomFacadeDeps` gains `countIn?: (bars: number, bpm: number, meter: TimeSignature, onComplete: () => void) => (() => void)`. If absent → no count-in (immediate capture, current behavior — keeps existing tests valid).
- Add a `countInCancel: (() => void) | null` field. In `startCapture`, the idle branch: if `deps.countIn` present, call it with `bars=1`, storing the returned cancel in `countInCancel`, and pass an `onComplete` that runs the deferred `recorder.start` + `launchSceneAt`. Else run them inline (today's behavior).
- `isCapturing()` → `recorder.isRecording() || countInCancel != null`.
- `stopCapture()` → if `countInCancel` is set (count-in phase), call it, drop the placed new clip, clear `countInCancel` + `capture`, and return (no recorder.stop).

### Wiring (`main.ts`)
`createLoomFacade({ …, countIn: createCountIn(ctx, ctx.destination) })` — clicks go straight to `ctx.destination` (a transient monitoring sound, independent of the mix).

## Edge cases
- `stopCapture` mid-count-in → clean cancel, clip dropped, no recording.
- BPM/meter read at count-in start (`deps.seq.bpm`/`.meter`); a change mid-count-in isn't re-applied (v1).
- Count-in only on the idle path → the "something playing" no-disturb path is unchanged.
- No `deps.countIn` (e.g. in existing facade tests) → behaves exactly as today.

## Testing (no hardware)
1. **`countInClickTimes` unit test:** bpm 120, 4/4, 1 bar → `times=[0,0.5,1.0,1.5]`, `accents=[true,false,false,false]`, `endSec=2.0` (exact). Also 3/4 and a non-zero `startSec`.
2. **Facade count-in test** (mock `countIn` capturing `onComplete` + a cancel spy; fake/stub ctx as in `loom-facade.capture.test.ts`): startCapture from idle → recorder NOT started and `launchSceneAt` NOT called yet, but `isCapturing()` is true; invoke the captured `onComplete` → recorder starts + `launchSceneAt` called. `stopCapture` during count-in → the cancel spy is called, the placed clip is dropped, recorder never ran. With `countIn` absent → immediate capture (existing tests unaffected).
3. **Manual (ear):** Rec from idle → hear 1 bar of clicks (accent on 1), then recording starts; notes played during the clicks are NOT in the clip; Rec while a scene plays → no count-in.

## Open questions
- None blocking. (Toggle for the count-in, and count-in also on the "already playing" path, are possible follow-ups.)
