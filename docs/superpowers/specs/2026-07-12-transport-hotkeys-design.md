# Transport & Rec hotkeys — design

- **Date:** 2026-07-12
- **Status:** approved design
- **Depends on:** merged live-record + computer-keyboard + count-in (`main` @ `a5a8f47`).

## Problem
Loom has **no transport keyboard shortcuts**. Playing/recording live from a keyboard (MIDI or computer) needs hands-free control: stop the `● Rec`, and pause/continue playback without the mouse.

## Goal
Two global hotkeys:
1. **`Space`** — toggle **global pause / resume** with **exact resume** (continue from the exact position).
2. **`R`** — toggle the **`● Rec`** loop-record (stop if recording; start if not).

Scene-scoped pause is **deferred** (a global pause already "pauses the launched scene").

## Decisions (with user)
- Resume = **exact** (built on the existing seek machinery).
- Scope = **global**; scene-scoped deferred.
- Keys: **`Space`** (pause/resume), **`R`** (Rec toggle).
- **Q1** `Space` on a fully-idle transport → **no-op** (do not launch anything).
- **Q2** pausing pauses **playback only**; a running `● Rec` capture is left untouched.
- **Q3** `R` is a **toggle** (start from idle / stop while recording), matching the ● Rec button.

## Constraints (hard)
- **Keys must not collide with the live musical keys.** With `⌨ Keys` ON, `a s d f g h j k · w e t y u · z x` play notes and `1`/`2` are tools. `Space`/`R` are NOT in that map — no clash. The live computer-keyboard module ignores them (`midiForKey` returns null).
- **Never fire while typing in a text field** — gate with `isTextEditTarget` (guarded `typeof HTMLElement !== 'undefined'` for the node test env).
- **`Space` must `preventDefault`** (no page scroll / button click).
- Ignore Ctrl/Meta/Alt combos.

## Architecture

### `SessionHost` — global pause/resume (it owns `laneStates`, `activeSceneIdx`, `songAnchorSec`, `seekToBar`, `stopAllClips`)
- `private paused: { posBar: number; sceneIdx: number } | null = null;`
- **`pauseTransport()`** — no-op unless something is playing and a scene is launched:
  1. `posBar = (ctx.currentTime − songAnchorSec) / songBarSec(bpm, meter)` (fractional bar = exact position).
  2. `sceneIdx = activeSceneIdx`.
  3. `stopAllClips()` (halts + silences).
  4. Set `this.paused = { posBar: max(0, posBar), sceneIdx }` **after** the stop.
- **`resumeTransport()`** — when `paused`:
  1. Read `p = paused` into a local, `paused = null`.
  2. `launchSceneAt(p.sceneIdx)` (re-arm the scene).
  3. `seekToBar(p.posBar)` — `seekToBar` already accepts a **fractional** bar (`targetSongSec = bar * songBarSec`), so this is an exact seek. No new method needed.
- **`togglePlayPause()`** (what `Space` calls): `paused` → resume; else something playing → pause; else (idle) → no-op.
- **Invalidate `paused`** on any other transport change: clear `this.paused = null` at the top of `launchSceneAt`, `launchClipAt`, and `stopAllClips`. (`pauseTransport` sets `paused` *after* its `stopAllClips`, so it survives; `resumeTransport` reads `paused` into a local before `launchSceneAt` clears it. A manual scene/clip launch or the transport Stop button therefore discards a stale pause.)

### New `src/control/transport-hotkeys.ts`
`attachTransportHotkeys({ target?, isTextTarget, onTogglePlay, onToggleRec }): () => void` — mirrors `computer-keyboard.ts`: a `keydown` on `window` (node-safe, testable via injected `target`), returns a detach fn. On `keydown` (skip if `ctrlKey||metaKey||altKey` or `isTextTarget(e.target)`): `' '`/`Spacebar` → `onTogglePlay()` + `preventDefault`; `r` → `onToggleRec()`.

### Wiring (`main.ts`)
`attachTransportHotkeys({ isTextTarget: (t) => typeof HTMLElement !== 'undefined' && isTextEditTarget(t), onTogglePlay: () => sessionHost.togglePlayPause(), onToggleRec: () => controlFacade.isCapturing() ? controlFacade.stopCapture() : controlFacade.startCapture('merge') })`.

## Edge cases
- `Space` idle / never launched → no-op.
- `Space` mid-count-in Rec → the count-in Rec is independent; pause/resume act on the transport (which is idle during a from-idle count-in anyway).
- BPM change while paused → `posBar` is tempo-relative (bars), so resume stays musically correct.
- Text field focused → handler skips (space/'r' type normally).
- All three handlers (2 hotkeys' keys + computer-keyboard) on `window`: `Space`/`R` aren't musical → the keyboard module ignores them.

## Testing (no hardware, node env)
1. **`transport-hotkeys.ts`** (`Event`+`Object.assign` harness like `computer-keyboard.test.ts`): Space → `onTogglePlay` + `preventDefault`; `r` → `onToggleRec`; text-target → neither; Ctrl+Space → neither.
2. **`SessionHost` pause/resume** unit test (existing session-host test harness / a fake clock): playing → `pauseTransport` saves `{posBar, sceneIdx}` + stops (posBar derived from `songAnchorSec`); `resumeTransport` calls `launchSceneAt(sceneIdx)` then `seekToBar(posBar)`; toggle from idle = no-op; a `launchSceneAt`/`stopAllClips` clears a pending `paused`.
3. **Manual (ear):** launch a scene → `Space` pauses (silence, frozen), `Space` resumes from the same spot; `R` toggles `● Rec`; both ignored while typing in the BPM field.

## Open questions
- None blocking. (Scene-scoped pause + a visible transport/keymap legend are follow-ups.)
