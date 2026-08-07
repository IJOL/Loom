# Scene Countdown Ring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one swept-sector ring to the master strip of the session mixer row that shows how much of the current scene is left before the queued switch lands.

**Architecture:** A pure function (`src/core/scene-countdown.ts`) reads the live `LanePlayState` map and answers "what should the ring show right now"; a dumb imperative widget (`src/core/scene-ring.ts`) polls it from a shared RAF loop and mutates an SVG wedge. The widget mounts inside `buildMasterStrip` and is torn down through the existing `registerDisposable` channel. No new engine state, no mirrored copy of the switch instant.

**Tech Stack:** TypeScript, lit-html (one-shot render only), SVG, Vitest (+ jsdom for the widget), SCSS.

**Spec:** [docs/superpowers/specs/2026-08-07-scene-countdown-ring-design.md](../specs/2026-08-07-scene-countdown-ring-design.md)
**Approved mockup:** [docs/superpowers/specs/2026-08-07-scene-countdown-ring-mockup.html](../specs/2026-08-07-scene-countdown-ring-mockup.html) — variant **A (swept sector)** is the approved one.

## Global Constraints

- **Worktree.** This work runs in an isolated git worktree on a feature branch, created with `EnterWorktree` before Task 1. Rebase onto `main` after each task commit.
- **Colours come from existing tokens only** (`src/styles/_design-tokens.scss`): `--text-faint` idle, `--amber` queued, `--red` last bar. Do not introduce new hex values.
- **No new engine state.** The ring reads `LanePlayState` and `governingLoopSec()`; it never stores its own copy of the switch instant.
- **Relative assertions.** Timing tests compare ratios/ordering or use `toBeCloseTo` against values derived from the fixture's own bpm — never hard-coded magnitudes with no derivation shown.
- **No blinking / no animation loop beyond the shared RAF.** Respect `prefers-reduced-motion` for the colour transitions.
- **File size:** target 300 code lines, hard cap 500 (comments and blank lines do not count).
- **Test colour convention:** run single files as `NO_COLOR=1 npx vitest run <path>`. Never add `--reporter=`.
- **Commit messages in English.** Use a Bash heredoc (`git commit -F - <<'EOF'`), never a PowerShell here-string.
- **UI text in English.**

---

### Task 1: The pure countdown logic

The whole feature's brain: given the live lane states and the clock, decide what the ring shows. No DOM, no `AudioContext`, no lit — so every state is testable directly.

**Files:**

- Create: `src/core/scene-countdown.ts`
- Test: `src/core/scene-countdown.test.ts`

**Interfaces:**

- Consumes: `LanePlayState` (`src/session/session-runtime.ts`), `clipLoopSec` / `governingLoopSec` / `sceneSwitchBoundary` (`src/core/launch-timing.ts`), `songBarSec` (`src/core/song-position.ts`), `TimeSignature` (`src/core/meter.ts`).
- Produces:
  - `type CountdownState = 'silent' | 'idle' | 'armed' | 'imminent'`
  - `interface SceneCountdown { state: CountdownState; frac: number; bars: number; secsLeft: number | null; centerText: string }`
  - `function sceneCountdown(laneStates: Map<string, LanePlayState>, now: number, bpm: number, meter: TimeSignature): SceneCountdown`

**Design notes the implementer needs:**

- `frac` is what the wedge fills: **elapsed** fraction when idle, **remaining** fraction when armed. One number, one meaning per state — the widget never branches on state to compute geometry.
- The idle phase is derived from `sceneSwitchBoundary(playing, now)`, *not* from a hand-rolled modulo. That is deliberate: the idle sweep then points at exactly the instant a switch would land, so the ring cannot drift from the scheduler.
- Cold start (something queued while nothing plays) has no governing loop. The span falls back to **one bar**, which is the grid `nextBoundary` quantises to — so `bars` reads 1 and the ring counts the bar you are waiting to enter on. This removes the special case rather than adding one.
- `centerText` is produced here, not in the widget, so the beats-per-bar reading follows the session meter (7/8 counts to 7) and is covered by these tests.

- [ ] **Step 1: Write the failing test**

Create `src/core/scene-countdown.test.ts`:

```ts
// src/core/scene-countdown.test.ts
import { describe, it, expect } from 'vitest';
import { sceneCountdown } from './scene-countdown';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from './meter';

// 120 bpm in 4/4 → one bar = 2 s. Every expectation below is derived from
// that, never from a bare magnitude.
const BPM = 120;
const BAR = 2;

function clip(id: string, lengthBars: number): SessionClip {
  return { color: '#a8c8e8', gridResolution: '1/16', id, lengthBars, notes: [] };
}

/** A lane playing `bars`-long clip since `loopStartedAt`, optionally with a
 *  clip queued to land at `queuedBoundary`. */
function lane(
  id: string,
  opts: { playingBars?: number; loopStartedAt?: number; queuedAt?: number },
): LanePlayState {
  const lp: LanePlayState = { ...emptyLanePlayState(id) };
  if (opts.playingBars != null) {
    lp.playing = clip(`${id}-playing`, opts.playingBars);
    lp.loopStartedAt = opts.loopStartedAt ?? 0;
  }
  if (opts.queuedAt != null) {
    lp.queued = clip(`${id}-queued`, 1);
    lp.queuedBoundary = opts.queuedAt;
  }
  return lp;
}

function states(...lps: LanePlayState[]): Map<string, LanePlayState> {
  return new Map(lps.map((lp) => [lp.laneId, lp]));
}

const at = (m: Map<string, LanePlayState>, now: number) =>
  sceneCountdown(m, now, BPM, DEFAULT_METER);

describe('sceneCountdown', () => {
  it('reports silent when no lane is playing and nothing is queued', () => {
    const r = at(states(lane('A', {})), 0);
    expect(r.state).toBe('silent');
    expect(r.secsLeft).toBeNull();
    expect(r.centerText).toBe('');
  });

  it('idle: frac is the elapsed phase of the governing loop', () => {
    // 4-bar clip = 8 s, started at 0. At now=2 s a quarter has elapsed.
    const m = states(lane('A', { playingBars: 4, loopStartedAt: 0 }));
    const r = at(m, 1 * BAR);
    expect(r.state).toBe('idle');
    expect(r.secsLeft).toBeNull();
    expect(r.bars).toBeCloseTo(4, 9);
    expect(r.frac).toBeCloseTo(0.25, 9);
    expect(r.centerText).toBe('2'); // second bar of four
  });

  it('idle: frac grows monotonically across the loop', () => {
    const m = states(lane('A', { playingBars: 4, loopStartedAt: 0 }));
    expect(at(m, 1 * BAR).frac).toBeLessThan(at(m, 3 * BAR).frac);
  });

  it('armed: two lanes queued to the same boundary count down together', () => {
    // Both lanes play a 4-bar loop from 0; the switch lands at 8 s.
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
      lane('B', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
    );
    const early = at(m, 1 * BAR);
    const late = at(m, 3 * BAR);
    expect(early.state).toBe('armed');
    expect(early.secsLeft).toBeCloseTo(3 * BAR, 9);
    expect(late.frac).toBeLessThan(early.frac); // drains, not fills
    expect(early.centerText).toBe('3'); // three bars left
  });

  it('armed: a lone queued clip drives the ring just like a scene', () => {
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
      lane('B', { playingBars: 4, loopStartedAt: 0 }),
    );
    const r = at(m, 1 * BAR);
    expect(r.state).toBe('armed');
    expect(r.secsLeft).toBeCloseTo(3 * BAR, 9);
  });

  it('armed: with several boundaries pending it reports the nearest', () => {
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }),
      lane('B', { playingBars: 2, loopStartedAt: 0, queuedAt: 2 * BAR }),
    );
    expect(at(m, 1 * BAR).secsLeft).toBeCloseTo(1 * BAR, 9);
  });

  it('a lone long clip does not govern (the outlier rule holds)', () => {
    // 4, 4 and 32 bars playing: 32 > 2×4, so 4 bars governs.
    const m = states(
      lane('A', { playingBars: 4, loopStartedAt: 0 }),
      lane('B', { playingBars: 4, loopStartedAt: 0 }),
      lane('C', { playingBars: 32, loopStartedAt: 0 }),
    );
    expect(at(m, 1 * BAR).bars).toBeCloseTo(4, 9);
  });

  it('imminent: inside the last bar before the switch', () => {
    const m = states(lane('A', { playingBars: 4, loopStartedAt: 0, queuedAt: 4 * BAR }));
    const r = at(m, 3.5 * BAR); // 1 s left = half a bar
    expect(r.state).toBe('imminent');
    expect(r.centerText).toBe('2'); // half a bar = 2 beats in 4/4
  });

  it('cold start: queued with nothing playing spans one bar', () => {
    const m = states(lane('A', { queuedAt: 1 * BAR }));
    const r = at(m, 0.5 * BAR);
    expect(r.state).toBe('imminent'); // under a bar away
    expect(r.bars).toBeCloseTo(1, 9);
    expect(r.frac).toBeCloseTo(0.5, 9);
  });

  it('after the boundary is crossed the ring returns to idle', () => {
    // The scheduler promotes queued → playing and clears `queued`.
    const lp = lane('A', { playingBars: 4, loopStartedAt: 4 * BAR });
    const r = at(states(lp), 4 * BAR + 0.1);
    expect(r.state).toBe('idle');
    expect(r.secsLeft).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/scene-countdown.test.ts`
Expected: FAIL — `Failed to resolve import "./scene-countdown"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/scene-countdown.ts`:

```ts
// What the scene countdown ring should show at this instant.
//
// The ring never stores its own copy of the switch instant: `launchScene` and
// `launchClip` already wrote it into every affected lane's `queuedBoundary`,
// and `governingLoopSec` already decided which loop governs. This module only
// reads those, so the drawing cannot disagree with the audio.
//
// Pure: no DOM, no AudioContext, no lit. The widget in scene-ring.ts is a dumb
// consumer of the value this returns.

import type { LanePlayState } from '../session/session-runtime';
import { clipLoopSec, governingLoopSec, sceneSwitchBoundary } from './launch-timing';
import { songBarSec } from './song-position';
import { DEFAULT_METER, type TimeSignature } from './meter';

export type CountdownState = 'silent' | 'idle' | 'armed' | 'imminent';

export interface SceneCountdown {
  state: CountdownState;
  /** 0..1 — how much of the wedge to fill. ELAPSED when idle, REMAINING when
   *  armed/imminent, so the widget draws one number without branching. */
  frac: number;
  /** Length of the governing loop in bars. May be fractional. */
  bars: number;
  /** Seconds until the switch; null when nothing is queued. */
  secsLeft: number | null;
  /** Pre-formatted centre reading — produced here so the beats-per-bar count
   *  follows the session meter and stays covered by this module's tests. */
  centerText: string;
}

const SILENT: SceneCountdown = {
  state: 'silent', frac: 0, bars: 0, secsLeft: null, centerText: '',
};

export function sceneCountdown(
  laneStates: Map<string, LanePlayState>,
  now: number,
  bpm: number,
  meter: TimeSignature = DEFAULT_METER,
): SceneCountdown {
  const playing: { loopStartedAt: number; loopSec: number }[] = [];
  let nearest = Infinity;
  for (const lp of laneStates.values()) {
    if (lp.queued && lp.queuedBoundary < nearest) nearest = lp.queuedBoundary;
    if (!lp.playing) continue;
    const loopSec = clipLoopSec(lp.playing, bpm, meter);
    if (loopSec > 0) playing.push({ loopStartedAt: lp.loopStartedAt, loopSec });
  }

  const barSec = songBarSec(bpm, meter);
  if (barSec <= 0) return SILENT;
  if (playing.length === 0 && nearest === Infinity) return SILENT;

  const gov = governingLoopSec(playing.map((p) => p.loopSec));
  // Cold start (queued, nothing playing) has no governing loop: the boundary
  // came off the quantize grid, so one bar is the honest span to count down.
  const span = gov > 0 ? gov : barSec;
  const bars = span / barSec;

  if (nearest < Infinity) {
    const secsLeft = Math.max(0, nearest - now);
    const frac = Math.max(0, Math.min(1, secsLeft / span));
    const state: CountdownState = secsLeft <= barSec ? 'imminent' : 'armed';
    return { state, frac, bars, secsLeft, centerText: remainingText(frac * bars, meter) };
  }

  // Idle: the elapsed phase of the loop that governs, expressed against the
  // same instant a switch would land on — sceneSwitchBoundary, not a modulo.
  const T = sceneSwitchBoundary(playing, now);
  const frac = Math.max(0, Math.min(1, 1 - (T - now) / span));
  return {
    state: 'idle', frac, bars, secsLeft: null,
    centerText: String(Math.floor(frac * bars) + 1),
  };
}

/** Bars left, or — inside the final bar — beats left in the session meter. */
function remainingText(barsLeft: number, meter: TimeSignature): string {
  if (barsLeft >= 1) return String(Math.ceil(barsLeft));
  return String(Math.max(1, Math.ceil(barsLeft * meter.num)));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/scene-countdown.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/scene-countdown.ts src/core/scene-countdown.test.ts
git commit -F - <<'EOF'
feat(core): work out how much of the scene is left

The switch instant was already there in queuedBoundary and the governing
loop was already picked by governingLoopSec; nothing read either back out
for the user. sceneCountdown answers what a ring should show at this
instant - silent, the idle sweep, the drain, the last bar - by reading
that state rather than keeping a second copy of it.

The idle phase comes off sceneSwitchBoundary instead of a modulo so the
sweep points at exactly the instant a switch would land. Cold start has
no governing loop, so the span falls back to the bar the quantize grid
was going to snap to - one fewer special case, not one more.
EOF
```

---

### Task 2: The ring widget

The SVG and the shared RAF loop. Structurally a sibling of `createLevelMeter`: one-shot lit render, then per-frame imperative mutation of kept refs — no template diff in the hot path.

**Files:**

- Create: `src/core/scene-ring.ts`
- Test: `src/core/scene-ring.test.ts`

**Interfaces:**

- Consumes: `sceneCountdown` / `SceneCountdown` / `CountdownState` from Task 1; `renderElement` (`src/core/lit-fragment.ts`).
- Produces:
  - `interface SceneRingDeps { laneStates(): Map<string, LanePlayState>; now(): number; bpm(): number; meter(): TimeSignature; caption(): string }`
  - `interface SceneRingHandle { el: HTMLElement; dispose(): void; refresh(): void }`
  - `function createSceneRing(deps: SceneRingDeps): SceneRingHandle`
  - `function wedgePath(frac: number): string`

**Design notes the implementer needs:**

- `deps` are **getters**, not values: the widget outlives many play-state changes and must never hold a stale `laneStates` reference.
- `refresh()` is the single paint entry point. The RAF loop calls it; the tests call it directly, which is how the widget gets tested without faking `requestAnimationFrame`.
- `wedgePath` is exported purely so its geometry is testable — the 0 and 1 ends are where an arc path silently degenerates.
- State lands on the root as classes (`idle` / `armed` / `imminent`); every colour is a CSS token in Task 3, none are set from JS.

- [ ] **Step 1: Write the failing test**

Create `src/core/scene-ring.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createSceneRing, wedgePath, type SceneRingDeps } from './scene-ring';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from './meter';

const BPM = 120;
const BAR = 2;

function clip(id: string, lengthBars: number): SessionClip {
  return { color: '#a8c8e8', gridResolution: '1/16', id, lengthBars, notes: [] };
}

function makeDeps(over: Partial<SceneRingDeps> = {}): SceneRingDeps {
  const lp: LanePlayState = { ...emptyLanePlayState('A') };
  lp.playing = clip('p', 4);
  lp.loopStartedAt = 0;
  return {
    laneStates: () => new Map([['A', lp]]),
    now: () => 1 * BAR,
    bpm: () => BPM,
    meter: () => DEFAULT_METER,
    caption: () => 'Main Groove',
    ...over,
  };
}

describe('wedgePath', () => {
  it('is empty at zero so nothing is drawn', () => {
    expect(wedgePath(0)).toBe('');
  });

  it('closes a full circle at one without collapsing the arc', () => {
    const d = wedgePath(1);
    expect(d).not.toBe('');
    expect(d).toContain('A'); // an arc command survived
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });

  it('flips the large-arc flag past the halfway point', () => {
    expect(wedgePath(0.25)).toMatch(/A 15 15 0 0 1/);
    expect(wedgePath(0.75)).toMatch(/A 15 15 0 1 1/);
  });
});

describe('createSceneRing', () => {
  it('builds a .scene-ring root holding an svg and a caption', () => {
    const ring = createSceneRing(makeDeps());
    expect(ring.el.classList.contains('scene-ring')).toBe(true);
    expect(ring.el.querySelector('svg')).not.toBeNull();
    expect(ring.el.querySelector('.ring-caption')).not.toBeNull();
    ring.dispose();
  });

  it('paints the idle state from the lane states', () => {
    const ring = createSceneRing(makeDeps());
    ring.refresh();
    expect(ring.el.classList.contains('idle')).toBe(true);
    expect(ring.el.querySelector('.ring-num')!.textContent).toBe('2');
    expect(ring.el.querySelector('.ring-caption')!.textContent).toBe('Main Groove');
    ring.dispose();
  });

  it('paints the armed state and captions the target', () => {
    const lp: LanePlayState = { ...emptyLanePlayState('A') };
    lp.playing = clip('p', 4);
    lp.loopStartedAt = 0;
    lp.queued = clip('q', 4);
    lp.queuedBoundary = 4 * BAR;
    const ring = createSceneRing(makeDeps({
      laneStates: () => new Map([['A', lp]]),
      caption: () => '→ Break',
    }));
    ring.refresh();
    expect(ring.el.classList.contains('armed')).toBe(true);
    expect(ring.el.classList.contains('idle')).toBe(false);
    expect(ring.el.querySelector('.ring-caption')!.textContent).toBe('→ Break');
    ring.dispose();
  });

  it('marks the last bar imminent', () => {
    const lp: LanePlayState = { ...emptyLanePlayState('A') };
    lp.playing = clip('p', 4);
    lp.loopStartedAt = 0;
    lp.queued = clip('q', 4);
    lp.queuedBoundary = 4 * BAR;
    const ring = createSceneRing(makeDeps({
      laneStates: () => new Map([['A', lp]]),
      now: () => 3.5 * BAR,
    }));
    ring.refresh();
    expect(ring.el.classList.contains('imminent')).toBe(true);
    ring.dispose();
  });

  it('empties the wedge and the readings when nothing plays', () => {
    const ring = createSceneRing(makeDeps({ laneStates: () => new Map() }));
    ring.refresh();
    expect(ring.el.querySelector('.ring-wedge')!.getAttribute('d')).toBe('');
    expect(ring.el.querySelector('.ring-num')!.textContent).toBe('');
    ring.dispose();
  });

  it('stops painting after dispose', () => {
    const ring = createSceneRing(makeDeps());
    ring.refresh();
    const before = ring.el.querySelector('.ring-wedge')!.getAttribute('d');
    ring.dispose();
    ring.refresh(); // a late RAF frame must be a no-op, not a crash
    expect(ring.el.querySelector('.ring-wedge')!.getAttribute('d')).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/scene-ring.test.ts`
Expected: FAIL — `Failed to resolve import "./scene-ring"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/scene-ring.ts`:

```ts
// Scene countdown ring — the swept sector in the master strip.
//
// Shows how much of the playing scene is left before a queued switch lands
// (amber, draining; red inside the last bar), and sweeps the scene's own loop
// in grey when nothing is queued.
//
// Structurally a sibling of level-meter.ts: a one-shot lit render, then a
// SHARED RAF loop that mutates the kept SVG refs imperatively — per-frame work
// never goes through a template diff. The loop starts lazily with the first
// ring and stops when the last one is disposed.
//
// Every value comes from sceneCountdown (pure); this file only draws.

import { html } from 'lit-html';
import { renderElement } from './lit-fragment';
import { sceneCountdown } from './scene-countdown';
import type { LanePlayState } from '../session/session-runtime';
import type { TimeSignature } from './meter';

const CX = 20, CY = 20, R = 15;

export interface SceneRingDeps {
  /** Getters, never values: the ring outlives many play-state changes and must
   *  not pin a stale map. */
  laneStates(): Map<string, LanePlayState>;
  now(): number;
  bpm(): number;
  meter(): TimeSignature;
  /** One line under the ring: the active scene when idle, `→ target` when a
   *  switch is pending. The host owns the wording. */
  caption(): string;
}

export interface SceneRingHandle {
  el: HTMLElement;
  dispose(): void;
  /** Paint once from the current deps. The RAF loop calls this; tests call it
   *  directly so the widget needs no faked animation frames. */
  refresh(): void;
}

/** SVG path for a pie wedge covering `frac` of the circle, clockwise from 12
 *  o'clock. Exported for its own tests: 0 and 1 are where an arc degenerates. */
export function wedgePath(frac: number): string {
  if (frac <= 0) return '';
  const a = Math.min(frac, 0.9999) * Math.PI * 2 - Math.PI / 2;
  const x = CX + R * Math.cos(a);
  const y = CY + R * Math.sin(a);
  const large = frac > 0.5 ? 1 : 0;
  return `M ${CX} ${CY} L ${CX} ${CY - R} A ${R} ${R} 0 ${large} 1 ${x} ${y} Z`;
}

// ── Shared RAF loop ────────────────────────────────────────────────────────

const rings = new Set<SceneRingHandle>();
let rafId: number | null = null;

function tick(): void {
  for (const r of rings) r.refresh();
  rafId = rings.size > 0 ? requestAnimationFrame(tick) : null;
}

export function createSceneRing(deps: SceneRingDeps): SceneRingHandle {
  const el = renderElement(html`
    <div class="scene-ring" role="img" aria-label="Time left in the scene">
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle class="ring-track" cx=${CX} cy=${CY} r=${R}></circle>
        <path class="ring-wedge" d=""></path>
        <circle class="ring-hairline" cx=${CX} cy=${CY} r=${R}></circle>
        <text class="ring-num" x=${CX} y=${CY + 0.5}></text>
      </svg>
      <div class="ring-caption"></div>
    </div>
  `);

  const wedge = el.querySelector('.ring-wedge') as SVGPathElement;
  const num = el.querySelector('.ring-num') as SVGTextElement;
  const cap = el.querySelector('.ring-caption') as HTMLElement;

  let live = true;
  let lastD = '';
  let lastState = '';

  const handle: SceneRingHandle = {
    el,
    refresh() {
      if (!live) return;
      const c = sceneCountdown(deps.laneStates(), deps.now(), deps.bpm(), deps.meter());
      const d = wedgePath(c.state === 'silent' ? 0 : c.frac);
      if (d !== lastD) { wedge.setAttribute('d', d); lastD = d; }
      if (c.state !== lastState) {
        el.classList.remove('idle', 'armed', 'imminent', 'silent');
        el.classList.add(c.state);
        lastState = c.state;
      }
      num.textContent = c.centerText;
      cap.textContent = c.state === 'silent' ? '' : deps.caption();
    },
    dispose() {
      live = false;
      rings.delete(handle);
      if (rings.size === 0 && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };

  rings.add(handle);
  if (rafId === null) rafId = requestAnimationFrame(tick);
  handle.refresh();
  return handle;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/scene-ring.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/scene-ring.ts src/core/scene-ring.test.ts
git commit -F - <<'EOF'
feat(core): draw the countdown as a swept sector

The widget half of the ring: a one-shot lit render and then a shared RAF
loop that moves the wedge, the number and the caption on kept refs, so
the hot path never touches a template diff. Same shape as the VU meter,
same lazy start and last-one-out stop.

Its deps are getters rather than values because the ring outlives the
play-state changes that rebuild the mixer row, and a pinned laneStates
map would quietly freeze. dispose() also latches the widget off: a RAF
frame already in flight lands on a no-op instead of a dead node.
EOF
```

---

### Task 3: Mount the ring in the master strip

The ring goes inline with the `MASTER` label, and every mixer column's name row grows to match so the master strip keeps its pixel-for-pixel alignment with the lane columns.

**Files:**

- Modify: `src/core/master-strip.ts` (add optional `sceneRing` dep to `MasterStripDeps`; render it in the `.mix-name` row)
- Modify: `src/styles/_mixer.scss:34-46` (the `.mix-col .mix-name` block) and append the `.scene-ring` styles
- Test: `src/core/master-strip.test.ts` (append cases)

**Interfaces:**

- Consumes: `SceneRingHandle` from Task 2.
- Produces: `MasterStripDeps.sceneRing?: SceneRingHandle` — Task 4 passes the real handle through this field.

**Design notes the implementer needs:**

- The dep is **optional and pre-built**: `buildMasterStrip` interpolates `deps.sceneRing.el` and does not construct the ring. The caller owns the ring's lifetime, which is what lets Task 4 register it for teardown alongside the VU meter, and lets the existing audio-less test fixtures keep working untouched.
- `.mix-col .mix-name` is currently `height: 22px`. It becomes `40px` in **every** column — lane columns simply centre their label in the taller row. That is what preserves the alignment the master strip's header comment promises. The mixer row grows 18 px.
- All ring colours are declared here as CSS, driven by the root classes the widget sets. No colour is written from JS.

- [ ] **Step 1: Write the failing test**

Append to `src/core/master-strip.test.ts` (inside the existing `describe('buildMasterStrip', …)`):

```ts
  it('renders the scene ring inside the name row when one is supplied', () => {
    const ringEl = document.createElement('div');
    ringEl.className = 'scene-ring';
    const el = buildMasterStrip(makeDeps({
      sceneRing: { el: ringEl, dispose() {}, refresh() {} },
    }));
    const name = el.querySelector('.mix-name')!;
    expect(name.querySelector('.scene-ring')).toBe(ringEl);
    expect(name.textContent).toContain('MASTER');
  });

  it('renders without a ring when none is supplied', () => {
    const el = buildMasterStrip(makeDeps());
    expect(el.querySelector('.scene-ring')).toBeNull();
    expect(el.querySelector('.mix-name')!.textContent).toContain('MASTER');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/master-strip.test.ts`
Expected: FAIL — TypeScript rejects `sceneRing` as an unknown property of `MasterStripDeps`, and the first case finds no `.scene-ring`.

- [ ] **Step 3: Add the dep and render it**

In `src/core/master-strip.ts`, add the import and the dep field:

```ts
import type { SceneRingHandle } from './scene-ring';
```

Inside `MasterStripDeps`, after `registerDisposable`:

```ts
  /** Optional pre-built scene countdown ring, rendered inline with the MASTER
   *  label. Pre-built rather than constructed here so the CALLER owns its
   *  lifetime and can register it for teardown next to the VU meter. */
  sceneRing?: SceneRingHandle;
```

Replace the name row in the `buildMasterStrip` template (currently `<div class="mix-name">MASTER</div>`):

```ts
      <div class="mix-name">${deps.sceneRing ? deps.sceneRing.el : ''}<span>MASTER</span></div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/master-strip.test.ts`
Expected: PASS, including the two new cases.

- [ ] **Step 5: Add the styles**

In `src/styles/_mixer.scss`, change the height in the `.mix-col .mix-name` block (line ~40) so every column's name row can hold a 40 px ring:

```scss
  // 40px so the master column's countdown ring fits INSIDE the name row; the
  // lane columns centre their label in the same height and the mixer row stays
  // aligned pixel-for-pixel across every column.
  height: 40px;
  gap: 6px;
```

Append at the end of the file:

```scss
/* ── Scene countdown ring ──────────────────────────────────────────────────
   Sits in the master strip's name row. Shows how much of the scene is left
   before a queued switch lands: grey sweeping the loop when nothing is
   queued, amber draining once something is, red inside the last bar. Every
   colour is a token, driven by the state class the widget sets on the root. */
.scene-ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}
.scene-ring svg { display: block; overflow: visible; }
.ring-track    { fill: none; stroke: var(--border); stroke-width: 4; }
.ring-hairline { fill: none; stroke: var(--border); stroke-width: 1; }
.ring-wedge    { stroke: none; fill: var(--text-faint); fill-opacity: 0.45;
                 transition: fill 140ms ease; }
.ring-num {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: central;
  font-variant-numeric: tabular-nums;
  fill: var(--text-dim);
  transition: fill 140ms ease;
}
.ring-caption {
  font-size: 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 140ms ease;
}
.scene-ring.armed .ring-wedge   { fill: var(--amber); }
.scene-ring.armed .ring-num     { fill: var(--amber); }
.scene-ring.armed .ring-caption { color: var(--amber); }
.scene-ring.imminent .ring-wedge   { fill: var(--red); }
.scene-ring.imminent .ring-num     { fill: var(--red); }
.scene-ring.imminent .ring-caption { color: var(--red); }

@media (prefers-reduced-motion: reduce) {
  .ring-wedge, .ring-num, .ring-caption { transition-duration: 0ms; }
}
```

- [ ] **Step 6: Typecheck and run the affected suites**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `NO_COLOR=1 npx vitest run src/core/master-strip.test.ts src/core/mixer.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/master-strip.ts src/core/master-strip.test.ts src/styles/_mixer.scss
git commit -F - <<'EOF'
feat(mixer): give the master strip somewhere to put the ring

The ring is handed in already built rather than constructed here, so the
caller keeps its lifetime and can register it for teardown beside the VU
meter - and the audio-less fixtures keep building a strip with no ring
and no changes.

Its home is the name row, which the master strip promises lines up
pixel-for-pixel with the lane columns. Growing only the master's row
would break that promise, so every column's name row grows to 40px and
the lane labels centre in it. The mixer row is 18px taller; nothing
moves out of line.
EOF
```

---

### Task 4: Wire it to the live session

`SessionHost` builds the ring with getters into its own live state, records the caption at each launch site, and registers the handle for teardown.

**Files:**

- Modify: `src/session/session-host.ts` — `launchClipAt` (~line 166), `launchSceneAt` (~line 180), `renderWithMixer` (~line 683)
- Modify: `src/session/session-host-callbacks.ts:86` (the clip-cell launch)
- Test: `src/session/session-host-queued-label.test.ts` (create)

**Interfaces:**

- Consumes: `createSceneRing` / `SceneRingDeps` (Task 2), `MasterStripDeps.sceneRing` (Task 3).
- Produces: on `SessionHost` — `markQueued(label: string): void` and `ringCaption(): string`.

**Design notes the implementer needs:**

- The caption's target cannot be derived from lane states without guessing "scene or clip?" from how many lanes happen to be queued — a one-lane scene would be mislabelled. So the launch sites record it. There are exactly three in production (`launchClipAt`, `launchSceneAt`, and the clip-cell callback); everything else delegates to those.
- The record is `{ label, boundary }`, **not** a bare label, and it is only honoured while a pending boundary still matches. That way it invalidates itself when the switch lands and no `clear()` call has to be remembered at any stop/seek/undo seam.
- `activeSceneIdx` advances at *launch* time, not at the boundary, so during a countdown `activeScene()` already names the destination — the idle and armed captions both read correctly off it with no extra bookkeeping.

- [ ] **Step 1: Write the failing test**

Create `src/session/session-host-queued-label.test.ts`:

```ts
// Characterises the ring's caption source: the label recorded at the launch
// site, honoured only while the boundary it was recorded against is pending.
import { describe, it, expect } from 'vitest';
import { queuedLabelFor, type QueuedLabel } from './session-host-queued-label';
import { emptyLanePlayState, type LanePlayState } from './session-runtime';
import type { SessionClip } from './session';

function clip(id: string): SessionClip {
  return { color: '#a8c8e8', gridResolution: '1/16', id, lengthBars: 4, notes: [] };
}

function queuedAt(boundary: number): Map<string, LanePlayState> {
  const lp: LanePlayState = { ...emptyLanePlayState('A') };
  lp.playing = clip('p');
  lp.queued = clip('q');
  lp.queuedBoundary = boundary;
  return new Map([['A', lp]]);
}

describe('queuedLabelFor', () => {
  it('returns the recorded label while its boundary is still pending', () => {
    const rec: QueuedLabel = { label: 'Break', boundary: 8 };
    expect(queuedLabelFor(rec, queuedAt(8))).toBe('Break');
  });

  it('ignores a label recorded against a different boundary', () => {
    const rec: QueuedLabel = { label: 'Break', boundary: 8 };
    expect(queuedLabelFor(rec, queuedAt(16))).toBeNull();
  });

  it('ignores the label once nothing is queued', () => {
    const rec: QueuedLabel = { label: 'Break', boundary: 8 };
    const lp: LanePlayState = { ...emptyLanePlayState('A') };
    lp.playing = clip('p');
    expect(queuedLabelFor(rec, new Map([['A', lp]]))).toBeNull();
  });

  it('returns null when nothing was ever recorded', () => {
    expect(queuedLabelFor(null, queuedAt(8))).toBeNull();
  });

  it('matches the NEAREST pending boundary, not just any of them', () => {
    const a: LanePlayState = { ...emptyLanePlayState('A') };
    a.playing = clip('pa'); a.queued = clip('qa'); a.queuedBoundary = 4;
    const b: LanePlayState = { ...emptyLanePlayState('B') };
    b.playing = clip('pb'); b.queued = clip('qb'); b.queuedBoundary = 8;
    const m = new Map([['A', a], ['B', b]]);
    expect(queuedLabelFor({ label: 'Near', boundary: 4 }, m)).toBe('Near');
    expect(queuedLabelFor({ label: 'Far', boundary: 8 }, m)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-queued-label.test.ts`
Expected: FAIL — `Failed to resolve import "./session-host-queued-label"`.

- [ ] **Step 3: Write the pure helper**

Create `src/session/session-host-queued-label.ts`:

```ts
// The ring's caption target, recorded where the launch happens.
//
// It cannot be derived from lane states alone: a scene with a single lane in
// it looks exactly like a lone clip launch, and would get captioned with the
// clip's name instead of the scene's. So the launch sites record it.
//
// The record carries the boundary it was made against and is only honoured
// while that boundary is still the pending one. That makes it self-expiring:
// no stop/seek/undo seam has to remember to clear it.

import type { LanePlayState } from './session-runtime';

export interface QueuedLabel {
  label: string;
  boundary: number;
}

const EPS = 1e-6;

export function queuedLabelFor(
  rec: QueuedLabel | null,
  laneStates: Map<string, LanePlayState>,
): string | null {
  if (!rec) return null;
  let nearest = Infinity;
  for (const lp of laneStates.values()) {
    if (lp.queued && lp.queuedBoundary < nearest) nearest = lp.queuedBoundary;
  }
  if (nearest === Infinity) return null;
  return Math.abs(nearest - rec.boundary) <= EPS ? rec.label : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-queued-label.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Record the label at the three launch sites**

In `src/session/session-host.ts`, add the import:

```ts
import { queuedLabelFor, type QueuedLabel } from './session-host-queued-label';
```

Add the field next to `activeSceneIdx` (~line 69):

```ts
  /** Caption target for the countdown ring, recorded at the launch site and
   *  self-expiring: see session-host-queued-label.ts. */
  private queuedLabel: QueuedLabel | null = null;
```

Add these two methods next to `activeScene()` (~line 194):

```ts
  /** Record what the pending switch is heading to, for the countdown ring's
   *  caption. Called right AFTER a launch, so the boundary is already written. */
  markQueued(label: string): void {
    let nearest = Infinity;
    for (const lp of this.laneStates.values()) {
      if (lp.queued && lp.queuedBoundary < nearest) nearest = lp.queuedBoundary;
    }
    this.queuedLabel = nearest === Infinity ? null : { label, boundary: nearest };
  }

  /** One line under the ring: the pending target while a switch is queued,
   *  else the scene that is playing. */
  ringCaption(): string {
    const target = queuedLabelFor(this.queuedLabel, this.laneStates);
    if (target) return `→ ${target}`;
    return this.activeScene()?.name ?? '';
  }
```

In `launchClipAt`, immediately after the `launchClip(...)` call in the `else` branch (~line 168):

```ts
      this.markQueued(clip.name ?? lane.name ?? lane.id);
```

In `launchSceneAt`, immediately after the `launchScene(...)` call (~line 181):

```ts
    this.markQueued(scene.name ?? `Scene ${sceneIdx + 1}`);
```

In `src/session/session-host-callbacks.ts`, immediately after the `launchClip(...)` call at line ~86:

```ts
        self.markQueued(clip.name ?? lane.name ?? lane.id);
```

- [ ] **Step 6: Build and mount the ring**

In `src/session/session-host.ts`, add the import:

```ts
import { createSceneRing } from '../core/scene-ring';
```

In `renderWithMixer`, inside the `if (this.deps.volInput && …)` branch, build the ring before `buildMasterStrip` and pass it in:

```ts
      const sceneRing = createSceneRing({
        laneStates: () => this.laneStates,
        now: () => this.deps.ctx.currentTime,
        bpm: () => this.deps.seq.bpm,
        meter: () => this.deps.seq.meter,
        caption: () => this.ringCaption(),
      });
      this.registerMixerDisposable(sceneRing);
      row.appendChild(buildMasterStrip({
        volInput: this.deps.volInput,
        masterMeterAnalyser: this.deps.masterMeterAnalyser,
        masterStrip: this.deps.masterStrip,
        isFxOpen: () => this.masterFxOpen,
        onToggleFx: () => this.toggleMasterFx(),
        historyDeps: this.deps.historyDeps,
        registerDisposable: (d) => this.registerMixerDisposable(d),
        sceneRing,
      }));
```

- [ ] **Step 7: Typecheck and run the session suites**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `NO_COLOR=1 npx vitest run src/session/ src/core/`
Expected: PASS. If `session-host` suites fail, the cause is a fixture without `volInput`/`masterMeterAnalyser` — those skip the master strip branch entirely and must stay untouched.

- [ ] **Step 8: Commit**

```bash
git add src/session/session-host.ts src/session/session-host-callbacks.ts src/session/session-host-queued-label.ts src/session/session-host-queued-label.test.ts
git commit -F - <<'EOF'
feat(session): name where the pending switch is going

The ring can read its own timing off the lane states, but not its
caption: a one-lane scene is indistinguishable from a lone clip launch,
so deriving it would caption the scene with a clip's name. The three
launch sites record it instead.

The record carries the boundary it was made against and expires the
moment that boundary stops being the pending one, so no stop, seek or
undo seam has to remember to clear it.
EOF
```

- [ ] **Step 9: Rebase onto main**

```bash
git rebase main
```

---

### Task 5: Look at it

Automated tests do not check whether the thing matches what was approved. The spec makes visual parity an acceptance criterion, so this task is not optional.

**Files:** none — verification only.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS. A non-zero exit with `ERR_IPC_CHANNEL_CLOSED` *after* all tests pass is the known flaky teardown — re-run to confirm.

- [ ] **Step 2: Build, so the e2e suite is not testing a stale bundle**

Run: `npm run build`
Expected: typecheck clean, bundle written to `dist/`.

- [ ] **Step 3: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS, apart from the pre-existing failures already recorded on `main` (the 6 preset-load specs). Verify any failure reproduces on `main` before treating it as a regression.

- [ ] **Step 4: Look at it in a real browser**

Start the dev server in the worktree (`npm run dev`), open <http://localhost:5173> in **Chrome** (not the VS Code browser), then:

1. Load a demo or import a MIDI so several lanes hold clips of different lengths.
2. Session view → launch a scene with the row's named `▶ <SceneName>` button.
3. Confirm the ring sweeps grey in the master strip and the caption names the scene.
4. Launch a **second** scene. Confirm the ring turns amber and drains, the caption reads `→ <target>`, and it goes red inside the last bar.
5. Confirm the switch happens exactly when the wedge empties — this is the whole point of the feature.
6. Launch a single clip (a clip cell's own ▶). Confirm the ring counts that too.

- [ ] **Step 5: Screenshot and compare against the approved mockup**

Take a screenshot mid-countdown and put it side by side with
`docs/superpowers/specs/2026-08-07-scene-countdown-ring-mockup.html` (variant A).
Check: wedge direction (clockwise from 12), colour at each state, the number, the caption, and that the mixer row still lines up across every column.

Report what you saw. If it does not match the mockup, that is a defect to fix, not a difference to explain away.

- [ ] **Step 6: Commit any fixes, then finish the branch**

```bash
git rebase main
git checkout main
git merge --ff-only <branch>
```

Do **not** merge without asking first.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| Swept sector, 40 px, in the master strip | 2, 3 |
| Four states (silent / idle / armed / imminent) | 1, 2 |
| Colours from existing tokens; no blinking | 3 |
| Reads `queuedBoundary`, nearest wins | 1 |
| Lone clip launch counts too | 1 (test), 4 (caption) |
| `governingLoopSec` outlier rule inherited | 1 (test) |
| Fractional bars round up in the centre | 1 (`remainingText`) |
| Caption owned by the launch site (`queuedLabel`) | 4 |
| Pure logic / dumb widget split | 1, 2 |
| Shared RAF, `registerDisposable` teardown | 2, 4 |
| `.mix-name` 40 px in every column, alignment kept | 3 |
| Optional deps so audio-less fixtures survive | 3 |
| All 8 spec test cases | 1 (10 tests, spec's 8 plus monotonicity and cold start) |
| Visual parity against the mockup | 5 |

No gaps.

**Placeholder scan:** no TBD/TODO, no "add error handling", no "similar to Task N". Every code step carries the actual code.

**Type consistency:** `SceneCountdown` fields (`state`/`frac`/`bars`/`secsLeft`/`centerText`) are produced in Task 1 and consumed unchanged in Task 2. `SceneRingHandle` (`el`/`dispose`/`refresh`) is produced in Task 2 and consumed in Tasks 3 and 4 — the Task 3 test fixture implements all three members. `QueuedLabel` (`label`/`boundary`) is produced and consumed in Task 4. `markQueued`/`ringCaption` are defined once and called at the three sites listed.
