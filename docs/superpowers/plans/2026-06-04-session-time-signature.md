# Session Time Signature (Global Meter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single global time signature (4/4, 3/4, 7/8, …) — edited like the BPM — that every timing computation honors: scheduler loop length, piano-roll bar lines, drum-grid step count, and the transport readout.

**Architecture:** One new pure module `src/core/meter.ts` is the single source of truth (`ticksPerBar`/`stepsPerBar`/`stepsPerBeat`/`quartersPerBar`/`clampMeter`/`resolveMeter`/`COMMON_METERS`). The meter lives on `Sequencer.meter` (default 4/4) and is persisted as an additive optional `SavedStateV3.timeSignature` (absent ⇒ 4/4, so old saves are byte-identical in sound). Every place that hard-codes "16 steps/bar" or "4 beats/bar" is rewired to call the helper. The threading into the scheduler is done by adding an **optional** `meter` field to `SchedulerContext` and an **optional trailing** `meter` parameter to `tickSession`, so all existing tests keep compiling and passing unchanged.

**Tech Stack:** TypeScript, Vite, Vitest (Node, `node-web-audio-api` globalized), Web Audio. No linter. Tests run colour-free via `cross-env NO_COLOR=1` (already wired into npm scripts).

**Spec:** [docs/superpowers/specs/2026-06-04-session-time-signature-design.md](../specs/2026-06-04-session-time-signature-design.md)

---

## Execution notes (read first)

- **Worktree:** Per the user's workflow, run this in a branch + git worktree (use the
  `superpowers:using-git-worktrees` skill). Commit freely on the branch; at the end rebase
  onto `main` and `merge --ff` (no merge commit). Do **not** junction `node_modules` into the
  worktree (known footgun); run `npm install` inside the worktree instead.
- **Commits:** Every commit message must end with the footer (per `CLAUDE.md`):

  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

  The commit commands below omit it for brevity — add it to each.
- **Tests:** use `NO_COLOR=1 npx vitest run <file>` for a single file; `npm run test:unit` for
  the whole unit suite. `test:unit` occasionally exits non-zero with `ERR_IPC_CHANNEL_CLOSED`
  on teardown **after** all tests pass — that is not a failure; re-run to confirm green.
- **Assertions:** the meter math is exact integer/rational arithmetic, so `toBe(384)` etc. are
  correct here. The project's "always relative" rule targets DSP signal magnitudes, not pure
  arithmetic — this plan adds no DSP renders.
- **GitNexus:** before editing the higher-blast-radius symbols (`tickSession`, `tickLane`),
  optionally run `gitnexus_impact({target, direction:"upstream"})` per `CLAUDE.md`. Known
  callers are already enumerated in each task. (GitNexus is worktree-blind for
  `detect_changes`; the staleness hook nag is cosmetic.)

## File structure

**Created:**
- `src/core/meter.ts` — the pure meter module (single source of truth).
- `src/core/meter.test.ts` — unit tests for the meter math + clamping + default resolution.
- `src/core/transport-display.test.ts` — unit test for `formatPosition`.

**Modified:**
- `src/core/sequencer.ts` — add `meter` field.
- `src/core/lane-scheduler.ts` — `tickLane` uses the meter for loop duration; note projection
  rewritten meter-independently.
- `src/core/lane-scheduler.test.ts` — add a 7/8 loop-duration test.
- `src/session/session-runtime.ts` — `tickSession` takes an optional `meter`; the clip-length
  modulo becomes meter-aware.
- `src/session/session-host.ts` — pass `seq.meter` to `tickSession`; meter-aware new-clip default length.
- `src/core/transport-display.ts` — `formatPosition` honors the meter (exported for testing).
- `src/core/pianoroll.ts` — bar/beat grid lines + ruler labels from the meter.
- `src/session/clip-editors/clip-editor-router.ts` — pass meter-derived geometry to both editors.
- `src/session/clip-editors/clip-editor-drum-grid.ts` — step count + segment marks from the meter.
- `src/save/saved-state-v3.ts` — persist/restore `timeSignature`; new `meterSel` dep.
- `index.html` — meter `<select>`; Bars `<select>` values become bar counts.
- `src/main.ts` — wire the meter select, the Bars-as-bars handler, and the load-time sync.

**Deliberately out of Spec-1 scope (leave the `/16` as-is, do NOT change):**
- `src/automation/automation-painter.ts:27` (`seqLength / 16`) — performance-view automation-lane
  default length. The performance view is a separate subsystem; leaving it 4/4 is acceptable.
- `src/midi/midi-to-session.ts:50` (`TICKS_PER_BAR`) — MIDI import is 4/4; importing SMF meter is a non-goal.

---

## Task 1: `meter.ts` pure module

**Files:**
- Create: `src/core/meter.ts`
- Test: `src/core/meter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/meter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ticksPerBar, quartersPerBar, stepsPerBar, stepsPerBeat,
  clampMeter, resolveMeter, formatMeter, meterFromLabel,
  DEFAULT_METER, COMMON_METERS,
} from './meter';

describe('meter math', () => {
  it('ticksPerBar for common meters', () => {
    expect(ticksPerBar({ num: 4, den: 4 })).toBe(384);
    expect(ticksPerBar({ num: 3, den: 4 })).toBe(288);
    expect(ticksPerBar({ num: 7, den: 8 })).toBe(336);
    expect(ticksPerBar({ num: 6, den: 8 })).toBe(288);
    expect(ticksPerBar({ num: 9, den: 8 })).toBe(432);
  });

  it('stepsPerBar is an integer for every allowed denominator', () => {
    for (const den of [2, 4, 8, 16]) {
      for (let num = 1; num <= 16; num++) {
        expect(Number.isInteger(stepsPerBar({ num, den }))).toBe(true);
      }
    }
  });

  it('stepsPerBar / stepsPerBeat for common meters', () => {
    expect(stepsPerBar({ num: 4, den: 4 })).toBe(16);
    expect(stepsPerBeat({ num: 4, den: 4 })).toBe(4);
    expect(stepsPerBar({ num: 7, den: 8 })).toBe(14);
    expect(stepsPerBeat({ num: 7, den: 8 })).toBe(2);
  });

  it('quartersPerBar', () => {
    expect(quartersPerBar({ num: 4, den: 4 })).toBe(4);
    expect(quartersPerBar({ num: 7, den: 8 })).toBe(3.5);
  });

  it('clampMeter rejects bad denominators and out-of-range numerators', () => {
    expect(clampMeter({ num: 7, den: 32 })).toEqual({ num: 7, den: 4 });
    expect(clampMeter({ num: 99, den: 8 })).toEqual({ num: 16, den: 8 });
    expect(clampMeter({ num: 0, den: 4 })).toEqual({ num: 1, den: 4 });
  });

  it('resolveMeter defaults missing input to 4/4', () => {
    expect(resolveMeter(undefined)).toEqual(DEFAULT_METER);
    expect(resolveMeter(null)).toEqual(DEFAULT_METER);
    expect(resolveMeter({ num: 7, den: 8 })).toEqual({ num: 7, den: 8 });
  });

  it('formatMeter / meterFromLabel round-trip', () => {
    expect(formatMeter({ num: 7, den: 8 })).toBe('7/8');
    expect(meterFromLabel('7/8')).toEqual({ num: 7, den: 8 });
    expect(meterFromLabel('garbage')).toEqual(DEFAULT_METER);
  });

  it('COMMON_METERS starts with 4/4', () => {
    expect(COMMON_METERS[0]).toEqual({ num: 4, den: 4 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/meter.test.ts`
Expected: FAIL — `Failed to resolve import "./meter"` / module not found.

- [ ] **Step 3: Write the module**

Create `src/core/meter.ts`:

```ts
// Global time signature (session meter) — the single source of truth for how a
// bar maps onto the tick grid. Timing lives in ticks (TICKS_PER_QUARTER = 96);
// one whole note = 384 ticks. A bar of num/den = num * (384/den) ticks.
//
// Allowed denominators are the powers of two that divide 384, which guarantees
// an integer number of 16th-steps per bar (the grid the editors draw on).

import { TICKS_PER_QUARTER, TICKS_PER_STEP } from './notes';

export interface TimeSignature {
  num: number; // beats per bar (1..16)
  den: number; // beat unit; one of 2, 4, 8, 16
}

export const DEFAULT_METER: TimeSignature = { num: 4, den: 4 };
export const ALLOWED_DENOMINATORS: readonly number[] = [2, 4, 8, 16];

/** Common meters, in dropdown order. 4/4 first so it is the default selection. */
export const COMMON_METERS: readonly TimeSignature[] = [
  { num: 4, den: 4 }, { num: 3, den: 4 }, { num: 2, den: 4 }, { num: 5, den: 4 },
  { num: 6, den: 8 }, { num: 7, den: 8 }, { num: 9, den: 8 }, { num: 12, den: 8 },
];

const TICKS_PER_WHOLE = TICKS_PER_QUARTER * 4; // 384

export function ticksPerBar(m: TimeSignature): number {
  return (m.num * TICKS_PER_WHOLE) / m.den;
}
export function quartersPerBar(m: TimeSignature): number {
  return ticksPerBar(m) / TICKS_PER_QUARTER;
}
export function stepsPerBar(m: TimeSignature): number {
  return ticksPerBar(m) / TICKS_PER_STEP;
}
export function stepsPerBeat(m: TimeSignature): number {
  return (TICKS_PER_WHOLE / m.den) / TICKS_PER_STEP;
}

/** Coerce arbitrary input into a valid meter (num 1..16, den in {2,4,8,16}). */
export function clampMeter(m: TimeSignature): TimeSignature {
  const den = ALLOWED_DENOMINATORS.includes(m.den) ? m.den : 4;
  const num = Number.isFinite(m.num) ? Math.max(1, Math.min(16, Math.round(m.num))) : 4;
  return { num, den };
}

/** Resolve a possibly-absent saved value into a valid meter (default 4/4). */
export function resolveMeter(saved: Partial<TimeSignature> | null | undefined): TimeSignature {
  if (!saved) return { ...DEFAULT_METER };
  return clampMeter({ num: saved.num ?? 4, den: saved.den ?? 4 });
}

export function formatMeter(m: TimeSignature): string {
  return `${m.num}/${m.den}`;
}

/** Parse a "num/den" label back into a clamped meter; garbage ⇒ 4/4. */
export function meterFromLabel(label: string): TimeSignature {
  const parts = label.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!Number.isFinite(num) || !Number.isFinite(den)) return { ...DEFAULT_METER };
  return clampMeter({ num, den });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/meter.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/core/meter.ts src/core/meter.test.ts
git commit -m "feat(meter): pure session time-signature module + tests"
```

---

## Task 2: `Sequencer` carries the meter

**Files:**
- Modify: `src/core/sequencer.ts`

- [ ] **Step 1: Add the import**

In `src/core/sequencer.ts`, the file already does `import { midiToFreq } from './notes';` near the top. Add below it:

```ts
import { DEFAULT_METER, type TimeSignature } from './meter';
```

- [ ] **Step 2: Add the field**

In the `Sequencer` class, immediately after the `swing` field declaration
(`swing = 0;             // 0..0.6, applied to odd 16ths`), add:

```ts
  /** Global time signature (like bpm). Read at schedule/draw time so a change
   *  takes effect on the next loop cycle. Persisted in SavedStateV3. */
  meter: TimeSignature = { ...DEFAULT_METER };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (No behavior change yet; the field is unused so far.)

- [ ] **Step 4: Commit**

```bash
git add src/core/sequencer.ts
git commit -m "feat(meter): Sequencer.meter field (default 4/4)"
```

---

## Task 3: Scheduler honors the meter

**Files:**
- Modify: `src/core/lane-scheduler.ts`
- Modify: `src/session/session-runtime.ts:174-247`
- Modify: `src/session/session-host.ts:194-201`
- Test: `src/core/lane-scheduler.test.ts`

**Callers of the symbols touched** (for awareness — all keep working):
`tickLane` ← `session-runtime.ts` + `lane-scheduler.test.ts` (constructs `SchedulerContext` inline).
`tickSession` ← `session-host.ts` (1 prod call) + `session-runtime.test.ts` / `session-runtime-rec.test.ts` (many calls, none pass `meter` → get the 4/4 default).

- [ ] **Step 1: Write the failing test**

Append to `src/core/lane-scheduler.test.ts` inside the existing
`describe('lane-scheduler tickLane', () => { ... })` block (before its closing `});`):

```ts
  it('a 7/8 clip loops at 7/8 the duration of a 4/4 clip (120 bpm)', () => {
    const clip: SessionClip = {
      id: '78', lengthBars: 1,
      notes: [{ start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 100 }],
    };
    const fires: number[] = [];
    let loopStart = 0;
    for (let now = 0; now < 4.0; now += 0.2) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart,
        meter: { num: 7, den: 8 },
        onTrigger: (_n, t) => fires.push(t),
        onAutomation: () => {},
      });
    }
    // 1 bar of 7/8 at 120 bpm = 7 eighth-notes; an eighth = (60/120)/2 = 0.25 s
    // → 1.75 s per loop (vs 2.0 s in 4/4).
    expect(fires[1] - fires[0]).toBeCloseTo(1.75, 2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: FAIL — the `meter` field is unknown on `SchedulerContext` (TS error) **or**, if TS is lenient, the gap is `2.0` not `1.75`.

- [ ] **Step 3: Update `lane-scheduler.ts`**

Change the imports at the top of `src/core/lane-scheduler.ts`:

```ts
import type { SessionClip, ClipEnvelope, ClipSample } from '../session/session';
import { TICKS_PER_QUARTER, TICKS_PER_STEP } from './notes';
import { quartersPerBar, DEFAULT_METER, type TimeSignature } from './meter';
```

Add a `meter` field to the `SchedulerContext` interface (after `lastScheduledAt?`):

```ts
  /** Global time signature; absent ⇒ 4/4. Controls loop (bar) duration only —
   *  individual note tick positions are absolute time, meter-independent. */
  meter?: TimeSignature;
```

Delete the module constant `const TICKS_PER_BAR = TICKS_PER_STEP * 16;` (it is replaced below).

In `tickLane`, replace the first two lines of the body:

```ts
  const secPerBeat = 60 / ctx.bpm;
  const clipDurSec = clip.lengthBars * 4 * secPerBeat;
```

with:

```ts
  const meter = ctx.meter ?? DEFAULT_METER;
  const secPerBeat = 60 / ctx.bpm;
  const clipDurSec = clip.lengthBars * quartersPerBar(meter) * secPerBeat;
```

In the audio-clip branch, replace:

```ts
          { midi: 60, duration: clip.lengthBars * 4 * TICKS_PER_STEP, velocity: 100, sample: clip.sample },
```

with:

```ts
          { midi: 60, duration: clip.lengthBars * quartersPerBar(meter) * TICKS_PER_STEP, velocity: 100, sample: clip.sample },
```

In the note branch, replace the projection:

```ts
        const clipTimeSec = (n.start / TICKS_PER_BAR) * 4 * secPerBeat;
```

with (algebraically identical in 4/4, and meter-independent — a tick is absolute musical time):

```ts
        const clipTimeSec = (n.start / TICKS_PER_QUARTER) * secPerBeat;
```

- [ ] **Step 4: Update `session-runtime.ts`**

Add to the imports at the top of `src/session/session-runtime.ts` (it already imports
`TICKS_PER_STEP` from `'../core/notes'` and `tickLane` from `'../core/lane-scheduler'`):

```ts
import { ticksPerBar, DEFAULT_METER, type TimeSignature } from '../core/meter';
```

Change the `tickSession` signature — add `meter` as the new **last** parameter with a default:

```ts
export function tickSession(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  now: number,
  lookahead: number,
  bpm: number,
  onLaneTrigger: LaneTriggerFn,
  onClipStepFired: ClipStepFiredFn,
  hooks?: RecHooks,
  meter: TimeSignature = DEFAULT_METER,
): void {
```

Pass the meter into the `tickLane` context — add a `meter,` line to the object literal
(right after `loopStartedAt: currentLoopStart,`):

```ts
    const newLoopStart = tickLane(clip, {
      bpm,
      lookaheadSec: lookahead,
      now,
      loopStartedAt: currentLoopStart,
      meter,
      lastScheduledAt: lp.lastScheduledAt,
      onTrigger: (note: { midi: number; duration: number; velocity: number; sample?: ClipSample }, scheduleTime: number) => {
```

Make the clip-length modulo meter-aware — replace:

```ts
        const scheduledStartTick = Math.round((scheduleTime - currentLoopStart) / tickSec)
          % (clip.lengthBars * 16 * TICKS_PER_STEP);
```

with:

```ts
        const scheduledStartTick = Math.round((scheduleTime - currentLoopStart) / tickSec)
          % (clip.lengthBars * ticksPerBar(meter));
```

- [ ] **Step 5: Update `session-host.ts` to pass the meter**

In `src/session/session-host.ts`, the `tickSession(...)` call at line ~194 ends with
`this.deps.recHooks,`. Add the meter as the final argument:

```ts
        this.deps.recHooks,
        this.deps.seq.meter,
      );
```

- [ ] **Step 6: Run the scheduler + runtime tests**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts src/session/session-runtime.test.ts src/session/session-runtime-rec.test.ts`
Expected: PASS — the new 7/8 test is green and all existing 4/4 tests (which pass no `meter`) are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts src/session/session-runtime.ts src/session/session-host.ts
git commit -m "feat(meter): scheduler loop duration honors the session meter"
```

---

## Task 4: Transport readout honors the meter

**Files:**
- Modify: `src/core/transport-display.ts`
- Test: `src/core/transport-display.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/transport-display.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatPosition } from './transport-display';

describe('transport formatPosition', () => {
  it('formats bar.beat.sub for 4/4 (16 steps/bar, 4 steps/beat)', () => {
    expect(formatPosition(0, 16, 4)).toBe('1.1.1');
    expect(formatPosition(4, 16, 4)).toBe('1.2.1');
    expect(formatPosition(16, 16, 4)).toBe('2.1.1');
  });

  it('formats bar.beat.sub for 7/8 (14 steps/bar, 2 steps/beat)', () => {
    expect(formatPosition(0, 14, 2)).toBe('1.1.1');
    expect(formatPosition(2, 14, 2)).toBe('1.2.1');
    expect(formatPosition(13, 14, 2)).toBe('1.7.2'); // last 16th of the bar
    expect(formatPosition(14, 14, 2)).toBe('2.1.1'); // next bar
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/transport-display.test.ts`
Expected: FAIL — `formatPosition` is not exported / has the wrong signature.

- [ ] **Step 3: Update `transport-display.ts`**

Add to the imports (the file currently imports only `type { Sequencer }`):

```ts
import { stepsPerBar, stepsPerBeat } from './meter';
```

Delete the two module constants:

```ts
const STEPS_PER_BAR = 16;
const STEPS_PER_BEAT = 4;
```

Replace `formatPosition` with an exported, meter-parameterised version:

```ts
export function formatPosition(step: number, barSteps: number, beatSteps: number): string {
  const bar = Math.floor(step / barSteps) + 1;
  const beat = Math.floor((step % barSteps) / beatSteps) + 1;
  const sub = Math.floor(step % beatSteps) + 1;
  return `${bar}.${beat}.${sub}`;
}
```

Inside `wireTransportDisplay`'s `tick()`, replace the position line:

```ts
      positionEl.textContent = formatPosition(step);
```

with (read the meter every frame so a live change reflects immediately):

```ts
      const m = seq.meter;
      positionEl.textContent = formatPosition(step, stepsPerBar(m), stepsPerBeat(m));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/transport-display.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/transport-display.ts src/core/transport-display.test.ts
git commit -m "feat(meter): transport bar.beat.step readout honors the meter"
```

---

## Task 5: Piano-roll grid honors the meter

**Files:**
- Modify: `src/core/pianoroll.ts`
- Modify: `src/session/clip-editors/clip-editor-router.ts:61-97`

This task is canvas-drawing wiring; it is verified by typecheck + build + manual smoke (the
underlying math is already unit-tested in Task 1). No new automated test.

- [ ] **Step 1: Add the opts fields**

In `src/core/pianoroll.ts`, in the `PianoRollOpts` interface (after `snapTicks?: number;`):

```ts
  /** Grid geometry from the session meter; default to 4/4 (16 / 4). */
  stepsPerBar?: number;
  stepsPerBeat?: number;
```

- [ ] **Step 2: Read them in `createPianoRoll`**

Near the top of `createPianoRoll`, where `snap` is derived
(`const snap = opts.snapTicks ?? TICKS_PER_STEP;`), add:

```ts
  const barSteps = opts.stepsPerBar ?? 16;
  const beatSteps = opts.stepsPerBeat ?? 4;
```

- [ ] **Step 3: Use them in `drawGrid`**

In `drawGrid`, replace the vertical-line emphasis block:

```ts
      if (s % 16 === 0) gctx.strokeStyle = '#555';
      else if (s % 4 === 0) gctx.strokeStyle = '#2f2f2f';
      else gctx.strokeStyle = '#1c1c1c';
```

with:

```ts
      if (s % barSteps === 0) gctx.strokeStyle = '#555';
      else if (s % beatSteps === 0) gctx.strokeStyle = '#2f2f2f';
      else gctx.strokeStyle = '#1c1c1c';
```

- [ ] **Step 4: Use them in `drawRuler`**

In `drawRuler`, replace the block:

```ts
      if (s % 16 === 0) {
        rctx.strokeStyle = '#6a6a6a';
        rctx.beginPath(); rctx.moveTo(x, 4); rctx.lineTo(x, RULER_H); rctx.stroke();
        rctx.fillStyle = '#c8c8c8'; rctx.font = '11px ui-monospace, monospace'; rctx.textBaseline = 'middle';
        rctx.fillText(String(s / 16 + 1), x + 4, RULER_H / 2);
      } else if (s % 4 === 0) {
```

with:

```ts
      if (s % barSteps === 0) {
        rctx.strokeStyle = '#6a6a6a';
        rctx.beginPath(); rctx.moveTo(x, 4); rctx.lineTo(x, RULER_H); rctx.stroke();
        rctx.fillStyle = '#c8c8c8'; rctx.font = '11px ui-monospace, monospace'; rctx.textBaseline = 'middle';
        rctx.fillText(String(s / barSteps + 1), x + 4, RULER_H / 2);
      } else if (s % beatSteps === 0) {
```

- [ ] **Step 5: Feed the meter from the router**

In `src/session/clip-editors/clip-editor-router.ts`, add to the imports:

```ts
import { ticksPerBar, stepsPerBar, stepsPerBeat } from '../../core/meter';
```

In `buildPianoRoll`, replace the `patternTicks` line:

```ts
    patternTicks: clip.lengthBars * 16 * TICKS_PER_STEP,
```

with (and add the two geometry opts just below it):

```ts
    patternTicks: clip.lengthBars * ticksPerBar(seq.meter),
    stepsPerBar: stepsPerBar(seq.meter),
    stepsPerBeat: stepsPerBeat(seq.meter),
```

(`seq` is already destructured from `deps` in `buildPianoRoll`. `TICKS_PER_STEP` may now be
unused in the router — if `tsc` flags it, remove it from that import.)

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/pianoroll.ts src/session/clip-editors/clip-editor-router.ts
git commit -m "feat(meter): piano-roll bar/beat grid + ruler honor the meter"
```

---

## Task 6: Drum-grid honors the meter

**Files:**
- Modify: `src/session/clip-editors/clip-editor-drum-grid.ts`
- Modify: `src/session/clip-editors/clip-editor-router.ts:54-57`

Wiring task; the step-count math is `stepsPerBar` from Task 1 (already tested). The existing
`clip-editor-drum-grid.test.ts` calls `renderDrumGridEditor(makeHost(), clip)` with no meter
and must keep passing (defaults to 4/4). Verified by that test + typecheck + manual smoke.

- [ ] **Step 1: Add imports and meter param**

In `src/session/clip-editors/clip-editor-drum-grid.ts`, add to the imports:

```ts
import { stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';
```

Change the `renderDrumGridEditor` signature and body header:

```ts
export function renderDrumGridEditor(
  host: HTMLElement,
  clip: SessionClip,
  historyDeps?: HistoryDeps,
  meter: TimeSignature = DEFAULT_METER,
): void {
  host.innerHTML = '';
  const spb = stepsPerBar(meter);
  const spbeat = stepsPerBeat(meter);
  const steps = clip.lengthBars * spb;
  if (!clip.notes) clip.notes = [];
```

- [ ] **Step 2: Thread the geometry into the row + cell builders**

Replace the row loop to pass `spb`/`spbeat`:

```ts
  for (const voice of DRUM_LANES) {
    container.appendChild(buildVoiceRow(clip, voice, steps, spb, spbeat, historyDeps));
  }
```

Change `buildVoiceRow`'s signature and its cell loop:

```ts
function buildVoiceRow(
  clip: SessionClip, voice: DrumVoice, totalSteps: number,
  spb: number, spbeat: number, historyDeps?: HistoryDeps,
): HTMLElement {
```

and inside it:

```ts
  for (let i = 0; i < totalSteps; i++) {
    cells.appendChild(buildCell(clip, voice, i, spb, spbeat, historyDeps));
  }
```

Change `buildCell`'s signature and the two segment-marker lines:

```ts
function buildCell(
  clip: SessionClip, voice: DrumVoice, stepIdx: number,
  spb: number, spbeat: number, historyDeps?: HistoryDeps,
): HTMLElement {
  const btn = document.createElement('button');
  btn.className = `dcell ${voice}`;
  if (stepIdx % spb === 0 && stepIdx > 0) btn.classList.add('seg-start');
  if (stepIdx % spbeat === 0)             btn.classList.add('downbeat');
```

- [ ] **Step 3: Pass the meter from the router**

In `src/session/clip-editors/clip-editor-router.ts`, in `renderClipEditor`, replace:

```ts
  if (editor === 'drum-grid') {
    renderDrumGridEditor(host, clip, deps.historyDeps);
    return null;
  }
```

with:

```ts
  if (editor === 'drum-grid') {
    renderDrumGridEditor(host, clip, deps.historyDeps, deps.seq.meter);
    return null;
  }
```

- [ ] **Step 4: Run the drum-grid test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-drum-grid.test.ts`
Expected: PASS (the no-meter call defaults to 4/4).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts src/session/clip-editors/clip-editor-router.ts
git commit -m "feat(meter): drum-grid step count + segment marks honor the meter"
```

---

## Task 7: Persist & restore the meter

**Files:**
- Modify: `src/save/saved-state-v3.ts`

The default-resolution logic (`resolveMeter`) is already unit-tested in Task 1. The
build/apply functions need a full DOM + sessionHost to call directly, so this task is verified
by typecheck + the Task 8 manual save/reload smoke.

- [ ] **Step 1: Add imports + interface fields**

In `src/save/saved-state-v3.ts`, add to the imports near the top:

```ts
import { resolveMeter, formatMeter, type TimeSignature } from '../core/meter';
```

In the `SavedStateV3` interface, after `swing: number;`:

```ts
  /** Global time signature — optional/additive; absent ⇒ 4/4 on load. */
  timeSignature?: TimeSignature;
```

In the `SavedStateV3Deps` interface, after `swingInput: HTMLInputElement;`:

```ts
  meterSel: HTMLSelectElement;
```

- [ ] **Step 2: Write the meter on save**

In `buildSavedStateV3`, the `state` object literal sets `swing: seq.swing,`. Add right after it:

```ts
    timeSignature: { ...seq.meter },
```

- [ ] **Step 3: Restore the meter on load**

In `applyLoadedStateV3`, destructure `meterSel` from `deps` (add it to the existing
destructure that lists `seq, volInput, bpmInput, swingInput, ...`):

```ts
  const {
    seq, volInput, bpmInput, swingInput, meterSel,
    sessionHost, refreshKnobsFromSynth, renderLanes, fx, master,
  } = deps;
```

Then, right after the `swing` restore line
(`if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }`):

```ts
  {
    const m = resolveMeter(s.timeSignature);
    seq.meter = m;
    meterSel.value = formatMeter(m);
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors at `main.ts` (the `savedStateDeps` object does not yet provide `meterSel`).
That is expected — it is supplied in Task 8. (If you prefer a green checkpoint, do Task 8 before
re-running `tsc`.) The `saved-state-v3.ts` file itself must be error-free.

- [ ] **Step 5: Commit**

```bash
git add src/save/saved-state-v3.ts
git commit -m "feat(meter): persist/restore timeSignature in SavedStateV3"
```

---

## Task 8: UI wiring — meter select + Bars-as-bars

**Files:**
- Modify: `index.html:66-77`
- Modify: `src/main.ts` (DOM refs, populate, handlers, load sync, save deps)
- Modify: `src/session/session-host.ts:454, :528`

Integration glue; verified by typecheck, build, the full unit suite, and manual smoke.

- [ ] **Step 1: Add the meter select to the transport row**

In `index.html`, after the BPM label (line 66, `<label>BPM<input id="bpm" ...></label>`), add:

```html
        <label>Meter<select id="meter"></select></label>
```

- [ ] **Step 2: Change the Bars options to bar counts**

In `index.html`, replace the Bars `<select>` options block:

```html
          <select id="bars">
            <option value="16">1</option>
            <option value="32" selected>2</option>
            <option value="48">3</option>
            <option value="64">4</option>
          </select>
```

with:

```html
          <select id="bars">
            <option value="1">1</option>
            <option value="2" selected>2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
```

- [ ] **Step 3: Add the DOM ref + import in `main.ts`**

In `src/main.ts`, after `const barsSel  = $<HTMLSelectElement>('bars');` (line ~151):

```ts
const meterSel = $<HTMLSelectElement>('meter');
```

Add an import alongside the other `./core/...` imports near the top of `main.ts`:

```ts
import { COMMON_METERS, formatMeter, meterFromLabel, stepsPerBar } from './core/meter';
```

- [ ] **Step 4: Populate the meter select**

In `main.ts`, in the "Populate selects" region (near line 158), add:

```ts
for (const m of COMMON_METERS) {
  const o = document.createElement('option');
  o.value = formatMeter(m);
  o.textContent = formatMeter(m);
  meterSel.appendChild(o);
}
meterSel.value = formatMeter(seq.meter);
```

- [ ] **Step 5: Make the Bars handler meter-aware + add the meter handler**

In `main.ts`, replace the existing Bars handler (line ~267):

```ts
barsSel.addEventListener('change', () => {
  seq.setLength(parseInt(barsSel.value, 10));
  renderLanes();
});
```

with (Bars now holds a bar count; derive steps from the meter, and add the meter handler):

```ts
barsSel.addEventListener('change', () => {
  seq.setLength(parseInt(barsSel.value, 10) * stepsPerBar(seq.meter));
  renderLanes();
});

meterSel.addEventListener('change', () => {
  seq.meter = meterFromLabel(meterSel.value);
  seq.setLength(parseInt(barsSel.value, 10) * stepsPerBar(seq.meter));
  // Re-render the clip grid. An open clip editor picks up the new meter the
  // next time it is opened (rebuilding a live-open editor is a Spec-2 concern).
  renderLanes();
});
```

- [ ] **Step 6: Fix the load-time Bars sync**

In `main.ts`, the post-load sync line (line ~453) is `barsSel.value = String(seq.length);`.
Replace it with a bars-count derivation (the meter select itself is synced inside
`applyLoadedStateV3` from Task 7):

```ts
barsSel.value = String(Math.max(1, Math.round(seq.length / stepsPerBar(seq.meter))));
```

- [ ] **Step 7: Supply `meterSel` to the save deps**

In `main.ts`, the save-deps object lists `volInput, bpmInput, swingInput,` (line ~684). Add
`meterSel` to it:

```ts
  volInput, bpmInput, swingInput, meterSel,
```

- [ ] **Step 8: Make new-clip default length meter-aware in `session-host.ts`**

In `src/session/session-host.ts`, add an import near the other `../core/...` imports:

```ts
import { stepsPerBar } from '../core/meter';
```

Replace **both** occurrences of:

```ts
          const defaultLen = Math.max(1, Math.floor(seq.length / 16));
```

(at lines ~454 and ~528) with:

```ts
          const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
```

(Use the same `seq` reference already valid on those lines.)

- [ ] **Step 9: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors (the Task 7 `meterSel` dep is now satisfied).
Run: `npm run build`
Expected: build succeeds (tsc + Vite bundle).

- [ ] **Step 10: Full unit suite**

Run: `npm run test:unit`
Expected: all green. (If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` *after* the test
summary shows all passing, that is the known flaky teardown — re-run to confirm.)

- [ ] **Step 11: Manual smoke (dev server)**

Run `npm run dev`, open <http://localhost:5173>, then verify:
1. The transport row has a **Meter** dropdown (4/4 … 12/8); Bars shows 1–4.
2. Select **7/8**: open a melodic clip → the piano-roll ruler shows **14** sixteenth columns
   per bar, a heavy bar line every 14, beat lines every 2, and bar numbers increment correctly.
3. Open a drums clip → the grid shows **14** cells per bar with the segment break at cell 14.
4. Press play → the loop is audibly shorter than 4/4; the transport readout counts beats up to 7.
5. Add a new clip → its default length matches the Bars selector in the current meter.
6. Save, reload the page, load the save → the meter is still 7/8 and everything matches.
7. Switch back to **4/4** → grids return to 16 columns/bar; an old 4/4 save loads identically.

- [ ] **Step 12: Commit**

```bash
git add index.html src/main.ts src/session/session-host.ts
git commit -m "feat(meter): meter selector + Bars-as-bars + meter-aware new-clip length"
```

---

## Self-review (completed by plan author)

**Spec coverage:**
- Global meter on Sequencer + persistence → Tasks 2, 7. ✓
- `meter.ts` single source of truth → Task 1. ✓
- Scheduler loop duration meter-aware → Task 3. ✓
- Piano-roll bar/beat lines + ruler → Task 5. ✓
- Drum-grid step count + segments → Task 6. ✓
- Transport readout → Task 4. ✓
- Meter dropdown UI + Bars-as-bars + new-clip default length → Task 8. ✓
- Migration (absent ⇒ 4/4) → `resolveMeter` (Task 1 test) + apply (Task 7) + smoke step 6. ✓
- Out-of-scope remnants (`automation-painter`, `midi-to-session`) called out explicitly. ✓

**Type consistency:** `TimeSignature {num,den}`, `DEFAULT_METER`, `ticksPerBar`,
`quartersPerBar`, `stepsPerBar`, `stepsPerBeat`, `clampMeter`, `resolveMeter`, `formatMeter`,
`meterFromLabel`, `COMMON_METERS` are defined once in Task 1 and referenced with those exact
names everywhere. `SchedulerContext.meter?` and `tickSession(..., meter = DEFAULT_METER)` are
both optional so existing call sites compile unchanged. Pianoroll opts use `stepsPerBar?`/
`stepsPerBeat?` and local `barSteps`/`beatSteps` (no shadowing of the imported helpers — the
piano-roll does not import `meter.ts`).

**Placeholder scan:** none — every code step shows complete code.
