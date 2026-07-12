# Rec Count-in Metronome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) tracking.

**Goal:** When `● Rec` starts recording from an idle transport, play a 1-bar metronome count-in first; notes played during it sound but are NOT recorded; real recording begins when the count-in ends. No count-in when something is already playing.

**Architecture:** A new `src/control/metronome.ts` (pure click-timing helper + a Web-Audio count-in scheduler). `loom-facade.ts` `startCapture` defers the idle-path recorder-start + scene-launch behind the count-in via an injected `countIn` dep; `stopCapture` cancels a running count-in.

**Tech Stack:** TypeScript, Web Audio, Vitest (node env). No new deps.

**Spec:** `docs/superpowers/specs/2026-07-12-rec-count-in-design.md`

## Global Constraints
- Run one test file: `NO_COLOR=1 npx vitest run <path>`. Full suite: `npm run test:unit` (flaky teardown `ERR_IPC_CHANNEL_CLOSED` AFTER pass → re-run; not a failure). DSP renders can flake (a spectral-centroid `.dsp.test` failing "expected 0" → re-run just that file).
- Typecheck clean (`npx tsc --noEmit`) before each commit. Vitest env is `node` — no `KeyboardEvent`/`HTMLElement`; `AudioContext` is NOT real in unit tests (facade tests stub `ctx`), so keep Web-Audio scheduling out of unit-tested paths (inject it).
- Files ≤300 target/500 cap. English. Discrete tick/count/second values are exact in tests; DSP magnitudes relative.
- `meter` = `TimeSignature { num, den }` from `../core/meter`; `beatsPerBar` = `meter.num`; a beat = `60/bpm` seconds.

---

## Task 1: metronome.ts — pure click timing + count-in scheduler

**Files:**
- Create: `src/control/metronome.ts`
- Test: `src/control/metronome.test.ts`

**Interfaces — Produces:**
```ts
function countInClickTimes(startSec: number, bpm: number, meter: TimeSignature, bars: number):
  { times: number[]; accents: boolean[]; endSec: number };
function createCountIn(ctx: AudioContext, out: AudioNode):
  (bars: number, bpm: number, meter: TimeSignature, onComplete: () => void) => (() => void);
```

- [ ] **Step 1: Write the failing test** (`src/control/metronome.test.ts`) — pure helper only:
```ts
import { describe, it, expect } from 'vitest';
import { countInClickTimes } from './metronome';

describe('countInClickTimes', () => {
  it('one 4/4 bar at 120bpm → 4 clicks a half-second apart, accent on beat 1', () => {
    const r = countInClickTimes(0, 120, { num: 4, den: 4 }, 1);
    expect(r.times).toEqual([0, 0.5, 1.0, 1.5]);
    expect(r.accents).toEqual([true, false, false, false]);
    expect(r.endSec).toBe(2.0);
  });
  it('offsets from startSec and honours the meter (3/4)', () => {
    const r = countInClickTimes(10, 120, { num: 3, den: 4 }, 1);
    expect(r.times).toEqual([10, 10.5, 11.0]);
    expect(r.accents).toEqual([true, false, false]);
    expect(r.endSec).toBe(11.5);
  });
});
```
Run: `NO_COLOR=1 npx vitest run src/control/metronome.test.ts` → FAIL (not defined).

- [ ] **Step 2: Implement `src/control/metronome.ts`:**
```ts
// A count-in metronome: N bars of click blips before recording starts, so the
// performer can get in tempo. Pure timing (tested) + a Web-Audio scheduler.
import type { TimeSignature } from '../core/meter';

export function countInClickTimes(
  startSec: number, bpm: number, meter: TimeSignature, bars: number,
): { times: number[]; accents: boolean[]; endSec: number } {
  const beatSec = 60 / bpm;
  const beatsPerBar = meter.num;
  const total = bars * beatsPerBar;
  const times: number[] = [];
  const accents: boolean[] = [];
  for (let i = 0; i < total; i++) {
    times.push(startSec + i * beatSec);
    accents.push(i % beatsPerBar === 0);
  }
  return { times, accents, endSec: startSec + total * beatSec };
}

export function createCountIn(ctx: AudioContext, out: AudioNode) {
  return (bars: number, bpm: number, meter: TimeSignature, onComplete: () => void): (() => void) => {
    const { times, accents, endSec } = countInClickTimes(ctx.currentTime, bpm, meter, bars);
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = accents[i] ? 1500 : 1000;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(accents[i] ? 0.5 : 0.3, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.05);
    }
    const ms = Math.max(0, (endSec - ctx.currentTime) * 1000);
    const timer = setTimeout(onComplete, ms) as unknown as number;
    return () => clearTimeout(timer);
  };
}
```
Run: `NO_COLOR=1 npx vitest run src/control/metronome.test.ts` → PASS. `npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit** — `git add src/control/metronome.ts src/control/metronome.test.ts && git commit -m "feat(control): count-in metronome — pure click timing + web-audio scheduler"`

---

## Task 2: Facade count-in integration

**Files:**
- Modify: `src/control/loom-facade.ts` (`LoomFacadeDeps`, `startCapture`, `stopCapture`, `isCapturing`)
- Test: `src/control/loom-facade.capture.test.ts` (add count-in cases; keep the existing 5 green)

**Interfaces — Consumes:** `TimeSignature`. **Produces:** `LoomFacadeDeps.countIn?: (bars, bpm, meter, onComplete) => (() => void)`.

- [ ] **Step 1: Read** the current `startCapture`/`stopCapture`/`isCapturing` (around lines 165-222) and the test fixtures in `loom-facade.capture.test.ts` (`makeHostStub`/`makeDeps`).

- [ ] **Step 2: Write failing tests** — add to `loom-facade.capture.test.ts`. Extend `makeDeps` to optionally inject a `countIn` mock:
```ts
it('(f) count-in: startCapture from idle defers recording until the count-in completes', () => {
  const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [] };
  const { host, launchSceneAt } = makeHostStub({ lanes: [lane] });
  let onDone: (() => void) | null = null;
  const cancel = vi.fn();
  const countIn = vi.fn((_b: number, _bpm: number, _m: unknown, cb: () => void) => { onDone = cb; return cancel; });
  const f = createLoomFacade({ ...makeDeps(host, { activeLaneId: 'sub' }), countIn });

  f.startCapture('merge');
  expect(countIn).toHaveBeenCalled();
  expect(launchSceneAt).not.toHaveBeenCalled();   // not launched during the count-in
  expect(f.isCapturing()).toBe(true);             // armed (shows ■ Stop)

  onDone!();                                       // count-in ends
  expect(launchSceneAt).toHaveBeenCalledWith(0);   // recording begins now
});

it('(g) stopCapture during the count-in cancels it and drops the placed clip', () => {
  const lane: SessionLane = { id: 'sub', engineId: 'subtractive', clips: [] };
  const { host, launchSceneAt } = makeHostStub({ lanes: [lane] });
  const cancel = vi.fn();
  const countIn = vi.fn((_b: number, _bpm: number, _m: unknown, _cb: () => void) => cancel);
  const f = createLoomFacade({ ...makeDeps(host, { activeLaneId: 'sub' }), countIn });

  f.startCapture('merge');
  expect(lane.clips[0]).not.toBeNull();            // placed
  f.stopCapture();
  expect(cancel).toHaveBeenCalled();
  expect(lane.clips[0]).toBeNull();                // dropped
  expect(launchSceneAt).not.toHaveBeenCalled();
  expect(f.isCapturing()).toBe(false);
});
```
(The existing 5 cases construct `makeDeps` WITHOUT `countIn` → they must still pass unchanged: no count-in → immediate capture.)
Run → FAIL.

- [ ] **Step 3: Implement.** Add `countIn?` to `LoomFacadeDeps`. Add `let countInCancel: (() => void) | null = null;`. Refactor `startCapture` so the recorder-start + replace-clear + launch become a local `beginRecording()` closure; on the **idle** path, if `deps.countIn` is present schedule it (`countInCancel = deps.countIn(1, deps.seq.bpm, deps.seq.meter, () => { countInCancel = null; beginRecording(); })`), else call `beginRecording()` inline; on the **already-playing** path call `beginRecording()` inline (no count-in). Guard the top of `startCapture` with `if (recorder.isRecording() || countInCancel) return;`. `isCapturing()` → `recorder.isRecording() || countInCancel != null`. `stopCapture()` → if `countInCancel`, call it, drop the placed new clip (`dest.isNew`), clear `countInCancel` + `capture`, `renderWithMixer`, return; else the existing logic.
  - Keep `beginRecording`'s `!anyPlaying()` check (still true after an idle count-in → `launchSceneAt`).

- [ ] **Step 4:** `NO_COLOR=1 npx vitest run src/control/loom-facade.capture.test.ts` → all (5 existing + 2 new) PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/control/loom-facade.ts src/control/loom-facade.capture.test.ts && git commit -m "feat(control): 1-bar count-in before Rec from idle (facade)"`

---

## Task 3: Wire main.ts + verify

**Files:**
- Modify: `src/main.ts` (build `countIn` from `createCountIn`, pass to `createLoomFacade`)

- [ ] **Step 1:** Import `createCountIn` from `./control/metronome`; add `countIn: createCountIn(ctx, ctx.destination)` to the `createLoomFacade({...})` deps object (the call site near line 541 — it already has `ctx`, `seq`, etc.).

- [ ] **Step 2:** `npx tsc --noEmit` → 0. `npm run build` → succeeds.

- [ ] **Step 3:** `npm run test:unit` → full suite green (re-run a flaky DSP `.dsp.test` if one fails "expected 0").

- [ ] **Step 4: Commit** — `git add src/main.ts && git commit -m "feat(control): wire the Rec count-in metronome"`

- [ ] **Step 5: Manual (ear, Chrome):** open a melodic clip, enable `⌨ Keys`, with nothing playing press `● Rec` → hear 1 bar of clicks (accent on beat 1), notes played during the clicks are NOT recorded, recording starts after; press `● Rec` while a scene is already playing → no count-in.

---

## Self-Review (plan author)
- **Spec coverage:** click timing + scheduler → Task 1; defer-capture-until-count-in + cancel + isCapturing → Task 2; wiring + verify → Task 3. Notes-not-captured-during-count-in falls out of "recorder not started until onComplete". ✅
- **No placeholders:** Tasks 1-2 carry complete code / concrete tests; Task 3 is a 1-line dep + verify. ✅
- **Type consistency:** `countIn(bars, bpm, meter, onComplete) => cancel` identical across Tasks 1/2/3; `countInClickTimes` return shape consistent. ✅
- **Backward-compat:** `countIn` is optional; existing facade tests omit it → immediate capture, unchanged. ✅
