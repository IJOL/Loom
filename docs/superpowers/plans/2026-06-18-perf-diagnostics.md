# Performance Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable, on-demand performance diagnostics tool (corner HUD that expands to a detail panel) that surfaces audio-thread load, scheduler lag, FPS, and per-lane voices + live generator nodes, so the user can find the root cause of audio stutter.

**Architecture:** A new isolated subsystem `src/perf/`. A pure `PerfMonitor` holds ring-buffered samples + an event log and produces immutable snapshots. An impure `attachPerfSources()` installs all live hooks (sequencer-lag callback, per-lane voice tap, generator-node factory wrap, `renderCapacity` subscription, FPS rAF) on open and tears them all down on close. A `createPerfView()` builds the HUD/panel DOM and renders a snapshot. `createPerfDiagnostics()` wires the three together behind a throttled (~10 Hz) paint loop and a `toggle()`. Existing code gains only **dormant seams**: `Sequencer.onTickStats?` and `TriggerDispatchDeps.onVoiceFired?` — both no-ops when unset, so there is **zero instrumentation when the tool is closed**.

**Tech Stack:** TypeScript, Web Audio (`AudioContext`, `AudioRenderCapacity`), Vite, SCSS, Vitest (env `node` for pure logic, `// @vitest-environment jsdom` for DOM).

## Global Constraints

- **Only active when visible.** When closed there is zero instrumentation: no rAF, no factory wrap, no `renderCapacity` subscription. Each existing-code seam is an optional callback that is a no-op when unset. All collection is installed on open and fully torn down on close (no leaked rAF/timers/listeners; factories restored).
- **Consequence (accepted):** collection starts on open, so sparklines + dropout log cover from open onward, not the past.
- **The tool must not perturb what it measures:** paint throttled to ~10 Hz; DOM text written only when the value changed; sparklines are cheap block-glyph strings (no canvas).
- **Generator nodes only.** The Web Audio API exposes no live-node count; we count only `OscillatorNode`/`AudioBufferSourceNode`/`ConstantSourceNode` (they fire `ended`). Never present a faked "total node" number.
- **No automatic mitigation.** The app never changes its own behavior/sound.
- **UI text in English** (the app's convention). Code comments/spec in the repo style.
- **Assertions are always relative** (ratios/ordering/`>`/`<`), never absolute magnitudes, per the repo testing rule.

## File Structure

- Create `src/perf/perf-monitor.ts` — pure collector: ring buffers, event log, `snapshot()`. No DOM/audio/timers.
- Create `src/perf/perf-monitor.test.ts` — pure unit tests (env `node`).
- Create `src/perf/perf-sources.ts` — `attachPerfSources(deps): detach`. Owns every live hook + timers. Exports `PerfVoiceTap`.
- Create `src/perf/perf-sources.test.ts` — focused tests of the factory-wrap + teardown (env `jsdom`).
- Create `src/perf/perf-view.ts` — `createPerfView(opts): { el, render, dispose }`. Pure DOM.
- Create `src/perf/perf-view.test.ts` — DOM render/expand/dispose smoke (env `jsdom`).
- Create `src/perf/perf-diagnostics.ts` — `createPerfDiagnostics(deps): { toggle, isOpen }`. Throttled paint loop.
- Create `src/perf/perf-diagnostics.test.ts` — open/close mount + teardown (env `jsdom`).
- Create `src/styles/_perf.scss` — overlay styles; register in `src/style.scss`.
- Modify `src/core/sequencer.ts` — add `onTickStats?` field + compute lag/dur in `tick()` (dormant when unset).
- Modify `src/core/sequencer.test.ts` (create) — fake-timer test that `onTickStats` fires when set.
- Modify `src/app/trigger-dispatch.ts` — add `onVoiceFired?` to deps + call it in `fire()`.
- Modify `src/app/trigger-dispatch.test.ts` (create) — voice tap fires with `(laneId, gate)`.
- Modify `index.html` — add the `#perf-toggle` button in `.row.transport`.
- Modify `src/main.ts` — create `voiceTap`, thread `onVoiceFired`, build the controller, wire the button.

---

### Task 1: PerfMonitor (pure collector)

**Files:**
- Create: `src/perf/perf-monitor.ts`
- Test: `src/perf/perf-monitor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class PerfMonitor` with methods: `markAudioSupported(s: boolean): void`, `recordTick(lagMs: number, tickDurMs: number, nowSec: number): void`, `recordAudioLoad(avg: number, peak: number, underrunRatio: number, nowSec: number): void`, `recordFps(fps: number, frameMs: number): void`, `incVoice(laneId: string): void`, `decVoice(laneId: string): void`, `incNode(): void`, `decNode(): void`, `snapshot(): PerfSnapshot`.
  - `interface PerfSnapshot { audioSupported: boolean; avgLoad: number; peakLoad: number; underrunRatio: number; lagMs: number; lagMaxMs: number; tickDurMs: number; fps: number; frameMs: number; voicesTotal: number; voicesByLane: Array<{ laneId: string; count: number }>; genNodes: number; histLoad: number[]; histLag: number[]; histFps: number[]; events: PerfEvent[]; }`
  - `interface PerfEvent { tSec: number; kind: 'late-tick' | 'underrun'; detail: string; }`
  - `const LATE_TICK_MS = 50`

- [ ] **Step 1: Write the failing test**

Create `src/perf/perf-monitor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PerfMonitor, LATE_TICK_MS } from './perf-monitor';

describe('PerfMonitor', () => {
  it('tracks voices per lane and total, sorted desc, clamped at 0', () => {
    const m = new PerfMonitor();
    m.incVoice('bass'); m.incVoice('bass'); m.incVoice('drums');
    let s = m.snapshot();
    expect(s.voicesTotal).toBe(3);
    expect(s.voicesByLane[0]).toEqual({ laneId: 'bass', count: 2 }); // highest first
    m.decVoice('drums'); m.decVoice('drums'); // over-decrement must not go negative
    s = m.snapshot();
    expect(s.voicesTotal).toBe(2);
    expect(s.voicesByLane.find((l) => l.laneId === 'drums')).toBeUndefined();
  });

  it('counts live generator nodes, never below zero', () => {
    const m = new PerfMonitor();
    m.incNode(); m.incNode(); m.decNode();
    expect(m.snapshot().genNodes).toBe(1);
    m.decNode(); m.decNode();
    expect(m.snapshot().genNodes).toBe(0);
  });

  it('logs a late-tick event only when lag is at/above threshold', () => {
    const m = new PerfMonitor();
    m.recordTick(LATE_TICK_MS - 1, 1, 10);   // below → no event
    m.recordTick(LATE_TICK_MS + 5, 1, 11);   // at/above → one event
    const s = m.snapshot();
    expect(s.events.length).toBe(1);
    expect(s.events[0].kind).toBe('late-tick');
    expect(s.lagMaxMs).toBeGreaterThanOrEqual(LATE_TICK_MS + 5);
  });

  it('logs an underrun event only when underrunRatio is positive', () => {
    const m = new PerfMonitor();
    m.recordAudioLoad(0.3, 0.5, 0, 1);    // no underrun → no event
    m.recordAudioLoad(0.4, 0.6, 0.02, 2); // underrun → event
    const s = m.snapshot();
    expect(s.audioSupported).toBe(true);
    expect(s.events.filter((e) => e.kind === 'underrun').length).toBe(1);
    expect(s.peakLoad).toBeGreaterThan(s.avgLoad);
  });

  it('caps history length and event log (newest first)', () => {
    const m = new PerfMonitor();
    for (let i = 0; i < 500; i++) m.recordFps(60 - (i % 10), 16);
    const s = m.snapshot();
    expect(s.histFps.length).toBeLessThanOrEqual(120);
    for (let i = 0; i < 100; i++) m.recordTick(LATE_TICK_MS + i, 1, i);
    const s2 = m.snapshot();
    expect(s2.events.length).toBeLessThanOrEqual(50);
    // newest first: the last recorded (i=99) sits at index 0
    expect(s2.events[0].detail).toContain(`${LATE_TICK_MS + 99}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-monitor.test.ts`
Expected: FAIL — cannot resolve `./perf-monitor`.

- [ ] **Step 3: Write minimal implementation**

Create `src/perf/perf-monitor.ts`:

```ts
// Pure performance-metrics collector. No DOM, no audio, no timers — it only
// receives samples (pushed by perf-sources) and produces immutable snapshots
// for the view. Kept pure so it is exhaustively unit-testable.

export interface PerfEvent {
  tSec: number;
  kind: 'late-tick' | 'underrun';
  detail: string;
}

export interface PerfSnapshot {
  audioSupported: boolean;
  avgLoad: number; peakLoad: number; underrunRatio: number;
  lagMs: number; lagMaxMs: number; tickDurMs: number;
  fps: number; frameMs: number;
  voicesTotal: number;
  voicesByLane: Array<{ laneId: string; count: number }>;
  genNodes: number;
  histLoad: number[]; histLag: number[]; histFps: number[];
  events: PerfEvent[];
}

const HIST = 120;        // ring length (~12s of samples)
const EVENTS_CAP = 50;
/** A tick whose gap exceeds nominal + this many ms is logged. The scheduler
 *  fires every 25ms with a 120ms look-ahead window; +50ms (≈75ms gap) is a
 *  meaningful hiccup worth surfacing before it reaches the 120ms danger line. */
export const LATE_TICK_MS = 50;

export class PerfMonitor {
  private histLoad: number[] = [];
  private histLag: number[] = [];
  private histFps: number[] = [];
  private events: PerfEvent[] = [];
  private voices = new Map<string, number>();
  private audioSupported = false;
  private avgLoad = 0; private peakLoad = 0; private underrunRatio = 0;
  private lagMs = 0; private lagMaxMs = 0; private tickDurMs = 0;
  private fps = 0; private frameMs = 0;
  private genNodes = 0;

  private push(arr: number[], v: number): void {
    arr.push(v);
    if (arr.length > HIST) arr.shift();
  }
  private logEvent(e: PerfEvent): void {
    this.events.unshift(e);
    if (this.events.length > EVENTS_CAP) this.events.pop();
  }

  markAudioSupported(s: boolean): void { this.audioSupported = s; }

  recordTick(lagMs: number, tickDurMs: number, nowSec: number): void {
    this.lagMs = lagMs;
    this.tickDurMs = tickDurMs;
    if (lagMs > this.lagMaxMs) this.lagMaxMs = lagMs;
    this.push(this.histLag, lagMs);
    if (lagMs >= LATE_TICK_MS) {
      this.logEvent({ tSec: nowSec, kind: 'late-tick', detail: `late tick +${Math.round(lagMs)}ms` });
    }
  }

  recordAudioLoad(avg: number, peak: number, underrunRatio: number, nowSec: number): void {
    this.audioSupported = true;
    this.avgLoad = avg;
    this.peakLoad = peak;
    this.underrunRatio = underrunRatio;
    this.push(this.histLoad, avg);
    if (underrunRatio > 0) {
      this.logEvent({ tSec: nowSec, kind: 'underrun', detail: `underrun (audio) ${(underrunRatio * 100).toFixed(1)}%` });
    }
  }

  recordFps(fps: number, frameMs: number): void {
    this.fps = fps;
    this.frameMs = frameMs;
    this.push(this.histFps, fps);
  }

  incVoice(laneId: string): void {
    this.voices.set(laneId, (this.voices.get(laneId) ?? 0) + 1);
  }
  decVoice(laneId: string): void {
    const n = (this.voices.get(laneId) ?? 0) - 1;
    if (n <= 0) this.voices.delete(laneId);
    else this.voices.set(laneId, n);
  }
  incNode(): void { this.genNodes++; }
  decNode(): void { if (this.genNodes > 0) this.genNodes--; }

  snapshot(): PerfSnapshot {
    let total = 0;
    const byLane: Array<{ laneId: string; count: number }> = [];
    for (const [laneId, count] of this.voices) { total += count; byLane.push({ laneId, count }); }
    byLane.sort((a, b) => b.count - a.count);
    return {
      audioSupported: this.audioSupported,
      avgLoad: this.avgLoad, peakLoad: this.peakLoad, underrunRatio: this.underrunRatio,
      lagMs: this.lagMs, lagMaxMs: this.lagMaxMs, tickDurMs: this.tickDurMs,
      fps: this.fps, frameMs: this.frameMs,
      voicesTotal: total, voicesByLane: byLane, genNodes: this.genNodes,
      histLoad: this.histLoad.slice(), histLag: this.histLag.slice(), histFps: this.histFps.slice(),
      events: this.events.slice(),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-monitor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/perf/perf-monitor.ts src/perf/perf-monitor.test.ts
git commit -m "feat(perf): pure PerfMonitor collector (ring buffers + event log)"
```

---

### Task 2: Sequencer scheduler-lag seam

**Files:**
- Modify: `src/core/sequencer.ts` (add `onTickStats?` field; instrument `tick()`)
- Test: `src/core/sequencer.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `Sequencer.onTickStats?: (lagMs: number, tickDurMs: number) => void` — called once per tick **only when set**; `lagMs` = measured gap since the previous tick minus the nominal 25 ms; `tickDurMs` = wall-clock duration of the `sessionTick` call.

- [ ] **Step 1: Write the failing test**

Create `src/core/sequencer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Sequencer } from './sequencer';

function fakeCtx() {
  return { currentTime: 0, state: 'running', resume: () => Promise.resolve() } as unknown as AudioContext;
}

describe('Sequencer onTickStats seam', () => {
  it('does NOT compute or call stats when onTickStats is unset', () => {
    vi.useFakeTimers();
    const seq = new Sequencer(fakeCtx(), 32);
    const ticks: number[] = [];
    seq.sessionTick = () => ticks.push(1);
    seq.start();
    vi.advanceTimersByTime(80); // ~3 ticks
    seq.stop();
    expect(ticks.length).toBeGreaterThan(0); // sessionTick still runs
    vi.useRealTimers();
  });

  it('calls onTickStats with numeric (lagMs, tickDurMs) each tick when set', () => {
    vi.useFakeTimers();
    const seq = new Sequencer(fakeCtx(), 32);
    seq.sessionTick = () => { /* no-op scheduling */ };
    const calls: Array<[number, number]> = [];
    seq.onTickStats = (lag, dur) => calls.push([lag, dur]);
    seq.start();
    vi.advanceTimersByTime(80); // ~3 ticks
    seq.stop();
    expect(calls.length).toBeGreaterThan(0);
    for (const [lag, dur] of calls) {
      expect(Number.isFinite(lag)).toBe(true);
      expect(dur).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/sequencer.test.ts`
Expected: FAIL — `seq.onTickStats` is not a recognized property / second test asserts calls but none happen.

- [ ] **Step 3: Write minimal implementation**

In `src/core/sequencer.ts`, add the field next to `sessionTick` (after the `sessionTick?` declaration, ~line 43):

```ts
  /** Diagnostics seam (perf-monitor). Called once per tick ONLY when set:
   *  (lagMs = gap since previous tick minus the nominal 25ms; tickDurMs =
   *  wall-clock duration of the sessionTick call). Unset in normal operation,
   *  so this costs one boolean check per tick when the perf tool is closed. */
  onTickStats?: (lagMs: number, tickDurMs: number) => void;
```

Add a private field next to `private timerId` (~line 55):

```ts
  private lastTickPerf = 0;
```

Reset it in `start()` (right after `this.playing = true;`, ~line 79) and `stop()` (inside the `stop()` body):

```ts
    this.lastTickPerf = 0;
```

Replace the `tick` method body (lines 100-106) with:

```ts
  private tick = () => {
    if (!this.playing) return;
    const lookahead = 0.12;
    const stats = this.onTickStats;
    const nowPerf = stats ? performance.now() : 0;
    const lagMs = stats ? (this.lastTickPerf ? nowPerf - this.lastTickPerf - 25 : 0) : 0;
    if (stats) this.lastTickPerf = nowPerf;
    const t0 = stats ? performance.now() : 0;
    // Session mode: host owns per-lane scheduling via sessionTick → tickSession.
    if (this.sessionTick) this.sessionTick(this.ctx.currentTime, lookahead);
    if (stats) stats(lagMs, performance.now() - t0);
    if (this.playing) this.timerId = window.setTimeout(this.tick, 25);
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/sequencer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/sequencer.ts src/core/sequencer.test.ts
git commit -m "feat(perf): dormant onTickStats seam in Sequencer.tick"
```

---

### Task 3: Trigger-dispatch voice tap seam

**Files:**
- Modify: `src/app/trigger-dispatch.ts`
- Test: `src/app/trigger-dispatch.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `TriggerDispatchDeps.onVoiceFired?: (laneId: string, gateSec: number) => void` — invoked once per voice fired (after `v.trigger`), with the lane id and the gate seconds used for that voice. No-op when unset.

- [ ] **Step 1: Write the failing test**

Create `src/app/trigger-dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTriggerForLane } from './trigger-dispatch';
import type { LaneResourceMap } from '../core/lane-resources';
import type { Sequencer } from '../core/sequencer';

// Minimal fakes: trigger-dispatch only reads engine.id, calls engine.createVoice
// (→ a voice with trigger()), and res.strip.input as the connect target.
function fakeDeps(onVoiceFired?: (laneId: string, gateSec: number) => void) {
  const voice = { trigger() {}, release() {}, connect() {}, dispose() {}, getAudioParams: () => new Map() };
  const res = {
    engine: { id: 'subtractive', createVoice: () => voice },
    strip: { input: {} as AudioNode },
  };
  const laneResources = { get: (id: string) => (id === 'bass' ? res : undefined) } as unknown as LaneResourceMap;
  return {
    ctx: {} as AudioContext,
    laneResources,
    seq: { bpm: 120 } as Sequencer,
    onVoiceFired,
  };
}

describe('trigger-dispatch onVoiceFired tap', () => {
  it('fires the tap with (laneId, gate) for each voice', () => {
    const seen: Array<[string, number]> = [];
    const trigger = createTriggerForLane(fakeDeps((l, g) => seen.push([l, g])));
    trigger('bass', 60, 0, 0.25, false);
    expect(seen).toEqual([['bass', 0.25]]);
  });

  it('does nothing when the lane has no resource', () => {
    const seen: Array<[string, number]> = [];
    const trigger = createTriggerForLane(fakeDeps((l, g) => seen.push([l, g])));
    trigger('missing', 60, 0, 0.25, false);
    expect(seen.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/trigger-dispatch.test.ts`
Expected: FAIL — `onVoiceFired` not in deps type / tap never called.

- [ ] **Step 3: Write minimal implementation**

In `src/app/trigger-dispatch.ts`, add to `TriggerDispatchDeps` (after the `liveVoices?` field):

```ts
  /** Diagnostics seam (perf-monitor). Called once per voice fired with the
   *  lane id and the gate seconds used. No-op when unset → zero cost when the
   *  perf tool is closed. */
  onVoiceFired?: (laneId: string, gateSec: number) => void;
```

In the `fire` closure, after `v.trigger(...)`:

```ts
      v.trigger(m, t, { gateDuration: g, accent: a, slide: sl, sample, velocity: vel });
      deps.onVoiceFired?.(laneId, g);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/app/trigger-dispatch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/trigger-dispatch.ts src/app/trigger-dispatch.test.ts
git commit -m "feat(perf): dormant onVoiceFired tap in trigger-dispatch"
```

---

### Task 4: PerfSources (live hooks + teardown)

**Files:**
- Create: `src/perf/perf-sources.ts`
- Test: `src/perf/perf-sources.test.ts`

**Interfaces:**
- Consumes: `PerfMonitor` (Task 1); `Sequencer.onTickStats` (Task 2).
- Produces:
  - `interface PerfVoiceTap { fn: ((laneId: string, gateSec: number) => void) | null }`
  - `interface PerfSourcesDeps { monitor: PerfMonitor; ctx: AudioContext; seq: Sequencer; voiceTap: PerfVoiceTap }`
  - `function attachPerfSources(deps: PerfSourcesDeps): () => void` — installs all hooks; returns a `detach()` that removes every hook, clears timers, restores wrapped factories, and unsubscribes `renderCapacity`.

- [ ] **Step 1: Write the failing test**

Create `src/perf/perf-sources.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PerfMonitor } from './perf-monitor';
import { attachPerfSources, type PerfVoiceTap } from './perf-sources';
import type { Sequencer } from '../core/sequencer';

function fakeNode() {
  const node: { _ended: (() => void) | null; addEventListener: (t: string, cb: () => void) => void; end: () => void } = {
    _ended: null,
    addEventListener(type, cb) { if (type === 'ended') node._ended = cb; },
    end() { node._ended?.(); },
  };
  return node;
}

function fakeCtx() {
  const created: ReturnType<typeof fakeNode>[] = [];
  const make = () => { const n = fakeNode(); created.push(n); return n; };
  const ctx = {
    createOscillator: make,
    createBufferSource: make,
    createConstantSource: make,
    // renderCapacity intentionally absent → unsupported path
  } as unknown as AudioContext;
  return { ctx, created, origOsc: ctx.createOscillator };
}

describe('attachPerfSources', () => {
  it('counts wrapped generator nodes and decrements on ended; marks audio unsupported without renderCapacity', () => {
    const { ctx } = fakeCtx();
    const monitor = new PerfMonitor();
    const seq = {} as Sequencer;
    const voiceTap: PerfVoiceTap = { fn: null };
    const detach = attachPerfSources({ monitor, ctx, seq, voiceTap });

    expect(monitor.snapshot().audioSupported).toBe(false);
    const osc = ctx.createOscillator() as unknown as { end: () => void };
    const buf = ctx.createBufferSource() as unknown as { end: () => void };
    expect(monitor.snapshot().genNodes).toBe(2);
    osc.end();
    expect(monitor.snapshot().genNodes).toBe(1);

    // voice tap installed
    voiceTap.fn!('bass', 0.1);
    expect(monitor.snapshot().voicesTotal).toBe(1);

    // scheduler seam installed
    expect(typeof seq.onTickStats).toBe('function');

    detach();
    expect(voiceTap.fn).toBeNull();
    expect(seq.onTickStats).toBeUndefined();
  });

  it('restores the original factory functions on detach', () => {
    const { ctx, origOsc } = fakeCtx();
    const monitor = new PerfMonitor();
    const detach = attachPerfSources({ monitor, ctx, seq: {} as Sequencer, voiceTap: { fn: null } });
    expect(ctx.createOscillator).not.toBe(origOsc); // wrapped
    detach();
    expect(ctx.createOscillator).toBe(origOsc);     // restored
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-sources.test.ts`
Expected: FAIL — cannot resolve `./perf-sources`.

- [ ] **Step 3: Write minimal implementation**

Create `src/perf/perf-sources.ts`:

```ts
// Impure layer: installs every live performance hook on open and tears them all
// down on detach. The PerfMonitor stays pure; this module owns timers, the
// factory wrap, the renderCapacity subscription and the FPS rAF.

import type { PerfMonitor } from './perf-monitor';
import type { Sequencer } from '../core/sequencer';

/** Mutable holder threaded into trigger-dispatch at boot. The perf tool sets
 *  `fn` on open and clears it on close, so the dispatch seam stays a no-op when
 *  the tool is closed. */
export interface PerfVoiceTap {
  fn: ((laneId: string, gateSec: number) => void) | null;
}

interface RenderCapacityLike {
  averageLoad: number;
  peakLoad: number;
  underrunRatio: number;
  update(opts: { updateInterval: number }): void;
  addEventListener(type: 'update', cb: () => void): void;
  removeEventListener(type: 'update', cb: () => void): void;
}

const GEN_FACTORIES = ['createOscillator', 'createBufferSource', 'createConstantSource'] as const;
type GenFactory = typeof GEN_FACTORIES[number];

export interface PerfSourcesDeps {
  monitor: PerfMonitor;
  ctx: AudioContext;
  seq: Sequencer;
  voiceTap: PerfVoiceTap;
}

export function attachPerfSources(deps: PerfSourcesDeps): () => void {
  const { monitor, ctx, seq, voiceTap } = deps;
  const nowSec = () => performance.now() / 1000;

  // 1) Scheduler lag + sessionTick duration.
  seq.onTickStats = (lagMs, tickDurMs) => monitor.recordTick(lagMs, tickDurMs, nowSec());

  // 2) Per-lane voice counting. Increment on fire; decrement at the gate end.
  //    Approximate (ignores release tails) but precise enough to spot "lane X
  //    fires N voices". Pending timers are cleared on detach.
  const timers = new Set<ReturnType<typeof setTimeout>>();
  voiceTap.fn = (laneId, gateSec) => {
    monitor.incVoice(laneId);
    const id = setTimeout(() => { monitor.decVoice(laneId); timers.delete(id); }, Math.max(0, gateSec) * 1000);
    timers.add(id);
  };

  // 3) Live generator-node count: wrap the source factories, decrement on 'ended'.
  //    addEventListener (not .onended=) so we never clobber engine cleanup handlers.
  const originals = new Map<GenFactory, unknown>();
  for (const name of GEN_FACTORIES) {
    const orig = (ctx as unknown as Record<string, unknown>)[name];
    if (typeof orig !== 'function') continue;
    originals.set(name, orig);
    (ctx as unknown as Record<string, unknown>)[name] = function (this: AudioContext, ...args: unknown[]) {
      const node = (orig as (...a: unknown[]) => unknown).apply(this, args) as { addEventListener?: (t: string, cb: () => void) => void };
      monitor.incNode();
      try { node.addEventListener?.('ended', () => monitor.decNode()); } catch { /* no ended */ }
      return node;
    };
  }

  // 4) Audio-thread load via renderCapacity (Chromium). Fallback: mark unsupported.
  const rc = (ctx as unknown as { renderCapacity?: RenderCapacityLike }).renderCapacity;
  let rcHandler: (() => void) | null = null;
  if (rc) {
    monitor.markAudioSupported(true);
    rcHandler = () => monitor.recordAudioLoad(rc.averageLoad, rc.peakLoad, rc.underrunRatio, nowSec());
    rc.addEventListener('update', rcHandler);
    rc.update({ updateInterval: 0.5 });
  } else {
    monitor.markAudioSupported(false);
  }

  // 5) FPS / main-thread frame time.
  const hasRaf = typeof requestAnimationFrame === 'function';
  let rafId = 0;
  let lastFrame = 0;
  const frame = (t: number) => {
    if (lastFrame !== 0) {
      const dt = t - lastFrame;
      if (dt > 0) monitor.recordFps(1000 / dt, dt);
    }
    lastFrame = t;
    rafId = requestAnimationFrame(frame);
  };
  if (hasRaf) rafId = requestAnimationFrame(frame);

  return function detach() {
    seq.onTickStats = undefined;
    voiceTap.fn = null;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const [name, orig] of originals) {
      (ctx as unknown as Record<string, unknown>)[name] = orig;
    }
    if (rc && rcHandler) rc.removeEventListener('update', rcHandler);
    if (hasRaf && rafId) cancelAnimationFrame(rafId);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-sources.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/perf/perf-sources.ts src/perf/perf-sources.test.ts
git commit -m "feat(perf): attachPerfSources installs+tears down all live hooks"
```

---

### Task 5: PerfView (HUD + detail panel DOM)

**Files:**
- Create: `src/perf/perf-view.ts`
- Test: `src/perf/perf-view.test.ts`

**Interfaces:**
- Consumes: `PerfSnapshot` (Task 1).
- Produces:
  - `interface PerfViewOpts { resolveLaneName?: (laneId: string) => string }`
  - `interface PerfView { el: HTMLElement; render(s: PerfSnapshot): void; dispose(): void }`
  - `function createPerfView(opts?: PerfViewOpts): PerfView` — `el` is the overlay root; `render` updates text/sparklines (writes only on change; panel content only when expanded); `dispose` removes `el`.

- [ ] **Step 1: Write the failing test**

Create `src/perf/perf-view.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createPerfView } from './perf-view';
import type { PerfSnapshot } from './perf-monitor';

function snap(over: Partial<PerfSnapshot> = {}): PerfSnapshot {
  return {
    audioSupported: true, avgLoad: 0.37, peakLoad: 0.61, underrunRatio: 0,
    lagMs: 4, lagMaxMs: 22, tickDurMs: 1.8, fps: 58, frameMs: 17,
    voicesTotal: 12, voicesByLane: [{ laneId: 'bass', count: 8 }, { laneId: 'drums', count: 4 }],
    genNodes: 84, histLoad: [0.1, 0.2, 0.4], histLag: [2, 4, 8], histFps: [60, 59, 58],
    events: [{ tSec: 12.3, kind: 'late-tick', detail: 'late tick +31ms' }],
    ...over,
  };
}

describe('createPerfView', () => {
  it('renders live numbers in the HUD', () => {
    const v = createPerfView();
    v.render(snap());
    expect(v.el.querySelector('[data-f="audio"]')!.textContent).toContain('37%');
    expect(v.el.querySelector('[data-f="fps"]')!.textContent).toContain('58');
    expect(v.el.querySelector('[data-f="voices"]')!.textContent).toContain('12');
  });

  it('shows n/d for audio load when unsupported', () => {
    const v = createPerfView();
    v.render(snap({ audioSupported: false }));
    expect(v.el.querySelector('[data-f="audio"]')!.textContent).toContain('n/d');
  });

  it('fills the panel (lanes + log) only after expanding', () => {
    const v = createPerfView();
    v.render(snap());
    const lanes = v.el.querySelector('[data-f="lanes"]')!;
    expect(lanes.textContent).toBe(''); // collapsed → not filled
    (v.el.querySelector('[data-f="expand"]') as HTMLElement).click();
    v.render(snap());
    expect(lanes.textContent).toContain('bass');
    expect(v.el.querySelector('[data-f="log"]')!.textContent).toContain('late tick');
  });

  it('dispose removes the element', () => {
    const v = createPerfView();
    document.body.appendChild(v.el);
    v.dispose();
    expect(document.body.contains(v.el)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-view.test.ts`
Expected: FAIL — cannot resolve `./perf-view`.

- [ ] **Step 3: Write minimal implementation**

Create `src/perf/perf-view.ts`:

```ts
// HUD + expandable detail panel. Pure DOM: build once, then render(snapshot)
// updates text only when it changed and fills the panel only while expanded.
// The paint cadence (throttle) is owned by the controller, not here.

import type { PerfSnapshot } from './perf-monitor';

const BARS = '▁▂▃▄▅▆▇█';

/** Cheap block-glyph sparkline of the last `n` samples, scaled to max(refMax, data). */
function spark(arr: number[], refMax: number, n = 24): string {
  if (arr.length === 0) return '';
  const slice = arr.slice(-n);
  const hi = Math.max(refMax, ...slice) || 1;
  return slice
    .map((v) => BARS[Math.min(BARS.length - 1, Math.max(0, Math.round((v / hi) * (BARS.length - 1))))])
    .join('');
}

export interface PerfViewOpts {
  resolveLaneName?: (laneId: string) => string;
}

export interface PerfView {
  el: HTMLElement;
  render(s: PerfSnapshot): void;
  dispose(): void;
}

export function createPerfView(opts: PerfViewOpts = {}): PerfView {
  const name = opts.resolveLaneName ?? ((id: string) => id);
  const el = document.createElement('div');
  el.className = 'perf-diag';
  el.innerHTML = `
    <div class="perf-diag-hud">
      <button class="perf-diag-expand" data-f="expand" title="Expand / collapse details">⤢</button>
      <div class="perf-diag-row"><span class="perf-diag-k">Audio</span><span class="perf-diag-v" data-f="audio"></span><span class="perf-diag-spark" data-s="load"></span></div>
      <div class="perf-diag-row"><span class="perf-diag-k">Sched</span><span class="perf-diag-v" data-f="sched"></span><span class="perf-diag-spark" data-s="lag"></span></div>
      <div class="perf-diag-row"><span class="perf-diag-k">FPS</span><span class="perf-diag-v" data-f="fps"></span><span class="perf-diag-spark" data-s="fps"></span></div>
      <div class="perf-diag-row"><span class="perf-diag-k">Load</span><span class="perf-diag-v" data-f="voices"></span></div>
    </div>
    <div class="perf-diag-panel" data-f="panel" hidden>
      <div class="perf-diag-sub">Voices by lane</div>
      <div class="perf-diag-lanes" data-f="lanes"></div>
      <div class="perf-diag-sub">Dropout log</div>
      <pre class="perf-diag-log" data-f="log"></pre>
    </div>`;

  const q = (sel: string) => el.querySelector(sel) as HTMLElement;
  const panel = q('[data-f="panel"]');
  q('[data-f="expand"]').addEventListener('click', () => { panel.hidden = !panel.hidden; });

  const set = (sel: string, text: string) => {
    const n = q(sel);
    if (n.textContent !== text) n.textContent = text;
  };

  return {
    el,
    render(s) {
      set('[data-f="audio"]', s.audioSupported ? `${Math.round(s.avgLoad * 100)}% / ${Math.round(s.peakLoad * 100)}%` : 'n/d');
      set('[data-s="load"]', s.audioSupported ? spark(s.histLoad, 1) : '');
      set('[data-f="sched"]', `${s.lagMs >= 0 ? '+' : ''}${Math.round(s.lagMs)}ms (max ${Math.round(s.lagMaxMs)})`);
      set('[data-s="lag"]', spark(s.histLag, 60));
      set('[data-f="fps"]', `${Math.round(s.fps)} (${s.frameMs.toFixed(1)}ms)`);
      set('[data-s="fps"]', spark(s.histFps, 60));
      set('[data-f="voices"]', `V ${s.voicesTotal}  N ${s.genNodes}`);
      if (!panel.hidden) {
        set('[data-f="lanes"]', s.voicesByLane.map((l) => `${name(l.laneId)}: ${l.count}`).join('   ') || 'no active voices');
        set('[data-f="log"]', s.events.map((e) => `${e.tSec.toFixed(1)}s  ${e.detail}`).join('\n') || 'no dropouts logged');
      }
    },
    dispose() { el.remove(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-view.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/perf/perf-view.ts src/perf/perf-view.test.ts
git commit -m "feat(perf): HUD + detail panel view (change-only DOM writes)"
```

---

### Task 6: PerfDiagnostics controller (wire + throttled loop)

**Files:**
- Create: `src/perf/perf-diagnostics.ts`
- Test: `src/perf/perf-diagnostics.test.ts`

**Interfaces:**
- Consumes: `PerfMonitor` (Task 1), `attachPerfSources` + `PerfVoiceTap` (Task 4), `createPerfView` (Task 5).
- Produces:
  - `interface PerfDiagnosticsDeps { ctx: AudioContext; seq: Sequencer; voiceTap: PerfVoiceTap; mount: HTMLElement; resolveLaneName?: (laneId: string) => string }`
  - `interface PerfDiagnostics { toggle(): void; isOpen(): boolean }`
  - `function createPerfDiagnostics(deps: PerfDiagnosticsDeps): PerfDiagnostics` — `toggle()` opens (mounts view, attaches sources, starts ~10 Hz paint loop) / closes (cancels loop, detaches sources, disposes view).

- [ ] **Step 1: Write the failing test**

Create `src/perf/perf-diagnostics.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createPerfDiagnostics } from './perf-diagnostics';
import type { PerfVoiceTap } from './perf-sources';
import type { Sequencer } from '../core/sequencer';

function fakeCtx() {
  const make = () => ({ addEventListener() {} });
  return { createOscillator: make, createBufferSource: make, createConstantSource: make } as unknown as AudioContext;
}

describe('createPerfDiagnostics', () => {
  it('mounts on open and fully tears down on close', () => {
    const mount = document.createElement('div');
    const seq = {} as Sequencer;
    const voiceTap: PerfVoiceTap = { fn: null };
    const diag = createPerfDiagnostics({ ctx: fakeCtx(), seq, voiceTap, mount });

    expect(diag.isOpen()).toBe(false);

    diag.toggle();
    expect(diag.isOpen()).toBe(true);
    expect(mount.querySelector('.perf-diag')).not.toBeNull();
    expect(typeof seq.onTickStats).toBe('function');
    expect(voiceTap.fn).not.toBeNull();

    diag.toggle();
    expect(diag.isOpen()).toBe(false);
    expect(mount.querySelector('.perf-diag')).toBeNull();
    expect(seq.onTickStats).toBeUndefined();
    expect(voiceTap.fn).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-diagnostics.test.ts`
Expected: FAIL — cannot resolve `./perf-diagnostics`.

- [ ] **Step 3: Write minimal implementation**

Create `src/perf/perf-diagnostics.ts`:

```ts
// Controller: ties PerfMonitor + perf-sources + perf-view together behind a
// single toggle and a throttled (~10Hz) paint loop. Everything is created on
// open and destroyed on close, so the tool costs nothing while closed.

import { PerfMonitor } from './perf-monitor';
import { attachPerfSources, type PerfVoiceTap } from './perf-sources';
import { createPerfView, type PerfView } from './perf-view';
import type { Sequencer } from '../core/sequencer';

export interface PerfDiagnosticsDeps {
  ctx: AudioContext;
  seq: Sequencer;
  voiceTap: PerfVoiceTap;
  mount: HTMLElement;
  resolveLaneName?: (laneId: string) => string;
}

export interface PerfDiagnostics {
  toggle(): void;
  isOpen(): boolean;
}

const PAINT_MS = 100; // ~10Hz — keeps the panel from perturbing what it measures.

export function createPerfDiagnostics(deps: PerfDiagnosticsDeps): PerfDiagnostics {
  let open = false;
  let detach: (() => void) | null = null;
  let view: PerfView | null = null;
  let monitor: PerfMonitor | null = null;
  let rafId = 0;
  let lastPaint = 0;
  const hasRaf = typeof requestAnimationFrame === 'function';

  const loop = (t: number) => {
    if (!open) return;
    if (t - lastPaint >= PAINT_MS) { lastPaint = t; view!.render(monitor!.snapshot()); }
    rafId = requestAnimationFrame(loop);
  };

  function start() {
    monitor = new PerfMonitor();
    view = createPerfView({ resolveLaneName: deps.resolveLaneName });
    deps.mount.appendChild(view.el);
    detach = attachPerfSources({ monitor, ctx: deps.ctx, seq: deps.seq, voiceTap: deps.voiceTap });
    view.render(monitor.snapshot()); // immediate first paint
    lastPaint = 0;
    if (hasRaf) rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (hasRaf && rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    detach?.(); detach = null;
    view?.dispose(); view = null;
    monitor = null;
  }

  return {
    toggle() { open = !open; if (open) start(); else stop(); },
    isOpen() { return open; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/perf/perf-diagnostics.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/perf/perf-diagnostics.ts src/perf/perf-diagnostics.test.ts
git commit -m "feat(perf): controller wiring monitor+sources+view behind a toggle"
```

---

### Task 7: Mount in the app — button, styles, wiring

**Files:**
- Create: `src/styles/_perf.scss`
- Modify: `src/style.scss` (register the partial)
- Modify: `index.html` (add `#perf-toggle` button)
- Modify: `src/main.ts` (voiceTap, thread `onVoiceFired`, build controller, wire button)

**Interfaces:**
- Consumes: `createPerfDiagnostics` (Task 6), `PerfVoiceTap` (Task 4).
- Produces: a live PERF toggle button mounted in the transport bar.

- [ ] **Step 1: Add the stylesheet**

Create `src/styles/_perf.scss`:

```scss
// Performance diagnostics overlay (HUD + detail panel). Fixed bottom-right,
// monospace, above the app. Only present in the DOM while the tool is open.
.perf-diag {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 9999;
  font: 11px/1.35 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color: #d8f0e8;
  background: rgba(12, 16, 18, 0.92);
  border: 1px solid #2c3a3a;
  border-radius: 6px;
  padding: 6px 8px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
  min-width: 220px;
}
.perf-diag-hud { position: relative; }
.perf-diag-row { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.perf-diag-k { color: #6fb6a4; width: 42px; flex: 0 0 auto; }
.perf-diag-v { color: #eafff7; }
.perf-diag-spark { color: #8fd6c2; margin-left: auto; letter-spacing: -1px; }
.perf-diag-expand {
  position: absolute; top: -2px; right: -2px;
  background: transparent; border: 0; color: #6fb6a4; cursor: pointer;
  font-size: 13px; line-height: 1; padding: 2px;
}
.perf-diag-expand:hover { color: #eafff7; }
.perf-diag-panel { margin-top: 6px; border-top: 1px solid #2c3a3a; padding-top: 6px; }
.perf-diag-sub { color: #6fb6a4; margin: 4px 0 2px; }
.perf-diag-lanes { color: #eafff7; white-space: normal; }
.perf-diag-log {
  margin: 0; max-height: 140px; overflow: auto; color: #e0c08a;
  white-space: pre-wrap; font: inherit;
}
// The transport toggle button's active state.
#perf-toggle.on { background: #2c5; color: #061; }
```

Register it in `src/style.scss` (append after the last `@use`, line 24):

```scss
@use 'styles/perf';
```

- [ ] **Step 2: Add the toggle button**

In `index.html`, inside `<div class="row transport">`, immediately after the `#capture-scene` button (line 132), add:

```html
        <button id="perf-toggle" class="io" title="Performance diagnostics — audio load, scheduler lag, FPS, voices (only runs while open)">PERF</button>
```

- [ ] **Step 3: Wire it in main.ts**

In `src/main.ts`, add the import near the other `./app/*` imports (top of file):

```ts
import { createPerfDiagnostics } from './perf/perf-diagnostics';
import type { PerfVoiceTap } from './perf/perf-sources';
```

Add the voice tap holder just BEFORE the `createTriggerForLane({ ... })` call (~line 393, right after `const liveVoices = new LiveVoiceRegistry();`):

```ts
// Diagnostics voice tap: dormant (fn=null) until the perf tool opens.
const perfVoiceTap: PerfVoiceTap = { fn: null };
```

Thread it into the dispatch deps — change the `createTriggerForLane` call (~line 393) to include `onVoiceFired`:

```ts
const triggerForLane = createTriggerForLane({
  ctx, laneResources, seq, liveVoices,
  onVoiceFired: (laneId, gateSec) => perfVoiceTap.fn?.(laneId, gateSec),
});
```

Build the controller and wire the button — add this AFTER `sessionHost` is constructed (so `sessionHost.state` exists for the lane-name resolver; place it right after the `wireTransport(transportDeps);` line, ~line 809):

```ts
// Performance diagnostics (PERF button). Zero cost until toggled open.
const perfDiagnostics = createPerfDiagnostics({
  ctx, seq, voiceTap: perfVoiceTap, mount: document.body,
  resolveLaneName: (id) => sessionHost.state.lanes.find((l) => l.id === id)?.name ?? id,
});
document.getElementById('perf-toggle')?.addEventListener('click', (e) => {
  perfDiagnostics.toggle();
  (e.currentTarget as HTMLElement).classList.toggle('on', perfDiagnostics.isOpen());
});
```

- [ ] **Step 4: Typecheck, build, and run the unit suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `NO_COLOR=1 npx vitest run src/perf src/core/sequencer.test.ts src/app/trigger-dispatch.test.ts`
Expected: all PASS.

Run: `npm run build`
Expected: typecheck + bundle succeed (the SCSS `@use` resolves).

- [ ] **Step 5: Live verification (mandatory UI look)**

Run `npm run dev`, open `http://localhost:5173`, then:
1. Click **PERF** in the transport bar → the HUD appears bottom-right with live Audio/Sched/FPS/Load rows; the button shows its `.on` state.
2. Press **Play** and launch a few clips → voice count (V) and node count (N) rise; sparklines move; if on Chrome/Edge the Audio row shows `%/%`, otherwise `n/d`.
3. Click **⤢** → the panel expands showing voices-by-lane and (after any hiccup) the dropout log.
4. Click **PERF** again → the HUD disappears; confirm no console errors and that playback is unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/styles/_perf.scss src/style.scss index.html src/main.ts
git commit -m "feat(perf): mount diagnostics behind a PERF transport toggle"
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| Audio load (renderCapacity, avg/peak/underrun) + fallback | 4 (sources), 5 (n/d view), 1 (model) |
| Scheduler lag + sessionTick duration | 2 (seam), 1 (model), 5 (view) |
| FPS / main-thread frame time | 4 (rAF), 1 (model), 5 (view) |
| Voices per lane + total | 3 (tap), 4 (counting), 1 (model), 5 (view) |
| Live generator nodes only (no faked total) | 4 (factory wrap), 1 (model) |
| Zero instrumentation when closed | 2 + 3 (dormant seams), 6 (start/stop), 4 (detach) |
| Collection starts on open (no past) | 6 (monitor created in `start()`) |
| Throttled paint, change-only DOM | 6 (`PAINT_MS`), 5 (`set()` writes on change) |
| Hybrid HUD + expandable panel | 5 |
| Visible toggle button | 7 |
| UI text in English | 5, 7 |
| No auto-mitigation / no persistence | (out of scope — nothing added) |

No gaps.

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code. Cleared.

**3. Type consistency:** `PerfMonitor` method names (`recordTick`, `recordAudioLoad`, `recordFps`, `incVoice`/`decVoice`, `incNode`/`decNode`, `snapshot`) are used identically in Tasks 4 and 6. `PerfVoiceTap.fn` signature `(laneId, gateSec) => void` matches the tap installed in Task 4 and the lambda threaded in Task 7. `Sequencer.onTickStats(lagMs, tickDurMs)` matches between Task 2 and Task 4. `PerfSnapshot` fields match between Task 1 (producer), Task 5 (view), and the test fixtures. Consistent.
