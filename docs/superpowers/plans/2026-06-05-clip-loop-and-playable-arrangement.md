# Clip loop regions + playable arrangement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-clip loop sub-region (Phase A) and turn the arrangement into a playable timeline (Phase B) — Copy-to-Performance, MIDI→arrangement, song-stop and an A–B loop brace.

**Architecture:** Two additive, independent phases over the existing pure-logic + scheduler spine. Phase A teaches the per-lane scheduler (`tickLane`) to iterate a sub-region of a clip, driven by a new pure helper. Phase B adds a pure `arrangementFromSession` builder and extends the pure `tickArrangement` runtime with a song-end stop and an A–B loop wrap, plus the UI braces. All new fields are optional ⇒ no `schemaVersion` bump, no migration.

**Tech Stack:** TypeScript, Web Audio, Vite, Vitest (unit + fake-clock scheduling), Playwright (e2e). Tests run colour-free via `cross-env NO_COLOR=1`; invoke a single file with `NO_COLOR=1 npx vitest run <path>`.

**Reference:** spec at [docs/superpowers/specs/2026-06-05-clip-loop-and-playable-arrangement-design.md](../specs/2026-06-05-clip-loop-and-playable-arrangement-design.md).

**Conventions for every task:** assertions are **relative** (ratios, ordering, counts — never absolute magnitudes). Commit after each task. Before any `npm run test:e2e` / `npm test`, run `npm run build` first (the e2e suite serves the last `dist/`, never the live `src/`).

---

## File Structure

**Phase A — clip loop**
- `src/core/clip-loop.ts` *(new)* — pure `effectiveClipLoop(clip, meter)`: resolves the sub-region (defaults + validity guard). Single source of truth used by scheduler, sampler trim and UI.
- `src/core/clip-loop.test.ts` *(new)* — unit tests for the helper.
- `src/session/session.ts` *(modify)* — add optional `loopEnabled/loopStartTick/loopEndTick` to `SessionClip`.
- `src/core/lane-scheduler.ts` *(modify)* — `tickLane` uses the sub-region for period, note filtering, and audio-buffer trim.
- `src/core/lane-scheduler.test.ts` *(modify)* — add sub-region cases (note, slice, audio) + no-regression.
- `src/core/clip-loop-brace.ts` *(new)* — pure px↔tick + clamp/snap math AND the DOM brace component mounted above an editor.
- `src/core/clip-loop-brace.test.ts` *(new)* — unit tests for the pure math.
- `src/session/clip-editors/clip-editor-router.ts` *(modify)* — mount the brace above each editor.

**Phase B — playable arrangement**
- `src/performance/performance.ts` *(modify)* — add optional `loopEnabled/loopStartBar/loopEndBar` to `ArrangementState`.
- `src/performance/arrangement-ops.ts` *(modify)* — add pure `arrangementLoopWindowSec(state)`.
- `src/performance/arrangement-ops.test.ts` *(modify)* — tests for the window helper.
- `src/performance/arrangement-from-session.ts` *(new)* — pure `arrangementFromSession(session, bpm, meter)`.
- `src/performance/arrangement-from-session.test.ts` *(new)* — unit tests.
- `src/performance/arrangement-runtime.ts` *(modify)* — `ArrangementPlayState.ended`; `tickArrangement` song-end stop + A–B wrap.
- `src/performance/arrangement-runtime.test.ts` *(modify)* — song-stop + wrap boundary tests.
- `src/performance/arrangement-brace.ts` *(new)* — pure px↔bar + clamp math for the ruler brace.
- `src/performance/arrangement-brace.test.ts` *(new)* — unit tests.
- `src/performance/performance-ui.ts` *(modify)* — A–B brace on the ruler + Loop toggle in the toolbar.
- `src/app/performance-feature.ts` *(modify)* — wire loop window into `tickArrangement`, playhead modulo, song-end stop via `stopAll`, *Copy to Performance*.
- `src/main.ts` *(modify)* — "⇉ Copiar a Performance" button wiring + MIDI-import→arrangement callback.
- `src/midi/midi-import-ui.ts` *(modify)* — call an `onImported` callback after a successful import.
- `index.html` *(modify)* — the "⇉ Copiar a Performance" button next to `#mode-toggle`.
- `tests/e2e/loop-arrangement.spec.ts` *(new)* — e2e for Copy-to-Performance + arrangement loop.

---

# PHASE A — Per-clip loop sub-region

### Task A1: Pure `effectiveClipLoop` helper + clip fields

**Files:**
- Create: `src/core/clip-loop.ts`
- Modify: `src/session/session.ts:42-56` (SessionClip interface)
- Test: `src/core/clip-loop.test.ts`

- [ ] **Step 1: Add the optional fields to `SessionClip`**

In `src/session/session.ts`, inside the `SessionClip` interface (after `gridResolution?`):

```ts
  /** Loop sub-region (Phase A). When loopEnabled, the scheduler repeats only
   *  [loopStartTick, loopEndTick) instead of the whole clip. Ticks are on the
   *  TICKS_PER_QUARTER grid (same as NoteEvent.start). Absent ⇒ whole clip. */
  loopEnabled?: boolean;
  loopStartTick?: number;
  loopEndTick?: number;
```

- [ ] **Step 2: Write the failing test**

`src/core/clip-loop.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { effectiveClipLoop } from './clip-loop';
import { DEFAULT_METER, ticksPerBar } from './meter';
import type { SessionClip } from '../session/session';

const bar = ticksPerBar(DEFAULT_METER); // 384
const clip = (over: Partial<SessionClip>): SessionClip =>
  ({ id: 'c', lengthBars: 4, notes: [], ...over });

describe('effectiveClipLoop', () => {
  it('loop off ⇒ whole clip', () => {
    expect(effectiveClipLoop(clip({}), DEFAULT_METER)).toEqual({ startTick: 0, endTick: 4 * bar });
  });
  it('loop on with a valid region ⇒ that region', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true, loopStartTick: bar, loopEndTick: 3 * bar }), DEFAULT_METER);
    expect(r).toEqual({ startTick: bar, endTick: 3 * bar });
  });
  it('missing bounds default to 0..total', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true }), DEFAULT_METER);
    expect(r).toEqual({ startTick: 0, endTick: 4 * bar });
  });
  it('invalid region (end <= start) ⇒ whole clip', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true, loopStartTick: 3 * bar, loopEndTick: bar }), DEFAULT_METER);
    expect(r).toEqual({ startTick: 0, endTick: 4 * bar });
  });
  it('bounds are clamped into 0..total', () => {
    const r = effectiveClipLoop(clip({ loopEnabled: true, loopStartTick: -50, loopEndTick: 99 * bar }), DEFAULT_METER);
    expect(r).toEqual({ startTick: 0, endTick: 4 * bar });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/clip-loop.test.ts`
Expected: FAIL — "Failed to resolve import './clip-loop'".

- [ ] **Step 4: Implement `src/core/clip-loop.ts`**

```ts
// Pure resolver for a clip's loop sub-region. Single source of truth for the
// scheduler, the sampler buffer trim and the editor brace. Returns absolute
// tick bounds on the clip's own TICKS_PER_QUARTER grid; loop off / invalid /
// out-of-range all collapse to the whole clip [0, total).
import type { SessionClip } from '../session/session';
import { ticksPerBar, type TimeSignature } from './meter';

export function effectiveClipLoop(
  clip: SessionClip, meter: TimeSignature,
): { startTick: number; endTick: number } {
  const total = clip.lengthBars * ticksPerBar(meter);
  if (!clip.loopEnabled) return { startTick: 0, endTick: total };
  const start = Math.max(0, Math.min(clip.loopStartTick ?? 0, total));
  const end = Math.max(0, Math.min(clip.loopEndTick ?? total, total));
  if (end <= start) return { startTick: 0, endTick: total };
  return { startTick: start, endTick: end };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/clip-loop.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/clip-loop.ts src/core/clip-loop.test.ts src/session/session.ts
git commit -m "feat(clip-loop): pure effectiveClipLoop helper + SessionClip loop fields"
```

---

### Task A2: `tickLane` iterates the sub-region (notes + slice clips)

**Files:**
- Modify: `src/core/lane-scheduler.ts:68-144`
- Test: `src/core/lane-scheduler.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/core/lane-scheduler.test.ts` (the file already imports `tickLane`, `TICKS_PER_STEP`, `TICKS_PER_QUARTER`, `ticksPerBar`, `DEFAULT_METER`):

```ts
describe('lane-scheduler tickLane — clip loop sub-region', () => {
  const bar = ticksPerBar(DEFAULT_METER); // 384

  it('loops only bars 2-3 of a 4-bar clip; period = 2 bars; outside notes never fire', () => {
    const clip: SessionClip = {
      id: 'sub', lengthBars: 4,
      loopEnabled: true, loopStartTick: bar, loopEndTick: 3 * bar,
      notes: [
        { start: 0,        duration: 10, midi: 36, velocity: 100 }, // bar 1 — outside
        { start: bar,      duration: 10, midi: 48, velocity: 100 }, // bar 2 — inside (at region start)
        { start: 2 * bar,  duration: 10, midi: 50, velocity: 100 }, // bar 3 — inside
        { start: 3 * bar,  duration: 10, midi: 60, velocity: 100 }, // bar 4 — outside
      ],
    };
    const fires: Array<{ midi: number; time: number }> = [];
    let loopStart = 0, last = -Infinity;
    // 2 bars at 120 bpm = 4 sec. Run 8 sec ⇒ 2 full iterations.
    for (let now = 0; now < 8.0; now += 0.025) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.12, now, loopStartedAt: loopStart, lastScheduledAt: last,
        onTrigger: (n, t) => { fires.push({ midi: n.midi, time: t }); if (t > last) last = t; },
        onAutomation: () => {},
      });
    }
    expect(fires.some((f) => f.midi === 36 || f.midi === 60)).toBe(false); // outside never fires
    const midis = fires.map((f) => f.midi);
    expect(midis.filter((m) => m === 48).length).toBe(2); // once per iteration
    expect(midis.filter((m) => m === 50).length).toBe(2);
    // region-start note is repositioned to the iteration start (t≈0, 4)
    const m48 = fires.filter((f) => f.midi === 48).map((f) => f.time);
    expect(m48[0]).toBeCloseTo(0, 5);
    expect(m48[1]).toBeCloseTo(4, 5);
  });

  it('loop off is byte-for-byte the current behaviour (no regression)', () => {
    const clip: SessionClip = { id: 'whole', lengthBars: 1, notes: [{ start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 100 }] };
    const fires: number[] = [];
    let loopStart = 0;
    for (let now = 0; now < 8.0; now += 0.2) {
      loopStart = tickLane(clip, { bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart, onTrigger: (_n, t) => fires.push(t), onAutomation: () => {} });
    }
    expect(fires).toHaveLength(4); // identical to the existing 1-bar test
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: FAIL — outside notes (36/60) fire and counts are wrong (sub-region not yet honoured).

- [ ] **Step 3: Implement the sub-region in `tickLane`**

In `src/core/lane-scheduler.ts`: add the import near the top (after the meter import):

```ts
import { effectiveClipLoop } from './clip-loop';
```

Replace the period computation (currently `const clipDurSec = clip.lengthBars * quartersPerBar(meter) * secPerBeat;` around line 71) with:

```ts
  const { startTick, endTick } = effectiveClipLoop(clip, meter);
  const loopTicks = endTick - startTick;
  const clipDurSec = (loopTicks / TICKS_PER_QUARTER) * secPerBeat;
```

In the note-clip branch (the `else` at line 117), change the note loop so only in-region notes fire, repositioned relative to `startTick`:

```ts
      for (const n of clip.notes) {
        if (n.start < startTick || n.start >= endTick) continue;
        const clipTimeSec = ((n.start - startTick) / TICKS_PER_QUARTER) * secPerBeat;
        const scheduleAt  = iterStart + clipTimeSec;
        if (scheduleAt >= windowStart && scheduleAt < windowEnd) {
          let slice: { sampleId: string; start: number; end: number } | undefined;
          if (sliceMode && slices && sampleId) {
            const s = slices.find((x) => x.note === n.midi);
            if (s) slice = { sampleId, start: s.start, end: s.end };
          }
          ctx.onTrigger({ midi: n.midi, duration: n.duration, velocity: n.velocity, slice }, scheduleAt);
        }
      }
```

(The audio branch is updated in Task A3 — leave it for now; loop-off audio still works because `startTick=0, endTick=total`.)

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: PASS (all existing + the 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts
git commit -m "feat(clip-loop): tickLane iterates the loop sub-region for note/slice clips"
```

---

### Task A3: `tickLane` audio sub-region (effective buffer trim)

**Files:**
- Modify: `src/core/lane-scheduler.ts:105-116` (audio branch)
- Test: `src/core/lane-scheduler.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/core/lane-scheduler.test.ts`:

```ts
describe('lane-scheduler tickLane — audio clip loop sub-region', () => {
  const bar = ticksPerBar(DEFAULT_METER);

  it('plays only the buffer fraction matching the sub-region; duration = sub-region ticks', () => {
    // 2-bar clip mapped to buffer [0,4]s. Loop the 2nd bar ⇒ fraction [0.5,1] ⇒ [2,4]s.
    const clip: SessionClip = {
      id: 'a', lengthBars: 2,
      loopEnabled: true, loopStartTick: bar, loopEndTick: 2 * bar,
      notes: [], sample: { sampleId: 's1', mode: 'loop', trimStart: 0, trimEnd: 4 },
    };
    const fires: Array<{ trimStart?: number; trimEnd?: number; duration: number }> = [];
    let loopStart = 0;
    for (let now = 0; now < 2.0; now += 0.2) {
      loopStart = tickLane(clip, {
        bpm: 120, lookaheadSec: 0.2, now, loopStartedAt: loopStart,
        onTrigger: (n, _t) => fires.push({ trimStart: n.sample?.trimStart, trimEnd: n.sample?.trimEnd, duration: n.duration }),
        onAutomation: () => {},
      });
    }
    expect(fires.length).toBeGreaterThan(0);
    expect(fires[0].trimStart).toBeCloseTo(2, 5);
    expect(fires[0].trimEnd).toBeCloseTo(4, 5);
    expect(fires[0].duration).toBe(bar); // one bar of ticks
  });

  it('loop off ⇒ original trim + full duration (no regression)', () => {
    const clip: SessionClip = {
      id: 'b', lengthBars: 1, notes: [],
      sample: { sampleId: 's2', mode: 'loop', trimStart: 0, trimEnd: 1 },
    };
    let loopStart = 0; const fires: Array<{ trimStart?: number; trimEnd?: number; duration: number }> = [];
    tickLane(clip, { bpm: 120, lookaheadSec: 0.2, now: 0, loopStartedAt: loopStart,
      onTrigger: (n) => fires.push({ trimStart: n.sample?.trimStart, trimEnd: n.sample?.trimEnd, duration: n.duration }), onAutomation: () => {} });
    expect(fires[0].trimStart).toBe(0);
    expect(fires[0].trimEnd).toBe(1);
    expect(fires[0].duration).toBe(ticksPerBar(DEFAULT_METER)); // 1 bar
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: FAIL — first test gets full-clip trim (0..4) and duration `2*bar`, not the sub-region.

- [ ] **Step 3: Implement the audio sub-region**

In `src/core/lane-scheduler.ts`, replace the audio branch body (the `if (iterStart >= windowStart && iterStart < windowEnd)` block under `if (clip.sample && !sliceMode)`, lines ~111-115) with:

```ts
      if (iterStart >= windowStart && iterStart < windowEnd) {
        const total = clip.lengthBars * ticksPerBar(meter);
        const isWhole = startTick === 0 && endTick === total;
        let sample = clip.sample;
        if (!isWhole) {
          const span = clip.sample.trimEnd - clip.sample.trimStart;
          sample = {
            ...clip.sample,
            trimStart: clip.sample.trimStart + (startTick / total) * span,
            trimEnd:   clip.sample.trimStart + (endTick / total) * span,
          };
        }
        ctx.onTrigger({ midi: 60, duration: loopTicks, velocity: 100, sample }, iterStart);
      }
```

Add `ticksPerBar` to the meter import at the top:

```ts
import { quartersPerBar, ticksPerBar, DEFAULT_METER, type TimeSignature } from './meter';
```

(Note: `loopTicks` for the whole clip equals `lengthBars * ticksPerBar` = the previous `duration`, so loop-off is unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: PASS (including the existing audio-clip tests that assert `duration === ticksPerBar(DEFAULT_METER) * lengthBars`).

- [ ] **Step 5: Commit**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts
git commit -m "feat(clip-loop): tickLane plays the sub-region buffer fraction for audio clips"
```

---

### Task A4: Clip loop brace UI (pure math + DOM component + mount)

**Files:**
- Create: `src/core/clip-loop-brace.ts`
- Create: `src/core/clip-loop-brace.test.ts`
- Modify: `src/session/clip-editors/clip-editor-router.ts:58-105`

- [ ] **Step 1: Write the failing test for the pure math**

`src/core/clip-loop-brace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pxToTick, snapTick, clampLoopRegion } from './clip-loop-brace';

describe('clip-loop-brace math', () => {
  it('pxToTick maps 0..width to 0..total', () => {
    expect(pxToTick(0, 200, 800)).toBe(0);
    expect(pxToTick(100, 200, 800)).toBe(400);
    expect(pxToTick(200, 200, 800)).toBe(800);
  });
  it('pxToTick clamps out-of-range px', () => {
    expect(pxToTick(-10, 200, 800)).toBe(0);
    expect(pxToTick(999, 200, 800)).toBe(800);
  });
  it('snapTick rounds to the nearest grid step', () => {
    expect(snapTick(50, 24)).toBe(48);
    expect(snapTick(60, 24)).toBe(72);
  });
  it('clampLoopRegion keeps start<end within 0..total and min one step', () => {
    expect(clampLoopRegion(100, 50, 800, 24)).toEqual({ start: 50, end: 100 }); // swaps
    expect(clampLoopRegion(0, 0, 800, 24)).toEqual({ start: 0, end: 24 });      // min width
    expect(clampLoopRegion(-10, 9000, 800, 24)).toEqual({ start: 0, end: 800 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/clip-loop-brace.test.ts`
Expected: FAIL — "Failed to resolve import './clip-loop-brace'".

- [ ] **Step 3: Implement `src/core/clip-loop-brace.ts`**

```ts
// Clip loop brace: pure px↔tick math + a DOM strip mounted above a clip editor.
// The strip maps its OWN full width to [0, total) ticks (independent of the
// canvas zoom) — it marks bars, not pixels. Drag the handles to set the clip's
// loop sub-region; the toggle enables/disables it.
import type { SessionClip } from '../session/session';
import { ticksPerBar, TICKS_PER_STEP, type TimeSignature } from './meter';
import { effectiveClipLoop } from './clip-loop';
import type { HistoryDeps } from '../save/history-wiring';

export function pxToTick(px: number, widthPx: number, total: number): number {
  if (widthPx <= 0) return 0;
  const t = (px / widthPx) * total;
  return Math.max(0, Math.min(total, t));
}
export function tickToPx(tick: number, widthPx: number, total: number): number {
  if (total <= 0) return 0;
  return (tick / total) * widthPx;
}
export function snapTick(tick: number, step: number): number {
  return Math.round(tick / step) * step;
}
export function clampLoopRegion(
  start: number, end: number, total: number, step: number,
): { start: number; end: number } {
  let a = Math.max(0, Math.min(total, Math.min(start, end)));
  let b = Math.max(0, Math.min(total, Math.max(start, end)));
  if (b - a < step) b = Math.min(total, a + step);
  if (b - a < step) a = Math.max(0, b - step);
  return { start: a, end: b };
}

/** Mount a loop-brace strip as the first child of `host` (above the editor).
 *  Mutates the clip's loop fields through historyDeps gestures so it is undoable. */
export function mountClipLoopBrace(
  host: HTMLElement,
  clip: SessionClip,
  meter: TimeSignature,
  historyDeps: HistoryDeps | undefined,
  onChange: () => void,
): void {
  const total = clip.lengthBars * ticksPerBar(meter);
  const stepTicks = TICKS_PER_STEP; // 1/16 snap

  const strip = document.createElement('div');
  strip.className = 'clip-loop-brace';
  const toggle = document.createElement('button');
  toggle.className = 'clip-loop-toggle' + (clip.loopEnabled ? ' on' : '');
  toggle.textContent = 'Loop';
  const track = document.createElement('div');
  track.className = 'clip-loop-track';
  const region = document.createElement('div');
  region.className = 'clip-loop-region';
  const hL = document.createElement('span'); hL.className = 'clip-loop-handle l';
  const hR = document.createElement('span'); hR.className = 'clip-loop-handle r';
  region.append(hL, hR);
  track.appendChild(region);
  strip.append(toggle, track);
  host.insertBefore(strip, host.firstChild);

  const layout = () => {
    const { startTick, endTick } = effectiveClipLoop(clip, meter);
    const w = track.clientWidth || 1;
    region.style.left = `${tickToPx(startTick, w, total)}px`;
    region.style.width = `${tickToPx(endTick - startTick, w, total)}px`;
    region.style.display = clip.loopEnabled ? '' : 'none';
    toggle.classList.toggle('on', !!clip.loopEnabled);
  };

  toggle.addEventListener('click', () => {
    historyDeps?.history.beginGesture(historyDeps.snapshot());
    clip.loopEnabled = !clip.loopEnabled;
    if (clip.loopEnabled && clip.loopEndTick == null) { clip.loopStartTick = 0; clip.loopEndTick = total; }
    historyDeps?.history.commitGesture();
    layout(); onChange();
  });

  const startDrag = (which: 'l' | 'r') => (down: PointerEvent) => {
    down.preventDefault();
    if (!clip.loopEnabled) return;
    historyDeps?.history.beginGesture(historyDeps.snapshot());
    const move = (e: PointerEvent) => {
      const rect = track.getBoundingClientRect();
      const tick = snapTick(pxToTick(e.clientX - rect.left, rect.width, total), stepTicks);
      const cur = effectiveClipLoop(clip, meter);
      const next = which === 'l'
        ? clampLoopRegion(tick, cur.endTick, total, stepTicks)
        : clampLoopRegion(cur.startTick, tick, total, stepTicks);
      clip.loopStartTick = next.start; clip.loopEndTick = next.end;
      layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      historyDeps?.history.commitGesture(); onChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  hL.addEventListener('pointerdown', startDrag('l'));
  hR.addEventListener('pointerdown', startDrag('r'));

  // Defer first layout to after the host has width.
  requestAnimationFrame(layout);
}
```

- [ ] **Step 4: Run to verify the math passes**

Run: `NO_COLOR=1 npx vitest run src/core/clip-loop-brace.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount the brace in the editor router**

In `src/session/clip-editors/clip-editor-router.ts`, add the import:

```ts
import { mountClipLoopBrace } from '../../core/clip-loop-brace';
```

At the end of `renderClipEditor`, the function returns a handle from one of three paths. Wrap the return so the brace is mounted for every path. Replace the three `return ...` statements with assignments to a `const handle = ...;` then, before returning, mount the brace. Concretely, change the body after `host.innerHTML = '';`:

```ts
  const engine = getEngine(lane.engineId);
  const editor = chooseClipEditor(lane, engine?.editor, override);
  let handle: PianoRollHandle | null;

  if (isSliceLoopClip(clip)) {
    /* ...existing slice-loop block unchanged, but assign instead of return... */
    handle = renderLoopEditor(host, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition, getPlayheadTick });
  } else if (editor === 'drum-grid') {
    /* ...existing drum-grid block unchanged, assign instead of return... */
    handle = renderDrumGridEditor(host, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition, getPlayheadTick });
  } else {
    handle = buildPianoRoll(host, lane, clip, deps);
  }

  mountClipLoopBrace(host, clip, deps.seq.meter, deps.historyDeps, () => {});
  return handle;
```

(Keep the `audition`/`getPlayheadTick` locals inside their respective branches exactly as they are today — only the `return` becomes `handle =`.)

- [ ] **Step 6: Add minimal styles**

In the relevant SCSS under `src/styles/` (find the clip-editor partial; if unsure, append to `src/styles/main.scss`):

```scss
.clip-loop-brace { display:flex; align-items:center; gap:8px; height:20px; margin-bottom:4px; }
.clip-loop-toggle { font-size:11px; padding:2px 8px; border-radius:12px; }
.clip-loop-toggle.on { background:#ffcc33; color:#222; }
.clip-loop-track { position:relative; flex:1; height:14px; background:#23272f; border-radius:4px; }
.clip-loop-region { position:absolute; top:0; bottom:0; background:rgba(255,204,51,.18); border:1px solid #ffcc33; box-sizing:border-box; }
.clip-loop-handle { position:absolute; top:0; bottom:0; width:8px; cursor:ew-resize; }
.clip-loop-handle.l { left:-4px; } .clip-loop-handle.r { right:-4px; }
```

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: bundles to `dist/`.

- [ ] **Step 8: Commit**

```bash
git add src/core/clip-loop-brace.ts src/core/clip-loop-brace.test.ts src/session/clip-editors/clip-editor-router.ts src/styles
git commit -m "feat(clip-loop): loop brace UI mounted above every clip editor"
```

---

# PHASE B — Playable arrangement

### Task B1: Arrangement loop fields + pure `arrangementLoopWindowSec`

**Files:**
- Modify: `src/performance/performance.ts:28-36`
- Modify: `src/performance/arrangement-ops.ts` (append helper)
- Test: `src/performance/arrangement-ops.test.ts` (append; create if absent)

- [ ] **Step 1: Add the optional fields to `ArrangementState`**

In `src/performance/performance.ts`, inside `ArrangementState` (after `globalAutomation`):

```ts
  /** A–B loop (Phase B). When loopEnabled, playback repeats [loopStartBar,
   *  loopEndBar) instead of stopping at the end. Bars; absent ⇒ no loop. */
  loopEnabled?: boolean;
  loopStartBar?: number;
  loopEndBar?: number;
```

- [ ] **Step 2: Write the failing test**

In `src/performance/arrangement-ops.test.ts` (append; if the file does not exist, create it with the standard `import { describe, it, expect } from 'vitest';` header):

```ts
import { arrangementLoopWindowSec, finalizeArrangement } from './arrangement-ops';
import { emptyArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent } from './arrangement-ops';

describe('arrangementLoopWindowSec', () => {
  const withTake = () => {
    const s = emptyArrangementState(120); // barSec = 2 at 120
    appendClipEvent(s, 'l1', 'c1', 0); closePendingClipEvent(s, 'l1', 16); // 8 bars
    finalizeArrangement(s, 16);
    return s;
  };
  it('loop off ⇒ inactive, endSec = full duration', () => {
    const s = withTake();
    expect(arrangementLoopWindowSec(s)).toEqual({ startSec: 0, endSec: 16, active: false });
  });
  it('loop on ⇒ [startBar,endBar) in seconds', () => {
    const s = withTake(); s.loopEnabled = true; s.loopStartBar = 2; s.loopEndBar = 6;
    expect(arrangementLoopWindowSec(s)).toEqual({ startSec: 4, endSec: 12, active: true });
  });
  it('invalid (end<=start) ⇒ inactive full duration', () => {
    const s = withTake(); s.loopEnabled = true; s.loopStartBar = 6; s.loopEndBar = 2;
    expect(arrangementLoopWindowSec(s)).toEqual({ startSec: 0, endSec: 16, active: false });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts`
Expected: FAIL — `arrangementLoopWindowSec` is not exported.

- [ ] **Step 4: Implement `arrangementLoopWindowSec` in `arrangement-ops.ts`**

Append (the file already has `barSec` and `effectiveDurationSec`):

```ts
/** Resolve the playback window in seconds. Loop off / invalid ⇒ inactive with
 *  endSec at the full effective duration (the song-end stop boundary). */
export function arrangementLoopWindowSec(
  s: ArrangementState,
): { startSec: number; endSec: number; active: boolean } {
  const fullEnd = effectiveDurationSec(s);
  if (!s.loopEnabled) return { startSec: 0, endSec: fullEnd, active: false };
  const bs = barSec(s.bpm);
  const start = Math.max(0, (s.loopStartBar ?? 0) * bs);
  const end = Math.min(fullEnd, (s.loopEndBar ?? fullEnd / bs) * bs);
  if (end <= start) return { startSec: 0, endSec: fullEnd, active: false };
  return { startSec: start, endSec: end, active: true };
}
```

Add `ArrangementState` to the type import at the top if not already imported (it is: `import { ... type ArrangementState } from './performance';`).

- [ ] **Step 5: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-ops.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/performance/performance.ts src/performance/arrangement-ops.ts src/performance/arrangement-ops.test.ts
git commit -m "feat(arrangement): loop fields + pure arrangementLoopWindowSec"
```

---

### Task B2: Pure `arrangementFromSession` builder

**Files:**
- Create: `src/performance/arrangement-from-session.ts`
- Test: `src/performance/arrangement-from-session.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/performance/arrangement-from-session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { arrangementFromSession } from './arrangement-from-session';
import { DEFAULT_METER } from '../core/meter';
import type { SessionState } from '../session/session';

const s = (over: Partial<SessionState>): SessionState =>
  ({ lanes: [], scenes: [], globalQuantize: '1/1', ...over });

describe('arrangementFromSession', () => {
  it('one scene sizes its section by the longest clip; one event per lane', () => {
    const state = s({
      lanes: [
        { id: 'A', engineId: 'tb303', clips: [{ id: 'a1', lengthBars: 2, notes: [] }] },
        { id: 'B', engineId: 'drums', clips: [{ id: 'b1', lengthBars: 4, notes: [] }] },
      ],
      scenes: [{ id: 's0', clipPerLane: { A: 0, B: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER); // barSec=2
    expect(arr.durationSec).toBe(8); // 4 bars
    const la = arr.lanes.find((l) => l.laneId === 'A')!;
    expect(la.clipEvents).toEqual([{ clipId: 'a1', laneId: 'A', atSec: 0, untilSec: 8 }]);
  });

  it('two scenes concatenate in order; a lane present in both gets two consecutive events', () => {
    const state = s({
      lanes: [{ id: 'A', engineId: 'tb303', clips: [{ id: 'a1', lengthBars: 2, notes: [] }, { id: 'a2', lengthBars: 2, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }, { id: 's1', clipPerLane: { A: 1 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    const la = arr.lanes.find((l) => l.laneId === 'A')!;
    expect(la.clipEvents).toEqual([
      { clipId: 'a1', laneId: 'A', atSec: 0, untilSec: 4 },
      { clipId: 'a2', laneId: 'A', atSec: 4, untilSec: 8 },
    ]);
    expect(arr.durationSec).toBe(8);
  });

  it('a clip with a loop sub-region contributes its sub-region length, not lengthBars', () => {
    const bar = 384; // ticksPerBar 4/4
    const state = s({
      lanes: [{ id: 'A', engineId: 'tb303', clips: [{ id: 'a1', lengthBars: 4, loopEnabled: true, loopStartTick: 0, loopEndTick: 2 * bar, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    expect(arr.durationSec).toBe(4); // 2 bars, not 4
  });

  it('MIDI-style single long clip ⇒ one pass start to end', () => {
    const state = s({
      lanes: [{ id: 'A', engineId: 'poly', clips: [{ id: 'song', lengthBars: 8, notes: [] }] }],
      scenes: [{ id: 's0', clipPerLane: { A: 0 } }],
    });
    const arr = arrangementFromSession(state, 120, DEFAULT_METER);
    expect(arr.lanes[0].clipEvents).toEqual([{ clipId: 'song', laneId: 'A', atSec: 0, untilSec: 16 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-from-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/performance/arrangement-from-session.ts`**

```ts
// Pure: flatten a Session (scenes in order) into a playable ArrangementState.
// Each scene becomes a section whose length = the longest effective clip in it
// (a clip's effective length honours its loop sub-region). Every lane with a
// clip in the scene gets one clipEvent spanning the section; the clip loops
// inside that span via session-runtime. Mirrors launchScene's clip resolution
// (explicit clipPerLane wins, else the scene row index).
import type { SessionState } from '../session/session';
import type { TimeSignature } from '../core/meter';
import { ticksPerBar } from '../core/meter';
import { effectiveClipLoop } from '../core/clip-loop';
import { emptyArrangementState, type ArrangementState } from './performance';
import { appendClipEvent, closePendingClipEvent } from './arrangement-ops';

export function arrangementFromSession(
  state: SessionState, bpm: number, meter: TimeSignature,
): ArrangementState {
  const arr = emptyArrangementState(bpm);
  const barSec = (60 / bpm) * 4;
  const tpb = ticksPerBar(meter);
  let cursorSec = 0;

  state.scenes.forEach((scene, sceneIdx) => {
    // Resolve each lane's clip for this scene (explicit mapping wins).
    const picks: { laneId: string; clipId: string; bars: number }[] = [];
    for (const lane of state.lanes) {
      const hasExplicit = Object.prototype.hasOwnProperty.call(scene.clipPerLane, lane.id);
      const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx;
      if (idx == null) continue;
      const clip = lane.clips[idx];
      if (!clip) continue;
      const { startTick, endTick } = effectiveClipLoop(clip, meter);
      picks.push({ laneId: lane.id, clipId: clip.id, bars: (endTick - startTick) / tpb });
    }
    if (picks.length === 0) return;
    const sectionSec = Math.max(...picks.map((p) => p.bars)) * barSec;
    for (const p of picks) {
      appendClipEvent(arr, p.laneId, p.clipId, cursorSec);
      closePendingClipEvent(arr, p.laneId, cursorSec + sectionSec);
    }
    cursorSec += sectionSec;
  });

  arr.durationSec = cursorSec;
  return arr;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-from-session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-from-session.ts src/performance/arrangement-from-session.test.ts
git commit -m "feat(arrangement): pure arrangementFromSession (scenes in order)"
```

---

### Task B3: Wire "Copiar a Performance" + MIDI-import→arrangement

**Files:**
- Modify: `index.html:99-101` (add the button)
- Modify: `src/app/performance-feature.ts` (expose a `copyFromSession` helper)
- Modify: `src/main.ts` (button click handler + pass `onImported` to the MIDI UI)
- Modify: `src/midi/midi-import-ui.ts:158-198` (call `deps.onImported?.()` after a successful import)

- [ ] **Step 1: Add the button to `index.html`**

Replace the `#mode-toggle` span (lines 99-101) so the button sits beside it:

```html
        <span class="mode-toggle" id="mode-toggle">
          <button class="mode-btn on" data-mode="session">Session</button>
          <button class="mode-btn" data-mode="performance">Performance</button>
        </span>
        <button class="rnd" id="copy-to-performance" title="Volcar las escenas a la timeline y abrir Performance">⇉ Copiar a Performance</button>
```

- [ ] **Step 2: Expose `copyFromSession` on the performance feature**

In `src/app/performance-feature.ts`, add to the `PerformanceFeature` interface:

```ts
  /** Build the arrangement from the current session (scenes in order) and
   *  switch to Performance. */
  copyFromSession: () => void;
```

Implement it inside `createPerformanceFeature` (near `setArrangement`), importing the builder at the top (`import { arrangementFromSession } from '../performance/arrangement-from-session';`):

```ts
  function copyFromSession() {
    const built = arrangementFromSession(sessionHost.state, seq.bpm, seq.meter);
    setArrangement(built);
    setMode('performance');
  }
```

Return it in the object literal at the end (`copyFromSession,`).

- [ ] **Step 3: Wire the button + undo in `main.ts`**

In `src/main.ts`, after `performanceFeature` is created, add (wrap in `withUndo` if a snapshot helper is in scope — follow the existing pattern used for other session mutations; if `withUndo` is not directly available here, the `setArrangement` path already persists via save):

```ts
  const copyBtn = document.getElementById('copy-to-performance');
  copyBtn?.addEventListener('click', () => performanceFeature.copyFromSession());
```

- [ ] **Step 4: Pass `onImported` to the MIDI import UI**

In `src/midi/midi-import-ui.ts`, add an optional field to its deps interface (find the `deps` type near the top of the file):

```ts
  onImported?: () => void;
```

In the `loadBtn` click handler, after `deps.launchScene(result.scene.id);` (line ~196):

```ts
    deps.onImported?.();
```

In `src/main.ts`, where the MIDI import UI is constructed, pass:

```ts
    onImported: () => performanceFeature.copyFromSession(),
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → bundles.

- [ ] **Step 6: Manual smoke (browser)**

Start `npm run dev`, open http://localhost:5173, add a couple of clips/scenes, click **⇉ Copiar a Performance**. Expected: view switches to Performance and clip bands appear on the timeline. (Automated e2e is added in Task B6 once the loop UI exists.)

- [ ] **Step 7: Commit**

```bash
git add index.html src/app/performance-feature.ts src/main.ts src/midi/midi-import-ui.ts
git commit -m "feat(arrangement): Copy-to-Performance button + MIDI import populates the arrangement"
```

---

### Task B4: `tickArrangement` song-end stop

**Files:**
- Modify: `src/performance/arrangement-runtime.ts:6-94`
- Test: `src/performance/arrangement-runtime.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/performance/arrangement-runtime.test.ts`:

```ts
describe('tickArrangement song-end stop', () => {
  it('stops every lane and fires onArrangementEnd once when the playhead reaches endSec', () => {
    const s = emptyArrangementState(120);
    appendClipEvent(s, 'l1', 'c1', 0); closePendingClipEvent(s, 'l1', 4);
    appendClipEvent(s, 'l2', 'd1', 0); closePendingClipEvent(s, 'l2', 4);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);

    const stops: string[] = [];
    let ended = 0;
    const tick = (nowCtx: number) => tickArrangement({
      ps, state: s, nowCtx, lookaheadSec: 0.12, bpm: 120,
      loopWindow: { startSec: 0, endSec: 4, active: false },
      onArrangementEnd: () => { ended++; },
      onLaunchClip: () => {}, onStopLane: (id) => stops.push(id), applyAutomation: () => {},
    });
    tick(101);     // tNow=1, nothing
    expect(ended).toBe(0);
    tick(104);     // tNow=4 reaches end
    expect(new Set(stops)).toEqual(new Set(['l1', 'l2']));
    expect(ended).toBe(1);
    tick(104.05);  // already ended ⇒ no repeat
    expect(ended).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts`
Expected: FAIL — `loopWindow`/`onArrangementEnd` unused; no stops, `ended` stays 0.

- [ ] **Step 3: Implement song-end stop**

In `src/performance/arrangement-runtime.ts`:

Add `ended: boolean` to `ArrangementPlayState` and init it:

```ts
export interface ArrangementPlayState {
  isPlaying: boolean;
  startedAtCtx: number;
  laneOverridden: Map<string, boolean>;
  nextEventIdxPerLane: Map<string, number>;
  ended: boolean;
}
```
In `createArrangementPlayState` add `ended: false,`. In `startArrangement` add `ps.ended = false;`.

Extend `TickArrangementArgs`:

```ts
  loopWindow?: { startSec: number; endSec: number; active: boolean };
  onArrangementEnd?: () => void;
```

At the end of `tickArrangement`, after the automation loops (after line ~93), before the function returns:

```ts
  const lw = args.loopWindow;
  if (lw && !lw.active && !ps.ended && tNow + lookaheadSec >= lw.endSec) {
    for (const lane of state.lanes) onStopLane(lane.laneId, ps.startedAtCtx + lw.endSec);
    ps.ended = true;
    args.onArrangementEnd?.();
  }
```

(`tNow`/`tMax`/`onStopLane` are already in scope from the top of the function.)

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts`
Expected: PASS (existing tests still green — they pass no `loopWindow`, so the new block is skipped).

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-runtime.ts src/performance/arrangement-runtime.test.ts
git commit -m "feat(arrangement): song-end stops every lane and fires onArrangementEnd once"
```

---

### Task B5: `tickArrangement` A–B loop wrap

**Files:**
- Modify: `src/performance/arrangement-runtime.ts`
- Test: `src/performance/arrangement-runtime.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/performance/arrangement-runtime.test.ts`:

```ts
describe('tickArrangement A-B loop wrap', () => {
  it('re-anchors the clock and relaunches the active clip at A when crossing B', () => {
    const s = emptyArrangementState(120);
    // Lane has one long clip covering [0,8). Loop window A=2 B=6.
    appendClipEvent(s, 'l1', 'c1', 0); closePendingClipEvent(s, 'l1', 8);

    const ps = createArrangementPlayState();
    startArrangement(ps, 100);
    const lw = { startSec: 2, endSec: 6, active: true };

    const launches: Array<{ id: string; at: number }> = [];
    const stops: string[] = [];
    const tick = (nowCtx: number) => tickArrangement({
      ps, state: s, nowCtx, lookaheadSec: 0.12, bpm: 120, loopWindow: lw,
      onLaunchClip: (_l, id, at) => launches.push({ id, at }),
      onStopLane: (id) => stops.push(id), applyAutomation: () => {},
    });

    tick(100);   // tNow=0: launches c1 at start
    expect(launches.map((l) => l.id)).toEqual(['c1']);
    const startedBefore = ps.startedAtCtx;
    tick(106);   // tNow=6 reaches B ⇒ wrap
    expect(stops).toContain('l1');               // stop scheduled at B
    expect(ps.startedAtCtx).toBeCloseTo(startedBefore + (lw.endSec - lw.startSec), 5); // re-anchored by period (4)
    // After the wrap the active clip is relaunched so A keeps sounding.
    expect(launches.length).toBeGreaterThanOrEqual(2);
    expect(launches[launches.length - 1].id).toBe('c1');
    expect(ps.ended).toBe(false); // loop never "ends"
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts`
Expected: FAIL — no wrap logic; `startedAtCtx` unchanged, no second launch.

- [ ] **Step 3: Implement the wrap**

In `src/performance/arrangement-runtime.ts`, replace the song-end block from Task B4 with the combined end/loop handling (the `!lw.active` branch is the Task B4 behaviour; the `lw.active` branch is new):

```ts
  const lw = args.loopWindow;
  if (lw && tNow + lookaheadSec >= lw.endSec) {
    if (!lw.active) {
      if (!ps.ended) {
        for (const lane of state.lanes) onStopLane(lane.laneId, ps.startedAtCtx + lw.endSec);
        ps.ended = true;
        args.onArrangementEnd?.();
      }
    } else {
      const period = lw.endSec - lw.startSec;
      // 1) stop everyone at B
      for (const lane of state.lanes) onStopLane(lane.laneId, ps.startedAtCtx + lw.endSec);
      // 2) re-anchor so the next tick's tNow lands back at A
      ps.startedAtCtx += period;
      // 3) reset indices to the first event at/after A, then relaunch the clip
      //    that is active across A so it keeps sounding after the wrap.
      for (const lane of state.lanes) {
        let idx = 0;
        let active: typeof lane.clipEvents[number] | undefined;
        for (let i = 0; i < lane.clipEvents.length; i++) {
          const ev = lane.clipEvents[i];
          if (ev.atSec <= lw.startSec && lw.startSec < ev.untilSec) active = ev;
          if (ev.atSec < lw.startSec) idx = i + 1;
        }
        ps.nextEventIdxPerLane.set(lane.laneId, idx);
        if (active) onLaunchClip(lane.laneId, active.clipId, ps.startedAtCtx + lw.startSec);
      }
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-runtime.test.ts`
Expected: PASS (song-end test from B4 + the new wrap test + all originals).

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-runtime.ts src/performance/arrangement-runtime.test.ts
git commit -m "feat(arrangement): A-B loop wrap (re-anchor + relaunch active clip at A)"
```

---

### Task B6: Arrangement A–B brace + Loop toggle + playhead modulo + e2e

**Files:**
- Create: `src/performance/arrangement-brace.ts`
- Create: `src/performance/arrangement-brace.test.ts`
- Modify: `src/performance/performance-ui.ts:93-200`
- Modify: `src/app/performance-feature.ts` (loop window into tick, playhead modulo, song-end stop via stopAll)
- Create: `tests/e2e/loop-arrangement.spec.ts`

- [ ] **Step 1: Write the failing test for the pure brace math**

`src/performance/arrangement-brace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pxToBar, clampBarRegion } from './arrangement-brace';

describe('arrangement-brace math', () => {
  it('pxToBar maps px to bars given pxPerBar, snapped to whole bars', () => {
    expect(pxToBar(0, 80)).toBe(0);
    expect(pxToBar(85, 80)).toBe(1);   // nearest bar
    expect(pxToBar(160, 80)).toBe(2);
  });
  it('clampBarRegion keeps start<end, min 1 bar, within 0..total', () => {
    expect(clampBarRegion(5, 2, 8)).toEqual({ start: 2, end: 5 });
    expect(clampBarRegion(3, 3, 8)).toEqual({ start: 3, end: 4 });
    expect(clampBarRegion(-2, 99, 8)).toEqual({ start: 0, end: 8 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-brace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/performance/arrangement-brace.ts`**

```ts
// Pure math for the arrangement ruler loop brace (whole-bar snap).
export function pxToBar(px: number, pxPerBar: number): number {
  if (pxPerBar <= 0) return 0;
  return Math.max(0, Math.round(px / pxPerBar));
}
export function clampBarRegion(
  start: number, end: number, totalBars: number,
): { start: number; end: number } {
  let a = Math.max(0, Math.min(totalBars, Math.min(start, end)));
  let b = Math.max(0, Math.min(totalBars, Math.max(start, end)));
  if (b - a < 1) b = Math.min(totalBars, a + 1);
  if (b - a < 1) a = Math.max(0, b - 1);
  return { start: a, end: b };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/performance/arrangement-brace.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Loop toggle + brace to `performance-ui.ts`**

Extend `PerfUICallbacks` with:

```ts
  loopEnabled: boolean;
  loopStartBar: number;
  loopEndBar: number;
  onSetLoop: (enabled: boolean, startBar: number, endBar: number) => void;
```

In `makeToolbar`, add a Loop toggle button after the brush bar:

```ts
  const loopBtn = document.createElement('button');
  loopBtn.className = 'rnd perf-loop-toggle' + (cb.loopEnabled ? ' primary' : '');
  loopBtn.textContent = 'Loop A–B';
  loopBtn.addEventListener('click', () => cb.onSetLoop(!cb.loopEnabled, cb.loopStartBar, cb.loopEndBar));
  bar.append(' · ', loopBtn);
```

In `makeRuler`, after building the bar marks, append a draggable brace when enabled (uses `pxToBar`/`clampBarRegion`, imported at the top):

```ts
  if (cb.loopEnabled) {
    const brace = document.createElement('div');
    brace.className = 'perf-loop-brace';
    brace.style.left = `${cb.loopStartBar * pxPerBar}px`;
    brace.style.width = `${(cb.loopEndBar - cb.loopStartBar) * pxPerBar}px`;
    const hL = document.createElement('span'); hL.className = 'perf-loop-handle l';
    const hR = document.createElement('span'); hR.className = 'perf-loop-handle r';
    brace.append(hL, hR);
    const drag = (which: 'l' | 'r') => (down: PointerEvent) => {
      down.preventDefault();
      const move = (e: PointerEvent) => {
        const rect = track.getBoundingClientRect();
        const b = pxToBar(e.clientX - rect.left, pxPerBar);
        const r = which === 'l' ? clampBarRegion(b, cb.loopEndBar, bars) : clampBarRegion(cb.loopStartBar, b, bars);
        cb.onSetLoop(true, r.start, r.end);
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    hL.addEventListener('pointerdown', drag('l')); hR.addEventListener('pointerdown', drag('r'));
    track.appendChild(brace);
  }
```

`makeRuler` must receive `cb` and `pxPerBar` — it already takes `pxPerBar`; add `cb: PerfUICallbacks` as a parameter and pass it from `renderPerformanceView` (the call at line ~178 becomes `makeRuler(dur, state.bpm, cb.pxPerBar, cb)`), and compute `bars` from `Math.ceil(durationSec / barSec)` already present in `makeRuler`.

Add styles to `src/styles` (performance partial):

```scss
.perf-loop-brace { position:absolute; top:0; height:22px; background:rgba(255,204,51,.16); border-left:2px solid #ffcc33; border-right:2px solid #ffcc33; box-sizing:border-box; }
.perf-loop-handle { position:absolute; top:0; bottom:0; width:8px; cursor:ew-resize; } .perf-loop-handle.l{left:-4px;} .perf-loop-handle.r{right:-4px;}
.perf-loop-toggle.primary { background:#ffcc33; color:#222; }
```

- [ ] **Step 6: Wire callbacks + loop window + playhead modulo in `performance-feature.ts`**

In `refreshPerformanceView`'s `renderPerformanceView({...})` call, add:

```ts
      loopEnabled: !!arrangement.loopEnabled,
      loopStartBar: arrangement.loopStartBar ?? 0,
      loopEndBar: arrangement.loopEndBar ?? Math.ceil(effectiveDurationSec(arrangement) / ((60 / arrangement.bpm) * 4)),
      onSetLoop: (enabled, startBar, endBar) => {
        arrangement.loopEnabled = enabled; arrangement.loopStartBar = startBar; arrangement.loopEndBar = endBar;
        onPerformanceEdited?.(); refreshPerformanceView();
      },
```

Import `effectiveDurationSec` and `arrangementLoopWindowSec` from `../performance/arrangement-ops`, and `stopAll` from `../session/session-runtime`.

In `onLookahead`, pass the loop window + end handler into `tickArrangement`:

```ts
      tickArrangement({
        ps: arrangementPlayState, state: arrangement, nowCtx, lookaheadSec,
        bpm: arrangement.bpm || seq.bpm,
        loopWindow: arrangementLoopWindowSec(arrangement),
        onArrangementEnd: () => { stopAll(sessionHost.laneStates); stopArrangement(arrangementPlayState); },
        onLaunchClip: arrangementOnLaunchClip,
        onStopLane: arrangementOnStopLane,
        applyAutomation: arrangementApplyAutomation,
      });
```

In `rafPlayhead`, fold the playhead position into the loop window when active:

```ts
      const barSec = (60 / (arrangement.bpm || seq.bpm)) * 4;
      const lw = arrangementLoopWindowSec(arrangement);
      let sec = arrangementPlayhead(arrangementPlayState, ctx.currentTime);
      if (lw.active) sec = lw.startSec + ((sec - lw.startSec) % (lw.endSec - lw.startSec));
      const bars = sec / barSec;
      el.style.left = `${90 + bars * pxPerBar}px`;
```

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → bundles.

- [ ] **Step 8: Write the e2e**

`tests/e2e/loop-arrangement.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('Copy to Performance populates the arrangement and switches view', async ({ page }) => {
  await page.goto('/');
  await page.locator('#copy-to-performance').click();
  // Performance view becomes visible and shows at least one clip band.
  await expect(page.locator('#performance-view-root')).toBeVisible();
  await expect(page.locator('#performance-view-root .perf-clip').first()).toBeVisible();
});

test('enabling Loop shows the A–B brace on the ruler', async ({ page }) => {
  await page.goto('/');
  await page.locator('#copy-to-performance').click();
  await page.locator('.perf-loop-toggle').click();
  await expect(page.locator('.perf-loop-brace')).toBeVisible();
});
```

- [ ] **Step 9: Build then run e2e**

Run: `npm run build`
Run: `npm run test:e2e -- loop-arrangement`
Expected: PASS. (If the default session has no clips, the first test may need a clip created first — if so, prepend a click on an empty clip cell to create one before Copy; adjust the selector to the session grid's add-clip affordance.)

- [ ] **Step 10: Commit**

```bash
git add src/performance/arrangement-brace.ts src/performance/arrangement-brace.test.ts src/performance/performance-ui.ts src/app/performance-feature.ts src/styles tests/e2e/loop-arrangement.spec.ts
git commit -m "feat(arrangement): A-B loop brace UI + loop window wiring + playhead modulo + e2e"
```

---

## Final verification

- [ ] **Full suite**

Run: `npm run build`
Run: `npm test`
Expected: unit + e2e green (re-run once if `test:unit` exits with the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown after all tests pass).

- [ ] **Audible browser smoke**

`npm run dev` → http://localhost:5173. Verify: (1) a clip with the Loop brace on bars 2–3 repeats only that region; (2) Copy to Performance plays the whole song and stops at the end; (3) enabling Loop A–B repeats the braced bars across all lanes; (4) an audio (sampler loop) clip in the arrangement still follows the tempo without changing pitch — confirms the sampler integration (no DSP changed; the arrangement plays at `seq.bpm`, which equals `arrangement.bpm` because `arrangementFromSession`/`copyFromSession` build it from `seq.bpm`).
