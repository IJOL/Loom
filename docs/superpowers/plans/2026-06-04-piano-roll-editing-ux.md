# Piano-roll Editing UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-note selection, an app-wide clipboard (paste at the mouse, cross-clip), group move/delete/nudge, a Pencil/Select tool toggle, and computer-keyboard note input (audition + step-input stopped + real-time record playing) to the piano-roll.

**Architecture:** All non-canvas logic lives in a new pure module `src/core/piano-roll-editing.ts` (key→midi map, marquee hit-test, group-translate clamp, clipboard serialize/paste, record quantize) so it is unit-tested without the DOM. `src/core/pianoroll.ts` grows thin canvas glue around it: a tool toolbar, a selection `Set`, marquee/group pointer handlers branched by tool, clipboard + musical-keyboard key handlers scoped to editor focus. Audition reuses the host's `triggerForLane`, threaded through `ClipEditorDeps`. No persistence/schema change — every new piece of state is ephemeral.

**Tech Stack:** TypeScript, Vite, Vitest (Node, `node-web-audio-api`), Web Audio, Canvas 2D. Tests colour-free via `cross-env NO_COLOR=1` (npm scripts). No linter.

**Spec:** [docs/superpowers/specs/2026-06-04-piano-roll-editing-ux-design.md](../specs/2026-06-04-piano-roll-editing-ux-design.md)

---

## Execution notes (read first)

- **Worktree:** this work is already on branch `feat/piano-roll-editing-ux` in a git worktree
  (the spec commit `106e16f` is here). Commit each task on this branch. At the very end, when green:
  `git rebase main` (literal) → `git merge --ff-only feat/piano-roll-editing-ux` → `ExitWorktree`.
  Run `npm install` in the worktree before the first test run if `node_modules` is missing (do NOT
  junction it).
- **Commits:** every commit message ends with the footer (per repo `CLAUDE.md`):
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Stage only the task's files
  (leave `.vscode/`, `loops/` untracked).
- **Tests:** `NO_COLOR=1 npx vitest run <file>` for one file; `npm run test:unit` for all. A non-zero
  exit with `ERR_IPC_CHANNEL_CLOSED` **after** the summary shows all passing is the known flaky
  teardown — re-run once to confirm.
- **Canvas reality:** the piano-roll is canvas-based and is not unit-tested in this repo. Tasks 3–6
  are verified by `npx tsc --noEmit` + `npm run build` + existing tests staying green + the manual
  smoke in Task 7. The genuinely testable logic is all in Task 1.

## File structure

**Created:**
- `src/core/piano-roll-editing.ts` — pure editing logic (key map, marquee, group-translate, clipboard, quantize).
- `src/core/piano-roll-editing.test.ts` — unit tests for it.

**Modified:**
- `src/core/pianoroll.ts` — toolbar, selection state, marquee + group handlers, clipboard + keyboard handlers, highlight + cursor drawing, new opts (`auditionNote?`).
- `src/session/clip-editors/clip-editor-router.ts` — build the `auditionNote` closure; pass it into `createPianoRoll`.
- `src/session/session-inspector.ts` — add optional `triggerForLane` to `InspectorDeps`; forward it into `ClipEditorDeps`.
- `src/session/session-host.ts` — pass `this.deps.triggerForLane` when constructing the inspector.

**No** saved-state / schema / migration changes.

---

## Task 1: Pure editing module + tests

**Files:**
- Create: `src/core/piano-roll-editing.ts`
- Test: `src/core/piano-roll-editing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/piano-roll-editing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  keyToSemitone, midiForKey, notesInRect, translateGroup,
  serializeClipboard, pasteTranslate, quantizeRecorded,
} from './piano-roll-editing';
import type { NoteEvent } from './notes';

const N = (start: number, midi: number, duration = 24, velocity = 80): NoteEvent => ({ start, midi, duration, velocity });
const BOUNDS = { patternTicks: 384, minMidi: 36, maxMidi: 96 };

describe('keyboard map', () => {
  it('maps home row to white keys and upper row to black keys', () => {
    expect(keyToSemitone('a')).toBe(0);
    expect(keyToSemitone('w')).toBe(1);
    expect(keyToSemitone('k')).toBe(12);
    expect(keyToSemitone('A')).toBe(0); // case-insensitive
    expect(keyToSemitone('q')).toBeNull(); // unused
    expect(keyToSemitone('1')).toBeNull();
  });
  it('midiForKey adds the octave base', () => {
    expect(midiForKey('a', 60)).toBe(60);
    expect(midiForKey('w', 60)).toBe(61);
    expect(midiForKey('k', 60)).toBe(72);
    expect(midiForKey('z', 60)).toBeNull(); // z/x are octave shifts, not notes
  });
});

describe('notesInRect', () => {
  it('selects notes whose body intersects the rect (order-independent corners)', () => {
    const notes = [N(0, 60), N(48, 64), N(120, 72)];
    const hit = notesInRect(notes, { tick0: 60, tick1: 10, midi0: 66, midi1: 58 });
    expect(hit).toEqual([notes[0], notes[1]]); // midi 58..66 and ticks 10..60 — note[1] starts at 48, inside
  });
  it('excludes notes outside the pitch band', () => {
    const notes = [N(0, 60), N(0, 90)];
    expect(notesInRect(notes, { tick0: 0, tick1: 24, midi0: 58, midi1: 62 })).toEqual([notes[0]]);
  });
});

describe('translateGroup clamp', () => {
  it('clamps a leftward move so the earliest note stops at tick 0', () => {
    const g = [N(24, 60), N(48, 64)];
    expect(translateGroup(g, -100, 0, BOUNDS).dTick).toBe(-24);
  });
  it('clamps pitch so the top note stops at maxMidi', () => {
    const g = [N(0, 90), N(0, 84)];
    expect(translateGroup(g, 0, 100, BOUNDS).dMidi).toBe(6); // 96 - 90
  });
  it('passes a delta through when it stays in bounds', () => {
    expect(translateGroup([N(48, 60)], 24, 2, BOUNDS)).toEqual({ dTick: 24, dMidi: 2 });
  });
});

describe('clipboard round-trip', () => {
  it('serializes relative to the earliest start and pastes anchored to the mouse', () => {
    const sel = [N(48, 60), N(72, 67)];
    const clip = serializeClipboard(sel);
    expect(clip[0].dStart).toBe(0);
    expect(clip[1].dStart).toBe(24);
    const pasted = pasteTranslate(clip, 100, 62, BOUNDS);
    expect(pasted[0]).toMatchObject({ start: 100, midi: 62 });
    expect(pasted[1]).toMatchObject({ start: 124, midi: 69 }); // +24 tick, +7 semitone preserved
  });
  it('clamps a paste that runs past the pattern end back inside', () => {
    const clip = serializeClipboard([N(0, 60, 48)]);
    const pasted = pasteTranslate(clip, 380, 60, BOUNDS); // 380+48 = 428 > 384
    expect(pasted[0].start).toBe(336); // 384 - 48
  });
});

describe('quantizeRecorded', () => {
  it('snaps start and rounds duration to at least one snap', () => {
    expect(quantizeRecorded(50, 60, 24)).toEqual({ start: 48, duration: 24 });
    expect(quantizeRecorded(0, 60, 24)).toEqual({ start: 0, duration: 72 }); // 60→round(2.5)=72? see note
  });
});
```

> Note on the second `quantizeRecorded` case: `round(60/24)=round(2.5)=3` → `3*24=72`. If your
> implementation uses `Math.round` with banker's rounding concerns, keep plain `Math.round`; JS
> `Math.round(2.5)===3`. Adjust the expectation only if you deliberately choose `Math.max(snap,
> Math.round(...))` differently — but match the test to the impl in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/piano-roll-editing.test.ts`
Expected: FAIL — `Failed to resolve import "./piano-roll-editing"`.

- [ ] **Step 3: Write the module**

Create `src/core/piano-roll-editing.ts`:

```ts
// Pure, DOM-free logic for the piano-roll editing UX (Spec 2): the computer-
// keyboard note map, marquee hit-testing, group-move clamping, clipboard
// serialize/paste, and recorded-note quantization. pianoroll.ts is thin canvas
// glue around these.

import type { NoteEvent } from './notes';

// Standard piano-typing layout: home row a s d f g h j k = white C D E F G A B C;
// upper row w e t y u = black C# D# F# G# A#. Other keys are unused.
const KEY_SEMITONES: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};

export function keyToSemitone(key: string): number | null {
  const s = KEY_SEMITONES[key.toLowerCase()];
  return s === undefined ? null : s;
}

export function midiForKey(key: string, octaveBase: number): number | null {
  const semi = keyToSemitone(key);
  return semi === null ? null : octaveBase + semi;
}

export interface GridRect { tick0: number; tick1: number; midi0: number; midi1: number; }

/** Notes whose body intersects the rect (corners may be given in any order). */
export function notesInRect(notes: readonly NoteEvent[], rect: GridRect): NoteEvent[] {
  const t0 = Math.min(rect.tick0, rect.tick1), t1 = Math.max(rect.tick0, rect.tick1);
  const m0 = Math.min(rect.midi0, rect.midi1), m1 = Math.max(rect.midi0, rect.midi1);
  return notes.filter((n) =>
    n.midi >= m0 && n.midi <= m1 && n.start < t1 && n.start + n.duration > t0);
}

export interface Bounds { patternTicks: number; minMidi: number; maxMidi: number; }

/** Clamp a desired (dTick,dMidi) so EVERY note stays in bounds; preserves shape.
 *  Also serves to pull an already-out-of-bounds group back in (pass 0,0). */
export function translateGroup(
  notes: readonly NoteEvent[], dTick: number, dMidi: number, b: Bounds,
): { dTick: number; dMidi: number } {
  if (notes.length === 0) return { dTick: 0, dMidi: 0 };
  let minStart = Infinity, maxEnd = -Infinity, minMidi = Infinity, maxMidi = -Infinity;
  for (const n of notes) {
    minStart = Math.min(minStart, n.start);
    maxEnd = Math.max(maxEnd, n.start + n.duration);
    minMidi = Math.min(minMidi, n.midi);
    maxMidi = Math.max(maxMidi, n.midi);
  }
  const loT = -minStart, hiT = b.patternTicks - maxEnd;
  const loM = b.minMidi - minMidi, hiM = b.maxMidi - maxMidi;
  return {
    dTick: Math.max(loT, Math.min(hiT, dTick)),
    dMidi: Math.max(loM, Math.min(hiM, dMidi)),
  };
}

export interface ClipboardNote { dStart: number; midi: number; duration: number; velocity: number; }

/** Snapshot selected notes relative to the group's earliest start. */
export function serializeClipboard(selected: readonly NoteEvent[]): ClipboardNote[] {
  if (selected.length === 0) return [];
  const minStart = Math.min(...selected.map((n) => n.start));
  return selected.map((n) => ({
    dStart: n.start - minStart, midi: n.midi, duration: n.duration, velocity: n.velocity,
  }));
}

/** Build fresh notes anchored so the earliest clipboard note lands at
 *  (anchorTick, anchorMidi); the rest keep their relative offsets. Clamped. */
export function pasteTranslate(
  clip: readonly ClipboardNote[], anchorTick: number, anchorMidi: number, b: Bounds,
): NoteEvent[] {
  if (clip.length === 0) return [];
  const ref = clip.find((n) => n.dStart === 0) ?? clip[0];
  const built: NoteEvent[] = clip.map((n) => ({
    start: anchorTick + n.dStart,
    duration: n.duration,
    midi: anchorMidi + (n.midi - ref.midi),
    velocity: n.velocity,
  }));
  const adj = translateGroup(built, 0, 0, b);
  return built.map((n) => ({ ...n, start: n.start + adj.dTick, midi: n.midi + adj.dMidi }));
}

/** Snap a recorded note (keydown→keyup ticks) to the grid, min one snap long. */
export function quantizeRecorded(startTick: number, endTick: number, snap: number): { start: number; duration: number } {
  const start = Math.max(0, Math.round(startTick / snap) * snap);
  const rawDur = Math.max(0, endTick - startTick);
  const duration = Math.max(snap, Math.round(rawDur / snap) * snap);
  return { start, duration };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/piano-roll-editing.test.ts`
Expected: PASS (all groups green).

- [ ] **Step 5: Commit**

```bash
git add src/core/piano-roll-editing.ts src/core/piano-roll-editing.test.ts
git commit -m "feat(piano-roll): pure editing logic module + tests"
```

---

## Task 2: Audition wiring (thread `triggerForLane` to the editor)

**Files:**
- Modify: `src/session/session-host.ts:178-181` (inspector construction)
- Modify: `src/session/session-inspector.ts` (`InspectorDeps` + `editorDeps`)
- Modify: `src/session/clip-editors/clip-editor-router.ts` (build `auditionNote`)
- Modify: `src/core/pianoroll.ts` (`PianoRollOpts.auditionNote?`)

No new behavior yet — this only makes `auditionNote` reachable. Verified by typecheck + existing tests.

- [ ] **Step 1: Add the optional opt to `PianoRollOpts`**

In `src/core/pianoroll.ts`, in `PianoRollOpts` (after `onGestureCancel?: () => void;`):

```ts
  /** Live-preview a pitch when typing/recording from the computer keyboard. */
  auditionNote?: (midi: number) => void;
```

- [ ] **Step 2: Add optional `triggerForLane` to `InspectorDeps`**

In `src/session/session-inspector.ts`, in `InspectorDeps` (after `rootSel?: HTMLSelectElement;`):

```ts
  /** Host note trigger, used to audition pitches from the keyboard editor.
   *  Optional so test fixtures without an audio graph still compile. */
  triggerForLane?: (laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => void;
```

- [ ] **Step 3: Add it to `ClipEditorDeps` and forward it**

In `src/session/clip-editors/clip-editor-router.ts`, in `ClipEditorDeps` (after `historyDeps?: HistoryDeps;`):

```ts
  triggerForLane?: (laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => void;
```

In `buildPianoRoll`, change the destructure and add the `auditionNote` opt to the `createPianoRoll`
call. Replace:

```ts
  const { ctx, seq, laneStates, historyDeps } = deps;
```

with:

```ts
  const { ctx, seq, laneStates, historyDeps, triggerForLane } = deps;
  const AUDITION_GATE = 0.25; // seconds — a short preview blip
```

and add this opt to the `createPianoRoll({ ... })` object (e.g. right after `onChange: () => {},`):

```ts
    auditionNote: triggerForLane
      ? (midi: number) => triggerForLane(lane.id, midi, ctx.currentTime, AUDITION_GATE, false, false)
      : undefined,
```

- [ ] **Step 4: Forward `triggerForLane` from the inspector into `editorDeps`**

In `src/session/session-inspector.ts`, find where `editorDeps: ClipEditorDeps` is built (in
`renderEditor`) and add the field. The object currently lists
`ctx, seq, laneStates, midiLabel, historyDeps`; add:

```ts
      triggerForLane: this.deps.triggerForLane,
```

- [ ] **Step 5: Pass `triggerForLane` when the host builds the inspector**

In `src/session/session-host.ts`, the `this.inspector = new SessionInspector({ ... })` literal
(around line 178) lists `ctx`, `seq`, `state`, … Add:

```ts
      triggerForLane: this.deps.triggerForLane,
```

- [ ] **Step 6: Typecheck + existing tests**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `NO_COLOR=1 npx vitest run src/session/session-inspector` (and any clip-editor tests)
Expected: PASS (the new fields are optional; nothing changed behaviorally).

- [ ] **Step 7: Commit**

```bash
git add src/core/pianoroll.ts src/session/clip-editors/clip-editor-router.ts src/session/session-inspector.ts src/session/session-host.ts
git commit -m "feat(piano-roll): thread triggerForLane through to an auditionNote opt"
```

---

## Task 3: Tool toggle + selection (marquee, click, highlight)

**Files:**
- Modify: `src/core/pianoroll.ts`

Wiring task; verified by tsc/build + existing tests + Task 7 smoke. Imports the Task 1 module.

- [ ] **Step 1: Import the pure module + add module-level tool/clipboard state**

At the top of `src/core/pianoroll.ts`, after the existing imports, add:

```ts
import {
  notesInRect, translateGroup, serializeClipboard, pasteTranslate, midiForKey,
  quantizeRecorded, type ClipboardNote,
} from './piano-roll-editing';
import { isTextEditTarget } from '../save/history-wiring';

type Tool = 'draw' | 'select';
// Module-level so the tool choice + clipboard persist across clip re-opens and clips.
let currentTool: Tool = 'draw';
let clipboard: ClipboardNote[] | null = null;
```

- [ ] **Step 2: Add a toolbar above the frame**

In `buildEditorFrame`, the function returns the frame structure. Add a toolbar element ABOVE the
grid frame and return it. At the end of `buildEditorFrame`, before `return { ... }`, wrap the frame
in a column container with a toolbar. Replace:

```ts
  frame.append(corner, rulerWrap, keysWrap, gridVp);
  host.appendChild(frame);

  return { frame, rulerWrap, keysWrap, gridVp, rulerCanvas, keysCanvas, gridCanvas };
```

with:

```ts
  frame.append(corner, rulerWrap, keysWrap, gridVp);

  const toolbar = document.createElement('div');
  toolbar.className = 'pr-toolbar';
  Object.assign(toolbar.style, { display: 'flex', gap: '6px', alignItems: 'center', padding: '4px 2px' } as Partial<CSSStyleDeclaration>);

  const wrap = document.createElement('div');
  wrap.tabIndex = 0; // focusable, so the keyboard handler can target it
  wrap.style.outline = 'none';
  wrap.append(toolbar, frame);
  host.appendChild(wrap);

  return { frame, wrap, toolbar, rulerWrap, keysWrap, gridVp, rulerCanvas, keysCanvas, gridCanvas };
```

Add `wrap` and `toolbar` to the `PianoRollFrame` interface:

```ts
export interface PianoRollFrame {
  frame: HTMLDivElement;
  wrap: HTMLDivElement; toolbar: HTMLDivElement;
  rulerWrap: HTMLDivElement; keysWrap: HTMLDivElement; gridVp: HTMLDivElement;
  rulerCanvas: HTMLCanvasElement; keysCanvas: HTMLCanvasElement; gridCanvas: HTMLCanvasElement;
}
```

- [ ] **Step 3: Build the toolbar buttons + octave readout in `createPianoRoll`**

In `createPianoRoll`, right after `const f = buildEditorFrame(opts.host);`, add (octaveBase is
defined here for use by Task 6):

```ts
  let octaveBase = Math.max(minMidi, Math.min(maxMidi - 12, 60)); // C4 default, clamped
  const selection = new Set<NoteEvent>();

  const drawBtn = document.createElement('button');
  drawBtn.textContent = '✏ Draw';
  const selBtn = document.createElement('button');
  selBtn.textContent = '▭ Select';
  const octLabel = document.createElement('span');
  octLabel.style.cssText = 'margin-left:auto;font:11px ui-monospace,monospace;color:#9a9a9a';
  const refreshToolbar = () => {
    drawBtn.style.fontWeight = currentTool === 'draw' ? '700' : '400';
    selBtn.style.fontWeight  = currentTool === 'select' ? '700' : '400';
    octLabel.textContent = `oct: C${Math.floor(octaveBase / 12) - 1}`;
  };
  drawBtn.addEventListener('click', () => { currentTool = 'draw'; refreshToolbar(); });
  selBtn.addEventListener('click', () => { currentTool = 'select'; refreshToolbar(); });
  f.toolbar.append(drawBtn, selBtn, octLabel);
  refreshToolbar();
```

- [ ] **Step 4: Draw selection highlight + marquee in `drawGrid`**

In `drawGrid`, replace the note-drawing loop:

```ts
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const x = xForTick(n.start), x2 = xForTick(n.start + n.duration), y = yForMidi(n.midi);
      gctx.fillStyle = n.velocity >= 100 ? '#ffaa44' : '#3498db';
      gctx.fillRect(x + 1, y + 1, Math.max(2, x2 - x - 2), rowHeight - 2);
      gctx.strokeStyle = '#0a0a0a'; gctx.strokeRect(x + 0.5, y + 0.5, x2 - x - 1, rowHeight - 1);
    }
```

with:

```ts
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const x = xForTick(n.start), x2 = xForTick(n.start + n.duration), y = yForMidi(n.midi);
      const sel = selection.has(n);
      gctx.fillStyle = sel ? '#7fd4ff' : (n.velocity >= 100 ? '#ffaa44' : '#3498db');
      gctx.fillRect(x + 1, y + 1, Math.max(2, x2 - x - 2), rowHeight - 2);
      gctx.strokeStyle = sel ? '#ffffff' : '#0a0a0a';
      gctx.lineWidth = sel ? 1.5 : 1;
      gctx.strokeRect(x + 0.5, y + 0.5, x2 - x - 1, rowHeight - 1);
      gctx.lineWidth = 1;
    }
    if (marquee) {
      const x = xForTick(Math.min(marquee.tick0, marquee.tick1));
      const w = Math.abs(xForTick(marquee.tick1) - xForTick(marquee.tick0));
      const yTop = yForMidi(Math.max(marquee.midi0, marquee.midi1));
      const yBot = yForMidi(Math.min(marquee.midi0, marquee.midi1)) + rowHeight;
      gctx.strokeStyle = '#7fd4ff'; gctx.setLineDash([4, 3]);
      gctx.strokeRect(x + 0.5, yTop + 0.5, Math.max(1, w), Math.max(1, yBot - yTop));
      gctx.setLineDash([]);
    }
```

Declare `marquee` near the other interaction state (after `let interaction ...`):

```ts
  let marquee: { tick0: number; midi0: number; tick1: number; midi1: number } | null = null;
  let groupDrag: { lastTick: number; lastMidi: number } | null = null;
  let lastMouse: { tick: number; midi: number } | null = null;
  // Insertion cursor (ticks): paste fallback (Task 5) + step input (Task 6). Declared
  // HERE — before the initial-mount layoutAll()/drawGrid() — because Task 6 makes
  // drawGrid read it; a later declaration would hit its TDZ on first render.
  let cursorTick = 0;
```

- [ ] **Step 5: Branch the grid pointer handlers by tool**

Wrap the current `pointerdown` body in a draw-mode guard and add the select-mode branch. Replace the
opening of the `f.gridCanvas.addEventListener('pointerdown', (e) => {` handler — change its first
lines so that after computing `{ tick, midi }` it dispatches:

```ts
  f.gridCanvas.addEventListener('pointerdown', (e) => {
    const { tick, midi } = pointerPos(e);
    f.wrap.focus();

    if (currentTool === 'select' && !(e.altKey || e.button === 2)) {
      const hit = findNoteAt(tick, midi);
      if (hit) {
        if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
        else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
        groupDrag = { lastTick: Math.floor(tick / snap) * snap, lastMidi: midi };
        opts.onGestureStart?.(); gestureMutated = false;
      } else {
        if (!e.shiftKey) selection.clear();
        marquee = { tick0: tick, midi0: midi, tick1: tick, midi1: midi };
      }
      f.gridCanvas.setPointerCapture(e.pointerId);
      drawGrid(); e.preventDefault();
      return;
    }
    // ── draw mode (and alt/right-click delete in any mode) ──
    // ... existing body unchanged from here ...
```

(Keep the entire existing draw-mode body that follows — the `if (e.altKey || e.button === 2)` delete
block and the create/move/resize logic — exactly as it is.)

- [ ] **Step 6: Handle marquee + group drag in `pointermove`, finalize in `pointerup`**

At the very top of the existing `f.gridCanvas.addEventListener('pointermove', (e) => {` handler,
before the `if (!interaction)` line, add:

```ts
    { const p = pointerPos(e); lastMouse = { tick: p.tick, midi: p.midi }; }
    if (marquee) {
      const p = pointerPos(e); marquee.tick1 = p.tick; marquee.midi1 = p.midi;
      drawGrid(); return;
    }
    if (groupDrag) {
      const p = pointerPos(e);
      const wantTick = Math.floor(p.tick / snap) * snap;
      const dTick = wantTick - groupDrag.lastTick;
      const dMidi = p.midi - groupDrag.lastMidi;
      if (dTick !== 0 || dMidi !== 0) {
        const sel = [...selection];
        const adj = translateGroup(sel, dTick, dMidi, { patternTicks: opts.patternTicks, minMidi, maxMidi });
        for (const n of sel) { n.start += adj.dTick; n.midi += adj.dMidi; }
        groupDrag.lastTick += adj.dTick; groupDrag.lastMidi += adj.dMidi;
        gestureMutated = true; drawGrid(); opts.onChange?.();
      }
      return;
    }
```

In the existing `endDrag` (`pointerup`/`pointercancel`) handler, add marquee/group finalization at
the top of the function body, before `if (!interaction) return;`:

```ts
    if (marquee) {
      for (const n of notesInRect(opts.getNotes(), marquee)) selection.add(n);
      marquee = null;
      try { f.gridCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      drawGrid();
      return;
    }
    if (groupDrag) {
      groupDrag = null;
      try { f.gridCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (gestureMutated) opts.onGestureEnd?.(); else opts.onGestureCancel?.();
      return;
    }
```

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success.

- [ ] **Step 8: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(piano-roll): Pencil/Select tool toggle + marquee selection"
```

---

## Task 4: Group delete, select-all, Esc, arrow nudge

**Files:**
- Modify: `src/core/pianoroll.ts`

- [ ] **Step 1: Add a focus-scoped keydown handler skeleton**

In `createPianoRoll`, after the grid pointer handlers, add a keydown handler on `f.wrap`. It guards
text-edit targets, consumes keys it handles, and (for now) implements selection commands:

```ts
  const bounds = () => ({ patternTicks: opts.patternTicks, minMidi, maxMidi });

  f.wrap.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return; // per spec §6: native text editing wins
    const cmd = e.metaKey || e.ctrlKey;

    // Contain Delete/Backspace to the editor so a stray one can NEVER bubble to the
    // inspector's document-level clip-delete (session-inspector wireKeyboardShortcuts).
    // The branches below act on notes/cursor when there's something to do; otherwise
    // this makes the key a no-op here instead of deleting the whole clip.
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();

    // Tool toggle
    if (!cmd && e.key === '1') { currentTool = 'draw'; refreshToolbar(); e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; refreshToolbar(); e.preventDefault(); return; }

    // Select all
    if (cmd && e.key.toLowerCase() === 'a') {
      selection.clear(); for (const n of opts.getNotes()) selection.add(n);
      drawGrid(); e.preventDefault(); return;
    }
    // Clear selection
    if (e.key === 'Escape') { selection.clear(); drawGrid(); e.preventDefault(); return; }

    // Delete selection
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
      opts.onGestureStart?.();
      opts.setNotes(opts.getNotes().filter((n) => !selection.has(n)));
      selection.clear();
      opts.onChange?.(); drawGrid(); opts.onGestureEnd?.();
      e.preventDefault(); e.stopPropagation(); return;
    }

    // Arrow nudge of the selection
    if (selection.size > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const dTick = e.key === 'ArrowRight' ? snap : e.key === 'ArrowLeft' ? -snap : 0;
      const dMidi = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      const sel = [...selection];
      const adj = translateGroup(sel, dTick, dMidi, bounds());
      if (adj.dTick || adj.dMidi) {
        opts.onGestureStart?.();
        for (const n of sel) { n.start += adj.dTick; n.midi += adj.dMidi; }
        opts.onChange?.(); drawGrid(); opts.onGestureEnd?.();
      }
      e.preventDefault(); return;
    }
  });
```

> The `e.stopPropagation()` on Delete is critical: it prevents the inspector's clip-delete handler
> ([session-inspector.ts](../../../src/session/session-inspector.ts) `wireKeyboardShortcuts`) from
> also deleting the whole clip when the editor is focused.

- [ ] **Step 2: Typecheck + build + existing tests**

Run: `npx tsc --noEmit` → no errors. `npm run build` → success.
Run: `npm run test:unit` → green (re-run once if `ERR_IPC_CHANNEL_CLOSED`).

- [ ] **Step 3: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(piano-roll): delete/select-all/esc/arrow-nudge for the selection"
```

---

## Task 5: Clipboard — copy / cut / paste at mouse

**Files:**
- Modify: `src/core/pianoroll.ts`

- [ ] **Step 1: Add copy/cut/paste to the keydown handler**

Inside the `f.wrap` keydown handler from Task 4, add these branches (place them just after the
`Select all` branch):

```ts
    // Copy
    if (cmd && e.key.toLowerCase() === 'c' && selection.size > 0) {
      clipboard = serializeClipboard([...selection]);
      e.preventDefault(); return;
    }
    // Cut
    if (cmd && e.key.toLowerCase() === 'x' && selection.size > 0) {
      clipboard = serializeClipboard([...selection]);
      opts.onGestureStart?.();
      opts.setNotes(opts.getNotes().filter((n) => !selection.has(n)));
      selection.clear();
      opts.onChange?.(); drawGrid(); opts.onGestureEnd?.();
      e.preventDefault(); return;
    }
    // Paste at the mouse (snapped); fall back to insertion cursor / 0.
    if (cmd && e.key.toLowerCase() === 'v' && clipboard && clipboard.length) {
      const anchorTick = Math.floor((lastMouse?.tick ?? cursorTick) / snap) * snap;
      const anchorMidi = lastMouse?.midi ?? octaveBase;
      const pasted = pasteTranslate(clipboard, anchorTick, anchorMidi, bounds());
      opts.onGestureStart?.();
      const notes = opts.getNotes();
      for (const n of pasted) notes.push(n);
      selection.clear(); for (const n of pasted) selection.add(n);
      opts.onChange?.(); drawGrid(); opts.onGestureEnd?.();
      e.preventDefault(); return;
    }
```

This references `cursorTick` (the insertion cursor) and `bounds()`. `cursorTick` is already declared
in **Task 3 Step 4** (with `marquee`/`groupDrag`/`lastMouse`, before the initial-mount `layoutAll()`);
`bounds()` is declared in Task 4 Step 1. No new declaration is needed here.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` → no errors. `npm run build` → success.

- [ ] **Step 3: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(piano-roll): app-wide clipboard — copy/cut/paste at the mouse"
```

---

## Task 6: Computer-keyboard note input (audition + step + record)

**Files:**
- Modify: `src/core/pianoroll.ts`

- [ ] **Step 1: Add octave keys + insertion-cursor drawing**

Add the insertion cursor to `drawGrid` — after the playhead block, draw a distinct cursor line:

```ts
    {
      const cx = xForTick(cursorTick);
      gctx.strokeStyle = '#39d98a'; gctx.setLineDash([2, 2]);
      gctx.beginPath(); gctx.moveTo(cx, 0); gctx.lineTo(cx, gridH); gctx.stroke();
      gctx.setLineDash([]);
    }
```

In the `f.wrap` keydown handler, add octave shift + cursor movement (place before the musical-note
branch in Step 2):

```ts
    // Octave shift
    if (!cmd && (e.key === 'z' || e.key === 'x')) {
      octaveBase = Math.max(minMidi, Math.min(maxMidi - 12, octaveBase + (e.key === 'x' ? 12 : -12)));
      refreshToolbar(); e.preventDefault(); return;
    }
    // Move insertion cursor when nothing is selected
    if (selection.size === 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      cursorTick = Math.max(0, Math.min(opts.patternTicks - snap, cursorTick + (e.key === 'ArrowRight' ? snap : -snap)));
      drawGrid(); e.preventDefault(); return;
    }
```

- [ ] **Step 2: Add musical-note input (audition + step / record)**

Add the note state near the other state declarations:

```ts
  const heldKeys = new Map<string, { midi: number; startTick: number }>();
```

Then add the musical-note branches to the `f.wrap` keydown handler (after the octave branch). Note:
guard `e.repeat` so auto-repeat doesn't spam:

```ts
    if (!cmd) {
      const midi = midiForKey(e.key, octaveBase);
      if (midi !== null && midi >= minMidi && midi <= maxMidi) {
        e.preventDefault();
        if (e.repeat || heldKeys.has(e.key.toLowerCase())) return;
        opts.auditionNote?.(midi);
        const playing = (opts.getPlayheadTick?.() ?? -1) >= 0;
        if (playing) {
          // Real-time record: remember the start; the note is written + wrapped
          // in its own undo gesture on keyup (avoids nesting gestures when
          // several keys are held at once).
          const startTick = opts.getPlayheadTick?.() ?? 0;
          heldKeys.set(e.key.toLowerCase(), { midi, startTick });
        } else {
          // Step input: write at the cursor, advance after all keys release.
          heldKeys.set(e.key.toLowerCase(), { midi, startTick: cursorTick });
          opts.onGestureStart?.();
          opts.getNotes().push({ start: cursorTick, duration: snap, midi, velocity: 80 });
          opts.onChange?.(); drawGrid(); opts.onGestureEnd?.();
        }
        return;
      }
      // Step-input backspace: delete last inserted note + step back (no selection)
      if (e.key === 'Backspace' && selection.size === 0) {
        const notes = opts.getNotes();
        const atCursor = notes.filter((n) => n.start === Math.max(0, cursorTick - snap));
        if (atCursor.length) {
          opts.onGestureStart?.();
          opts.setNotes(notes.filter((n) => n.start !== Math.max(0, cursorTick - snap)));
          cursorTick = Math.max(0, cursorTick - snap);
          opts.onChange?.(); drawGrid(); opts.onGestureEnd?.();
        }
        e.preventDefault(); return;
      }
    }
```

Add a `keyup` handler on `f.wrap` to close held notes (record duration) and advance the step cursor:

```ts
  f.wrap.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const held = heldKeys.get(k);
    if (!held) return;
    heldKeys.delete(k);
    const playing = (opts.getPlayheadTick?.() ?? -1) >= 0;
    if (playing) {
      const endTick = opts.getPlayheadTick?.() ?? held.startTick;
      const q = quantizeRecorded(held.startTick, endTick < held.startTick ? held.startTick + snap : endTick, snap);
      opts.onGestureStart?.();
      opts.getNotes().push({ start: q.start, duration: q.duration, midi: held.midi, velocity: 80 });
      opts.onChange?.(); drawGrid(); opts.onGestureEnd?.();
    } else if (heldKeys.size === 0) {
      // All step-input keys released → advance the cursor one step (chord = one advance).
      cursorTick = Math.min(opts.patternTicks - snap, cursorTick + snap);
      drawGrid();
    }
  });
```

> Chord behavior: in step input, each keydown writes its note at the same `cursorTick`; the cursor
> only advances when the **last** held key is released (`heldKeys.size === 0`).

- [ ] **Step 3: Typecheck + build + existing tests**

Run: `npx tsc --noEmit` → no errors. `npm run build` → success.
Run: `npm run test:unit` → green (re-run once if `ERR_IPC_CHANNEL_CLOSED`).

- [ ] **Step 4: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(piano-roll): computer-keyboard note input (audition + step + record)"
```

---

## Task 7: Final gate + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success.
Run: `npm run test:unit` → all green (re-run once if `ERR_IPC_CHANNEL_CLOSED` on teardown).

- [ ] **Step 2: Manual smoke (dev server)**

`npm run dev`, open <http://localhost:5173>, open a melodic clip's piano-roll, and verify:
1. **Pencil** mode (default) is unchanged: drag empty creates+resizes, drag moves, edge resizes, alt/right-click deletes.
2. Press `2` (or click ▭ Select): drag empty draws a marquee; releasing selects the enclosed notes (highlighted). **Shift+drag** adds. Click a note selects it; **Shift+click** toggles. Click empty / **Esc** clears. **Ctrl/Cmd+A** selects all.
3. Drag a selected note → the whole selection moves together, clamped at edges. **Delete** removes the selection (one undo); the clip itself is NOT deleted. Arrow keys nudge (←→ a step, ↑↓ a semitone).
4. **Ctrl/Cmd+C** then move the mouse over the grid and **Ctrl/Cmd+V** → the group pastes at the mouse, becomes selected. **Ctrl/Cmd+X** cuts. Paste into a **different** clip works (app-wide clipboard).
5. Focus the editor; with transport **stopped**, type `a s d f g h j k` → a C-major run appears at the cursor and advances; `w e t y u` add black keys; `z`/`x` shift octave (toolbar readout updates); each key sounds. **Backspace** removes the last + steps back. Hold a chord → advances once on release.
6. Press play; type keys → notes record at the playhead, quantized; they sound. Stop.
7. Undo (Ctrl+Z) reverses each editing action.

- [ ] **Step 3: Finish the branch**

When all green and smoke-verified:

```bash
git rebase main
git merge --ff-only feat/piano-roll-editing-ux   # run from main after checkout, per the repo flow
```

Then `ExitWorktree`. (The merge/cleanup is the operator's final step — see Execution notes.)

---

## Self-review (completed by plan author)

**Spec coverage:**
- Pencil/Select toggle (default Draw, keys 1/2) → Task 3 + Task 4 Step 1. ✓
- Marquee + click + shift-add + select-all + esc + highlight → Tasks 3, 4. ✓
- Group move (clamped) + delete + arrow nudge → Tasks 3, 4. ✓
- App-wide clipboard, paste at mouse, cross-clip → Task 5 (+ `lastMouse` in Task 3). ✓
- Keyboard input: standard layout, z/x octave, audition, step-input + cursor, real-time record, chord → Tasks 2 (audition wiring) + 6. ✓
- Pure testable logic in `piano-roll-editing.ts` → Task 1. ✓
- No saved-state change → confirmed (all state is module/instance-level). ✓
- Key scoping vs global undo / clip-delete → Task 4 Step 1, top of the `f.wrap` keydown handler: an
  `isTextEditTarget` guard (spec §6) **and** an unconditional `stopPropagation` for ALL
  Delete/Backspace, so neither selection-delete, step-input Backspace, nor a stray empty-selection
  Delete can bubble to the inspector's document-level clip-delete. Musical keys are bare letters;
  undo stays Ctrl+Z (not stopped). ✓

**Type consistency:** `Tool`, `currentTool`, `clipboard: ClipboardNote[] | null`, `selection:
Set<NoteEvent>`, `marquee`, `groupDrag`, `lastMouse`, `cursorTick`, `octaveBase`, `heldKeys` are each
declared once and reused. `notesInRect`/`translateGroup`/`serializeClipboard`/`pasteTranslate`/
`midiForKey`/`quantizeRecorded` signatures match Task 1. `PianoRollFrame` gains `wrap`/`toolbar`;
`PianoRollOpts` gains `auditionNote?`; `ClipEditorDeps`/`InspectorDeps` gain optional
`triggerForLane` — all additive/optional so existing callers and tests compile unchanged.

**Placeholder scan:** none — every code step is complete (the earlier illustrative endDrag block in
Task 3 Step 6 was replaced with the clean version).

**Ordering note:** `cursorTick` is declared in **Task 3 Step 4** (with `marquee`/`groupDrag`/
`lastMouse`), which lands it BEFORE the initial-mount `layoutAll()`/`drawGrid()` at
`pianoroll.ts:391` — required because Task 6 makes `drawGrid` read it (a later `let` would hit its
TDZ on first render). `octaveBase`/`selection` are in Task 3 Step 3; `bounds()` in Task 4 Step 1;
`heldKeys` in Task 6 Step 2. Executing strictly in order, each symbol exists before use.

## Post-review hardening (adversarial workflow, 8 findings → 6 real)

A 4-dimension adversarial review (+ per-finding verification against the real source) caught these,
now folded in above:

- **[blocker]** Task 1's first `notesInRect` test asserted two notes but the (correct) impl returns
  one — the note at tick 48 lay outside the rect's 10..40 span. Fixed: widened the rect to ticks
  10..60 so the two-note intent holds.
- **[major×2]** A focused-editor `Delete` with an empty selection, and step-input `Backspace`, both
  fell through and bubbled to the inspector's document-level handler → **whole-clip deletion**. Fixed:
  one top-of-handler `if (Delete||Backspace) stopPropagation()` guard.
- **[minor]** Spec §6's `isTextEditTarget` guard was missing → added (import + first line).
- **[minor]** `cursorTick` declaration ordering vs the initial-mount `drawGrid` (TDZ) → pinned to
  Task 3 Step 4.
- **[nit]** dead `startTime` field on `heldKeys` → removed.
