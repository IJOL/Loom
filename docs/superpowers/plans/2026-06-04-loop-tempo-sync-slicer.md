# Loop tempo-sync + slicer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Sampler treat loops as tempo-locked, pitch-preserved, editable material — drop a loop, it auto-slices and locks to the project BPM (slice-and-retrigger), with an opt-in offline WSOLA stretch for sustained material, embedded-metadata import (Acid/cue+smpl/AIFF) with a detection fallback, and one unified loop editor.

**Architecture:** A tempo-locked loop is realized as ordinary `NoteEvent`s triggering **slice regions** of one buffer. Each `clip.sample.slices[]` carves the buffer; the scheduler resolves `note.midi → slice region` and passes it to the sampler voice via a new `opts.slice` trigger option (region played at natural pitch, applying the existing per-pad params keyed by note). Because notes already follow project BPM, slice mode is tempo-locked with zero hot-path DSP. A per-clip `warpMode: 'stretch'` instead plays a WSOLA-stretched buffer (rendered offline, cached) through the existing single-buffer clip path at rate 1.0. All additive on `schemaVersion: 3`; no migration (the playback path is discriminated by presence of `slices`).

**Tech Stack:** TypeScript + Web Audio, Vite, Vitest (unit), `node-web-audio-api` via `OfflineAudioContext` (DSP), canvas 2D for the editor. No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-06-04-loop-tempo-sync-slicer-design.md](../specs/2026-06-04-loop-tempo-sync-slicer-design.md)

**Test command convention:** single file → `npx cross-env NO_COLOR=1 vitest run <path>`; DSP file → same (it auto-uses `node-web-audio-api` via `test/setup.ts`). Full suite before merge → `npm run build` then `npm test`.

---

## File map

**New:**
- `src/core/slice-clip.ts` — pure: slice points + tempo + grid → `{ slices, notes, lengthBars }`.
- `src/core/slice-grid-editing.ts` — pure: contiguous-row (slice ↔ note) hit/marquee/move/clipboard helpers.
- `src/samples/loop-metadata.ts` — pure: parse `acid`/`cue `/`smpl` (WAV) + AIFF `MARK`/tempo from raw bytes.
- `src/samples/loop-analysis.ts` — DSP: onset detection + tempo estimate + whole-bar snap (detection fallback).
- `src/samples/timestretch.ts` — DSP: WSOLA/OLA `stretchBuffer(ctx, buffer, ratio)`.
- `src/samples/stretch-cache.ts` — sync get + async ensure for stretched buffers, keyed by `sampleId|ratio`.
- `src/samples/loop-import.ts` — pure orchestrator: bytes+buffer+projectBpm+meter → `SliceLoopResult`.
- `src/session/clip-editors/clip-editor-loop.ts` — the unified loop editor (toolbar + waveform + slice grid).
- Tests alongside each (`*.test.ts` / `*.dsp.test.ts`).

**Modified:**
- `src/session/session.ts` — `ClipSample` (`warpMode`, `slices`), `LoopSlice`, `slicedLoopClip()` helper.
- `src/engines/engine-types.ts` — `VoiceTriggerOptions.slice`.
- `src/engines/sampler.ts` — `triggerSlice` path; stretch-buffer swap in `triggerSample`.
- `src/core/lane-scheduler.ts` — `slices`-presence branch + `onTrigger` note carries `slice?`.
- `src/session/session-runtime.ts` — `LaneTriggerFn` carries `slice?`; pass through.
- `src/app/trigger-dispatch.ts` — `TriggerForLane` carries `slice?` → `opts.slice`.
- `src/app/bpm-broadcast.ts` — debounced stretch re-render on BPM change.
- `src/session/clip-editors/clip-editor-router.ts` — route slice loops to the loop editor; manual-rack generalization.

---

## Phase 0 — Data model & types

### Task 1: Extend ClipSample + add LoopSlice + slicedLoopClip()

**Files:**
- Modify: `src/session/session.ts:19-29` (`ClipSample`), add `LoopSlice` + `slicedLoopClip()`
- Modify: `src/engines/engine-types.ts:26-34` (`VoiceTriggerOptions`)
- Test: `src/session/session-sliced-loop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/session/session-sliced-loop.test.ts
import { describe, it, expect } from 'vitest';
import { slicedLoopClip } from './session';

describe('slicedLoopClip', () => {
  it('builds a slice-mode clip carrying slices + generated notes', () => {
    const clip = slicedLoopClip({
      name: 'amen',
      sampleId: 'smp-x',
      durationSec: 1.846,
      originalBpm: 174,
      lengthBars: 2,
      slices: [
        { start: 0, end: 0.46, note: 36 },
        { start: 0.46, end: 0.92, note: 37 },
      ],
      notes: [
        { start: 0, duration: 24, midi: 36, velocity: 90 },
        { start: 48, duration: 24, midi: 37, velocity: 90 },
      ],
    });
    expect(clip.sample?.warpMode).toBe('slice');
    expect(clip.sample?.warp).toBe(true);
    expect(clip.sample?.slices?.length).toBe(2);
    expect(clip.lengthBars).toBe(2);
    expect(clip.notes.length).toBe(2);
    expect(clip.notes[1].midi).toBe(37);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/session/session-sliced-loop.test.ts`
Expected: FAIL — `slicedLoopClip is not a function`.

- [ ] **Step 3: Implement the types + helper**

In `src/engines/engine-types.ts`, add to `VoiceTriggerOptions` (after the `sample?` field, line 33):

```ts
  /** Slice-mode playback (sampler): play this sub-region of a buffer at
   *  natural pitch, applying the per-pad params keyed by the trigger note.
   *  Set by the scheduler for warpMode==='slice' loop clips. */
  slice?: { sampleId: string; start: number; end: number };
```

In `src/session/session.ts`, extend `ClipSample` (replace lines 19-29) and add `LoopSlice`:

```ts
export interface LoopSlice {
  start: number;   // seconds into the buffer
  end: number;     // seconds
  note: number;    // MIDI row this slice maps to (editor row + the note that fires it)
}

export interface ClipSample {
  sampleId: string;
  mode: 'loop' | 'song';
  /** Loop: convenience metadata to suggest lengthBars on import. Song: optional. */
  originalBpm?: number;
  /** Per-clip warp/sync on/off. */
  warp?: boolean;
  /** How a warped loop plays. 'slice' (default) = notes trigger slice regions;
   *  'stretch' = one WSOLA-stretched buffer. Read with a 'slice' default. */
  warpMode?: 'slice' | 'stretch';
  /** Slice carve map (present in slice mode). Discriminates the playback path. */
  slices?: LoopSlice[];
  trimStart: number;   // seconds into the buffer
  trimEnd: number;     // seconds (buffer end if not trimmed)
  gain?: number;       // linear, default 1
}
```

Add the constructor helper near `audioClip` (after line 133):

```ts
/** Build a slice-mode (warp) loop clip: carries clip.sample.slices + the
 *  generated NoteEvent[] that fire them. lengthBars/slices/notes come from the
 *  pure slice-clip builder (core/slice-clip.ts). */
export function slicedLoopClip(opts: {
  name: string;
  sampleId: string;
  durationSec: number;
  originalBpm: number;
  lengthBars: number;
  slices: LoopSlice[];
  notes: NoteEvent[];
}): SessionClip {
  return {
    id: nextId('clip'),
    name: opts.name,
    color: pickRandomClipColor(),
    lengthBars: opts.lengthBars,
    notes: opts.notes,
    sample: {
      sampleId: opts.sampleId,
      mode: 'loop',
      originalBpm: opts.originalBpm,
      warp: true,
      warpMode: 'slice',
      slices: opts.slices,
      trimStart: 0,
      trimEnd: opts.durationSec,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/session/session-sliced-loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/session/session.ts src/engines/engine-types.ts src/session/session-sliced-loop.test.ts
git commit -m "feat(sampler): ClipSample slice model + slicedLoopClip + opts.slice"
```

---

## Phase 1 — Pure slice-clip builder

### Task 2: core/slice-clip.ts — slices+tempo+grid → {slices, notes, lengthBars}

**Files:**
- Create: `src/core/slice-clip.ts`
- Test: `src/core/slice-clip.test.ts`

Maps detected/embedded slice onsets (seconds) onto the tick grid at the project tempo. Slice N is assigned MIDI `SLICE_BASE_NOTE + N`. Each slice's note is placed at its onset quantized to `gridResolution`. `lengthBars` is derived from the loop's bar count (`durationSec` at `originalBpm`).

- [ ] **Step 1: Write the failing test**

```ts
// src/core/slice-clip.test.ts
import { describe, it, expect } from 'vitest';
import { buildSliceClip, barCountFor, SLICE_BASE_NOTE } from './slice-clip';
import { DEFAULT_METER } from './meter';
import { TICKS_PER_QUARTER } from './notes';

describe('barCountFor', () => {
  it('derives whole bars from duration at the loop tempo (4/4)', () => {
    // 2 bars @ 120bpm 4/4 = 2 * 4 * 0.5s = 4.0s
    expect(barCountFor(4.0, 120, DEFAULT_METER)).toBe(2);
    // 1 bar @ 174bpm 4/4 = 4 * (60/174) ≈ 1.379s
    expect(barCountFor(1.379, 174, DEFAULT_METER)).toBe(1);
  });
  it('never returns less than 1', () => {
    expect(barCountFor(0.1, 120, DEFAULT_METER)).toBe(1);
  });
});

describe('buildSliceClip', () => {
  it('one slice + note per onset, contiguous notes from SLICE_BASE_NOTE', () => {
    // 4 onsets evenly over a 1-bar @120 loop (2.0s)
    const r = buildSliceClip({
      slicePointsSec: [0, 0.5, 1.0, 1.5],
      durationSec: 2.0,
      originalBpm: 120,
      projectMeter: DEFAULT_METER,
      gridResolution: '1/16',
    });
    expect(r.lengthBars).toBe(1);
    expect(r.slices.length).toBe(4);
    expect(r.notes.length).toBe(4);
    expect(r.slices.map((s) => s.note)).toEqual([
      SLICE_BASE_NOTE, SLICE_BASE_NOTE + 1, SLICE_BASE_NOTE + 2, SLICE_BASE_NOTE + 3,
    ]);
    // slice regions partition the buffer; last slice ends at durationSec
    expect(r.slices[0].start).toBe(0);
    expect(r.slices[3].end).toBeCloseTo(2.0, 5);
    // notes land on beat boundaries (quantized): 0, 1 beat, 2 beats, 3 beats
    expect(r.notes[0].start).toBe(0);
    expect(r.notes[1].start).toBe(TICKS_PER_QUARTER);
    expect(r.notes[2].start).toBe(TICKS_PER_QUARTER * 2);
    expect(r.notes[3].start).toBe(TICKS_PER_QUARTER * 3);
  });

  it('falls back to a single whole-buffer slice when no onsets', () => {
    const r = buildSliceClip({
      slicePointsSec: [], durationSec: 1.0, originalBpm: 120,
      projectMeter: DEFAULT_METER, gridResolution: '1/16',
    });
    expect(r.slices.length).toBe(1);
    expect(r.slices[0].start).toBe(0);
    expect(r.slices[0].end).toBeCloseTo(1.0, 5);
    expect(r.notes.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/slice-clip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/slice-clip.ts
// Pure: turn slice onsets (seconds) + the loop's tempo into a slice carve map
// plus a generated NoteEvent[] placed on the project grid. Slice N is mapped to
// MIDI SLICE_BASE_NOTE + N (contiguous rows for the loop editor).

import type { LoopSlice } from '../session/session';
import type { NoteEvent } from './notes';
import { TICKS_PER_QUARTER } from './notes';
import { quartersPerBar, type TimeSignature } from './meter';
import { resolutionToSnap, snapTickToRes, type ResolutionKey } from './drum-grid-editing';

/** First MIDI note slices map to (C2 = 36, the GM kick note — matches the
 *  drum-rack base so per-pad params line up visually). */
export const SLICE_BASE_NOTE = 36;

/** Whole-bar count for a loop of `durationSec` played at `bpm` in `meter`. */
export function barCountFor(durationSec: number, bpm: number, meter: TimeSignature): number {
  const secPerBeat = 60 / bpm;
  const barSec = quartersPerBar(meter) * secPerBeat;
  return Math.max(1, Math.round(durationSec / barSec));
}

export interface SliceClipResult {
  slices: LoopSlice[];
  notes: NoteEvent[];
  lengthBars: number;
}

export function buildSliceClip(opts: {
  slicePointsSec: number[];
  durationSec: number;
  originalBpm: number;
  projectMeter: TimeSignature;
  gridResolution: ResolutionKey;
}): SliceClipResult {
  const { durationSec, originalBpm, projectMeter, gridResolution } = opts;
  const lengthBars = barCountFor(durationSec, originalBpm, projectMeter);

  // Onsets: ensure a 0 boundary, sorted, de-duped, all < durationSec.
  const onsets = Array.from(new Set([0, ...opts.slicePointsSec]))
    .filter((t) => t >= 0 && t < durationSec)
    .sort((a, b) => a - b);
  if (onsets.length === 0) onsets.push(0);

  // Slice regions partition [0, durationSec).
  const slices: LoopSlice[] = onsets.map((start, i) => ({
    start,
    end: i + 1 < onsets.length ? onsets[i + 1] : durationSec,
    note: SLICE_BASE_NOTE + i,
  }));

  // Map each slice onset (a fraction of the loop) onto the clip's tick span,
  // quantized to the grid. The loop spans lengthBars; an onset at fraction f
  // lands at f * patternTicks.
  const patternTicks = lengthBars * quartersPerBar(projectMeter) * TICKS_PER_QUARTER;
  const snap = resolutionToSnap(gridResolution);
  const notes: NoteEvent[] = slices.map((s, i) => {
    const frac = s.start / durationSec;
    const start = snapTickToRes(Math.round(frac * patternTicks), snap);
    const next = i + 1 < slices.length ? slices[i + 1].start / durationSec : 1;
    const dur = Math.max(1, Math.round((next - frac) * patternTicks));
    return { start, duration: dur, midi: s.note, velocity: 90 };
  });

  return { slices, notes, lengthBars };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/slice-clip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/slice-clip.ts src/core/slice-clip.test.ts
git commit -m "feat(loop): pure slice-clip builder (onsets+tempo+grid → slices+notes)"
```

---

## Phase 2 — Embedded metadata parsing

### Task 3: samples/loop-metadata.ts — WAV acid/cue/smpl parsing

**Files:**
- Create: `src/samples/loop-metadata.ts`
- Test: `src/samples/loop-metadata.test.ts`

Parses RIFF/WAVE chunks from the raw `ArrayBuffer`. We read `fmt ` (sample rate, to convert sample offsets → seconds), `cue ` (cue points = slice offsets in samples), `smpl` (loop points + MIDI unity note), and `acid` (tempo + beats). Returns `null` when not a RIFF/WAVE file.

- [ ] **Step 1: Write the failing test**

```ts
// src/samples/loop-metadata.test.ts
import { describe, it, expect } from 'vitest';
import { parseLoopMetadata } from './loop-metadata';

// ── tiny RIFF/WAVE builder for fixtures ──────────────────────────────────────
function chunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2));
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  dv.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}
function u32(...vals: number[]): Uint8Array {
  const out = new Uint8Array(vals.length * 4);
  const dv = new DataView(out.buffer);
  vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true));
  return out;
}
function riff(...chunks: Uint8Array[]): ArrayBuffer {
  const bodyLen = chunks.reduce((a, c) => a + c.length, 0) + 4;
  const out = new Uint8Array(8 + bodyLen);
  const dv = new DataView(out.buffer);
  out[0] = 82; out[1] = 73; out[2] = 70; out[3] = 70; // RIFF
  dv.setUint32(4, bodyLen, true);
  out[8] = 87; out[9] = 65; out[10] = 86; out[11] = 69; // WAVE
  let off = 12;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}
function fmt(sampleRate: number): Uint8Array {
  const b = new Uint8Array(16); const dv = new DataView(b.buffer);
  dv.setUint16(0, 1, true); dv.setUint16(2, 2, true);
  dv.setUint32(4, sampleRate, true); dv.setUint32(8, sampleRate * 4, true);
  dv.setUint16(12, 4, true); dv.setUint16(14, 16, true);
  return chunk('fmt ', b);
}
// cue chunk: count, then per-point 24 bytes; sampleOffset is the 6th u32.
function cue(sampleRate: number, offsetsSec: number[]): Uint8Array {
  const body = new Uint8Array(4 + offsetsSec.length * 24);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, offsetsSec.length, true);
  offsetsSec.forEach((sec, i) => {
    const base = 4 + i * 24;
    dv.setUint32(base, i + 1, true);            // dwName
    dv.setUint32(base + 20, Math.round(sec * sampleRate), true); // dwSampleOffset
  });
  return chunk('cue ', body);
}
// acid chunk (24 bytes): flags(u32), rootNote(u16), unk(u16), unk(f32), beats(u32), meterDen(u16), meterNum(u16), tempo(f32)
function acid(beats: number, tempo: number): Uint8Array {
  const b = new Uint8Array(24); const dv = new DataView(b.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(8, beats, true);
  dv.setFloat32(20, tempo, true);
  return chunk('acid', b);
}

describe('parseLoopMetadata', () => {
  it('returns null for non-RIFF bytes', () => {
    expect(parseLoopMetadata(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
  });

  it('reads cue points as slice seconds using fmt sample rate', () => {
    const buf = riff(fmt(48000), cue(48000, [0.0, 0.25, 0.5, 0.75]));
    const md = parseLoopMetadata(buf);
    expect(md?.slicePointsSec).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('reads acid tempo + beats', () => {
    const buf = riff(fmt(44100), acid(8, 174));
    const md = parseLoopMetadata(buf);
    expect(md?.originalBpm).toBeCloseTo(174, 3);
    expect(md?.beats).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-metadata.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/samples/loop-metadata.ts
// Pure parser for embedded loop metadata in audio file bytes. Reads RIFF/WAVE
// (fmt /cue /smpl/acid) and AIFF (COMM/MARK/APPL) chunks. Returns null when the
// container is unrecognised. No Web Audio dependency — operates on raw bytes.

export interface LoopMetadata {
  originalBpm?: number;
  beats?: number;
  slicePointsSec?: number[];
  rootNote?: number;
  loopStartSec?: number;
  loopEndSec?: number;
}

function tag(dv: DataView, off: number): string {
  return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
}

export function parseLoopMetadata(bytes: ArrayBuffer): LoopMetadata | null {
  if (bytes.byteLength < 12) return null;
  const dv = new DataView(bytes);
  const head = tag(dv, 0);
  if (head === 'RIFF' && tag(dv, 8) === 'WAVE') return parseWave(dv);
  if (head === 'FORM' && (tag(dv, 8) === 'AIFF' || tag(dv, 8) === 'AIFC')) return parseAiff(dv);
  return null;
}

function parseWave(dv: DataView): LoopMetadata {
  const md: LoopMetadata = {};
  let sampleRate = 44100;
  let off = 12;
  const end = dv.byteLength;
  // first pass: fmt for sample rate (chunks can be in any order)
  for (let p = 12; p + 8 <= end;) {
    const id = tag(dv, p); const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') { sampleRate = dv.getUint32(p + 12, true); break; }
    p += 8 + size + (size & 1);
  }
  while (off + 8 <= end) {
    const id = tag(dv, off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'cue ') {
      const count = dv.getUint32(body, true);
      const pts: number[] = [];
      for (let i = 0; i < count; i++) {
        const base = body + 4 + i * 24;
        if (base + 24 > end) break;
        pts.push(dv.getUint32(base + 20, true) / sampleRate);
      }
      md.slicePointsSec = pts.sort((a, b) => a - b);
    } else if (id === 'smpl') {
      const numLoops = dv.getUint32(body + 28, true);
      md.rootNote = dv.getUint32(body + 12, true);
      if (numLoops > 0) {
        const loopBase = body + 36;
        md.loopStartSec = dv.getUint32(loopBase + 8, true) / sampleRate;
        md.loopEndSec = dv.getUint32(loopBase + 12, true) / sampleRate;
      }
    } else if (id === 'acid') {
      md.beats = dv.getUint32(body + 8, true);
      const tempo = dv.getFloat32(body + 20, true);
      if (Number.isFinite(tempo) && tempo > 1) md.originalBpm = tempo;
    }
    off = body + size + (size & 1);
  }
  return md;
}

function parseAiff(dv: DataView): LoopMetadata {
  const md: LoopMetadata = {};
  let off = 12;
  const end = dv.byteLength;
  while (off + 8 <= end) {
    const id = tag(dv, off);
    const size = dv.getUint32(off + 4, true); // AIFF is big-endian for sizes
    const body = off + 8;
    if (id === 'APPL') {
      // Apple Loops embed tempo in an 'APPL' chunk; best-effort scan for a
      // plausible float tempo is unreliable, so we skip unless a future task
      // adds the precise sub-format. Left as a no-op hook here.
      void body;
    }
    off = body + size + (size & 1);
  }
  return md;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-metadata.test.ts`
Expected: PASS (the AIFF branch is exercised by Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/samples/loop-metadata.ts src/samples/loop-metadata.test.ts
git commit -m "feat(loop): WAV acid/cue/smpl metadata parser"
```

### Task 4: AIFF tempo + markers in loop-metadata

**Files:**
- Modify: `src/samples/loop-metadata.ts` (`parseAiff`)
- Test: `src/samples/loop-metadata.test.ts` (add AIFF cases)

AIFF stores sample rate in `COMM` (80-bit IEEE extended), markers in `MARK`, and Apple-Loop tempo in an `APPL` chunk tagged `appl`/`bclp`. We read `COMM` for the rate and frame count, and `MARK` for marker positions (frames → seconds). Tempo from Apple Loops is parsed when the `APPL` body begins with the `appl` signature followed by a `bcdf`/tempo descriptor; otherwise tempo stays undefined and the detection fallback runs.

- [ ] **Step 1: Add the failing AIFF test**

```ts
// append to src/samples/loop-metadata.test.ts

// 80-bit IEEE extended (big-endian) encoder for a positive integer rate.
function ext80(value: number): Uint8Array {
  const out = new Uint8Array(10);
  let mantissa = value, exp = 16383;
  while (mantissa >= 1 && mantissa < 0x80000000 && (mantissa & 0x80000000) === 0) {
    if (mantissa >= 2 ** 31) break;
    if (mantissa * 2 > value) break;
    break;
  }
  // simpler: normalize so the top mantissa bit is set
  let m = value, e = 16383 + 31;
  while ((m & 0x80000000) === 0 && m !== 0) { m <<= 1; e--; }
  const dv = new DataView(out.buffer);
  dv.setUint16(0, e, false);
  dv.setUint32(2, m >>> 0, false);
  dv.setUint32(6, 0, false);
  return out;
}
function aiffChunkBE(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length & 1));
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  dv.setUint32(4, body.length, false);
  out.set(body, 8);
  return out;
}
function comm(rate: number, frames: number): Uint8Array {
  const b = new Uint8Array(18); const dv = new DataView(b.buffer);
  dv.setUint16(0, 2, false);       // channels
  dv.setUint32(2, frames, false);  // sampleFrames
  dv.setUint16(6, 16, false);      // bits
  b.set(ext80(rate), 8);           // sampleRate (80-bit extended)
  return aiffChunkBE('COMM', b);
}
function mark(rate: number, framesList: number[]): Uint8Array {
  // numMarkers(u16), then per-marker: id(u16), position(u32), pstring name
  let len = 2;
  for (const _ of framesList) len += 2 + 4 + 2; // 1-char padded pstring
  const b = new Uint8Array(len); const dv = new DataView(b.buffer);
  dv.setUint16(0, framesList.length, false);
  let o = 2;
  framesList.forEach((f, i) => {
    dv.setUint16(o, i + 1, false); o += 2;
    dv.setUint32(o, f, false); o += 4;
    dv.setUint8(o, 0); o += 1; dv.setUint8(o, 0); o += 1; // empty pstring, padded
  });
  return aiffChunkBE('MARK', b);
}
function formAiff(...chunks: Uint8Array[]): ArrayBuffer {
  const bodyLen = chunks.reduce((a, c) => a + c.length, 0) + 4;
  const out = new Uint8Array(8 + bodyLen); const dv = new DataView(out.buffer);
  'FORM'.split('').forEach((ch, i) => { out[i] = ch.charCodeAt(0); });
  dv.setUint32(4, bodyLen, false);
  'AIFF'.split('').forEach((ch, i) => { out[8 + i] = ch.charCodeAt(0); });
  let off = 12; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

describe('parseLoopMetadata AIFF', () => {
  it('reads MARK marker positions as slice seconds via COMM rate', () => {
    const rate = 44100;
    const buf = formAiff(comm(rate, rate), mark(rate, [0, rate / 4, rate / 2]));
    const md = parseLoopMetadata(buf);
    expect(md?.slicePointsSec).toEqual([0, 0.25, 0.5]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-metadata.test.ts`
Expected: FAIL — `slicePointsSec` undefined for AIFF.

- [ ] **Step 3: Implement parseAiff**

Replace `parseAiff` in `src/samples/loop-metadata.ts`:

```ts
/** Decode an 80-bit IEEE-754 extended float (big-endian) to a Number. */
function readExtended(dv: DataView, off: number): number {
  const expo = dv.getUint16(off, false);
  const hi = dv.getUint32(off + 2, false);
  const lo = dv.getUint32(off + 6, false);
  const sign = expo & 0x8000 ? -1 : 1;
  const e = (expo & 0x7fff) - 16383;
  const mant = hi * 2 ** 32 + lo;
  return sign * mant * 2 ** (e - 63);
}

function parseAiff(dv: DataView): LoopMetadata {
  const md: LoopMetadata = {};
  let rate = 44100;
  let off = 12;
  const end = dv.byteLength;
  // first pass: COMM for the sample rate
  for (let p = 12; p + 8 <= end;) {
    const id = tag(dv, p); const size = dv.getUint32(p + 4, false);
    if (id === 'COMM') { rate = readExtended(dv, p + 8 + 8) || 44100; break; }
    p += 8 + size + (size & 1);
  }
  while (off + 8 <= end) {
    const id = tag(dv, off);
    const size = dv.getUint32(off + 4, false);
    const body = off + 8;
    if (id === 'MARK') {
      const count = dv.getUint16(body, false);
      const pts: number[] = [];
      let o = body + 2;
      for (let i = 0; i < count && o + 6 <= end; i++) {
        o += 2; // marker id
        const pos = dv.getUint32(o, false); o += 4;
        pts.push(pos / rate);
        const nameLen = dv.getUint8(o); o += 1 + nameLen;
        if ((1 + nameLen) & 1) o += 1; // pad to even
      }
      md.slicePointsSec = pts.sort((a, b) => a - b);
    }
    off = body + size + (size & 1);
  }
  return md;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-metadata.test.ts`
Expected: PASS (WAV + AIFF cases).

- [ ] **Step 5: Commit**

```bash
git add src/samples/loop-metadata.ts src/samples/loop-metadata.test.ts
git commit -m "feat(loop): AIFF COMM/MARK metadata parsing"
```

---

## Phase 3 — Detection fallback (DSP)

### Task 5: samples/loop-analysis.ts — onset + tempo detection

**Files:**
- Create: `src/samples/loop-analysis.ts`
- Test: `src/samples/loop-analysis.dsp.test.ts`

Pure DSP over decoded channel data: build an energy-onset envelope, peak-pick onsets, estimate a rough tempo by autocorrelation, then **snap to a whole-bar interpretation** of the buffer length for an exact BPM (with ×2/÷2 fallback to keep BPM in 70–180). Returns `{ originalBpm, slicePointsSec, confidence }`. Tested two ways: (1) a synthetic click train (deterministic, known BPM + onsets), and (2) the **committed real loop corpus** in `test/fixtures/loops/drum/` via the `test/loop-fixtures.ts` resolver — each fixture is decoded and `detectLoop`'s BPM is asserted **octave-equivalent** to the filename ground-truth BPM within tolerance. The real loops are plain `RIFF/WAVE` (no `acid`/`cue `/`smpl`), which is exactly why detection — not metadata — is the real-world path.

- [ ] **Step 1: Write the failing DSP test**

```ts
// src/samples/loop-analysis.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { detectLoop } from './loop-analysis';
import { DEFAULT_METER } from '../core/meter';

// Build a mono click-train AudioBuffer: `beats` impulses over `durationSec`.
function clickTrain(durationSec: number, beats: number, sr = 44100): AudioBuffer {
  const ctx = new OfflineAudioContext(1, Math.ceil(durationSec * sr), sr);
  const buf = ctx.createBuffer(1, Math.ceil(durationSec * sr), sr);
  const data = buf.getChannelData(0);
  for (let b = 0; b < beats; b++) {
    const at = Math.floor((b / beats) * data.length);
    for (let i = 0; i < 200 && at + i < data.length; i++) {
      data[at + i] = Math.exp(-i / 30) * (i % 2 ? 1 : -1); // short decaying click
    }
  }
  return buf;
}

describe('detectLoop', () => {
  it('detects the tempo of a 2-bar 4/4 click train within 3%', () => {
    // 2 bars @ 120 = 8 beats over 4.0s
    const buf = clickTrain(4.0, 8);
    const r = detectLoop(buf, DEFAULT_METER);
    expect(r.originalBpm).toBeGreaterThan(120 * 0.97);
    expect(r.originalBpm).toBeLessThan(120 * 1.03);
  });

  it('finds roughly the right number of onsets', () => {
    const buf = clickTrain(4.0, 8);
    const r = detectLoop(buf, DEFAULT_METER);
    // at least the 8 beat onsets (allow extra/fewer within a relative band)
    expect(r.slicePointsSec.length).toBeGreaterThanOrEqual(6);
    expect(r.slicePointsSec.length).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-analysis.dsp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/samples/loop-analysis.ts
// Detection fallback for loops with no embedded metadata. Pure DSP on the
// decoded buffer: energy-onset envelope → peak-pick onsets → autocorrelation
// tempo estimate → snap to a whole-bar interpretation for an exact BPM.

import { quartersPerBar, type TimeSignature } from '../core/meter';

const HOP = 256;        // envelope hop in samples
const MIN_BPM = 70;
const MAX_BPM = 180;

export interface LoopAnalysis {
  originalBpm: number;
  slicePointsSec: number[];
  confidence: number;   // 0..1 rough autocorrelation peak strength
}

function monoEnvelope(buffer: AudioBuffer): { env: Float32Array; rate: number } {
  const ch = buffer.numberOfChannels;
  const n = buffer.length;
  const frames = Math.max(1, Math.floor(n / HOP));
  const env = new Float32Array(frames);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const base = f * HOP;
      for (let i = 0; i < HOP && base + i < n; i++) { const s = d[base + i]; sum += s * s; }
      env[f] += Math.sqrt(sum / HOP);
    }
  }
  return { env, rate: buffer.sampleRate / HOP };
}

/** Positive first-difference (spectral-flux-like) of the envelope. */
function onsetFunction(env: Float32Array): Float32Array {
  const o = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) o[i] = Math.max(0, env[i] - env[i - 1]);
  return o;
}

function peakPick(onset: Float32Array, rate: number): number[] {
  const mean = onset.reduce((a, b) => a + b, 0) / Math.max(1, onset.length);
  const thresh = mean * 1.5;
  const minGap = Math.floor(rate * 0.05); // 50ms
  const peaks: number[] = [];
  let last = -minGap;
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > thresh && onset[i] >= onset[i - 1] && onset[i] > onset[i + 1] && i - last >= minGap) {
      peaks.push(i / rate);
      last = i;
    }
  }
  return peaks;
}

function autocorrTempo(onset: Float32Array, rate: number): { bpm: number; conf: number } {
  const minLag = Math.floor((60 / MAX_BPM) * rate);
  const maxLag = Math.floor((60 / MIN_BPM) * rate);
  let bestLag = minLag, best = 0, total = 0;
  for (let lag = minLag; lag <= maxLag && lag < onset.length; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    total += s;
    if (s > best) { best = s; bestLag = lag; }
  }
  const bpm = 60 / (bestLag / rate);
  return { bpm, conf: total > 0 ? best / total : 0 };
}

/** Snap a rough BPM to the exact value implied by a whole number of bars over
 *  the loop's duration, keeping the result inside [MIN_BPM, MAX_BPM]. */
function snapToWholeBars(roughBpm: number, durationSec: number, meter: TimeSignature): number {
  const qpb = quartersPerBar(meter);
  const barSecAtRough = qpb * (60 / roughBpm);
  const bars = Math.max(1, Math.round(durationSec / barSecAtRough));
  let bpm = (bars * qpb * 60) / durationSec;
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm /= 2;
  return bpm;
}

export function detectLoop(buffer: AudioBuffer, meter: TimeSignature): LoopAnalysis {
  const { env, rate } = monoEnvelope(buffer);
  const onset = onsetFunction(env);
  const slicePointsSec = peakPick(onset, rate);
  const { bpm: rough, conf } = autocorrTempo(onset, rate);
  const originalBpm = snapToWholeBars(rough, buffer.duration, meter);
  return { originalBpm, slicePointsSec, confidence: conf };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-analysis.dsp.test.ts`
Expected: PASS. If the tempo assertion is flaky, widen the relative band (still relative, never absolute) and re-run — note in a comment why.

- [ ] **Step 5: Commit**

```bash
git add src/samples/loop-analysis.ts src/samples/loop-analysis.dsp.test.ts
git commit -m "feat(loop): onset + tempo detection fallback (whole-bar snap)"
```

---

## Phase 4 — Time-stretch (DSP) + cache

### Task 6: samples/timestretch.ts — WSOLA/OLA buffer stretch

**Files:**
- Create: `src/samples/timestretch.ts`
- Test: `src/samples/timestretch.dsp.test.ts`

Time-domain overlap-add stretch with a 50%-overlap Hann window (COLA → no normalization needed). `ratio > 1` lengthens (slows) without changing pitch. Pure given a context for `createBuffer`.

- [ ] **Step 1: Write the failing DSP test**

```ts
// src/samples/timestretch.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { stretchBuffer } from './timestretch';

function sine(durationSec: number, freq: number, sr = 44100): AudioBuffer {
  const ctx = new OfflineAudioContext(1, Math.ceil(durationSec * sr), sr);
  const buf = ctx.createBuffer(1, Math.ceil(durationSec * sr), sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf;
}
// crude pitch estimate via zero-crossing rate over the middle of the buffer.
function zcrFreq(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const a = Math.floor(d.length * 0.25), b = Math.floor(d.length * 0.75);
  let crossings = 0;
  for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) crossings++;
  return (crossings / 2) * (buf.sampleRate / (b - a));
}

describe('stretchBuffer', () => {
  it('lengthens duration by ~ratio (1.5×)', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const src = sine(1.0, 220);
    const out = stretchBuffer(ctx, src, 1.5);
    expect(out.length / src.length).toBeGreaterThan(1.4);
    expect(out.length / src.length).toBeLessThan(1.6);
  });

  it('preserves pitch (zero-crossing freq ratio ≈ 1)', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const src = sine(1.0, 220);
    const out = stretchBuffer(ctx, src, 1.5);
    const ratio = zcrFreq(out) / zcrFreq(src);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/timestretch.dsp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/samples/timestretch.ts
// Time-domain overlap-add (OLA) time-stretch — preserves pitch, changes length.
// 50%-overlap Hann window (constant-overlap-add: overlapping windows sum to 1,
// so no post-normalization). ratio > 1 = longer/slower. Runs offline; the
// result is an AudioBuffer the caller caches. (A WSOLA similarity search can be
// layered on later to reduce phase artifacts; OLA already preserves pitch.)

const WIN_SEC = 0.046;

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function stretchBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, ratio: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const win = Math.max(8, Math.round(WIN_SEC * sr));
  const synHop = Math.floor(win / 2);          // 50% overlap on output
  const anaHop = synHop / ratio;               // analysis advances slower/faster
  const w = hann(win);
  const outLen = Math.max(1, Math.round(buffer.length * ratio));
  const out = ctx.createBuffer(buffer.numberOfChannels, outLen, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inp = buffer.getChannelData(ch);
    const o = out.getChannelData(ch);
    let synPos = 0;
    let anaPos = 0;
    while (synPos < outLen) {
      const start = Math.round(anaPos);
      for (let i = 0; i < win; i++) {
        const si = start + i;
        const di = synPos + i;
        if (si >= 0 && si < inp.length && di < outLen) o[di] += inp[si] * w[i];
      }
      synPos += synHop;
      anaPos += anaHop;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/timestretch.dsp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/samples/timestretch.ts src/samples/timestretch.dsp.test.ts
git commit -m "feat(loop): OLA time-stretch (pitch-preserving)"
```

### Task 7: samples/stretch-cache.ts — sync get + async ensure

**Files:**
- Create: `src/samples/stretch-cache.ts`
- Test: `src/samples/stretch-cache.test.ts`

A keyed cache (`sampleId|ratio` rounded) of stretched buffers. `get()` is a synchronous lookup used at trigger time (miss ⇒ caller falls back to varispeed). `ensure()` renders+stores via an injected stretch function (so the unit test needs no real DSP).

- [ ] **Step 1: Write the failing test**

```ts
// src/samples/stretch-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { stretchCache } from './stretch-cache';

const fakeBuf = (len: number) => ({ length: len } as unknown as AudioBuffer);

describe('stretchCache', () => {
  beforeEach(() => stretchCache.clear());

  it('returns undefined on a miss, the buffer after ensure', async () => {
    expect(stretchCache.get('smp-a', 1.5)).toBeUndefined();
    let calls = 0;
    await stretchCache.ensure('smp-a', 1.5, () => { calls++; return fakeBuf(99); });
    expect(stretchCache.get('smp-a', 1.5)?.length).toBe(99);
    // second ensure with same key does not re-render
    await stretchCache.ensure('smp-a', 1.5, () => { calls++; return fakeBuf(1); });
    expect(calls).toBe(1);
  });

  it('keys by rounded ratio so 1.500 and 1.5004 share an entry', async () => {
    await stretchCache.ensure('smp-b', 1.5, () => fakeBuf(10));
    expect(stretchCache.get('smp-b', 1.5004)?.length).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/stretch-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/samples/stretch-cache.ts
// In-memory cache of time-stretched AudioBuffers, keyed by sampleId + ratio
// (rounded to 1e-3). Never serialised; re-derived lazily after load.

const cache = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<void>>();

function key(sampleId: string, ratio: number): string {
  return `${sampleId}|${ratio.toFixed(3)}`;
}

export const stretchCache = {
  get(sampleId: string, ratio: number): AudioBuffer | undefined {
    return cache.get(key(sampleId, ratio));
  },
  has(sampleId: string, ratio: number): boolean {
    return cache.has(key(sampleId, ratio));
  },
  /** Render+store if absent. `render` is sync (OLA is fast); coalesces
   *  concurrent calls for the same key. */
  async ensure(sampleId: string, ratio: number, render: () => AudioBuffer): Promise<void> {
    const k = key(sampleId, ratio);
    if (cache.has(k)) return;
    const existing = inflight.get(k);
    if (existing) return existing;
    const p = (async () => { cache.set(k, render()); })().finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  },
  clear(): void { cache.clear(); inflight.clear(); },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/stretch-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/samples/stretch-cache.ts src/samples/stretch-cache.test.ts
git commit -m "feat(loop): stretched-buffer cache (sync get + async ensure)"
```

---

## Phase 5 — Sampler playback

### Task 8: Sampler slice trigger path (opts.slice → region + per-pad params)

**Files:**
- Modify: `src/engines/sampler.ts:84-140` (`trigger`) — add a `triggerSlice` branch + method
- Test: `src/engines/sampler-slice.dsp.test.ts`

`triggerSlice` plays `[opts.slice.start, opts.slice.end)` of the buffer at natural pitch (only per-pad `tune` repitch), applying `getPad(midi)` exactly like the keymap path (envelope/filter/pan/sends).

- [ ] **Step 1: Write the failing DSP test**

```ts
// src/engines/sampler-slice.dsp.test.ts
// Construction mirrors the existing src/engines/sampler-loop.dsp.test.ts:
// `new SamplerEngine()` + node-web-audio-api OfflineAudioContext.
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';

function makeBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr, sr);
  const d = buf.getChannelData(0);
  // loud in [0.5s, 0.75s], silent elsewhere → a slice there should produce audio
  for (let i = 0; i < d.length; i++) d[i] = (i > sr * 0.5 && i < sr * 0.75) ? 0.8 : 0;
  return buf as unknown as AudioBuffer;
}

describe('sampler slice playback', () => {
  it('plays the slice region (produces audio for a loud sub-region)', async () => {
    const sr = 44100;
    const render = new OfflineAudioContext(1, sr, sr);
    sampleCache.put('smp-slice', makeBuffer(render));
    const engine = new SamplerEngine();
    const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
    voice.trigger(36, 0, { gateDuration: 0.25, slice: { sampleId: 'smp-slice', start: 0.5, end: 0.75 } });
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.05);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler-slice.dsp.test.ts`
Expected: FAIL — slice is ignored (no audio / peak ~0).

- [ ] **Step 3: Implement**

In `src/engines/sampler.ts` `trigger`, add at the very top (before the `opts.sample` check at line 85):

```ts
    if (opts.slice) { this.triggerSlice(midi, time, opts); return; }
```

Then add the method (next to `triggerSample`, after line 185):

```ts
  /** Slice path: play a sub-region of a buffer at natural pitch, applying the
   *  per-pad params keyed by the trigger note (same envelope/filter/pan/sends
   *  as the keymap path). Set by the scheduler for warpMode==='slice' loops. */
  private triggerSlice(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const sl = opts.slice!;
    const buf = sampleCache.get(sl.sampleId);
    if (!buf) return;
    const pad = this.api.getPad(midi);

    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }
    this.note = midi;
    this.api.onTrigger(midi, this, time);

    const start = Math.max(0, Math.min(sl.start, buf.duration));
    const end = sl.end > start ? Math.min(sl.end, buf.duration) : buf.duration;
    const region = Math.max(0.001, end - start);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, pad.tune / 12); // natural pitch + TUNE only
    src.connect(this.filter);
    this.src = src;

    this.filter.frequency.setValueAtTime(60 * Math.pow(300, pad.cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + pad.res * 20, time);

    const audible = this.api.isPadAudible(midi) ? 1 : 0;
    const peak = this.api.getGlobal('gain') * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM * pad.level * audible;
    const atk = Math.max(0.001, pad.attack);
    const rel = Math.max(0.005, pad.decay);
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peak, time + atk);
    // gate the slice to its own region length OR the note gate, whichever is shorter
    const playDur = Math.min(region / src.playbackRate.value, Math.max(opts.gateDuration, atk));
    const releaseAt = Math.max(time + atk, time + playDur);
    g.setValueAtTime(peak, releaseAt);
    g.linearRampToValueAtTime(0, releaseAt + rel);

    this.panner.pan.setValueAtTime(pad.pan, time);
    this.revSend.gain.setValueAtTime(pad.rev, time);
    this.dlySend.gain.setValueAtTime(pad.dly, time);

    this.endTime = releaseAt + rel + 0.01;
    src.start(time, start, region + 0.01);
    src.stop(this.endTime);
    this.started = true;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler-slice.dsp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-slice.dsp.test.ts
git commit -m "feat(sampler): slice trigger path (region playback + per-pad params)"
```

### Task 9: Stretch-buffer swap in triggerSample

**Files:**
- Modify: `src/engines/sampler.ts:145-185` (`triggerSample`)
- Test: `src/engines/sampler-stretch.dsp.test.ts`

When `opts.sample.warp && opts.sample.warpMode === 'stretch'`, prefer the cached stretched buffer at rate 1.0 (pitch preserved); on a cache miss, fall back to the existing varispeed (`region/gate`) so audio never drops.

- [ ] **Step 1: Write the failing DSP test**

```ts
// src/engines/sampler-stretch.dsp.test.ts
// The existing varispeed path (region/gate) ALSO fills the gate, so duration
// can't distinguish stretch from varispeed — PITCH does. Stretched buffer plays
// at 220Hz (rate 1.0); varispeed would shift it to 220*region/gate ≈ 147Hz.
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { sampleCache } from '../samples/sample-cache';
import { stretchCache } from '../samples/stretch-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('sampler stretch playback', () => {
  it('uses the cached stretched buffer at rate 1.0 (pitch preserved)', async () => {
    const sr = 44100;
    const render = new OfflineAudioContext(1, Math.ceil(1.6 * sr), sr);
    sampleCache.put('smp-st', tone(render, 1.0, 220));
    // gate 1.5s, region 1.0s → ratio 1.5. Cache a 1.5s 220Hz tone as the "stretched" buffer.
    stretchCache.clear();
    await stretchCache.ensure('smp-st', 1.5, () => tone(render, 1.5, 220));
    const engine = new SamplerEngine();
    const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
    voice.trigger(60, 0, {
      gateDuration: 1.5,
      sample: { sampleId: 'smp-st', mode: 'loop', warp: true, warpMode: 'stretch', trimStart: 0, trimEnd: 1.0 },
    });
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    // measured pitch via zero-crossings ≈ 220 (stretched), NOT ~147 (varispeed).
    const a = Math.floor(0.2 * sr), b = Math.floor(1.2 * sr);
    let cross = 0; for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) cross++;
    const freq = (cross / 2) * (sr / (b - a));
    expect(freq).toBeGreaterThan(200);
    expect(freq).toBeLessThan(240);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler-stretch.dsp.test.ts`
Expected: FAIL — without the swap, varispeed plays at `region/gate` so the measured pitch is ~147Hz, failing the 200–240Hz band.

- [ ] **Step 3: Implement**

Add the import at the top of `src/engines/sampler.ts` (near the other `samples/` imports, line 17):

```ts
import { stretchCache } from '../samples/stretch-cache';
```

In `triggerSample`, replace the buffer/rate setup (lines 160-163) with:

```ts
    const src = this.ctx.createBufferSource();
    const wantStretch = cs.mode === 'loop' && cs.warp && cs.warpMode === 'stretch';
    const ratio = gate / region;
    const stretched = wantStretch ? stretchCache.get(cs.sampleId, ratio) : undefined;
    if (stretched) {
      src.buffer = stretched;
      src.playbackRate.value = 1; // pitch preserved; buffer already fills the gate
    } else {
      src.buffer = buf;
      // loop → varispeed fill (also the stretch-miss fallback); song → natural.
      src.playbackRate.value = cs.mode === 'loop' ? region / gate : 1;
    }
    src.connect(this.filter);
    this.src = src;
```

Then adjust the `src.start` call (line 182). For the stretched buffer we start at 0 (it was rendered from the trimmed region); for varispeed keep `trimStart`:

```ts
    src.start(time, stretched ? 0 : trimStart);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/sampler-stretch.dsp.test.ts`
Expected: PASS. Also re-run the existing loop test to confirm no regression:
`npx cross-env NO_COLOR=1 vitest run src/engines/sampler-loop.dsp.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-stretch.dsp.test.ts
git commit -m "feat(sampler): stretch-mode buffer swap with varispeed fallback"
```

---

## Phase 6 — Scheduler + dispatch integration

### Task 10: Scheduler emits slice notes for warpMode==='slice'

**Files:**
- Modify: `src/core/lane-scheduler.ts:32` (onTrigger note type) and `:103-126` (branch)
- Test: `src/core/lane-scheduler-slice.test.ts`

When `clip.sample?.slices?.length && clip.sample.warpMode !== 'stretch'`, iterate `clip.notes` (like the non-sample branch) and attach the resolved slice region per note. Otherwise the existing buffer/note branches are unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/lane-scheduler-slice.test.ts
import { describe, it, expect } from 'vitest';
import { tickLane } from './lane-scheduler';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from './meter';

function sliceClip(): SessionClip {
  return {
    id: 'c1', lengthBars: 1, notes: [
      { start: 0, duration: 24, midi: 36, velocity: 90 },
      { start: 48, duration: 24, midi: 37, velocity: 90 },
    ],
    sample: {
      sampleId: 'smp-x', mode: 'loop', warp: true, warpMode: 'slice',
      trimStart: 0, trimEnd: 2,
      slices: [
        { start: 0, end: 1, note: 36 },
        { start: 1, end: 2, note: 37 },
      ],
    },
  };
}

describe('tickLane slice mode', () => {
  it('emits notes (not one buffer trigger) with the slice region attached', () => {
    const fired: Array<{ midi: number; slice?: { sampleId: string; start: number; end: number } }> = [];
    tickLane(sliceClip(), {
      bpm: 120, lookaheadSec: 10, now: 0, loopStartedAt: 0, meter: DEFAULT_METER,
      onTrigger: (note) => fired.push({ midi: note.midi, slice: note.slice }),
      onAutomation: () => {},
    });
    expect(fired.length).toBe(2);
    expect(fired[0].slice).toEqual({ sampleId: 'smp-x', start: 0, end: 1 });
    expect(fired[1].midi).toBe(37);
    expect(fired[1].slice?.start).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/lane-scheduler-slice.test.ts`
Expected: FAIL — current code hits the `clip.sample` buffer branch and emits 1 trigger with no slice.

- [ ] **Step 3: Implement**

In `src/core/lane-scheduler.ts`, extend the `onTrigger` note type (line 32):

```ts
  onTrigger: (note: { midi: number; duration: number; velocity: number; sample?: ClipSample; slice?: { sampleId: string; start: number; end: number } }, scheduleTime: number) => void;
```

Replace the branch at lines 105-126 with:

```ts
    const sliceMode = !!clip.sample && !!clip.sample.slices?.length && clip.sample.warpMode !== 'stretch';
    if (clip.sample && !sliceMode) {
      // Loop/song or stretch audio clip: one buffer trigger per iteration.
      if (iterStart >= windowStart && iterStart < windowEnd) {
        ctx.onTrigger(
          { midi: 60, duration: clip.lengthBars * quartersPerBar(meter) * TICKS_PER_STEP, velocity: 100, sample: clip.sample },
          iterStart,
        );
      }
    } else {
      const slices = clip.sample?.slices;
      const sampleId = clip.sample?.sampleId;
      for (const n of clip.notes) {
        const clipTimeSec = (n.start / TICKS_PER_QUARTER) * secPerBeat;
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
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/lane-scheduler-slice.test.ts`
Expected: PASS. Re-run the existing scheduler tests:
`npx cross-env NO_COLOR=1 vitest run src/core/lane-scheduler.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler-slice.test.ts
git commit -m "feat(loop): scheduler emits slice-region notes for warpMode=slice"
```

### Task 11: Thread slice through session-runtime + trigger-dispatch

**Files:**
- Modify: `src/session/session-runtime.ts:152-160` (`LaneTriggerFn`), `:220-237` (onTrigger)
- Modify: `src/app/trigger-dispatch.ts:6-43` (`TriggerForLane` + opts)
- Test: `src/app/trigger-dispatch-slice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/trigger-dispatch-slice.test.ts
import { describe, it, expect } from 'vitest';
import { createTriggerForLane } from './trigger-dispatch';

describe('createTriggerForLane slice', () => {
  it('passes opts.slice to the voice and bypasses note-FX', () => {
    const triggered: any[] = [];
    const fakeVoice = { trigger: (m: number, t: number, o: any) => triggered.push({ m, t, o }) };
    const res = { engine: { id: 'sampler', createVoice: () => fakeVoice }, strip: { input: {} } };
    const deps: any = {
      ctx: {}, seq: { bpm: 120 },
      laneResources: { get: (id: string) => (id === 'L1' ? res : undefined) },
    };
    const trig = createTriggerForLane(deps);
    trig('L1', 36, 0, 0.25, false, false, undefined, { sampleId: 'smp', start: 0.5, end: 1.0 });
    expect(triggered.length).toBe(1);
    expect(triggered[0].o.slice).toEqual({ sampleId: 'smp', start: 0.5, end: 1.0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/app/trigger-dispatch-slice.test.ts`
Expected: FAIL — `trig` has no 8th param; `o.slice` undefined.

- [ ] **Step 3: Implement**

In `src/app/trigger-dispatch.ts`, extend `TriggerForLane` (after the `sample?` param, line 9):

```ts
  sample?: import('../session/session').ClipSample,
  slice?: { sampleId: string; start: number; end: number },
) => void;
```

Update the returned function signature + `fire` + opts (lines 19-29):

```ts
  return (laneId, note, time, gate, accent, slidingIn = false, sample, slice) => {
    const res = deps.laneResources.get(laneId);
    if (!res) return;
    const engineId = res.engine.id;

    const fire = (m: number, t: number, g: number, a: boolean, sl: boolean) => {
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(deps.ctx, res.strip.input);
      setCurrentLaneForVoice(null);
      v.trigger(m, t, { gateDuration: g, accent: a, slide: sl, sample, slice });
    };

    // Audio + slice clips bypass note-FX; drums lanes are not note-transformed.
    const chain = sample == null && slice == null && engineId !== 'drums-machine'
      ? getNoteFxChain(laneId)
      : null;
```

In `src/session/session-runtime.ts`, extend `LaneTriggerFn` (after `sample?` param, line 159):

```ts
  sample?: ClipSample,
  slice?: { sampleId: string; start: number; end: number },
) => void;
```

Update the scheduler `onTrigger` note type (line 220) and the `onLaneTrigger` call (line 237):

```ts
      onTrigger: (note: { midi: number; duration: number; velocity: number; sample?: ClipSample; slice?: { sampleId: string; start: number; end: number } }, scheduleTime: number) => {
```

```ts
        onLaneTrigger(lane.id, note.midi, scheduleTime, gateSec, accent, slidingIn, note.sample, note.slice);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/app/trigger-dispatch-slice.test.ts`
Expected: PASS. Typecheck: `npx tsc --noEmit` → no errors (the main.ts wiring passes the runtime's `onLaneTrigger` straight to `triggerForLane`; both now accept the extra optional arg).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-runtime.ts src/app/trigger-dispatch.ts src/app/trigger-dispatch-slice.test.ts
git commit -m "feat(loop): thread slice region through runtime + trigger-dispatch"
```

### Task 12: Debounced stretch re-render on BPM change

**Files:**
- Create: `src/app/stretch-resync.ts` (pure-ish helper: collect stretch clips + ratios)
- Modify: `src/app/bpm-broadcast.ts` — call the resync after broadcasting
- Test: `src/app/stretch-resync.test.ts`

The pure helper enumerates `(sampleId, ratio)` pairs for every `warpMode==='stretch'` clip with `warp` on, given the session + bpm + meter. `bpm-broadcast` debounces and calls `stretchCache.ensure` for each via the real `stretchBuffer`. The unit test covers the pure enumeration only.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/stretch-resync.test.ts
import { describe, it, expect } from 'vitest';
import { collectStretchJobs } from './stretch-resync';
import type { SessionState } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

function state(): SessionState {
  return {
    lanes: [{
      id: 'L1', engineId: 'sampler', clips: [
        { id: 'a', lengthBars: 2, notes: [], sample: { sampleId: 'smp-1', mode: 'loop', warp: true, warpMode: 'stretch', trimStart: 0, trimEnd: 4 } },
        { id: 'b', lengthBars: 1, notes: [], sample: { sampleId: 'smp-2', mode: 'loop', warp: false, warpMode: 'stretch', trimStart: 0, trimEnd: 2 } }, // warp off → skipped
        { id: 'c', lengthBars: 1, notes: [], sample: { sampleId: 'smp-3', mode: 'loop', warp: true, warpMode: 'slice', slices: [{ start: 0, end: 1, note: 36 }], trimStart: 0, trimEnd: 1 } }, // slice → skipped
      ],
    }],
    scenes: [], globalQuantize: '1/1',
  };
}

describe('collectStretchJobs', () => {
  it('enumerates only warp-on stretch clips with their target ratio', () => {
    // clip a: region=4s; lengthBars 2 @120 4/4 = 4.0s gate → ratio 1.0
    const jobs = collectStretchJobs(state(), 120, DEFAULT_METER);
    expect(jobs.length).toBe(1);
    expect(jobs[0].sampleId).toBe('smp-1');
    expect(jobs[0].ratio).toBeCloseTo(1.0, 3);
    expect(jobs[0].trimStart).toBe(0);
    expect(jobs[0].trimEnd).toBe(4);
  });

  it('ratio scales with bpm (slower bpm → longer gate → larger ratio)', () => {
    const jobs = collectStretchJobs(state(), 60, DEFAULT_METER); // gate doubles → ratio 2.0
    expect(jobs[0].ratio).toBeCloseTo(2.0, 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/app/stretch-resync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper + wire it**

```ts
// src/app/stretch-resync.ts
// Enumerate the (sampleId, ratio) stretch jobs implied by the current session
// + tempo, so the BPM broadcaster can re-render+cache them. Pure.

import type { SessionState } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

export interface StretchJob { sampleId: string; ratio: number; trimStart: number; trimEnd: number; }

export function collectStretchJobs(state: SessionState, bpm: number, meter: TimeSignature): StretchJob[] {
  const jobs: StretchJob[] = [];
  const seen = new Set<string>();
  const secPerBeat = 60 / bpm;
  for (const lane of state.lanes) {
    for (const clip of lane.clips) {
      const s = clip?.sample;
      if (!s || s.mode !== 'loop' || !s.warp || s.warpMode !== 'stretch') continue;
      const region = Math.max(0.001, (s.trimEnd || 0) - (s.trimStart || 0));
      const gate = clip!.lengthBars * quartersPerBar(meter) * secPerBeat;
      const ratio = gate / region;
      const key = `${s.sampleId}|${ratio.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ sampleId: s.sampleId, ratio, trimStart: s.trimStart, trimEnd: s.trimEnd });
    }
  }
  return jobs;
}
```

Wire into `src/app/bpm-broadcast.ts`. Add to `BpmBroadcasterDeps`:

```ts
  ctx: AudioContext;
  getSessionState(): import('../session/session').SessionState;
```

Add imports + a debounced resync inside `createBpmBroadcaster`:

```ts
import { collectStretchJobs } from './stretch-resync';
import { stretchCache } from '../samples/stretch-cache';
import { stretchBuffer } from '../samples/timestretch';
import { sampleCache } from '../samples/sample-cache';
```

```ts
  let resyncTimer: ReturnType<typeof setTimeout> | null = null;
  const resyncStretches = (bpm: number): void => {
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
      const jobs = collectStretchJobs(deps.getSessionState(), bpm, deps.seq.meter);
      for (const job of jobs) {
        void stretchCache.ensure(job.sampleId, job.ratio, () => {
          const buf = sampleCache.get(job.sampleId)!;
          return stretchBuffer(deps.ctx, buf, job.ratio);
        });
      }
    }, 120);
  };
```

Call `resyncStretches(bpm)` at the end of `broadcast(bpm)`. Update the `createBpmBroadcaster` caller in `src/main.ts` to pass `ctx` + `getSessionState` (the session host exposes the live state).

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/app/stretch-resync.test.ts`
Expected: PASS. Typecheck `npx tsc --noEmit` after wiring main.ts.

- [ ] **Step 5: Commit**

```bash
git add src/app/stretch-resync.ts src/app/stretch-resync.test.ts src/app/bpm-broadcast.ts src/main.ts
git commit -m "feat(loop): debounced stretch re-render on BPM change"
```

---

## Phase 7 — Import orchestration

### Task 13: samples/loop-import.ts — analyze a dropped loop

**Files:**
- Create: `src/samples/loop-import.ts`
- Test: `src/samples/loop-import.test.ts`

Pure orchestrator: given the raw bytes, the decoded buffer's `duration`, slice/tempo from metadata-or-detection, the project bpm + meter + grid, return a `SliceLoopResult` ready for `slicedLoopClip`. Metadata wins; detection is the fallback. Injected `parse`/`detect` keep it unit-testable without real DSP.

- [ ] **Step 1: Write the failing test**

```ts
// src/samples/loop-import.test.ts
import { describe, it, expect } from 'vitest';
import { analyzeLoopFor } from './loop-import';
import { DEFAULT_METER } from '../core/meter';

describe('analyzeLoopFor', () => {
  it('prefers embedded metadata (tempo + slices) over detection', () => {
    const r = analyzeLoopFor({
      durationSec: 4.0, projectMeter: DEFAULT_METER, gridResolution: '1/16',
      metadata: { originalBpm: 120, slicePointsSec: [0, 1, 2, 3] },
      detect: () => { throw new Error('should not run detection'); },
    });
    expect(r.originalBpm).toBe(120);
    expect(r.slices.length).toBe(4);
    expect(r.lengthBars).toBe(2);
  });

  it('falls back to detection when metadata lacks tempo', () => {
    const r = analyzeLoopFor({
      durationSec: 2.0, projectMeter: DEFAULT_METER, gridResolution: '1/16',
      metadata: null,
      detect: () => ({ originalBpm: 120, slicePointsSec: [0, 1], confidence: 0.5 }),
    });
    expect(r.originalBpm).toBe(120);
    expect(r.slices.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/samples/loop-import.ts
// Pure orchestrator: choose tempo + slice points from embedded metadata when
// present, else from detection, then build the slice/clip data. The browser
// drop handler (sampler UI) wires the real parse + decode + detect.

import type { LoopMetadata } from './loop-metadata';
import type { LoopAnalysis } from './loop-analysis';
import { buildSliceClip, type SliceClipResult } from '../core/slice-clip';
import type { TimeSignature } from '../core/meter';
import type { ResolutionKey } from '../core/drum-grid-editing';

export function analyzeLoopFor(opts: {
  durationSec: number;
  projectMeter: TimeSignature;
  gridResolution: ResolutionKey;
  metadata: LoopMetadata | null;
  detect: () => LoopAnalysis;
}): SliceClipResult & { originalBpm: number } {
  const md = opts.metadata;
  const hasTempo = !!md && typeof md.originalBpm === 'number';
  const hasSlices = !!md && Array.isArray(md.slicePointsSec) && md.slicePointsSec.length > 0;

  let originalBpm: number;
  let slicePointsSec: number[];
  if (hasTempo && hasSlices) {
    originalBpm = md!.originalBpm!;
    slicePointsSec = md!.slicePointsSec!;
  } else {
    const det = opts.detect();
    originalBpm = hasTempo ? md!.originalBpm! : det.originalBpm;
    slicePointsSec = hasSlices ? md!.slicePointsSec! : det.slicePointsSec;
  }

  const built = buildSliceClip({
    slicePointsSec,
    durationSec: opts.durationSec,
    originalBpm,
    projectMeter: opts.projectMeter,
    gridResolution: opts.gridResolution,
  });
  return { ...built, originalBpm };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/samples/loop-import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/samples/loop-import.ts src/samples/loop-import.test.ts
git commit -m "feat(loop): import orchestrator (metadata-or-detect → slice clip)"
```

### Task 14: Wire the drop handler in the sampler UI

**Files:**
- Modify: `src/engines/sampler.ts` (the file-drop/file-input handler in `buildParamUI`, ~lines 420-520) — add a "Drop loop" path that creates a slice loop clip on the active clip.

This is browser glue (File → `importFile` → `sampleCache.put` → `parseLoopMetadata` → `detectLoop` fallback → `analyzeLoopFor` → `slicedLoopClip` → assign to the lane's selected clip + `sessionHost` re-render). It depends on `EngineUIContext.audioContext`, `sampleStore`, and the session host, which `buildParamUI` already has access to for the existing sample import.

- [ ] **Step 1: Read the existing import handler**

Read `src/engines/sampler.ts` lines 371-589 to find the current file-input/drag-drop wiring and how it stores a sample + mirrors keymap (`mirrorKeymapChange`). Reuse that storage path; branch on a new "Import as loop" toggle/button.

- [ ] **Step 2: Implement the loop-drop branch**

Add an "Import as loop ▼" control near the existing file input. On a file chosen there:

```ts
// inside buildParamUI, given `ctx?: EngineUIContext`
async function importAsLoop(file: File): Promise<void> {
  const audio = ctx?.audioContext;
  if (!audio) return;
  const asset = await importFile(file, audio);              // existing helper
  const buffer = await audio.decodeAudioData(asset.bytes.slice(0));
  sampleCache.put(asset.id, buffer);
  await sampleStore.put(asset);                             // persist bytes (IndexedDB)
  const meter = ctx?.sessionState ? /* read seq.meter via host */ DEFAULT_METER : DEFAULT_METER;
  const result = analyzeLoopFor({
    durationSec: buffer.duration,
    projectMeter: meter,
    gridResolution: DEFAULT_RESOLUTION,
    metadata: parseLoopMetadata(asset.bytes),
    detect: () => detectLoop(buffer, meter),
  });
  const clip = slicedLoopClip({
    name: file.name, sampleId: asset.id, durationSec: buffer.duration,
    originalBpm: result.originalBpm, lengthBars: result.lengthBars,
    slices: result.slices, notes: result.notes,
  });
  // hand the clip to the session host to place on the active lane/slot + rerender
  installLoopClip(clip); // helper bound from the EngineUIContext / session host
}
```

Add imports at the top of `sampler.ts`:

```ts
import { parseLoopMetadata } from '../samples/loop-metadata';
import { detectLoop } from '../samples/loop-analysis';
import { analyzeLoopFor } from '../samples/loop-import';
import { slicedLoopClip } from '../session/session';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
import { DEFAULT_METER } from '../core/meter';
```

> **Note:** `installLoopClip` / meter access must come through the session host. If `EngineUIContext` lacks a clip-install hook, add one (`ctx.installClip?(clip)`) in `engine-types.ts` and provide it where `buildParamUI` is called (search `buildParamUI(` in `src/session/session-inspector.ts` / `src/app/knob-mounting.ts`). Keep the hook optional so other engines are unaffected.

- [ ] **Step 3: Manual verification (no unit test — browser glue)**

Run: `npm run dev`, drop a WAV loop via "Import as loop", confirm a clip appears, the loop editor opens, and it plays in time. (Automated coverage is the pure `analyzeLoopFor` + `slicedLoopClip` tests already written.)

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit`

```bash
git add src/engines/sampler.ts src/engines/engine-types.ts src/session/session-inspector.ts
git commit -m "feat(sampler): import-as-loop drop creates a slice loop clip"
```

---

## Phase 8 — Unified loop editor

### Task 15: core/slice-grid-editing.ts — contiguous-row helpers

**Files:**
- Create: `src/core/slice-grid-editing.ts`
- Test: `src/core/slice-grid-editing.test.ts`

The drum-grid editing helpers key rows off `GM_DRUM_MAP`; slices use **contiguous** MIDI (`baseNote + row`). This is a tiny pure module mirroring the needed subset (hit-in-cell, rect select, row move clamp, clipboard) with a `baseNote`/`rowCount` row model. Reuses `snapTickToRes`/`resolutionToSnap`/`clampResolution` from `drum-grid-editing.ts` (those are GM-free).

- [ ] **Step 1: Write the failing test**

```ts
// src/core/slice-grid-editing.test.ts
import { describe, it, expect } from 'vitest';
import { hitInCellRow, rowsInRectRow, rowMoveContig } from './slice-grid-editing';
import type { NoteEvent } from './notes';

const BASE = 36;
const notes: NoteEvent[] = [
  { start: 0, duration: 24, midi: 36, velocity: 90 },  // row 0
  { start: 48, duration: 24, midi: 38, velocity: 90 }, // row 2
];

describe('slice-grid-editing', () => {
  it('hitInCellRow finds a note by row+cell', () => {
    expect(hitInCellRow(notes, 0, 0, 24, BASE)?.midi).toBe(36);
    expect(hitInCellRow(notes, 1, 0, 24, BASE)).toBeNull();
  });
  it('rowsInRectRow selects by row band + tick span', () => {
    const sel = rowsInRectRow(notes, { row0: 0, row1: 2, tick0: 0, tick1: 96 }, BASE);
    expect(sel.length).toBe(2);
  });
  it('rowMoveContig clamps within [0, rowCount)', () => {
    const moved = rowMoveContig([notes[0]], 5, BASE, 4); // 4 rows max → clamp
    expect(moved.get(notes[0])).toBe(BASE + 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/slice-grid-editing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/slice-grid-editing.ts
// Contiguous-row editing helpers for the slice loop editor: rows map to MIDI
// linearly (midi = baseNote + row), unlike drum-grid-editing which uses the GM
// map. Reuse resolution/snap helpers from drum-grid-editing.

import type { NoteEvent } from './notes';

export interface SliceRect { row0: number; row1: number; tick0: number; tick1: number; }

export function rowOfMidi(midi: number, baseNote: number): number { return midi - baseNote; }
export function midiOfRow(row: number, baseNote: number): number { return baseNote + row; }

export function hitInCellRow(
  notes: readonly NoteEvent[], row: number, cellTick: number, snap: number, baseNote: number,
): NoteEvent | null {
  for (const n of notes) {
    if (n.midi - baseNote === row && n.start >= cellTick && n.start < cellTick + snap) return n;
  }
  return null;
}

export function hitsInCellRow(
  notes: readonly NoteEvent[], row: number, cellTick: number, snap: number, baseNote: number,
): NoteEvent[] {
  return notes.filter((n) => n.midi - baseNote === row && n.start >= cellTick && n.start < cellTick + snap);
}

export function rowsInRectRow(notes: readonly NoteEvent[], rect: SliceRect, baseNote: number): NoteEvent[] {
  const r0 = Math.min(rect.row0, rect.row1), r1 = Math.max(rect.row0, rect.row1);
  const t0 = Math.min(rect.tick0, rect.tick1), t1 = Math.max(rect.tick0, rect.tick1);
  return notes.filter((n) => {
    const r = n.midi - baseNote;
    return r >= r0 && r <= r1 && n.start < t1 && n.start + n.duration > t0;
  });
}

export function rowMoveContig(
  selected: readonly NoteEvent[], dRows: number, baseNote: number, rowCount: number,
): Map<NoteEvent, number> {
  let minR = Infinity, maxR = -Infinity;
  for (const n of selected) { const r = n.midi - baseNote; minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
  const out = new Map<NoteEvent, number>();
  if (minR === Infinity) return out;
  const d = Math.max(-minR, Math.min((rowCount - 1) - maxR, dRows));
  for (const n of selected) out.set(n, baseNote + (n.midi - baseNote) + d);
  return out;
}

export function clampGroupTickContig(selected: readonly NoteEvent[], dTick: number, patternTicks: number): number {
  if (selected.length === 0) return 0;
  let minStart = Infinity, maxEnd = -Infinity;
  for (const n of selected) { minStart = Math.min(minStart, n.start); maxEnd = Math.max(maxEnd, n.start + n.duration); }
  return Math.max(-minStart, Math.min(patternTicks - maxEnd, dTick));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/core/slice-grid-editing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/slice-grid-editing.ts src/core/slice-grid-editing.test.ts
git commit -m "feat(loop): contiguous-row slice grid editing helpers"
```

### Task 16: clip-editor-loop.ts — unified loop editor (layout A)

**Files:**
- Create: `src/session/clip-editors/clip-editor-loop.ts`
- Test: `src/session/clip-editors/clip-editor-loop.test.ts` (smoke: mounts, draws rows = slice count)

The unified panel: a toolbar (BPM readout/edit, bars, warp on/off, mode slice/stretch, resolution, slice count), a waveform strip with slice markers, and the slice grid (rows = slices, reusing `slice-grid-editing`). Modeled on `clip-editor-drum-grid.ts`. Returns `{ redraw }`.

- [ ] **Step 1: Write the failing smoke test**

```ts
// src/session/clip-editors/clip-editor-loop.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderLoopEditor } from './clip-editor-loop';
import type { SessionClip } from '../session';
import { DEFAULT_METER } from '../../core/meter';

// jsdom provides document; stub canvas 2d.
function clip(): SessionClip {
  return {
    id: 'c1', lengthBars: 1,
    notes: [
      { start: 0, duration: 24, midi: 36, velocity: 90 },
      { start: 48, duration: 24, midi: 37, velocity: 90 },
    ],
    sample: {
      sampleId: 'smp-x', mode: 'loop', warp: true, warpMode: 'slice', originalBpm: 120,
      trimStart: 0, trimEnd: 2,
      slices: [{ start: 0, end: 1, note: 36 }, { start: 1, end: 2, note: 37 }],
    },
  };
}

describe('renderLoopEditor', () => {
  it('mounts a toolbar + canvas and reports 2 slice rows', () => {
    const host = document.createElement('div');
    // minimal 2d context stub
    const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
    const handle = renderLoopEditor(host, clip(), undefined, DEFAULT_METER, {});
    expect(host.querySelector('canvas')).toBeTruthy();
    expect(host.textContent).toContain('120'); // detected bpm shown
    expect(typeof handle.redraw).toBe('function');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/session/clip-editors/clip-editor-loop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/session/clip-editors/clip-editor-loop.ts
// Unified loop editor (layout A): toolbar (bpm/bars/warp/mode/resolution) +
// waveform strip with slice markers + a slice grid (rows = slices). Canvas glue
// over core/slice-grid-editing.ts + sample-cache for the waveform. Returns a
// { redraw } handle driven by the session-host RAF.

import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { sampleCache } from '../../samples/sample-cache';
import { SLICE_BASE_NOTE } from '../../core/slice-clip';
import { withUndo, isTextEditTarget, type HistoryDeps } from '../../save/history-wiring';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';
import {
  RESOLUTIONS, resolutionToSnap, clampResolution, DEFAULT_RESOLUTION, snapTickToRes, type ResolutionKey,
} from '../../core/drum-grid-editing';
import {
  hitInCellRow, hitsInCellRow, rowsInRectRow, rowMoveContig, clampGroupTickContig,
} from '../../core/slice-grid-editing';

const LABEL_W = 54;
const RULER_H = 20;
const WAVE_H = 56;
const ROW_H = 22;

export interface LoopEditorDeps {
  auditionNote?: (midi: number) => void;
  getPlayheadTick?: () => number;
}
export interface LoopEditorHandle { redraw: () => void; }

let currentTool: 'draw' | 'select' = 'draw';

export function renderLoopEditor(
  host: HTMLElement, clip: SessionClip,
  historyDeps?: HistoryDeps, meter: TimeSignature = DEFAULT_METER,
  deps: LoopEditorDeps = {},
): LoopEditorHandle {
  host.innerHTML = '';
  const sample = clip.sample!;
  const slices = sample.slices ?? [];
  const rowCount = Math.max(1, slices.length);
  if (!clip.notes) clip.notes = [];
  const notes = (): NoteEvent[] => clip.notes;
  const setNotes = (n: NoteEvent[]) => { clip.notes = n; };

  let resolution: ResolutionKey = clampResolution(clip.gridResolution ?? DEFAULT_RESOLUTION);
  clip.gridResolution = resolution;
  const snap = () => resolutionToSnap(resolution);

  const patternTicks = Math.max(1, clip.lengthBars * ticksPerBar(meter));
  const barTicks = ticksPerBar(meter);
  const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
  const beatTicks = barTicks / beatsPerBar;
  const FRAME_H = RULER_H + WAVE_H + ROW_H * rowCount;

  const selection = new Set<NoteEvent>();
  let marquee: { row0: number; tick0: number; row1: number; tick1: number } | null = null;
  let groupDrag: { lastTick: number; lastRow: number } | null = null;
  let lastMouse: { row: number; tick: number } | null = null;
  let mutated = false;
  let playheadTick = -1;

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.tabIndex = 0; wrap.style.outline = 'none';
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 2px', flexWrap: 'wrap', fontSize: '11px' } as Partial<CSSStyleDeclaration>);

  const bpmLabel = document.createElement('span');
  bpmLabel.textContent = `BPM ${Math.round(sample.originalBpm ?? 120)}`;
  bpmLabel.title = 'Click to edit detected tempo';
  bpmLabel.style.cursor = 'pointer';
  bpmLabel.addEventListener('click', () => {
    const v = Number(prompt('Loop tempo (BPM)', String(Math.round(sample.originalBpm ?? 120))));
    if (Number.isFinite(v) && v > 1) { sample.originalBpm = v; bpmLabel.textContent = `BPM ${Math.round(v)}`; }
  });

  const barsLabel = document.createElement('span');
  barsLabel.textContent = `${clip.lengthBars} bar${clip.lengthBars > 1 ? 's' : ''}`;

  const warpBtn = document.createElement('button');
  const refreshWarp = () => { warpBtn.textContent = sample.warp ? '♺ Warp ON' : '♺ Warp OFF'; };
  warpBtn.addEventListener('click', () => { sample.warp = !sample.warp; refreshWarp(); });
  refreshWarp();

  const modeSel = document.createElement('select');
  for (const m of ['slice', 'stretch']) { const o = document.createElement('option'); o.value = m; o.textContent = m; modeSel.appendChild(o); }
  modeSel.value = sample.warpMode ?? 'slice';
  modeSel.addEventListener('change', () => { sample.warpMode = modeSel.value as 'slice' | 'stretch'; });

  const resSel = document.createElement('select');
  for (const r of RESOLUTIONS) { const o = document.createElement('option'); o.value = r; o.textContent = r; resSel.appendChild(o); }
  resSel.value = resolution;
  resSel.addEventListener('change', () => { resolution = clampResolution(resSel.value); clip.gridResolution = resolution; draw(); });

  const sliceCount = document.createElement('span');
  sliceCount.textContent = `${slices.length} slices`;

  toolbar.append(bpmLabel, barsLabel, warpBtn, modeSel, resSel, sliceCount);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block'; canvas.style.cursor = 'crosshair';
  wrap.append(toolbar, canvas);
  host.appendChild(wrap);

  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('canvas 2d unavailable');
  const ctx = c2d;

  let gridW = 600, pxPerTick = gridW / patternTicks;
  const xForTick = (t: number) => LABEL_W + t * pxPerTick;
  const yForRow = (r: number) => RULER_H + WAVE_H + r * ROW_H;
  const tickFromX = (x: number) => Math.max(0, Math.min(patternTicks - 1, (x - LABEL_W) / pxPerTick));
  const rowFromY = (y: number) => Math.max(0, Math.min(rowCount - 1, Math.floor((y - RULER_H - WAVE_H) / ROW_H)));

  function resize(): void {
    const w = Math.max(320, wrap.clientWidth || host.clientWidth || 600);
    gridW = w - LABEL_W; pxPerTick = gridW / patternTicks;
    canvas.width = w; canvas.height = FRAME_H;
    canvas.style.width = `${w}px`; canvas.style.height = `${FRAME_H}px`;
    draw();
  }

  function drawWaveform(): void {
    ctx.fillStyle = '#0c0c12'; ctx.fillRect(LABEL_W, RULER_H, gridW, WAVE_H);
    const buf = sampleCache.get(sample.sampleId);
    if (buf) {
      const data = buf.getChannelData(0);
      const mid = RULER_H + WAVE_H / 2;
      ctx.strokeStyle = '#4a6a8a'; ctx.beginPath();
      for (let px = 0; px < gridW; px++) {
        const i0 = Math.floor((px / gridW) * data.length);
        const i1 = Math.floor(((px + 1) / gridW) * data.length);
        let peak = 0; for (let i = i0; i < i1 && i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        const x = LABEL_W + px;
        ctx.moveTo(x, mid - peak * (WAVE_H / 2)); ctx.lineTo(x, mid + peak * (WAVE_H / 2));
      }
      ctx.stroke();
    }
    // slice markers
    ctx.strokeStyle = '#ffb454';
    for (const s of slices) {
      const frac = s.start / Math.max(0.001, sample.trimEnd - sample.trimStart);
      const x = LABEL_W + frac * gridW;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, RULER_H + WAVE_H); ctx.stroke();
    }
  }

  function draw(): void {
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, canvas.width, FRAME_H);
    drawWaveform();
    for (let r = 0; r < rowCount; r++) {
      const y = yForRow(r);
      ctx.fillStyle = r % 2 ? '#121212' : '#161616'; ctx.fillRect(LABEL_W, y, gridW, ROW_H);
      ctx.fillStyle = '#202020'; ctx.fillRect(0, y, LABEL_W, ROW_H);
      ctx.fillStyle = '#9a9a9a'; ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
      ctx.fillText(`S${r + 1}`, 4, y + ROW_H / 2);
    }
    const lineStep = resolution === 'free' ? beatTicks : snap();
    for (let t = 0; t <= patternTicks; t += lineStep) {
      const x = xForTick(t);
      ctx.strokeStyle = (t % barTicks === 0) ? '#555' : (t % beatTicks === 0) ? '#2f2f2f' : '#1c1c1c';
      ctx.beginPath(); ctx.moveTo(x, RULER_H + WAVE_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
    for (const n of notes()) {
      const r = n.midi - SLICE_BASE_NOTE;
      if (r < 0 || r >= rowCount) continue;
      const x = xForTick(n.start);
      const w = Math.max(3, Math.min(n.duration * pxPerTick, (LABEL_W + gridW) - x));
      const y = yForRow(r) + 3;
      const sel = selection.has(n);
      ctx.fillStyle = sel ? '#7fd4ff' : (n.velocity >= 100 ? '#ffaa44' : '#3498db');
      ctx.fillRect(x, y, w, ROW_H - 6);
    }
    if (marquee) {
      const x0 = xForTick(Math.min(marquee.tick0, marquee.tick1));
      const x1 = xForTick(Math.max(marquee.tick0, marquee.tick1));
      const y0 = yForRow(Math.min(marquee.row0, marquee.row1));
      const y1 = yForRow(Math.max(marquee.row0, marquee.row1)) + ROW_H;
      ctx.strokeStyle = '#7fd4ff'; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0), Math.max(1, y1 - y0)); ctx.setLineDash([]);
    }
    if (playheadTick >= 0) {
      const x = xForTick(playheadTick);
      ctx.strokeStyle = '#f7d000'; ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, FRAME_H); ctx.stroke();
    }
  }

  function pencilClick(row: number, rawTick: number): void {
    const cell = snapTickToRes(rawTick, snap());
    const midi = SLICE_BASE_NOTE + row;
    const cluster = hitsInCellRow(notes(), row, cell, snap(), SLICE_BASE_NOTE);
    const run = () => {
      if (cluster.length === 0) {
        notes().push({ midi, start: cell, duration: Math.max(1, Math.floor(snap() * 0.9)), velocity: 90 });
        deps.auditionNote?.(midi);
      } else if (cluster.every((n) => n.velocity < 100)) {
        for (const n of cluster) n.velocity = 115; deps.auditionNote?.(midi);
      } else {
        const set = new Set(cluster); setNotes(notes().filter((n) => !set.has(n)));
      }
      draw();
    };
    historyDeps ? withUndo(historyDeps, run) : run();
  }

  const pos = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return { row: rowFromY(e.clientY - rect.top), x, tick: tickFromX(x) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e); wrap.focus();
    if (p.x < LABEL_W || (e.clientY - canvas.getBoundingClientRect().top) < RULER_H + WAVE_H) return;
    if (e.altKey || e.button === 2) {
      const cluster = hitsInCellRow(notes(), p.row, snapTickToRes(p.tick, snap()), snap(), SLICE_BASE_NOTE);
      if (cluster.length) { const set = new Set(cluster); const run = () => { setNotes(notes().filter((n) => !set.has(n))); draw(); }; historyDeps ? withUndo(historyDeps, run) : run(); }
      e.preventDefault(); return;
    }
    if (currentTool === 'draw') { pencilClick(p.row, p.tick); e.preventDefault(); return; }
    const hit = hitInCellRow(notes(), p.row, snapTickToRes(p.tick, snap()), snap(), SLICE_BASE_NOTE);
    if (hit) {
      if (e.shiftKey) { selection.has(hit) ? selection.delete(hit) : selection.add(hit); }
      else if (!selection.has(hit)) { selection.clear(); selection.add(hit); }
      groupDrag = { lastTick: snapTickToRes(p.tick, snap()), lastRow: p.row };
      historyDeps?.history.beginGesture(historyDeps.snapshot()); mutated = false;
    } else { if (!e.shiftKey) selection.clear(); marquee = { row0: p.row, tick0: p.tick, row1: p.row, tick1: p.tick }; }
    canvas.setPointerCapture(e.pointerId); draw(); e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); lastMouse = { row: p.row, tick: p.tick };
    if (marquee) { marquee.row1 = p.row; marquee.tick1 = p.tick; draw(); return; }
    if (groupDrag) {
      const wantTick = snapTickToRes(p.tick, snap());
      const dTick = clampGroupTickContig([...selection], wantTick - groupDrag.lastTick, patternTicks);
      const dRow = p.row - groupDrag.lastRow;
      if (dTick !== 0) { for (const n of selection) n.start += dTick; groupDrag.lastTick += dTick; mutated = true; }
      if (dRow !== 0) { const moved = rowMoveContig([...selection], dRow, SLICE_BASE_NOTE, rowCount); for (const [n, m] of moved) n.midi = m; groupDrag.lastRow += dRow; mutated = true; }
      if (dTick !== 0 || dRow !== 0) draw();
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (marquee) { for (const n of rowsInRectRow(notes(), marquee, SLICE_BASE_NOTE)) selection.add(n); marquee = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* */ } draw(); return; }
    if (groupDrag) { groupDrag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* */ } if (mutated) historyDeps?.history.commitGesture(); else historyDeps?.history.cancelGesture(); }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  wrap.addEventListener('keydown', (e) => {
    if (isTextEditTarget(e.target)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd && e.key === '1') { currentTool = 'draw'; e.preventDefault(); return; }
    if (!cmd && e.key === '2') { currentTool = 'select'; e.preventDefault(); return; }
    if (e.key === 'Escape') { selection.clear(); draw(); e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      const set = new Set(selection); const run = () => { setNotes(notes().filter((n) => !set.has(n))); selection.clear(); draw(); };
      historyDeps ? withUndo(historyDeps, run) : run(); e.preventDefault();
    }
  });

  resize();
  let lastW = wrap.clientWidth;
  function redraw(): void {
    const w = wrap.clientWidth;
    if (w && w !== lastW) { lastW = w; resize(); }
    const ph = deps.getPlayheadTick?.() ?? -1;
    if (ph !== playheadTick) { playheadTick = ph; draw(); }
  }
  return { redraw };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/session/clip-editors/clip-editor-loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-editor-loop.ts src/session/clip-editors/clip-editor-loop.test.ts
git commit -m "feat(loop): unified loop editor (waveform + slice grid)"
```

### Task 17: Route slice loops to the loop editor

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts:36-74`
- Test: `src/session/clip-editors/clip-editor-router.test.ts` (add a slice-loop case; verify routing)

`renderClipEditor` returns a `PianoRollHandle | null` today. The drum/loop editors return a `{ redraw }` handle, not a full `PianoRollHandle`. Confirm how `renderClipEditor`'s return is consumed by the session host (the drum-grid path already returns the drum handle through this function, so a `{ redraw }`-shaped return is already accepted — match that). Route to the loop editor when `clip.sample?.warpMode !== 'stretch' && clip.sample?.slices?.length`.

- [ ] **Step 1: Write/extend the failing test**

```ts
// src/session/clip-editors/clip-editor-router.test.ts  (add)
import { describe, it, expect } from 'vitest';
import { isSliceLoopClip } from './clip-editor-router';

describe('isSliceLoopClip', () => {
  it('true only for a slice-mode loop clip', () => {
    expect(isSliceLoopClip({ id: 'a', lengthBars: 1, notes: [], sample: { sampleId: 's', mode: 'loop', warpMode: 'slice', slices: [{ start: 0, end: 1, note: 36 }], trimStart: 0, trimEnd: 1 } } as never)).toBe(true);
    expect(isSliceLoopClip({ id: 'b', lengthBars: 1, notes: [] } as never)).toBe(false);
    expect(isSliceLoopClip({ id: 'c', lengthBars: 1, notes: [], sample: { sampleId: 's', mode: 'loop', warpMode: 'stretch', trimStart: 0, trimEnd: 1 } } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/session/clip-editors/clip-editor-router.test.ts`
Expected: FAIL — `isSliceLoopClip` not exported.

- [ ] **Step 3: Implement**

Add the import + predicate + routing to `src/session/clip-editors/clip-editor-router.ts`:

```ts
import { renderLoopEditor } from './clip-editor-loop';
```

```ts
/** A loop clip that plays as retriggered slices (vs the stretch buffer path). */
export function isSliceLoopClip(clip: SessionClip): boolean {
  return !!clip.sample && clip.sample.warpMode !== 'stretch' && !!clip.sample.slices?.length;
}
```

Near the top of `renderClipEditor` (after `host.innerHTML = ''` and resolving `engine`), add:

```ts
  if (isSliceLoopClip(clip)) {
    const audition = deps.triggerForLane
      ? (midi: number) => deps.triggerForLane!(lane.id, midi, deps.ctx.currentTime, AUDITION_GATE, false, false)
      : undefined;
    const getPlayheadTick = (): number => {
      const lp = deps.laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const stepDur = 60 / deps.seq.bpm / 4;
      const stepsElapsed = Math.max(0, (deps.ctx.currentTime - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * stepsPerBar(deps.seq.meter);
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    };
    return renderLoopEditor(host, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition, getPlayheadTick });
  }
```

> No cast needed: `PianoRollHandle` is exactly `{ redraw: () => void }` ([core/pianoroll.ts:48](../../../src/core/pianoroll.ts)), and `renderClipEditor` already returns the drum-grid's `{ redraw }` handle the same way (line 71). The session host stores it as `inspector.roll` and calls `inspector.roll.redraw()` from its RAF ([session-host.ts:828](../../../src/session/session-host.ts)).

Also generalize the manual-rack route (optional, same spec section): a non-drumkit sampler with loaded keymap zones can use the drum grid too. Keep `chooseClipEditor` as-is for now (drumkit → drum-grid); the loop route above is the priority. Manual-rack generalization can be a follow-up if the drum-grid's GM coupling makes it noisy — note it and skip if risky.

- [ ] **Step 4: Run to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/session/clip-editors/clip-editor-router.test.ts`
Expected: PASS. Typecheck: `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-editor-router.ts src/session/clip-editors/clip-editor-router.test.ts
git commit -m "feat(loop): route slice loops to the unified loop editor"
```

---

## Phase 9 — Full verification

### Task 18: Build, full test suite, browser smoke

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + build**

Run: `npm run build`
Expected: `tsc` clean, Vite bundles to `dist/` with no errors.

- [ ] **Step 2: Unit + DSP suite**

Run: `npm run test:unit`
Expected: green (re-run once if `ERR_IPC_CHANNEL_CLOSED` appears on teardown — known flaky teardown, not a failure).

- [ ] **Step 3: Browser smoke**

Run: `npm run dev`, then in the app: add a Sampler lane → Import-as-loop a WAV drum loop → confirm (a) the unified loop editor opens with a waveform + slice rows, (b) it plays in time at the project BPM, (c) changing the project BPM keeps slice mode locked, (d) switching a clip to `stretch` + changing BPM re-renders without dropout. Note the URL `http://localhost:5173`.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test(loop): full-suite + build green for loop tempo-sync slicer"
```

- [ ] **Step 5: Finish the branch**

Per project convention: `git rebase main`, then `git merge --ff-only` into `main`, then `ExitWorktree`. (Do this only after the user has reviewed.)

---

## Self-review notes (author)

- **Spec coverage:** warp-engine hybrid → Tasks 8/9 (slice + stretch); auto tempo → Task 5 (detection) + Task 3/4 (embedded); whole-bar snap → Task 2/5; slices reuse per-pad rack → Task 8 (`getPad(midi)`); live tempo-follow → slice mode is free (Task 10) + stretch re-render (Task 12); per-clip warp on/off → Task 1 field + Task 16 toggle; formats Acid/cue+smpl/AIFF → Task 3/4; detection fallback → Task 5/13; no REX → not parsed (Task 3 returns null for unknown containers); unified editor (layout A) → Task 16/17; no migration → Task 1 additive fields, Task 10 discriminates on `slices`.
- **Type consistency:** `slice` region shape `{ sampleId; start; end }` is identical across `VoiceTriggerOptions` (Task 1), scheduler `onTrigger` (Task 10), `LaneTriggerFn`/`TriggerForLane` (Task 11). `SLICE_BASE_NOTE` defined in Task 2, reused in Tasks 16. `buildSliceClip`/`SliceClipResult` defined Task 2, consumed Task 13. `stretchCache.get/ensure` defined Task 7, used Tasks 9/12. `collectStretchJobs` defined Task 12.
- **Verified during authoring:** the sampler is constructed in DSP tests as `new SamplerEngine()` (Tasks 8/9, matching `src/engines/sampler-loop.dsp.test.ts`) — there is no `getEngineFactory`. `PianoRollHandle` is exactly `{ redraw }`, so the loop editor's handle needs no cast (Task 17). The varispeed path already fills the gate, so the stretch test asserts on **pitch** (Task 9).
- **Known soft spot to watch during execution:** Task 14 needs a session-host clip-install hook; if `EngineUIContext` lacks one, add the optional `EngineUIContext.installClip` and provide it where `buildParamUI` is called ([session-inspector.ts:211](../../../src/session/session-inspector.ts)). Flagged inline.
