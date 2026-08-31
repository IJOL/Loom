# Loop Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Arrange view's "● Record a loop": bar-quantized press-start/press-stop capture that lands the take exactly like a dropped file — new Audio lane + timeline band.

**Architecture:** A new `LoopCaptureController` (pure state machine + bar arithmetic) drives the EXISTING recorder worklet through sample-accurate `window` messages; sources resolve to `{node, release}` (master tap first, system/mic later); delivery encodes WAV and enters the round-1 drop ingestion gate unchanged (`importFile` → `ingestDroppedFile`).

**Tech Stack:** TypeScript, Web Audio (AudioWorklet), lit-html templates, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-loop-capture-design.md`

## Global Constraints

- Work in a git worktree at `.claude/worktrees/loop-capture` (`git worktree add`, `cd` by absolute path — NEVER the EnterWorktree native tool), branch `feat/loop-capture` off current main (`b2e04b49` or later). `npm install` inside the worktree; never junction `node_modules`.
- Commit messages in ENGLISH, always, via bash heredoc. Commit each green task. Rebase onto main frequently.
- UI text, code comments, labels: English.
- Test assertions RELATIVE (ratios), never absolute magnitudes — justify any absolute threshold in a comment.
- File size: target 300 code lines, hard cap 500 (comments/blanks don't count).
- Run unit tests as `NO_COLOR=1 npx vitest run <file>`; full suites via the npm scripts (already colour-free).
- `npm run build` before `npm run test:e2e` — Playwright serves the LAST `dist/` build.
- Never add an `engineId === '…'` to the core; anything that writes an engine param goes through `commitParam` (this plan touches neither, by design).
- No changes to `src/stems/system-audio-capture.ts` behavior — extraction only (Task 9).

---

### Task 1: Bar-boundary arithmetic (pure)

**Files:**
- Create: `src/performance/loop-capture.ts`
- Test: `src/performance/loop-capture.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextBarBoundarySec(nowSec: number, anchorSec: number, barSec: number): number` and `lastBarBoundarySec(nowSec: number, anchorSec: number, barSec: number): number`, both exported. Later tasks (3) build the controller in this same file.

- [ ] **Step 1: Write the failing tests**

```ts
// src/performance/loop-capture.test.ts
import { describe, it, expect } from 'vitest';
import { nextBarBoundarySec, lastBarBoundarySec } from './loop-capture';

describe('bar-boundary arithmetic', () => {
  // anchor 10, barSec 2 → boundaries at 10, 12, 14, …
  it('nextBarBoundarySec rounds up to the next boundary', () => {
    expect(nextBarBoundarySec(10.5, 10, 2)).toBe(12);
    expect(nextBarBoundarySec(13.999, 10, 2)).toBe(14);
  });
  it('nextBarBoundarySec on an exact boundary returns it (press ON the bar starts now)', () => {
    expect(nextBarBoundarySec(12, 10, 2)).toBe(12);
  });
  it('nextBarBoundarySec never returns a boundary before the anchor', () => {
    expect(nextBarBoundarySec(9.2, 10, 2)).toBe(10);
  });
  it('lastBarBoundarySec rounds down to the last boundary at or before now', () => {
    expect(lastBarBoundarySec(13.999, 10, 2)).toBe(12);
    expect(lastBarBoundarySec(14, 10, 2)).toBe(14);
  });
  it('boundaries are consistent: last <= now <= next, both on the anchor grid', () => {
    const now = 17.31, anchor = 10, bar = 2;
    const lo = lastBarBoundarySec(now, anchor, bar), hi = nextBarBoundarySec(now, anchor, bar);
    expect(lo).toBeLessThanOrEqual(now);
    expect(hi).toBeGreaterThanOrEqual(now);
    expect((hi - lo) / bar).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/performance/loop-capture.test.ts`
Expected: FAIL — module `./loop-capture` not found.

- [ ] **Step 3: Implement**

```ts
// src/performance/loop-capture.ts
// Bar-quantized loop capture: the pure arithmetic and (Task 3) the state
// machine that drives the recorder worklet's sample-accurate window.
// The bar clock is the transport's: boundaries sit on the grid anchored at
// `anchorSec` (ArrangementPlayState.startedAtCtx), spaced `barSec` apart.

const EPS = 1e-9; // float guard: a press landing 1e-12 past a boundary IS on it

/** The next bar boundary at or after `nowSec` (an exact hit returns itself). */
export function nextBarBoundarySec(nowSec: number, anchorSec: number, barSec: number): number {
  const k = Math.ceil((nowSec - anchorSec) / barSec - EPS);
  return anchorSec + Math.max(0, k) * barSec;
}

/** The last bar boundary at or before `nowSec` (never before the anchor). */
export function lastBarBoundarySec(nowSec: number, anchorSec: number, barSec: number): number {
  const k = Math.floor((nowSec - anchorSec) / barSec + EPS);
  return anchorSec + Math.max(0, k) * barSec;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `NO_COLOR=1 npx vitest run src/performance/loop-capture.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/performance/loop-capture.ts src/performance/loop-capture.test.ts
git commit -m "feat(capture): bar-boundary arithmetic on the transport's grid"
```

---

### Task 2: Pin the worklet's window-update path (test-only)

**Files:**
- Modify: `src/export/recorder-worklet.test.ts`

**Interfaces:**
- Consumes: `RECORDER_WORKLET_SOURCE` from `src/export/recorder-worklet.ts`.
- Produces: nothing new — pins the mechanism Task 5 relies on: a SECOND `window` message narrowing `endTime` of a running capture finalizes it at that exact sample.

The existing test only smoke-checks the source string. Add an executable harness: evaluate the processor source with fake worklet globals, drive `process()` block by block with a controllable `currentTime`.

- [ ] **Step 1: Write the failing test (harness + case)**

Append to `src/export/recorder-worklet.test.ts`:

```ts
import { RECORDER_WORKLET_SOURCE } from './recorder-worklet';

// Minimal worklet harness: the source reads bare globals `currentTime` /
// `sampleRate` and calls `registerProcessor`; give it all three and drive
// process() by hand. Instantiated fresh per test.
function makeProcessor() {
  let ProcessorClass: any = null;
  const g = globalThis as any;
  g.AudioWorkletProcessor = class {
    port = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      posted: [] as any[],
      postMessage(msg: unknown) { this.posted.push(msg); },
    };
  };
  g.registerProcessor = (_name: string, cls: unknown) => { ProcessorClass = cls; };
  g.sampleRate = 100; // 100 Hz → one 10-sample block = 0.1 s; tiny on purpose
  g.currentTime = 0;
  // eslint-disable-next-line no-eval
  (0, eval)(RECORDER_WORKLET_SOURCE);
  const p = new ProcessorClass();
  const step = (n = 10) => {
    // one block of a 0→1 ramp so slicing errors show up as wrong VALUES too
    const left = Float32Array.from({ length: n }, (_, i) => (i + 1) / n);
    const alive = p.process([[left, left.slice()]]);
    (globalThis as any).currentTime += n / 100;
    return alive;
  };
  const send = (data: unknown) => p.port.onmessage!({ data });
  return { p, step, send, posted: p.port.posted as any[] };
}

describe('recorder worklet window updates', () => {
  it('a second window message cuts a running open-ended capture at that exact time', () => {
    const { step, send, posted } = makeProcessor();
    send({ type: 'window', startTime: 0.1, endTime: Infinity }); // start at block 2
    step(); // 0.0–0.1: before the window — nothing captured
    step(); // 0.1–0.2: recording
    send({ type: 'window', startTime: 0.1, endTime: 0.25 });     // the quantized cut
    const alive = step(); // 0.2–0.3: captures half the block, then finalizes
    expect(alive).toBe(false);
    expect(posted.length).toBe(1);
    const done = posted[0];
    expect(done.type).toBe('done');
    // 0.1→0.25 at 100 Hz = 15 frames: one full block + half of the next
    expect(done.left.length).toBe(15);
    // the cut slices INSIDE the last block: its final frame is the ramp's
    // 5th sample (0.5), not the block's last (1.0)
    expect(done.left[14]).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run to verify the harness executes**

Run: `NO_COLOR=1 npx vitest run src/export/recorder-worklet.test.ts`
Expected: PASS if the worklet already behaves as designed (likely — the `window` handler overwrites both fields unconditionally). If it FAILS, the worklet has a real gap: fix `recorder-worklet.ts` minimally (the `window` branch must accept updates while running) and re-run. Either way the behavior is now pinned.

- [ ] **Step 3: Commit**

```bash
git add src/export/recorder-worklet.test.ts
git commit -m "test(capture): pin the recorder worklet's mid-capture window update"
```

---

### Task 3: LoopCaptureController state machine

**Files:**
- Modify: `src/performance/loop-capture.ts`
- Test: `src/performance/loop-capture.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's boundary functions.
- Produces (exact, later tasks import these from `./loop-capture` / `../performance/loop-capture`):

```ts
export type LoopCaptureState = 'idle' | 'waiting' | 'recording' | 'finalizing';
export interface CaptureTake { left: Float32Array; right: Float32Array; sampleRate: number }
export interface CaptureSession {
  setWindow(startSec: number, endSec: number): void;
  cancel(): void; // teardown without a take
}
export interface LoopCaptureDeps {
  now(): number;              // ctx.currentTime
  barSec(): number;
  anchorCtx(): number;        // ArrangementPlayState.startedAtCtx
  isPlaying(): boolean;
  startTransport(): void;     // ArrangementPlayback.begin() — sets the anchor
  openSession(onDone: (take: CaptureTake) => void): Promise<CaptureSession>;
  deliver(take: CaptureTake, startSongSec: number): void;
  onState(s: LoopCaptureState): void;
  onError(message: string): void;
}
export class LoopCaptureController {
  constructor(deps: LoopCaptureDeps);
  getState(): LoopCaptureState;
  /** For the UI/RAF: elapsed whole bars while recording, and where it started. */
  info(): { state: LoopCaptureState; startSongSec: number; barsElapsed: number };
  toggle(): Promise<void>;    // ● : idle→waiting · waiting→cancel · recording→finalizing
  cancel(): void;             // Escape: cancels waiting AND recording
  onTransportStop(): void;    // ⏹ : finalize at last completed bar, or cancel
  onViewLeft(): void;         // leaving Arrange: cancels waiting ONLY
  pump(): void;               // per-RAF: flips waiting→recording when the bar arrives
}
```

Design notes for the implementer:
- `toggle()` while `waiting` cancels (you changed your mind before the bar) — a deliberate small addition to the spec, matching looper hardware.
- `startSongSec` is captured ONCE when entering `waiting` (`startCtx - anchorCtx()`), not recomputed at delivery — ⏹ does not move the anchor, but don't depend on that.
- `finalizing → idle` happens in the session's `onDone` (deliver, then `onState('idle')`).
- A `done` arriving after `cancel()` must be ignored (guard with a generation counter, below).

- [ ] **Step 1: Write the failing tests**

Append to `src/performance/loop-capture.test.ts`:

```ts
import { LoopCaptureController, type CaptureSession, type CaptureTake, type LoopCaptureDeps } from './loop-capture';

function makeRig(opts: { playing?: boolean } = {}) {
  let now = 10;                        // anchor 10, barSec 2 → bars at 10,12,14…
  let playing = opts.playing ?? true;
  const windows: [number, number][] = [];
  const states: string[] = [];
  const delivered: { startSongSec: number }[] = [];
  let doneCb: ((t: CaptureTake) => void) | null = null;
  let cancelled = 0;
  const session: CaptureSession = {
    setWindow: (s, e) => windows.push([s, e]),
    cancel: () => { cancelled++; },
  };
  const deps: LoopCaptureDeps = {
    now: () => now,
    barSec: () => 2,
    anchorCtx: () => 10,
    isPlaying: () => playing,
    startTransport: () => { playing = true; },
    openSession: async (onDone) => { doneCb = onDone; return session; },
    deliver: (_t, startSongSec) => delivered.push({ startSongSec }),
    onState: (s) => states.push(s),
    onError: () => {},
  };
  const ctl = new LoopCaptureController(deps);
  return {
    ctl, windows, states, delivered,
    setNow: (t: number) => { now = t; },
    fireDone: () => doneCb?.({ left: new Float32Array(4), right: new Float32Array(4), sampleRate: 48000 }),
    cancelCount: () => cancelled,
  };
}

describe('LoopCaptureController', () => {
  it('toggle from idle opens a session, posts an open-ended window at the next bar, and waits', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    expect(r.states).toEqual(['waiting']);
    expect(r.windows).toEqual([[12, Infinity]]);
  });

  it('pump flips waiting→recording once the bar boundary passes', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    r.ctl.pump();                       // still 10.5 — nothing
    expect(r.ctl.getState()).toBe('waiting');
    r.setNow(12.01);
    r.ctl.pump();
    expect(r.ctl.getState()).toBe('recording');
  });

  it('toggle while recording posts the bar-end cut and finalizes; done delivers at the start bar', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();               // starts at ctx 12 (song sec 2)
    r.setNow(15.3); r.ctl.pump();       // recording, mid bar 12→14→16
    await r.ctl.toggle();               // cut at 16
    expect(r.windows[1]).toEqual([12, 16]);
    expect(r.ctl.getState()).toBe('finalizing');
    r.fireDone();
    expect(r.delivered).toEqual([{ startSongSec: 2 }]);
    expect(r.ctl.getState()).toBe('idle');
  });

  it('toggle while waiting cancels (no take, session torn down)', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    await r.ctl.toggle();
    expect(r.ctl.getState()).toBe('idle');
    expect(r.cancelCount()).toBe(1);
    expect(r.delivered.length).toBe(0);
  });

  it('cancel (Escape) aborts a recording without delivering', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    r.setNow(13); r.ctl.pump();
    r.ctl.cancel();
    expect(r.ctl.getState()).toBe('idle');
    expect(r.cancelCount()).toBe(1);
    r.fireDone();                       // a late done must be ignored
    expect(r.delivered.length).toBe(0);
  });

  it('transport stop finalizes at the last COMPLETED bar', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();               // start ctx 12
    r.setNow(15.7); r.ctl.pump();       // one full bar (12–14) + part of the next
    r.ctl.onTransportStop();
    expect(r.windows[1]).toEqual([12, 14]);
    expect(r.ctl.getState()).toBe('finalizing');
  });

  it('transport stop with zero completed bars cancels', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();               // start ctx 12
    r.setNow(13.2); r.ctl.pump();       // inside the first bar
    r.ctl.onTransportStop();
    expect(r.ctl.getState()).toBe('idle');
    expect(r.cancelCount()).toBe(1);
  });

  it('starts the transport first when it is stopped', async () => {
    const r = makeRig({ playing: false });
    r.setNow(10);                       // anchor equals now once started
    await r.ctl.toggle();
    expect(r.ctl.getState()).toBe('waiting');
    expect(r.windows[0][0]).toBe(10);   // bar 1 — the anchor itself
  });

  it('leaving the view cancels waiting but not recording', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    r.ctl.onViewLeft();
    expect(r.ctl.getState()).toBe('idle');
    // and a recording one survives:
    r.setNow(10.5);
    await r.ctl.toggle();
    r.setNow(12.5); r.ctl.pump();
    r.ctl.onViewLeft();
    expect(r.ctl.getState()).toBe('recording');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/performance/loop-capture.test.ts`
Expected: FAIL — `LoopCaptureController` not exported.

- [ ] **Step 3: Implement the controller**

Append to `src/performance/loop-capture.ts`:

```ts
export type LoopCaptureState = 'idle' | 'waiting' | 'recording' | 'finalizing';

export interface CaptureTake { left: Float32Array; right: Float32Array; sampleRate: number }

/** The live tap → worklet chain, already connected. Built by the app wiring;
 *  the controller only moves its window and tears it down. */
export interface CaptureSession {
  setWindow(startSec: number, endSec: number): void;
  cancel(): void;
}

export interface LoopCaptureDeps {
  now(): number;
  barSec(): number;
  anchorCtx(): number;
  isPlaying(): boolean;
  startTransport(): void;
  openSession(onDone: (take: CaptureTake) => void): Promise<CaptureSession>;
  deliver(take: CaptureTake, startSongSec: number): void;
  onState(s: LoopCaptureState): void;
  onError(message: string): void;
}

export class LoopCaptureController {
  private state: LoopCaptureState = 'idle';
  private session: CaptureSession | null = null;
  private startCtx = 0;
  private startSongSec = 0;
  /** Bumped on every cancel/teardown so a late worklet `done` is ignored. */
  private generation = 0;

  constructor(private deps: LoopCaptureDeps) {}

  getState(): LoopCaptureState { return this.state; }

  info(): { state: LoopCaptureState; startSongSec: number; barsElapsed: number } {
    const bars = this.state === 'recording' || this.state === 'finalizing'
      ? Math.max(0, Math.floor((this.deps.now() - this.startCtx) / this.deps.barSec()))
      : 0;
    return { state: this.state, startSongSec: this.startSongSec, barsElapsed: bars };
  }

  async toggle(): Promise<void> {
    if (this.state === 'waiting') { this.cancel(); return; }
    if (this.state === 'recording') { this.stopAt(nextBarBoundarySec(this.deps.now(), this.deps.anchorCtx(), this.deps.barSec())); return; }
    if (this.state !== 'idle') return; // finalizing: the take is already on its way
    if (!this.deps.isPlaying()) this.deps.startTransport();
    const gen = ++this.generation;
    try {
      const session = await this.deps.openSession((take) => {
        if (gen !== this.generation) return; // cancelled while the tail rendered
        this.session = null;
        this.deps.deliver(take, this.startSongSec);
        this.setState('idle');
      });
      if (gen !== this.generation) { session.cancel(); return; } // cancelled mid-open
      this.session = session;
      this.startCtx = nextBarBoundarySec(this.deps.now(), this.deps.anchorCtx(), this.deps.barSec());
      this.startSongSec = this.startCtx - this.deps.anchorCtx();
      session.setWindow(this.startCtx, Infinity);
      this.setState('waiting');
    } catch (err) {
      this.generation++;
      this.setState('idle');
      this.deps.onError('Could not start capture: ' + ((err as Error)?.message ?? String(err)));
    }
  }

  /** Escape: abort whatever is in flight, no take. */
  cancel(): void {
    if (this.state === 'idle') return;
    this.generation++;
    this.session?.cancel();
    this.session = null;
    this.setState('idle');
  }

  /** ⏹ while recording: keep the whole bars already played, drop the rest. */
  onTransportStop(): void {
    if (this.state === 'waiting') { this.cancel(); return; }
    if (this.state !== 'recording') return;
    const lastBar = lastBarBoundarySec(this.deps.now(), this.deps.anchorCtx(), this.deps.barSec());
    if (lastBar <= this.startCtx) { this.cancel(); return; }
    this.stopAt(lastBar);
  }

  /** Leaving the Arrange view: a countdown aborts, a recording carries on. */
  onViewLeft(): void {
    if (this.state === 'waiting') this.cancel();
  }

  /** Per-RAF: promote waiting→recording once the start bar has passed. */
  pump(): void {
    if (this.state === 'waiting' && this.deps.now() >= this.startCtx) this.setState('recording');
  }

  private stopAt(endCtx: number): void {
    this.session?.setWindow(this.startCtx, endCtx);
    this.setState('finalizing');
  }

  private setState(s: LoopCaptureState): void {
    this.state = s;
    this.deps.onState(s);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `NO_COLOR=1 npx vitest run src/performance/loop-capture.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/performance/loop-capture.ts src/performance/loop-capture.test.ts
git commit -m "feat(capture): LoopCaptureController — bar-quantized press-start/press-stop state machine"
```

---

### Task 4: Capture sources (master; system/mic stubs that fail loud)

**Files:**
- Create: `src/performance/capture-sources.ts`
- Test: `src/performance/capture-sources.test.ts`

**Interfaces:**
- Consumes: nothing yet (Tasks 9–10 fill the external sources in).
- Produces:

```ts
export type CaptureSourceKind = 'master' | 'system' | 'mic';
export interface CaptureSource { node: AudioNode; release(): void; external: boolean }
export async function resolveCaptureSource(
  kind: CaptureSourceKind, ctx: AudioContext, masterTap: AudioNode,
): Promise<CaptureSource>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/performance/capture-sources.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCaptureSource } from './capture-sources';

describe('resolveCaptureSource', () => {
  it('master resolves to the tap itself, internal, with a no-op release', async () => {
    const tap = {} as AudioNode;
    const src = await resolveCaptureSource('master', {} as AudioContext, tap);
    expect(src.node).toBe(tap);
    expect(src.external).toBe(false);
    expect(() => src.release()).not.toThrow();
  });
  it('system/mic fail with a clear message when the API is unavailable (jsdom)', async () => {
    await expect(resolveCaptureSource('system', {} as AudioContext, {} as AudioNode))
      .rejects.toThrow(/system audio/i);
    await expect(resolveCaptureSource('mic', {} as AudioContext, {} as AudioNode))
      .rejects.toThrow(/microphone/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/performance/capture-sources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/performance/capture-sources.ts
// Every capture source resolves to the same shape: an AudioNode to feed the
// recorder worklet, and a release() for teardown. The controller never knows
// which one it holds. Master is phase 1; system audio and mic land in later
// tasks of the same round — until then they fail with the message the toast
// shows.

export type CaptureSourceKind = 'master' | 'system' | 'mic';

export interface CaptureSource {
  node: AudioNode;
  release(): void;
  /** External sources (system/mic) may be monitored through 🎧; the master is
   *  already audible. */
  external: boolean;
}

export async function resolveCaptureSource(
  kind: CaptureSourceKind, ctx: AudioContext, masterTap: AudioNode,
): Promise<CaptureSource> {
  if (kind === 'master') return { node: masterTap, release: () => {}, external: false };
  if (kind === 'system') return resolveSystemSource(ctx);
  return resolveMicSource(ctx);
}

async function resolveSystemSource(_ctx: AudioContext): Promise<CaptureSource> {
  throw new Error('Capturing system audio is not available yet.');
}

async function resolveMicSource(_ctx: AudioContext): Promise<CaptureSource> {
  throw new Error('Capturing the microphone is not available yet.');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `NO_COLOR=1 npx vitest run src/performance/capture-sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/performance/capture-sources.ts src/performance/capture-sources.test.ts
git commit -m "feat(capture): capture sources — master tap first, external sources fail loud"
```

---

### Task 5: The real capture session (app wiring)

**Files:**
- Create: `src/app/loop-capture-wiring.ts`
- Test: `src/app/loop-capture-wiring.test.ts`

**Interfaces:**
- Consumes: `ensureRecorderWorklet`, `RECORDER_PROCESSOR_NAME` (`../export/recorder-worklet`); `encodeWavPcm16` (`../export/wav-encoder`); `resolveCaptureSource`, `CaptureSourceKind` (`../performance/capture-sources`); `CaptureSession`, `CaptureTake` (`../performance/loop-capture`).
- Produces:

```ts
export interface CaptureWiringDeps {
  ctx: AudioContext;
  masterTap: AudioNode;
  getSource(): CaptureSourceKind;
  getMonitor(): boolean;
}
export function createCaptureSessionFactory(deps: CaptureWiringDeps):
  (onDone: (take: CaptureTake) => void) => Promise<CaptureSession>;
/** PCM → 16-bit WAV File named for the ingestion gate. */
export function takeToFile(take: CaptureTake, n: number): File;
```

- [ ] **Step 1: Write the failing test (the pure half)**

```ts
// src/app/loop-capture-wiring.test.ts
import { describe, it, expect } from 'vitest';
import { takeToFile } from './loop-capture-wiring';

describe('takeToFile', () => {
  it('wraps the PCM as a WAV File the drop gate accepts by extension', async () => {
    const take = { left: new Float32Array(48), right: new Float32Array(48), sampleRate: 48000 };
    const f = takeToFile(take, 3);
    expect(f.name).toBe('Capture 3.wav');
    expect(f.type).toBe('audio/wav');
    const bytes = new Uint8Array(await f.arrayBuffer());
    // RIFF header + 44-byte header + 48 frames * 2 ch * 2 bytes
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(bytes.length).toBe(44 + 48 * 4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/app/loop-capture-wiring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/loop-capture-wiring.ts
// The browser half of loop capture: build the source → recorder-worklet chain
// (the same connect/teardown shape as export/live-take.ts, including the
// silent keep-alive into destination), and wrap a finished take as a WAV File
// for the round-1 drop ingestion gate. The controller in
// performance/loop-capture.ts stays DOM- and AudioContext-free.

import { RECORDER_PROCESSOR_NAME, ensureRecorderWorklet } from '../export/recorder-worklet';
import { encodeWavPcm16 } from '../export/wav-encoder';
import { resolveCaptureSource, type CaptureSourceKind, type CaptureSource } from '../performance/capture-sources';
import type { CaptureSession, CaptureTake } from '../performance/loop-capture';

export interface CaptureWiringDeps {
  ctx: AudioContext;
  /** audio-graph's masterComp.output — the same node the ⏱ live take records. */
  masterTap: AudioNode;
  getSource(): CaptureSourceKind;
  /** 🎧 — read live so the toggle acts mid-capture. External sources only. */
  getMonitor(): boolean;
}

export function takeToFile(take: CaptureTake, n: number): File {
  const blob = encodeWavPcm16([take.left, take.right], take.sampleRate);
  return new File([blob], `Capture ${n}.wav`, { type: 'audio/wav' });
}

export function createCaptureSessionFactory(deps: CaptureWiringDeps) {
  return async (onDone: (take: CaptureTake) => void): Promise<CaptureSession> => {
    const { ctx } = deps;
    await ensureRecorderWorklet(ctx);
    const source: CaptureSource = await resolveCaptureSource(deps.getSource(), ctx, deps.masterTap);
    const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    // Monitoring path for external sources; a gain so the toggle is a connect,
    // not a rebuild. The master needs none — it is already audible.
    const monitor = source.external ? new GainNode(ctx, { gain: 1 }) : null;
    let monitoring = false;
    const setMonitor = (on: boolean) => {
      if (!monitor || on === monitoring) return;
      monitoring = on;
      if (on) { source.node.connect(monitor); monitor.connect(ctx.destination); }
      else { try { source.node.disconnect(monitor); monitor.disconnect(); } catch { /* torn down */ } }
    };
    const teardown = () => {
      setMonitor(false);
      try { source.node.disconnect(node); } catch { /* already torn down */ }
      try { node.disconnect(); } catch { /* already torn down */ }
      source.release();
    };
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { type: string; left: Float32Array; right: Float32Array; sampleRate: number };
      if (d?.type !== 'done') return;
      teardown();
      onDone({ left: d.left, right: d.right, sampleRate: d.sampleRate });
    };
    source.node.connect(node);
    node.connect(ctx.destination); // silent keep-alive: the node must be pulled
    setMonitor(deps.getMonitor());
    return {
      setWindow: (startSec, endSec) => {
        setMonitor(deps.getMonitor()); // cheap re-read: the 🎧 may have toggled
        node.port.postMessage({ type: 'window', startTime: startSec, endTime: endSec });
      },
      cancel: teardown,
    };
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `NO_COLOR=1 npx vitest run src/app/loop-capture-wiring.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/loop-capture-wiring.ts src/app/loop-capture-wiring.test.ts
git commit -m "feat(capture): real capture session — source to recorder worklet, take to WAV File"
```

---

### Task 6: app-prefs — sticky source + 🎧

**Files:**
- Modify: `src/save/app-prefs.ts`
- Test: `src/save/app-prefs.test.ts` (append)

**Interfaces:**
- Consumes: `CaptureSourceKind` — do NOT import it here (save layer must not depend on performance); declare the union inline.
- Produces: `AppPrefs.captureSource: 'master' | 'system' | 'mic'` (default `'master'`), `AppPrefs.captureMonitor: boolean` (default `false`).

- [ ] **Step 1: Write the failing tests** (append to the existing `app-prefs.test.ts`, matching its style)

```ts
it('captureSource defaults to master and rejects unknown values', () => {
  localStorage.setItem('loom-app-prefs-v1', JSON.stringify({ captureSource: 'tape-deck' }));
  expect(appPrefs().captureSource).toBe('master');
  localStorage.setItem('loom-app-prefs-v1', JSON.stringify({ captureSource: 'mic' }));
  expect(appPrefs().captureSource).toBe('mic');
});

it('captureMonitor defaults to off', () => {
  localStorage.removeItem('loom-app-prefs-v1');
  expect(appPrefs().captureMonitor).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NO_COLOR=1 npx vitest run src/save/app-prefs.test.ts`
Expected: FAIL — `captureSource` undefined.

- [ ] **Step 3: Implement** — add to `AppPrefs`:

```ts
  /** Loop-capture source. A machine preference like the zoom: what THIS
   *  machine records from is not a property of the project. */
  captureSource: 'master' | 'system' | 'mic';
  /** 🎧 monitor external capture sources. Off by default — the obvious
   *  mic-on-speakers feedback loop should be opted into, not out of. */
  captureMonitor: boolean;
```

Defaults: `captureSource: 'master', captureMonitor: false`. Validation in `appPrefs()`, field by field like the rest:

```ts
      captureSource: parsed.captureSource === 'system' || parsed.captureSource === 'mic'
        ? parsed.captureSource : DEFAULT_APP_PREFS.captureSource,
      captureMonitor: typeof parsed.captureMonitor === 'boolean'
        ? parsed.captureMonitor : DEFAULT_APP_PREFS.captureMonitor,
```

- [ ] **Step 4: Run to verify pass**

Run: `NO_COLOR=1 npx vitest run src/save/app-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/save/app-prefs.ts src/save/app-prefs.test.ts
git commit -m "feat(capture): capture source and monitor as machine prefs"
```

---

### Task 7: Feature integration — controller, ⏹/Escape/view hooks, delivery through the drop gate

**Files:**
- Modify: `src/app/performance-feature.ts` (deps + wiring), `src/performance/perf-keys.ts` (Escape), `src/main.ts` (one dep line)
- Test: `src/performance/perf-keys.test.ts` if present (glob for it; otherwise the controller tests from Task 3 cover the logic and this task is wiring verified by tsc + the e2e in Task 9)

**Interfaces:**
- Consumes: everything Tasks 3–6 produced.
- Produces: `PerformanceFeature.capture: LoopCaptureController` (returned from `createPerformanceFeature` so the UI task reads state), `PerfActionDeps.cancelCapture?(): boolean`.

- [ ] **Step 1: Add the dep.** `PerformanceFeatureDeps` gains:

```ts
  /** audio-graph's masterComp.output — the loop-capture (and only that) records
   *  from it. Optional: test fixtures build no audio graph. */
  masterTap?: AudioNode;
```

In `src/main.ts`, the `createPerformanceFeature({...})` call (~line 648) gains `masterTap: masterComp.output,`.

- [ ] **Step 2: Extract the shared ingest deps.** In `performance-feature.ts`, the object literal currently passed inline to `attachPerfDrop` (the `{ bpm, meter, pxPerBar, importFile, addLoopLane, addBand, refresh }` block) moves to a `const ingestDeps: PerfIngestDeps = {...}` defined once at feature scope (its closures — `arrangement`, `seq`, `sessionHost`, `ctx`, `refreshPerformanceView` — are all in scope there). `attachPerfDrop(host, ingestDeps)` keeps working; capture delivery reuses the same object. Import `ingestDroppedFile` from `../performance/perf-ingest`.

- [ ] **Step 3: Instantiate the controller** at feature scope (after `playback` and `ingestDeps` exist):

```ts
  let captureCount = 0;
  const captureFactory = deps.masterTap ? createCaptureSessionFactory({
    ctx,
    masterTap: deps.masterTap,
    getSource: () => appPrefs().captureSource,
    getMonitor: () => appPrefs().captureMonitor,
  }) : null;
  const capture = new LoopCaptureController({
    now: () => ctx.currentTime,
    barSec: () => songBarSec(arrangement.bpm, seq.meter),
    anchorCtx: () => arrangementPlayState.startedAtCtx,
    isPlaying: () => arrangementPlayState.isPlaying,
    startTransport: () => { playback.begin(); },
    openSession: (onDone) => {
      if (!captureFactory) return Promise.reject(new Error('no audio graph'));
      return captureFactory(onDone);
    },
    deliver: (take, startSongSec) => {
      const file = takeToFile(take, ++captureCount);
      void (async () => {
        const imported = await ingestDeps.importFile(file);
        if (imported) ingestDroppedFile(ingestDeps, { name: file.name, ...imported }, startSongSec);
      })();
    },
    onState: () => refreshPerformanceView(),
    onError: (m) => flashToast(m),
  });
```

(`ingestDroppedFile` refreshes; the band lands at `startSongSec`, a bar boundary by construction, and `fitLoopToBars` yields `stretch = 1` on an exact-bars take.)

- [ ] **Step 4: Hook the exits.**
  - `onStop()`: FIRST line of the performance branch becomes `capture.onTransportStop();` (before `stopArrangement`), so the last-bar window posts while the context clock is still meaningful.
  - `setMode(...)`: when leaving `'performance'`, call `capture.onViewLeft();`.
  - `rafPlayhead` (the per-frame updater): add `capture.pump();` plus the ghost/count DOM updates (Task 8).
  - `attachPerfActions` deps gain `cancelCapture: () => { const active = capture.getState() === 'waiting' || capture.getState() === 'recording'; if (active) capture.cancel(); return active; },`.
  - In `perf-keys.ts`, `PerfActionDeps` gains `cancelCapture?(): boolean;` and `onKey` gains a branch BEFORE the others:

```ts
    if (e.key === 'Escape' && deps.cancelCapture?.()) { e.preventDefault(); return; }
```

  - Return `capture` from `createPerformanceFeature` (add to the returned object) so Task 8's UI reads `performanceFeature.capture`.

- [ ] **Step 5: Typecheck + full unit run**

Run: `npx tsc --noEmit` then `npm run test:unit`
Expected: clean / green (the perf-keys change is optional-dep, existing tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/app/performance-feature.ts src/performance/perf-keys.ts src/main.ts
git commit -m "feat(capture): wire the capture controller into the performance feature"
```

---

### Task 8: UI — toolbar ●, source selector, 🎧, empty-state button, ghost band

**Files:**
- Modify: `src/performance/performance-ui.ts` (PerfUICallbacks), `src/performance/performance-ui-templates.ts` (toolbar + empty + droplane), `src/app/performance-feature.ts` (fill the callback + RAF ghost updates), `src/styles/_performance-view.scss`
- Test: `src/performance/performance-ui-render.test.ts` (append — glob to confirm the exact filename first)

**Interfaces:**
- Consumes: `performanceFeature.capture` (Task 7), `appPrefs`/`setAppPrefs` (Task 6).
- Produces: `PerfUICallbacks.capture?: PerfCaptureCallbacks` where:

```ts
export interface PerfCaptureCallbacks {
  state: 'idle' | 'waiting' | 'recording' | 'finalizing';
  source: 'master' | 'system' | 'mic';
  monitor: boolean;
  startBar: number;                 // 1-based, for "recording at bar N…"
  onToggle(): void;
  onSource(k: 'master' | 'system' | 'mic'): void;
  onMonitor(): void;
}
```

- [ ] **Step 1: Write the failing render test** (append to the perf UI render test file, following its harness style — it renders templates into jsdom):

```ts
it('toolbar shows the capture button and reflects the recording state', () => {
  // render with cb.capture = { state: 'recording', source: 'master', monitor: false,
  //   startBar: 3, onToggle: spy, onSource: () => {}, onMonitor: () => {} }
  // assert: a `.perf-capture-btn.recording` exists; clicking it calls the spy;
  // the source <select class="perf-capture-source"> holds 'master';
  // no `.perf-capture-monitor` (master source hides 🎧).
});
it('empty state record button is ENABLED and triggers the capture toggle', () => {
  // render emptyTemplate with cb.capture present; the button has no `disabled`
  // attr and clicking calls onToggle. Without cb.capture it stays disabled.
});
it('the droplane row carries the ghost while capture is active', () => {
  // render with capture.state 'waiting': `.perf-capture-ghost` exists with
  // style.left at startBar * pxPerBar.
});
```

(Write these as REAL tests against the actual harness in the file — the comments above are the required assertions, the harness shape comes from the neighbouring tests.)

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement.**
  - `toolbarTemplate`: after the loop fields, when `cb.capture` exists render:

```ts
  const cap = cb.capture;
  const capTpl = cap ? html` · <button
      class=${'rnd perf-capture-btn ' + cap.state}
      title=${cap.state === 'idle' ? 'Record a loop (starts next bar)' : 'Stop at the end of this bar'}
      @click=${() => cap.onToggle()}
    >●</button><select
      class="perf-capture-source"
      .value=${cap.source}
      @change=${(e: Event) => cap.onSource((e.currentTarget as HTMLSelectElement).value as 'master' | 'system' | 'mic')}
    ><option value="master">Master</option><option value="system">System</option><option value="mic">Mic</option></select>${cap.source !== 'master' ? html`<button
      class=${'rnd perf-capture-monitor' + (cap.monitor ? ' primary' : '')}
      title="Monitor the capture source"
      @click=${() => cap.onMonitor()}
    >🎧</button>` : nothing}${cap.state === 'waiting' ? html`<span class="perf-capture-status">recording at bar ${cap.startBar}…</span>` : nothing}${cap.state === 'recording' ? html`<span class="perf-capture-status rec">● <span class="perf-capture-count">0</span> bars</span>` : nothing}` : nothing;
```

  and interpolate `${capTpl}` before the readout.
  - `emptyTemplate`: the record button becomes `html`<button ?disabled=${!cb.capture} title="Record a loop" @click=${() => cb.capture?.onToggle()}>● Record a loop</button>``.
  - Droplane template: when `cb.capture && cb.capture.state !== 'idle'`, append inside the droplane track: `html`<div class="perf-capture-ghost ${cb.capture.state}" style="left:${cb.capture.startBar * cb.pxPerBar}px"></div>``.
  - `performance-feature.ts` builds the callback when rendering:

```ts
  capture: captureFactory ? {
    state: capture.getState(),
    source: appPrefs().captureSource,
    monitor: appPrefs().captureMonitor,
    startBar: Math.floor(capture.info().startSongSec / songBarSec(arrangement.bpm, seq.meter)) + 1,
    onToggle: () => { void capture.toggle(); },
    onSource: (k) => { setAppPrefs({ captureSource: k }); refreshPerformanceView(); },
    onMonitor: () => { setAppPrefs({ captureMonitor: !appPrefs().captureMonitor }); refreshPerformanceView(); },
  } : undefined,
```

  - `rafPlayhead` per frame while capture is active: update `.perf-capture-count` textContent to `capture.info().barsElapsed` and the ghost width to `(playheadPx - ghostLeftPx)` clamped ≥ 0 — DOM writes only, no lit re-render (the refresh() REMOUNT rule: never re-render from a continuous updater).
  - SCSS (`_performance-view.scss`): `.perf-capture-btn` red outline; `.waiting` blinking (reuse an existing blink/pulse keyframe if one exists in the file, else add `@keyframes perf-blink`); `.recording`/`.finalizing` solid red; `.perf-capture-ghost` absolute, top 0, bottom 0, translucent red, `pointer-events: none`; `.perf-capture-status.rec` red text.

- [ ] **Step 4: Verify**

Run: `NO_COLOR=1 npx vitest run src/performance/performance-ui-render.test.ts` (exact filename from glob) → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/performance src/app/performance-feature.ts src/styles/_performance-view.scss
git commit -m "feat(capture): toolbar record button, source selector, ghost band"
```

---

### Task 9: e2e — the one user path (master capture)

**Files:**
- Create: `tests/e2e/loop-capture.spec.ts`

**Interfaces:**
- Consumes: the drop helper + `installMasterTap`/`measureMaster` patterns from `tests/e2e/arrange-view.spec.ts` (copy the in-page DataTransfer drop of the base64 amen fixture verbatim — the executor may not have that file in context: READ `tests/e2e/arrange-view.spec.ts` first and reuse its helpers/imports).

The path (one test, no `(or …)` alternatives):
1. Build served fresh: the suite runs under `npm run test:e2e` which serves `dist/` — `npm run build` is a prerequisite (see Verify).
2. Open the app → Arrange (Performance) view → drop the amen fixture at bar 0 (in-page DataTransfer, as in arrange-view.spec) → one lane + band exist.
3. Trusted click ▶ (audio gesture) so the arrangement plays the dropped loop.
4. Click the toolbar `.perf-capture-btn` (● — trusted click; source defaults to master).
5. Wait ≥ 2 bars past the next boundary (default 120 BPM 4/4 → bar = 2 s → `waitForTimeout(5500)` is ≥ 2 whole bars regardless of press phase), click ● again.
6. Wait for delivery: `expect.poll` until the lane count is 2 (the captured lane appeared) — poll the DOM (`.perf-row[data-lane-id]` count) with a generous timeout (decode + ingest are async).
7. Assert the new band's duration is a WHOLE number of bars: read the new row's `.perf-clip` width / pxPerBar → `Math.abs(bars - Math.round(bars)) < 0.05` (relative to one bar).
8. Assert the capture is AUDIBLE on its own: stop, launch-mute or delete the ORIGINAL lane's band (reuse the selection + Delete key path from arrange-view.spec), seek to the captured band's bar, play, `measureMaster` → `avgRms` at least 1/3 of the pre-capture reading (same threshold reasoning as the round-1 mute test: send tails).

- [ ] **Step 1: Write the spec** following the above, reusing arrange-view.spec helpers.
- [ ] **Step 2: Verify**

Run: `npm run build` then `npx playwright test tests/e2e/loop-capture.spec.ts`
Expected: PASS. Debug with `npm run test:e2e:headed` if timing flakes; remember the sticky ruler intercepts Playwright clicks — seek via synthetic `dispatchEvent(MouseEvent)` as arrange-view.spec already does.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/loop-capture.spec.ts
git commit -m "test(capture): e2e — record two bars of the master and land an audible loop"
```

---

### Task 10: Phase 2 — system-audio source

**Files:**
- Modify: `src/stems/system-audio-capture.ts` (extract the stream request), `src/performance/capture-sources.ts` (fill `resolveSystemSource`)
- Test: `src/stems/system-audio-capture.test.ts` (create if absent — the extracted helper's failure paths are testable in jsdom)

- [ ] **Step 1: Extract** from `startSystemAudioCapture` the stream-acquisition block (the `getDisplayMedia` call, the "no audio track" check + track release, the error messages) into an exported `requestSystemAudioStream(): Promise<MediaStream>` in the same file, returning the AUDIO-ONLY stream (`new MediaStream(audioTracks)`) with the original tracks retained for release — give the returned stream a paired release: export shape `{ stream: MediaStream; release(): void }`. `startSystemAudioCapture` calls it; behavior unchanged (its existing "verified live" doc comment stays true).
- [ ] **Step 2: Failing test**: `requestSystemAudioStream` rejects with the support message when `navigator.mediaDevices.getDisplayMedia` is absent (jsdom default).
- [ ] **Step 3: Fill `resolveSystemSource`** in `capture-sources.ts`:

```ts
async function resolveSystemSource(ctx: AudioContext): Promise<CaptureSource> {
  const { requestSystemAudioStream } = await import('../stems/system-audio-capture');
  const { stream, release } = await requestSystemAudioStream();
  const node = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
  return { node, release: () => { try { node.disconnect(); } catch { /* torn down */ } release(); }, external: true };
}
```

Update the Task 4 test: `'system'` now rejects only when the API is missing (message comes from the stems helper — adjust the regex to match its actual text: `/does not support|system audio/i`).
- [ ] **Step 4: Verify** — helper test green, `npm run test:unit` green, `npx tsc --noEmit` clean. Live verification (screen-share picker → capture two bars of a YouTube tab) happens at round end with the user — record it as pending in the final report, do not claim it done.
- [ ] **Step 5: Commit**

```bash
git add src/stems/system-audio-capture.ts src/stems/system-audio-capture.test.ts src/performance/capture-sources.ts src/performance/capture-sources.test.ts
git commit -m "feat(capture): system-audio capture source via the shared stream request"
```

---

### Task 11: Phase 3 — microphone source

**Files:**
- Modify: `src/performance/capture-sources.ts`
- Test: `src/performance/capture-sources.test.ts` (adjust the mic case)

- [ ] **Step 1: Fill `resolveMicSource`:**

```ts
async function resolveMicSource(ctx: AudioContext): Promise<CaptureSource> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) throw new Error('Your browser does not support microphone capture.');
  // Music, not speech: leave the signal alone.
  const stream = await md.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const node = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
  const release = () => {
    try { node.disconnect(); } catch { /* torn down */ }
    stream.getTracks().forEach((t) => t.stop());
  };
  return { node, release, external: true };
}
```

- [ ] **Step 2: Verify** — unit green (mic case still rejects in jsdom, message updated), tsc clean. Live mic verification with the user at round end, same as Task 10.
- [ ] **Step 3: Commit**

```bash
git add src/performance/capture-sources.ts src/performance/capture-sources.test.ts
git commit -m "feat(capture): microphone capture source, processing disabled"
```

---

### Task 12: Docs + full green + finish

**Files:**
- Modify: `docs/manual/10-performance-and-arrangement.md` (the "Record a loop" placeholder becomes real: the ● flow, bar quantization, the three sources, 🎧, the ⏹/Escape rules)
- Verify: everything.

- [ ] **Step 1: Update the manual chapter** (English). Do NOT run `npm run build:manual` inside the worktree (it screenshots the app; regenerate on main after merge, as the previous round did).
- [ ] **Step 2: Full verification**

```bash
npm run build          # plugins + tsc + bundle
npm run test:unit      # all green (known pre-existing reds excluded — compare against main if in doubt)
npm run test:e2e       # arrange-view + loop-capture + the rest
```

- [ ] **Step 3: GitNexus gate** — `detect_changes({scope: "compare", base_ref: "main"})`; review, re-run if partial/truncated.
- [ ] **Step 4: Squash to one commit per task** (GIT_SEQUENCE_EDITOR todo-file method), rebase onto main, report. **Do NOT merge to main without the user's explicit permission.** After the user's OK: `git rebase main` + `git merge --ff-only` from the main checkout, push, regenerate the manual on main, archive spec+plan to `docs/superpowers/archive/`, update memory.

---

## Self-review notes

- Spec coverage: controller (T1–T3), sources (T4, T10, T11), session glue + monitoring (T5), UI/states incl. ghost + empty state (T8), Escape/⏹/view rules (T3, T7), prefs (T6), ingestion/undo reuse (T7 deliver → drop gate), e2e user path (T9), worklet pin (T2), manual (T12). Exclusions (latency comp, count-in, overdub, dialog picker) have no tasks — correct.
- Type consistency: `CaptureSession`/`CaptureTake`/`LoopCaptureDeps` defined once in T3, consumed by T5/T7; `CaptureSourceKind` in T4, consumed by T5/T6 (inline union in prefs, deliberate); `PerfCaptureCallbacks` in T8 only.
- Known risk: `arrangementPlayhead` may wrap under an A–B loop while `startedAtCtx` stays fixed — the capture math uses `startedAtCtx` directly (unwrapped ctx time), so boundaries stay on the grid; the delivered `startSongSec` is the UNWRAPPED position, which for a capture started inside a loop pass > 1 lands the band later than the visible playhead. Acceptable v1 behavior; if it jars in live verification, clamp `startSongSec` into the loop window at delivery — decide then, not now.
