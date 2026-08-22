# Progression Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write your own chord progression instead of picking one of six — a strip of chord cells under WEAVE's flow row, editable by hand.

**Architecture:** The catalogue stops being the only input. `WeaveState.chords` holds a written progression; present, it wins over `progression` and the dropdown reads **Custom**. Every reader asks one accessor rather than the field, so the two inputs can never disagree. The edits are four pure functions over `Chord[]`, exposed to the panel through the SDK because the panel is compiled separately and cannot hold the maths.

**Tech Stack:** TypeScript, Vitest, Vite. The WEAVE panel is an external plugin compiled by `npm run build:plugins`.

## Global Constraints

- **Spec:** section 2 of `docs/superpowers/specs/2026-08-10-harmony-that-moves-design.md`. Sections 1 (the harmoniser) and 3 (scales per slot) are NOT this plan.
- **Degrees, never notes.** `Chord` is `{ degree, bars }` and a progression survives a change of key and mode. Roman numerals are display only — `plugins/weave/main.ts:462` already converts them; do not write a second converter.
- **The catalogue is a shelf of starting points and must stay undamaged.** Editing a catalogue entry copies it; it never writes back.
- **Weave state has no undo** (`setLaneStyle` writes directly, `panel-context.ts:389`). Chord edits follow that, and reach the autosave through `onWeaveChanged` — which is the only thing that tells the autosave a weave moved.
- **File size:** target 300 code lines, hard cap 500, comments and blanks excluded.
- **Colour-free tests:** `NO_COLOR=1 npx vitest run <file>`.
- **Commit messages in English.**
- Worktree: `C:\Users\nacho\git\tb303-synth\.claude\worktrees\arranger-auto-accompaniment`.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/arranger/chord-track.ts` | new — the four pure edits, and the ONE accessor | 1, 2 |
| `src/arranger/chord-track.test.ts` | new — the edits and the resolution rule | 1, 2 |
| `src/weave/weave-state.ts` | + `chords?: Chord[]` | 2 |
| `src/app/weave-wiring.ts` | reads the accessor, not the field | 2 |
| `src/app/panel-context.ts` | the host side of the SDK surface | 3 |
| `packages/loom-plugin-sdk/src/manifest.ts` | + the chord-track surface | 3 |
| `plugins/weave/main.ts` | the strip, under the flow row; Custom in the dropdown | 4 |
| `src/styles/_weave.scss` | the strip's cells | 4 |

---

### Task 1: The four edits, pure

**Files:**
- Create: `src/arranger/chord-track.ts`, `src/arranger/chord-track.test.ts`

**Interfaces:**
- Consumes: `Chord`, `Progression` from `src/arranger/progression.ts`.
- Produces: `setDegree(track, i, degree)`, `setLength(track, i, bars)`, `insertAfter(track, i)`, `removeAt(track, i)` — all `(track: Progression, …) => Chord[]`, none mutating.

- [ ] **Step 1: Write the failing test**

Create `src/arranger/chord-track.test.ts`:

```ts
// Editing a progression by hand. Pure on purpose — the panel only decides what
// a cell looks like, so every rule about what an edit MEANS is testable with no
// DOM and no session.
import { describe, it, expect } from 'vitest';
import { setDegree, setLength, insertAfter, removeAt } from './chord-track';
import type { Chord } from './progression';

const track: Chord[] = [
  { degree: 0, bars: 2 }, { degree: 5, bars: 1 }, { degree: 3, bars: 1 },
];

describe('editing a chord track', () => {
  it('changes one slot s degree and nothing else', () => {
    expect(setDegree(track, 1, 4)).toEqual([
      { degree: 0, bars: 2 }, { degree: 4, bars: 1 }, { degree: 3, bars: 1 },
    ]);
  });

  it('never mutates what it was given', () => {
    // The weave state is read while the panel repaints; an in-place edit would
    // change what a reader is halfway through.
    const before = JSON.stringify(track);
    setDegree(track, 0, 6);
    setLength(track, 0, 4);
    insertAfter(track, 0);
    removeAt(track, 0);
    expect(JSON.stringify(track)).toBe(before);
  });

  it('keeps a slot at least one bar long', () => {
    // A zero-bar chord is a chord that never sounds, and progressionBars would
    // count it as nothing — a lap that silently skips a slot.
    expect(setLength(track, 1, 0)[1].bars).toBe(1);
    expect(setLength(track, 1, -3)[1].bars).toBe(1);
  });

  it('rounds a dragged length to whole bars', () => {
    expect(setLength(track, 1, 2.6)[1].bars).toBe(3);
  });

  it('inserts a copy after the slot, so a new cell starts somewhere sensible', () => {
    const out = insertAfter(track, 0);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ degree: 0, bars: 2 });
  });

  it('appends when asked to insert after the last slot', () => {
    expect(insertAfter(track, 2)).toHaveLength(4);
  });

  it('removes a slot', () => {
    expect(removeAt(track, 1)).toEqual([{ degree: 0, bars: 2 }, { degree: 3, bars: 1 }]);
  });

  it('refuses to remove the last slot', () => {
    // An empty track means "no progression", and the panel would then show an
    // editor with nothing in it and no way back.
    const one: Chord[] = [{ degree: 0, bars: 1 }];
    expect(removeAt(one, 0)).toEqual(one);
  });

  it('ignores an index that is not there, rather than growing holes', () => {
    for (const op of [
      () => setDegree(track, 9, 1), () => setLength(track, -1, 2),
      () => insertAfter(track, 9), () => removeAt(track, 9),
    ]) expect(op()).toEqual(track);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/arranger/chord-track.test.ts`
Expected: FAIL — cannot find module `./chord-track`.

- [ ] **Step 3: Implement**

Create `src/arranger/chord-track.ts`:

```ts
// Editing a progression by hand.
//
// The catalogue stopped being the only input, and these are the four things a
// person does to a written one. Pure and non-mutating: the weave state is read
// while the panel repaints, so an in-place edit would change what a reader is
// halfway through.
//
// Every op takes an index and returns a NEW track. An index that is not there
// returns the track unchanged rather than growing a hole — a panel repaints
// from state it may have drawn a moment ago, and a stale click must be inert
// rather than destructive.

import type { Chord, Progression } from './progression';

const copy = (t: Progression): Chord[] => t.map((c) => ({ ...c }));
const has = (t: Progression, i: number) => Number.isInteger(i) && i >= 0 && i < t.length;

/** Point one slot at another scale degree. */
export function setDegree(track: Progression, i: number, degree: number): Chord[] {
  if (!has(track, i)) return copy(track);
  const out = copy(track);
  out[i].degree = degree;
  return out;
}

/** How many bars a slot lasts. At least one, and whole: a zero-bar chord never
 *  sounds and `progressionBars` counts it as nothing, so a lap would silently
 *  skip that slot. Rounded because the gesture is a drag. */
export function setLength(track: Progression, i: number, bars: number): Chord[] {
  if (!has(track, i)) return copy(track);
  const out = copy(track);
  out[i].bars = Math.max(1, Math.round(bars));
  return out;
}

/** Add a slot after `i`, copying it — a new cell that starts on the chord
 *  beside it is somewhere to edit FROM, where one that started on the tonic
 *  would be a decision the user did not make. */
export function insertAfter(track: Progression, i: number): Chord[] {
  if (!has(track, i)) return copy(track);
  const out = copy(track);
  out.splice(i + 1, 0, { ...out[i] });
  return out;
}

/** Remove a slot, but never the last one: an empty track means "no
 *  progression", and the editor would be left with nothing in it and no way
 *  back. */
export function removeAt(track: Progression, i: number): Chord[] {
  if (!has(track, i) || track.length <= 1) return copy(track);
  const out = copy(track);
  out.splice(i, 1);
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `NO_COLOR=1 npx vitest run src/arranger/chord-track.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/arranger/chord-track.ts src/arranger/chord-track.test.ts
git commit -m "feat(arranger): the four edits of a chord track"
```

---

### Task 2: A written progression wins, through ONE accessor

**Files:**
- Modify: `src/arranger/chord-track.ts` (add the accessor)
- Modify: `src/weave/weave-state.ts` (`chords?: Chord[]`, near `progression` line 175)
- Modify: `src/app/weave-wiring.ts` (line 326, and `chordNow` line 428)
- Test: `src/arranger/chord-track.test.ts` (extend)

**Interfaces:**
- Produces: `activeProgression(state: { progression?: string; chords?: Progression }): Progression`.

> The accessor is the point. Two inputs to one question is exactly how "which
> preset is this lane on" ended up with three answers, and there are already
> two readers of the progression (`withProgression` and `chordNow`) that would
> have to be taught the precedence separately.

- [ ] **Step 1: Write the failing test**

Append to `src/arranger/chord-track.test.ts`:

```ts
import { activeProgression } from './chord-track';
import { progressionById } from './progression';

describe('which progression is actually playing', () => {
  it('uses the catalogue entry when nothing is written', () => {
    expect(activeProgression({ progression: 'i-VI' }))
      .toEqual(progressionById('i-VI')!.chords);
  });

  it('lets a WRITTEN track win over the catalogue', () => {
    const chords = [{ degree: 0, bars: 1 }, { degree: 4, bars: 3 }];
    expect(activeProgression({ progression: 'i-VI', chords })).toEqual(chords);
  });

  it('falls back to static for an id the catalogue does not have', () => {
    // A save from a future build must not take the harmony with it.
    expect(activeProgression({ progression: 'no-such-thing' }))
      .toEqual(progressionById('static')!.chords);
  });

  it('ignores an EMPTY written track', () => {
    // Empty means "nothing written", not "silence": the editor can reach zero
    // slots only through a bug, and answering with it would stop the harmony.
    expect(activeProgression({ progression: 'i-VI', chords: [] }))
      .toEqual(progressionById('i-VI')!.chords);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/arranger/chord-track.test.ts`
Expected: FAIL — `activeProgression is not exported`.

- [ ] **Step 3: Implement the accessor**

Append to `src/arranger/chord-track.ts`:

```ts
import { progressionById } from './progression';

/** The progression actually playing: what the user WROTE if they wrote one,
 *  else the catalogue entry they picked.
 *
 *  One accessor rather than the precedence spelled out at each reader. There
 *  are two today — the fold and the panel's chord bar — and two copies of "the
 *  written one wins" is two places to forget it, which shows up as the panel
 *  naming one chord while the music plays another. */
export function activeProgression(
  state: { progression?: string; chords?: Progression },
): Progression {
  if (state.chords && state.chords.length > 0) return state.chords;
  return progressionById(state.progression ?? 'static')?.chords
    ?? progressionById('static')!.chords;
}
```

- [ ] **Step 4: Hold the written track in the weave state**

In `src/weave/weave-state.ts`, beside `progression` (line 175):

```ts
  /** A progression written by hand. Present, it WINS over `progression` and the
   *  dropdown reads Custom.
   *
   *  Here rather than in the session because that is where it was born, not
   *  because it belongs to the panel: it is session harmony, and if it outgrows
   *  WEAVE it moves. Said out loud so nobody later mistakes the location for a
   *  decision. */
  chords?: Chord[];
```

with `import type { Chord } from '../arranger/progression';`, and nothing added to `defaultWeaveState` — absent is the default and means "the catalogue".

- [ ] **Step 5: Route both readers through the accessor**

In `src/app/weave-wiring.ts`, replace line 326:

```ts
    const prog = activeProgression(state);
    if (prog.length === 0) return notes;
```

and in `chordNow` (line ~428), replace the `progressionById(...)` lookup the same way, keeping `chordAtBar(prog, barCursor)` as it is. Add:

```ts
import { activeProgression } from '../arranger/chord-track';
```

and drop the now-unused `progressionById` import if nothing else in the file uses it.

- [ ] **Step 6: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/arranger src/app src/weave && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/arranger/chord-track.ts src/arranger/chord-track.test.ts src/weave/weave-state.ts src/app/weave-wiring.ts
git commit -m "feat(weave): a written progression wins over the catalogue"
```

---

### Task 3: The chord track across the plugin boundary

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (beside `progressions()` line 430)
- Modify: `src/app/panel-context.ts` (beside `setProgression` line 508)
- Test: `src/app/panel-context-chords.test.ts` (create)

**Interfaces:**
- Consumes: the four ops and `activeProgression` (Tasks 1–2).
- Produces: `chordTrack(): { degree: number; bars: number }[]`, `isCustomProgression(): boolean`, `setChordDegree(i, degree)`, `setChordBars(i, bars)`, `insertChordAfter(i)`, `removeChord(i)`, `resetChordTrack()`.

> The panel gets the OPS, not the maths. It is compiled separately and cannot
> import `src/`, so a panel doing its own splicing would be a second
> implementation of every rule in Task 1 — including the two that matter, "at
> least one bar" and "never remove the last".

- [ ] **Step 1: Write the failing test**

Create `src/app/panel-context-chords.test.ts`, copying the `makeCtx` helper from `src/app/panel-context.test.ts` verbatim rather than inventing a second fixture:

```ts
describe('the chord track, across the plugin boundary', () => {
  it('reads the catalogue entry until something is written', () => {
    const { ctx, weave } = makeCtx();
    weave.progression = 'i-VI';
    expect(ctx.isCustomProgression()).toBe(false);
    expect(ctx.chordTrack()).toEqual([{ degree: 0, bars: 1 }, { degree: 5, bars: 1 }]);
  });

  it('COPIES the catalogue entry on the first edit, rather than damaging it', () => {
    // The catalogue is a shelf of starting points. An edit that wrote back
    // would change every session that ever picks that entry.
    const { ctx, weave } = makeCtx();
    weave.progression = 'i-VI';
    ctx.setChordDegree(1, 3);
    expect(ctx.isCustomProgression()).toBe(true);
    expect(ctx.chordTrack()[1].degree).toBe(3);
    expect(progressionById('i-VI')!.chords[1].degree).toBe(5);
  });

  it('keeps a slot at least one bar, through the SDK too', () => {
    // The rule lives in the pure op; this asserts the panel cannot route around it.
    const { ctx } = makeCtx();
    ctx.setChordBars(0, 0);
    expect(ctx.chordTrack()[0].bars).toBe(1);
  });

  it('adds and removes slots', () => {
    const { ctx } = makeCtx();
    const n = ctx.chordTrack().length;
    ctx.insertChordAfter(0);
    expect(ctx.chordTrack()).toHaveLength(n + 1);
    ctx.removeChord(1);
    expect(ctx.chordTrack()).toHaveLength(n);
  });

  it('goes back to the catalogue when reset', () => {
    const { ctx, weave } = makeCtx();
    weave.progression = 'i-VI';
    ctx.setChordDegree(0, 4);
    ctx.resetChordTrack();
    expect(ctx.isCustomProgression()).toBe(false);
    expect(ctx.chordTrack()).toEqual(progressionById('i-VI')!.chords);
  });

  it('tells the weave it moved, so the autosave hears it', () => {
    // Nothing else would: a weave edit is deliberately not an undo entry, and
    // onWeaveChanged is the only thing that reaches the autosave.
    const { ctx, onWeaveChanged } = makeCtx();
    ctx.setChordDegree(0, 2);
    expect(onWeaveChanged).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/panel-context-chords.test.ts`
Expected: FAIL — `ctx.chordTrack is not a function`.

- [ ] **Step 3: Widen the SDK surface**

In `packages/loom-plugin-sdk/src/manifest.ts`, beside `progressions()`:

```ts
  /** The progression as CELLS: the written one if there is one, else a copy of
   *  the catalogue entry the scene is on. `degree` is 0-based; turning it into
   *  a roman numeral is the panel's business. */
  chordTrack(): { degree: number; bars: number }[];
  /** Whether the scene is walking a written progression rather than a catalogue
   *  entry. The dropdown reads Custom when it is. */
  isCustomProgression(): boolean;
  /** Point one cell at another degree. The FIRST edit of a catalogue entry
   *  copies it — the catalogue is a shelf of starting points and is never
   *  written to. */
  setChordDegree(index: number, degree: number): void;
  /** How many bars a cell lasts. Never less than one. */
  setChordBars(index: number, bars: number): void;
  /** Add a cell after this one, copying it. */
  insertChordAfter(index: number): void;
  /** Remove a cell. The last one cannot be removed. */
  removeChord(index: number): void;
  /** Throw the written progression away and go back to the catalogue entry. */
  resetChordTrack(): void;
```

- [ ] **Step 4: Implement the host side**

In `src/app/panel-context.ts`, beside `setProgression`:

```ts
    chordTrack() {
      return activeProgression(deps.weave).map((c) => ({ ...c }));
    },

    isCustomProgression() {
      return !!deps.weave.chords && deps.weave.chords.length > 0;
    },

    setChordDegree(index, degree) { editChords((t) => setDegree(t, index, degree)); },
    setChordBars(index, bars)     { editChords((t) => setLength(t, index, bars)); },
    insertChordAfter(index)       { editChords((t) => insertAfter(t, index)); },
    removeChord(index)            { editChords((t) => removeAt(t, index)); },

    resetChordTrack() {
      delete deps.weave.chords;
      deps.onWeaveChanged?.();
    },
```

and above the returned object:

```ts
  /** Every chord edit, through one seam: read what is playing, apply the pure
   *  op, and store the RESULT as a written track.
   *
   *  Reading through `activeProgression` is what makes the first edit of a
   *  catalogue entry a copy rather than damage — the entry is read, the edit
   *  lands on the copy, and the copy is what gets stored. */
  const editChords = (op: (t: Progression) => Chord[]): void => {
    deps.weave.chords = op(activeProgression(deps.weave));
    // A weave edit is deliberately not an undo entry, so this is the only thing
    // that tells the autosave the harmony moved.
    deps.onWeaveChanged?.();
  };
```

with the imports:

```ts
import { activeProgression, setDegree, setLength, insertAfter, removeAt } from '../arranger/chord-track';
import type { Chord, Progression } from '../arranger/progression';
```

- [ ] **Step 5: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts src/app/panel-context.ts src/app/panel-context-chords.test.ts
git commit -m "feat(sdk): a panel can edit the chord track"
```

---

### Task 4: The strip

**Files:**
- Modify: `plugins/weave/main.ts` (the progression dropdown at line 237; the strip goes under the flow row)
- Modify: `src/styles/_weave.scss`

**Interfaces:**
- Consumes: the whole chord-track surface (Task 3), and the roman-numeral conversion already in `plugins/weave/main.ts:462` — reuse it, do not write a second.

- [ ] **Step 1: Add Custom to the dropdown**

Where the progression select is built (line 237), append a `Custom` option and select it when `ctx.isCustomProgression()`. Choosing another entry calls `ctx.resetChordTrack()` first, then `ctx.setProgression(id)` — otherwise the written track keeps winning and the dropdown lies.

- [ ] **Step 2: Build the strip**

Under the flow row, a cell per chord, width proportional to its bars:

```ts
const chordStrip = el('div', 'weave-chords');
const paintChords = () => {
  chordStrip.textContent = '';
  const track = ctx.chordTrack();
  const total = track.reduce((n, c) => n + c.bars, 0) || 1;
  track.forEach((c, i) => {
    const cell = el('div', 'weave-chord-cell', roman(c.degree));
    cell.style.flexGrow = String(c.bars);
    cell.title = `${c.bars} bar${c.bars === 1 ? '' : 's'} — click to change, drag the edge to lengthen`;
    cell.addEventListener('click', () => {
      ctx.setChordDegree(i, (c.degree + 1) % 7);
      paintChords();
    });
    const grip = el('div', 'weave-chord-grip');
    grip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const startX = (e as PointerEvent).clientX;
      const startBars = c.bars;
      const perBar = chordStrip.clientWidth / total;
      const move = (m: PointerEvent) => {
        ctx.setChordBars(i, startBars + (m.clientX - startX) / perBar);
        paintChords();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    cell.appendChild(grip);
    const kill = el('button', 'weave-chord-kill', '×') as HTMLButtonElement;
    kill.type = 'button';
    kill.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.removeChord(i);
      paintChords();
    });
    cell.appendChild(kill);
    chordStrip.appendChild(cell);
  });
  const add = el('button', 'weave-chord-add', '+') as HTMLButtonElement;
  add.type = 'button';
  add.addEventListener('click', () => {
    ctx.insertChordAfter(ctx.chordTrack().length - 1);
    paintChords();
  });
  chordStrip.appendChild(add);
};
paintChords();
```

`roman(degree)` is the existing converter at line 462 — lift it to module scope in the same file if it is currently inside another function, and do not duplicate it.

- [ ] **Step 3: Style it**

In `src/styles/_weave.scss`:

```scss
// The progression, as cells whose width IS how long each chord lasts. A bar
// count in text would be a number to read; a wide cell is a length you see.
.weave-chords {
  display: flex;
  align-items: stretch;
  gap: 3px;
  min-height: 22px;
  margin-top: 4px;
}

.weave-chord-cell {
  position: relative;
  flex: 1 1 0;
  min-width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  font-size: 11px;
  color: var(--knob-purple, #9a6cd0);
  cursor: pointer;
  user-select: none;

  &:hover { border-color: var(--knob-purple, #9a6cd0); }
}

// The drag handle is the RIGHT EDGE, where a length is changed everywhere else
// in this app.
.weave-chord-grip {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: ew-resize;
}

.weave-chord-kill {
  position: absolute;
  top: 0;
  left: 2px;
  background: none;
  border: 0;
  padding: 0 2px;
  font-size: 9px;
  line-height: 1;
  color: var(--fg-dim, #888);
  cursor: pointer;
  opacity: 0;

  .weave-chord-cell:hover & { opacity: 1; }
}

.weave-chord-add {
  flex: 0 0 auto;
  padding: 0 8px;
  background: none;
  border: 1px dashed var(--border-soft);
  border-radius: 2px;
  color: var(--fg-dim, #888);
  cursor: pointer;
}
```

- [ ] **Step 4: Build the plugin, or nothing is visible**

Run: `npm run build:plugins`
Expected: `public/plugins/weave/` rewritten. The dev server does not compile `plugins/`.

- [ ] **Step 5: Look at it, and listen**

Run `npm run dev`, open WEAVE, and check by hand:

- the strip shows the current catalogue entry's chords, each cell as wide as it is long;
- clicking a cell steps its roman numeral and the dropdown flips to **Custom**;
- dragging a cell's right edge lengthens it, and the lap gets longer to match;
- `+` adds, `×` removes, and the last cell cannot be removed;
- picking a catalogue entry from the dropdown throws the written one away;
- with a scene playing, an edit is **heard** — the lanes follow the new chord.

- [ ] **Step 6: Commit**

```bash
git add plugins/weave/main.ts src/styles/_weave.scss public/plugins
git commit -m "feat(weave): write your own progression"
```

---

## Final verification

- [ ] `npm run build && npm run test:unit` — green (`plugins/bitcrusher` is a known flake; re-run it alone before blaming a change).
- [ ] The written progression survives a reload, through the autosave.
- [ ] **Prune** section 2 of `2026-08-10-harmony-that-moves-design.md` and this plan when merged; sections 1 and 3 stay, unstarted.
