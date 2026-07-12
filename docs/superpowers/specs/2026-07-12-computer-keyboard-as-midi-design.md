# Computer keyboard as a MIDI instrument — design

- **Date:** 2026-07-12
- **Status:** draft for review (brainstorming output)
- **Depends on:** the MIDI live-record feature (`worktree-midi-live-capture`) — reuses `facade.playLiveNote`/`releaseLiveNote`, the live-keyboard voice grouping, chord note-FX on live input, and the `● Rec` loop-record. This feature should be built AFTER that branch merges to main, on its own branch.

## Problem

Playing/recording Loom's engines live currently requires a **Web-MIDI device** — the only thing that reaches `facade.playLiveNote` is the control mediator, fed by MIDI (`control-mediator.ts:80`). The computer keyboard *does* play notes, but through a **separate, unused mechanism**: the piano-roll's "musical typing" (`pianoroll.ts:736-773`, gated by the `⌨ Keys` toggle), which writes notes **directly into the open clip** rather than playing the lane live. That path:

- does not go through `playLiveNote`, so it gets **no chord note-FX** and is **not captured by the new `● Rec`**;
- is a second, parallel note-entry system the user has **never used** and that competes with the new live-record.

## Goal

Make the **computer keyboard behave like a MIDI keyboard**: when enabled, its musical keys play the **active lane** live (same path as a hardware MIDI device), so chord-on-live and `● Rec` loop-record work identically — with **no hardware required**. Remove the old piano-roll musical-typing/record path so there is one coherent system.

Bonus: this makes the whole live-record feature **verifiable by ear without any MIDI hardware**.

## Scope

### In scope
- A new computer-keyboard input source that plays the active lane live via `facade.playLiveNote`/`releaseLiveNote`.
- **Reuse** the existing `⌨ Keys` toggle (`clip-kb-input.ts` global flag + the pill in `clip-editor-toolbar.ts`) as the single opt-in enable — **repurposed** to mean "computer keyboard plays live" instead of "type notes into the clip". Update its title/tooltip text only.
- **Reuse** the existing pure key→note mapping (`midiForKey` / `keyToSemitone` / `clampOctaveBase` / `octaveBaseLabel`, `piano-roll-editing.ts`) — the same familiar ASDFG-white-keys layout with `z`/`x` octave.
- **Remove** the piano-roll's note-INSERTION-on-typing: the letter-key note insertion, the step-input cursor, and the `z`/`x`-for-typing octave branches in `pianoroll.ts` (roughly lines 723-773). Keep everything else in that keydown handler (tool toggle `1`/`2`, `Ctrl+A/C/X/V`, `Esc`, arrows, `Delete`/`Backspace` selection edits).

### Out of scope (explicit)
- Velocity sensitivity (computer keys have none → fixed velocity).
- Sustain pedal / MIDI CC emulation.
- A MIDI-device-style "profile" — the computer keyboard talks to the facade directly, it is not a parsed-MIDI-bytes profile.
- Changing the MIDI-control enable or the `● Rec` buttons (already built).
- Removing the pure helpers (`midiForKey` etc.) — they are reused, not deleted.

## Architecture

### New: `src/control/computer-keyboard.ts`
A small, isolated input source. **No DSP, no clip mutation.** Attaches `keydown`/`keyup` listeners on `document` and translates musical keys into live-play calls on the facade.

```ts
interface ComputerKeyboardDeps {
  facade: Pick<LoomControlFacade, 'playLiveNote' | 'releaseLiveNote'>;
  getActiveLane: () => string | null;   // reads activeLaneStore, same source the mediator uses
  isEnabled: () => boolean;             // isKbInputEnabled()
}
function attachComputerKeyboard(deps: ComputerKeyboardDeps): () => void; // returns a detach fn
```

Behavior per event:
- **Gate:** ignore entirely when `!isEnabled()`, when `isTextEditTarget(e.target)` (never steal keystrokes from BPM/name/rename inputs), or when a Ctrl/Meta modifier is held (so editing shortcuts like Ctrl+A/C/V still work).
- **keydown** (musical key, not a repeat): `midi = midiForKey(e.key, octaveBase)`; if non-null and the physical key isn't already held → mark it held and `facade.playLiveNote(active, midi, VELOCITY)`. `preventDefault()`.
- **keyup:** if the physical key was held → release it and `facade.releaseLiveNote(active, midi)`.
- **Octave:** `z`/`x` shift `octaveBase` by ∓12, clamped via `clampOctaveBase` to a sensible playable MIDI range. Own octave state (module-local), reset on reload.
- **Chords:** each physical key owns its own live voice group; the live-keyboard layer already expands chord note-FX and groups voices per physical key (from the live-record work), so holding several keys = several simultaneous voices, and releasing one key releases exactly its group.
- Held-key tracking prevents auto-repeat re-triggers and guarantees each keydown has exactly one keyup.

`VELOCITY`: a fixed value **below the accent threshold** (accent is `velocity >= 100`), e.g. reuse the editor's `DEFAULT_VELOCITY` — so computer-keyboard notes are not all accented.

### Reuse: the `⌨ Keys` toggle
`clip-kb-input.ts`'s global `isKbInputEnabled()` stays the single source of truth; `attachComputerKeyboard` reads it as its enable. The `clip-editor-toolbar.ts` pill stays but its **label stays `⌨ Keys`** and its **tooltip changes** to describe "play the active lane live from the computer keyboard" (not "type notes into the clip").

### Removal: piano-roll musical typing
In `pianoroll.ts`, delete the keydown branches that (a) insert a note via `midiForKey` (both the step-input and the playhead-record paths), (b) move the step-input cursor with arrows, (c) handle `z`/`x` as typing octave, and (d) the step-input `Backspace`. Also remove the now-dead `keyup` musical-typing handler and the `heldKeys`/`octaveBase`/`auditionNote`/`quantizeRecorded` machinery used only by typing. Keep the editing shortcuts. Verify no other caller depends on the removed `pianoroll` internals.

### Wiring: `main.ts`
After the facade and `activeLaneStore` exist, call `attachComputerKeyboard({ facade: controlFacade, getActiveLane: () => activeLaneStore.get(), isEnabled: isKbInputEnabled })` once at boot.

## Data flow

`keydown (a)` → `computer-keyboard.ts` (enabled? not typing? not modifier?) → `midiForKey` → `facade.playLiveNote(activeLane, midi, vel)` → chord note-FX expand → live voices sound **and** (if `● Rec` armed) the live-recorder captures them — identical to a hardware MIDI keydown.

## Edge cases
- **Typing in a text field** → no notes (gated by `isTextEditTarget`).
- **Auto-repeat** (`e.repeat`) → ignored; held-key set also guards.
- **Toggle off mid-hold** → outstanding held keys should still get their `releaseLiveNote` on keyup (track held keys regardless of the enable flag flipping), so no stuck notes.
- **No active lane** → no-op.
- **Editing shortcuts** (`1`/`2`, arrows, `Ctrl+*`, `Delete`) in the piano-roll → unaffected: `midiForKey` returns null for non-note keys and the module skips modifier combos.

## Testing (no hardware)
1. **Mapping** — already covered by `piano-roll-editing.test.ts` (`midiForKey`).
2. **New module unit test** (`computer-keyboard.test.ts`): dispatch synthetic `KeyboardEvent`s against a fake facade + fake active-lane getter + enable flag. Assert: enabled + musical key → `playLiveNote(lane, expectedMidi, vel)`; keyup → `releaseLiveNote(lane, expectedMidi)`; disabled → nothing; text-edit target → nothing; Ctrl held → nothing; `e.repeat` → nothing; `z`/`x` shift the octave (next note is ±12); toggle-off mid-hold still releases on keyup (no stuck note).
3. **Removal regression** (`pianoroll` / editing): with a clip open and the editor focused, a musical letter keydown does NOT insert a note into the clip (the old path is gone); the editing shortcuts still work.
4. **Manual (now possible without a Casio):** enable `⌨ Keys`, open a melodic clip, play ASDFG → hear the active lane; add a chord note-FX → one key sounds the chord; `● Rec` over a running scene → the played notes land in the clip at their real positions; `↺ Undo` removes them.

## Decisions (resolved)
- **Enable:** reuse the existing `⌨ Keys` toggle (single, opt-in) — no new switch, no coupling to the MIDI-control enable. (User: "ese switch únicamente".)
- **Old piano-roll typing/record:** removed (unused; competed with the new system). (User: "no lo hemos usado nunca … nos libramos de muchas mierdas".)
- **Velocity:** fixed, non-accent.
- **Mapping/octave:** reuse the existing pure helpers unchanged.

## Open questions for the user
- **Q1 — velocity value:** fixed at the editor's `DEFAULT_VELOCITY` (whatever the piano-roll used), or a specific value you prefer?
- **Q2 — toggle placement:** keep the `⌨ Keys` pill exactly where it is (piano-roll toolbar, so only visible with a melodic clip open), or also surface it in the MIDI Control panel next to `● Rec` so it's reachable without opening a clip? (Recommend: keep as-is for v1.)
