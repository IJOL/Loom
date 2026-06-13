# Editable Sparse Warp-Marker Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Ableton-style editable, sparse warp-marker editor on the imported drums clip so a 4/4 kick stays locked to the audio despite tempo drift.

**Architecture:** Reuse the dormant 2b-1 warp engine (`warpStretch`/`warpCache`/`collectWarpJobs` resync + `playAudioClip` warp path) unchanged. Add: a sparse drift-following seed, pure marker edit/propagate ops, two optional `ClipSample` fields (`warpGroupId`/`warpRef`), a DOM marker-editor layer mounted on the audio-clip waveform (only on the reference/drums clip), and import wiring that seeds markers + groups stems.

**Tech Stack:** TypeScript, Vite, Web Audio, Vitest (+ node-web-audio-api for DSP, jsdom-style DOM for editor tests).

**Spec:** [docs/superpowers/specs/2026-06-13-audio-warp-marker-editor-design.md](../specs/2026-06-13-audio-warp-marker-editor-design.md) · **Mockup:** [mockup.html](../specs/2026-06-13-audio-warp-marker-editor-mockup.html)

**Load-bearing invariant (do not break):** `warpStretch` maps `target(beat) = beat/lastBeat * gateSec`. For markers to land on the true grid, **the last marker's `beat` must equal the clip's total beats** (`lengthBars * beatsPerBar`) and the first must be `beat 0`. The seed and every edit must preserve both endpoints.

**Branch:** `feat/audio-warp` (worktree). Commit on the branch with the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT merge/push.

**Test commands:** `NO_COLOR=1 npx vitest run <file>` (single file), `npx tsc --noEmit` (typecheck), `npm run test:fast` (all but DSP), `NO_COLOR=1 npx vitest run <x>.dsp.test.ts` (DSP). Vitest may exit non-zero with `ERR_IPC_CHANNEL_CLOSED` AFTER green — that is a flaky teardown, judge by results.

---

## File Structure

- `src/session/session.ts` — add `ClipSample.warpGroupId?` + `warpRef?`; `audioChannelClip` passes them through. (modify)
- `src/session/stem-lane-builder.ts` — `buildStemAudioLane` accepts + forwards `warpGroupId`/`warpRef`. (modify)
- `src/samples/warp-seed-sparse.ts` — `seedSparseWarpMarkers` (pure). (create) · removes `src/samples/warp-seed.ts` (+ its test).
- `src/session/warp-marker-edit.ts` — pure `moveMarker`/`addMarker`/`deleteMarker`/`propagateWarp`. (create)
- `src/samples/warp-cache.ts` — add `invalidate(sampleId)`. (modify)
- `src/session/clip-editors/warp-marker-editor.ts` — the DOM marker layer (render + interactions + density/re-detect). (create)
- `src/session/clip-editors/clip-waveform-header.ts` — `renderAudioClipEditor`: amber Warp pill + mount the marker editor when `sample.warpRef`. (modify)
- `src/session/clip-editors/clip-editor-router.ts` — pass marker-editor deps (`onMarkersChange` → propagate + cache-invalidate + undo + redraw). (modify)
- `src/stems/stem-import.ts` + `src/session/session-host-callbacks.ts` — import seeds sparse markers, sets `warpRef` on the drums stem + a shared `warpGroupId`. (modify)

---

## Task 1: Model fields `warpGroupId` + `warpRef`

**Files:**
- Modify: `src/session/session.ts` (the `ClipSample` interface, ~line 47)

Additive optional fields, no schema bump. No failing test (pure type addition) — verify with `tsc`.

- [ ] **Step 1: Add the fields to `ClipSample`** (after `warpMarkers?`):

```ts
  /** Ableton-style warp markers (srcSec↔beat). When present + warp on, the clip
   *  plays a piecewise time-stretched buffer that locks each beat to the grid. */
  warpMarkers?: WarpMarker[];
  /** Stems separated from one import share this id, so a marker edit on the
   *  reference clip can propagate the same markers to every stem of the import. */
  warpGroupId?: string;
  /** This clip is the editable warp REFERENCE (the drums stem); only the
   *  reference clip shows the draggable marker editor. Absent ⇒ follower. */
  warpRef?: boolean;
```

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/session/session.ts
git commit -m "feat(warp): ClipSample.warpGroupId + warpRef for the marker editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `audioChannelClip` + `buildStemAudioLane` carry the new fields

**Files:**
- Modify: `src/session/session.ts` (`audioChannelClip`, ~line 174)
- Modify: `src/session/stem-lane-builder.ts`
- Test: `src/session/stem-lane-builder.test.ts`

- [ ] **Step 1: Write the failing test** (append to `stem-lane-builder.test.ts`):

```ts
  it('forwards warpGroupId + warpRef onto the clip sample', () => {
    const lane = buildStemAudioLane(stem, 'audio-stem-1', {
      bpm: 120, meter: METER, anchorSec: 0,
      warpMarkers: [{ srcSec: 0, beat: 0 }, { srcSec: 4, beat: 16 }],
      warpGroupId: 'grp-x', warpRef: true,
    });
    const s = lane.clips[0]!.sample!;
    expect(s.warpGroupId).toBe('grp-x');
    expect(s.warpRef).toBe(true);
    expect(s.warpMarkers).toHaveLength(2);
  });
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `NO_COLOR=1 npx vitest run src/session/stem-lane-builder.test.ts`. Expected: FAIL (opts type rejects `warpGroupId`/`warpRef`, fields undefined).

- [ ] **Step 3: Extend `audioChannelClip`** — add to its opts object (after `warpMarkers?`):

```ts
  warpMarkers?: import('./session').WarpMarker[];
  warpGroupId?: string;
  warpRef?: boolean;
```

and to the returned `sample` object (after the `warpMarkers` spread line):

```ts
      ...(opts.warpMarkers && opts.warpMarkers.length >= 2 ? { warpMarkers: opts.warpMarkers } : {}),
      ...(opts.warpGroupId ? { warpGroupId: opts.warpGroupId } : {}),
      ...(opts.warpRef ? { warpRef: true } : {}),
```

- [ ] **Step 4: Extend `buildStemAudioLane`** — add to its `opts` type and forward:

```ts
  opts: { bpm: number; meter: TimeSignature; anchorSec: number; warpMarkers?: import('./session').WarpMarker[]; warpGroupId?: string; warpRef?: boolean },
): SessionLane {
  const lane = emptyLane(id, 'audio');
  lane.name = stem.label;
  const hasWarp = !!opts.warpMarkers && opts.warpMarkers.length >= 2;
  lane.clips = [audioChannelClip({
    name: stem.label,
    sampleId: stem.sampleId,
    durationSec: stem.durationSec,
    originalBpm: opts.bpm,
    projectMeter: opts.meter,
    anchorSec: opts.anchorSec,
    warp: hasWarp,
    warpMarkers: opts.warpMarkers,
    warpGroupId: opts.warpGroupId,
    warpRef: opts.warpRef,
  })];
  return lane;
}
```

- [ ] **Step 5: Run the test, confirm PASS** — Run: `NO_COLOR=1 npx vitest run src/session/stem-lane-builder.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/session.ts src/session/stem-lane-builder.ts src/session/stem-lane-builder.test.ts
git commit -m "feat(warp): plumb warpGroupId/warpRef through audioChannelClip + buildStemAudioLane

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `seedSparseWarpMarkers` (pure, drift-following + sparse)

**Files:**
- Create: `src/samples/warp-seed-sparse.ts`
- Test: `src/samples/warp-seed-sparse.test.ts`
- Delete: `src/samples/warp-seed.ts` + `src/samples/warp-seed.test.ts` (nothing in production calls the per-beat seeder once import uses the sparse one — confirm with `grep -rn seedWarpMarkers src` after Task 12; for now leave the old file, remove in Task 12).

- [ ] **Step 1: Write the failing test** (`src/samples/warp-seed-sparse.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { seedSparseWarpMarkers } from './warp-seed-sparse';
import { DEFAULT_METER } from '../core/meter';

// A drifting beat grid: spacing wobbles around 0.5 s (≈120 BPM nominal).
function driftingBeats(n: number): number[] {
  const t = [0];
  for (let i = 0; i < n; i++) t.push(t[i] + 0.5 * (1 + 0.1 * Math.sin(i)));
  return t;
}

describe('seedSparseWarpMarkers', () => {
  const beats = driftingBeats(64);          // 65 beat times (beats 0..64)
  const duration = beats[64];

  it('produces one marker per N bars with pinned endpoints', () => {
    const m = seedSparseWarpMarkers(beats, 0, 120, duration, DEFAULT_METER, 4, 16);
    // 16 bars / 4 bars-per-marker = markers at beats 0,16,32,48,64
    expect(m.map((x) => x.beat)).toEqual([0, 16, 32, 48, 64]);
    expect(m[0].beat).toBe(0);
    expect(m[m.length - 1].beat).toBe(16 * 4); // == clipBars*beatsPerBar (invariant)
  });

  it('latches markers to the drifted onsets, not the regular grid', () => {
    const m = seedSparseWarpMarkers(beats, 0, 120, duration, DEFAULT_METER, 4, 16);
    const period0 = 0.5;
    for (const mk of m) {
      const actual = beats[mk.beat];
      const regular = mk.beat * period0;
      // closer to where the beat actually is than to the regular grid
      expect(Math.abs(mk.srcSec - actual)).toBeLessThanOrEqual(Math.abs(actual - regular) + 1e-6);
    }
  });

  it('keeps srcSec strictly increasing', () => {
    const m = seedSparseWarpMarkers(beats, 0, 120, duration, DEFAULT_METER, 4, 16);
    for (let i = 1; i < m.length; i++) expect(m[i].srcSec).toBeGreaterThan(m[i - 1].srcSec);
  });

  it('returns [] when less than one bar is available', () => {
    expect(seedSparseWarpMarkers([0, 0.5], 0, 120, 0.6, DEFAULT_METER, 4, 16)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `NO_COLOR=1 npx vitest run src/samples/warp-seed-sparse.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`src/samples/warp-seed-sparse.ts`):

```ts
// src/samples/warp-seed-sparse.ts
// Sparse, drift-following warp-marker seed. Stage 1 tracks every beat from the
// detected tempo, snapping to nearby onsets and letting the period drift so
// markers latch to where beats actually are. Stage 2 thins to one marker every
// `barsPerMarker` bars and PINS the endpoints (beat 0 and clipBars*beatsPerBar)
// so warpStretch's proportional mapping lands each marker on the grid.
import type { WarpMarker } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

export function seedSparseWarpMarkers(
  onsets: number[],
  downbeatSec: number,
  bpm: number,
  durationSec: number,
  meter: TimeSignature,
  barsPerMarker: number,
  clipBars: number,
): WarpMarker[] {
  const period0 = 60 / bpm;
  const bpb = Math.max(1, Math.round(quartersPerBar(meter)));
  if (!(period0 > 0) || !(durationSec > 0) || clipBars < 1) return [];
  const sorted = onsets.filter((o) => o >= 0).sort((a, b) => a - b);

  // Stage 1 — track every beat time, following drift.
  const beatTimes: number[] = [];
  let period = period0;
  let actual = Math.max(0, downbeatSec);
  beatTimes.push(actual);
  const lastBeat = clipBars * bpb;
  for (let beat = 1; beat <= lastBeat + bpb; beat++) {
    const predicted = actual + period;
    const tol = period * 0.5;
    let snapped = predicted, best = tol;
    for (const o of sorted) {
      const d = Math.abs(o - predicted);
      if (d < best) { best = d; snapped = o; }
    }
    const observed = snapped - actual;
    if (observed > period0 * 0.4 && observed < period0 * 1.6) {
      period = period * 0.5 + observed * 0.5; // blend toward observed spacing
    }
    actual = snapped > actual ? snapped : predicted;
    beatTimes.push(Math.min(actual, durationSec));
    if (actual >= durationSec) break;
  }
  if (beatTimes.length <= bpb) return []; // not even one bar tracked

  // Stage 2 — thin to one marker / barsPerMarker bars, pin endpoints.
  const stride = Math.max(1, Math.round(barsPerMarker)) * bpb;
  const markers: WarpMarker[] = [];
  let prevSrc = -Infinity;
  const push = (beat: number) => {
    const b = Math.min(beat, lastBeat);
    let src = beatTimes[Math.min(b, beatTimes.length - 1)];
    if (!(src > prevSrc)) src = prevSrc + period0 * 0.01;
    if (markers.length && markers[markers.length - 1].beat === b) return;
    markers.push({ srcSec: src, beat: b });
    prevSrc = src;
  };
  for (let beat = 0; beat < lastBeat; beat += stride) push(beat);
  push(lastBeat); // endpoint
  return markers.length >= 2 ? markers : [];
}
```

- [ ] **Step 4: Run the test, confirm PASS** — Run: `NO_COLOR=1 npx vitest run src/samples/warp-seed-sparse.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/samples/warp-seed-sparse.ts src/samples/warp-seed-sparse.test.ts
git commit -m "feat(warp): sparse drift-following warp-marker seed (default 1/4 bars)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Pure marker edit + propagate ops

**Files:**
- Create: `src/session/warp-marker-edit.ts`
- Test: `src/session/warp-marker-edit.test.ts`

- [ ] **Step 1: Write the failing test** (`src/session/warp-marker-edit.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { moveMarker, addMarker, deleteMarker, propagateWarp } from './warp-marker-edit';
import type { SessionState, WarpMarker } from './session';

const m = (): WarpMarker[] => [
  { srcSec: 0, beat: 0 }, { srcSec: 4, beat: 16 }, { srcSec: 8, beat: 32 },
];

describe('warp-marker-edit', () => {
  it('moveMarker clamps between neighbors', () => {
    expect(moveMarker(m(), 1, 99)[1].srcSec).toBeLessThan(8);   // clamped below next
    expect(moveMarker(m(), 1, -99)[1].srcSec).toBeGreaterThan(0); // clamped above prev
  });

  it('addMarker inserts sorted and dedupes', () => {
    const out = addMarker(m(), 6, 24);
    expect(out.map((x) => x.srcSec)).toEqual([0, 4, 6, 8]);
    expect(addMarker(m(), 4, 16)).toHaveLength(3); // duplicate beat → no-op
  });

  it('deleteMarker protects the endpoints', () => {
    expect(deleteMarker(m(), 1)).toHaveLength(2);  // interior removable
    expect(deleteMarker(m(), 0)).toHaveLength(3);  // first protected
    expect(deleteMarker(m(), 2)).toHaveLength(3);  // last protected
  });

  it('propagateWarp writes markers+warp to every clip in the group', () => {
    const mk = m();
    const state: SessionState = {
      lanes: [
        { id: 'a', engineId: 'audio', clips: [{ id: 'c1', lengthBars: 4, notes: [], sample: { sampleId: 's1', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'g1' } }] },
        { id: 'b', engineId: 'audio', clips: [{ id: 'c2', lengthBars: 4, notes: [], sample: { sampleId: 's2', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'g1' } }] },
        { id: 'c', engineId: 'audio', clips: [{ id: 'c3', lengthBars: 4, notes: [], sample: { sampleId: 's3', mode: 'loop', trimStart: 0, trimEnd: 8, warpGroupId: 'OTHER' } }] },
      ],
      scenes: [], globalQuantize: 'bar',
    };
    const ids = propagateWarp(state, 'g1', mk, true);
    expect(ids.sort()).toEqual(['s1', 's2']);
    expect(state.lanes[0].clips[0]!.sample!.warpMarkers).toHaveLength(3);
    expect(state.lanes[0].clips[0]!.sample!.warp).toBe(true);
    expect(state.lanes[2].clips[0]!.sample!.warpMarkers).toBeUndefined(); // other group untouched
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `NO_COLOR=1 npx vitest run src/session/warp-marker-edit.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`src/session/warp-marker-edit.ts`):

```ts
// src/session/warp-marker-edit.ts
// Pure operations over a clip's warp markers + propagation to grouped stems.
// Endpoints (first/last marker) are protected: their `beat` is the grid frame
// warpStretch normalizes against, so they must survive every edit.
import type { SessionState, WarpMarker } from './session';

const EPS = 1e-4;

export function moveMarker(markers: WarpMarker[], index: number, srcSec: number): WarpMarker[] {
  if (index < 0 || index >= markers.length) return markers;
  const lo = index > 0 ? markers[index - 1].srcSec : -Infinity;
  const hi = index < markers.length - 1 ? markers[index + 1].srcSec : Infinity;
  const clamped = Math.min(Math.max(srcSec, lo + EPS), hi - EPS);
  const next = markers.slice();
  next[index] = { ...markers[index], srcSec: clamped };
  return next;
}

export function addMarker(markers: WarpMarker[], srcSec: number, beat: number): WarpMarker[] {
  if (markers.some((x) => x.beat === beat || Math.abs(x.srcSec - srcSec) < EPS)) return markers;
  return [...markers, { srcSec, beat }].sort((a, b) => a.srcSec - b.srcSec);
}

export function deleteMarker(markers: WarpMarker[], index: number): WarpMarker[] {
  if (index <= 0 || index >= markers.length - 1) return markers; // endpoints protected
  return markers.filter((_, i) => i !== index);
}

/** Write `markers` (cloned) + `warp` onto every clip sample whose warpGroupId
 *  matches. Returns the affected sampleIds (for cache invalidation). */
export function propagateWarp(state: SessionState, groupId: string, markers: WarpMarker[], warp: boolean): string[] {
  const affected: string[] = [];
  for (const lane of state.lanes) {
    for (const clip of lane.clips) {
      const s = clip?.sample;
      if (!s || s.warpGroupId !== groupId) continue;
      s.warpMarkers = markers.map((x) => ({ ...x }));
      s.warp = warp;
      affected.push(s.sampleId);
    }
  }
  return affected;
}
```

- [ ] **Step 4: Run the test, confirm PASS** — Run: `NO_COLOR=1 npx vitest run src/session/warp-marker-edit.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/warp-marker-edit.ts src/session/warp-marker-edit.test.ts
git commit -m "feat(warp): pure marker move/add/delete + group propagate ops

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `warpCache.invalidate(sampleId)`

**Files:**
- Modify: `src/samples/warp-cache.ts`
- Test: `src/samples/warp-cache.test.ts`

- [ ] **Step 1: Write the failing test** (`src/samples/warp-cache.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { warpCache } from './warp-cache';

describe('warpCache.invalidate', () => {
  it('drops only the keys for the given sampleId', async () => {
    const buf = {} as AudioBuffer;
    await warpCache.ensure('s1|m|1.000', () => buf);
    await warpCache.ensure('s2|m|1.000', () => buf);
    warpCache.invalidate('s1');
    expect(warpCache.has('s1|m|1.000')).toBe(false);
    expect(warpCache.has('s2|m|1.000')).toBe(true);
    warpCache.clear();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `NO_COLOR=1 npx vitest run src/samples/warp-cache.test.ts`. Expected: FAIL (`invalidate` is not a function).

- [ ] **Step 3: Implement** — add to the `warpCache` object (before `clear`):

```ts
  invalidate(sampleId: string): void {
    const prefix = `${sampleId}|`;
    for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
    for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
  },
```

- [ ] **Step 4: Run the test, confirm PASS** — Run: `NO_COLOR=1 npx vitest run src/samples/warp-cache.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/samples/warp-cache.ts src/samples/warp-cache.test.ts
git commit -m "feat(warp): warpCache.invalidate(sampleId) for live re-render after edits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Marker editor layer — `warp-marker-editor.ts` (render + interactions)

**Files:**
- Create: `src/session/clip-editors/warp-marker-editor.ts`
- Test: `src/session/clip-editors/warp-marker-editor.test.ts`

A self-contained DOM overlay (absolutely positioned over the waveform). Source-time view: `x = srcSec / durationSec * width`. Markers are DOM divs (line + handle + label), so they are testable without canvas. It owns: render markers + faint grid + alternate segment shading + drift connectors; pointer drag (move), click-empty (add), right-click (delete); a toolbar (density select + ↻ Re-detectar). It calls `onMarkersChange(markers, warp)` for every committed change.

- [ ] **Step 1: Write the failing test** (`src/session/clip-editors/warp-marker-editor.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { mountWarpMarkerEditor } from './warp-marker-editor';
import { DEFAULT_METER } from '../../core/meter';
import type { WarpMarker } from '../session';

function makeHost(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800, configurable: true });
  document.body.appendChild(el);
  return el;
}

const markers: WarpMarker[] = [
  { srcSec: 0, beat: 0 }, { srcSec: 8, beat: 32 }, { srcSec: 16, beat: 64 },
];

describe('mountWarpMarkerEditor', () => {
  it('renders one handle per marker', () => {
    const host = makeHost();
    mountWarpMarkerEditor(host, {
      getMarkers: () => markers, durationSec: 16, meter: DEFAULT_METER, bpm: 120,
      clipBars: 16, barsPerMarker: 4, getOnsets: () => [], onMarkersChange: vi.fn(),
    });
    expect(host.querySelectorAll('.warp-marker').length).toBe(3);
  });

  it('right-click on an interior marker deletes it via onMarkersChange', () => {
    const host = makeHost();
    const onChange = vi.fn();
    mountWarpMarkerEditor(host, {
      getMarkers: () => markers, durationSec: 16, meter: DEFAULT_METER, bpm: 120,
      clipBars: 16, barsPerMarker: 4, getOnsets: () => [], onMarkersChange: onChange,
    });
    const interior = host.querySelectorAll('.warp-marker')[1] as HTMLElement;
    interior.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(2); // marker removed
  });

  it('changing density re-seeds and reports the new marker set', () => {
    const host = makeHost();
    const onChange = vi.fn();
    mountWarpMarkerEditor(host, {
      getMarkers: () => markers, durationSec: 16, meter: DEFAULT_METER, bpm: 120,
      clipBars: 16, barsPerMarker: 4,
      getOnsets: () => Array.from({ length: 65 }, (_, i) => i * 0.25), // 64 beats @0.25s
      onMarkersChange: onChange,
    });
    const sel = host.querySelector('.warp-density') as HTMLSelectElement;
    sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    // 1 marker/bar over 16 bars → endpoints included, more markers than the 4-bar set
    expect(onChange.mock.calls.at(-1)![0].length).toBeGreaterThan(3);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/warp-marker-editor.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`src/session/clip-editors/warp-marker-editor.ts`):

```ts
// src/session/clip-editors/warp-marker-editor.ts
// DOM overlay for editing warp markers on the audio-clip waveform (source-time
// view). Renders markers/grid/drift + a density/re-detect toolbar, and reports
// every committed change via onMarkersChange. Stateless w.r.t. the model: the
// host owns the markers (getMarkers) and applies edits in onMarkersChange.
import type { WarpMarker } from '../session';
import { quartersPerBar, type TimeSignature } from '../../core/meter';
import { moveMarker, addMarker, deleteMarker } from '../warp-marker-edit';
import { seedSparseWarpMarkers } from '../../samples/warp-seed-sparse';

export interface WarpMarkerEditorDeps {
  getMarkers: () => WarpMarker[];
  durationSec: number;
  meter: TimeSignature;
  bpm: number;
  clipBars: number;
  barsPerMarker: number;
  getOnsets: () => number[];                 // for Re-detectar / density
  onMarkersChange: (markers: WarpMarker[], warp: boolean) => void;
}
export interface WarpMarkerEditorHandle { redraw: () => void; }

const AMBER = '#f5a623', AMBER2 = '#ffc061', GREY = '#8a8a90';

export function mountWarpMarkerEditor(host: HTMLElement, deps: WarpMarkerEditorDeps): WarpMarkerEditorHandle {
  const bpb = Math.max(1, Math.round(quartersPerBar(deps.meter)));
  let barsPerMarker = deps.barsPerMarker;

  // toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'warp-toolbar';
  Object.assign(toolbar.style, { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', padding: '2px 0' });
  const dlbl = document.createElement('span'); dlbl.textContent = 'MARCAS'; dlbl.style.color = GREY;
  const sel = document.createElement('select'); sel.className = 'warp-density';
  for (const n of [1, 2, 4, 8]) {
    const o = document.createElement('option'); o.value = String(n); o.textContent = `cada ${n} compás${n > 1 ? 'es' : ''}`;
    if (n === barsPerMarker) o.selected = true; sel.appendChild(o);
  }
  const redetect = document.createElement('button'); redetect.className = 'warp-redetect'; redetect.textContent = '↻ Re-detectar';
  const count = document.createElement('span'); count.className = 'warp-count'; count.style.color = AMBER;
  toolbar.append(dlbl, sel, redetect, count);
  host.appendChild(toolbar);

  // marker overlay
  const layer = document.createElement('div'); layer.className = 'warp-layer';
  Object.assign(layer.style, { position: 'relative', height: '82px', background: '#0c0c12', userSelect: 'none' });
  host.appendChild(layer);

  const reseed = () => {
    const m = seedSparseWarpMarkers(deps.getOnsets(), 0, deps.bpm, deps.durationSec, deps.meter, barsPerMarker, deps.clipBars);
    if (m.length >= 2) deps.onMarkersChange(m, true);
  };
  sel.addEventListener('change', () => { barsPerMarker = Number(sel.value) || 4; reseed(); });
  redetect.addEventListener('click', reseed);

  const width = () => Math.max(320, host.clientWidth || 600);
  const xFor = (sec: number) => (sec / Math.max(0.001, deps.durationSec)) * width();
  const secFor = (x: number) => (x / width()) * deps.durationSec;
  const nearestOnset = (sec: number) => {
    let best = sec, d = deps.durationSec; for (const o of deps.getOnsets()) { const dd = Math.abs(o - sec); if (dd < d) { d = dd; best = o; } }
    return d < (60 / deps.bpm) * 0.5 ? best : sec;
  };

  function draw(): void {
    const w = width();
    const markers = deps.getMarkers();
    count.textContent = `${markers.length} marcas`;
    // clear marker children but keep nothing else
    [...layer.querySelectorAll('.warp-marker,.warp-grid,.warp-seg')].forEach((n) => n.remove());
    const H = layer.clientHeight || 82;
    // alternate segment shading
    for (let i = 0; i < markers.length - 1; i++) {
      const seg = document.createElement('div'); seg.className = 'warp-seg';
      Object.assign(seg.style, { position: 'absolute', top: '0', height: '100%', left: xFor(markers[i].srcSec) + 'px',
        width: (xFor(markers[i + 1].srcSec) - xFor(markers[i].srcSec)) + 'px',
        background: i % 2 ? 'rgba(245,166,35,0.05)' : 'rgba(63,208,201,0.04)', pointerEvents: 'none' });
      layer.appendChild(seg);
    }
    // faint per-bar grid (target positions)
    for (let bar = 0; bar <= deps.clipBars; bar++) {
      const gx = (bar / deps.clipBars) * w;
      const g = document.createElement('div'); g.className = 'warp-grid';
      Object.assign(g.style, { position: 'absolute', top: '0', height: '100%', left: gx + 'px', width: '1px',
        background: bar % 4 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)', pointerEvents: 'none' });
      layer.appendChild(g);
    }
    // markers
    markers.forEach((mk, i) => {
      const mx = xFor(mk.srcSec);
      const el = document.createElement('div'); el.className = 'warp-marker'; (el as HTMLElement).dataset.index = String(i);
      Object.assign(el.style, { position: 'absolute', top: '0', height: '100%', left: (mx - 4) + 'px', width: '9px', cursor: 'ew-resize' });
      const line = document.createElement('div');
      Object.assign(line.style, { position: 'absolute', left: '4px', top: '0', width: '2px', height: '100%', background: AMBER });
      const handle = document.createElement('div');
      Object.assign(handle.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0',
        borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `8px solid ${AMBER}` });
      const lbl = document.createElement('div'); lbl.textContent = String(Math.round(mk.beat / bpb) + 1);
      Object.assign(lbl.style, { position: 'absolute', left: '6px', top: '9px', fontSize: '9px', color: AMBER });
      el.append(line, handle, lbl);
      // drag (interior + endpoints move srcSec; beat unchanged)
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const onMove = (e: PointerEvent) => {
          const rect = layer.getBoundingClientRect();
          const next = moveMarker(deps.getMarkers(), i, secFor(e.clientX - rect.left));
          deps.onMarkersChange(next, true);
        };
        const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
        window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
      });
      // right-click delete (interior only; deleteMarker protects endpoints)
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const next = deleteMarker(deps.getMarkers(), i);
        if (next !== deps.getMarkers()) deps.onMarkersChange(next, true);
      });
      layer.appendChild(el);
    });
  }

  // click empty → add a marker (snap to onset; beat = nearest grid beat)
  layer.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('.warp-marker')) return;
    const rect = layer.getBoundingClientRect();
    const sec = nearestOnset(secFor(ev.clientX - rect.left));
    const beat = Math.round((sec / Math.max(0.001, deps.durationSec)) * deps.clipBars * bpb);
    const next = addMarker(deps.getMarkers(), sec, beat);
    if (next !== deps.getMarkers()) deps.onMarkersChange(next, true);
  });

  draw();
  return { redraw: draw };
}
```

- [ ] **Step 4: Run the test, confirm PASS** — Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/warp-marker-editor.test.ts`. Expected: PASS (3 tests). If jsdom lacks `setPointerCapture`/`PointerEvent`, the drag test is not exercised here (we test contextmenu + change + render); keep assertions as written.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/warp-marker-editor.ts src/session/clip-editors/warp-marker-editor.test.ts
git commit -m "feat(warp): editable warp-marker overlay (render + drag/add/delete + density)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Warp toggle → amber ON/OFF pill + mount the marker editor

**Files:**
- Modify: `src/session/clip-editors/clip-waveform-header.ts` (`renderAudioClipEditor`)
- Test: `src/session/clip-editors/clip-waveform-header.test.ts`

- [ ] **Step 1: Update the existing test** — the current test asserts the warp toggle text. Replace that assertion in `clip-waveform-header.test.ts` (the `'... shows the warp toggle ...'` test) so it checks the pill class + ON/OFF text:

```ts
    const pill = host.querySelector('.audio-clip-warp') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent === 'ON' || pill.textContent === 'OFF').toBe(true);
```

Add a new test that the marker editor mounts only for a `warpRef` clip:

```ts
  it('mounts the warp marker editor only when the clip sample is the warpRef', () => {
    const host = document.createElement('div');
    const clip = audioClip();
    clip.sample!.warpRef = true;
    clip.sample!.warpMarkers = [{ srcSec: 0, beat: 0 }, { srcSec: 4, beat: 16 }];
    renderAudioClipEditor(host, clip, DEFAULT_METER, { warp: { getOnsets: () => [], bpm: 120, onMarkersChange: () => {} } });
    expect(host.querySelector('.warp-layer')).toBeTruthy();

    const host2 = document.createElement('div');
    renderAudioClipEditor(host2, audioClip(), DEFAULT_METER, {}); // no warpRef
    expect(host2.querySelector('.warp-layer')).toBeNull();
  });
```

(Adjust `audioClip()` helper if needed so its sample has `mode`, `trimStart`, `trimEnd`.)

- [ ] **Step 2: Run it, confirm it fails** — Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-waveform-header.test.ts`. Expected: FAIL (pill class/text + `.warp-layer` absent).

- [ ] **Step 3: Implement** — in `renderAudioClipEditor`:

(a) Extend `AudioClipEditorDeps` with an optional `warp` dep:

```ts
export interface AudioClipEditorDeps {
  getPlayheadFrac?: () => number;
  gain?: { engine: SynthEngine; ctx: EngineUIContext };
  /** When present + the clip sample is the warpRef, mount the editable warp
   *  marker overlay. The host supplies onset detection + the BPM + the commit
   *  callback (propagate/cache-invalidate/undo live in the router). */
  warp?: {
    getOnsets: () => number[];
    bpm: number;
    onMarkersChange: (markers: import('../session').WarpMarker[], warp: boolean) => void;
  };
}
```

(b) Replace the `♺` button block with an amber pill:

```ts
  const warpBtn = document.createElement('button');
  warpBtn.className = 'audio-clip-warp';
  const refreshWarp = () => {
    const on = !!sample?.warp;
    warpBtn.textContent = on ? 'ON' : 'OFF';
    Object.assign(warpBtn.style, {
      background: on ? '#f5a623' : 'transparent', color: on ? '#000' : '#8a8a90',
      border: on ? 'none' : '1px solid #2c2c32', fontWeight: '700',
      padding: '3px 10px', borderRadius: '3px', cursor: 'pointer',
    } as Partial<CSSStyleDeclaration>);
  };
  warpBtn.addEventListener('click', () => { if (sample) { setAudioClipWarp(sample, !sample.warp); refreshWarp(); markerHandle?.redraw(); } });
  const warpLbl = document.createElement('span'); warpLbl.textContent = 'WARP'; warpLbl.style.color = '#8a8a90'; warpLbl.style.fontSize = '10px';
  refreshWarp();
  toolbar.append(warpLbl, warpBtn);
```

(c) After mounting the waveform header, mount the marker editor when `sample?.warpRef && deps.warp`:

```ts
  const headerHost = document.createElement('div');
  host.appendChild(headerHost);
  const header = mountWaveformHeader(headerHost, clip, meter, { getPlayheadFrac: deps.getPlayheadFrac });

  let markerHandle: { redraw: () => void } | undefined;
  if (sample?.warpRef && deps.warp) {
    const editorHost = document.createElement('div');
    host.appendChild(editorHost);
    const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
    markerHandle = mountWarpMarkerEditor(editorHost, {
      getMarkers: () => clip.sample?.warpMarkers ?? [],
      durationSec: (clip.sample ? clip.sample.trimEnd - clip.sample.trimStart : 0) || 1,
      meter, bpm: deps.warp.bpm, clipBars: clip.lengthBars, barsPerMarker: 4,
      getOnsets: deps.warp.getOnsets, onMarkersChange: deps.warp.onMarkersChange,
    });
  }
  return { redraw: () => { header.redraw(); markerHandle?.redraw(); } };
```

Add the imports at the top: `import { mountWarpMarkerEditor } from './warp-marker-editor';` and ensure `stepsPerBar, stepsPerBeat` are imported from `../../core/meter` (they already are). `markerHandle` must be declared before the warpBtn click handler uses it — hoist the `let markerHandle` declaration above the toolbar block (place `let markerHandle: { redraw: () => void } | undefined;` right after `const sample = clip.sample;`).

- [ ] **Step 4: Run the test, confirm PASS** — Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-waveform-header.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-waveform-header.ts src/session/clip-editors/clip-waveform-header.test.ts
git commit -m "feat(warp): amber Warp pill + mount the marker editor on the warpRef clip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Router wiring — onMarkersChange → propagate + invalidate + undo + redraw

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts` (the `isAudioClip` branch, ~line 138-156)

No new unit test (integration glue; covered by Task 7's mount test + the live acceptance). Implement + typecheck + smoke via the full `test:fast`.

- [ ] **Step 1: Build the `warp` dep in the audio-clip branch** — replace the `return renderAudioClipEditor(...)` line with:

```ts
    const warp = (clip.sample?.warpRef)
      ? {
          bpm: deps.seq.bpm,
          getOnsets: (): number[] => {
            const buf = clip.sample ? sampleCache.get(clip.sample.sampleId) : undefined;
            if (!buf) return [];
            return detectLoop(buf, deps.seq.meter).slicePointsSec;
          },
          onMarkersChange: (markers: WarpMarker[], on: boolean): void => {
            const apply = () => {
              const s = clip.sample; if (!s) return;
              s.warpMarkers = markers.map((m) => ({ ...m }));
              s.warp = on;
              const ids = s.warpGroupId
                ? propagateWarp(deps.sessionState!, s.warpGroupId, markers, on)
                : [s.sampleId];
              for (const id of ids) warpCache.invalidate(id);
            };
            if (deps.historyDeps) withUndo(deps.historyDeps, apply); else apply();
          },
        }
      : undefined;
    return renderAudioClipEditor(host, clip, deps.seq.meter, { getPlayheadFrac: playheadFrac, gain, warp });
```

- [ ] **Step 2: Add imports** at the top of `clip-editor-router.ts`:

```ts
import { detectLoop } from '../../samples/loop-analysis';
import { propagateWarp } from '../warp-marker-edit';
import { warpCache } from '../../samples/warp-cache';
import { withUndo } from '../../save/history-wiring';
import type { WarpMarker } from '../session';
```

(Verify `sampleCache` is already imported — the file uses it for the header. `withUndo`'s import path: confirm against an existing caller, e.g. `grep -rn "from '.*history-wiring'" src/session`. `deps.sessionState` and `deps.historyDeps` exist on `ClipEditorDeps` — confirm; they are used elsewhere in this file for the gain ctx.)

- [ ] **Step 3: Typecheck + fast suite** — Run: `npx tsc --noEmit` then `npm run test:fast`. Expected: clean + green (re-run once if `ERR_IPC_CHANNEL_CLOSED`).

- [ ] **Step 4: Commit**

```bash
git add src/session/clip-editors/clip-editor-router.ts
git commit -m "feat(warp): wire marker edits → propagate to group + invalidate cache + undo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Import — seed sparse markers, group the stems, mark the drums reference

**Files:**
- Modify: `src/stems/stem-import.ts`
- Modify: `src/session/session-host-callbacks.ts` (`onAddStemLanes`)
- Modify: `src/session/session-host.ts`, `src/session/session-ui.ts`, `src/session/stem-dialog.ts` (the `addStemLanes`/`onAddStemLanes` opts + stem-element types — add `warpGroupId` + per-stem `warpRef`)
- Test: `src/stems/stem-import.test.ts`

- [ ] **Step 1: Write the failing test** (append to `stem-import.test.ts`; reuse the existing `makeDeps`/stems/buffers helpers — a drums stem with energy + others):

```ts
  it('seeds sparse warp markers + sets warpRef on the drums stem + a shared group', async () => {
    const addStemLanes = vi.fn();
    // drums stem has audible energy so detectLoop yields onsets
    const deps = makeDeps(stems, buffers, { addStemLanes });
    await importStems(deps, file, { replace: true });
    const [lanesArg, opts] = addStemLanes.mock.calls[0] as [Array<{ label: string; warpRef?: boolean }>, { warpGroupId?: string; warpMarkers?: unknown[] }];
    expect(opts.warpGroupId).toBeTruthy();
    expect(opts.warpMarkers && opts.warpMarkers.length).toBeGreaterThanOrEqual(2);
    const drums = lanesArg.find((l) => /drum/i.test(l.label));
    expect(drums?.warpRef).toBe(true);                       // reference is the drums stem
    expect(lanesArg.filter((l) => l.warpRef).length).toBe(1); // exactly one reference
  });
```

(If the existing fixtures don't give the drums stem onsets, extend the helper so the drums buffer carries a few periodic transients — see `bufferPeak`/`hasEnergy`; the seed needs ≥2 markers. Keep assertions relative.)

- [ ] **Step 2: Run it, confirm it fails** — Run: `NO_COLOR=1 npx vitest run src/stems/stem-import.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement in `stem-import.ts`** — replace the tempo/anchor block + the `addStemLanes` call:

```ts
  let anchorSec = 0;
  let warpMarkers: WarpMarker[] | undefined;
  const tempoBuf = pickTempoBuffer(decoded);
  const meter = deps.getMeter?.() ?? DEFAULT_METER;
  if (tempoBuf && tempoBuf.length > 0 && tempoBuf.duration > 0) {
    const { originalBpm, slicePointsSec } = detectLoop(tempoBuf, meter);
    anchorSec = pickDownbeatAnchor(slicePointsSec);
    if (deps.setSessionBpm && cb.replace && Number.isFinite(originalBpm) && originalBpm > 0) {
      deps.setSessionBpm(originalBpm);
    }
    if (Number.isFinite(originalBpm) && originalBpm > 0) {
      const playable = Math.max(0.001, tempoBuf.duration - anchorSec);
      const clipBars = barCountFor(playable, originalBpm, meter);
      const m = seedSparseWarpMarkers(slicePointsSec, anchorSec, originalBpm, tempoBuf.duration, meter, 4, clipBars);
      if (m.length >= 2) warpMarkers = m;
    }
  }

  // Mark the drums stem as the editable warp reference (fallback: the longest
  // decoded stem — the same heuristic pickTempoBuffer uses).
  const refName = decoded.find((d) => d.plan.name === 'drums')?.plan.name
    ?? decoded.slice().sort((a, b) => b.buffer.duration - a.buffer.duration)[0]?.plan.name;
  const groupId = warpMarkers ? `warp:${lanes[0]?.sampleId ?? 'grp'}` : undefined;
  const taggedLanes = lanes.map((l, i) => ({ ...l, warpRef: !!warpMarkers && decoded[i].plan.name === refName }));

  deps.addStemLanes(taggedLanes, { replace: cb.replace, anchorSec, warpMarkers, warpGroupId: groupId });
```

Add imports to `stem-import.ts`:

```ts
import { seedSparseWarpMarkers } from '../samples/warp-seed-sparse';
import { barCountFor } from '../core/slice-clip';
```

Extend the `addStemLanes` dep signature (the `stems` element gains `warpRef?`, opts gains `warpGroupId?`):

```ts
  addStemLanes: (
    stems: { label: string; sampleId: string; durationSec: number; warpRef?: boolean }[],
    opts?: { replace?: boolean; anchorSec?: number; warpMarkers?: WarpMarker[]; warpGroupId?: string },
  ) => void;
```

- [ ] **Step 4: Thread the new opts through the host chain** — in `session-host.ts`, `session-ui.ts`, `stem-dialog.ts`, widen the `addStemLanes`/`onAddStemLanes` stem-element type with `warpRef?: boolean` and opts with `warpGroupId?: string` (mirror the signature above). In `session-host-callbacks.ts` `onAddStemLanes`, pass them to `buildStemAudioLane`:

```ts
      const build = (stem: { label: string; sampleId: string; durationSec: number; warpRef?: boolean }, id: string) =>
        buildStemAudioLane(stem, id, {
          bpm: seq.bpm, meter: seq.meter, anchorSec,
          warpMarkers: opts.warpMarkers, warpGroupId: opts.warpGroupId, warpRef: stem.warpRef,
        });
```

- [ ] **Step 5: Remove the dead per-beat seeder** — `grep -rn "seedWarpMarkers\b" src` (the old `warp-seed.ts`). If only `warp-seed.ts`/`warp-seed.test.ts` reference it, delete both: `git rm src/samples/warp-seed.ts src/samples/warp-seed.test.ts`.

- [ ] **Step 6: Run the test + typecheck** — Run: `NO_COLOR=1 npx vitest run src/stems/stem-import.test.ts` then `npx tsc --noEmit`. Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(warp): import seeds sparse markers + groups stems + drums is the warp reference

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Verify (full suite + DSP + build) and live-acceptance checklist

**Files:** none (verification only — do NOT change source).

- [ ] **Step 1: Typecheck** — Run: `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 2: Fast suite** — Run: `npm run test:fast`. Expected: green (re-run once if `ERR_IPC_CHANNEL_CLOSED` after green).

- [ ] **Step 3: Warp DSP test** — Run: `NO_COLOR=1 npx vitest run src/samples/warp-stretch.dsp.test.ts`. Expected: PASS (the engine is unchanged; confirms no regression).

- [ ] **Step 4: Build** — Run: `npm run build`. Expected: tsc + bundle clean.

- [ ] **Step 5: Live acceptance (MANDATORY human look — the spec's acceptance gate).** With the dev server + stem-service running, import the variable-tempo track and confirm, comparing against [the mockup](../specs/2026-06-13-audio-warp-marker-editor-mockup.html):
  - The **drums** clip (only) shows ~1 marker every 4 bars over the waveform; followers show no markers.
  - Add a 4/4 kick lane → with Warp ON the kick stays locked to the imported audio across the whole clip (the drift the user reported is gone).
  - Drag a marker → the two adjacent segments re-warp and the kick re-locks; right-click deletes an interior marker; density select + ↻ Re-detectar re-seed; the Warp pill toggles native vs warped.
  - Take a screenshot and eyeball parity with the mockup before declaring done.

- [ ] **Step 6:** Report results honestly (counts, build status, what the live check showed). Do NOT claim done on green tests alone.

---

## Self-review notes (author)

- **Spec coverage:** model fields (T1–2), sparse seed (T3), edit/propagate (T4), cache invalidation (T5), editor UI + interactions + density/re-detect (T6), Warp pill + mount gating (T7), live re-render/undo wiring (T8), import seeding/grouping/reference (T9), verification incl. mandatory visual (T10). All spec sections mapped.
- **Type consistency:** `WarpMarker {srcSec,beat}`, `WarpMarkerEditorDeps`, `propagateWarp(state,groupId,markers,warp)→string[]`, `seedSparseWarpMarkers(onsets,downbeatSec,bpm,durationSec,meter,barsPerMarker,clipBars)` used identically across tasks.
- **Invariant:** every seed/edit keeps endpoints (T3 pins `lastBeat=clipBars*bpb`; T4 `deleteMarker` protects ends; the editor never re-beats endpoints). T10/DSP guards the engine.
- **Risk to watch during impl:** `withUndo` import path and `ClipEditorDeps.sessionState/historyDeps` presence (Task 8 verifies before use); jsdom `PointerEvent` availability (Task 6 test avoids relying on drag).
