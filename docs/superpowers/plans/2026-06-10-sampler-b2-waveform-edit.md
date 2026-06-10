# Sampler B2 — Editable Sample Waveform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Sampler's "Selected sample" waveform panel editable — draggable trim (start/end) + loop region (start/end) per sample, played back for real.

**Architecture:** Three new per-pad fields (`sampleStart`, `sampleEnd`, `loopEnd`) added to the existing `PadParams` model (defaults preserve today's sound). A pure `samplePlaybackWindow()` turns params into AudioBufferSourceNode start args; the trigger uses it. The viewer gains draggable handles backed by pure `pickHandle`/`applyHandle`/`xToFrac` helpers, and writes changes through the existing `setBaseValue('zone<note>.<leaf>', v)` seam (which already persists + mirrors to session state).

**Tech Stack:** TypeScript, Web Audio (`AudioBufferSourceNode`), Canvas 2D, Vitest (+ `node-web-audio-api` for DSP), Playwright e2e.

**Spec:** [docs/superpowers/specs/2026-06-10-sampler-b2-waveform-edit-design.md](../specs/2026-06-10-sampler-b2-waveform-edit-design.md)

**Worktree note:** this branch needs `npm install` once before tests run (worktrees start without `node_modules`). All test commands assume the worktree root as cwd. Tests are colour-free via `NO_COLOR=1`.

---

### Task 1: Add trim + loopEnd fields to the per-pad model

**Files:**
- Modify: `src/engines/sampler-pad-params.ts`
- Test: `src/engines/sampler-pad-params.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/engines/sampler-pad-params.test.ts` inside the `describe('sampler pad params', …)` block:

```ts
  it('has trim + loop-end leaves with sound-preserving defaults', () => {
    expect(PAD_DEFAULTS.sampleStart).toBe(0);
    expect(PAD_DEFAULTS.sampleEnd).toBe(1);
    expect(PAD_DEFAULTS.loopEnd).toBe(1);
    const leaves = PAD_LEAF_SPECS.map((s) => s.leaf);
    expect(leaves).toContain('sampleStart');
    expect(leaves).toContain('sampleEnd');
    expect(leaves).toContain('loopEnd');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-pad-params.test.ts`
Expected: FAIL — `PAD_DEFAULTS.sampleStart` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/engines/sampler-pad-params.ts`, add the three fields to the `PadParams` interface (after `loopStart`):

```ts
  loopStart: number; // 0..1 of sample duration
  loopEnd: number;   // 0..1 of sample duration (paired with loopStart)
  sampleStart: number; // 0..1 — playback start (trim in)
  sampleEnd: number;   // 0..1 — playback end (trim out)
```

Add them to `PAD_DEFAULTS` (defaults reproduce today's behaviour exactly):

```ts
export const PAD_DEFAULTS: PadParams = {
  tune: 0, cutoff: 1, res: 0, attack: 0.005, decay: 0.08,
  level: 1, pan: 0, rev: 0, dly: 0, loop: 0, loopStart: 0, retrig: 0,
  loopEnd: 1, sampleStart: 0, sampleEnd: 1,
};
```

Add three entries to `PAD_LEAF_SPECS` (after the `loopStart` entry):

```ts
  { leaf: 'loopEnd',     label: 'LEND',   kind: 'continuous', min: 0, max: 1, default: 1 },
  { leaf: 'sampleStart', label: 'START',  kind: 'continuous', min: 0, max: 1, default: 0 },
  { leaf: 'sampleEnd',   label: 'END',    kind: 'continuous', min: 0, max: 1, default: 1 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-pad-params.test.ts`
Expected: PASS (all 8 tests, including the two existing ones that iterate the spec list).

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler-pad-params.ts src/engines/sampler-pad-params.test.ts
git commit -m "feat(sampler): add sampleStart/sampleEnd/loopEnd per-pad fields"
```

---

### Task 2: Pure playback-window function

**Files:**
- Create: `src/engines/sampler-playback-window.ts`
- Test: `src/engines/sampler-playback-window.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/engines/sampler-playback-window.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { samplePlaybackWindow } from './sampler-playback-window';
import { PAD_DEFAULTS } from './sampler-pad-params';

const pad = (over: Partial<typeof PAD_DEFAULTS> = {}) => ({ ...PAD_DEFAULTS, ...over });

describe('samplePlaybackWindow', () => {
  it('defaults play the whole buffer as a one-shot', () => {
    const w = samplePlaybackWindow(pad(), 2, 1);
    expect(w.offset).toBe(0);
    expect(w.duration).toBeCloseTo(2);
    expect(w.loop).toBe(false);
  });

  it('trim shrinks the window and offsets the start', () => {
    const w = samplePlaybackWindow(pad({ sampleStart: 0.5, sampleEnd: 0.75 }), 2, 1);
    expect(w.offset).toBeCloseTo(1);      // 0.5 * 2s
    expect(w.duration).toBeCloseTo(0.5);  // (0.75-0.5) * 2s
  });

  it('a faster playbackRate shortens the wall-clock duration', () => {
    const slow = samplePlaybackWindow(pad(), 2, 1).duration!;
    const fast = samplePlaybackWindow(pad(), 2, 2).duration!;
    expect(fast).toBeCloseTo(slow / 2);
  });

  it('loop uses [loopStart, loopEnd] in seconds and no fixed duration', () => {
    const w = samplePlaybackWindow(pad({ loop: 1, loopStart: 0.25, loopEnd: 0.75 }), 4, 1);
    expect(w.loop).toBe(true);
    expect(w.duration).toBeNull();
    expect(w.loopStart).toBeCloseTo(1); // 0.25 * 4
    expect(w.loopEnd).toBeCloseTo(3);   // 0.75 * 4
  });

  it('clamps a loop region to within the trim', () => {
    const w = samplePlaybackWindow(pad({ loop: 1, sampleStart: 0.2, sampleEnd: 0.6, loopStart: 0, loopEnd: 1 }), 10, 1);
    expect(w.loopStart).toBeGreaterThanOrEqual(2);  // >= sampleStart*dur
    expect(w.loopEnd).toBeLessThanOrEqual(6);       // <= sampleEnd*dur
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-playback-window.test.ts`
Expected: FAIL — module not found / `samplePlaybackWindow` is not a function.

- [ ] **Step 3: Write minimal implementation**

Create `src/engines/sampler-playback-window.ts`:

```ts
// src/engines/sampler-playback-window.ts
// Pure: resolve the AudioBufferSourceNode playback window from per-pad params.
// All *fraction* fields are 0..1 of the buffer duration. `rate` is the repitch
// playbackRate; a faster rate shortens the wall-clock duration of a one-shot.

import type { PadParams } from './sampler-pad-params';

export interface PlaybackWindow {
  offset: number;          // seconds into the buffer to start
  duration: number | null; // one-shot seconds, or null = play until stopped (loop)
  loop: boolean;
  loopStart: number;       // seconds
  loopEnd: number;         // seconds
}

export function samplePlaybackWindow(pad: PadParams, durationSec: number, rate: number): PlaybackWindow {
  const dur = Math.max(0, durationSec);
  const r = rate > 0 ? rate : 1;
  const s = Math.min(Math.max(pad.sampleStart, 0), 1);
  const e = Math.min(Math.max(pad.sampleEnd, 0), 1);
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  const loop = pad.loop > 0.5;
  const ls = Math.min(Math.max(pad.loopStart, lo), hi);
  const le = Math.min(Math.max(pad.loopEnd, lo), hi);
  return {
    offset: lo * dur,
    duration: loop ? null : Math.max(0, (hi - lo) * dur) / r,
    loop,
    loopStart: Math.min(ls, le) * dur,
    loopEnd: Math.max(ls, le) * dur,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-playback-window.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler-playback-window.ts src/engines/sampler-playback-window.test.ts
git commit -m "feat(sampler): pure samplePlaybackWindow (trim + loop → playback args)"
```

---

### Task 3: Trigger plays the trimmed window

**Files:**
- Modify: `src/engines/sampler.ts` (the `trigger` method, ~lines 138–174)
- Test: `src/engines/sampler-trim.dsp.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/engines/sampler-trim.dsp.test.ts`. It renders the same sample twice through the real engine + an `OfflineAudioContext`, once untrimmed and once with `sampleEnd: 0.5`, and asserts (relatively) that trimming reduces total energy:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createSamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';

// A 1s mono buffer of full-scale noise, registered in the cache under a fake id.
function makeNoise(ctx: BaseAudioContext, id: string): void {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.05) * 0.9;
  sampleCache.set(id, buf);
}

function rms(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / d.length);
}

async function renderWith(sampleEnd: number): Promise<number> {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  makeNoise(ctx, 'noise-1');
  const engine = createSamplerEngine();
  engine.init({ ctx, laneId: 'L', output: ctx.destination } as any);
  // single-zone keymap at note 60, full range
  engine.setKeymap([{ sampleId: 'noise-1', rootNote: 60, loNote: 0, hiNote: 127, gain: 1 }] as any);
  engine.setBaseValue('zone60.sampleEnd', sampleEnd);
  const v = engine.createVoice(ctx, ctx.destination);
  v.trigger(60, 0, { gateDuration: 1.0, velocity: 1 } as any);
  const out = await ctx.startRendering();
  return rms(out);
}

describe('Sampler trim (DSP, relative)', () => {
  it('trimming the sample end reduces total energy', async () => {
    const full = await renderWith(1.0);
    const half = await renderWith(0.5);
    expect(half).toBeLessThan(full); // less of the buffer plays → less energy
    expect(half).toBeGreaterThan(0); // but it still sounds
  });
});
```

> Adapt the `init`/`createVoice`/`setKeymap`/`trigger` calls to the engine's real
> signatures if they differ — mirror an existing `*.dsp.test.ts` (e.g.
> `src/engines/sampler.dsp.test.ts`) for the exact engine bootstrap + `KeymapEntry`
> shape, and reuse its helpers rather than re-inventing them.

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-trim.dsp.test.ts`
Expected: FAIL — `half` ≈ `full` because the trigger ignores `sampleEnd` (plays the whole buffer).

- [ ] **Step 3: Write minimal implementation**

In `src/engines/sampler.ts`, import the helper near the other engine imports:

```ts
import { samplePlaybackWindow } from './sampler-playback-window';
```

In `trigger`, replace the repitch + loop block (currently lines ~140–146) and the
`src.start(time, 0)` line (~172) so the window drives both. The block becomes:

```ts
    // repitch by key distance + per-pad TUNE semitones.
    const rate = repitchRate(midi, entry.rootNote, pad.tune);
    src.playbackRate.value = rate;
    const win = samplePlaybackWindow(pad, buf.duration, rate);
    if (win.loop) {
      src.loop = true;
      src.loopStart = win.loopStart;
      src.loopEnd = win.loopEnd;
    }
```

And the start/stop near the end of `trigger`:

```ts
    this.endTime = releaseAt + rel + 0.01;
    if (win.duration == null) src.start(time, win.offset);
    else src.start(time, win.offset, win.duration);
    src.stop(this.endTime);
    this.started = true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-trim.dsp.test.ts`
Expected: PASS.
Then regression-check the existing sampler DSP tests:
Run: `NO_COLOR=1 npx vitest run src/engines/sampler.dsp.test.ts src/engines/sampler-loop.dsp.test.ts`
Expected: PASS (defaults preserve prior behaviour).

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-trim.dsp.test.ts
git commit -m "feat(sampler): trigger plays the trimmed window + [loopStart,loopEnd]"
```

---

### Task 4: Pure waveform-edit helpers (hit-test + clamp + x→frac)

**Files:**
- Create: `src/engines/sampler-waveform-edit.ts`
- Test: `src/engines/sampler-waveform-edit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/engines/sampler-waveform-edit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { xToFrac, pickHandle, applyHandle, type TrimState } from './sampler-waveform-edit';

const base: TrimState = { sampleStart: 0.1, sampleEnd: 0.9, loopStart: 0.3, loopEnd: 0.7, loop: true };

describe('xToFrac', () => {
  it('maps clientX to a 0..1 fraction honouring scroll + scaled width', () => {
    expect(xToFrac(100, 50, 0, 200)).toBeCloseTo(0.25);   // (100-50)/200
    expect(xToFrac(100, 50, 100, 400)).toBeCloseTo(0.375);// (100-50+100)/400
  });
  it('clamps out-of-range to [0,1]', () => {
    expect(xToFrac(0, 50, 0, 200)).toBe(0);
    expect(xToFrac(9999, 50, 0, 200)).toBe(1);
  });
});

describe('pickHandle', () => {
  it('picks the nearest handle within tolerance', () => {
    expect(pickHandle(0.11, base, 0.03)).toBe('start');
    expect(pickHandle(0.89, base, 0.03)).toBe('end');
    expect(pickHandle(0.31, base, 0.03)).toBe('loopStart');
  });
  it('ignores loop handles when loop is off', () => {
    expect(pickHandle(0.31, { ...base, loop: false }, 0.03)).toBeNull();
  });
  it('returns null when nothing is within tolerance', () => {
    expect(pickHandle(0.5, base, 0.03)).toBeNull();
  });
});

describe('applyHandle', () => {
  it('drags start but never past end', () => {
    expect(applyHandle('start', 0.95, base).sampleStart).toBeLessThan(base.sampleEnd);
  });
  it('keeps the loop region inside the trim', () => {
    const s = applyHandle('loopStart', 0.0, base);
    expect(s.loopStart).toBeGreaterThanOrEqual(s.sampleStart);
  });
  it('clamps to [0,1]', () => {
    expect(applyHandle('start', -1, base).sampleStart).toBe(0);
    expect(applyHandle('end', 2, base).sampleEnd).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-waveform-edit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/engines/sampler-waveform-edit.ts`:

```ts
// src/engines/sampler-waveform-edit.ts
// Pure interaction helpers for the Selected-sample waveform: convert pointer x to
// a buffer fraction, pick the handle under the cursor, and apply a clamped drag.

export type WaveHandle = 'start' | 'end' | 'loopStart' | 'loopEnd';
export interface TrimState {
  sampleStart: number; sampleEnd: number; loopStart: number; loopEnd: number; loop: boolean;
}

const MIN_GAP = 0.005; // minimum width between paired handles (fraction)

/** clientX → fraction (0..1), honouring the canvas left edge, horizontal scroll
 *  and the zoom-scaled canvas width (all in CSS px). */
export function xToFrac(clientX: number, left: number, scrollLeft: number, canvasWidth: number): number {
  if (canvasWidth <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - left + scrollLeft) / canvasWidth));
}

/** Nearest editable handle within `tol`, or null. Loop handles only when loop on. */
export function pickHandle(frac: number, s: TrimState, tol: number): WaveHandle | null {
  const cands: Array<[WaveHandle, number]> = [['start', s.sampleStart], ['end', s.sampleEnd]];
  if (s.loop) cands.push(['loopStart', s.loopStart], ['loopEnd', s.loopEnd]);
  let best: WaveHandle | null = null;
  let bestD = tol;
  for (const [h, pos] of cands) {
    const d = Math.abs(frac - pos);
    if (d <= bestD) { bestD = d; best = h; }
  }
  return best;
}

/** Apply a drag of `handle` to `frac`, returning a new clamped state. */
export function applyHandle(handle: WaveHandle, frac: number, s: TrimState): TrimState {
  const f = Math.min(1, Math.max(0, frac));
  const n: TrimState = { ...s };
  switch (handle) {
    case 'start': n.sampleStart = Math.max(0, Math.min(f, s.sampleEnd - MIN_GAP)); break;
    case 'end':   n.sampleEnd = Math.min(1, Math.max(f, s.sampleStart + MIN_GAP)); break;
    case 'loopStart': n.loopStart = Math.min(Math.max(f, s.sampleStart), s.loopEnd - MIN_GAP); break;
    case 'loopEnd':   n.loopEnd = Math.max(Math.min(f, s.sampleEnd), s.loopStart + MIN_GAP); break;
  }
  n.loopStart = Math.min(Math.max(n.loopStart, n.sampleStart), n.sampleEnd);
  n.loopEnd = Math.min(Math.max(n.loopEnd, n.sampleStart), n.sampleEnd);
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-waveform-edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler-waveform-edit.ts src/engines/sampler-waveform-edit.test.ts
git commit -m "feat(sampler): pure waveform-edit helpers (xToFrac/pickHandle/applyHandle)"
```

---

### Task 5: Make the viewer interactive (handles, dim regions, clickable badge)

**Files:**
- Modify: `src/engines/sampler-sample-viewer.ts`

This task is DOM/canvas wiring (covered by the pure tests in Task 4 + the e2e in
Task 6). No new unit test; verify via build + the e2e.

- [ ] **Step 1: Extend the opts + draw handles**

In `src/engines/sampler-sample-viewer.ts`, extend `SampleViewerOpts`:

```ts
export interface SampleViewerOpts {
  sampleId: string;
  keyLabel: string;
  color: string;
  loop: boolean;
  loopStart: number;
  loopEnd: number;     // NEW
  sampleStart: number; // NEW
  sampleEnd: number;   // NEW
  /** Persist a fraction change for the selected pad. leaf ∈ the per-pad leaves. */
  onEdit?: (leaf: 'sampleStart' | 'sampleEnd' | 'loopStart' | 'loopEnd' | 'loop', value: number) => void; // NEW
}
```

Import the pure helpers at the top:

```ts
import { xToFrac, pickHandle, applyHandle, type TrimState, type WaveHandle } from './sampler-waveform-edit';
```

In `drawWave`, after the existing waveform paint, replace the loop-region block with
the four-handle render. Dim the trimmed-out regions, shade the loop band, draw handles,
and stamp the fractions onto `canvas.dataset` (the e2e reads these):

```ts
  const st = Math.min(Math.max(opts.sampleStart, 0), 1);
  const en = Math.min(Math.max(opts.sampleEnd, 0), 1);
  // dim trimmed-out regions
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, st * w, h);
  ctx.fillRect(en * w, 0, (1 - en) * w, h);
  // trim handles (amber)
  ctx.fillStyle = '#ffa726';
  ctx.fillRect(st * w - 1, 0, 2, h);
  ctx.fillRect(en * w - 1, 0, 2, h);
  // loop region (green) + its two handles, only when loop is on
  if (opts.loop) {
    const ls = Math.min(Math.max(opts.loopStart, 0), 1);
    const le = Math.min(Math.max(opts.loopEnd, 0), 1);
    ctx.fillStyle = 'rgba(124,179,66,0.20)';
    ctx.fillRect(ls * w, 0, (le - ls) * w, h);
    ctx.fillStyle = '#7cb342';
    ctx.fillRect(ls * w - 1, 0, 2, h);
    ctx.fillRect(le * w - 1, 0, 2, h);
  }
  canvas.dataset.sampleStart = st.toFixed(4);
  canvas.dataset.sampleEnd = en.toFixed(4);
  canvas.dataset.loopStart = String(opts.loopStart);
  canvas.dataset.loopEnd = String(opts.loopEnd);
  canvas.dataset.loop = opts.loop ? '1' : '0';
```

Delete the previous `if (opts.loop) { … loopStart … }` loop-region block that drew
only from `loopStart` to the end (it's replaced above).

- [ ] **Step 2: Add pointer dragging on the canvas**

After `requestAnimationFrame(draw);` in `renderSampleViewer`, wire pointer events.
`sc` is the scroll container; `canvas.width` is the zoom-scaled width:

```ts
  let dragging: WaveHandle | null = null;
  const stateNow = (): TrimState => ({
    sampleStart: opts.sampleStart, sampleEnd: opts.sampleEnd,
    loopStart: opts.loopStart, loopEnd: opts.loopEnd, loop: opts.loop,
  });
  const fracAt = (clientX: number): number => {
    const r = sc.getBoundingClientRect();
    return xToFrac(clientX, r.left, sc.scrollLeft, canvas.width);
  };
  canvas.style.cursor = 'pointer';
  canvas.addEventListener('pointerdown', (ev) => {
    const h = pickHandle(fracAt(ev.clientX), stateNow(), 0.02);
    if (!h) return;
    dragging = h;
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const next = applyHandle(dragging, fracAt(ev.clientX), stateNow());
    const leaf = dragging === 'start' ? 'sampleStart' : dragging === 'end' ? 'sampleEnd' : dragging;
    const value = next[leaf as keyof TrimState] as number;
    // update local opts so subsequent drags read the new value, then repaint
    (opts as Record<string, number>)[leaf] = value;
    draw();
    opts.onEdit?.(leaf, value);
  });
  const endDrag = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
```

- [ ] **Step 3: Make the one-shot/loop badge clickable**

Where the badge is built (`badge.textContent = opts.loop ? '⟳ loop' : 'one-shot'`),
make it a toggle:

```ts
  badge.style.cursor = 'pointer';
  badge.title = 'Click to toggle one-shot / loop';
  badge.addEventListener('click', () => {
    const next = opts.loop ? 0 : 1;
    opts.loop = next > 0.5;
    opts.onEdit?.('loop', next);
    draw();
    badge.textContent = opts.loop ? '⟳ loop' : 'one-shot';
    badge.classList.toggle('loop', opts.loop);
  });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. (Callers still pass the old opts shape → the next task supplies the
new fields; if tsc flags the call site, do Task 6 before re-running.)

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler-sample-viewer.ts
git commit -m "feat(sampler): draggable trim/loop handles + clickable loop badge in the viewer"
```

---

### Task 6: Wire the viewer to the pad store

**Files:**
- Modify: `src/engines/sampler.ts` (the `renderViewer` closure, ~lines 531–543)

- [ ] **Step 1: Pass the new fields + an onEdit that persists**

In `renderViewer`, extend the `renderSampleViewer({…})` call to pass the new opts and
an `onEdit` that writes through the existing `setBaseValue` seam (which already updates
`padStore` and mirrors to session state) and re-renders so the rack/viewer stay in sync:

```ts
        renderSampleViewer(viewerHost, {
          sampleId: entry.sampleId,
          keyLabel: noteName(note!),
          color: padColor(idx, this.keymap.length),
          loop: pad.loop >= 0.5,
          loopStart: pad.loopStart,
          loopEnd: pad.loopEnd,
          sampleStart: pad.sampleStart,
          sampleEnd: pad.sampleEnd,
          onEdit: (leaf, value) => {
            this.setBaseValue(`${padKeyForNote(note!)}.${leaf}`, value);
            if (this.onPadEdit) this.onPadEdit();
          },
        });
```

> `setBaseValue` already calls the pad-edit path; the explicit `onPadEdit()` is a
> belt-and-braces mirror. If `setBaseValue` already fires `onPadEdit` (check ~lines
> 340–358), drop the extra call to avoid a double mirror.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 3: Run the full unit suite (regression)**

Run: `npm run test:fast`
Expected: PASS (re-run once if it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` — known flaky teardown).

- [ ] **Step 4: Commit**

```bash
git add src/engines/sampler.ts
git commit -m "feat(sampler): wire viewer trim/loop edits to the per-pad store"
```

---

### Task 7: e2e — dragging changes the model

**Files:**
- Create: `tests/e2e/sampler-trim.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/sampler-trim.spec.ts`. It adds a Sampler lane, loads the bundled
Sweep-Pad preset, opens the inspector, and drags the start handle inward, asserting the
canvas `data-sample-start` grew from 0. (Mirror an existing spec, e.g.
`tests/e2e/sampler-audio.spec.ts`, for the exact lane-add + preset-load steps.)

```ts
import { test, expect } from '@playwright/test';

test('dragging the start handle trims the sample', async ({ page }) => {
  await page.goto('/');
  // add a Sampler lane
  await page.locator('.session-tabs-engine').selectOption('sampler');
  await page.locator('.session-tabs-add-btn').click();
  await page.getByRole('button', { name: /Sampler 1/i }).click();
  // load the bundled melodic preset
  await page.locator('#poly-preset-select').selectOption('sampler:melodic:sweep-pad');
  await page.getByRole('button', { name: /^LOAD$/ }).click();
  const canvas = page.locator('.ssv-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-sample-start', '0.0000');
  // drag the start handle (left edge) inward by ~20% of the canvas width
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const v = await canvas.getAttribute('data-sample-start');
  expect(Number(v)).toBeGreaterThan(0.1);
});
```

- [ ] **Step 2: Build, then run the e2e**

The e2e serves `dist/` with NO build step, so build first:

Run: `npm run build && npx playwright test tests/e2e/sampler-trim.spec.ts`
Expected: PASS.

> If the lane-add / preset-load selectors differ from the snapshot above, copy the
> working steps from `tests/e2e/sampler-audio.spec.ts` verbatim — that spec already
> drives `#poly-preset-select` + LOAD.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sampler-trim.spec.ts
git commit -m "test(sampler): e2e — dragging the trim handle updates the model"
```

---

### Task 8: Final verification + manual look

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npm run build && npm run test:fast && npm run test:dsp`
Expected: tsc 0, build OK, unit PASS, DSP PASS.

- [ ] **Step 2: Manual visual check (required for UI work)**

Start the worktree dev server on a free port: `npx vite --port 5180 --strictPort`.
Open it, add a Sampler lane, load Sweep Pad, and confirm by EYE against the mockup
([2026-06-10-sampler-b2-waveform-edit-mockup.png](../mockups/2026-06-10-sampler-b2-waveform-edit-mockup.png)):
- the four handles render on the waveform,
- dragging trim dims the cut regions and the sample audibly starts later / ends earlier on the keyboard,
- toggling the badge shows/hides the green loop band and a held note loops the region.

- [ ] **Step 3: Request code review**

Use superpowers:requesting-code-review before merge.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch (rebase onto main, `merge --ff-only`,
ExitWorktree).
