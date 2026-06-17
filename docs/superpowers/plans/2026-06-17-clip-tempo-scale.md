# Clip tempo `*2` / `/2` buttons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `*2` / `/2` buttons to the clip inspector that double/halve a note or drum clip's perceived tempo by time-scaling its notes, loop region, length, and automation, in one undoable step.

**Architecture:** A pure, DOM-free core function `scaleClipTempo(clip, tempoMult)` does all the math (notes + loop + `lengthBars` + envelope resample). The inspector adds two buttons next to the Length field and wires them through `withUndo` + the existing `renderEditor()` / `renderWithMixer()` re-render path.

**Tech Stack:** TypeScript, Vite, Vitest (unit). No new dependencies.

## Global Constraints

- UI text in **English** (app consistency).
- Test commands run colour-free: `NO_COLOR=1 npx vitest run <file>`.
- Assertions in tests are **relative/exact-value** logic, not absolute DSP magnitudes (these are pure-logic tests, so exact integer assertions are correct here).
- Semantics (BPM convention, confirmed): **`*2` = double tempo = compress** (`timeFactor = 0.5`); **`/2` = halve tempo = stretch** (`timeFactor = 2`).
- `lengthBars` is an integer ≥ 1; `scaleClipTempo` enforces `max(1, round(...))`.
- Envelope `values` length the consumer expects = `lengthBars * 16 * AUTOMATION_SUB_RES` (`AUTOMATION_SUB_RES = 16` from [src/core/pattern.ts](../../../src/core/pattern.ts)).
- Spec: [docs/superpowers/specs/2026-06-17-clip-tempo-scale-design.md](../specs/2026-06-17-clip-tempo-scale-design.md).

---

### Task 1: Pure `scaleClipTempo` + `resampleEnvelope`

**Files:**
- Create: `src/core/clip-time-scale.ts`
- Test: `src/core/clip-time-scale.test.ts`

**Interfaces:**
- Consumes: `SessionClip` (`import type` from `../session/session`), `AUTOMATION_SUB_RES` from `./pattern`.
- Produces:
  - `export function scaleClipTempo(clip: SessionClip, tempoMult: number): void` — mutates `clip` in place.
  - `export function resampleEnvelope(values: number[], newLen: number): number[]`.

- [ ] **Step 1: Write the failing test**

Create `src/core/clip-time-scale.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { scaleClipTempo, resampleEnvelope } from './clip-time-scale';
import type { SessionClip } from '../session/session';

const clip = (over: Partial<SessionClip> = {}): SessionClip => ({
  id: 'c', lengthBars: 2, notes: [], ...over,
});

describe('resampleEnvelope', () => {
  it('stretches by repeating samples (nearest-neighbor by phase)', () => {
    expect(resampleEnvelope([0, 1], 4)).toEqual([0, 0, 1, 1]);
  });
  it('compresses by decimating samples', () => {
    expect(resampleEnvelope([0, 0, 1, 1], 2)).toEqual([0, 1]);
  });
  it('returns empty for an empty input regardless of target length', () => {
    expect(resampleEnvelope([], 4)).toEqual([]);
  });
});

describe('scaleClipTempo', () => {
  it('*2 (tempoMult 2) halves note start/duration', () => {
    const c = clip({ notes: [{ start: 48, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.notes[0]).toMatchObject({ start: 24, duration: 12 });
  });

  it('/2 (tempoMult 0.5) doubles note start/duration', () => {
    const c = clip({ notes: [{ start: 24, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 0.5);
    expect(c.notes[0]).toMatchObject({ start: 48, duration: 48 });
  });

  it('keeps duration at least 1 tick', () => {
    const c = clip({ notes: [{ start: 0, duration: 1, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.notes[0].duration).toBe(1);
  });

  it('scales the loop region when present and leaves it absent otherwise', () => {
    const c = clip({ loopEnabled: true, loopStartTick: 48, loopEndTick: 96 });
    scaleClipTempo(c, 2);
    expect(c.loopStartTick).toBe(24);
    expect(c.loopEndTick).toBe(48);
    expect(c.loopEnabled).toBe(true);

    const c2 = clip();
    scaleClipTempo(c2, 0.5);
    expect(c2.loopStartTick).toBeUndefined();
    expect(c2.loopEndTick).toBeUndefined();
  });

  it('/2 doubles lengthBars; *2 halves it', () => {
    const a = clip({ lengthBars: 2 });
    scaleClipTempo(a, 0.5);
    expect(a.lengthBars).toBe(4);

    const b = clip({ lengthBars: 2 });
    scaleClipTempo(b, 2);
    expect(b.lengthBars).toBe(1);
  });

  it('1-bar *2 keeps length at 1 but still compresses the notes', () => {
    const c = clip({ lengthBars: 1, notes: [{ start: 24, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.lengthBars).toBe(1);
    expect(c.notes[0]).toMatchObject({ start: 12, duration: 12 });
  });

  it('never overflows the new length for odd bar counts (no-clip invariant)', () => {
    // 3-bar clip (4/4 → 384 ticks/bar = 1152), note ending exactly at clip end.
    const c = clip({ lengthBars: 3, notes: [{ start: 1128, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.lengthBars).toBe(2); // round(1.5) = 2
    const end = c.notes[0].start + c.notes[0].duration;
    expect(end).toBeLessThanOrEqual(2 * 384); // within new length ticks
  });

  it('resamples envelopes to the new expected length', () => {
    // 1-bar clip: expected values length = 1 * 16 * 16 = 256.
    const values = Array.from({ length: 256 }, (_, i) => i / 255);
    const c = clip({ lengthBars: 1, envelopes: [{ paramId: 'sub.filter.cutoff', values, enabled: true }] });
    scaleClipTempo(c, 0.5); // /2 → length doubles to 2 bars
    expect(c.lengthBars).toBe(2);
    expect(c.envelopes![0].values.length).toBe(2 * 16 * 16); // 512
    scaleClipTempo(c, 2); // *2 → back to 1 bar
    expect(c.envelopes![0].values.length).toBe(256);
  });

  it('round-trips grid-aligned notes through *2 then /2', () => {
    const c = clip({ lengthBars: 2, notes: [{ start: 48, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);   // → start 24, dur 12, lengthBars 1
    scaleClipTempo(c, 0.5); // → start 48, dur 24, lengthBars 2
    expect(c.lengthBars).toBe(2);
    expect(c.notes[0]).toMatchObject({ start: 48, duration: 24 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/clip-time-scale.test.ts`
Expected: FAIL — `Failed to resolve import "./clip-time-scale"` / `scaleClipTempo is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/core/clip-time-scale.ts`:

```typescript
// Pure, DOM-free time-scaling for a clip's content. `scaleClipTempo` doubles or
// halves a clip's perceived tempo (BPM convention): tempoMult 2 = double tempo
// (compress notes), tempoMult 0.5 = half tempo (stretch notes). It scales notes,
// the loop sub-region, lengthBars, and resamples automation envelopes so the
// stored value arrays still match the length the scheduler expects. The caller
// snapshots state for undo BEFORE calling.

import type { SessionClip } from '../session/session';
import { AUTOMATION_SUB_RES } from './pattern';

// Mirror collect-scene-automation.ts: clip automation is 4/4-only, indexed at
// 16 steps/bar. Envelope values length the consumer expects = bars * 16 * SUB_RES.
const STEPS_PER_BAR = 16;

/** Resample an envelope value array to `newLen` by phase (nearest-neighbor).
 *  Stretching repeats samples; compressing decimates. Robust to any old length
 *  (also normalises legacy/odd-length arrays to the expected length). */
export function resampleEnvelope(values: number[], newLen: number): number[] {
  const oldLen = values.length;
  if (newLen <= 0 || oldLen === 0) return [];
  const out = new Array<number>(newLen);
  for (let j = 0; j < newLen; j++) {
    const src = Math.min(oldLen - 1, Math.floor((j * oldLen) / newLen));
    out[j] = values[src] ?? 0.5;
  }
  return out;
}

/** Scale a clip's perceived tempo by `tempoMult` (2 = faster/compress,
 *  0.5 = slower/stretch). Mutates `clip` in place. */
export function scaleClipTempo(clip: SessionClip, tempoMult: number): void {
  const timeFactor = 1 / tempoMult;

  for (const n of clip.notes) {
    n.start = Math.round(n.start * timeFactor);
    n.duration = Math.max(1, Math.round(n.duration * timeFactor));
  }

  if (clip.loopStartTick !== undefined) clip.loopStartTick = Math.round(clip.loopStartTick * timeFactor);
  if (clip.loopEndTick !== undefined) clip.loopEndTick = Math.round(clip.loopEndTick * timeFactor);

  // Half-up rounding + the integer-bar floor guarantee the new length never
  // clips the scaled notes (the only fractional result is x.5, which rounds up).
  const newLengthBars = Math.max(1, Math.round(clip.lengthBars * timeFactor));

  if (clip.envelopes) {
    const targetLen = newLengthBars * STEPS_PER_BAR * AUTOMATION_SUB_RES;
    for (const env of clip.envelopes) {
      env.values = resampleEnvelope(env.values, targetLen);
    }
  }

  clip.lengthBars = newLengthBars;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/clip-time-scale.test.ts`
Expected: PASS — all `resampleEnvelope` and `scaleClipTempo` cases green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/clip-time-scale.ts src/core/clip-time-scale.test.ts
git commit -m "feat(core): scaleClipTempo — time-scale a clip's notes/loop/length/automation"
```

---

### Task 2: Inspector `*2` / `/2` buttons + wiring

**Files:**
- Modify: `index.html` (add two buttons after the Length field in `#insp-transport-row`, near line 302)
- Modify: `src/session/session-inspector.ts` (import, button wiring in `openInspector`, new `applyTempoScale` method)

**Interfaces:**
- Consumes: `scaleClipTempo` from `../core/clip-time-scale`; existing `withUndo`, `this.renderEditor()`, `this.deps.renderWithMixer()`, `this.roll?.getOctaveBase?.()/setOctaveBase?.()`, the `kind` local in `openInspector`.
- Produces: nothing other tasks depend on (final task).

- [ ] **Step 1: Add the buttons to `index.html`**

Find (around line 302):

```html
            <label>Length (bars) <input id="insp-length" type="number" min="1" step="1" /></label>
```

Insert immediately after that `<label>` line, before the `<label>Launch` line:

```html
            <button class="rnd" id="insp-tempo-double" title="Double tempo — compress notes & halve clip length">*2</button>
            <button class="rnd" id="insp-tempo-halve" title="Halve tempo — stretch notes & double clip length">/2</button>
```

- [ ] **Step 2: Import the pure function in `session-inspector.ts`**

Near the other `../core/*` imports at the top of `src/session/session-inspector.ts`, add:

```typescript
import { scaleClipTempo } from '../core/clip-time-scale';
```

- [ ] **Step 3: Wire the buttons inside `openInspector`**

In `src/session/session-inspector.ts`, inside `openInspector()`, after the existing `qEl.addEventListener('change', …)` block (the launch-quantize listener, ends ~line 175), add:

```typescript
    // *2 / /2 tempo scale — next to the Length field. Note clips and drum clips
    // only (audio clips have no notes). `.onclick` replaces on each open, so no
    // listener accumulation. `kind` was computed above.
    const dblBtn  = document.getElementById('insp-tempo-double') as HTMLButtonElement;
    const halfBtn = document.getElementById('insp-tempo-halve')  as HTMLButtonElement;
    const isNoteClip = kind !== 'audio';
    dblBtn.hidden  = !isNoteClip;
    halfBtn.hidden = !isNoteClip;
    dblBtn.onclick  = () => this.applyTempoScale(2);   // double tempo (compress)
    halfBtn.onclick = () => this.applyTempoScale(0.5); // halve tempo (stretch)
```

- [ ] **Step 4: Add the `applyTempoScale` method**

In `src/session/session-inspector.ts`, add this private method next to `renderEditor()` (around line 530):

```typescript
  /** Double (tempoMult 2) or halve (tempoMult 0.5) the open clip's perceived
   *  tempo: time-scale its notes/loop/length/automation in one undoable gesture,
   *  then re-render the editor (new patternTicks), the Length field, and the grid. */
  private applyTempoScale(tempoMult: number): void {
    if (!this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!clip) return;
    const d = this.deps.historyDeps;
    const run = () => {
      // Preserve the editor octave across the rebuild (renderEditor recreates the
      // piano-roll, which resets its octave base to C4) — mirrors insp-random-notes.
      const octaveBase = this.roll?.getOctaveBase?.() ?? 60;
      scaleClipTempo(clip, tempoMult);
      const lenEl = document.getElementById('insp-length') as HTMLInputElement | null;
      if (lenEl) lenEl.value = String(clip.lengthBars);
      this.renderEditor();
      this.roll?.setOctaveBase?.(octaveBase);
      this.deps.renderWithMixer();
    };
    if (d) withUndo(d, run); else run();
  }
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run build`
Expected: `tsc` passes and Vite bundles to `dist/` with no errors. (Build is required so the live check below tests the new code, not a stale bundle.)

- [ ] **Step 6: Live verification (mandatory — load it and LOOK)**

Start the dev server: `npm run dev` (serves <http://localhost:5173>). In the browser:

1. Select a note clip with a few notes; open the inspector. Confirm `*2` and `/2` appear next to **Length (bars)**.
2. Click `*2`: notes visibly compress, the **Length** field halves (e.g. 2 → 1), and the clip cell in the grid narrows. Play it — it sounds twice as fast.
3. Click `/2`: notes stretch back, Length doubles, clip cell widens. Sounds half-speed.
4. On a **1-bar** clip, click `*2`: Length stays **1**, notes compress into the first half. (Boundary rule.)
5. Press **Ctrl+Z**: one undo reverts the whole scale (notes + length + loop).
6. Open a **drum** clip → `*2` / `/2` are present and work the same.
7. Open an **audio** clip → the two buttons are **hidden**.
8. (If a clip has an automation envelope) scale it and confirm the automation curve still spans the clip and plays in sync.

- [ ] **Step 7: Run the full unit suite**

Run: `npm run test:unit`
Expected: green (re-run once if it exits with the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown after all tests pass).

- [ ] **Step 8: Commit**

```bash
git add index.html src/session/session-inspector.ts
git commit -m "feat(session): *2 / /2 clip tempo buttons in the inspector"
```

---

## Self-Review

**1. Spec coverage:**
- Notes scaling + min duration → Task 1 (tests 1–3). ✓
- Loop region scaling → Task 1 (test 4). ✓
- `lengthBars` scaling + 1-bar floor → Task 1 (tests 5–6). ✓
- No-clip invariant → Task 1 (test 7). ✓
- Envelope resample (length + shape via `resampleEnvelope` tests) → Task 1 (tests for `resampleEnvelope` + envelope test). ✓
- BPM semantics (`*2` faster / `/2` slower), tooltips, English copy → Task 2 (Step 1). ✓
- Placement next to Length; hidden for audio; notes + drums → Task 2 (Steps 1, 3). ✓
- Undo + re-render (editor + Length field + grid) → Task 2 (Step 4). ✓
- Live verification → Task 2 (Step 6). ✓
- Out of scope (audio clips, other factors, meter-aware automation) → not implemented. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; all code shown in full. ✓

**3. Type consistency:** `scaleClipTempo(clip, tempoMult)` and `resampleEnvelope(values, newLen)` signatures match between Task 1 definition and Task 2 usage. The private method is `applyTempoScale` (distinct from the imported `scaleClipTempo`, so no shadowing). `NoteEvent` shape (`start/duration/midi/velocity`), `ClipEnvelope` shape (`paramId/values/enabled`), and `SessionClip` fields (`lengthBars/notes/loopStartTick/loopEndTick/envelopes`) all match `src/session/session.ts` and `src/core/notes.ts`. ✓
