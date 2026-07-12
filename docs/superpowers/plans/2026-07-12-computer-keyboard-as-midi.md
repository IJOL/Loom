# Computer Keyboard as MIDI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the computer keyboard play Loom's active lane live (like a MIDI device), so chord note-FX and the `● Rec` loop-record apply, and remove the unused piano-roll "musical typing" path.

**Architecture:** A small isolated input source (`src/control/computer-keyboard.ts`) attaches document keydown/keyup, and — gated by the existing global `⌨ Keys` toggle — translates musical keys to `facade.playLiveNote(activeLane, midi, vel)` / `releaseLiveNote(...)`, reusing the pure `midiForKey`/`clampOctaveBase` mapping. The old piano-roll typing branches are deleted. Everything downstream (chord expansion, voice grouping, Rec capture) is unchanged and reused.

**Tech Stack:** TypeScript, Vite, Vitest. No new dependencies.

**Built on:** the merged `worktree-midi-live-capture` (needs `facade.playLiveNote`/`releaseLiveNote`). Create a fresh worktree off the updated `main` before executing.

## Global Constraints

- Run one unit-test file with `NO_COLOR=1 npx vitest run <path>` (never add `--reporter`). Full suite: `npm run test:unit` (known flaky teardown `ERR_IPC_CHANNEL_CLOSED` AFTER pass — re-run to confirm; not a failure).
- Typecheck clean: `npx tsc --noEmit` (exit 0) before each commit.
- Source files: target ≤300 lines, hard cap 500. All code/comments/UI text in English.
- Reuse, do not duplicate: `midiForKey`, `keyToSemitone`, `clampOctaveBase` from `src/core/piano-roll-editing.ts`; `isTextEditTarget` from `src/save/history-wiring.ts`; `DEFAULT_VELOCITY` (=90) from `src/core/velocity-gain.ts`; `isKbInputEnabled` from `src/core/clip-kb-input.ts`.
- `facade.playLiveNote(laneId: string, midi: number, velocity: number)` / `releaseLiveNote(laneId: string, midi: number)` — the physical-key group id is the played `midi` (already correct in `loom-facade.ts`); this feature does not touch that.
- **Decisions (from the spec):** velocity fixed at `DEFAULT_VELOCITY` (90, non-accent); the `⌨ Keys` toggle stays in the piano-roll toolbar (v1) and only its tooltip changes; octave via `z`/`x`.

## File Structure

**Create:**
- `src/control/computer-keyboard.ts` — the live computer-keyboard input source (`attachComputerKeyboard`).
- `src/control/computer-keyboard.test.ts` — its unit tests.

**Modify:**
- `src/core/pianoroll.ts` — remove the musical-typing/record branches from the keydown handler + the now-dead keyup typing handler and typing-only machinery; keep editing shortcuts.
- `src/core/clip-editor-toolbar.ts` — retitle the `⌨ Keys` pill tooltip to describe live play (not clip typing).
- `src/main.ts` — instantiate `attachComputerKeyboard` after the facade + `activeLaneStore` exist.

---

## Task 1: The live computer-keyboard input module

**Files:**
- Create: `src/control/computer-keyboard.ts`
- Test: `src/control/computer-keyboard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ComputerKeyboardDeps {
    facade: Pick<LoomControlFacade, 'playLiveNote' | 'releaseLiveNote'>;
    getActiveLane: () => string | null;
    isEnabled: () => boolean;
    target?: EventTarget;         // defaults to document (injected in tests)
    initialOctaveBase?: number;   // defaults to 60 (C4)
  }
  function attachComputerKeyboard(deps: ComputerKeyboardDeps): () => void;  // returns a detach fn
  ```

- [ ] **Step 1: Write the failing test**

Create `src/control/computer-keyboard.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { attachComputerKeyboard } from './computer-keyboard';
import { DEFAULT_VELOCITY } from '../core/velocity-gain';

function harness(o: { enabled?: boolean; lane?: string | null } = {}) {
  const facade = { playLiveNote: vi.fn(), releaseLiveNote: vi.fn() };
  const target = new EventTarget();
  let enabled = o.enabled ?? true;
  attachComputerKeyboard({
    facade,
    getActiveLane: () => (o.lane === undefined ? 'lane-1' : o.lane),
    isEnabled: () => enabled,
    target,
    initialOctaveBase: 60,
  });
  const key = (type: 'keydown' | 'keyup', k: string, extra: Record<string, unknown> = {}) => {
    const ev = new KeyboardEvent(type, { key: k, cancelable: true, ...extra });
    target.dispatchEvent(ev);
    return ev;
  };
  return { facade, key, setEnabled: (v: boolean) => { enabled = v; } };
}

describe('attachComputerKeyboard', () => {
  it('a musical keydown plays the active lane; keyup releases the same note', () => {
    const h = harness();
    h.key('keydown', 'a');            // 'a' → octaveBase + keyToSemitone('a')
    expect(h.facade.playLiveNote).toHaveBeenCalledTimes(1);
    const [lane, midi, vel] = h.facade.playLiveNote.mock.calls[0];
    expect(lane).toBe('lane-1');
    expect(vel).toBe(DEFAULT_VELOCITY);
    h.key('keyup', 'a');
    expect(h.facade.releaseLiveNote).toHaveBeenCalledWith('lane-1', midi);
  });

  it('does nothing when disabled', () => {
    const h = harness({ enabled: false });
    h.key('keydown', 'a');
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('ignores auto-repeat and re-press while held (one voice per physical key)', () => {
    const h = harness();
    h.key('keydown', 'a');
    h.key('keydown', 'a', { repeat: true });
    h.key('keydown', 'a');            // still held → no retrigger
    expect(h.facade.playLiveNote).toHaveBeenCalledTimes(1);
  });

  it('lets editing shortcuts through: Ctrl/Meta combos never play', () => {
    const h = harness();
    h.key('keydown', 'a', { ctrlKey: true });
    h.key('keydown', 'c', { metaKey: true });
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('z / x shift the octave down / up by 12 semitones', () => {
    const h = harness();
    h.key('keydown', 'a'); const baseMidi = h.facade.playLiveNote.mock.calls[0][1]; h.key('keyup', 'a');
    h.key('keydown', 'x');            // octave up
    h.key('keydown', 'a'); const upMidi = h.facade.playLiveNote.mock.calls[1][1];
    expect(upMidi).toBe(baseMidi + 12);
  });

  it('non-note keys (arrows, digits) never play', () => {
    const h = harness();
    h.key('keydown', 'ArrowLeft');
    h.key('keydown', '1');
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('no active lane → no-op', () => {
    const h = harness({ lane: null });
    h.key('keydown', 'a');
    expect(h.facade.playLiveNote).not.toHaveBeenCalled();
  });

  it('toggled off mid-hold still releases on keyup (no stuck note)', () => {
    const h = harness();
    h.key('keydown', 'a');
    h.setEnabled(false);
    h.key('keyup', 'a');
    expect(h.facade.releaseLiveNote).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/control/computer-keyboard.test.ts`
Expected: FAIL (`attachComputerKeyboard` not defined). If `KeyboardEvent` is undefined in the test env, confirm the project's vitest DOM environment (other DOM tests like `src/session/session-inspector.test.ts` run in it); align the harness with how those construct DOM/events.

- [ ] **Step 3: Implement the module**

Create `src/control/computer-keyboard.ts`:

```ts
// Computer keyboard as a live MIDI-style instrument. When enabled (the global
// ⌨ Keys toggle), musical keys play the ACTIVE lane via the facade — the same
// path a hardware MIDI keydown takes — so chord note-FX and ● Rec loop-record
// apply. No clip mutation, no DSP. z/x shift the octave. Fixed velocity.
import { midiForKey, clampOctaveBase } from '../core/piano-roll-editing';
import { isTextEditTarget } from '../save/history-wiring';
import { DEFAULT_VELOCITY } from '../core/velocity-gain';
import type { LoomControlFacade } from './controller-profile';

export interface ComputerKeyboardDeps {
  facade: Pick<LoomControlFacade, 'playLiveNote' | 'releaseLiveNote'>;
  getActiveLane: () => string | null;
  isEnabled: () => boolean;
  target?: EventTarget;
  initialOctaveBase?: number;
}

const MIN_OCTAVE_BASE = 24; // C1
const MAX_OCTAVE_BASE = 96; // C7 (clampOctaveBase keeps an octave of headroom)

export function attachComputerKeyboard(deps: ComputerKeyboardDeps): () => void {
  const target = deps.target ?? document;
  let octaveBase = deps.initialOctaveBase ?? 60; // C4
  // physical key (lowercased) → the note we triggered, so keyup releases exactly
  // what keydown played even if the octave/active-lane changed meanwhile.
  const held = new Map<string, { laneId: string; midi: number }>();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // editing shortcuts win
    if (isTextEditTarget(e.target)) return;         // never steal text typing
    if (!deps.isEnabled()) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'x') {
      octaveBase = clampOctaveBase(octaveBase + (k === 'x' ? 12 : -12), MIN_OCTAVE_BASE, MAX_OCTAVE_BASE);
      e.preventDefault();
      return;
    }
    const midi = midiForKey(k, octaveBase);
    if (midi === null) return;                       // non-note key → leave it for other handlers
    e.preventDefault();
    if (e.repeat || held.has(k)) return;             // no auto-repeat retrigger
    const laneId = deps.getActiveLane();
    if (!laneId) return;
    held.set(k, { laneId, midi });
    deps.facade.playLiveNote(laneId, midi, DEFAULT_VELOCITY);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const h = held.get(k);
    if (!h) return;                                  // release regardless of the enable flag now
    held.delete(k);
    deps.facade.releaseLiveNote(h.laneId, h.midi);
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  target.addEventListener('keyup', onKeyUp as EventListener);
  return () => {
    target.removeEventListener('keydown', onKeyDown as EventListener);
    target.removeEventListener('keyup', onKeyUp as EventListener);
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `NO_COLOR=1 npx vitest run src/control/computer-keyboard.test.ts` → PASS (8 tests).
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/control/computer-keyboard.ts src/control/computer-keyboard.test.ts
git commit -m "feat(control): computer keyboard plays the active lane live (MIDI-style)"
```

---

## Task 2: Remove the piano-roll musical-typing / record path

**Files:**
- Modify: `src/core/pianoroll.ts` (keydown handler ~lines 723-773, keyup handler ~799-816, and typing-only machinery)
- Test: `src/core/pianoroll.test.ts` (or the nearest existing piano-roll test file — add a regression there)

**Interfaces:**
- Consumes: nothing new. Removes behavior only.

- [ ] **Step 1: Write the failing regression test**

First read the existing piano-roll test setup (how it mounts the editor and reads notes). Add a test asserting that, with `isKbInputEnabled()` true, a musical-letter `keydown` on the editor wrap does NOT insert a note (the typing path is gone). Example shape — adapt to the real fixture:

```ts
it('a musical-letter keydown no longer inserts a note into the clip (typing removed)', () => {
  setKbInputEnabled(true);
  const notesBefore = notes.length;
  wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true, bubbles: true }));
  expect(notes.length).toBe(notesBefore); // no note added by typing
});
```

- [ ] **Step 2: Run it to verify it FAILS against current code**

Run: `NO_COLOR=1 npx vitest run <piano-roll test file>`
Expected: FAIL (current code inserts a note on 'a' when kb-input is enabled).

- [ ] **Step 3: Remove the typing branches**

In `src/core/pianoroll.ts` keydown handler, delete:
- the `z`/`x` typing-octave branch (`if (!cmd && isKbInputEnabled() && (e.key === 'z' || e.key === 'x')) { shiftOctave(...) ... }`),
- the step-input cursor arrows branch guarded by `isKbInputEnabled()`,
- the whole `if (!cmd && isKbInputEnabled()) { ... midiForKey ... }` note-insertion + step-input-Backspace block.
In the keyup handler, delete the musical-typing block (the `heldKeys` note-writing / cursor-advance). Then remove now-unused locals: `heldKeys`, `octaveBase`/`shiftOctave` (only if used solely by typing — verify; the toolbar ◂/▸ octave stepper may still use `octaveBase`, in which case keep it and only remove the z/x path), `auditionNote` calls, `quantizeRecorded`, `cursorTick` step-input usage, `DEFAULT_VELOCITY` import if now unused, and the `midiForKey` import if now unused. Keep: tool toggle `1`/`2`, `Ctrl+A/C/X/V`, `Esc`, arrow nudge with a selection, `Delete`/`Backspace` selection delete, and the mouse editing. Do NOT remove `isKbInputEnabled` from `clip-kb-input.ts` — Task 3 keeps the toggle as the new module's enable.

- [ ] **Step 4: Run tests + typecheck**

Run: `NO_COLOR=1 npx vitest run <piano-roll test file>` → the regression PASSES and all existing piano-roll editing tests still pass.
Run: `npx tsc --noEmit` → exit 0 (fix any now-unused-import errors surfaced by the removal).

- [ ] **Step 5: Commit**

```bash
git add src/core/pianoroll.ts <piano-roll test file>
git commit -m "refactor(pianoroll): remove unused computer-keyboard typing/record path"
```

---

## Task 3: Wire the module in main.ts + retitle the toggle

**Files:**
- Modify: `src/main.ts` (after the facade + `activeLaneStore` exist, ~line 545+)
- Modify: `src/core/clip-editor-toolbar.ts` (the `⌨ Keys` pill tooltip, ~lines 82-96)

**Interfaces:**
- Consumes: `attachComputerKeyboard` (Task 1); `isKbInputEnabled` (`clip-kb-input.ts`); `activeLaneStore.get()`; `controlFacade`.

- [ ] **Step 1: Wire the module in `main.ts`**

Add the import and, after `controlFacade` and `activeLaneStore` are constructed, call once:

```ts
import { attachComputerKeyboard } from './control/computer-keyboard';
import { isKbInputEnabled } from './core/clip-kb-input';
// ... after controlFacade + activeLaneStore exist:
attachComputerKeyboard({
  facade: controlFacade,
  getActiveLane: () => activeLaneStore.get(),
  isEnabled: isKbInputEnabled,
});
```

(Confirm `activeLaneStore.get()` is the read accessor — `active-lane.ts` defines the store; the mediator already reads it the same way.)

- [ ] **Step 2: Retitle the `⌨ Keys` toggle**

In `src/core/clip-editor-toolbar.ts`, change the pill's `title`/tooltip text (the `isKbInputEnabled() ? ... : ...` strings) to describe the new meaning, e.g. on: `"Computer keyboard plays the active lane live (ASDFG = notes, z/x = octave). Click to turn off."` / off: `"Play the active lane live from the computer keyboard (ASDFG, z/x octave)"`. Keep the `⌨ Keys` label.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run build` → succeeds (catches HTML/bundle issues).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/core/clip-editor-toolbar.ts
git commit -m "feat(control): wire the live computer keyboard + retitle the ⌨ Keys toggle"
```

---

## Task 4: Full suite + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + unit suite**

Run: `npx tsc --noEmit && npm run test:unit` → typecheck clean; unit green (re-run once if `ERR_IPC_CHANNEL_CLOSED`).

- [ ] **Step 2: Build**

Run: `npm run build` → succeeds.

- [ ] **Step 3: Manual verification (Chrome, real browser — no MIDI hardware needed)**

On `http://localhost:5173`:
1. Open a melodic clip; enable the `⌨ Keys` toggle.
2. Press ASDFG → you HEAR the active lane's engine; `z`/`x` shift the octave.
3. Add a chord note-FX to the lane → one key sounds the chord.
4. With nothing playing, press `● Rec`, play a few keys, press `■ Stop` → the clip shows the played (chord-expanded) notes; `↺ Undo` removes them.
5. With another scene already playing, press `● Rec` on a different lane's clip → playback isn't restarted and the played notes land at their real positions.
6. Confirm the old behavior is gone: with `⌨ Keys` on and a clip open, typing letters no longer writes notes into the clip by "typing" — it plays them live instead.

- [ ] **Step 4: Finish**

Commit any fixups, then follow `superpowers:finishing-a-development-branch` (rebase onto main, `git merge --ff-only`, ExitWorktree) — only after the user confirms the audible result.

---

## Self-Review (completed by plan author)

- **Spec coverage:** New live module → Task 1. Reuse mapping/`isTextEditTarget`/`DEFAULT_VELOCITY` → Task 1. Reuse + retitle `⌨ Keys` toggle → Task 3. Remove piano-roll typing → Task 2. Wire in main → Task 3. Tests-no-hardware → Tasks 1-2; manual → Task 4. Out-of-scope (velocity sensitivity, sustain, MIDI profile) not implemented. ✅
- **Placeholder scan:** Task 1 carries complete module + test code. Tasks 2/4 reference the real piano-roll test fixture by "read it first + adapt" because that file's exact fixture must be matched, not guessed — the removal targets are named by their real guards (`isKbInputEnabled()`, `midiForKey`, `heldKeys`). No TBDs. ✅
- **Type consistency:** `attachComputerKeyboard(ComputerKeyboardDeps): () => void` consistent across Tasks 1/3; `getActiveLane`/`isEnabled`/`facade` names match; velocity `DEFAULT_VELOCITY` (90) consistent. ✅
- **Ordering:** module built first (unwired), old path removed, then wired — no window where both typing and live-play fire together. ✅
