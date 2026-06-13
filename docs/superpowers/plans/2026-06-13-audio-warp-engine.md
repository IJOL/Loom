# Warp-Marker Engine (Phase 2b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Imported audio (stems) auto-warps to the sequencer grid — beats are detected and the audio is time-stretched **piecewise** so it stays locked to a 4/4 kick even when the recorded tempo drifts.

**Architecture:** A per-clip `WarpMarker[]` (srcSec↔beat) is auto-seeded from onsets. A pure `warpStretch` builds a grid-aligned buffer by OLA-stretching each beat segment to its target duration and concatenating with anti-click fades; it's cached (string-keyed by markers+gate, so playback needs no BPM) and re-rendered on tempo change. `playAudioClip` uses the warped buffer when markers are present. Stems import warp-on with seeded markers.

**Tech Stack:** TypeScript, Web Audio, OfflineAudioContext (DSP tests via node-web-audio-api), Vitest.

---

## File Structure

- `src/session/session.ts` — `WarpMarker` type + `ClipSample.warpMarkers`. *Modify.*
- `src/samples/warp-seed.ts` — **new** pure `seedWarpMarkers`. *Create.*
- `src/samples/warp-stretch.ts` — **new** piecewise OLA stretch (`warpStretch`) + `warpKey`. *Create.*
- `src/samples/warp-cache.ts` — **new** string-keyed buffer cache. *Create.*
- `src/engines/audio-clip-voice.ts` — `playAudioClip` uses the warped buffer. *Modify.*
- `src/app/warp-resync.ts` — **new** `collectWarpJobs`. *Create.*
- `src/app/bpm-broadcast.ts` — render warp jobs on tempo change. *Modify.*
- `src/session/session.ts` `audioChannelClip` + `src/session/stem-lane-builder.ts` + `src/stems/stem-import.ts` — seed markers + `warp:true` on import. *Modify.*

---

## Task 1: WarpMarker model + auto-seed

**Files:**
- Modify: `src/session/session.ts` (add the type + `ClipSample.warpMarkers`)
- Create: `src/samples/warp-seed.ts`
- Test: `src/samples/warp-seed.test.ts`

- [ ] **Step 1: Add the model to `src/session/session.ts`**

After the `LoopSlice` interface (near line 21), add:

```ts
export interface WarpMarker {
  srcSec: number;  // position in the SOURCE buffer (seconds)
  beat: number;    // musical beat it is pinned to (0-based; beat 0 = clip downbeat)
}
```

In `ClipSample` (after `gain?: number;`, line ~39) add:

```ts
  /** Ableton-style warp markers (srcSec↔beat). When present + warp on, the clip
   *  plays a piecewise time-stretched buffer that locks each beat to the grid. */
  warpMarkers?: WarpMarker[];
```

- [ ] **Step 2: Write the failing test**

```ts
// src/samples/warp-seed.test.ts
import { describe, it, expect } from 'vitest';
import { seedWarpMarkers } from './warp-seed';

describe('seedWarpMarkers', () => {
  it('latches each beat to a nearby onset (absorbs drift)', () => {
    // 120 BPM → 0.5 s/beat, downbeat at 0. Onsets DRIFT late: beat 2 at 1.06 s
    // (not 1.00). Marker for beat 2 should take the onset, not the regular grid.
    const onsets = [0.0, 0.5, 1.06, 1.5, 2.0];
    const m = seedWarpMarkers(onsets, 0, 120, 2.1);
    const beat2 = m.find((x) => x.beat === 2)!;
    expect(beat2.srcSec).toBeCloseTo(1.06, 2);   // snapped to the drifted onset
    expect(beat2.srcSec).not.toBeCloseTo(1.0, 2); // NOT the regular-grid time
  });
  it('falls back to the regular grid when no onset is near', () => {
    const m = seedWarpMarkers([0.0], 0, 120, 1.1); // only a downbeat onset
    expect(m.find((x) => x.beat === 2)!.srcSec).toBeCloseTo(1.0, 2); // regular 2*0.5
  });
  it('keeps srcSec strictly increasing and starts at the downbeat', () => {
    const m = seedWarpMarkers([0.2, 0.5, 1.0], 0.2, 120, 1.3);
    expect(m[0]).toEqual({ srcSec: 0.2, beat: 0 });
    for (let i = 1; i < m.length; i++) expect(m[i].srcSec).toBeGreaterThan(m[i - 1].srcSec);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/samples/warp-seed.test.ts`
Expected: FAIL — module `./warp-seed` not found.

- [ ] **Step 4: Implement `src/samples/warp-seed.ts`**

```ts
// src/samples/warp-seed.ts
// Auto-seed Ableton-style warp markers: a regular beat grid (from the detected
// tempo + downbeat) with each beat latched to the nearest onset within tolerance,
// so the markers track where the beats actually are and absorb tempo drift.
import type { WarpMarker } from '../session/session';

/** @param onsets detected onset times (s). @param downbeatSec beat-0 position.
 *  @param bpm detected tempo. @param durationSec source length. */
export function seedWarpMarkers(
  onsets: number[], downbeatSec: number, bpm: number, durationSec: number,
): WarpMarker[] {
  const beatSec = 60 / bpm;
  if (!(beatSec > 0) || !(durationSec > 0)) return [];
  const tol = beatSec * 0.5;
  const sorted = [...onsets].sort((a, b) => a - b);
  const markers: WarpMarker[] = [];
  let prevSrc = -Infinity;
  for (let beat = 0; ; beat++) {
    const expected = downbeatSec + beat * beatSec;
    if (expected > durationSec) break;
    // nearest onset within tolerance, else the regular-grid time
    let src = expected, bestD = tol;
    for (const o of sorted) {
      const d = Math.abs(o - expected);
      if (d < bestD) { bestD = d; src = o; }
    }
    // keep srcSec strictly increasing (a snap could collide / reorder)
    if (src <= prevSrc) src = Math.min(expected, prevSrc + beatSec * 0.01);
    if (src <= prevSrc) continue;
    markers.push({ srcSec: src, beat });
    prevSrc = src;
  }
  return markers;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/samples/warp-seed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)

```bash
git add src/session/session.ts src/samples/warp-seed.ts src/samples/warp-seed.test.ts
git commit -m "feat(warp): WarpMarker model + onset-snapped auto-seed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Piecewise stretch engine + cache

**Files:**
- Create: `src/samples/warp-cache.ts`
- Create: `src/samples/warp-stretch.ts`
- Test: `src/samples/warp-stretch.dsp.test.ts`

- [ ] **Step 1: Implement the string-keyed cache `src/samples/warp-cache.ts`**

```ts
// src/samples/warp-cache.ts
// In-memory cache of piecewise-warped AudioBuffers, keyed by a string (sampleId +
// markers + gate). Mirrors stretch-cache but string-keyed because a warp result
// depends on the whole marker set, not a single ratio. Never serialised.
const cache = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<void>>();

export const warpCache = {
  get(key: string): AudioBuffer | undefined { return cache.get(key); },
  has(key: string): boolean { return cache.has(key); },
  async ensure(key: string, render: () => AudioBuffer): Promise<void> {
    if (cache.has(key)) return;
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = (async () => { cache.set(key, render()); })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  },
  clear(): void { cache.clear(); inflight.clear(); },
};
```

- [ ] **Step 2: Write the failing DSP test**

```ts
// src/samples/warp-stretch.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { warpStretch, warpKey } from './warp-stretch';
import type { WarpMarker } from '../session/session';

const SR = 44100;

/** A buffer with a short click at each given time (seconds). */
function clickBuffer(ctx: BaseAudioContext, durationSec: number, clickSecs: number[]): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(durationSec * SR), SR);
  const d = buf.getChannelData(0);
  for (const t of clickSecs) {
    const s = Math.round(t * SR);
    for (let i = 0; i < 64 && s + i < d.length; i++) d[s + i] = 1;
  }
  return buf;
}
function onsetSecs(buf: AudioBuffer): number[] {
  const d = buf.getChannelData(0); const out: number[] = []; let last = -1;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > 0.3 && i - last > SR * 0.05) { out.push(i / SR); last = i; }
  }
  return out;
}

describe('warpStretch', () => {
  it('warps drifting beats onto an even grid', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(2 * SR), SR);
    // Source: beats DRIFT (0, 0.5, 1.06, 1.5) over ~2 s; we want them at the even
    // grid 0,0.5,1.0,1.5 (gate 2 s, 4 beats → 0.5 s/beat).
    const src = clickBuffer(ctx, 1.9, [0, 0.5, 1.06, 1.5]);
    const markers: WarpMarker[] = [
      { srcSec: 0, beat: 0 }, { srcSec: 0.5, beat: 1 },
      { srcSec: 1.06, beat: 2 }, { srcSec: 1.5, beat: 3 },
    ];
    const out = warpStretch(ctx, src, markers, 2.0);
    const beats = onsetSecs(out);
    // beat 2 was late (1.06) in the source; after warp it lands near 1.0.
    const near = beats.find((t) => Math.abs(t - 1.0) < 0.06);
    expect(near).toBeDefined();
    // and it is NOT still at ~1.06 (drift removed)
    expect(beats.some((t) => Math.abs(t - 1.06) < 0.02)).toBe(false);
  });

  it('warpKey is stable for the same markers+gate and differs otherwise', () => {
    const m: WarpMarker[] = [{ srcSec: 0, beat: 0 }, { srcSec: 0.5, beat: 1 }];
    expect(warpKey('s', m, 2)).toBe(warpKey('s', m, 2));
    expect(warpKey('s', m, 2)).not.toBe(warpKey('s', m, 3));
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/samples/warp-stretch.dsp.test.ts`
Expected: FAIL — module `./warp-stretch` not found.

- [ ] **Step 4: Implement `src/samples/warp-stretch.ts`**

```ts
// src/samples/warp-stretch.ts
// Piecewise OLA time-stretch driven by warp markers. Each segment between two
// markers is stretched (pitch-preserved, via stretchBuffer) so its END lands on
// the marker's grid time, then written into the output with a short equal-power
// crossfade at the seam to mask the join. Output length == gateSec (the clip's
// grid length in seconds), so the result drops straight into playback at rate 1.
import type { WarpMarker } from '../session/session';
import { stretchBuffer } from './timestretch';

const XFADE_SEC = 0.004;

/** Cache key: a warp result depends on the sample, the marker set, and the gate
 *  (which encodes lengthBars × tempo). */
export function warpKey(sampleId: string, markers: WarpMarker[], gateSec: number): string {
  const m = markers.map((x) => `${x.srcSec.toFixed(3)}:${x.beat}`).join(',');
  return `${sampleId}|${m}|${gateSec.toFixed(3)}`;
}

/** Copy buffer[startSec, endSec) into a fresh mono-or-multi buffer. */
function sliceSegment(ctx: BaseAudioContext, buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const s = Math.max(0, Math.round(startSec * sr));
  const e = Math.min(buffer.length, Math.round(endSec * sr));
  const len = Math.max(1, e - s);
  const out = ctx.createBuffer(buffer.numberOfChannels, len, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(s, e));
  }
  return out;
}

export function warpStretch(
  ctx: BaseAudioContext, buffer: AudioBuffer, markers: WarpMarker[], gateSec: number,
): AudioBuffer {
  const sr = buffer.sampleRate;
  const lastBeat = markers.length ? markers[markers.length - 1].beat : 0;
  const outLen = Math.max(1, Math.round(gateSec * sr));
  const out = ctx.createBuffer(buffer.numberOfChannels, outLen, sr);
  if (markers.length < 2 || lastBeat <= 0) return out;

  const targetSec = (beat: number) => (beat / lastBeat) * gateSec;
  const xf = Math.max(1, Math.round(XFADE_SEC * sr));

  for (let i = 0; i < markers.length - 1; i++) {
    const a = markers[i], b = markers[i + 1];
    const srcDur = Math.max(1 / sr, b.srcSec - a.srcSec);
    const outDur = Math.max(1 / sr, targetSec(b.beat) - targetSec(a.beat));
    const ratio = outDur / srcDur;
    const seg = stretchBuffer(ctx, sliceSegment(ctx, buffer, a.srcSec, b.srcSec), ratio);
    const off = Math.round(targetSec(a.beat) * sr);
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const o = out.getChannelData(ch);
      const sBuf = seg.getChannelData(Math.min(ch, seg.numberOfChannels - 1));
      for (let j = 0; j < sBuf.length; j++) {
        const di = off + j;
        if (di < 0 || di >= outLen) continue;
        // equal-power fade in/out over xf samples at the segment ends so adjacent
        // segments sum smoothly at the seam.
        let g = 1;
        if (i > 0 && j < xf) g = Math.sin((j / xf) * (Math.PI / 2));
        if (i < markers.length - 2 && j > sBuf.length - xf) g = Math.sin(((sBuf.length - j) / xf) * (Math.PI / 2));
        o[di] += sBuf[j] * g;
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/samples/warp-stretch.dsp.test.ts`
Expected: PASS (2 tests). (If the onset tolerance is borderline, the assertion uses a relative 0.06 s window — do NOT tighten it; OLA shifts transients by up to a window.)

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)

```bash
git add src/samples/warp-cache.ts src/samples/warp-stretch.ts src/samples/warp-stretch.dsp.test.ts
git commit -m "feat(warp): piecewise OLA warp-stretch + warp-cache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Playback — use the warped buffer

**Files:**
- Modify: `src/engines/audio-clip-voice.ts` (`playAudioClip`, lines 27–64)

- [ ] **Step 1: Add the warp path to `playAudioClip`**

Add imports near the top of `src/engines/audio-clip-voice.ts`:

```ts
import { warpCache } from '../samples/warp-cache';
import { warpStretch, warpKey } from '../samples/warp-stretch';
```

Replace the buffer-selection block (currently lines 36–49, from `const src = ctx.createBufferSource();` through the closing `}` of the `else` that handles `wantStretch`) with:

```ts
  const src = ctx.createBufferSource();
  const markers = sample.warpMarkers;
  const wantWarp = !!sample.warp && !!markers && markers.length >= 2;
  const warped = wantWarp ? warpCache.get(warpKey(sample.sampleId, markers!, gate)) : undefined;
  const wantStretch = sample.mode === 'loop' && sample.warp && sample.warpMode === 'stretch';
  const ratio = gate / region;
  const stretched = !wantWarp && wantStretch ? stretchCache.get(sample.sampleId, ratio) : undefined;
  if (warped) {
    src.buffer = warped;          // already grid-aligned, fills the gate
    src.playbackRate.value = 1;
  } else if (stretched) {
    src.buffer = stretched;
    src.playbackRate.value = 1;
  } else {
    src.buffer = buf;
    src.playbackRate.value = sample.mode === 'loop' ? region / gate : 1;
    if (wantWarp) {
      // render the warped buffer for next time (markers present but not cached yet)
      void warpCache.ensure(warpKey(sample.sampleId, markers!, gate), () => warpStretch(ctx, buf, markers!, gate));
    } else if (wantStretch) {
      void stretchCache.ensure(sample.sampleId, ratio, () => stretchBuffer(ctx, buf, ratio));
    }
  }
  src.connect(dest);
```

Then update the `src.start` line (was line 62) so a warped/stretched buffer starts at 0 (it already begins at the downbeat), else at `trimStart`:

```ts
  src.start(time, (warped || stretched) ? 0 : trimStart);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run the audio DSP + clip-voice-adjacent tests (regression)**

Run: `NO_COLOR=1 npx vitest run src/engines/audio.dsp.test.ts src/samples/warp-stretch.dsp.test.ts`
Expected: PASS (existing audio render tests still green; warp test green).

- [ ] **Step 4: Commit**

```bash
git add src/engines/audio-clip-voice.ts
git commit -m "feat(warp): playAudioClip plays the warped buffer when markers present

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Re-render warp on tempo change

**Files:**
- Create: `src/app/warp-resync.ts`
- Test: `src/app/warp-resync.test.ts`
- Modify: `src/app/bpm-broadcast.ts` (`resyncStretches`, lines 41–54)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/warp-resync.test.ts
import { describe, it, expect } from 'vitest';
import { collectWarpJobs } from './warp-resync';
import type { SessionState } from '../session/session';

const meter = { num: 4, den: 4 } as const;

function stateWithWarpClip(): SessionState {
  return {
    lanes: [{ id: 'audio-1', engineId: 'audio', clips: [{
      id: 'c1', lengthBars: 2, notes: [],
      sample: { sampleId: 's1', mode: 'loop', warp: true, trimStart: 0, trimEnd: 4,
        warpMarkers: [{ srcSec: 0, beat: 0 }, { srcSec: 2, beat: 8 }] },
    }] }],
    scenes: [], globalQuantize: '1/1',
  } as unknown as SessionState;
}

describe('collectWarpJobs', () => {
  it('emits a job (sampleId, markers, gate) for a warp-marker clip; gate scales with bpm', () => {
    const s = stateWithWarpClip();
    const at120 = collectWarpJobs(s, 120, meter);
    expect(at120).toHaveLength(1);
    // 2 bars × 4 beats × (60/120)=0.5 s = 4 s
    expect(at120[0].gate).toBeCloseTo(4, 3);
    expect(at120[0].sampleId).toBe('s1');
    const at140 = collectWarpJobs(s, 140, meter);
    expect(at140[0].gate).toBeLessThan(at120[0].gate); // faster tempo → shorter gate
  });
  it('ignores clips without warpMarkers', () => {
    const s = stateWithWarpClip();
    s.lanes[0].clips[0]!.sample!.warpMarkers = undefined;
    expect(collectWarpJobs(s, 120, meter)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/app/warp-resync.test.ts`
Expected: FAIL — module `./warp-resync` not found.

- [ ] **Step 3: Implement `src/app/warp-resync.ts`**

```ts
// src/app/warp-resync.ts
// Enumerate the warp re-render jobs implied by the session + tempo, so the BPM
// broadcaster can re-render+cache the piecewise-warped buffers. Pure.
import type { SessionState, WarpMarker } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

export interface WarpJob { sampleId: string; markers: WarpMarker[]; gate: number; }

export function collectWarpJobs(state: SessionState, bpm: number, meter: TimeSignature): WarpJob[] {
  const jobs: WarpJob[] = [];
  const secPerBeat = 60 / bpm;
  for (const lane of state.lanes) {
    for (const clip of lane.clips) {
      const s = clip?.sample;
      if (!s || !s.warp || !s.warpMarkers || s.warpMarkers.length < 2) continue;
      const gate = clip!.lengthBars * quartersPerBar(meter) * secPerBeat;
      jobs.push({ sampleId: s.sampleId, markers: s.warpMarkers, gate });
    }
  }
  return jobs;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/app/warp-resync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into `resyncStretches` in `src/app/bpm-broadcast.ts`**

Add imports near the top:

```ts
import { collectWarpJobs } from './warp-resync';
import { warpCache } from '../samples/warp-cache';
import { warpStretch, warpKey } from '../samples/warp-stretch';
```

Inside the `resyncStretches` setTimeout body (after the existing stretch-jobs loop, before the `}, 120)`), add:

```ts
      for (const job of collectWarpJobs(state, bpm, deps.seq.meter)) {
        const buf = sampleCache.get(job.sampleId);
        if (!buf) continue;
        void warpCache.ensure(warpKey(job.sampleId, job.markers, job.gate), () => warpStretch(deps.ctx!, buf, job.markers, job.gate));
      }
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)
Run: `NO_COLOR=1 npx vitest run src/app/warp-resync.test.ts` (expect PASS)

```bash
git add src/app/warp-resync.ts src/app/warp-resync.test.ts src/app/bpm-broadcast.ts
git commit -m "feat(warp): re-render warped buffers on tempo change

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Import — stems auto-warp with seeded markers

**Files:**
- Modify: `src/session/session.ts` (`audioChannelClip` — accept `warpMarkers`)
- Modify: `src/session/stem-lane-builder.ts` (pass markers, warp on)
- Modify: `src/stems/stem-import.ts` (seed markers from onsets; pass through `addStemLanes`)
- Test: extend `src/stems/stem-import.test.ts`

- [ ] **Step 1: `audioChannelClip` accepts warp markers**

In `src/session/session.ts` `audioChannelClip` opts, add:

```ts
  warpMarkers?: import('./session').WarpMarker[];
```

(`WarpMarker` is declared in this same file, so the inline import resolves to it.) In the returned `sample` object, after `gain: 1,` add:

```ts
      ...(opts.warpMarkers && opts.warpMarkers.length >= 2 ? { warpMarkers: opts.warpMarkers } : {}),
```

And change the default `warp` for a marker-carrying clip: where `const warp = opts.warp ?? true;` already exists, leave it — the stem builder passes `warp: true` explicitly (Step 2).

- [ ] **Step 2: `buildStemAudioLane` passes markers + warp on**

In `src/session/stem-lane-builder.ts`, extend the `opts` param and the `audioChannelClip` call:

```ts
export function buildStemAudioLane(
  stem: { label: string; sampleId: string; durationSec: number },
  id: string,
  opts: { bpm: number; meter: TimeSignature; anchorSec: number; warpMarkers?: import('./session').WarpMarker[] },
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
    warp: hasWarp,            // auto-warp ON when we have markers
    warpMarkers: opts.warpMarkers,
  })];
  return lane;
}
```

- [ ] **Step 3: `importStems` seeds markers + threads them**

In `src/stems/stem-import.ts`:

(a) Add the import:

```ts
import { seedWarpMarkers } from '../samples/warp-seed';
import type { WarpMarker } from '../session/session';
```

(b) Widen the `addStemLanes` dep opts (in `StemImportDeps`) to carry markers:

```ts
  addStemLanes: (
    stems: { label: string; sampleId: string; durationSec: number }[],
    opts?: { replace?: boolean; anchorSec?: number; warpMarkers?: WarpMarker[] },
  ) => void;
```

(c) In the detect block (where `detectLoop` runs and `anchorSec` is computed), also seed markers and pass them. Replace the detect+addStemLanes section with:

```ts
  let anchorSec = 0;
  let warpMarkers: WarpMarker[] | undefined;
  const tempoBuf = pickTempoBuffer(decoded);
  if (tempoBuf && tempoBuf.length > 0 && tempoBuf.duration > 0) {
    const meter = deps.getMeter?.() ?? DEFAULT_METER;
    const { originalBpm, slicePointsSec } = detectLoop(tempoBuf, meter);
    anchorSec = pickDownbeatAnchor(slicePointsSec);
    if (Number.isFinite(originalBpm) && originalBpm > 0) {
      warpMarkers = seedWarpMarkers(slicePointsSec, anchorSec, originalBpm, tempoBuf.duration);
      if (deps.setSessionBpm && cb.replace) deps.setSessionBpm(originalBpm);
    }
  }

  deps.addStemLanes(lanes, { replace: cb.replace, anchorSec, warpMarkers });
```

- [ ] **Step 4: Thread `warpMarkers` through the lane builder call**

In `src/session/session-host-callbacks.ts` `onAddStemLanes`, the opts type and the `build` call need the markers. Update the opts type to `{ replace?: boolean; anchorSec?: number; warpMarkers?: import('./session').WarpMarker[] }` and the `build` closure:

```ts
      const build = (stem: { label: string; sampleId: string; durationSec: number }, id: string) =>
        buildStemAudioLane(stem, id, { bpm: seq.bpm, meter: seq.meter, anchorSec, warpMarkers: opts.warpMarkers });
```

(`SessionHost.addStemLanes` and `StemDialogDeps.addStemLanes` opts types must also gain `warpMarkers?` — `tsc` will flag them; widen to match.)

- [ ] **Step 5: Extend the import test**

Add to `src/stems/stem-import.test.ts` (reuse the existing `pulseBuffer`, `makeDeps`, fetch/decode stubs):

```ts
describe('importStems → warp markers', () => {
  it('seeds warpMarkers and passes them to addStemLanes (auto-warp)', async () => {
    const addStemLanes = vi.fn();
    const stems = [{ name: 'drums', url: '/d' }];
    const buffers = { 'http://svc/d': pulseBuffer(120, 4) }; // steady 120 BPM pulse
    const deps = makeDeps(stems, buffers, { addStemLanes });
    await importStems(deps, new File([], 'song.wav'), { replace: true });
    const opts = addStemLanes.mock.calls[0][1] as { warpMarkers?: unknown[] };
    expect(Array.isArray(opts.warpMarkers)).toBe(true);
    expect(opts.warpMarkers!.length).toBeGreaterThan(4); // several beats over 4 bars
  });
});
```

- [ ] **Step 6: Run the import test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-import.test.ts` (expect PASS, all cases incl. the new one)
Run: `npx tsc --noEmit` (expect exit 0)

- [ ] **Step 7: Commit**

```bash
git add src/session/session.ts src/session/stem-lane-builder.ts src/stems/stem-import.ts src/session/session-host-callbacks.ts src/stems/stem-import.test.ts
git commit -m "feat(warp): stems import auto-warped with seeded markers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification + live acceptance

- [ ] **Step 1: Typecheck + fast suite + the DSP test**

Run: `npx tsc --noEmit` (expect exit 0)
Run: `npm run test:fast` (expect all green; flaky `ERR_IPC_CHANNEL_CLOSED` after green → re-run once)
Run: `NO_COLOR=1 npx vitest run src/samples/warp-stretch.dsp.test.ts` (it's a `.dsp.test.ts`, excluded from test:fast — run explicitly; expect PASS)

- [ ] **Step 2: Live acceptance**

`npm run dev`, stem-service on :8765, import the variable-tempo track (Replace). Confirm:
- Add a Drums lane with a 4/4 kick, play → the stems **stay locked to the kick well past bar 3–4** (the drift the user reported is gone).
- Toggle a stem clip's **Warp off** → it returns to native (drifting) playback; on again → re-locked.
- Change the project BPM → after a moment the stems re-warp and stay locked (resync).

This step is **manual** (audible) and is the real acceptance gate per the spec.

---

## Self-review notes

- **No BPM in playback:** the warp-cache key uses `gate` (which already encodes lengthBars×tempo), so `playAudioClip` — which has `gate` but not `bpm` — computes the same key the resync renders under. Keep `warpKey` identical in both.
- **First-trigger latency:** if the warped buffer isn't cached yet at the first trigger, playback falls back (native/uniform) for that trigger and `ensure()` renders it for the next. The tempo broadcast on import (setSessionBpm) plus the resync warm most cases; a one-loop fallback is acceptable for 2b-1.
- **Out of scope (2b-2):** the draggable marker UI. The model + engine here already store markers and re-render on demand, so 2b-2 is UI + an edit→re-warp hook.
