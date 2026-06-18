# Scene / clip launch synced to loop-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make launching a scene an atomic switch of the whole session sound at one synchronized loop-end instant — lanes with a clip start, orphan lanes stop, nothing overlaps — and make single-clip launches wait for the current loop's end too.

**Architecture:** A new pure module `src/core/launch-timing.ts` computes the switch instant `T` from the currently-playing loops (loop-length math identical to the scheduler's `effectiveClipLoop`, plus an iterative outlier-cap rule for "the loop that governs"). `session-runtime.ts` uses it in `launchScene`/`launchClip`, gains a per-lane `queuedStop` boundary, and `tickSession` releases stopped/swapped lanes' live voices at `T`.

**Tech Stack:** TypeScript, Vitest, Web Audio (no new deps).

## Global Constraints

- **UI strings in English** (only conversation with the user is Spanish).
- **No schema change.** `queuedStop` is runtime-only (lives in `laneStates`, never in `SessionState`/`SavedStateV3`).
- **Hot swaps always sync to loop-end**; the quantize selector (`globalQuantize` / per-lane / per-clip `launchQuantize`) governs **cold starts only**.
- **Governing-loop rule operates on the multiset** of loop lengths (duplicates kept), comparing the single largest against the next; iterate while `largest > 2 × next`.
- **`T` must equal a real loop boundary** → loop length comes from `effectiveClipLoop` (same as `tickLane`), never from a bar grid.
- Test assertions: timing equalities are deterministic (assert exact boundary times). No absolute magnitude thresholds elsewhere.
- Run a single Vitest file colour-free with `NO_COLOR=1 npx vitest run <file>`.

---

### Task 1: `governingLoopSec` — iterative outlier cap (pure)

**Files:**
- Create: `src/core/launch-timing.ts`
- Test: `src/core/launch-timing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `governingLoopSec(lengths: number[]): number` — given loop lengths (any unit; the `>2×` test is scale-free), returns the governing length per the iterative multiset rule. Empty / all-non-positive → `0`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/launch-timing.test.ts
import { describe, it, expect } from 'vitest';
import { governingLoopSec } from './launch-timing';

describe('governingLoopSec — iterative outlier cap (multiset)', () => {
  const cases: Array<[number[], number]> = [
    [[1, 2, 4], 4],          // 4 > 2·2? no → keep 4
    [[2, 2, 4], 4],          // 4 > 2·2? no → keep 4
    [[4, 4, 1], 4],          // duplicated longest: 4 > 2·4? no → keep 4 (NOT distinct)
    [[1, 1, 8], 1],          // 8 > 2·1 → drop 8; 1 > 2·1? no → 1
    [[1, 2, 16], 2],         // 16 > 2·2 → drop; 2 > 2·1? no → 2
    [[1, 16, 40], 1],        // 40 > 2·16 → drop; 16 > 2·1 → drop; 1
    [[1, 2, 4, 16], 4],      // drop 16; 4 > 2·2? no → 4
    [[5], 5],                // single
    [[], 0],                 // empty
    [[0, -3, 2], 2],         // non-positive filtered out
  ];
  it.each(cases)('governingLoopSec(%j) === %d', (lengths, expected) => {
    expect(governingLoopSec(lengths)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/launch-timing.test.ts`
Expected: FAIL — `governingLoopSec` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/launch-timing.ts
// Pure helpers for "when does a scene/clip switch happen" — the switch instant
// T is the end of the loop that GOVERNS the currently-playing material.

/**
 * The governing loop length given the lengths of every currently-playing loop.
 * Rule (user-approved): sort the lengths WITH DUPLICATES (multiset) descending,
 * then while the single largest element is more than 2× the next element, drop
 * that one largest element and re-compare. The largest survivor governs.
 * `lengths` may be in seconds or bars (the ratio test is scale-free).
 */
export function governingLoopSec(lengths: number[]): number {
  const sorted = lengths.filter((l) => l > 0).sort((a, b) => b - a);
  if (sorted.length === 0) return 0;
  let i = 0;
  while (i < sorted.length - 1 && sorted[i] > 2 * sorted[i + 1]) i++;
  return sorted[i];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/launch-timing.test.ts`
Expected: PASS (10 cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/launch-timing.ts src/core/launch-timing.test.ts
git commit -m "feat(launch-timing): governing-loop iterative outlier cap"
```

---

### Task 2: `clipLoopSec` + `nextLoopEnd` (pure)

**Files:**
- Modify: `src/core/launch-timing.ts`
- Test: `src/core/launch-timing.test.ts`

**Interfaces:**
- Consumes: `effectiveClipLoop` from `./clip-loop`, `TICKS_PER_QUARTER` from `./notes`, `DEFAULT_METER`/`TimeSignature` from `./meter`, `SessionClip` from `../session/session`.
- Produces:
  - `clipLoopSec(clip: SessionClip, bpm: number, meter?: TimeSignature): number` — loop length in seconds, identical to `tickLane`'s `clipDurSec`. `0` if degenerate.
  - `nextLoopEnd(loopStartedAt: number, loopSec: number, now: number): number` — smallest `loopStartedAt + k·loopSec` with `k ≥ 1` that is `≥ now`. `loopSec ≤ 0` → returns `now`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/core/launch-timing.test.ts
import { clipLoopSec, nextLoopEnd } from './launch-timing';
import type { SessionClip } from '../session/session';

describe('clipLoopSec', () => {
  it('matches the scheduler: 2-bar clip at 120bpm in 4/4 = 4s', () => {
    const clip = { id: 'c', lengthBars: 2, notes: [] } as SessionClip;
    expect(clipLoopSec(clip, 120)).toBeCloseTo(4, 9); // 2 bars × 2 s/bar
  });
  it('1-bar clip at 120bpm = 2s', () => {
    const clip = { id: 'c', lengthBars: 1, notes: [] } as SessionClip;
    expect(clipLoopSec(clip, 120)).toBeCloseTo(2, 9);
  });
});

describe('nextLoopEnd', () => {
  it('mid-loop → next boundary', () => {
    expect(nextLoopEnd(0, 2, 3)).toBeCloseTo(4, 9);   // 3s into 2s loops → 4s
  });
  it('just started → first loop end', () => {
    expect(nextLoopEnd(10, 2, 10)).toBeCloseTo(12, 9);
  });
  it('exactly on a boundary → that boundary', () => {
    expect(nextLoopEnd(0, 2, 4)).toBeCloseTo(4, 9);
  });
  it('now before start → first loop end after start', () => {
    expect(nextLoopEnd(10, 2, 5)).toBeCloseTo(12, 9);
  });
  it('degenerate loopSec → now', () => {
    expect(nextLoopEnd(0, 0, 7)).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/launch-timing.test.ts`
Expected: FAIL — `clipLoopSec` / `nextLoopEnd` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `src/core/launch-timing.ts`:

```ts
import type { SessionClip } from '../session/session';
import { effectiveClipLoop } from './clip-loop';
import { TICKS_PER_QUARTER } from './notes';
import { DEFAULT_METER, type TimeSignature } from './meter';
```

Append these functions:

```ts
/** Loop length in seconds — wraps effectiveClipLoop so it equals the scheduler's
 *  clipDurSec exactly (T must land on a real loop boundary, not a bar grid). */
export function clipLoopSec(
  clip: SessionClip, bpm: number, meter: TimeSignature = DEFAULT_METER,
): number {
  if (bpm <= 0) return 0;
  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  const loopTicks = endTick - startTick;
  if (loopTicks <= 0) return 0;
  return (loopTicks / TICKS_PER_QUARTER) * (60 / bpm);
}

/** Next loop boundary >= now for a loop that started at loopStartedAt.
 *  k is forced >= 1 so a freshly-started loop returns its FIRST end, never now. */
export function nextLoopEnd(loopStartedAt: number, loopSec: number, now: number): number {
  if (loopSec <= 0) return now;
  const elapsed = now - loopStartedAt;
  const k = elapsed <= 0 ? 1 : Math.ceil(elapsed / loopSec);
  return loopStartedAt + k * loopSec;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/launch-timing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/launch-timing.ts src/core/launch-timing.test.ts
git commit -m "feat(launch-timing): clipLoopSec + nextLoopEnd"
```

---

### Task 3: `sceneSwitchBoundary` (pure)

**Files:**
- Modify: `src/core/launch-timing.ts`
- Test: `src/core/launch-timing.test.ts`

**Interfaces:**
- Consumes: `governingLoopSec`, `nextLoopEnd` (this module).
- Produces: `sceneSwitchBoundary(playing: { loopStartedAt: number; loopSec: number }[], now: number): number` — the synchronized switch instant. Empty / all-degenerate → `now`. Among clips whose `loopSec` equals the governing length, returns the **soonest** `nextLoopEnd` (never wait longer than necessary).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/core/launch-timing.test.ts
import { sceneSwitchBoundary } from './launch-timing';

describe('sceneSwitchBoundary', () => {
  it('single playing clip → its own next loop end', () => {
    expect(sceneSwitchBoundary([{ loopStartedAt: 0, loopSec: 2 }], 3)).toBeCloseTo(4, 9);
  });
  it('equal-length aligned clips → shared boundary', () => {
    const p = [{ loopStartedAt: 0, loopSec: 2 }, { loopStartedAt: 0, loopSec: 2 }];
    expect(sceneSwitchBoundary(p, 3)).toBeCloseTo(4, 9);
  });
  it('mixed lengths, no outlier → governed by the longest (4s loop)', () => {
    // lengths 2s & 4s; 4 > 2·2? no → governs 4s; aligned at 0 → next end 8s when now=5
    const p = [{ loopStartedAt: 0, loopSec: 2 }, { loopStartedAt: 0, loopSec: 4 }];
    expect(sceneSwitchBoundary(p, 5)).toBeCloseTo(8, 9);
  });
  it('giant outlier dropped → governed by the 2s loop', () => {
    // lengths 2s & 16s; 16 > 2·2 → drop → governs 2s; now=5 → next 2s end is 6s
    const p = [{ loopStartedAt: 0, loopSec: 2 }, { loopStartedAt: 0, loopSec: 16 }];
    expect(sceneSwitchBoundary(p, 5)).toBeCloseTo(6, 9);
  });
  it('empty → now', () => {
    expect(sceneSwitchBoundary([], 5)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/launch-timing.test.ts`
Expected: FAIL — `sceneSwitchBoundary` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/launch-timing.ts`:

```ts
/** The synchronized switch instant from the currently-playing loops. */
export function sceneSwitchBoundary(
  playing: { loopStartedAt: number; loopSec: number }[],
  now: number,
): number {
  const valid = playing.filter((p) => p.loopSec > 0);
  if (valid.length === 0) return now;
  const gov = governingLoopSec(valid.map((p) => p.loopSec));
  const EPS = 1e-6;
  let best = Infinity;
  for (const p of valid) {
    if (Math.abs(p.loopSec - gov) > EPS) continue;
    const t = nextLoopEnd(p.loopStartedAt, p.loopSec, now);
    if (t < best) best = t;
  }
  return best === Infinity ? now : best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/launch-timing.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/launch-timing.ts src/core/launch-timing.test.ts
git commit -m "feat(launch-timing): sceneSwitchBoundary (governing loop end)"
```

---

### Task 4: `launchClip` waits for the lane's current loop end

**Files:**
- Modify: `src/session/session-runtime.ts` (the `launchClip` function, ~107-121)
- Modify (callers): `src/session/session-host-callbacks.ts:83-84`, `src/session/session-host.ts:126-127`
- Test: `src/session/session-runtime-launch.test.ts` (new file)

**Interfaces:**
- Consumes: `clipLoopSec`, `nextLoopEnd` from `../core/launch-timing`; `DEFAULT_METER`/`TimeSignature` from `../core/meter`.
- Produces: new signature
  `launchClip(laneStates, state, lane, clip, now, bpm, meter?: TimeSignature, _hooks?: RecHooks): void`.
  Behavior: if the lane is **currently playing**, `queuedBoundary = nextLoopEnd(lp.loopStartedAt, clipLoopSec(lp.playing, bpm, meter), now)`; otherwise unchanged cold path (`nextBoundary(effectiveQuantize(...), now, bpm)`).

- [ ] **Step 1: Write the failing test**

```ts
// src/session/session-runtime-launch.test.ts
import { describe, it, expect } from 'vitest';
import { launchClip, emptyLanePlayState, type LanePlayState } from './session-runtime';
import type { SessionState, SessionClip, SessionLane } from './session';

const BPM = 120; // 1 bar = 2s in 4/4

function setup(playingBars: number | null) {
  const playing: SessionClip = { id: 'old', lengthBars: 2, notes: [] };
  const next: SessionClip = { id: 'new', lengthBars: 1, notes: [] };
  const lane: SessionLane = { id: 'L', engineId: 'subtractive', clips: [playing, next] };
  const state: SessionState = { lanes: [lane], scenes: [], globalQuantize: 'immediate' };
  const lp: LanePlayState = { ...emptyLanePlayState('L') };
  if (playingBars != null) { lp.playing = playing; lp.loopStartedAt = 0; }
  const laneStates = new Map([['L', lp]]);
  return { state, lane, next, laneStates, lp };
}

describe('launchClip hot-swap waits for the current loop end', () => {
  it('lane already playing → queues at the current clip loop end', () => {
    const { state, lane, next, laneStates, lp } = setup(2);
    // old clip is 2 bars = 4s, started at 0; now = 3 → next loop end = 4
    launchClip(laneStates, state, lane, next, /*now=*/3, BPM);
    expect(lp.queued).toBe(next);
    expect(lp.queuedBoundary).toBeCloseTo(4, 9);
  });

  it('cold lane (nothing playing) → uses the quantize grid (immediate)', () => {
    const { state, lane, next, laneStates, lp } = setup(null);
    launchClip(laneStates, state, lane, next, /*now=*/3, BPM); // globalQuantize 'immediate'
    expect(lp.queued).toBe(next);
    expect(lp.queuedBoundary).toBeCloseTo(3, 9); // immediate → now
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime-launch.test.ts`
Expected: FAIL — hot-swap returns the bar-grid boundary, not `4`.

- [ ] **Step 3: Write minimal implementation**

In `src/session/session-runtime.ts`, add to the existing imports:

```ts
import { clipLoopSec, nextLoopEnd, sceneSwitchBoundary } from '../core/launch-timing';
```

(`DEFAULT_METER` / `TimeSignature` are already imported from `../core/meter`.)

Replace `launchClip` with:

```ts
export function launchClip(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  lane: SessionLane,
  clip: SessionClip,
  now: number,
  bpm: number,
  meter: TimeSignature = DEFAULT_METER,
  _hooks?: RecHooks,
): void {
  let lp = laneStates.get(lane.id);
  if (!lp) { lp = emptyLanePlayState(lane.id); laneStates.set(lane.id, lp); }
  lp.queued = clip;
  if (lp.playing) {
    // Hot swap: wait for THIS lane's current clip to finish its loop (no premature
    // entry). No outlier cap — it is a single loop.
    const loopSec = clipLoopSec(lp.playing, bpm, meter);
    lp.queuedBoundary = nextLoopEnd(lp.loopStartedAt, loopSec, now);
  } else {
    // Cold start: nothing to sync to → the quantize grid governs.
    const q = effectiveQuantize(state, lane, clip);
    lp.queuedBoundary = nextBoundary(q, now, bpm);
  }
}
```

Update the two callers to pass meter before `_hooks`:

`src/session/session-host-callbacks.ts:83-84` →
```ts
        launchClip(self.laneStates, self.state, lane, clip, ctx.currentTime, seq.bpm,
          seq.meter, self.deps.recHooks);
```

`src/session/session-host.ts:126-127` →
```ts
      launchClip(this.laneStates, this.state, lane, clip,
        this.deps.ctx.currentTime, this.deps.seq.bpm, this.deps.seq.meter, this.deps.recHooks);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime-launch.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/launch-timing.ts src/session/session-runtime.ts src/session/session-runtime-launch.test.ts src/session/session-host-callbacks.ts src/session/session-host.ts
git commit -m "feat(session): single-clip launch waits for the current loop end"
```

---

### Task 5: `launchScene` — atomic switch (start / stop orphans / skip unchanged) at `T`

**Files:**
- Modify: `src/session/session-runtime.ts` (`LanePlayState`, `emptyLanePlayState`, `launchScene`)
- Modify (callers): `src/session/session-host-callbacks.ts:132`, `src/session/session-host.ts:137`
- Test: `src/session/session-runtime-scene.test.ts` (new file)

**Interfaces:**
- Consumes: `sceneSwitchBoundary`, `clipLoopSec` from `../core/launch-timing`.
- Produces:
  - `LanePlayState` gains `queuedStop: number | null` (boundary time at which the lane stops; `null` = no pending stop). `emptyLanePlayState` sets it `null`.
  - new signature `launchScene(laneStates, state, scene, sceneIdx, now, bpm, meter?: TimeSignature): void`.
  - Behavior at one shared boundary `T`:
    - lane whose target cell has a clip **and is not already playing that exact clip** → `queued = clip; queuedBoundary = T`;
    - lane already playing the exact target clip → left running (no retrigger);
    - lane currently playing **and** target cell empty/null → `queuedStop = T`;
    - `T = sceneSwitchBoundary(playingLoops, now)` when anything plays, else `nextBoundary(globalQuantize/lane, now, bpm)` (cold).

- [ ] **Step 1: Write the failing test**

```ts
// src/session/session-runtime-scene.test.ts
import { describe, it, expect } from 'vitest';
import { launchScene, emptyLanePlayState, type LanePlayState } from './session-runtime';
import type { SessionState, SessionClip, SessionLane, SessionScene } from './session';

const BPM = 120; // 1 bar = 2s

// Three lanes. Lane A: bass 2-bar (4s). Lane B: drums 1-bar (2s). Lane C: pad 16-bar (32s).
// Scene 0 (currently playing) = row 0 clips. Scene 1 = row 1 clips:
//   A has a row-1 clip, B has a row-1 clip, C has NO row-1 clip (orphan → must stop).
function setup() {
  const aOld: SessionClip = { id: 'a0', lengthBars: 2, notes: [] };
  const aNew: SessionClip = { id: 'a1', lengthBars: 2, notes: [] };
  const bOld: SessionClip = { id: 'b0', lengthBars: 1, notes: [] };
  const bNew: SessionClip = { id: 'b1', lengthBars: 1, notes: [] };
  const cOld: SessionClip = { id: 'c0', lengthBars: 16, notes: [] };

  const lanes: SessionLane[] = [
    { id: 'A', engineId: 'subtractive', clips: [aOld, aNew] },
    { id: 'B', engineId: 'subtractive', clips: [bOld, bNew] },
    { id: 'C', engineId: 'subtractive', clips: [cOld, null] },
  ];
  const scenes: SessionScene[] = [
    { id: 's0', clipPerLane: {} },
    { id: 's1', clipPerLane: {} }, // positional: row 1
  ];
  const state: SessionState = { lanes, scenes, globalQuantize: '1/1' };

  const laneStates = new Map<string, LanePlayState>([
    ['A', { ...emptyLanePlayState('A'), playing: aOld, loopStartedAt: 0 }],
    ['B', { ...emptyLanePlayState('B'), playing: bOld, loopStartedAt: 0 }],
    ['C', { ...emptyLanePlayState('C'), playing: cOld, loopStartedAt: 0 }],
  ]);
  return { state, scenes, laneStates, aNew, bNew };
}

describe('launchScene — atomic switch synced to governing loop end', () => {
  it('governs by the 4s bass loop (16s pad is an outlier → dropped); B,A queue, C stops, all at T', () => {
    const { state, scenes, laneStates, aNew, bNew } = setup();
    // lengths 4s,2s,32s → drop 32 (32>2·4); then 4>2·2? no → governs 4s.
    // aligned at 0, now=5 → next 4s end = 8s.
    launchScene(laneStates, state, scenes[1], 1, /*now=*/5, BPM);
    const A = laneStates.get('A')!, B = laneStates.get('B')!, C = laneStates.get('C')!;
    expect(A.queued).toBe(aNew); expect(A.queuedBoundary).toBeCloseTo(8, 9);
    expect(B.queued).toBe(bNew); expect(B.queuedBoundary).toBeCloseTo(8, 9);
    expect(C.queued).toBeNull(); expect(C.queuedStop).toBeCloseTo(8, 9); // orphan stops at T
  });

  it('a lane already playing the exact target clip is left running (no retrigger)', () => {
    const { state, scenes, laneStates } = setup();
    // Make scene 1 target for A be the SAME clip A is already playing (id a0 at row 1).
    state.lanes[0].clips[1] = state.lanes[0].clips[0]; // row1 of A === aOld
    launchScene(laneStates, state, scenes[1], 1, 5, BPM);
    const A = laneStates.get('A')!;
    expect(A.queued).toBeNull();        // not re-queued
    expect(A.queuedStop).toBeNull();    // not stopped
    expect(A.playing!.id).toBe('a0');   // still playing, same phase
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime-scene.test.ts`
Expected: FAIL — `queuedStop` is undefined; boundary uses bar grid not loop end; orphan C not stopped.

- [ ] **Step 3: Write minimal implementation**

In `src/session/session-runtime.ts`:

Add `queuedStop` to the `LanePlayState` interface (just after `queuedBoundary`):

```ts
  queuedBoundary: number;
  /** Absolute audio time at which this lane STOPS (orphan lane on scene launch).
   *  null = no pending stop. Runtime-only; never persisted. */
  queuedStop: number | null;
```

Set it in `emptyLanePlayState`:

```ts
    queued: null,
    queuedBoundary: 0,
    queuedStop: null,
    startTime: 0,
```

Replace `launchScene` with:

```ts
export function launchScene(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  scene: { clipPerLane: Record<string, number | null> },
  sceneIdx: number,
  now: number,
  bpm: number,
  meter: TimeSignature = DEFAULT_METER,
): void {
  // Resolve every lane's target (explicit mapping wins, else the row index).
  // null target = "this lane plays nothing in this scene".
  const starts: { lane: SessionLane; clip: SessionClip }[] = [];
  const stops: SessionLane[] = [];
  for (const lane of state.lanes) {
    const lp = laneStates.get(lane.id);
    const hasExplicit = Object.prototype.hasOwnProperty.call(scene.clipPerLane, lane.id);
    const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx;
    const clip = idx == null ? null : lane.clips[idx] ?? null;
    if (clip) {
      // Already playing this exact clip → leave it running (seamless, in-phase).
      if (lp?.playing && lp.playing.id === clip.id) continue;
      starts.push({ lane, clip });
    } else if (lp?.playing) {
      stops.push(lane); // orphan: playing but the new scene has nothing here
    }
  }
  if (starts.length === 0 && stops.length === 0) return;

  // The shared switch instant: the governing loop end if anything is playing,
  // else the cold-start quantize grid.
  const playingLoops: { loopStartedAt: number; loopSec: number }[] = [];
  for (const lane of state.lanes) {
    const lp = laneStates.get(lane.id);
    if (!lp?.playing) continue;
    playingLoops.push({ loopStartedAt: lp.loopStartedAt, loopSec: clipLoopSec(lp.playing, bpm, meter) });
  }
  let T: number;
  if (playingLoops.length > 0) {
    T = sceneSwitchBoundary(playingLoops, now);
  } else {
    let b = -1;
    for (const { lane } of starts) {
      const q = lane.launchQuantize ?? state.globalQuantize;
      const bb = nextBoundary(q, now, bpm);
      if (bb > b) b = bb;
    }
    T = b < 0 ? now : b;
  }

  for (const { lane, clip } of starts) {
    let lp = laneStates.get(lane.id);
    if (!lp) { lp = emptyLanePlayState(lane.id); laneStates.set(lane.id, lp); }
    lp.queued = clip;
    lp.queuedBoundary = T;
    lp.queuedStop = null; // a fresh launch cancels any pending stop
  }
  for (const lane of stops) {
    const lp = laneStates.get(lane.id);
    if (lp) lp.queuedStop = T;
  }
}
```

Update the two callers to pass meter:

`src/session/session-host-callbacks.ts:132` →
```ts
      launchScene(self.laneStates, self.state, scene, idx, ctx.currentTime, seq.bpm, seq.meter);
```

`src/session/session-host.ts:137` →
```ts
    launchScene(this.laneStates, this.state, scene, sceneIdx, this.deps.ctx.currentTime, this.deps.seq.bpm, this.deps.seq.meter);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime-scene.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors. (If other files construct a `LanePlayState` literal without `queuedStop`, add `queuedStop: null` to them — known sites: `session-host-callbacks.ts` ~72 and `session-host.ts` ~117 build inline literals.)

- [ ] **Step 5: Commit**

```bash
git add src/session/session-runtime.ts src/session/session-runtime-scene.test.ts src/session/session-host-callbacks.ts src/session/session-host.ts
git commit -m "feat(session): atomic scene launch synced to governing loop end + orphan stop"
```

---

### Task 6: `tickSession` — release stopped/swapped lanes' voices at `T`

**Files:**
- Modify: `src/session/session-runtime.ts` (`tickSession`)
- Test: `src/session/session-runtime-scene.test.ts` (extend)

**Interfaces:**
- Consumes: `LanePlayState.queuedStop` (Task 5).
- Produces: new trailing optional param
  `tickSession(..., hooks?, meter?, silence?: { silenceLane(laneId: string, atSec: number): void })`.
  Behavior:
  - When a lane is promoted `queued → playing` at the boundary, call `silence?.silenceLane(laneId, lp.queuedBoundary)` **before** swapping, so the old voices release at `T` and the new clip's voices (created later in the same tick) survive.
  - When `lp.queuedStop != null && now + lookahead >= lp.queuedStop`: call `silence?.silenceLane(laneId, lp.queuedStop)`, then `lp.playing = null; lp.queuedStop = null;`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/session/session-runtime-scene.test.ts
import { tickSession } from './session-runtime';

describe('tickSession applies queuedStop + silences at the boundary', () => {
  it('orphan lane is released at T and its live voices silenced', () => {
    const { state, laneStates } = setup();
    const C = laneStates.get('C')!;
    C.queuedStop = 8; // from launchScene
    const silenced: Array<{ laneId: string; at: number }> = [];
    const silence = { silenceLane: (laneId: string, at: number) => silenced.push({ laneId, at }) };
    // tick whose look-ahead window reaches T=8: now=7.9, look=0.2
    tickSession(laneStates, state, 7.9, 0.2, BPM, () => {}, () => {}, undefined, undefined, silence);
    expect(C.playing).toBeNull();
    expect(C.queuedStop).toBeNull();
    expect(silenced).toContainEqual({ laneId: 'C', at: 8 });
  });

  it('does not stop before the boundary is within look-ahead', () => {
    const { state, laneStates } = setup();
    const C = laneStates.get('C')!;
    C.queuedStop = 8;
    tickSession(laneStates, state, 5, 0.2, BPM, () => {}, () => {}, undefined, undefined,
      { silenceLane: () => {} });
    expect(C.playing).not.toBeNull(); // 5 + 0.2 < 8 → still playing
    expect(C.queuedStop).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime-scene.test.ts`
Expected: FAIL — `tickSession` ignores `queuedStop`; 10th arg unused.

- [ ] **Step 3: Write minimal implementation**

Change the `tickSession` signature (add the trailing `silence` param):

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
  silence?: { silenceLane(laneId: string, atSec: number): void },
): void {
```

Inside the per-lane loop, replace the promotion block and add the stop handling. The promotion block becomes:

```ts
    // Promote queued → playing once we cross the boundary
    if (lp.queued && now + lookahead >= lp.queuedBoundary) {
      // Release any old/long voices on this lane AT the boundary so a non-aligned
      // tail can't bleed past the switch; new voices are created later this tick
      // (after this call) and are therefore not affected.
      if (lp.playing) silence?.silenceLane(lane.id, lp.queuedBoundary);
      lp.playing = lp.queued;
      lp.queued = null;
      lp.startTime = lp.queuedBoundary;
      lp.loopStartedAt = lp.queuedBoundary;
      lp.nextStepIdx = 0;
      lp.loopCount = 0;
      lp.lastScheduledAt = -Infinity;
      if (hooks?.rec.recording) {
        const at = arrangementNow(hooks.rec, lp.queuedBoundary);
        appendClipEvent(hooks.arrangement, lane.id, lp.playing!.id, at);
      }
    }

    // Stop an orphan lane at its boundary (scene launch left it with no clip).
    if (lp.queuedStop != null && now + lookahead >= lp.queuedStop) {
      silence?.silenceLane(lane.id, lp.queuedStop);
      lp.playing = null;
      lp.queuedStop = null;
    }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime-scene.test.ts src/session/session-runtime.test.ts src/session/session-runtime-rec.test.ts`
Expected: PASS (existing tests omit the new param → `silence` undefined → no-op).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-runtime.ts src/session/session-runtime-scene.test.ts
git commit -m "feat(session): tickSession releases stopped/swapped lanes at the boundary"
```

---

### Task 7: Wire the silencer into the live tick

**Files:**
- Modify: `src/session/session-host.ts` (the `seq.sessionTick` closure, ~207-218)

**Interfaces:**
- Consumes: `tickSession` 10th param (Task 6); `this.deps.liveVoices` (implements `silenceLane(laneId, atSec)`).
- Produces: live scene/clip swaps and orphan stops actually cut audio at `T`.

- [ ] **Step 1: Pass the silencer**

In `src/session/session-host.ts`, update the `tickSession(...)` call:

```ts
    this.deps.seq.sessionTick = (now, look) => {
      tickSession(
        this.laneStates, this.state, now, look, this.deps.seq.bpm,
        (laneId, midi, scheduleTime, gateSec, accent, slidingIn, sample, velocity) =>
          this.deps.triggerForLane(laneId, midi, scheduleTime, gateSec, accent, slidingIn, sample, velocity),
        (laneId, _clipId, _stepInClip, stepTime) =>
          this.deps.markTrackActive(laneId, stepTime),
        this.deps.recHooks,
        this.deps.seq.meter,
        this.deps.liveVoices,
      );
      if (this.deps.onAfterTick) this.deps.onAfterTick(now, look);
    };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `this.deps.liveVoices` is optional in `session-host-deps.ts`, the call still type-checks because `silence` is optional; confirm `liveVoices` exposes `silenceLane`.)

- [ ] **Step 3: Commit**

```bash
git add src/session/session-host.ts
git commit -m "feat(session): wire live-voice silencer into the session tick"
```

---

### Task 8: Visual "stopping" state for orphan lanes

**Files:**
- Modify: `src/session/session-ui.ts` (the `clipCell` function, ~246-256)
- Modify: `src/styles/_session-grid.scss` (~100)

**Interfaces:**
- Consumes: `LanePlayState.queuedStop`, `lp.playing`.
- Produces: the still-playing clip of a lane with a pending stop renders `.session-cell-stopping` (pulsing) until it stops. (Queued-to-START clips already get `.session-cell-queued` because `launchScene` sets `lp.queued` — no change needed there.)

- [ ] **Step 1: Add the class in `clipCell`**

In `src/session/session-ui.ts`, after the existing `isQueued` line (~248), add:

```ts
  const isStopping = !!(clip && lp?.playing && lp.playing.id === clip.id && lp.queuedStop != null);
```

and where the classes are applied (~255-256), add:

```ts
    if (isStopping) cell.classList.add('session-cell-stopping');
```

- [ ] **Step 2: Add the style**

In `src/styles/_session-grid.scss`, after the `.session-cell-queued` block (~100-104), add:

```scss
.session-cell-stopping { animation: stopping-pulse 0.6s infinite alternate; }
@keyframes stopping-pulse {
  from { outline: 2px solid var(--red); outline-offset: -2px; }
  to   { outline: 2px solid #5a1d1d; outline-offset: -2px; }
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/session/session-ui.ts src/styles/_session-grid.scss
git commit -m "feat(session-ui): pulsing 'stopping' state for orphan lanes pending stop"
```

---

### Task 9: Full green + build + live verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + unit suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run test:unit`
Expected: all pass. (A non-zero exit with `ERR_IPC_CHANNEL_CLOSED` *after* "passed" is the known flaky teardown — re-run to confirm; it is not a failure.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: tsc + bundle succeed.

- [ ] **Step 3: Live verify (browser look — required, not optional)**

Run: `npm run dev` and open `http://localhost:5173`. Verify by ear + eye:
1. Load a demo with several lanes of different clip lengths (e.g. one long pad + short drums/bass).
2. Launch scene A, then launch scene B mid-loop. Confirm: the new clips do **not** enter until the governing loop end; the launched clips pulse **amber (queued)** until they start; **no** old+new overlap.
3. A lane with **no clip** in scene B → its currently-playing clip pulses **red (stopping)** and goes silent at the switch, not before.
4. A giant outlier loop (≥ 2× the next) does not make everything wait — the switch happens at the next-longest loop's end, and the giant is cut.
5. Launch a single clip onto a lane already playing → it waits for that lane's loop end, no overlap.

- [ ] **Step 4: Update memory + finish**

Per the user's workflow: report results, then on explicit permission rebase onto `main` and `git merge --ff-only`.

```bash
git rebase main
NO_COLOR=1 npm run test:unit   # re-confirm green after rebase
```

(Do NOT merge to `main` without explicit user permission — see the user's standing rule.)

---

## Self-Review

**Spec coverage:**
- Atomic scene switch (start/stop/skip-unchanged) → Task 5. ✓
- Governing loop iterative cap (multiset) → Task 1 (+ table). ✓
- `T` from `effectiveClipLoop` → Task 2 `clipLoopSec`. ✓
- `nextLoopEnd` / `sceneSwitchBoundary` → Tasks 2–3. ✓
- Single-clip hot-swap waits for loop end → Task 4. ✓
- `queuedStop` runtime field + tickSession release → Tasks 5–6. ✓
- Silence non-aligned tails at `T` → Tasks 6–7. ✓
- Quantize selector governs cold starts only → Tasks 4 (`else` branch) & 5 (cold branch). ✓
- Visual queued/stopping feedback → Task 8 (queued reused; stopping added). ✓
- "Scene N sounds exactly row N, others silenced" resolution guard → Task 5 tests (orphan stop) + the live verify step 3; the resolver in Task 5 stops every uncovered playing lane, which is the assertion. ✓
- No schema change → `queuedStop` runtime-only (Task 5). ✓

**Placeholder scan:** none — every code step shows full code; commands have expected output.

**Type consistency:** `clipLoopSec(clip, bpm, meter?)`, `nextLoopEnd(loopStartedAt, loopSec, now)`, `sceneSwitchBoundary(playing[], now)`, `governingLoopSec(lengths[])`, `launchClip(..., meter?, _hooks?)`, `launchScene(..., meter?)`, `tickSession(..., hooks?, meter?, silence?)`, `LanePlayState.queuedStop: number | null` — used identically across tasks. The `silence` shape `{ silenceLane(laneId, atSec) }` matches `LiveVoiceRegistry.silenceLane(laneId, now)`.

**Known follow-through:** Task 5 Step 4 flags inline `LanePlayState` literals (callbacks ~72, host ~117) that must gain `queuedStop: null` for tsc — handle them when they surface.
