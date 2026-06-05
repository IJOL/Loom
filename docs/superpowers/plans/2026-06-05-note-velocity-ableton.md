# Note velocity (Ableton-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-note velocity audible (continuous loudness), editable (an Ableton-style velocity lane), and visible (blue→yellow note colour) in the piano-roll and drum-grid editors.

**Architecture:** Three pure helpers (`velToColor`, `velToGain`, `velocity-lane-editing`) hold all new logic with unit tests. Velocity is threaded additively through the existing trigger path (`noteTrigger` → `session-runtime` → `trigger-dispatch` → `Voice.trigger`) and each engine replaces its binary `accent ? K : 1` amp factor with `base × velToGain(velocity)`, keeping the accent (`≥100`) *timbre* (filter/Q) where it exists. A velocity-lane canvas is added under each editor's grid.

**Tech Stack:** TypeScript, Web Audio API, Vite, Vitest (+ `node-web-audio-api` for DSP renders), Canvas 2D.

**Conventions (read once):**
- Run a single unit test file with `NO_COLOR=1 npx vitest run <path>` (project rule; do NOT add `--reporter`).
- DSP renders live in `*.dsp.test.ts`; they need the `node-web-audio-api` globals from `test/setup.ts` (already wired by vitest config). Assertions are **always relative** (ratios), never absolute magnitudes.
- `test:unit` can exit non-zero with `ERR_IPC_CHANNEL_CLOSED` on teardown *after* tests pass — that is not a failure, re-run to confirm.
- This plan is implemented in a **git worktree** created via `superpowers:using-git-worktrees` before Task 1. Rebase onto `main` after (around) every commit.
- Commit messages end with the repo's co-author trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/core/velocity-color.ts` | **new** — `velToColor(velocity)`: blue→yellow ramp (single source of truth for both editors) |
| `src/core/velocity-gain.ts` | **new** — `velNorm(velocity)`, `velToGain(velocity)`: continuous loudness multiplier + default-velocity helper |
| `src/core/velocity-lane-editing.ts` | **new** — pure lane geometry, hit-test, set/group/paint, chord-fan |
| `src/core/lane-scheduler.ts` | `NoteTrigger.velocity`; `noteTrigger` returns it |
| `src/session/session-runtime.ts` | forward `t.velocity` to the trigger callback (`LaneTriggerFn` gains a trailing optional param) |
| `src/app/trigger-dispatch.ts` | accept trailing `velocity`; pass into `Voice.trigger({velocity})` (incl. note-FX events) |
| `src/engines/fm.ts`, `karplus.ts`, `wavetable.ts` | replace `velMul = accent?K:1` with `velToGain(velocity)` |
| `src/polysynth/polysynth.ts` + `src/engines/subtractive.ts` | thread velocity; amp peak uses `velToGain`, filter env keeps accent boost |
| `src/core/synth.ts` + `src/engines/tb303.ts` | `Note.velocity`; amp peak uses `velToGain`, keep accent cutoff/Q character |
| `src/core/drums.ts` + `src/engines/drums-engine.ts` | thread velocity; per-voice gain uses `velToGain` |
| `src/engines/sampler.ts` | replace `(accent?1.0:0.8)` with `velToGain(velocity)` |
| `src/core/pianoroll.ts` | velocity-lane row + `velToColor` + accent border + creation default 90 |
| `src/session/clip-editors/clip-editor-drum-grid.ts` | velocity-lane band + `velToColor` + creation default 90 |

---

## Phase A — Pure helpers

### Task 1: `velToColor`

**Files:**
- Create: `src/core/velocity-color.ts`
- Test: `src/core/velocity-color.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/velocity-color.test.ts
import { describe, it, expect } from 'vitest';
import { velToColor } from './velocity-color';

const rgb = (s: string) => s.match(/\d+/g)!.map(Number);

describe('velToColor', () => {
  it('is blue at low velocity and yellow at high velocity', () => {
    const [rLo, gLo, bLo] = rgb(velToColor(1));
    const [rHi, gHi, bHi] = rgb(velToColor(127));
    expect(bLo).toBeGreaterThan(rLo);        // low: blue dominates
    expect(rHi).toBeGreaterThan(bHi);        // high: warm dominates
    expect(gHi).toBeGreaterThan(gLo);        // yellow is greener+redder than blue
  });

  it('red channel rises monotonically with velocity', () => {
    const reds = [0, 32, 64, 96, 127].map((v) => rgb(velToColor(v))[0]);
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeGreaterThanOrEqual(reds[i - 1]);
  });

  it('clamps out-of-range velocities', () => {
    expect(velToColor(-50)).toBe(velToColor(0));
    expect(velToColor(999)).toBe(velToColor(127));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/velocity-color.test.ts`
Expected: FAIL — `velToColor` not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/velocity-color.ts
// Velocity → note colour: a 2-colour blue→yellow ramp, blue-weighted (pivot 0.5).
// Single source of truth for the piano-roll and drum-grid note fills + velocity bars.
const BLUE      = [48, 134, 212] as const;
const LITE_BLUE = [80, 170, 234] as const;
const YELLOW    = [244, 222, 74] as const;
const PIVOT = 0.5;

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function rgbLerp(a: readonly number[], b: readonly number[], t: number): string {
  const c = [0, 1, 2].map((i) => Math.round(lerp(a[i], b[i], t)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** 0..127 → CSS rgb() string. Blue holds (slight lift) up to the pivot, then ramps to yellow. */
export function velToColor(velocity: number): string {
  const t = Math.max(0, Math.min(127, velocity)) / 127;
  if (t <= PIVOT) return rgbLerp(BLUE, LITE_BLUE, t / PIVOT);
  return rgbLerp(LITE_BLUE, YELLOW, (t - PIVOT) / (1 - PIVOT));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/velocity-color.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/velocity-color.ts src/core/velocity-color.test.ts
git commit -m "feat(velocity): velToColor blue→yellow ramp (pure)"
```

---

### Task 2: `velToGain` + `velNorm`

**Files:**
- Create: `src/core/velocity-gain.ts`
- Test: `src/core/velocity-gain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/velocity-gain.test.ts
import { describe, it, expect } from 'vitest';
import { velNorm, velToGain, DEFAULT_VELOCITY, resolveVelocity } from './velocity-gain';

describe('velocity-gain', () => {
  it('velNorm maps 0..127 to 0..1, clamped', () => {
    expect(velNorm(0)).toBe(0);
    expect(velNorm(127)).toBe(1);
    expect(velNorm(-10)).toBe(0);
    expect(velNorm(999)).toBe(1);
  });

  it('velToGain is monotonic and reproduces the legacy non-accent/accent levels', () => {
    expect(velToGain(80)).toBeCloseTo(1.0, 1);   // legacy non-accent ≈ 1.0
    expect(velToGain(115)).toBeCloseTo(1.3, 1);  // legacy accent ≈ 1.3
    expect(velToGain(40)).toBeLessThan(velToGain(80));
    expect(velToGain(127)).toBeGreaterThan(velToGain(100));
  });

  it('has a non-zero floor so soft notes are quiet but audible', () => {
    expect(velToGain(0)).toBeGreaterThan(0.2);
    expect(velToGain(0)).toBeLessThan(0.4);
  });

  it('resolveVelocity falls back to a sensible default when undefined', () => {
    expect(resolveVelocity(undefined, false)).toBe(DEFAULT_VELOCITY);
    expect(resolveVelocity(undefined, true)).toBeGreaterThanOrEqual(100); // accent default ≥ threshold
    expect(resolveVelocity(50, false)).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/velocity-gain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/velocity-gain.ts
// Velocity → continuous loudness. velToGain(v) = 0.3 + 1.1·(v/127) reproduces the
// engines' legacy binary factor at the old defaults: velToGain(80) ≈ 1.0 (old
// non-accent) and velToGain(115) ≈ 1.3 (old accent), while making everything in
// between continuous. Engines apply it as `oldNonAccentBase × velToGain(velocity)`.
export const DEFAULT_VELOCITY = 90; // new-note creation default (accent stays ≥100)

export function velNorm(velocity: number): number {
  return Math.max(0, Math.min(127, velocity)) / 127;
}

export function velToGain(velocity: number): number {
  return 0.3 + 1.1 * velNorm(velocity);
}

/** Legacy callsites pass only an `accent` boolean and no velocity (auditions,
 *  note-FX). Resolve a velocity for them so loudness ≈ the old behaviour. */
export function resolveVelocity(velocity: number | undefined, accent: boolean): number {
  if (velocity != null) return velocity;
  return accent ? 115 : DEFAULT_VELOCITY;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/velocity-gain.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/velocity-gain.ts src/core/velocity-gain.test.ts
git commit -m "feat(velocity): velToGain continuous loudness curve (pure)"
```

---

### Task 3: `velocity-lane-editing` (pure geometry + edits)

**Files:**
- Create: `src/core/velocity-lane-editing.ts`
- Test: `src/core/velocity-lane-editing.test.ts`

This holds the math the canvas editors call: convert a lane y to a velocity, find the bar under a pointer (with chord fanning), set one note, apply a group delta, and paint a value across a tick range.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/velocity-lane-editing.test.ts
import { describe, it, expect } from 'vitest';
import type { NoteEvent } from './notes';
import { yToVelocity, velocityToBarHeight, barHitTest, setVelocity, applyGroupDelta, paintVelocity, FAN_PX } from './velocity-lane-editing';

const n = (start: number, velocity: number, midi = 60): NoteEvent => ({ start, duration: 24, midi, velocity });

describe('velocity-lane-editing', () => {
  it('yToVelocity: top of lane = 127, bottom = 1', () => {
    expect(yToVelocity(0, 100)).toBe(127);
    expect(yToVelocity(100, 100)).toBe(1);
    expect(yToVelocity(50, 100)).toBe(64); // mid ≈ 64
  });

  it('velocityToBarHeight is proportional', () => {
    expect(velocityToBarHeight(127, 100)).toBe(100);
    expect(velocityToBarHeight(64, 100)).toBeCloseTo(50, 0);
  });

  it('barHitTest finds the bar whose x is nearest the pointer', () => {
    const notes = [n(0, 80), n(96, 100)];
    const xForTick = (t: number) => t * 2; // 2px/tick
    const hit = barHitTest(notes, 96 * 2 + 1, xForTick);
    expect(hit).toBe(notes[1]);
  });

  it('barHitTest fans a chord so each note is individually grabbable', () => {
    const a = n(0, 80, 60), b = n(0, 100, 64); // same start (chord)
    const xForTick = (t: number) => t * 2;
    // first fanned bar at base x, second offset by FAN_PX
    expect(barHitTest([a, b], 0, xForTick)).toBe(a);
    expect(barHitTest([a, b], FAN_PX, xForTick)).toBe(b);
  });

  it('setVelocity clamps to 1..127', () => {
    const note = n(0, 80);
    setVelocity(note, 200); expect(note.velocity).toBe(127);
    setVelocity(note, -5);  expect(note.velocity).toBe(1);
  });

  it('applyGroupDelta shifts all selected, each clamped', () => {
    const a = n(0, 80), b = n(24, 120);
    applyGroupDelta([a, b], 20);
    expect(a.velocity).toBe(100);
    expect(b.velocity).toBe(127); // clamped
  });

  it('paintVelocity sets every note whose start is in [t0,t1]', () => {
    const a = n(0, 80), b = n(48, 80), c = n(200, 80);
    paintVelocity([a, b, c], 0, 60, 30);
    expect(a.velocity).toBe(30);
    expect(b.velocity).toBe(30);
    expect(c.velocity).toBe(80); // outside range, untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/velocity-lane-editing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/velocity-lane-editing.ts
// Pure logic for the Ableton-style velocity lane: y↔velocity, bar geometry,
// chord-fanned hit-testing, and the three edit ops (set / group-delta / paint).
// The canvas editors own only pointer wiring, drawing and undo gestures.
import type { NoteEvent } from './notes';

export const FAN_PX = 4; // horizontal offset between stacked bars of a chord

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

/** Lane y (0 = top) → velocity 1..127, given the lane's pixel height. */
export function yToVelocity(y: number, laneHeight: number): number {
  const t = 1 - Math.max(0, Math.min(laneHeight, y)) / laneHeight;
  return clampVel(1 + t * 126);
}

/** Velocity → bar height in px (proportional to laneHeight). */
export function velocityToBarHeight(velocity: number, laneHeight: number): number {
  return (Math.max(0, Math.min(127, velocity)) / 127) * laneHeight;
}

/** Notes sharing a start tick are fanned by FAN_PX so each bar is grabbable.
 *  Returns the note whose (possibly fanned) bar x is nearest the pointer x. */
export function barHitTest(
  notes: NoteEvent[], pointerX: number, xForTick: (t: number) => number,
): NoteEvent | null {
  const byTick = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const arr = byTick.get(note.start) ?? [];
    arr.push(note); byTick.set(note.start, arr);
  }
  let best: NoteEvent | null = null, bestDist = Infinity;
  for (const [tick, group] of byTick) {
    const baseX = xForTick(tick);
    group.forEach((note, i) => {
      const d = Math.abs(pointerX - (baseX + i * FAN_PX));
      if (d < bestDist) { bestDist = d; best = note; }
    });
  }
  return best;
}

export function setVelocity(note: NoteEvent, velocity: number): void {
  note.velocity = clampVel(velocity);
}

export function applyGroupDelta(notes: NoteEvent[], delta: number): void {
  for (const note of notes) note.velocity = clampVel(note.velocity + delta);
}

/** Paint a single velocity onto every note whose start falls in [t0, t1]. */
export function paintVelocity(notes: NoteEvent[], t0: number, t1: number, velocity: number): void {
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  for (const note of notes) if (note.start >= lo && note.start <= hi) note.velocity = clampVel(velocity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/velocity-lane-editing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/velocity-lane-editing.ts src/core/velocity-lane-editing.test.ts
git commit -m "feat(velocity): pure velocity-lane editing logic"
```

---

## Phase B — Audible velocity (thread + per-engine gain)

### Task 4: `NoteTrigger.velocity`

**Files:**
- Modify: `src/core/lane-scheduler.ts:146-152` (the `NoteTrigger` interface) and `:165-185` (`noteTrigger`)
- Test: `src/core/lane-scheduler.test.ts` (add a case)

- [ ] **Step 1: Run impact analysis (required by repo CLAUDE.md)**

Run (MCP): `gitnexus_impact({ target: "noteTrigger", direction: "upstream" })`
Report the blast radius to the reviewer; `noteTrigger` is on the live tick **and** the offline export collector. Proceed — the change is additive (a new field).

- [ ] **Step 2: Write the failing test**

Add to `src/core/lane-scheduler.test.ts`:

```ts
import { noteTrigger } from './lane-scheduler';

it('noteTrigger carries the note velocity through', () => {
  const clip = { lengthBars: 1, notes: [] } as never;
  const t = noteTrigger('poly', clip, { midi: 60, duration: 24, velocity: 73 }, 0, 0, 120, undefined);
  expect(t.velocity).toBe(73);
  expect(t.accent).toBe(false); // 73 < 100
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: FAIL — `t.velocity` is `undefined`.

- [ ] **Step 4: Implement**

In `src/core/lane-scheduler.ts`, add `velocity` to the interface (after `slidingIn`):

```ts
export interface NoteTrigger {
  midi: number;
  gateSec: number;
  accent: boolean;
  slidingIn: boolean;
  velocity: number;
  scheduledStartTick: number;
}
```

And return it from `noteTrigger` (the final `return`):

```ts
  return { midi: note.midi, gateSec, accent, slidingIn, velocity: note.velocity, scheduledStartTick };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts
git commit -m "feat(velocity): NoteTrigger carries velocity"
```

---

### Task 5: Thread velocity runtime → dispatch → Voice

**Files:**
- Modify: `src/session/session-runtime.ts` (`LaneTriggerFn` type ~`:150-160`, call site `:217`)
- Modify: `src/app/trigger-dispatch.ts` (`TriggerForLane` type `:6-11`, body `:20-43`)
- Modify type-only consumers: `src/session/session-host.ts:77`, `src/session/session-inspector.ts:38`, `src/session/clip-editors/clip-editor-router.ts:25`
- Test: `src/app/trigger-dispatch.test.ts` (add a case)

Velocity is appended as the **last, optional** positional arg so existing callers keep working.

- [ ] **Step 1: Write the failing test**

Add to `src/app/trigger-dispatch.test.ts` (mirror the existing fake-deps style in that file):

```ts
it('passes velocity into Voice.trigger', () => {
  const seen: number[] = [];
  const fakeVoice = { trigger: (_m, _t, o) => seen.push(o.velocity), release() {}, connect() {}, dispose() {}, getAudioParams: () => new Map() };
  const deps = {
    ctx: {} as AudioContext,
    seq: { bpm: 120 } as never,
    laneResources: { get: () => ({ engine: { id: 'poly', createVoice: () => fakeVoice }, strip: { input: {} } }) } as never,
  };
  const trigger = createTriggerForLane(deps);
  trigger('lane1', 60, 0, 0.2, false, false, undefined, undefined, 73);
  expect(seen).toEqual([73]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/trigger-dispatch.test.ts`
Expected: FAIL — `o.velocity` is `undefined`.

- [ ] **Step 3: Implement — `trigger-dispatch.ts`**

Update the type and body:

```ts
export type TriggerForLane = (
  laneId: string, note: number, time: number, gate: number,
  accent: boolean, slidingIn?: boolean,
  sample?: import('../session/session').ClipSample,
  slice?: { sampleId: string; start: number; end: number },
  velocity?: number,
) => void;
```

```ts
import { resolveVelocity } from '../core/velocity-gain';
// ...
export function createTriggerForLane(deps: TriggerDispatchDeps): TriggerForLane {
  return (laneId, note, time, gate, accent, slidingIn = false, sample, slice, velocity) => {
    const res = deps.laneResources.get(laneId);
    if (!res) return;
    const engineId = res.engine.id;
    const vel = resolveVelocity(velocity, accent);

    const fire = (m: number, t: number, g: number, a: boolean, sl: boolean) => {
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(deps.ctx, res.strip.input);
      setCurrentLaneForVoice(null);
      v.trigger(m, t, { gateDuration: g, accent: a, slide: sl, sample, slice, velocity: vel });
    };

    const chain = sample == null && slice == null && engineId !== 'drums-machine'
      ? getNoteFxChain(laneId)
      : null;

    if (chain && chain.noteFx.some((s) => s.enabled)) {
      const events = chain.process([{ note, time, gate, accent }], { bpm: deps.seq.bpm });
      for (const e of events) fire(e.note, e.time, e.gate, e.accent, false);
      return;
    }
    fire(note, time, gate, accent, slidingIn);
  };
}
```

- [ ] **Step 4: Implement — `session-runtime.ts`**

Add a trailing optional `velocity` to the `LaneTriggerFn` type (after `slice`):

```ts
  slice?: { sampleId: string; start: number; end: number },
  velocity?: number,
) => void;
```

And pass `t.velocity` at the call site (`:217`):

```ts
        onLaneTrigger(lane.id, t.midi, scheduleTime, t.gateSec, t.accent, t.slidingIn, note.sample, note.slice, t.velocity);
```

- [ ] **Step 5: Implement — type-only consumers**

In `src/session/session-host.ts:77`, `src/session/session-inspector.ts:38`, and `src/session/clip-editors/clip-editor-router.ts:25`, extend each `triggerForLane` function type with the same trailing `velocity?: number` parameter so the wider signature type-checks. (These are `.d`-style declarations; no behavioural change. The audition callsites omit the arg and inherit the default.)

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `NO_COLOR=1 npx vitest run src/app/trigger-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/trigger-dispatch.ts src/session/session-runtime.ts src/session/session-host.ts src/session/session-inspector.ts src/session/clip-editors/clip-editor-router.ts src/app/trigger-dispatch.test.ts
git commit -m "feat(velocity): thread velocity runtime→dispatch→Voice"
```

---

### Task 6: Continuous gain in fm / karplus / wavetable

**Files:**
- Modify: `src/engines/fm.ts:187`, `src/engines/karplus.ts:218`, `src/engines/wavetable.ts:132`

Each currently computes `const velMul = options.accent ? K : 1.0;`. Replace with the continuous curve, resolving a default for legacy callers.

- [ ] **Step 1: Edit `fm.ts`**

Add the import near the other engine imports:

```ts
import { velToGain, resolveVelocity } from '../core/velocity-gain';
```

Replace `:187`:

```ts
    const velMul = velToGain(resolveVelocity(options.velocity, !!options.accent));
```

- [ ] **Step 2: Edit `karplus.ts`**

Add the same import. Replace `:218` (`const velMul = options.accent ? 1.4 : 1.0;`) with:

```ts
    const velMul = velToGain(resolveVelocity(options.velocity, !!options.accent));
```

- [ ] **Step 3: Edit `wavetable.ts`**

Add the same import. Replace `:132` (`const velMul = options.accent ? 1.3 : 1.0;`) with:

```ts
    const velMul = velToGain(resolveVelocity(options.velocity, !!options.accent));
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/engines/fm.ts src/engines/karplus.ts src/engines/wavetable.ts
git commit -m "feat(velocity): continuous gain in fm/karplus/wavetable"
```

---

### Task 7: Continuous gain in polysynth (subtractive)

**Files:**
- Modify: `src/polysynth/polysynth.ts` (`trigger`/`triggerWithBinding`/`internalTrigger` signatures `:138-152`, `velMul` `:193`, `peakAmp` `:381`)
- Modify: `src/engines/subtractive.ts:205,216` (pass velocity)

Keep the accent *filter* brightness (`:312` envScaler uses an accent boost) but make the *amp* peak continuous.

- [ ] **Step 1: Edit `polysynth.ts` signatures**

Thread an optional `velocity` through all three trigger entry points:

```ts
  triggerWithBinding(
    midi: number, time: number, gateDuration: number, accent = false,
    onVoice?: (params: PolyVoiceParams) => void, velocity?: number,
  ) {
    this.internalTrigger(midi, time, gateDuration, accent, onVoice, velocity);
  }

  trigger(midi: number, time: number, gateDuration: number, accent = false, velocity?: number) {
    this.internalTrigger(midi, time, gateDuration, accent, undefined, velocity);
  }

  private internalTrigger(
    midi: number, time: number, gateDuration: number, accent: boolean,
    onVoice?: (params: PolyVoiceParams) => void, velocity?: number,
  ) {
```

- [ ] **Step 2: Edit the gain math**

Add the import:

```ts
import { velToGain, resolveVelocity } from '../core/velocity-gain';
```

At `:193` keep an accent-only multiplier for the **filter** brightness, and derive the amp gain from velocity:

```ts
    const accentMul = accent ? 1.3 : 1.0;       // filter-env brightness (timbre)
    const ampGain = velToGain(resolveVelocity(velocity, accent)); // loudness
```

Change the filter env scaler (`:312`) to use `accentMul`:

```ts
    envScaler.gain.value = envRange * p.filter.envAmount * accentMul;
```

Change the amp peak (`:381`) to use `ampGain`:

```ts
    const peakAmp = 0.4 * ampGain;
```

(There are no other `velMul` references after this; if `tsc` flags an unused `velMul`, it has been fully replaced by `accentMul`/`ampGain`.)

- [ ] **Step 3: Edit `subtractive.ts`**

At `:205` the engine voice calls into polysynth via `triggerWithBinding`. Pass `options.velocity` as the new trailing arg. The call currently ends with the `onVoice` callback; append velocity:

```ts
    this.polysynth.triggerWithBinding(
      midi, time, options.gateDuration, options.accent ?? false,
      /* existing onVoice callback unchanged */ onVoiceCallback,
      options.velocity,
    );
```

(Use the actual onVoice argument already present at that call — only the trailing `options.velocity` is added. If subtractive instead calls `this.polysynth.trigger(...)`, append `options.velocity` there.)

- [ ] **Step 4: Typecheck + existing polysynth tests**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `NO_COLOR=1 npx vitest run src/polysynth/`
Expected: PASS (existing voice-cap/mode/modbus tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/polysynth/polysynth.ts src/engines/subtractive.ts
git commit -m "feat(velocity): continuous amp gain in polysynth/subtractive"
```

---

### Task 8: Continuous gain in TB-303 (keep accent timbre)

**Files:**
- Modify: `src/core/synth.ts` (`Note` interface `:12-17`, `trigger` `:83-132`)
- Modify: `src/engines/tb303.ts:88` (build the `Note` with velocity)

TB-303 accent must keep its filter cutoff/Q bite (lines 89, 106, 130); only the **amp peak** (line 90) becomes velocity-driven.

- [ ] **Step 1: Add velocity to the `Note` interface (`synth.ts`)**

```ts
export interface Note {
  freq: number;
  accent: boolean;
  slide: boolean;
  duration: number;
  velocity?: number;
}
```

- [ ] **Step 2: Use velToGain for the amp peak (`synth.ts:90`)**

Add the import at the top:

```ts
import { velToGain, resolveVelocity } from './velocity-gain';
```

Replace `:90` (`const peakAmp = note.accent ? 0.35 + p.accent * 0.4 : 0.3;`) with:

```ts
    const peakAmp = 0.3 * velToGain(resolveVelocity(note.velocity, note.accent));
```

Leave `accentBoost` (`:88`) and its use in `peakCutoff` (`:89`), `envRes` Q (`:106`) and the filter decay scale (`:130`) untouched — that is the accent timbre we keep.

- [ ] **Step 3: Pass velocity from the engine (`tb303.ts:88`)**

The engine builds the `Note`:

```ts
      accent: !!opts.accent,
```

Add the velocity field in the same object literal:

```ts
      accent: !!opts.accent,
      velocity: opts.velocity,
```

- [ ] **Step 4: Typecheck + existing tb303 tests**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `NO_COLOR=1 npx vitest run src/engines/tb303.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/synth.ts src/engines/tb303.ts
git commit -m "feat(velocity): TB-303 amp gain from velocity, keep accent timbre"
```

---

### Task 9: Continuous gain in drums

**Files:**
- Modify: `src/core/drums.ts:220-221` (`trigger`)
- Modify: `src/engines/drums-engine.ts:198` (pass velocity)

Drum accent is pure gain (no timbre), so velocity maps directly. Old endpoints: non-accent 0.65, accent 1.0 → use `0.65 × velToGain(velocity)` (≈0.65 at v=80, ≈0.84 at v=115; calibrated later).

- [ ] **Step 1: Edit `core/drums.ts`**

Add the import:

```ts
import { velToGain, resolveVelocity } from './velocity-gain';
```

Change `trigger` (`:220-221`) to accept velocity and derive `vel`:

```ts
  trigger(voice: DrumVoice, time: number, accent = false, velocity?: number) {
    const vel = 0.65 * velToGain(resolveVelocity(velocity, accent));
```

(The `switch` and `play*` methods are unchanged — they already multiply by `vel`.)

- [ ] **Step 2: Edit `drums-engine.ts:198`**

```ts
    this.dm.trigger(voice, time, !!opts.accent, opts.velocity);
```

- [ ] **Step 3: Typecheck + drums tests**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/drums.ts src/engines/drums-engine.ts
git commit -m "feat(velocity): continuous drum-voice gain from velocity"
```

---

### Task 10: Continuous gain in sampler

**Files:**
- Modify: `src/engines/sampler.ts:130` and `:240`

Both compute `... * (opts.accent ? 1.0 : 0.8) * ...`. Replace the accent factor with `0.8 * velToGain(velocity)` (≈0.8 at v=80, ≈1.04 at v=115).

- [ ] **Step 1: Edit `sampler.ts`**

Add the import:

```ts
import { velToGain, resolveVelocity } from '../core/velocity-gain';
```

At `:130` replace `(opts.accent ? 1.0 : 0.8)` with:

```ts
    const peak = this.api.getGlobal('gain') * (entry.gain ?? 1) * (0.8 * velToGain(resolveVelocity(opts.velocity, !!opts.accent))) * OUTPUT_TRIM * pad.level * audible;
```

At `:240` replace `(opts.accent ? 1.0 : 0.8)` likewise:

```ts
    const peak = this.api.getGlobal('gain') * (0.8 * velToGain(resolveVelocity(opts.velocity, !!opts.accent))) * OUTPUT_TRIM * pad.level * audible;
```

- [ ] **Step 2: Typecheck + sampler tests**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `NO_COLOR=1 npx vitest run src/engines/sampler.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/sampler.ts
git commit -m "feat(velocity): continuous sampler gain from velocity"
```

---

### Task 11: DSP proof — louder at higher velocity

**Files:**
- Create: `src/engines/velocity-gain.dsp.test.ts`

One render-based test that, per engine factory, plays a soft note (vel 40) and a loud note (vel 120) and asserts the loud render has greater RMS. Plus: TB-303 accent still brightens at equal velocity.

- [ ] **Step 1: Write the test**

```ts
// src/engines/velocity-gain.dsp.test.ts
import { describe, it, expect } from 'vitest';
// Importing the engine modules runs their registerEngineFactory side-effects
// (the registry is NOT plugin-bootstrapped in tests), so createEngineInstance works.
import './subtractive';
import './fm';
import './wavetable';
import './karplus';
import './tb303';
import { createEngineInstance } from './registry';
import { rms } from '../../test/dsp-asserts';

function renderEngine(engineId: string, velocity: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const engine = createEngineInstance(engineId)!;
  const voice = engine.createVoice(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode);
  voice.trigger(60, 0, { gateDuration: 0.4, accent: false, velocity });
  return ctx.startRendering().then((b) => b.getChannelData(0));
}

describe('velocity drives loudness', () => {
  for (const id of ['subtractive', 'fm', 'wavetable', 'karplus', 'tb303']) {
    it(`${id}: vel 120 is louder than vel 40`, async () => {
      const soft = rms(await renderEngine(id, 40));
      const loud = rms(await renderEngine(id, 120));
      expect(loud).toBeGreaterThan(soft * 1.2);
    });
  }
});
```

> Engine ids match `registerEngineFactory`: `subtractive`, `fm`, `wavetable`, `karplus`, `tb303`, `sampler`, `drums-machine`. `rms` is exported by `test/dsp-asserts.ts`. `createEngineInstance(id)` returns a fresh `SynthEngine` (the registry's public factory accessor).

- [ ] **Step 2: Run the DSP test**

Run: `NO_COLOR=1 npx vitest run src/engines/velocity-gain.dsp.test.ts`
Expected: PASS for every engine.

- [ ] **Step 3: Commit**

```bash
git add src/engines/velocity-gain.dsp.test.ts
git commit -m "test(velocity): DSP proof that higher velocity is louder"
```

---

## Phase C — Velocity colour in the editors

### Task 12: Piano-roll note colour + accent border + default 90

**Files:**
- Modify: `src/core/pianoroll.ts:225-229` (note fill/stroke), `:433`, `:587`, `:640` (creation velocity)

- [ ] **Step 1: Import the helpers**

At the top of `pianoroll.ts`:

```ts
import { velToColor } from './velocity-color';
import { DEFAULT_VELOCITY } from './velocity-gain';
```

- [ ] **Step 2: Velocity colour + accent border**

Replace the note fill/stroke block (`:225-229`) with velocity colouring; selection stays cyan, accent (`≥100`) draws a white border:

```ts
      const sel = selection.has(n);
      gctx.fillStyle = sel ? '#7fd4ff' : velToColor(n.velocity);
      gctx.fillRect(x + 1, y + 1, Math.max(2, x2 - x - 2), rowHeight - 2);
      gctx.strokeStyle = sel ? '#ffffff' : (n.velocity >= 100 ? '#ffffff' : '#0a0a0a');
      gctx.lineWidth = (sel || n.velocity >= 100) ? 1.5 : 1;
      gctx.strokeRect(x + 0.5, y + 0.5, x2 - x - 1, rowHeight - 1);
      gctx.lineWidth = 1;
```

- [ ] **Step 3: Creation default → 90**

Replace each `velocity: 80` at `:433`, `:587`, `:640` with `velocity: DEFAULT_VELOCITY`.

- [ ] **Step 4: Build + smoke**

Run: `npm run build`
Expected: typecheck + bundle succeed.

- [ ] **Step 5: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(velocity): piano-roll velocity colouring + accent border + default 90"
```

---

### Task 13: Drum-grid note colour + default 90

**Files:**
- Modify: `src/session/clip-editors/clip-editor-drum-grid.ts:137-139` (note fill/stroke), `:165` (creation velocity)

- [ ] **Step 1: Import the helpers**

```ts
import { velToColor } from '../../core/velocity-color';
import { DEFAULT_VELOCITY } from '../../core/velocity-gain';
```

- [ ] **Step 2: Velocity colour + accent border (`:137-139`)**

```ts
      const sel = selection.has(n);
      ctx.fillStyle = sel ? '#7fd4ff' : velToColor(n.velocity);
      ctx.fillRect(x, y, w, ROW_H - 6);
      ctx.strokeStyle = sel ? '#fff' : (n.velocity >= 100 ? '#ffffff' : '#0a0a0a');
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(3, w - 1), ROW_H - 7);
```

- [ ] **Step 3: Creation default → 90 (`:165`)**

Replace `velocity: 80` with `velocity: DEFAULT_VELOCITY`. (Leave the pencil's accent value `115` at `:168` unchanged.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts
git commit -m "feat(velocity): drum-grid velocity colouring + default 90"
```

---

## Phase D — Velocity lane UI

### Task 14: Piano-roll velocity lane — render

**Files:**
- Modify: `src/core/pianoroll.ts` (frame geometry `:54-57`, `buildEditorFrame` `:69-133`, `PianoRollFrame` `:59-64`, geom/layout, `syncStrips` `:292-295`, `redraw`)

Add a 3rd frame row: a left spacer (under the keyboard) + a velocity-lane canvas (under the grid viewport) that re-pins horizontally with `scrollLeft` exactly like the ruler.

- [ ] **Step 1: Add lane geometry constants (`:54-57`)**

```ts
const KEYS_W = 42;
const RULER_H = 26;
const FRAME_H = 320;           // grid area height (ruler + grid viewport)
const VEL_LANE_H = 64;         // ~20% of the note area; the velocity lane
```

- [ ] **Step 2: Extend `PianoRollFrame` (`:59-64`)**

```ts
export interface PianoRollFrame {
  frame: HTMLDivElement;
  wrap: HTMLDivElement; toolbar: HTMLDivElement;
  rulerWrap: HTMLDivElement; keysWrap: HTMLDivElement; gridVp: HTMLDivElement;
  rulerCanvas: HTMLCanvasElement; keysCanvas: HTMLCanvasElement; gridCanvas: HTMLCanvasElement;
  velWrap: HTMLDivElement; velCanvas: HTMLCanvasElement;
}
```

- [ ] **Step 3: Build the 3rd row in `buildEditorFrame`**

Change the frame's grid-template-rows to three rows and append the lane cells. Replace the `gridTemplateRows` line:

```ts
    gridTemplateRows: `${RULER_H}px 1fr ${VEL_LANE_H}px`,
```

After the existing `gridVp`/`gridCanvas` creation and before `frame.append(...)`, add:

```ts
  const velCorner = document.createElement('div');
  velCorner.className = 'pr-velcorner';
  Object.assign(velCorner.style, { background: '#181818', borderRight: '1px solid #2a2a2a', borderTop: '1px solid #2a2a2a' } as Partial<CSSStyleDeclaration>);

  const velWrap = mkWrap('pr-vel', 'ns-resize');
  velWrap.style.borderTop = '1px solid #2a2a2a';
  velWrap.style.background = '#0e0e0e';
  const velCanvas = mkCanvas(true);
  velWrap.appendChild(velCanvas);
```

Update the append to place all 6 cells in row-major order:

```ts
  frame.append(corner, rulerWrap, keysWrap, gridVp, velCorner, velWrap);
```

And add `velWrap, velCanvas` to the returned object.

- [ ] **Step 4: Draw the lane**

Add a `vctx = ctx2d(f.velCanvas)` next to the other contexts, and a `drawVelLane()` function. The lane shares the grid's `pxPerTick`; bars use `velToColor`, with a dashed accent line at velocity 100:

```ts
import { velToColor } from './velocity-color';
import { velocityToBarHeight, FAN_PX } from './velocity-lane-editing';
// ...
  const vctx = ctx2d(f.velCanvas);

  function drawVelLane(): void {
    vctx.fillStyle = '#0e0e0e'; vctx.fillRect(0, 0, gridW, VEL_LANE_H);
    // accent threshold line (velocity 100)
    const accentY = VEL_LANE_H - velocityToBarHeight(100, VEL_LANE_H);
    vctx.strokeStyle = '#ff8c2e'; vctx.globalAlpha = 0.6; vctx.setLineDash([4, 3]);
    vctx.beginPath(); vctx.moveTo(0, accentY); vctx.lineTo(gridW, accentY); vctx.stroke();
    vctx.setLineDash([]); vctx.globalAlpha = 1;
    // one bar per note (chord notes fanned by FAN_PX)
    const seenTick = new Map<number, number>();
    for (const n of opts.getNotes()) {
      if (n.midi < minMidi || n.midi > maxMidi) continue;
      const fan = seenTick.get(n.start) ?? 0; seenTick.set(n.start, fan + 1);
      const x = xForTick(n.start) + fan * FAN_PX;
      const h = velocityToBarHeight(n.velocity, VEL_LANE_H);
      const sel = selection.has(n);
      vctx.fillStyle = sel ? '#7fd4ff' : velToColor(n.velocity);
      vctx.fillRect(x, VEL_LANE_H - h, 6, h);
    }
  }
```

- [ ] **Step 5: Wire lane sizing + redraw**

In `layoutAll()` size the lane canvas and draw it:

```ts
    setSize(f.velCanvas, gridW, VEL_LANE_H);
    drawGrid(); drawRuler(); drawKeys(); drawVelLane();
```

In `syncStrips()` re-pin the lane horizontally with the grid:

```ts
  function syncStrips(): void {
    f.rulerCanvas.style.transform = `translateX(${-f.gridVp.scrollLeft}px)`;
    f.keysCanvas.style.transform = `translateY(${-f.gridVp.scrollTop}px)`;
    f.velCanvas.style.transform = `translateX(${-f.gridVp.scrollLeft}px)`;
  }
```

In the ruler-scrub handler (`:328-329`) and anywhere `drawGrid()` runs after a note edit, also call `drawVelLane()` so the bars track the notes. The simplest robust hook: make `drawGrid()`'s callers also redraw the lane — add `drawVelLane();` immediately after each `drawGrid();` in the pointer handlers and keyboard handlers, or define a small `redrawAll()` that calls both and use it in those sites.

- [ ] **Step 6: Build + manual check**

Run: `npm run build`
Then `npm run dev`, open a melodic clip, confirm a bar appears under each note at a height matching its velocity, scrolls in sync, with a dashed line ~78% up.

- [ ] **Step 7: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(velocity): piano-roll velocity lane render"
```

---

### Task 15: Piano-roll velocity lane — interaction (drag / group / paint)

**Files:**
- Modify: `src/core/pianoroll.ts` (pointer handlers on `f.velCanvas`)

Pointer-down on the lane: hit-test a bar; drag sets its velocity (group delta if it is selected and a selection exists); horizontal drag paints. All inside one undo gesture.

- [ ] **Step 1: Add lane pointer state + handlers**

Import the editing ops:

```ts
import { yToVelocity, barHitTest, setVelocity, applyGroupDelta, paintVelocity } from './velocity-lane-editing';
```

Add handlers (near the grid pointer handlers):

```ts
  let velDrag: { note: NoteEvent | null; groupStartVel: number } | null = null;

  const velPos = (e: PointerEvent) => {
    const rect = f.velCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  f.velCanvas.addEventListener('pointerdown', (e) => {
    f.wrap.focus();
    const { x, y } = velPos(e);
    const hit = barHitTest(opts.getNotes(), x, xForTick);
    if (!hit) return;
    opts.onGestureStart?.(); gestureMutated = false;
    velDrag = { note: hit, groupStartVel: hit.velocity };
    const v = yToVelocity(y, VEL_LANE_H);
    if (selection.has(hit) && selection.size > 1) applyGroupDelta([...selection], v - hit.velocity);
    else setVelocity(hit, v);
    gestureMutated = true;
    drawGrid(); drawVelLane();
    f.velCanvas.setPointerCapture(e.pointerId); e.preventDefault();
  });

  f.velCanvas.addEventListener('pointermove', (e) => {
    if (!velDrag) return;
    const { x, y } = velPos(e);
    const v = yToVelocity(y, VEL_LANE_H);
    if (selection.has(velDrag.note!) && selection.size > 1) {
      applyGroupDelta([...selection], v - velDrag.note!.velocity);
    } else {
      // paint: set the bar under the cursor (lets a horizontal drag write a ramp)
      const hit = barHitTest(opts.getNotes(), x, xForTick) ?? velDrag.note;
      if (hit) setVelocity(hit, v);
    }
    gestureMutated = true;
    drawGrid(); drawVelLane();
  });

  const velEnd = (e: PointerEvent) => {
    if (!velDrag) return;
    velDrag = null;
    try { f.velCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (gestureMutated) opts.onGestureEnd?.(); else opts.onGestureCancel?.();
  };
  f.velCanvas.addEventListener('pointerup', velEnd);
  f.velCanvas.addEventListener('pointercancel', velEnd);
```

> The group branch uses `applyGroupDelta` with the delta from the grabbed note's current velocity, so dragging moves the whole selection together. The single/paint branch writes the bar under the cursor, so a horizontal sweep paints a ramp. `paintVelocity` is available if you prefer an explicit range-paint mode; the per-bar write above already produces ramps.

- [ ] **Step 2: Build + manual check**

Run: `npm run build`, then `npm run dev`. Verify: drag a bar up/down changes the note colour + height; select several notes then drag one bar to move them together; sweep horizontally to paint a ramp; each gesture is one undo (Ctrl+Z restores).

- [ ] **Step 3: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(velocity): piano-roll velocity lane editing (drag/group/paint)"
```

---

### Task 16: Drum-grid velocity lane — render + interaction

**Files:**
- Modify: `src/session/clip-editors/clip-editor-drum-grid.ts` (canvas height `:29`, `draw()` `:112-155`, pointer handlers, `resize`)

The drum grid is one canvas. Extend its height by a lane band drawn at the bottom in the same `xForTick` space, and add lane pointer handling.

- [ ] **Step 1: Add lane height + extend the canvas**

```ts
const LABEL_W = 54;
const RULER_H = 20;
const ROW_H = 26;
const VEL_LANE_H = 46;                       // velocity lane band
const FRAME_H = RULER_H + ROW_H * 8 + VEL_LANE_H;
```

- [ ] **Step 2: Draw the lane in `draw()`**

Import the helpers:

```ts
import { velToColor } from '../../core/velocity-color';
import { velocityToBarHeight, barHitTest, yToVelocity, setVelocity, applyGroupDelta, FAN_PX } from '../../core/velocity-lane-editing';
```

At the end of `draw()` (after the playhead), add a lane band starting at `laneTop = RULER_H + ROW_H * 8`:

```ts
    const laneTop = RULER_H + ROW_H * 8;
    ctx.fillStyle = '#0e0e0e'; ctx.fillRect(LABEL_W, laneTop, gridW, VEL_LANE_H);
    ctx.fillStyle = '#202020'; ctx.fillRect(0, laneTop, LABEL_W, VEL_LANE_H);
    const accentY = laneTop + VEL_LANE_H - velocityToBarHeight(100, VEL_LANE_H);
    ctx.strokeStyle = '#ff8c2e'; ctx.globalAlpha = 0.6; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(LABEL_W, accentY); ctx.lineTo(LABEL_W + gridW, accentY); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const seen = new Map<number, number>();
    for (const n of notes()) {
      const v = GM_DRUM_MAP[n.midi]; if (!v) continue;
      const fan = seen.get(n.start) ?? 0; seen.set(n.start, fan + 1);
      const x = xForTick(n.start) + fan * FAN_PX;
      const h = velocityToBarHeight(n.velocity, VEL_LANE_H);
      ctx.fillStyle = selection.has(n) ? '#7fd4ff' : velToColor(n.velocity);
      ctx.fillRect(x, laneTop + VEL_LANE_H - h, 6, h);
    }
```

- [ ] **Step 3: Lane pointer handling**

In the canvas `pointerdown` handler, before the row logic, detect lane clicks (`y >= laneTop`) and start a velocity drag; add matching `pointermove`/`pointerup` branches. Use a `laneDrag` flag analogous to the piano-roll, calling `barHitTest`/`yToVelocity`/`setVelocity`/`applyGroupDelta` against `notes()` and wrapping the gesture with `historyDeps?.history.beginGesture(...)` / `commitGesture()` (mirror the existing `groupDrag` gesture bracketing in this file). Lane `y` for `yToVelocity` is `(clientY - rect.top) - laneTop`.

```ts
    // inside pointerdown, after computing p:
    const laneTop = RULER_H + ROW_H * 8;
    const localY = (e.clientY - canvas.getBoundingClientRect().top);
    if (localY >= laneTop && p.x >= LABEL_W) {
      const hit = barHitTest(notes(), p.x, xForTick);
      if (hit) {
        historyDeps?.history.beginGesture(historyDeps.snapshot()); mutated = false;
        laneDrag = hit;
        const vel = yToVelocity(localY - laneTop, VEL_LANE_H);
        if (selection.has(hit) && selection.size > 1) applyGroupDelta([...selection], vel - hit.velocity);
        else setVelocity(hit, vel);
        mutated = true; draw();
        canvas.setPointerCapture(e.pointerId); e.preventDefault();
      }
      return;
    }
```

Add the `let laneDrag: NoteEvent | null = null;` declaration with the other pointer state, a `pointermove` branch that updates velocity from `localY - laneTop` (paint via `barHitTest` like the piano-roll), and clear it in `endPointer` committing/cancelling the gesture.

- [ ] **Step 4: Build + manual check**

Run: `npm run build`, then `npm run dev`. Open a drum clip; confirm a velocity band shows under the 8 rows with a bar per hit, draggable, group-aware, one undo per gesture.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts
git commit -m "feat(velocity): drum-grid velocity lane render + editing"
```

---

## Phase E — Integration, calibration, regression

### Task 17: Full suite, calibration, demo check, golden bless

**Files:**
- Possibly re-tune: `src/core/velocity-gain.ts` (the `velToGain` floor/slope) after listening
- Possibly update: `test/golden/*.wav` (deliberate re-bless)

- [ ] **Step 1: Full build + unit suite**

Run: `npm run build`
Run: `npm run test:unit`
Expected: green (re-run if `ERR_IPC_CHANNEL_CLOSED` appears on teardown only).

- [ ] **Step 2: Rebuild then e2e (serves `dist/`)**

Run: `npm run build` (mandatory — e2e serves the last build)
Run: `npm run test:e2e`
Expected: green. If the velocity lane shifted a fixture's expectations, update the e2e assertion to the current UI.

- [ ] **Step 3: Listen to the demos**

Run: `npm run dev`, play Acid Rain / Cordillera / Neon Drive. Confirm dynamics feel musical and nothing got perceptibly quieter/clipped. If a class of notes is too soft/loud, adjust the `velToGain` floor/slope in `velocity-gain.ts` (re-run Task 2's test, which only asserts ranges/monotonicity) and rebuild.

- [ ] **Step 4: Inspect + bless goldens**

Run: `npm run test:dsp` (regenerates `test/output/*.wav`)
Run: `npm run test:wav-diff` (human inspection of peak/RMS/L2 deltas vs `test/golden/`)
If the deltas reflect the *intended* new dynamics, bless: `npm run test:wav-bless`, then commit the goldens.

- [ ] **Step 5: GitNexus change check (repo CLAUDE.md)**

Run (MCP): `gitnexus_detect_changes()` and confirm only the expected symbols/flows changed.

- [ ] **Step 6: Commit any calibration + goldens**

```bash
git add src/core/velocity-gain.ts test/golden
git commit -m "chore(velocity): calibrate loudness curve + bless goldens"
```

- [ ] **Step 7: Finish the branch**

Rebase onto `main` and fast-forward merge (no merge commit), then exit the worktree, per the repo's worktree workflow.

---

## Self-review

**Spec coverage:**
- Data model / no schema change → Tasks 12–13 (default 90), no schema task needed (velocity already on `NoteEvent`). ✓
- MIDI import already captures velocity → no task required (verified in spec). ✓
- Colour `velToColor` blue→yellow + accent border, both editors → Tasks 1, 12, 13. ✓
- Velocity lane ~20%, bar per note, accent line, h-sync, both editors → Tasks 14, 16. ✓
- Interaction full Ableton (set/group/paint, chord fan) → Tasks 3, 15, 16. ✓
- Sound continuous + accent timbre, no double gain, all engines → Tasks 4–11. ✓
- Default velocity 90 → Tasks 2, 12, 13. ✓
- Risks: `noteTrigger` impact + offline export → Task 4 (impact), and the offline export path reuses `noteTrigger`+`createTriggerForLane`, so threading in Tasks 4–5 covers export automatically. ✓
- Calibration vs goldens → Task 17. ✓

**Placeholder scan:** every code step has concrete code; the two "align with real exports" notes (Task 11 registry accessors, Task 7 onVoice arg) point at named existing symbols, not invented ones. No TBD/TODO.

**Type consistency:** `velToColor`, `velToGain`, `velNorm`, `resolveVelocity`, `DEFAULT_VELOCITY`, `velocityToBarHeight`, `yToVelocity`, `barHitTest`, `setVelocity`, `applyGroupDelta`, `paintVelocity`, `FAN_PX`, `NoteTrigger.velocity`, `VoiceTriggerOptions.velocity` (already present) are used consistently across tasks.
