# Performance View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second top-level UI mode (`Session | Performance`) that records (a) clip-launches and (b) automation gestures into a new `ArrangementState`, then plays the arrangement back with its own transport, reusing the existing engines and `session-runtime`.

**Architecture:** A new pure module `src/performance/` owns the data model and helpers (`performance.ts`, `arrangement-ops.ts`, `rec-state.ts`, `arrangement-runtime.ts`). REC capture re-uses the existing `KnobHandle.onValueChanged` hook and `automationRecording` flag in `main.ts` — the existing recorder is **redirected** from `seq.pattern.automation` to the new arrangement. Clip launches are captured by hooks added to the `launchClip`/`stopLane`/`launchScene` functions in `session-runtime.ts`. Playback adds a new branch to the lookahead loop in `main.ts` that calls into a new `tickArrangement` mirroring `tickSession`. UI is a brand-new DOM subtree under `#performance-view` toggled by the mode flag; the existing Session DOM gets hidden when the mode switches.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), Web Audio API, SCSS. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-29-performance-view-design.md](../specs/2026-05-29-performance-view-design.md)

**Depends on:** session view + session-runtime (merged on `main`).

**Plan verified against HEAD on 2026-05-29.** Confirmed: `KnobHandle.onValueChanged: (v, fromUser) => void` already exists at [src/core/knob.ts:38](../../src/core/knob.ts#L38) and is fired for both knobs and select controls; `automationRecording` flag and `#rec` HTML button already exist at [src/main.ts:221](../../src/main.ts#L221) and [src/main.ts:805](../../src/main.ts#L805) — current behavior writes into `seq.pattern.automation` and will be redirected. `SavedStateV3` parser at [src/save/saved-state-v3.ts:69](../../src/save/saved-state-v3.ts#L69) only checks `schemaVersion === 3` and accepts extra fields — adding optional `arrangement` and `mode` requires no schema bump.

---

## Phase 0 — Worktree + rebase

### Task 1: Create isolated worktree and rebase against main

**Files:** none (git-only).

- [ ] **Step 1: Confirm clean main, fetch latest**

Run from the repo root (`c:/Users/nacho/git/tb303-synth`):

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

Expected: working tree clean (or only the unrelated untracked files already present in `git status`). If `pull` is not fast-forward, stop and ask the user.

- [ ] **Step 2: Create worktree on a new branch**

```bash
git worktree add ../tb303-synth-performance -b feat/performance-view main
cd ../tb303-synth-performance
```

Expected: a fresh worktree at sibling path `../tb303-synth-performance` checked out on `feat/performance-view`.

- [ ] **Step 3: Install deps + smoke test that it builds**

```bash
npm install
npm run test:fast
```

Expected: green. All subsequent tasks run from inside the worktree directory.

- [ ] **Step 4: No commit** — this task only sets up the workspace.

---

## Phase A — Pure model

The data types and operations are pure and testable in isolation. Build them first, no audio side-effects.

### Task 2: Types + factories in `src/performance/performance.ts`

**Files:**

- Create: `src/performance/performance.ts`
- Create: `src/performance/performance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/performance/performance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  emptyArrangementState, emptyLaneRec,
  type ArrangementState, type ArrangementLaneRec,
} from './performance';

describe('emptyArrangementState', () => {
  it('returns durationSec=0, empty lanes, empty globalAutomation, bpm preserved', () => {
    const s: ArrangementState = emptyArrangementState(130);
    expect(s.bpm).toBe(130);
    expect(s.durationSec).toBe(0);
    expect(s.lanes).toEqual([]);
    expect(s.globalAutomation).toEqual([]);
  });
});

describe('emptyLaneRec', () => {
  it('produces an empty record for a given laneId', () => {
    const r: ArrangementLaneRec = emptyLaneRec('tb-303-1');
    expect(r.laneId).toBe('tb-303-1');
    expect(r.clipEvents).toEqual([]);
    expect(r.automation).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/performance/performance.test.ts
```

Expected: fails with "Cannot find module './performance'".

- [ ] **Step 3: Implement `src/performance/performance.ts`**

```typescript
// Performance view data model. Pure types and pure helpers only — no audio
// side effects. Mirror role of session.ts for the Session view.

export interface ArrangementClipEvent {
  clipId: string;
  laneId: string;
  atSec: number;
  untilSec: number;
}

export interface AutomationCurve {
  paramId: string;
  /** Samples at AUTOMATION_SUB_RES per 16th-step at the arrangement's bpm.
   *  Length = ceil(durationSec * stepsPerSec * AUTOMATION_SUB_RES). */
  samples: number[];
}

export interface ArrangementLaneRec {
  laneId: string;
  clipEvents: ArrangementClipEvent[];
  automation: AutomationCurve[];
}

export interface ArrangementState {
  bpm: number;
  durationSec: number;
  lanes: ArrangementLaneRec[];
  globalAutomation: AutomationCurve[];
}

export function emptyArrangementState(bpm: number): ArrangementState {
  return { bpm, durationSec: 0, lanes: [], globalAutomation: [] };
}

export function emptyLaneRec(laneId: string): ArrangementLaneRec {
  return { laneId, clipEvents: [], automation: [] };
}

/** 16th-notes per second at the given bpm. Mirrors the rest of the codebase
 *  (1 beat = 4 sixteenth steps). */
export function stepsPerSec(bpm: number): number {
  return (bpm / 60) * 4;
}
```

- [ ] **Step 4: Run the test, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/performance.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/performance/performance.ts src/performance/performance.test.ts
git commit -m "feat(performance): ArrangementState types + factories"
```

---

### Task 3: `appendClipEvent` with overdub semantics

**Files:**

- Create: `src/performance/arrangement-ops.ts`
- Create: `src/performance/arrangement-ops.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/performance/arrangement-ops.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { emptyArrangementState, emptyLaneRec } from './performance';
import {
  appendClipEvent, closePendingClipEvent, getOrCreateLane,
} from './arrangement-ops';

describe('getOrCreateLane', () => {
  it('creates a new lane record on first call, returns the same on second', () => {
    const s = emptyArrangementState(120);
    const a = getOrCreateLane(s, 'lane-a');
    expect(s.lanes).toHaveLength(1);
    const b = getOrCreateLane(s, 'lane-a');
    expect(b).toBe(a);
    expect(s.lanes).toHaveLength(1);
  });
});

describe('appendClipEvent', () => {
  it('appends an open-ended event (untilSec = +Infinity)', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0.5);
    const lane = s.lanes[0];
    expect(lane.clipEvents).toHaveLength(1);
    expect(lane.clipEvents[0]).toMatchObject({
      clipId: 'clip-1', laneId: 'lane-a', atSec: 0.5, untilSec: Infinity,
    });
  });

  it('overdub: new event closes the previous open event in the same lane', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    appendClipEvent(s, 'lane-a', 'clip-2', 2);
    const lane = s.lanes[0];
    expect(lane.clipEvents).toHaveLength(2);
    expect(lane.clipEvents[0].untilSec).toBe(2);
    expect(lane.clipEvents[1].untilSec).toBe(Infinity);
  });

  it('does not touch events in other lanes', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    appendClipEvent(s, 'lane-b', 'clip-2', 1);
    expect(s.lanes[0].clipEvents[0].untilSec).toBe(Infinity);
    expect(s.lanes[1].clipEvents[0].untilSec).toBe(Infinity);
  });
});

describe('closePendingClipEvent', () => {
  it('sets untilSec on the last open event', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    closePendingClipEvent(s, 'lane-a', 3);
    expect(s.lanes[0].clipEvents[0].untilSec).toBe(3);
  });

  it('is a no-op when the lane has no events', () => {
    const s = emptyArrangementState(120);
    expect(() => closePendingClipEvent(s, 'lane-a', 3)).not.toThrow();
  });

  it('is a no-op when the last event is already closed', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'lane-a', 'clip-1', 0);
    closePendingClipEvent(s, 'lane-a', 3);
    closePendingClipEvent(s, 'lane-a', 5);
    expect(s.lanes[0].clipEvents[0].untilSec).toBe(3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts
```

Expected: fails with "Cannot find module './arrangement-ops'".

- [ ] **Step 3: Implement `src/performance/arrangement-ops.ts`**

```typescript
import { emptyLaneRec, type ArrangementLaneRec, type ArrangementState } from './performance';

export function getOrCreateLane(s: ArrangementState, laneId: string): ArrangementLaneRec {
  let rec = s.lanes.find((l) => l.laneId === laneId);
  if (!rec) {
    rec = emptyLaneRec(laneId);
    s.lanes.push(rec);
  }
  return rec;
}

export function appendClipEvent(
  s: ArrangementState, laneId: string, clipId: string, atSec: number,
): void {
  const rec = getOrCreateLane(s, laneId);
  const last = rec.clipEvents[rec.clipEvents.length - 1];
  if (last && last.untilSec === Infinity) last.untilSec = atSec;
  rec.clipEvents.push({ clipId, laneId, atSec, untilSec: Infinity });
}

export function closePendingClipEvent(
  s: ArrangementState, laneId: string, atSec: number,
): void {
  const rec = s.lanes.find((l) => l.laneId === laneId);
  if (!rec) return;
  const last = rec.clipEvents[rec.clipEvents.length - 1];
  if (!last || last.untilSec !== Infinity) return;
  last.untilSec = atSec;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-ops.ts src/performance/arrangement-ops.test.ts
git commit -m "feat(performance): appendClipEvent + closePendingClipEvent with overdub"
```

---

### Task 4: `routeParamId` lane-vs-global

**Files:**

- Modify: `src/performance/arrangement-ops.ts`
- Modify: `src/performance/arrangement-ops.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/performance/arrangement-ops.test.ts`:

```typescript
import { routeParamId } from './arrangement-ops';

describe('routeParamId', () => {
  const laneIds = ['tb-303-1', 'drums-1', 'subtractive-1'];

  it('matches a paramId by lane prefix', () => {
    expect(routeParamId('tb-303-1.cutoff', laneIds)).toEqual({ kind: 'lane', laneId: 'tb-303-1' });
    expect(routeParamId('subtractive-1.amp.attack', laneIds)).toEqual({ kind: 'lane', laneId: 'subtractive-1' });
  });

  it('falls back to global for prefixes not in the lane list', () => {
    expect(routeParamId('fx.reverb.wet', laneIds)).toEqual({ kind: 'global' });
    expect(routeParamId('mix.master.pan', laneIds)).toEqual({ kind: 'global' });
    expect(routeParamId('tb303.something', laneIds)).toEqual({ kind: 'global' });
  });

  it('matches the longest lane id when prefixes overlap', () => {
    // Ensures 'subtractive-10' beats 'subtractive-1' when both exist.
    const ids = ['subtractive-1', 'subtractive-10'];
    expect(routeParamId('subtractive-10.cutoff', ids)).toEqual({ kind: 'lane', laneId: 'subtractive-10' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts
```

Expected: fails with "routeParamId is not exported".

- [ ] **Step 3: Append to `src/performance/arrangement-ops.ts`**

```typescript
export type ParamRoute =
  | { kind: 'lane'; laneId: string }
  | { kind: 'global' };

export function routeParamId(paramId: string, laneIds: readonly string[]): ParamRoute {
  let best: string | null = null;
  for (const id of laneIds) {
    if (paramId.startsWith(id + '.') && (best === null || id.length > best.length)) {
      best = id;
    }
  }
  return best ? { kind: 'lane', laneId: best } : { kind: 'global' };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts
```

Expected: 9 passing total.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-ops.ts src/performance/arrangement-ops.test.ts
git commit -m "feat(performance): routeParamId lane-vs-global by prefix"
```

---

### Task 5: `writeAutomationSample` with sample-and-hold

**Files:**

- Modify: `src/performance/arrangement-ops.ts`
- Modify: `src/performance/arrangement-ops.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/performance/arrangement-ops.test.ts`:

```typescript
import { writeAutomationSample, sampleAutomationAt } from './arrangement-ops';
import { AUTOMATION_SUB_RES } from '../core/pattern';

describe('writeAutomationSample', () => {
  it('creates a curve on first write, sized for the sample index', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'tb-303-1.cutoff', 0.42, /*subIdx=*/3, ['tb-303-1']);
    const lane = s.lanes[0];
    const curve = lane.automation[0];
    expect(curve.paramId).toBe('tb-303-1.cutoff');
    expect(curve.samples.length).toBeGreaterThanOrEqual(4);
    expect(curve.samples[3]).toBe(0.42);
  });

  it('global paramIds go to globalAutomation', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.8, 1, ['tb-303-1']);
    expect(s.globalAutomation).toHaveLength(1);
    expect(s.globalAutomation[0].samples[1]).toBe(0.8);
    expect(s.lanes).toHaveLength(0);
  });

  it('overdub: new write at the same subIdx overwrites the previous value', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'tb-303-1.cutoff', 0.2, 5, ['tb-303-1']);
    writeAutomationSample(s, 'tb-303-1.cutoff', 0.9, 5, ['tb-303-1']);
    expect(s.lanes[0].automation[0].samples[5]).toBe(0.9);
  });
});

describe('sampleAutomationAt', () => {
  it('returns the sample at the floor-rounded subIdx', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.3, 0, []);
    writeAutomationSample(s, 'fx.reverb.wet', 0.7, 1, []);
    const curve = s.globalAutomation[0];
    expect(sampleAutomationAt(curve, 0)).toBe(0.3);
    expect(sampleAutomationAt(curve, 1)).toBe(0.7);
  });

  it('holds the last written value for sub-steps past the end', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.5, 2, []);
    const curve = s.globalAutomation[0];
    // 2 was the last write; index 99 should hold 0.5 (sample-and-hold).
    expect(sampleAutomationAt(curve, 99)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts
```

Expected: fails with "writeAutomationSample is not exported".

- [ ] **Step 3: Append to `src/performance/arrangement-ops.ts`**

```typescript
import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { AutomationCurve } from './performance';

function getOrCreateCurve(
  list: AutomationCurve[], paramId: string,
): AutomationCurve {
  let c = list.find((x) => x.paramId === paramId);
  if (!c) {
    c = { paramId, samples: [] };
    list.push(c);
  }
  return c;
}

function holdExtend(samples: number[], idx: number): void {
  if (idx < samples.length) return;
  const last = samples.length > 0 ? samples[samples.length - 1] : 0.5;
  while (samples.length <= idx) samples.push(last);
}

export function writeAutomationSample(
  s: ArrangementState,
  paramId: string,
  valueNorm: number,
  subIdx: number,
  laneIds: readonly string[],
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? getOrCreateLane(s, route.laneId).automation
    : s.globalAutomation;
  const curve = getOrCreateCurve(list, paramId);
  holdExtend(curve.samples, subIdx);
  curve.samples[subIdx] = valueNorm;
}

export function sampleAutomationAt(curve: AutomationCurve, subIdx: number): number {
  if (curve.samples.length === 0) return 0.5;
  const i = Math.min(subIdx, curve.samples.length - 1);
  return curve.samples[i];
}
```

Note: `AUTOMATION_SUB_RES` is imported but not yet used in this task — the helper is independent of the sub-resolution. It will be used by callers in Phase B. Keep the import to make the unit ready for Phase B.

- [ ] **Step 4: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts
```

Expected: 14 passing total.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-ops.ts src/performance/arrangement-ops.test.ts
git commit -m "feat(performance): writeAutomationSample + sampleAutomationAt with hold"
```

---

## Phase B — REC capture

### Task 6: `RecState` + `tickRecAutomation` helper

**Files:**

- Create: `src/performance/rec-state.ts`
- Create: `src/performance/rec-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/performance/rec-state.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { emptyArrangementState } from './performance';
import {
  createRecState, armRec, disarmRec, startRecording, stopRecording,
  markParamTouched, tickRecAutomation, arrangementNow,
} from './rec-state';

describe('RecState lifecycle', () => {
  it('armRec sets armed=true; startRecording flips recording when armed', () => {
    const rec = createRecState();
    expect(rec.armed).toBe(false);
    armRec(rec);
    expect(rec.armed).toBe(true);
    expect(rec.recording).toBe(false);
    startRecording(rec, /*nowCtx=*/10);
    expect(rec.recording).toBe(true);
    expect(rec.startedAtCtx).toBe(10);
  });

  it('startRecording is a no-op when not armed', () => {
    const rec = createRecState();
    startRecording(rec, 10);
    expect(rec.recording).toBe(false);
  });

  it('stopRecording flips recording back to false', () => {
    const rec = createRecState();
    armRec(rec);
    startRecording(rec, 10);
    stopRecording(rec);
    expect(rec.recording).toBe(false);
  });

  it('disarmRec also stops an in-progress recording', () => {
    const rec = createRecState();
    armRec(rec);
    startRecording(rec, 10);
    disarmRec(rec);
    expect(rec.armed).toBe(false);
    expect(rec.recording).toBe(false);
  });
});

describe('arrangementNow', () => {
  it('returns now - startedAtCtx, clamped to >= 0', () => {
    const rec = createRecState();
    armRec(rec); startRecording(rec, 100);
    expect(arrangementNow(rec, 102.5)).toBeCloseTo(2.5, 5);
    expect(arrangementNow(rec, 99)).toBe(0);
  });
});

describe('tickRecAutomation sample-and-hold', () => {
  it('writes the current knob value for every paramId touched since last tick', () => {
    const rec = createRecState();
    armRec(rec); startRecording(rec, 0);
    const state = emptyArrangementState(120);
    const reads: Record<string, number> = { 'tb-303-1.cutoff': 0.7, 'fx.reverb': 0.4 };
    const readValue = vi.fn((id: string) => reads[id]);

    markParamTouched(rec, 'tb-303-1.cutoff');
    markParamTouched(rec, 'fx.reverb');

    tickRecAutomation({
      rec, state, nowCtx: 0.5, bpm: 120, laneIds: ['tb-303-1'], readValue,
    });

    expect(readValue).toHaveBeenCalledWith('tb-303-1.cutoff');
    expect(readValue).toHaveBeenCalledWith('fx.reverb');
    expect(state.lanes[0].automation[0].paramId).toBe('tb-303-1.cutoff');
    expect(state.globalAutomation[0].paramId).toBe('fx.reverb');
  });

  it('clears the touched set after each tick (no double-write)', () => {
    const rec = createRecState();
    armRec(rec); startRecording(rec, 0);
    const state = emptyArrangementState(120);
    const readValue = vi.fn(() => 0.5);
    markParamTouched(rec, 'fx.reverb');
    tickRecAutomation({ rec, state, nowCtx: 0.1, bpm: 120, laneIds: [], readValue });
    tickRecAutomation({ rec, state, nowCtx: 0.2, bpm: 120, laneIds: [], readValue });
    expect(readValue).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when not recording', () => {
    const rec = createRecState();           // armed=false, recording=false
    const state = emptyArrangementState(120);
    const readValue = vi.fn(() => 0.5);
    markParamTouched(rec, 'fx.reverb');
    tickRecAutomation({ rec, state, nowCtx: 0.1, bpm: 120, laneIds: [], readValue });
    expect(readValue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/performance/rec-state.test.ts
```

Expected: fails with "Cannot find module './rec-state'".

- [ ] **Step 3: Implement `src/performance/rec-state.ts`**

```typescript
import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { ArrangementState } from './performance';
import { stepsPerSec } from './performance';
import { writeAutomationSample } from './arrangement-ops';

export interface RecState {
  armed: boolean;
  recording: boolean;
  startedAtCtx: number;
  /** ParamIds whose knob was moved since the last `tickRecAutomation`. */
  touched: Set<string>;
}

export function createRecState(): RecState {
  return { armed: false, recording: false, startedAtCtx: 0, touched: new Set() };
}

export function armRec(rec: RecState): void { rec.armed = true; }
export function disarmRec(rec: RecState): void { rec.armed = false; rec.recording = false; }

export function startRecording(rec: RecState, nowCtx: number): void {
  if (!rec.armed) return;
  rec.recording = true;
  rec.startedAtCtx = nowCtx;
  rec.touched.clear();
}

export function stopRecording(rec: RecState): void {
  rec.recording = false;
  rec.touched.clear();
}

export function arrangementNow(rec: RecState, nowCtx: number): number {
  return Math.max(0, nowCtx - rec.startedAtCtx);
}

export function markParamTouched(rec: RecState, paramId: string): void {
  if (!rec.recording) return;
  rec.touched.add(paramId);
}

export interface TickRecAutomationArgs {
  rec: RecState;
  state: ArrangementState;
  nowCtx: number;
  bpm: number;
  laneIds: readonly string[];
  /** Reads the current normalized (0..1) value of the named knob. */
  readValue: (paramId: string) => number;
}

export function tickRecAutomation(args: TickRecAutomationArgs): void {
  const { rec, state, nowCtx, bpm, laneIds, readValue } = args;
  if (!rec.recording || rec.touched.size === 0) return;
  const tNow = arrangementNow(rec, nowCtx);
  const subIdx = Math.floor(tNow * stepsPerSec(bpm) * AUTOMATION_SUB_RES);
  for (const paramId of rec.touched) {
    writeAutomationSample(state, paramId, readValue(paramId), subIdx, laneIds);
  }
  rec.touched.clear();
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/rec-state.test.ts
```

Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/performance/rec-state.ts src/performance/rec-state.test.ts
git commit -m "feat(performance): RecState + sample-and-hold automation tick"
```

---

### Task 7: Wire REC into `main.ts` (redirect from old recorder)

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Read the current REC wiring**

The existing block at [src/main.ts:805-810](../../src/main.ts#L805) toggles `automationRecording` and writes into `seq.pattern.automation` via `recordAutomationValue` at [src/main.ts:265](../../src/main.ts#L265). We replace the recorder body to use `RecState` + `markParamTouched`, and add `tickRecAutomation` to the lookahead loop.

- [ ] **Step 2: Add imports near the top of `main.ts`**

Find the existing imports block (after `import { AUTOMATION_SUB_RES } from './core/pattern';` or similar). Add:

```typescript
import {
  createRecState, armRec, disarmRec, startRecording, stopRecording,
  markParamTouched, tickRecAutomation,
} from './performance/rec-state';
import { emptyArrangementState } from './performance/performance';
```

- [ ] **Step 3: Add module-level state next to `automationRecording`**

Replace the line `let automationRecording = false;` with:

```typescript
const rec = createRecState();
// Legacy flag kept as a derived read for any UI that polls it; do not write
// to it directly anywhere outside this module.
let automationRecording = false;
const arrangement = emptyArrangementState(seq.bpm);
```

(`seq.bpm` is in scope below in the file; if a forward-ref complains, declare `arrangement` lazily — see Step 4.)

If the linter / TS rejects a forward reference because `seq` is declared later, move the `arrangement` declaration to immediately after `const seq = new Sequencer(ctx, 32);` instead.

- [ ] **Step 4: Replace `registerKnob` body to use `markParamTouched`**

Find at [src/main.ts:227-237](../../src/main.ts#L227) the body of `registerKnob`. Replace its `onValueChanged` assignment:

```typescript
  k.onValueChanged = (_v, fromUser) => {
    if (fromUser && rec.recording) markParamTouched(rec, k.meta.id!);
  };
```

(Drop the `recordAutomationValue` call; that function plus its old body can stay in the file for now and will be removed in Task 8.)

- [ ] **Step 5: Wire start/stop into the play transport**

Find where the Play button transitions `seq` from stopped to playing (search for `seq.play()` in `main.ts`). Immediately after starting playback, add:

```typescript
  if (rec.armed) startRecording(rec, ctx.currentTime);
```

Find where the Stop button stops `seq` (search for `seq.stop()`). Immediately after, add:

```typescript
  if (rec.recording) stopRecording(rec);
```

- [ ] **Step 6: Replace the REC button click handler**

Replace the block at [src/main.ts:805-810](../../src/main.ts#L805):

```typescript
const recBtn = $<HTMLButtonElement>('rec');
recBtn.addEventListener('click', () => {
  if (rec.armed) disarmRec(rec); else armRec(rec);
  automationRecording = rec.armed;
  recBtn.classList.toggle('armed', rec.armed);
  recBtn.textContent = rec.armed ? '● REC ON' : '● REC';
  // If transport is already playing when the user arms REC, begin the take now.
  if (rec.armed && seq.isPlaying()) startRecording(rec, ctx.currentTime);
});
```

- [ ] **Step 7: Add `tickRecAutomation` to the lookahead tick**

Find the body of the function that runs every 25 ms (search for `setTimeout` and `lookahead` in `main.ts` — there is one main scheduler). Inside, after `tickSession(...)` (or after whatever the equivalent of "the Session tick body" is — there should be a single call), add:

```typescript
tickRecAutomation({
  rec,
  state: arrangement,
  nowCtx: ctx.currentTime,
  bpm: seq.bpm,
  laneIds: sessionHost.getState().lanes.map((l) => l.id),
  readValue: (id) => {
    const k = automationRegistry.get(id);
    if (!k) return 0.5;
    const range = k.meta.max - k.meta.min;
    if (range === 0) return 0.5;
    // We don't have a getValue() on KnobHandle; the param's current value is
    // stored on the engine/strip — the closest stable source is the knob's
    // displayed value via the DOM attribute set by createKnob. Fall back to
    // 0.5 if not parseable.
    const dv = (k.el.getAttribute('data-value-norm') ?? '');
    const n = parseFloat(dv);
    return Number.isFinite(n) ? n : 0.5;
  },
});
```

⚠ **Note:** `data-value-norm` does NOT yet exist on the knob element. Add it in the next task. For now, this code will fall back to `0.5` until Task 8 ships the attribute write.

- [ ] **Step 8: Smoke-test that the app still builds and tests are green**

```bash
npm run test:fast
```

Expected: no regressions. (REC will not yet capture real values; that lands in Task 8.)

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "feat(performance): wire RecState into transport + REC button"
```

---

### Task 8: Expose normalized knob value via `data-value-norm`

**Files:**

- Modify: `src/core/knob.ts`
- Modify: `src/core/select-control.ts`
- Create: `src/core/knob-data-attr.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/knob-data-attr.test.ts`:

```typescript
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { createKnob } from './knob';

describe('createKnob exposes current normalized value via data-value-norm', () => {
  it('initial render sets data-value-norm to (value - min) / (max - min)', () => {
    let captured = 0;
    const h = createKnob({
      min: 0, max: 100, value: 25,
      onChange: (v) => { captured = v; },
    });
    expect(h.el.getAttribute('data-value-norm')).toBe('0.25');
    expect(captured).toBe(0); // onChange not called for the initial paint
  });

  it('setValue updates data-value-norm', () => {
    const h = createKnob({
      min: 0, max: 100, value: 0,
      onChange: () => {},
    });
    h.setValue(75);
    expect(h.el.getAttribute('data-value-norm')).toBe('0.75');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/core/knob-data-attr.test.ts
```

Expected: fails because the attribute is not set.

- [ ] **Step 3: Modify `src/core/knob.ts`**

Find the function that updates the knob visuals (search for `valArc.setAttribute('d', …)` or where the value is rendered each change). Just after the existing render side-effects of the value, add:

```typescript
const range = opts.max - opts.min;
const norm = range === 0 ? 0 : (value - opts.min) / range;
wrap.setAttribute('data-value-norm', String(norm));
```

Place it inside the same function that runs on `set(value, fire, fromUser)` (look around [src/core/knob.ts:147](../../src/core/knob.ts#L147)) so every value change updates the attribute. Also ensure the **initial** paint sets the attribute — if the initial render is a separate call, set it once after the helper is defined.

- [ ] **Step 4: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/core/knob-data-attr.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Mirror for select controls**

`src/core/select-control.ts` exposes a similar `KnobHandle`. Inside its value-update path, set the same attribute. For a binary toggle (select), `norm` is the index over the option count:

```typescript
const norm = options.length <= 1 ? 0 : idx / (options.length - 1);
handle.el.setAttribute('data-value-norm', String(norm));
```

(Place inside the update helper; the file already mutates a knob-like element when value changes.) No new test for select-control in this task — it's covered indirectly by the e2e in Task 22.

- [ ] **Step 6: Drop the dead `recordAutomationValue` function from `main.ts`**

Delete the function `recordAutomationValue` at [src/main.ts:265-291](../../src/main.ts#L265) (it is no longer called).

- [ ] **Step 7: Run all unit tests**

```bash
npm run test:unit
```

Expected: no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/core/knob.ts src/core/select-control.ts src/core/knob-data-attr.test.ts src/main.ts
git commit -m "feat(performance): expose data-value-norm + drop legacy automation recorder"
```

---

### Task 9: Clip-launch capture in `session-runtime.ts`

**Files:**

- Modify: `src/session/session-runtime.ts`
- Create: `src/session/session-runtime-rec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/session/session-runtime-rec.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  launchClip, stopLane, tickSession, emptyLanePlayState,
  type LanePlayState,
} from './session-runtime';
import { emptyArrangementState } from '../performance/performance';
import { createRecState, armRec, startRecording } from '../performance/rec-state';
import {
  type SessionState, type SessionClip, emptySessionState,
} from './session';

function withSingleLane(): { s: SessionState; clip: SessionClip } {
  const s = emptySessionState();
  s.lanes = [{ id: 'tb-303-1', engineId: 'tb303', clips: [] }];
  const clip: SessionClip = { id: 'c1', lengthBars: 1, notes: [] };
  s.lanes[0].clips = [clip];
  return { s, clip };
}

describe('launchClip recording hook', () => {
  it('appends a clipEvent when rec.recording is true', () => {
    const { s, clip } = withSingleLane();
    const laneStates = new Map<string, LanePlayState>();
    const rec = createRecState();
    const arrangement = emptyArrangementState(120);
    armRec(rec); startRecording(rec, 100);

    launchClip(laneStates, s, s.lanes[0], clip, /*now=*/100, /*bpm=*/120,
      { rec, arrangement });

    // tickSession promotes queued → playing on the next pass; the clipEvent
    // is appended at promotion time (atSec = 0 because startedAtCtx == now).
    tickSession(
      laneStates, s, /*now=*/100, /*lookahead=*/0.15, /*bpm=*/120,
      () => {}, () => {},
      { rec, arrangement },
    );

    expect(arrangement.lanes[0].laneId).toBe('tb-303-1');
    expect(arrangement.lanes[0].clipEvents).toHaveLength(1);
    expect(arrangement.lanes[0].clipEvents[0].clipId).toBe('c1');
    expect(arrangement.lanes[0].clipEvents[0].atSec).toBeCloseTo(0, 3);
  });

  it('stopLane closes the pending clipEvent', () => {
    const { s, clip } = withSingleLane();
    const laneStates = new Map<string, LanePlayState>();
    const rec = createRecState();
    const arrangement = emptyArrangementState(120);
    armRec(rec); startRecording(rec, 0);

    launchClip(laneStates, s, s.lanes[0], clip, 0, 120, { rec, arrangement });
    tickSession(laneStates, s, 0, 0.15, 120, () => {}, () => {}, { rec, arrangement });

    stopLane(laneStates, 'tb-303-1', { rec, arrangement, nowCtx: 2 });

    expect(arrangement.lanes[0].clipEvents[0].untilSec).toBeCloseTo(2, 3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/session/session-runtime-rec.test.ts
```

Expected: fails because `launchClip` / `stopLane` / `tickSession` don't accept the new `{ rec, arrangement }` arg yet.

- [ ] **Step 3: Modify `src/session/session-runtime.ts`**

Add at the top:

```typescript
import type { RecState } from '../performance/rec-state';
import { arrangementNow } from '../performance/rec-state';
import type { ArrangementState } from '../performance/performance';
import { appendClipEvent, closePendingClipEvent } from '../performance/arrangement-ops';

export interface RecHooks {
  rec: RecState;
  arrangement: ArrangementState;
}
```

Change the signatures:

```typescript
export function launchClip(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  lane: SessionLane,
  clip: SessionClip,
  now: number,
  bpm: number,
  hooks?: RecHooks,                       // NEW (optional, additive)
): void { /* … existing body unchanged … */ }
```

Note: `launchClip` itself does **not** append the clipEvent — that happens at promote time in `tickSession`. The optional `hooks` here is kept for API symmetry; for now leave it ignored. (The lint may complain; use `void hooks;` to suppress.)

In `tickSession`, change the signature:

```typescript
export function tickSession(
  laneStates: Map<string, LanePlayState>,
  state: SessionState,
  now: number,
  lookahead: number,
  bpm: number,
  onLaneTrigger: LaneTriggerFn,
  onClipStepFired: ClipStepFiredFn,
  hooks?: RecHooks,                       // NEW
): void {
```

In the promote block (find `if (lp.queued && now + lookahead >= lp.queuedBoundary)`), after the existing body, add:

```typescript
      if (hooks?.rec.recording) {
        const at = arrangementNow(hooks.rec, lp.queuedBoundary);
        appendClipEvent(hooks.arrangement, lane.id, lp.playing!.id, at);
      }
```

Change `stopLane`:

```typescript
export function stopLane(
  laneStates: Map<string, LanePlayState>,
  laneId: string,
  hooks?: RecHooks & { nowCtx?: number },
): void {
  const lp = laneStates.get(laneId);
  if (!lp) return;
  lp.playing = null;
  lp.queued = null;
  if (hooks?.rec.recording) {
    const at = arrangementNow(hooks.rec, hooks.nowCtx ?? hooks.rec.startedAtCtx);
    closePendingClipEvent(hooks.arrangement, laneId, at);
  }
}
```

- [ ] **Step 4: Update all existing callers to pass `undefined` (or the hooks where applicable)**

Run:

```bash
NO_COLOR=1 npx tsc --noEmit
```

Fix any "missing argument" complaints by passing `undefined` to the new `hooks` parameter at call sites that don't yet have a `RecHooks` to pass. (Most are in `main.ts`; that file will be updated in the next task.)

- [ ] **Step 5: Run the test, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/session/session-runtime-rec.test.ts
```

Expected: 2 passing.

- [ ] **Step 6: Run the full unit suite for regressions**

```bash
npm run test:unit
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/session/session-runtime.ts src/session/session-runtime-rec.test.ts
git commit -m "feat(performance): record clip-launches into ArrangementState"
```

---

### Task 10: Thread `RecHooks` through `main.ts` calls

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Identify the call sites**

```bash
NO_COLOR=1 npx tsc --noEmit 2>&1 | grep -E 'launchClip|stopLane|tickSession'
```

Expected: lists every call site that lost an argument in Task 9. All are in `src/main.ts` and `src/session/session-host.ts`.

- [ ] **Step 2: Build a hooks reference once at module scope of `main.ts`**

Near the `arrangement` declaration added in Task 7:

```typescript
const recHooks = { rec, arrangement };
```

- [ ] **Step 3: Pass `recHooks` to every `launchClip` / `stopLane` / `tickSession` call**

For each call site, append `recHooks` as the final argument. For `stopLane`, additionally pass `nowCtx: ctx.currentTime`:

```typescript
stopLane(laneStates, laneId, { ...recHooks, nowCtx: ctx.currentTime });
```

- [ ] **Step 4: Update `session-host.ts` similarly**

Search `src/session/session-host.ts` for the same calls. Either inject a `recHooks` accessor through `SessionHost` constructor deps or — to keep the diff small — accept that those internal calls won't record clip-launches in MVP. Pick one:

- **Recommended (minimal):** in `session-host.ts`, the calls to `launchClip` / `stopLane` come from internal scene/queue logic that **already** delegates through the runtime. If `session-host.ts` itself doesn't import `launchClip` directly, no change is needed.

Run:

```bash
NO_COLOR=1 npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Run all tests + smoke build**

```bash
npm run test:fast
npm run build
```

Expected: green build, no test regressions.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/session/session-host.ts
git commit -m "feat(performance): thread RecHooks through transport call sites"
```

---

## Phase C — Playback

### Task 11: `ArrangementPlayState` + helpers

**Files:**

- Create: `src/performance/arrangement-runtime.ts`
- Create: `src/performance/arrangement-runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/performance/arrangement-runtime.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createArrangementPlayState, startArrangement, stopArrangement,
  overrideLane, backToArrangement, isLaneOverridden,
} from './arrangement-runtime';

describe('ArrangementPlayState lifecycle', () => {
  it('createArrangementPlayState returns isPlaying=false and no overrides', () => {
    const ps = createArrangementPlayState();
    expect(ps.isPlaying).toBe(false);
    expect(ps.laneOverridden.size).toBe(0);
    expect(ps.nextEventIdxPerLane.size).toBe(0);
  });

  it('startArrangement sets isPlaying and remembers startedAtCtx', () => {
    const ps = createArrangementPlayState();
    startArrangement(ps, 42);
    expect(ps.isPlaying).toBe(true);
    expect(ps.startedAtCtx).toBe(42);
  });

  it('stopArrangement flips isPlaying and clears nextEventIdx', () => {
    const ps = createArrangementPlayState();
    startArrangement(ps, 0);
    ps.nextEventIdxPerLane.set('lane-a', 5);
    stopArrangement(ps);
    expect(ps.isPlaying).toBe(false);
    expect(ps.nextEventIdxPerLane.size).toBe(0);
  });

  it('overrideLane / backToArrangement toggle the per-lane flag', () => {
    const ps = createArrangementPlayState();
    overrideLane(ps, 'lane-a');
    expect(isLaneOverridden(ps, 'lane-a')).toBe(true);
    expect(isLaneOverridden(ps, 'lane-b')).toBe(false);
    backToArrangement(ps);
    expect(isLaneOverridden(ps, 'lane-a')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `src/performance/arrangement-runtime.ts`**

```typescript
import type { ArrangementState } from './performance';

export interface ArrangementPlayState {
  isPlaying: boolean;
  startedAtCtx: number;
  laneOverridden: Map<string, boolean>;
  nextEventIdxPerLane: Map<string, number>;
}

export function createArrangementPlayState(): ArrangementPlayState {
  return {
    isPlaying: false,
    startedAtCtx: 0,
    laneOverridden: new Map(),
    nextEventIdxPerLane: new Map(),
  };
}

export function startArrangement(ps: ArrangementPlayState, nowCtx: number): void {
  ps.isPlaying = true;
  ps.startedAtCtx = nowCtx;
  ps.nextEventIdxPerLane.clear();
}

export function stopArrangement(ps: ArrangementPlayState): void {
  ps.isPlaying = false;
  ps.nextEventIdxPerLane.clear();
}

export function overrideLane(ps: ArrangementPlayState, laneId: string): void {
  ps.laneOverridden.set(laneId, true);
}

export function backToArrangement(ps: ArrangementPlayState): void {
  ps.laneOverridden.clear();
}

export function isLaneOverridden(ps: ArrangementPlayState, laneId: string): boolean {
  return ps.laneOverridden.get(laneId) === true;
}

export function arrangementPlayhead(ps: ArrangementPlayState, nowCtx: number): number {
  if (!ps.isPlaying) return 0;
  return Math.max(0, nowCtx - ps.startedAtCtx);
}

void undefined as ArrangementState | undefined;  // keep import for next task
```

- [ ] **Step 4: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-runtime.ts src/performance/arrangement-runtime.test.ts
git commit -m "feat(performance): ArrangementPlayState + override helpers"
```

---

### Task 12: `tickArrangement` — emits clip launches and automation

**Files:**

- Modify: `src/performance/arrangement-runtime.ts`
- Modify: `src/performance/arrangement-runtime.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/performance/arrangement-runtime.test.ts`:

```typescript
import { emptyArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent, writeAutomationSample } from './arrangement-ops';
import { tickArrangement } from './arrangement-runtime';

describe('tickArrangement', () => {
  it('emits launchClip when an event falls inside the lookahead window', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 2.0);

    const ps = createArrangementPlayState();
    startArrangement(ps, /*nowCtx=*/100);

    const launches: string[] = [];
    const stops: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: (laneId) => stops.push(laneId),
      applyAutomation: () => {},
    });
    expect(launches).toEqual(['tb-303-1:c1']);
  });

  it('emits stopLane when untilSec falls inside the lookahead window', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 0.05);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);

    const stops: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: () => {},
      onStopLane: (laneId) => stops.push(laneId),
      applyAutomation: () => {},
    });
    expect(stops).toEqual(['tb-303-1']);
  });

  it('skips lanes that are overridden', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 2.0);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);
    overrideLane(ps, 'tb-303-1');

    const launches: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: () => {},
      applyAutomation: () => {},
    });
    expect(launches).toEqual([]);
  });

  it('applies global automation samples', () => {
    const s = emptyArrangementState(120);
    writeAutomationSample(s, 'fx.reverb.wet', 0.7, 0, []);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);

    const applied: Record<string, number> = {};
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: () => {},
      onStopLane: () => {},
      applyAutomation: (id, v) => { applied[id] = v; },
    });
    expect(applied['fx.reverb.wet']).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts
```

Expected: `tickArrangement` is not exported.

- [ ] **Step 3: Append to `src/performance/arrangement-runtime.ts`**

```typescript
import { AUTOMATION_SUB_RES } from '../core/pattern';
import { stepsPerSec } from './performance';
import { sampleAutomationAt } from './arrangement-ops';

export interface TickArrangementArgs {
  ps: ArrangementPlayState;
  state: ArrangementState;
  nowCtx: number;
  lookaheadSec: number;
  bpm: number;
  onLaunchClip: (laneId: string, clipId: string, atCtx: number) => void;
  onStopLane: (laneId: string, atCtx: number) => void;
  applyAutomation: (paramId: string, valueNorm: number) => void;
}

export function tickArrangement(args: TickArrangementArgs): void {
  const { ps, state, nowCtx, lookaheadSec, bpm, onLaunchClip, onStopLane, applyAutomation } = args;
  if (!ps.isPlaying) return;
  const tNow = arrangementPlayhead(ps, nowCtx);
  const tMax = tNow + lookaheadSec;

  for (const lane of state.lanes) {
    if (isLaneOverridden(ps, lane.laneId)) continue;
    let i = ps.nextEventIdxPerLane.get(lane.laneId) ?? 0;
    while (i < lane.clipEvents.length) {
      const ev = lane.clipEvents[i];
      if (ev.atSec >= tMax) break;
      onLaunchClip(lane.laneId, ev.clipId, ps.startedAtCtx + ev.atSec);
      if (Number.isFinite(ev.untilSec) && ev.untilSec < tMax) {
        onStopLane(lane.laneId, ps.startedAtCtx + ev.untilSec);
      }
      i++;
    }
    ps.nextEventIdxPerLane.set(lane.laneId, i);
  }

  // Automation: simple per-tick set. (Higher-fidelity ramp can come later.)
  const subIdx = Math.floor(tNow * stepsPerSec(bpm) * AUTOMATION_SUB_RES);
  for (const lane of state.lanes) {
    if (isLaneOverridden(ps, lane.laneId)) continue;
    for (const curve of lane.automation) {
      applyAutomation(curve.paramId, sampleAutomationAt(curve, subIdx));
    }
  }
  for (const curve of state.globalAutomation) {
    applyAutomation(curve.paramId, sampleAutomationAt(curve, subIdx));
  }
}
```

Remove the unused `void undefined as ArrangementState | undefined;` line from Task 11 — it's now used by the import in this file.

- [ ] **Step 4: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts
```

Expected: 8 passing total.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-runtime.ts src/performance/arrangement-runtime.test.ts
git commit -m "feat(performance): tickArrangement emits launches + automation"
```

---

### Task 13: Wire `tickArrangement` into the lookahead loop

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Add imports + module state**

Near the imports added in Task 7:

```typescript
import {
  createArrangementPlayState, startArrangement, stopArrangement,
} from './performance/arrangement-runtime';
import { tickArrangement } from './performance/arrangement-runtime';
```

Near the `arrangement` declaration:

```typescript
const arrangementPlayState = createArrangementPlayState();
let mode: 'session' | 'performance' = 'session';
```

- [ ] **Step 2: Add an `onLaunchClip` adapter that calls the session's launch**

```typescript
function arrangementOnLaunchClip(laneId: string, clipId: string, _atCtx: number) {
  const state = sessionHost.getState();
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  const clip = lane.clips.find((c) => c?.id === clipId);
  if (!clip) return;
  // Launch with immediate quantize so atCtx-aligned scheduling sounds right.
  launchClip(laneStates, state, lane, clip, ctx.currentTime, seq.bpm);
}
function arrangementOnStopLane(laneId: string, _atCtx: number) {
  stopLane(laneStates, laneId);
}
function arrangementApplyAutomation(paramId: string, valueNorm: number) {
  const k = automationRegistry.get(paramId);
  if (!k) return;
  const v = k.meta.min + valueNorm * (k.meta.max - k.meta.min);
  k.setValue(v);
}
```

- [ ] **Step 3: Add the tick call in the lookahead loop**

In the same tick body where `tickSession` is called (and where `tickRecAutomation` was added in Task 7), append:

```typescript
if (mode === 'performance') {
  tickArrangement({
    ps: arrangementPlayState,
    state: arrangement,
    nowCtx: ctx.currentTime,
    lookaheadSec: 0.12,
    bpm: arrangement.bpm || seq.bpm,
    onLaunchClip: arrangementOnLaunchClip,
    onStopLane: arrangementOnStopLane,
    applyAutomation: arrangementApplyAutomation,
  });
}
```

- [ ] **Step 4: Type-check + smoke build**

```bash
NO_COLOR=1 npx tsc --noEmit
npm run build
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(performance): wire tickArrangement into lookahead loop"
```

---

## Phase D — UI

### Task 14: Mode toggle in transport

**Files:**

- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/styles/_transport.scss` (or wherever transport styles live; verify with `grep -r '#transport' src/styles` and use the right file)

- [ ] **Step 1: Add the toggle markup to `index.html`**

In the transport row (search for the `#rec` button), add:

```html
<span class="mode-toggle" id="mode-toggle">
  <button class="mode-btn on" data-mode="session">Session</button>
  <button class="mode-btn" data-mode="performance">Performance</button>
</span>
```

- [ ] **Step 2: Style the toggle**

Add to the transport SCSS:

```scss
.mode-toggle {
  display: inline-flex;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  overflow: hidden;
  .mode-btn {
    padding: 4px 12px;
    background: #2e2e2e;
    color: #aaa;
    border: none;
    cursor: pointer;
    &.on { background: #4a6e4a; color: #fff; }
  }
}
```

- [ ] **Step 3: Wire the toggle in `main.ts`**

```typescript
function setMode(next: 'session' | 'performance') {
  if (mode === next) return;
  // Always stop everything when switching modes.
  if (seq.isPlaying()) seq.stop();
  if (arrangementPlayState.isPlaying) stopArrangement(arrangementPlayState);
  mode = next;
  document.querySelectorAll('#mode-toggle .mode-btn').forEach((b) => {
    b.classList.toggle('on', (b as HTMLElement).dataset.mode === next);
  });
  const sessionRoot = document.getElementById('session-view-root')!;
  const perfRoot    = document.getElementById('performance-view-root')!;
  sessionRoot.hidden = next !== 'session';
  perfRoot.hidden    = next !== 'performance';
}
document.querySelectorAll('#mode-toggle .mode-btn').forEach((b) => {
  b.addEventListener('click', () => {
    setMode((b as HTMLElement).dataset.mode as 'session' | 'performance');
  });
});
```

- [ ] **Step 4: Add the empty Performance view root in `index.html`**

```html
<div id="performance-view-root" hidden>
  <!-- Filled by renderPerformanceView() (next task). -->
</div>
```

Also wrap the existing Session DOM tree in a `<div id="session-view-root">` if it isn't already. (Verify with `grep 'session-view-root' index.html` first; the Session view spec already may have introduced this id — if it does, reuse it.)

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

Open `http://localhost:5173`. Click the toggle: Session view should hide and an empty `#performance-view-root` should be visible (just blank for now). Toggle back: Session view visible again.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts src/styles
git commit -m "feat(performance): Session|Performance mode toggle"
```

---

### Task 15: Empty-state Performance view

**Files:**

- Create: `src/performance/performance-ui.ts`
- Create: `src/styles/_performance-view.scss` (and import from the main SCSS index — look at `src/styles/index.scss` or the existing import barrel)
- Modify: `src/main.ts`

- [ ] **Step 1: Implement the empty-state renderer**

Create `src/performance/performance-ui.ts`:

```typescript
import type { ArrangementState } from './performance';

export interface PerfUICallbacks {
  onPlay: () => void;
  onStop: () => void;
  onGoToSession: () => void;
}

export function renderPerformanceView(
  host: HTMLElement,
  state: ArrangementState,
  cb: PerfUICallbacks,
): void {
  host.innerHTML = '';
  host.classList.add('performance-view');

  if (state.durationSec === 0) {
    const empty = document.createElement('div');
    empty.className = 'perf-empty';
    empty.innerHTML = `
      <p>Sin grabación.</p>
      <p>Arma <b>REC</b>, vuelve a Session, lanza clips y mueve knobs.</p>
      <button class="perf-empty-back">Volver a Session</button>
    `;
    empty.querySelector('.perf-empty-back')!.addEventListener('click', cb.onGoToSession);
    host.appendChild(empty);
    return;
  }

  // Non-empty: rendered in Task 16.
  host.appendChild(document.createTextNode('TODO: timeline'));
}
```

The string `'TODO: timeline'` is placeholder text **rendered in the UI**, not in the code logic. It is replaced by real DOM in Task 16. (This is the only acceptable "TODO" in the plan — a temporary user-visible string, not a logic gap.)

- [ ] **Step 2: Add minimal SCSS for the empty state**

Create `src/styles/_performance-view.scss`:

```scss
.performance-view {
  padding: 20px;
  color: #ddd;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;

  .perf-empty {
    text-align: center;
    padding: 40px;
    color: #aaa;
    button {
      margin-top: 16px;
      padding: 8px 16px;
      background: #2e2e2e;
      border: 1px solid #3a3a3a;
      color: #ddd;
      cursor: pointer;
      border-radius: 4px;
    }
  }
}
```

Import it from the main SCSS index. Run `npm run build` after to confirm the import was wired.

- [ ] **Step 3: Wire `renderPerformanceView` in `main.ts`**

```typescript
import { renderPerformanceView } from './performance/performance-ui';

function refreshPerformanceView() {
  const host = document.getElementById('performance-view-root')!;
  renderPerformanceView(host, arrangement, {
    onPlay: () => startArrangement(arrangementPlayState, ctx.currentTime),
    onStop: () => stopArrangement(arrangementPlayState),
    onGoToSession: () => setMode('session'),
  });
}
// Render once at boot:
refreshPerformanceView();
// Re-render every time the mode flips to performance (in setMode, just after
// the hidden toggle):
//   if (next === 'performance') refreshPerformanceView();
```

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Switch to Performance mode → see the "Sin grabación." placeholder. Click "Volver a Session" → returns to Session view.

- [ ] **Step 5: Commit**

```bash
git add src/performance/performance-ui.ts src/styles/_performance-view.scss src/styles/index.scss src/main.ts
git commit -m "feat(performance): empty-state Performance view"
```

---

### Task 16: Timeline rendering — ruler + clip bands

**Files:**

- Modify: `src/performance/performance-ui.ts`
- Modify: `src/styles/_performance-view.scss`

- [ ] **Step 1: Replace the `'TODO: timeline'` block with the real timeline DOM**

In `src/performance/performance-ui.ts`, replace the `host.appendChild(document.createTextNode('TODO: timeline'));` line with a full timeline. Use the spec §6.2 mockup as the source of truth for layout.

```typescript
import { stepsPerSec } from './performance';

const PX_PER_BAR = 80;   // 1× zoom

function makeRuler(durationSec: number, bpm: number): HTMLElement {
  const barSec = (60 / bpm) * 4;
  const bars = Math.ceil(durationSec / barSec);
  const ruler = document.createElement('div');
  ruler.className = 'perf-row perf-ruler';
  ruler.appendChild(makeLabel('bars'));
  const track = document.createElement('div');
  track.className = 'perf-track';
  track.style.width = `${bars * PX_PER_BAR}px`;
  for (let b = 0; b < bars; b++) {
    const m = document.createElement('span');
    m.className = 'perf-bar-mark';
    m.style.left = `${b * PX_PER_BAR}px`;
    m.textContent = String(b + 1);
    track.appendChild(m);
  }
  ruler.appendChild(track);
  return ruler;
}

function makeLabel(text: string, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `perf-label ${cls}`;
  el.textContent = text;
  return el;
}

function makeClipBand(
  laneRec: import('./performance').ArrangementLaneRec,
  durationSec: number,
  bpm: number,
  resolveClipColor: (clipId: string) => string,
  resolveClipName:  (clipId: string) => string,
): HTMLElement {
  const barSec = (60 / bpm) * 4;
  const totalBars = Math.ceil(durationSec / barSec);

  const row = document.createElement('div');
  row.className = 'perf-row';
  row.appendChild(makeLabel(laneRec.laneId));
  const track = document.createElement('div');
  track.className = 'perf-track';
  track.style.width = `${totalBars * PX_PER_BAR}px`;
  const band = document.createElement('div');
  band.className = 'perf-clip-band';

  for (const ev of laneRec.clipEvents) {
    const x  = (ev.atSec / barSec) * PX_PER_BAR;
    const w  = (Math.min(ev.untilSec, durationSec) - ev.atSec) / barSec * PX_PER_BAR;
    const el = document.createElement('div');
    el.className = 'perf-clip';
    el.style.left  = `${x}px`;
    el.style.width = `${Math.max(8, w)}px`;
    const color = resolveClipColor(ev.clipId);
    if (color) el.style.background = color;
    else el.classList.add('missing');
    el.textContent = resolveClipName(ev.clipId);
    band.appendChild(el);
  }
  track.appendChild(band);
  row.appendChild(track);
  return row;
}
```

Modify `renderPerformanceView` to take the resolvers and call the helpers:

```typescript
export interface PerfUICallbacks {
  onPlay: () => void;
  onStop: () => void;
  onGoToSession: () => void;
  /** Returns the `color` of a `SessionClip` by id, or '' if it no longer exists. */
  resolveClipColor: (clipId: string) => string;
  /** Returns the display name of a `SessionClip` by id, or 'missing' if it no longer exists. */
  resolveClipName:  (clipId: string) => string;
}

export function renderPerformanceView(
  host: HTMLElement,
  state: ArrangementState,
  cb: PerfUICallbacks,
): void {
  host.innerHTML = '';
  host.classList.add('performance-view');

  if (state.durationSec === 0) {
    // … (existing empty block) …
    return;
  }

  host.appendChild(makeRuler(state.durationSec, state.bpm));
  for (const lane of state.lanes) {
    host.appendChild(makeClipBand(lane, state.durationSec, state.bpm,
      cb.resolveClipColor, cb.resolveClipName));
  }
}
```

- [ ] **Step 2: Wire the resolvers in `main.ts`**

```typescript
function refreshPerformanceView() {
  const host = document.getElementById('performance-view-root')!;
  const state = sessionHost.getState();
  function findClip(id: string) {
    for (const lane of state.lanes)
      for (const c of lane.clips) if (c?.id === id) return c;
    return null;
  }
  renderPerformanceView(host, arrangement, {
    onPlay: () => startArrangement(arrangementPlayState, ctx.currentTime),
    onStop: () => stopArrangement(arrangementPlayState),
    onGoToSession: () => setMode('session'),
    resolveClipColor: (id) => findClip(id)?.color ?? '',
    resolveClipName:  (id) => findClip(id)?.name ?? findClip(id)?.id ?? 'missing',
  });
}
```

- [ ] **Step 3: Update SCSS**

Append to `src/styles/_performance-view.scss`:

```scss
.performance-view {
  .perf-row {
    display: grid; grid-template-columns: 90px 1fr;
    border-bottom: 1px solid #222;
  }
  .perf-row.perf-ruler { background: #222; height: 26px; }
  .perf-label {
    padding: 6px 8px;
    background: #1d1d1d; color: #aaa;
    border-right: 1px solid #2a2a2a;
    display: flex; align-items: center;
    font-weight: 600;
  }
  .perf-track  { position: relative; height: 100%; overflow-x: auto; }
  .perf-bar-mark {
    position: absolute; top: 5px; color: #888; font-size: 10px; padding-left: 4px;
  }
  .perf-clip-band { position: relative; height: 38px; background: #161616; }
  .perf-clip {
    position: absolute; top: 4px; height: 30px;
    border-radius: 4px; padding: 4px 6px;
    color: #1a1a1a; font-weight: 600; font-size: 11px;
    overflow: hidden; white-space: nowrap;
    box-shadow: 0 1px 0 rgba(0,0,0,0.4);
    background: #888;
    &.missing { background: repeating-linear-gradient(45deg, #555, #555 4px, #444 4px, #444 8px); color: #ccc; }
  }
}
```

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Arm REC, switch to Session, launch a clip on `tb-303-1`, wait a couple bars, stop. Switch to Performance: a labeled clip bar should appear in the `tb-303-1` row.

- [ ] **Step 5: Commit**

```bash
git add src/performance/performance-ui.ts src/styles/_performance-view.scss src/main.ts
git commit -m "feat(performance): ruler + clip-band rendering"
```

---

### Task 17: Automation sub-bands + global section

**Files:**

- Modify: `src/performance/performance-ui.ts`
- Modify: `src/styles/_performance-view.scss`

- [ ] **Step 1: Add helper `makeAutomationBand`**

In `src/performance/performance-ui.ts`:

```typescript
import { AUTOMATION_SUB_RES } from '../core/pattern';

function makeAutomationBand(
  curve: import('./performance').AutomationCurve,
  durationSec: number,
  bpm: number,
): HTMLElement {
  const totalBars = Math.ceil(durationSec / ((60 / bpm) * 4));
  const row = document.createElement('div');
  row.className = 'perf-row';
  row.appendChild(makeLabel(curve.paramId, 'sub'));
  const track = document.createElement('div');
  track.className = 'perf-track';
  const width = totalBars * PX_PER_BAR;
  track.style.width = `${width}px`;

  const canvas = document.createElement('canvas');
  canvas.className = 'perf-auto-canvas';
  canvas.width  = width;
  canvas.height = 32;
  const cx = canvas.getContext('2d')!;
  cx.strokeStyle = '#f4c8a8';
  cx.lineWidth = 1.5;
  cx.beginPath();
  for (let x = 0; x < width; x++) {
    const t = (x / width) * durationSec;
    const subIdx = Math.floor(t * stepsPerSec(bpm) * AUTOMATION_SUB_RES);
    const v = curve.samples[Math.min(subIdx, curve.samples.length - 1)] ?? 0.5;
    const y = (1 - v) * (canvas.height - 4) + 2;
    if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
  }
  cx.stroke();
  track.appendChild(canvas);
  row.appendChild(track);
  return row;
}
```

- [ ] **Step 2: Call it from `renderPerformanceView`**

After the clip-band for each lane, render its automation curves:

```typescript
  for (const lane of state.lanes) {
    host.appendChild(makeClipBand(lane, state.durationSec, state.bpm,
      cb.resolveClipColor, cb.resolveClipName));
    for (const curve of lane.automation) {
      host.appendChild(makeAutomationBand(curve, state.durationSec, state.bpm));
    }
  }
  if (state.globalAutomation.length > 0) {
    const masterLabel = document.createElement('div');
    masterLabel.className = 'perf-row perf-master-header';
    masterLabel.appendChild(makeLabel('MASTER'));
    masterLabel.appendChild(document.createElement('div'));
    host.appendChild(masterLabel);
    for (const curve of state.globalAutomation) {
      host.appendChild(makeAutomationBand(curve, state.durationSec, state.bpm));
    }
  }
```

- [ ] **Step 3: SCSS**

Append:

```scss
.performance-view {
  .perf-label.sub { font-weight: 400; color: #888; font-size: 11px; padding-left: 14px; }
  .perf-master-header { background: #141414; }
  .perf-auto-canvas { display: block; width: 100%; height: 32px; background: #181818; }
}
```

- [ ] **Step 4: Manual smoke**

`npm run dev`, arm REC, switch to Session, play a clip, move a knob during playback, stop. Switch to Performance: clip band + a sub-band with the recorded curve.

- [ ] **Step 5: Commit**

```bash
git add src/performance/performance-ui.ts src/styles/_performance-view.scss
git commit -m "feat(performance): automation sub-bands + global section"
```

---

### Task 18: Playhead, transport buttons, REC ↔ mode interaction

**Files:**

- Modify: `src/performance/performance-ui.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Render the playhead**

In `renderPerformanceView`, after appending all rows:

```typescript
  const playhead = document.createElement('div');
  playhead.className = 'perf-playhead';
  playhead.id = 'perf-playhead';
  host.appendChild(playhead);
```

SCSS:

```scss
.performance-view {
  position: relative;
  .perf-playhead {
    position: absolute; top: 26px; bottom: 0; width: 2px;
    background: #ffd166; left: 90px; pointer-events: none;
    box-shadow: 0 0 4px rgba(255, 209, 102, 0.5);
  }
}
```

- [ ] **Step 2: Animate the playhead from `main.ts`**

```typescript
function rafPlayhead() {
  if (mode === 'performance' && arrangementPlayState.isPlaying) {
    const el = document.getElementById('perf-playhead');
    if (el) {
      const bars = arrangementPlayhead(arrangementPlayState, ctx.currentTime) / ((60 / arrangement.bpm) * 4);
      el.style.left = `${90 + bars * PX_PER_BAR_MAIN}px`;
    }
  }
  requestAnimationFrame(rafPlayhead);
}
const PX_PER_BAR_MAIN = 80;
requestAnimationFrame(rafPlayhead);
```

Import `arrangementPlayhead` from `./performance/arrangement-runtime`.

- [ ] **Step 3: Move Play/Stop button binding to be mode-aware**

Find the existing Play/Stop handlers in `main.ts` (the `playBtn.addEventListener('click', ...)`). Refactor so the handler dispatches based on `mode`:

```typescript
playBtn.addEventListener('click', () => {
  if (mode === 'session') {
    if (seq.isPlaying()) seq.stop(); else { ensureCtx(); seq.play(); if (rec.armed) startRecording(rec, ctx.currentTime); }
  } else {
    if (arrangementPlayState.isPlaying) stopArrangement(arrangementPlayState);
    else {
      ensureCtx();
      // REC armado al pulsar Play en Performance → desarmar y avisar.
      if (rec.armed) {
        disarmRec(rec);
        recBtn.classList.remove('armed');
        recBtn.textContent = '● REC';
        flashToast('REC desarmado: Performance está reproduciendo');
      }
      startArrangement(arrangementPlayState, ctx.currentTime);
    }
  }
});
```

`ensureCtx` is the existing audio-context resume helper; if it's not exported under that name, find the equivalent (usually a `ctx.resume()` call inline). `flashToast` is a placeholder — pick the existing notification helper in `main.ts` (search for `flashButton` or equivalent) and use it. If none exists, render the toast as a transient `<div>` appended to `document.body` that removes itself after 2 s.

- [ ] **Step 4: Re-render Performance view when entering Performance mode**

In `setMode`:

```typescript
if (next === 'performance') refreshPerformanceView();
```

- [ ] **Step 5: Manual smoke**

Full path: arm REC → switch to Session → play → launch a clip → move a knob → stop. Switch to Performance → click Play → playhead moves, clip plays back, knob value follows the recorded curve. Toggle back to Session → arrangement stops.

- [ ] **Step 6: Commit**

```bash
git add src/performance/performance-ui.ts src/main.ts src/styles/_performance-view.scss
git commit -m "feat(performance): playhead + mode-aware Play/Stop"
```

---

## Phase E — Persistence + integration

### Task 19: Persist `arrangement` and `mode` in `SavedStateV3`

**Files:**

- Modify: `src/save/saved-state-v3.ts`
- Create: `src/save/saved-state-v3.performance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/save/saved-state-v3.performance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseSavedStateV3 } from './saved-state-v3';

describe('parseSavedStateV3 with arrangement + mode', () => {
  it('accepts a v3 save that includes the new arrangement and mode fields', () => {
    const raw = {
      schemaVersion: 3, bpm: 130, swing: 0, masterVol: 0.5,
      kit: '808', wave: 'sawtooth',
      synthParams: {},
      sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
      mode: 'performance',
      arrangement: {
        bpm: 130, durationSec: 4,
        lanes: [{ laneId: 'tb-303-1', clipEvents: [], automation: [] }],
        globalAutomation: [],
      },
    };
    const s = parseSavedStateV3(raw);
    expect(s).not.toBeNull();
    expect((s as any).mode).toBe('performance');
    expect((s as any).arrangement?.durationSec).toBe(4);
  });

  it('a v3 save without arrangement still parses; arrangement is undefined', () => {
    const raw = {
      schemaVersion: 3, bpm: 120, swing: 0, masterVol: 0.5,
      kit: 'tr909', wave: 'square',
      synthParams: {}, sessionState: { lanes: [], scenes: [], globalQuantize: '1/1' },
    };
    const s = parseSavedStateV3(raw);
    expect(s).not.toBeNull();
    expect((s as any).arrangement).toBeUndefined();
    expect((s as any).mode).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL (or PASS already)**

```bash
NO_COLOR=1 npx vitest run src/save/saved-state-v3.performance.test.ts
```

If the existing parser already passes both (because it accepts extra fields), proceed to Step 3 to formally type the fields.

- [ ] **Step 3: Add the optional fields to the type**

In `src/save/saved-state-v3.ts`:

```typescript
import type { ArrangementState } from '../performance/performance';

export interface SavedStateV3 {
  schemaVersion: 3;
  bpm: number;
  swing: number;
  masterVol: number;
  kit: string;
  wave: Wave;
  synthParams: TB303['params'];
  sessionState: SessionState;
  mode?: 'session' | 'performance';
  arrangement?: ArrangementState;
}
```

- [ ] **Step 4: Build + load roundtrip in `save-wiring.ts`**

In `src/save/save-wiring.ts` / `buildSavedStateV3` (in `saved-state-v3.ts`), thread the new fields. Update the `SavedStateV3Deps` interface to take a `mode` getter and an `arrangement` getter:

```typescript
export interface SavedStateV3Deps {
  // … existing …
  getMode: () => 'session' | 'performance';
  getArrangement: () => ArrangementState;
  setMode: (m: 'session' | 'performance') => void;
  setArrangement: (a: ArrangementState) => void;
}
```

Update `buildSavedStateV3`:

```typescript
return {
  // … existing fields …
  mode: deps.getMode(),
  arrangement: deps.getArrangement(),
};
```

Update `applyLoadedStateV3`:

```typescript
if (s.arrangement) deps.setArrangement(s.arrangement);
if (s.mode) deps.setMode(s.mode);
```

- [ ] **Step 5: Provide the getters/setters at the call site (`main.ts`)**

Where `SavedStateV3Deps` is constructed (search `getStateForSave` or the deps object passed into `buildSavedStateV3`), add:

```typescript
getMode: () => mode,
getArrangement: () => arrangement,
setMode: (m) => setMode(m),
setArrangement: (a) => { Object.assign(arrangement, a); refreshPerformanceView(); },
```

- [ ] **Step 6: Run all tests + smoke**

```bash
npm run test:fast
npm run build
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/save/saved-state-v3.ts src/save/save-wiring.ts src/save/saved-state-v3.performance.test.ts src/main.ts
git commit -m "feat(performance): persist arrangement + mode in SavedStateV3"
```

---

### Task 20: DSP smoke — render an Arrangement and check energy

**Files:**

- Create: `src/performance/arrangement.dsp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/performance/arrangement.dsp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { rmsOf } from '../../test/dsp-battery';   // existing helper
import { OfflineAudioContext } from 'node-web-audio-api';
// NOTE: this test exercises the public scheduling math, not main.ts's wiring.
// It renders ~1 second of audio driven directly by tickArrangement against a
// minimal engine harness.

import { emptyArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent } from './arrangement-ops';
import { createArrangementPlayState, startArrangement, tickArrangement } from './arrangement-runtime';

describe('Arrangement DSP smoke', () => {
  it('emits a clip-launch callback inside the audio render window', async () => {
    const offline = new OfflineAudioContext({ length: 44100, sampleRate: 44100, numberOfChannels: 1 });
    // Hard-wire a click on each launch by writing a buffer into a gain.
    const launches: number[] = [];
    const state = emptyArrangementState(120);
    appendClipEvent(state, 'tb-303-1', 'c1', 0);
    closePendingClipEvent(state, 'tb-303-1', 0.5);
    const ps = createArrangementPlayState();
    startArrangement(ps, 0);

    // Simulate the lookahead loop at 25 ms intervals across 1 second.
    for (let t = 0; t < 1; t += 0.025) {
      tickArrangement({
        ps, state, nowCtx: t, lookaheadSec: 0.12, bpm: 120,
        onLaunchClip: (_laneId, _clipId, atCtx) => launches.push(atCtx),
        onStopLane: () => {},
        applyAutomation: () => {},
      });
    }
    expect(launches.length).toBeGreaterThanOrEqual(1);
    expect(launches[0]).toBeLessThan(0.12);    // emitted in first window
  });
});
```

The `rmsOf` import is included for any follow-up assertions you might add — the smoke as written is callback-driven and does not render real audio. If `rmsOf` is unused, drop the import.

- [ ] **Step 2: Run, expect PASS** (no FAIL phase — the code under test already exists)

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement.dsp.test.ts
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add src/performance/arrangement.dsp.test.ts
git commit -m "test(performance): scheduling smoke for tickArrangement"
```

---

### Task 21: Override-by-runtime test

**Files:**

- Modify: `src/performance/arrangement-runtime.test.ts`

- [ ] **Step 1: Add the test**

Append:

```typescript
import { backToArrangement } from './arrangement-runtime';

describe('backToArrangement', () => {
  it('clears all overrides; tick resumes emitting from the current playhead position', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'tb-303-1', 'c1', 0.0);
    closePendingClipEvent(s, 'tb-303-1', 4.0);
    appendClipEvent(s, 'tb-303-1', 'c2', 4.0);
    closePendingClipEvent(s, 'tb-303-1', 8.0);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);
    overrideLane(ps, 'tb-303-1');

    // While overridden, tick emits nothing.
    let launches: string[] = [];
    tickArrangement({
      ps, state: s, nowCtx: 100, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: () => {},
      applyAutomation: () => {},
    });
    expect(launches).toEqual([]);

    // Clear override; next tick at t=4.0 should emit c2.
    backToArrangement(ps);
    launches = [];
    tickArrangement({
      ps, state: s, nowCtx: 104, lookaheadSec: 0.12, bpm: 120,
      onLaunchClip: (laneId, clipId) => launches.push(`${laneId}:${clipId}`),
      onStopLane: () => {},
      applyAutomation: () => {},
    });
    expect(launches).toContain('tb-303-1:c2');
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts
```

Expected: 9 passing.

- [ ] **Step 3: Commit**

```bash
git add src/performance/arrangement-runtime.test.ts
git commit -m "test(performance): backToArrangement resumes from playhead"
```

---

### Task 22: E2E smoke — record, switch, play

**Files:**

- Create: `tests/e2e/performance-view.spec.ts`

- [ ] **Step 1: Look at the existing e2e spec for the right helpers**

Skim one existing e2e spec (e.g. the undo/redo smoke) to copy its `page.goto` + audio-context bootstrap pattern.

```bash
ls tests/e2e
```

- [ ] **Step 2: Write the spec**

Create `tests/e2e/performance-view.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('record a clip-launch in Session, view it in Performance', async ({ page }) => {
  await page.goto('http://localhost:4173/');

  // Click somewhere to unlock the AudioContext.
  await page.locator('#play').click();
  await page.locator('#play').click();   // stop

  // Arm REC.
  await page.locator('#rec').click();
  await expect(page.locator('#rec')).toHaveClass(/armed/);

  // Add a clip to the first lane and launch it.
  // (The exact selector depends on the existing Session UI; the SessionUI test
  //  ids are stable — pick the first empty cell and click its play affordance.)
  const firstCell = page.locator('.session-cell').first();
  await firstCell.click();                          // creates an empty clip / opens inspector
  await page.locator('.session-cell .play-icon').first().click();

  // Play the transport for ~1 second to register a clip-launch.
  await page.locator('#play').click();
  await page.waitForTimeout(1000);
  await page.locator('#play').click();              // stop

  // Switch to Performance.
  await page.locator('[data-mode="performance"]').click();

  // The timeline should render a clip block (not the empty-state placeholder).
  await expect(page.locator('.perf-clip')).toHaveCount(1, { timeout: 3000 });
});
```

The exact selectors (`.session-cell`, `.play-icon`, `[data-mode="performance"]`) match the markup added in Phase D. If the existing Session UI uses different class names, adapt to those (search the existing UI files; do **not** invent new ones).

- [ ] **Step 3: Run the e2e**

```bash
npm run test:e2e
```

Expected: spec passes against `vite preview`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/performance-view.spec.ts
git commit -m "test(performance): e2e — record a clip launch and view it"
```

---

## Phase F — Finishing

### Task 23: Final rebase against `main`

**Files:** none (git-only).

- [ ] **Step 1: Fetch latest main**

```bash
git fetch origin main
```

- [ ] **Step 2: Rebase**

```bash
git rebase origin/main
```

If conflicts arise, resolve them — common ones will be in `src/main.ts` (because we touched the lookahead loop) and `src/save/saved-state-v3.ts`. For each conflict, prefer the union of changes; if a conflict is on logic we touched, keep the Performance-side intent.

After resolution:

```bash
git add <resolved files>
git rebase --continue
```

- [ ] **Step 3: Run the full test suite + build**

```bash
npm run test
npm run build
```

Expected: all green.

- [ ] **Step 4: Push the branch and open a PR**

```bash
git push -u origin feat/performance-view
gh pr create --base main --title "feat: Performance view — arrangement reproducible con REC" --body "$(cat <<'EOF'
## Summary
- Second top-level UI mode (Session | Performance).
- REC button captures clip-launches + automation while Session is playing.
- Performance view plays the recorded arrangement with its own transport, reusing engines + session-runtime.
- Persists `arrangement` + `mode` inside `SavedStateV3` (additive — no schema bump).

Spec: docs/superpowers/specs/2026-05-29-performance-view-design.md

## Test plan
- [ ] `npm run test` passes (unit + Vitest + e2e)
- [ ] Manual: arm REC in Session, launch a clip, move a knob, stop. Switch to Performance, hit Play → recorded clip plays back, knob follows the recorded curve.
- [ ] Save → reload → arrangement restored, mode preserved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Worktree cleanup (after PR merged)**

```bash
# Back in the original repo directory:
cd ../tb303-synth
git worktree remove ../tb303-synth-performance
git branch -d feat/performance-view
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** Every §10 step in the spec maps to one or more tasks above. The "REC desarmado al pulsar Play en Performance" rule is Task 18 Step 3. The "missing clip" handling is Task 16 Step 1 (the `missing` CSS class). The override runtime helpers are Task 11. The empty-state placeholder is Task 15.
- **Type consistency:** `RecState`, `ArrangementState`, `ArrangementPlayState`, and their helpers use a single name throughout the plan. `RecHooks` is the consistent name for the optional argument added to `launchClip` / `stopLane` / `tickSession`.
- **No silent gaps:** Two acceptable placeholders — `'TODO: timeline'` is a literal user-visible string replaced in the next task; `void hooks;` in Task 9 silences a lint warning until the param is actively used. Neither hides logic.
