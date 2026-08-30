# Arrange View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Performance mode into a DAW arrange surface whose primary gesture is dropping audio loops onto lanes — with band identity, honest trims, launch-solo, and one scrolling timeline.

**Architecture:** Evolve the existing lit-html DOM view (approach A). Three additive fields on `ArrangementClipEvent` (`id`, `offsetSec`, `muted`); the dormant `overrideLane` gate becomes launch-solo; arrangement launches go through the grid's `onGridLaunch` door so the timeline wins over weave; ingestion reuses the stems pipeline (`buildSampleAsset` → `sampleCache`/`sampleStore` → audio lane + `ClipSample` clip → band). Offset launch reuses the mid-clip-entry machinery the A-loop seek already exercises (launch with a past-shifted anchor).

**Tech Stack:** TypeScript + lit-html + Web Audio (no new deps). Vitest for unit, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-29-arrange-view-design.md` (mockup: `2026-08-29-arrange-view-mockup.html` — visual parity is an acceptance criterion).

## Global Constraints

- Work happens in a git worktree on a feature branch (`git worktree add .claude/worktrees/arrange-view -b feat/arrange-view`); rebase onto `main` frequently; NEVER merge to main without the user's say-so.
- UI text, code comments, and commit messages in **English**; commits via bash heredoc; commit after every green step; one squashed commit per task before merge.
- File size: 300 code-lines target, 500 hard cap — new modules are born split.
- Test assertions are **relative** (ratios), never absolute magnitudes; one test per user path, no `(or …)` alternatives.
- Run single test files as `NO_COLOR=1 npx vitest run <path>`; the npm scripts already set NO_COLOR.
- `npm run test:e2e` serves `dist/` — ALWAYS `npm run build` first.
- No `engineId === '…'` anywhere in the core; anything per-engine goes through `src/plugins/capabilities.ts`.
- Any UI write of an engine param goes through `commitParam`/`commitParamForLane` — never `setBaseValue` alone.
- Anything listing automation targets uses `DestinationRegistry.list()` + `subscribe()` — never a parallel list.

---

### Task 1: Band identity — `id`, `offsetSec`, `muted` + migration + deep-clone save

**Files:**
- Modify: `src/performance/performance.ts`
- Modify: `src/performance/arrangement-ops.ts` (`appendClipEvent` stamps an id)
- Modify: `src/save/saved-state-v3.ts` (migration backfills ids; save deep-clones the arrangement)
- Test: `src/performance/performance-bands.test.ts` (new), `src/save/saved-state-v3.performance.test.ts` (extend)

**Interfaces:**
- Consumes: existing `ArrangementClipEvent`, `migrateArrangementCurves`, the save path at `saved-state-v3.ts` (`arrangement: deps.getArrangement()` — currently NOT cloned, unlike `weave`).
- Produces: `ArrangementClipEvent` gains `id: string; offsetSec?: number; muted?: boolean`. `newBandId(): string`. `migrateArrangementBands(a: ArrangementState): void` (mutates in place, generates missing ids). Every later task addresses bands by `id`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/performance/performance-bands.test.ts
import { describe, it, expect } from 'vitest';
import { newBandId, migrateArrangementBands, emptyArrangementState, emptyLaneRec } from './performance';

describe('band identity', () => {
  it('newBandId is unique across calls', () => {
    expect(newBandId()).not.toBe(newBandId());
  });
  it('migrateArrangementBands backfills missing ids and leaves existing ones alone', () => {
    const a = emptyArrangementState(120);
    a.lanes.push(emptyLaneRec('l1'));
    a.lanes[0].clipEvents.push(
      { clipId: 'c1', laneId: 'l1', atSec: 0, untilSec: 2 } as never,       // old save: no id
      { id: 'keep-me', clipId: 'c2', laneId: 'l1', atSec: 2, untilSec: 4 },
    );
    migrateArrangementBands(a);
    expect(a.lanes[0].clipEvents[0].id).toBeTruthy();
    expect(a.lanes[0].clipEvents[1].id).toBe('keep-me');
    // ids end up unique within the arrangement
    const ids = a.lanes[0].clipEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

And in `src/save/saved-state-v3.performance.test.ts`, add:

```ts
it('the saved arrangement is a deep clone — editing after save does not mutate the payload', () => {
  // Build a save through the existing helper in this file, then mutate the live
  // arrangement object that produced it and assert the payload kept the old value.
  // (Mirror how the weave clone is asserted; the arrangement line is the one at
  // the `arrangement: deps.getArrangement()` seam.)
});
```

Write that second test concretely against this file's existing fixture helpers (it already builds a `SavedStateV3` with an arrangement — extend the same fixture: mutate `arr.lanes[0].clipEvents[0].atSec` after building the payload, expect the payload's copy unchanged).

- [ ] **Step 2: Run to verify failure** — `NO_COLOR=1 npx vitest run src/performance/performance-bands.test.ts` → FAIL (`newBandId` not exported).

- [ ] **Step 3: Implement**

In `src/performance/performance.ts`:

```ts
export interface ArrangementClipEvent {
  /** Stable identity — selection, per-band mute, drag and copy/paste hang off
   *  this, never off the array index. Generated at creation; backfilled for old
   *  saves by migrateArrangementBands. */
  id: string;
  clipId: string;
  laneId: string;
  atSec: number;
  untilSec: number;
  /** Where inside the clip this band starts (sec). Absent = 0. A left-trim
   *  moves atSec AND offsetSec together so the music does not change bars. */
  offsetSec?: number;
  /** The band exists but never fires. Painted dimmed; gated in tickArrangement. */
  muted?: boolean;
}

let bandSeq = 0;
export function newBandId(): string {
  return `band-${Date.now().toString(36)}-${(bandSeq++).toString(36)}`;
}

/** Additive load-time migration: old saves carry bands without ids. Mutates in
 *  place (the caller owns the object), mirrors migrateArrangementCurves. */
export function migrateArrangementBands(a: ArrangementState): void {
  for (const lane of a.lanes) {
    for (const ev of lane.clipEvents) {
      if (!(ev as { id?: string }).id) (ev as { id: string }).id = newBandId();
    }
  }
}
```

In `arrangement-ops.ts`, `appendClipEvent` adds `id: newBandId()` to the event it pushes. In `saved-state-v3.ts`: call `migrateArrangementBands` where `migrateArrangementCurves` is called, and change the save seam to `arrangement: JSON.parse(JSON.stringify(deps.getArrangement()))` (exactly how `weave` is cloned two lines below).

- [ ] **Step 4: Run** both test files + `NO_COLOR=1 npx vitest run src/performance src/save` → PASS. Also `npx tsc --noEmit` (the `id` field is required now — fix any literal `ArrangementClipEvent` constructions the compiler flags, including tests, by adding `id: newBandId()` or a literal id).

- [ ] **Step 5: Commit** — `feat(arrange): bands carry identity, and the save stops sharing its object`

---

### Task 2: Free move + clamp; ripple only behind a flag

**Files:**
- Modify: `src/performance/arrangement-edit.ts`
- Test: `src/performance/arrangement-edit.test.ts` (extend)

**Interfaces:**
- Consumes: `moveEvent(events, index, newAtSec, bpm)` (existing; keeps signature +1 arg), `snapSecToBeat`.
- Produces: `moveEvent(events, index, newAtSec, bpm, mode?: 'clamp' | 'ripple')` — default `'clamp'`. `clampMove(events, index, newAtSec, bpm): ArrangementClipEvent[]` exported for direct use. `resizeEvent` unchanged except it clamps against neighbours instead of rippling.

- [ ] **Step 1: Failing tests**

```ts
// extend src/performance/arrangement-edit.test.ts
import { moveEvent } from './arrangement-edit';
const ev = (id: string, atSec: number, untilSec: number) =>
  ({ id, clipId: 'c', laneId: 'l', atSec, untilSec });

describe('free move + clamp (default)', () => {
  it('moving into empty space lands exactly there and leaves a gap', () => {
    const out = moveEvent([ev('a', 0, 2), ev('b', 4, 6)], 0, 10, 120);
    expect(out.find((e) => e.id === 'a')!.atSec).toBe(10);
    expect(out.find((e) => e.id === 'b')!.atSec).toBe(4); // untouched — no ripple
  });
  it('moving onto a neighbour clamps against it instead of overlapping', () => {
    const out = moveEvent([ev('a', 0, 2), ev('b', 4, 6)], 0, 3.5, 120);
    const a = out.find((e) => e.id === 'a')!;
    expect(a.untilSec).toBeLessThanOrEqual(4);           // clamped before b
    expect(a.untilSec - a.atSec).toBeCloseTo(2, 9);      // duration preserved
  });
  it("mode 'ripple' keeps today's push-forward behaviour", () => {
    const out = moveEvent([ev('a', 0, 2), ev('b', 4, 6)], 1, 1, 120, 'ripple');
    const [first, second] = [...out].sort((x, y) => x.atSec - y.atSec);
    expect(second.atSec).toBe(first.untilSec);           // pushed, no overlap
  });
});
```

- [ ] **Step 2: Run** → FAIL (default still ripples; gap test breaks).

- [ ] **Step 3: Implement** — add `clampMove` (place the moved band at the snapped target; if it overlaps the previous neighbour clamp `atSec` to `prev.untilSec`, if it overlaps the next clamp `atSec` to `next.atSec - dur`; if the hole is smaller than the band, refuse the move and return the input array). `moveEvent` dispatches on `mode` (`'clamp'` default → `clampMove`, `'ripple'` → existing path). `resizeEvent`: replace its `rippleForward` call with a neighbour clamp (an end-edge grows at most to `next.atSec`; a start-edge shrinks at most to `prev.untilSec`).

- [ ] **Step 4: Run the file** → PASS. Then the whole `src/performance` suite (callers of `moveEvent`/`resizeEvent` in `performance-ui*` keep compiling — the new arg is optional).

- [ ] **Step 5: Commit** — `feat(arrange): free move with clamp; ripple moves behind Shift`

---

### Task 3: Band ops by id — mute, duplicate, split, offset trim

**Files:**
- Create: `src/performance/band-ops.ts`
- Test: `src/performance/band-ops.test.ts`

**Interfaces:**
- Consumes: Task 1's fields, Task 2's `clampMove`, `snapSecToBeat`.
- Produces (all pure, all return new arrays):
  - `findBand(lanes: ArrangementLaneRec[], bandId: string): { lane: ArrangementLaneRec; index: number } | null`
  - `setBandMuted(events, bandId, muted): ArrangementClipEvent[]`
  - `duplicateBand(events, bandId): ArrangementClipEvent[]` (copy placed right after the original if the gap fits, else clamped; new id)
  - `splitBandAt(events, bandId, atSec, bpm): ArrangementClipEvent[]` (two bands; the right half gets `offsetSec = (orig.offsetSec ?? 0) + (cut - orig.atSec)` and a new id; a cut outside `(atSec, untilSec)` is a no-op)
  - `trimBandStart(events, bandId, newAtSec, bpm): ArrangementClipEvent[]` (left-edge trim: moves `atSec` AND `offsetSec` by the same delta, clamped to `offsetSec >= 0` and min 1 beat of length)

- [ ] **Step 1: Failing tests** — cover each op:

```ts
// src/performance/band-ops.test.ts
import { describe, it, expect } from 'vitest';
import { setBandMuted, duplicateBand, splitBandAt, trimBandStart } from './band-ops';
const ev = (id: string, atSec: number, untilSec: number, offsetSec = 0) =>
  ({ id, clipId: 'c', laneId: 'l', atSec, untilSec, offsetSec });

it('setBandMuted flips only the addressed band', () => {
  const out = setBandMuted([ev('a', 0, 2), ev('b', 4, 6)], 'b', true);
  expect(out.find((e) => e.id === 'b')!.muted).toBe(true);
  expect(out.find((e) => e.id === 'a')!.muted).toBeFalsy();
});
it('duplicateBand puts the copy after the original with a fresh id', () => {
  const out = duplicateBand([ev('a', 0, 2)], 'a');
  expect(out).toHaveLength(2);
  const copy = out.find((e) => e.id !== 'a')!;
  expect(copy.atSec).toBe(2);
  expect(copy.untilSec).toBe(4);
});
it('splitBandAt yields two bands whose offsets keep the music in place', () => {
  const out = splitBandAt([ev('a', 4, 8, 1)], 'a', 6, 120);
  const [l, r] = [...out].sort((x, y) => x.atSec - y.atSec);
  expect(l.untilSec).toBe(6);
  expect(r.atSec).toBe(6);
  expect(r.offsetSec).toBeCloseTo(1 + 2, 9);   // original offset + seconds cut away
});
it('trimBandStart slides atSec and offsetSec together', () => {
  const out = trimBandStart([ev('a', 4, 8, 0)], 'a', 5, 120);
  const a = out.find((e) => e.id === 'a')!;
  expect(a.atSec).toBe(5);
  expect(a.offsetSec).toBeCloseTo(1, 9);
});
it('trimBandStart never trims into negative offset', () => {
  const out = trimBandStart([ev('a', 4, 8, 0.5)], 'a', 3, 120);
  const a = out.find((e) => e.id === 'a')!;
  expect(a.offsetSec).toBeGreaterThanOrEqual(0);
  expect(a.atSec).toBeGreaterThanOrEqual(3.5 - 1e-9); // can only reveal what exists
});
```

- [ ] **Step 2: Run** → FAIL (module missing). **Step 3: Implement** the five ops (each ≤ 20 lines; snap `atSec` inputs with `snapSecToBeat`). **Step 4: Run** → PASS. **Step 5: Commit** — `feat(arrange): band ops by id — mute, duplicate, split, honest left-trim`

---

### Task 4: Scheduler gate — a muted band never fires

**Files:**
- Modify: `src/performance/arrangement-runtime.ts` (`tickArrangement` launch loop + stop pointer)
- Test: `src/performance/arrangement-runtime.test.ts` (extend — it already drives `tickArrangement` with fake callbacks)

**Interfaces:**
- Consumes: `ArrangementClipEvent.muted`.
- Produces: no API change; behavioural guarantee later tasks rely on.

- [ ] **Step 1: Failing test** — copy the file's existing launch-counting fixture style:

```ts
it('a muted band neither launches nor schedules a stop', () => {
  // Arrangement with lane l1: band A [0,2) muted, band B [2,4) unmuted.
  // Drive tickArrangement across the whole window; collect onLaunchClip calls.
  // Expect exactly ONE launch (B) and no stop at 2 coming from A's edge.
});
```

Write it concretely with this file's existing helpers (it builds `ArrangementState` and calls `tickArrangement` directly — mirror the nearest existing test's setup verbatim, changing only the events).

- [ ] **Step 2: Run** → FAIL. **Step 3:** in the launch loop `if (ev.muted) { advance the pointer; continue; }`, and in the stop pointer skip muted events the same way the contiguous-boundary skip already advances. **Step 4:** file + `src/performance` suite green. **Step 5: Commit** — `feat(arrange): muted bands are silent at the scheduler, not just the paint`

---

### Task 5: Launch-solo / launch-mute per lane

**Files:**
- Modify: `src/app/arrangement-playback.ts` (owns `ArrangementPlayState` + tick; add the solo API)
- Modify: `src/app/performance-feature.ts` (state + header wiring exposure)
- Test: `src/app/arrangement-playback.test.ts` (extend/create alongside existing app tests)

**Interfaces:**
- Consumes: `overrideLane / backToArrangement / isLaneOverridden` (`arrangement-runtime.ts` — dormant, zero prod callers), `stopLane`, `anchorLanesAt`, `songBarSec`.
- Produces on the playback object:
  - `setLaunchMute(laneId: string, on: boolean): void` — override exactly that lane (+ bar-quantized `stopLane` when on; re-anchor that lane when off)
  - `setLaunchSolo(laneId: string | null): void` — null clears; otherwise override every OTHER lane (+ their quantized stops), re-anchor on clear
  - `getLaunchState(): { solo: string | null; muted: ReadonlySet<string> }` — for the header paint

- [ ] **Step 1: Failing tests** (fake-clock style, same as the tick tests in this area):

```ts
it('launch-solo stops driving the other lanes and stops them at the next bar', () => {
  // two lanes, both with a band spanning [0, 8). Start playback, tick to t=1.3,
  // setLaunchSolo('l1'). Expect: a stopLane for l2 scheduled at the NEXT bar
  // boundary (bar length from songBarSec(bpm, meter)), and after further ticks
  // no new launches on l2 while l1 keeps launching.
});
it('clearing the solo re-anchors the un-soloed lanes into the band under the playhead', () => {
  // after the above, setLaunchSolo(null) at t=5 → l2 receives a launch for the
  // band spanning t=5 (the anchorLanesAt relaunch), with the SAME startedAtCtx
  // arithmetic seek uses.
});
it('launch-mute is the single-lane version of the same gate', () => { /* mirror test 1 for setLaunchMute */ });
```

Flesh these out against the real deps object `createArrangementPlayback` takes (the existing tests in `src/app/` show the fixture; `onStopLane` is already a dep you can spy on).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `arrangement-playback.ts`: keep `muted: Set<string>` + `solo: string | null`; derive the override set = `solo ? allLanes − {solo} ∪ muted : muted`; on any change, for lanes ENTERING the set call `overrideLane(ps, id)` + schedule `onStopLane(id, nextBarCtx)` (compute `nextBarCtx = startedAtCtx + Math.ceil(tNow / barSec) * barSec`); for lanes LEAVING call `backToArrangement(ps, id)` + re-anchor just those lanes (extract the per-lane half of `anchorLanesAt` if needed — `arrangement-runtime.ts` owns it; export `anchorLaneAt(ps, state, laneId, positionSec, onLaunchClip)`). **Step 4:** green. **Step 5: Commit** — `feat(arrange): launch-solo and launch-mute wire the dormant overrideLane`

---

### Task 6: Timeline wins — arrangement launches suspend weave

**Files:**
- Modify: `src/app/arrangement-playback.ts` (`begin()` + `onLaunchClip` seam)
- Modify: `src/app/performance-feature.ts` (thread the new dep)
- Modify: `src/main.ts` (pass `onGridLaunch` — the SAME closure Session gets: `(laneId) => weaveWiring.suspendForGrid(laneId)`)
- Test: `src/app/arrange-weave-suspend.test.ts` (new — transport-level, the `weave-scheduling.test.ts` lesson: count real triggers)

**Interfaces:**
- Consumes: `SessionHost.deps.onGridLaunch` contract (`(laneId: string | null) => void`; `null` = every lane), `weaveWiring.suspendForGrid`.
- Produces: `ArrangementPlaybackDeps.onTimelineLaunch?: (laneId: string | null) => void`, called with `null` from `begin()` and with the `laneId` on every per-band launch.

- [ ] **Step 1: Failing test** — spy on `onTimelineLaunch`:

```ts
it('begin() claims every lane and each band launch claims its lane', () => {
  const claimed: (string | null)[] = [];
  // build playback with onTimelineLaunch: (id) => claimed.push(id)
  // begin() → expect claimed to start with [null]
  // tick across a band on l1 → expect claimed to contain 'l1' before the launch
});
```

Plus one integration-flavoured test that builds the REAL `weaveWiring` fixture (see `weave-wiring.test.ts:152` for the suspend fixture) and asserts `notesFor('l1')` returns `undefined` after an arrangement band launch on `l1`.

- [ ] **Step 2: Run** → FAIL. **Step 3:** add the dep, call it in `begin()` (null) and inside `onLaunchClip` (laneId) BEFORE `launchClipAtTime`; wire `main.ts`. **Step 4:** green + `npx tsc --noEmit`. **Step 5: Commit** — `feat(arrange): the timeline wins — a band launch suspends the lane's weave`

---

### Task 7: Offset-aware launch

**Files:**
- Modify: `src/app/arrangement-playback.ts` (`onLaunchClip` applies the band's offset)
- Modify: `src/performance/arrangement-runtime.ts` (`tickArrangement` + `anchorLanesAt` pass the event's `offsetSec` through to `onLaunchClip`)
- Test: `src/performance/arrangement-runtime.test.ts` + `src/app/arrangement-playback.test.ts` (extend)

**Interfaces:**
- Consumes: `launchClipAtTime(laneStates, lane, clip, atCtx)` — UNCHANGED. The offset is implemented by shifting the anchor into the past: `launchClipAtTime(…, atCtx - offsetSec)`. This reuses the mid-clip-entry machinery `anchorLanesAt` already exercises for A-loop seeks (promotion sets `lp.startTime`/`loopStartedAt` to the past boundary; `tickLane` only schedules notes inside the look-ahead window, so earlier notes are simply skipped; audio clips resolve their elapsed position the same way a seek does).
- Produces: `onLaunchClip(laneId, clipId, atCtx, offsetSec?)` (runtime callback signature gains the optional 4th arg).

- [ ] **Step 1: Failing tests**

```ts
// runtime: the event's offset travels to the callback
it('tickArrangement forwards a band offsetSec to onLaunchClip', () => {
  // band { atSec: 2, untilSec: 6, offsetSec: 1.5 } → expect the spy called with
  // (laneId, clipId, startedAtCtx + 2, 1.5)
});
// playback: the anchor is shifted, not the boundary
it('a band with offsetSec launches with a past-shifted anchor', () => {
  // spy on launchClipAtTime via the laneStates map: after the launch,
  // lp.queuedBoundary === atCtx - 1.5 (the clip "entered already started").
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** thread `ev.offsetSec ?? 0` through `tickArrangement`'s launch call AND `anchorLanesAt` (a seek into a trimmed band must add the band offset to the intra-band elapsed). In `arrangement-playback.onLaunchClip`, call `launchClipAtTime(sessionHost.laneStates, lane, clip, Math.max(now, atCtx) - offsetSec)` — note the max-with-now happens BEFORE subtracting, so the offset always lands. **Step 4:** green; then run the scheduling layer (`src/core/lane-scheduler.test.ts`, `src/session/session-runtime.test.ts`) to prove no regression. **Step 5: Commit** — `feat(arrange): a trimmed band enters the clip already started`

---

### Task 8: One scroll surface — layout, ruler seek, A–B drag

**Files:**
- Modify: `src/performance/performance-ui.ts`, `src/performance/performance-ui-templates.ts`
- Modify: `src/styles/_performance-view.scss` (+ `_perf-loop-brace.scss` if selectors move)
- Test: `src/performance/performance-ui-render.test.ts` (extend)

**Interfaces:**
- Consumes: current render tree (`.performance-view > .perf-row*` with per-row `overflow-x`), `arrangement-brace.ts` (`pxToBar`, `clampBarRegion`), `anchorLanesAt` via a new callback.
- Produces: DOM contract for later tasks — `.perf-scroller` (the ONE scrolling element, CSS grid `grid-template-columns: <headerW>px 1fr`), `.perf-headcol` cells `position: sticky; left: 0`, `.perf-ruler` `position: sticky; top: 0`, `#perf-playhead` absolutely positioned inside the scroller. New `PerfUICallbacks.onSeek(sec: number)`.

- [ ] **Step 1: Failing render tests** — extend the existing jsdom render suite:

```ts
it('renders ONE scroll container; lane tracks have no overflow of their own', () => {
  // render, then: document.querySelectorAll('.perf-scroller').length === 1
  // and no element matching '.perf-track' carries overflow-x auto any more
  // (assert via the class the SCSS drops, e.g. .perf-track-scroll is gone).
});
it('clicking the ruler calls onSeek with the bar-resolved seconds', () => {
  // dispatch a click at x px on .perf-ruler; expect cb.onSeek called with
  // pxToBar-consistent seconds (compute expected from the same pxPerBar the
  // template was rendered with — relative, not a magic number).
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** restructure the templates: one `.perf-scroller` wrapping ruler + all lane/automation/master rows; move `overflow-x: auto` from rows to the scroller; make header cells sticky-left and the ruler sticky-top; keep every existing callback working (they address rows the same way). Add the ruler click handler → `onSeek`; keep the existing A–B handle drags and ALSO map a plain drag on empty ruler space to setting `[A, B]` via `clampBarRegion`. Wire `onSeek` in `performance-feature.ts` → stopped: `sessionHost.setSongAnchor(...)`; playing: `playback` re-anchor (`anchorLanesAt` at the clicked second — same path as un-solo). **Step 4:** render tests green + eyeball `npm run dev` against the mockup's frame. **Step 5: Commit** — `feat(arrange): one scrolling surface with a ruler you can click`

---

### Task 9: Band rendering — waveforms, note previews, loop ticks, bars-chip

**Files:**
- Create: `src/performance/band-render.ts` (peaks cache + canvas painters; pure-ish, DOM-only)
- Modify: `src/performance/performance-ui-templates.ts` (bands mount a `<canvas>` painted by band-render)
- Test: `src/performance/band-render.test.ts`

**Interfaces:**
- Consumes: `sampleCache` (decoded `AudioBuffer` by sampleId — `src/samples/sample-cache.ts`), `SessionClip.sample?: ClipSample`, `SessionClip.notes`.
- Produces:
  - `peaksFor(sampleId: string, buckets: number): Float32Array | null` — cached per `(sampleId, buckets)`; computed ONCE from `sampleCache` channel data (max-abs per bucket), `null` when not decoded yet.
  - `paintWaveband(canvas, peaks, offsetFrac, widthFrac): void` and `paintNoteband(canvas, notes, lengthTicks): void`.
  - DOM contract: `.perf-clip[data-band-id]`, `.perf-clip.muted`, `.perf-clip.selected`, `.perf-clip .looptick`, `.perf-clip .bars-chip` (audio only).

- [ ] **Step 1: Failing tests**

```ts
it('peaksFor is computed once and cached per sample+buckets', () => {
  // seed sampleCache with a tiny buffer; call twice; assert SAME array identity.
});
it('peaks reflect the louder half of the buffer (relative)', () => {
  // buffer: first half amplitude 0.1, second half 0.9 →
  // mean(peaks of 2nd half) > mean(peaks of 1st half) * 3
});
it('a band longer than its clip renders one looptick per extra iteration', () => {
  // render a band of 4 bars over a 1-bar clip → 3 .looptick elements
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** implement (`peaksFor` walks channel 0 — a preview, not a mixdown; REMEMBER the borrowed-buffer rule: `.slice()` any channel data kept beyond the call, though here reading inline and discarding is fine). Templates: audio bands get name + canvas + loopticks (count = `floor(bandDur / clipLoopSec) - 1`) + bars-chip showing `clip.lengthBars`; MIDI bands get the note-preview canvas; `muted` class from `ev.muted`, `selected` from the selection set (arrives in Task 10 — until then, pass an empty set). **Step 4:** green; eyeball vs mockup. **Step 5: Commit** — `feat(arrange): bands show their sound — cached waveforms, note previews, loop ticks`

---

### Task 10: Gesture layer — selection, marquee, drag, resize

**Files:**
- Create: `src/performance/perf-gestures.ts`
- Modify: `src/app/performance-feature.ts` (owns `selection: Set<string>`; attaches the layer; routes ops)
- Modify: `src/performance/performance-ui.ts` (callbacks move from index-addressing to `bandId`)
- Test: `src/performance/perf-gestures.test.ts`

**Interfaces:**
- Consumes: the gesture ARCHITECTURE of `src/session/session-clip-drag.ts` (window capture-phase listeners, module-level gesture state that survives re-renders, movement threshold, ghost element, Escape-cancel) — copy the shape, not the code. Ops from Tasks 2–3. DOM contract from Tasks 8–9 (`.perf-scroller`, `.perf-clip[data-band-id]`).
- Produces: `attachPerfGestures(root: HTMLElement, deps: PerfGestureDeps): () => void` where

```ts
export interface PerfGestureDeps {
  pxPerBar(): number;
  barSec(): number;
  selection: { get(): ReadonlySet<string>; set(ids: ReadonlySet<string>): void };
  moveBands(ids: ReadonlySet<string>, deltaSec: number, targetLaneId: string | null,
            mode: 'clamp' | 'ripple', snap: boolean): void;
  resizeBand(id: string, edge: 'start' | 'end', newSec: number, snap: boolean): void;
  refresh(): void;
}
```

- [ ] **Step 1: Failing tests** (jsdom PointerEvent, mirroring `session-clip-drag`'s own tests):

```ts
it('click selects exactly one band; shift-click adds', () => { /* pointerdown+up on two bands */ });
it('a drag below the movement threshold is a click, not a move', () => { /* 2px drag → no moveBands call */ });
it('dragging a band calls moveBands with clamp mode; Shift makes it ripple; Alt disables snap', () => {});
it('a vertical drag reports the lane row under the pointer as targetLaneId', () => {});
it('Escape mid-drag cancels: no op call, ghost removed', () => {});
it('marquee on empty track space selects the bands it covers', () => {});
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** implement; `performance-feature` implements the deps: `moveBands` maps ids→`moveEvent`/`clampMove` per lane (cross-lane = delete from source array + insert into target with same id), `resizeBand` start-edge routes to `trimBandStart` (Task 3), everything calls `commitArrUndo()` first and `refreshPerformanceView()` after. **Step 4:** green. **Step 5: Commit** — `feat(arrange): the timeline under the pointer — select, marquee, drag, trim`

---

### Task 11: Keyboard + context menu

**Files:**
- Create: `src/performance/perf-keys.ts` (keydown handling, capture-phase, Performance-only — mirror the guard `performance-feature.ts` uses for its undo keys)
- Modify: `src/performance/performance-ui-templates.ts` (context menu markup) + `src/app/performance-feature.ts` (clipboard state)
- Test: `src/performance/perf-keys.test.ts`

**Interfaces:**
- Consumes: Task 3 ops + Task 10 selection; `arrHistory` via `commitArrUndo`.
- Produces: Delete/Backspace = delete selection; Ctrl+D duplicate; Ctrl+C copy (bands as plain JSON, offsets relative to the earliest); Ctrl+V paste at the playhead on the bands' own lanes (fresh ids); context menu per band: Mute · Split at playhead · Duplicate · Bars ▾ (audio; Task 13 fills it) · Delete.

- [ ] **Step 1: Failing tests** — one per shortcut, dispatch `KeyboardEvent` with the Performance root visible; assert the resulting `clipEvents` (e.g. paste creates bands with NEW ids at `playheadSec + relative offsets`).
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4:** green. **Step 5: Commit** — `feat(arrange): the keyboard edits — delete, duplicate, copy, paste at the playhead`

---

### Task 12: Fit-to-bars — the drop arithmetic

**Files:**
- Create: `src/performance/loop-fit.ts`
- Test: `src/performance/loop-fit.test.ts`

**Interfaces:**
- Consumes: `TimeSignature` from `core/meter`, `songBarSec` from `core/song-position`.
- Produces: `fitLoopToBars(durationSec: number, bpm: number, meter: TimeSignature): { bars: number; stretch: number }` — bars = nearest power-friendly count (`max(1, round(durationSec / barSec))`), stretch = `durationSec / (bars * barSec)` (the rate the clip's warp applies). Pure arithmetic — NO transient analysis (that avenue is deliberately closed).

- [ ] **Step 1: Failing tests**

```ts
it('a loop a hair short of 4 bars fits to 4 with stretch < 1.05', () => {
  const barSec = songBarSec(120, DEFAULT_METER);
  const { bars, stretch } = fitLoopToBars(4 * barSec * 0.98, 120, DEFAULT_METER);
  expect(bars).toBe(4);
  expect(stretch).toBeGreaterThan(0.95);
  expect(stretch).toBeLessThan(1.0);
});
it('0.6 of a bar rounds up to 1 bar; 1.4 rounds down to 1', () => { /* the 0.9/1.1-style edges */ });
it('stretch is exactly duration / (bars·barSec)', () => { /* identity, relative */ });
```

- [ ] **Steps 2–5:** run-fail, implement (≤ 15 lines), run-pass, commit — `feat(arrange): a dropped file fits the grid by arithmetic, not analysis`

---

### Task 13: Ingestion — drop a file, get a lane, a clip and a band

**Files:**
- Create: `src/performance/perf-ingest.ts`
- Modify: `src/app/performance-feature.ts` (attach dragover/drop on the scroller; the "＋ new lane" strip; bars-chip edit)
- Modify: `src/performance/performance-ui-templates.ts` (drop strip + row highlight class `.drop-hot`)
- Test: `src/performance/perf-ingest.test.ts`

**Interfaces:**
- Consumes: the stems recipe (`src/stems/stem-import.ts:66-82`): `deps.ctx.decodeAudioData` → `buildSampleAsset({ id: newSampleId(), … })` → `sampleCache.put` + `sampleStore.put`. Lane+clip creation goes through the SAME session door the stems feature uses (`addStemLanes` in `src/app/stems-feature.ts` — reuse its lane-building helper or extract the shared half; the clip carries `sample: { sampleId, mode: 'loop', warp: true, … }` and `lengthBars` from Task 12). Band creation: `appendClipEvent`-style push with `newBandId()` at the drop bar.
- Produces:
  - `planDrop(file: { name: string; durationSec: number }, bpm: number, meter: TimeSignature): { laneName: string; bars: number; stretch: number }` (pure, testable)
  - `ingestDroppedFile(deps, file: File, target: { laneId: string | null; atSec: number }): Promise<void>` — `laneId: null` = create a new Audio lane. One session-undo entry + one arrangement-undo entry (`commitArrUndo` before the band push). Documented ghost: undoing only the session half leaves the band pointing at a missing clip; render dims it (Task 9's `.muted` styling reused with a `.ghost` class) and the runtime already skips launches for missing clips.
- [ ] **Step 1: Failing tests** — `planDrop` naming/fit (pure); `ingestDroppedFile` with a fake deps object: creates lane when `laneId` null, reuses when set, pushes a band whose `untilSec - atSec === bars * barSec`, sample landed in cache+store fakes.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement; wire DnD (`dragover` sets `.drop-hot` on the row under the cursor / the strip; `drop` reads `e.dataTransfer.files`, filters audio by MIME/extension, sequential ingest, bar-snapped `atSec` from drop x). Bars-chip: a `<select>` of 1/2/4/8/16 bars → rewrites `clip.lengthBars` + warp stretch and the band length via `resizeEvent` — through session-host mirror (`commitParam` is NOT involved: this is clip data, not an engine param).
- [ ] **Step 4:** green + manual: drop a wav in `npm run dev`, hear it loop in tempo. **Step 5: Commit** — `feat(arrange): drop an audio loop, get a lane — the primary gesture`

---

### Task 14: Mixer m/s become automatable

**Files:**
- Modify: `src/app/mute-solo.ts` (expose setters as registered destinations)
- Modify: `src/automation/automation-targets.ts` (list the new boolean targets)
- Test: `src/app/mute-solo-destinations.test.ts` (new)

**Interfaces:**
- Consumes: `DestinationRegistry` (`src/automation/destination-registry.ts`), `createMuteSolo`'s `muteState/soloState` + `applyMuteSolo`.
- Produces: destinations `"<laneId>.mixer.mute"` / `"<laneId>.mixer.solo"` (0/1, stepped) that `listAutomationTargets` returns and `landAutomationValue` can write (value ≥ 0.5 = on → set flag + `applyMuteSolo()`); they therefore appear in the + Automation picker and are recordable by `markParamTouched` like any knob-backed id.

- [ ] **Step 1: Failing tests** — `listAutomationTargets` contains the two ids for an existing lane; landing 1 on `.mixer.mute` flips `muteState` and calls `applyMuteSolo` (spy). One test per path (mute, solo). ­**Step 2:** FAIL. **Step 3:** implement — register through the SAME door every destination uses (no parallel list; see `docs/automation-destinations.md`). **Step 4:** green. **Step 5: Commit** — `feat(mixer): mute and solo become destinations — recordable like any knob`

---

### Task 15: Empty state + view-state persistence

**Files:**
- Modify: `src/performance/performance-ui-templates.ts` (empty state), `src/app/performance-feature.ts` (zoom/scroll persist), `src/save/app-prefs.ts` (two new prefs)
- Test: `src/performance/performance-ui-render.test.ts` (extend) + `src/save/app-prefs.test.ts` (extend)

**Interfaces:**
- Consumes: `app-prefs` localStorage pattern (flag-style getters/setters), the empty-state branch in `performance-ui-templates.ts` (currently "Back to Session").
- Produces: empty state = "Drop audio loops to start" + subtitle with the live BPM + a DISABLED "● Record a loop" button (title: "coming in round 2"); prefs `arrangePxPerBar` / `arrangeScrollLeft` restored on mount, saved debounced on change — machine-local, NEVER in the save file.

- [ ] **Step 1:** failing render test (empty arrangement renders the drop invitation, not "Back to Session") + prefs round-trip test. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** green. **Step 5: Commit** — `feat(arrange): an empty song invites loops; the view remembers its zoom`

---

### Task 16: e2e + full verification + visual parity

**Files:**
- Create: `tests/e2e/arrange-view.spec.ts`
- Test fixture: put a ≤ 1 s wav under `test/fixtures/loops/` (the gitignore already whitelists that dir) or reuse an existing one there.

**Interfaces:**
- Consumes: e2e helpers (`waitForBoot`, `installMasterTap`/`measureMaster` — see `tests/e2e/helpers.ts` and the master-tap memory), Playwright `setInputFiles`-style drop simulation (dispatch a `drop` event with a `DataTransfer` built in `page.evaluate` from a fetched fixture; a native OS drag is not scriptable — the drop HANDLER is what we test).
- Produces: one spec per user path:

```ts
test('dropping a wav creates a lane and it SOUNDS', async ({ page }) => { /* drop fixture → lane row appears → play → measureMaster RMS > silence*3 */ });
test('ruler click seeks', async ({ page }) => { /* playhead x moves to clicked bar */ });
test('launch-solo silences the other lanes at the bar', async ({ page }) => { /* two lanes, solo one, measure the other's meter/tap drop */ });
test('left-trim changes WHAT sounds, not when', async ({ page }) => { /* render/tap before vs after trim differ; band start bar unchanged */ });
test('a muted band is silent', async ({ page }) => {});
```

- [ ] **Step 1:** write the spec file. **Step 2:** `npm run build` (e2e serves dist — stale-bundle gotcha). **Step 3:** `npm run test:e2e` — the 3 known pre-existing/flaky reds (2× weave-layers, master-audio under load) are NOT yours; anything else is. **Step 4:** `npm run test:unit` full suite green; `npx tsc --noEmit`. **Step 5:** **Visual parity (human gate):** open `npm run dev`, put the real Arrange view beside `docs/superpowers/specs/2026-08-29-arrange-view-mockup.html`, and ASK THE USER to confirm parity — a UI feature is not "done" without a human look. **Step 6: Commit** — `test(arrange): the five user paths, measured at the master`

---

## Self-review notes (already applied)

- Spec coverage: every spec section maps to tasks (model→1–3, runtime→4–7, surface→8–11, ingestion→12–13, m/s→14, persistence/empty→15, tests/parity→16). Round-2 capture and F4 are correctly absent.
- Type consistency: `moveEvent(..., mode?)` (T2) is what T10's `moveBands` calls; `onLaunchClip(laneId, clipId, atCtx, offsetSec?)` (T7) matches T5's re-anchor usage; `newBandId` (T1) is used by T3/T11/T13.
- The executor must read `session-clip-drag.ts` before T10 and `stem-import.ts` + `stems-feature.ts` before T13 — both are named as the pattern source, not pasted, because they are the house pattern and drift would be worse than lookup.
