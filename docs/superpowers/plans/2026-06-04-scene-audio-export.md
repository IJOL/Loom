# Scene Audio Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user export the currently-playing scene of Loom to a `.wav` file, played through once (no looping), via a transport-bar button.

**Architecture:** A self-contained `src/export/` subsystem with a shared pipeline — duration calc, `AudioEncoder` (WAV now, MP3 later), download, and a `SceneRecorder` interface — plus, in Phase 1, a real-time backend that taps the live master output through an `AudioWorklet`, records exactly one scene pass, encodes, and downloads. Phase 2 (offline render) is an additive second backend, planned separately after Phase 1 merges.

**Tech Stack:** TypeScript, Web Audio (`AudioContext`, `AudioWorkletNode`), Vite, Vitest (pure unit tests), Playwright (e2e). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-04-scene-audio-export-design.md`

---

## Scope note: Phase 1 only in this plan

This plan fully specifies **Phase 1 (real-time backend)**, which is independently shippable and establishes the shared pipeline. **Phase 2 (offline backend)** is captured as a roadmap section at the end; its exact, no-placeholder tasks depend on the Phase 1 interfaces existing and on a deeper read of `lane-allocator.ts` / `lane-resources.ts`, so it will get its own `writing-plans` pass after Phase 1 merges. This matches the user's chosen phasing (A → C, real-time first).

## Key facts about the existing code (verified)

- Audio graph (`src/app/audio-graph.ts`): chain is `master → masterInsertChain → masterComp → analyser → ctx.destination`. The true master signal node is **`masterComp.output`** (an `AudioNode`; `analyser` only meters/visualizes and passes audio through). `createAudioGraph()` returns `{ ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus }`.
- `main.ts:94-98` destructures that graph; `main.ts:105` builds `const seq = new Sequencer(ctx, 32)`; `main.ts:148` `const playBtn = $('play')`; `$` is `<T>(id) => document.getElementById(id) as T` (`main.ts:75`).
- `Sequencer` (`src/core/sequencer.ts`): `seq.bpm`, `seq.meter` (a `TimeSignature`), `seq.isPlaying()`, `seq.start()`, `seq.stop()`.
- `SessionHost` exposes `sessionHost.laneStates: Map<string, LanePlayState>` and `sessionHost.state: SessionState` (used at `main.ts:621`).
- `LanePlayState` (`src/session/session-runtime.ts:20-37`): has `laneId`, `playing: SessionClip | null`, `queued: SessionClip | null`, `queuedBoundary: number`, plus `loopStartedAt`/`lastScheduledAt`. `emptyLanePlayState(laneId)` builds a blank one.
- A clip's musical length in seconds is `clip.lengthBars * quartersPerBar(meter) * (60 / bpm)` (`src/core/lane-scheduler.ts:71`). `quartersPerBar` is exported from `src/core/meter.ts`.
- The runtime promotes `queued → playing` once `now + lookahead >= queuedBoundary`, resetting `loopStartedAt = queuedBoundary`, `lastScheduledAt = -Infinity`, `nextStepIdx = 0` (`src/session/session-runtime.ts:191-203`). Setting a sounding lane's `queued = playing` and `queuedBoundary = startTime` therefore makes it cleanly restart from the top of the clip at `startTime`.
- Pure unit tests are `src/**/*.test.ts` (run by `npm run test:unit` / `test:fast`). e2e specs live in `tests/e2e/*.spec.ts` and run against a **prebuilt** `dist/` (`npm run build` first). Boot is detectable via `document.querySelectorAll('.session-cell-filled').length > 0`.
- The transport bar (`index.html:60-107`) holds `<button id="play">`; the boot session ships with filled clip cells.

## File structure (Phase 1)

| File | Responsibility |
|------|----------------|
| `src/export/types.ts` (create) | Shared types: `RenderedAudio`, `AudioEncoder`, `SceneRecorder`. |
| `src/export/scene-duration.ts` (create) | Pure: `clipDurationSec`, `soundingSceneDurationSec`. |
| `src/export/scene-duration.test.ts` (create) | Vitest for the above. |
| `src/export/wav-encoder.ts` (create) | Pure: `encodeWavPcm16` + the `wavEncoder` `AudioEncoder`. |
| `src/export/wav-encoder.test.ts` (create) | Vitest: header + round-trip. |
| `src/export/scene-restart.ts` (create) | Pure-ish: `restartSoundingLanesForExport` (mutates `LanePlayState`s). |
| `src/export/scene-restart.test.ts` (create) | Vitest for the above. |
| `src/export/recorder-worklet.ts` (create) | `RECORDER_PROCESSOR_NAME` + `RECORDER_WORKLET_SOURCE` (plain-JS processor string) + `ensureRecorderWorklet`. |
| `src/export/recorder-worklet.test.ts` (create) | Vitest: source registers the named processor. |
| `src/export/realtime-recorder.ts` (create) | `RealtimeSceneRecorder` implementing `SceneRecorder` (live tap + worklet). |
| `src/export/download.ts` (create) | `downloadBlob`, `exportTimestamp`. |
| `src/export/export-scene.ts` (create) | `exportCurrentScene(x: SceneExporter)` orchestrator + `SceneExporter` interface. |
| `src/export/export-scene.test.ts` (create) | Vitest: orchestration with a fake `SceneExporter`. |
| `index.html` (modify) | Add `<button id="export-scene">` after `#play`. |
| `src/main.ts` (modify) | Wire the export button to a concrete `SceneExporter`. |
| `tests/e2e/scene-export.spec.ts` (create) | Playwright: launch a clip → click export → assert `.wav` download. |

---

## Task 1: Shared export types

**Files:**
- Create: `src/export/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/export/types.ts
// Shared contract for scene export. Both capture backends (real-time now,
// offline later) return RenderedAudio; the encoder + download steps are
// identical for both. The encoder seam is where MP3 plugs in later.

/** Channel-major PCM produced by any capture backend. channels[0] = left,
 *  channels[1] = right (mono backends may return a single channel). */
export interface RenderedAudio {
  channels: Float32Array[];
  sampleRate: number;
}

/** Encodes PCM into a downloadable Blob. WAV now; MP3/other later. */
export interface AudioEncoder {
  /** File extension without the dot, e.g. "wav". */
  readonly extension: string;
  /** MIME type for the Blob, e.g. "audio/wav". */
  readonly mimeType: string;
  encode(channels: Float32Array[], sampleRate: number): Blob;
}

/** A backend that fills a buffer for `totalSec` seconds and returns it. */
export interface SceneRecorder {
  record(totalSec: number): Promise<RenderedAudio>;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors (the file is types-only; nothing imports it yet, which is fine).

- [ ] **Step 3: Commit**

```bash
git add src/export/types.ts
git commit -m "feat(export): shared scene-export types (RenderedAudio, AudioEncoder, SceneRecorder)"
```

---

## Task 2: Scene duration (pure)

**Files:**
- Create: `src/export/scene-duration.ts`
- Test: `src/export/scene-duration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/scene-duration.test.ts
import { describe, it, expect } from 'vitest';
import { clipDurationSec, soundingSceneDurationSec } from './scene-duration';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

function clip(lengthBars: number): SessionClip {
  return { id: `c${lengthBars}`, lengthBars, notes: [] };
}

function playing(laneId: string, c: SessionClip): LanePlayState {
  const lp = emptyLanePlayState(laneId);
  lp.playing = c;
  return lp;
}

describe('clipDurationSec', () => {
  it('is lengthBars * quartersPerBar * 60/bpm (4/4 @120 → 2s per bar)', () => {
    // 4/4: quartersPerBar = 4; 60/120 = 0.5s/beat; 1 bar = 4*0.5 = 2s.
    expect(clipDurationSec(clip(1), DEFAULT_METER, 120)).toBeCloseTo(2, 6);
    expect(clipDurationSec(clip(2), DEFAULT_METER, 120)).toBeCloseTo(4, 6);
  });

  it('scales inversely with bpm', () => {
    const slow = clipDurationSec(clip(1), DEFAULT_METER, 60);
    const fast = clipDurationSec(clip(1), DEFAULT_METER, 120);
    expect(slow).toBeCloseTo(fast * 2, 6);
  });
});

describe('soundingSceneDurationSec', () => {
  it('returns 0 when nothing is playing', () => {
    const states = new Map<string, LanePlayState>();
    states.set('a', emptyLanePlayState('a')); // playing = null
    expect(soundingSceneDurationSec(states, DEFAULT_METER, 120)).toBe(0);
  });

  it('returns the longest sounding clip duration', () => {
    const states = new Map<string, LanePlayState>();
    states.set('drums', playing('drums', clip(2)));
    states.set('bass', playing('bass', clip(4)));
    states.set('idle', emptyLanePlayState('idle'));
    // longest = 4 bars @120 4/4 = 8s.
    expect(soundingSceneDurationSec(states, DEFAULT_METER, 120)).toBeCloseTo(8, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/export/scene-duration.test.ts`
Expected: FAIL — `Cannot find module './scene-duration'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/scene-duration.ts
// Pure scene-duration math. The export plays the longest sounding clip once;
// shorter clips loop to fill that window (the looping itself is the runtime's
// job — here we only compute how many seconds to capture).

import type { LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';
import { quartersPerBar, type TimeSignature } from '../core/meter';

/** Musical length of one clip iteration, in seconds. Mirrors lane-scheduler. */
export function clipDurationSec(clip: SessionClip, meter: TimeSignature, bpm: number): number {
  return clip.lengthBars * quartersPerBar(meter) * (60 / bpm);
}

/** Longest sounding clip across all lanes, in seconds. 0 ⇒ nothing playing. */
export function soundingSceneDurationSec(
  laneStates: Map<string, LanePlayState>,
  meter: TimeSignature,
  bpm: number,
): number {
  let max = 0;
  for (const lp of laneStates.values()) {
    if (!lp.playing) continue;
    const d = clipDurationSec(lp.playing, meter, bpm);
    if (d > max) max = d;
  }
  return max;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/export/scene-duration.test.ts`
Expected: PASS (all 5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/export/scene-duration.ts src/export/scene-duration.test.ts
git commit -m "feat(export): scene-duration (longest sounding clip)"
```

---

## Task 3: WAV encoder (pure)

**Files:**
- Create: `src/export/wav-encoder.ts`
- Test: `src/export/wav-encoder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/wav-encoder.test.ts
import { describe, it, expect } from 'vitest';
import { encodeWavPcm16, wavEncoder } from './wav-encoder';

function readStr(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWavPcm16', () => {
  it('writes a valid 16-bit stereo WAV header', async () => {
    const left = Float32Array.from([0, 0.5, -0.5, 1]);
    const right = Float32Array.from([0, -0.5, 0.5, -1]);
    const blob = encodeWavPcm16([left, right], 48000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);

    expect(readStr(view, 0, 4)).toBe('RIFF');
    expect(readStr(view, 8, 4)).toBe('WAVE');
    expect(readStr(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);        // PCM
    expect(view.getUint16(22, true)).toBe(2);        // stereo
    expect(view.getUint32(24, true)).toBe(48000);    // sample rate
    expect(view.getUint16(34, true)).toBe(16);       // bits/sample
    expect(readStr(view, 36, 4)).toBe('data');
    // 4 frames * 2 ch * 2 bytes = 16 data bytes; file = 44 + 16.
    expect(view.getUint32(40, true)).toBe(16);
    expect(buf.byteLength).toBe(60);
  });

  it('interleaves L/R and round-trips full-scale samples', async () => {
    const left = Float32Array.from([1, -1]);
    const right = Float32Array.from([-1, 1]);
    const buf = await encodeWavPcm16([left, right], 44100).arrayBuffer();
    const view = new DataView(buf);
    // Frame 0: L=+1 → 32767, R=-1 → -32768. Frame 1: L=-1, R=+1.
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(32767);
  });

  it('exposes a wavEncoder AudioEncoder', () => {
    expect(wavEncoder.extension).toBe('wav');
    expect(wavEncoder.mimeType).toBe('audio/wav');
    expect(wavEncoder.encode([Float32Array.of(0)], 48000)).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/export/wav-encoder.test.ts`
Expected: FAIL — `Cannot find module './wav-encoder'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/wav-encoder.ts
// 16-bit PCM WAV encoder for the browser (DataView/Blob, no Node Buffer).
// Channel-major Float32 in, interleaved 16-bit WAV Blob out.

import type { AudioEncoder } from './types';

export function encodeWavPcm16(channels: Float32Array[], sampleRate: number): Blob {
  const numChannels = Math.max(1, channels.length);
  const numFrames = channels.length > 0 ? channels[0].length : 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);           // fmt chunk size
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);           // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const v = channels[ch][i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, v));
      const s = clamped < 0 ? clamped * 32768 : clamped * 32767;
      view.setInt16(offset, Math.round(s), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export const wavEncoder: AudioEncoder = {
  extension: 'wav',
  mimeType: 'audio/wav',
  encode: encodeWavPcm16,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/export/wav-encoder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/wav-encoder.ts src/export/wav-encoder.test.ts
git commit -m "feat(export): browser 16-bit PCM WAV encoder"
```

---

## Task 4: Scene restart helper (pure)

**Files:**
- Create: `src/export/scene-restart.ts`
- Test: `src/export/scene-restart.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/scene-restart.test.ts
import { describe, it, expect } from 'vitest';
import { restartSoundingLanesForExport } from './scene-restart';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import type { SessionClip } from '../session/session';

function clip(id: string): SessionClip {
  return { id, lengthBars: 2, notes: [] };
}

describe('restartSoundingLanesForExport', () => {
  it('queues each sounding lane to restart at startTime and returns their ids', () => {
    const states = new Map<string, LanePlayState>();
    const a = emptyLanePlayState('a'); a.playing = clip('ca');
    const b = emptyLanePlayState('b'); b.playing = clip('cb');
    const idle = emptyLanePlayState('idle'); // playing = null
    states.set('a', a); states.set('b', b); states.set('idle', idle);

    const sounding = restartSoundingLanesForExport(states, 12.5);

    expect(sounding.sort()).toEqual(['a', 'b']);
    expect(a.queued).toBe(a.playing);
    expect(a.queuedBoundary).toBe(12.5);
    expect(b.queued).toBe(b.playing);
    expect(b.queuedBoundary).toBe(12.5);
    // Idle lane untouched.
    expect(idle.queued).toBeNull();
  });

  it('returns an empty list when nothing is playing', () => {
    const states = new Map<string, LanePlayState>();
    states.set('a', emptyLanePlayState('a'));
    expect(restartSoundingLanesForExport(states, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/export/scene-restart.test.ts`
Expected: FAIL — `Cannot find module './scene-restart'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/scene-restart.ts
// Re-anchors every currently-sounding lane so its clip restarts from the top
// at `startTime`. Reuses the runtime's queued→playing promotion (which, on
// crossing queuedBoundary, resets loopStartedAt/lastScheduledAt/nextStepIdx),
// giving the export a clean pass beginning at beat 1.

import type { LanePlayState } from '../session/session-runtime';

/** Sets queued = playing and queuedBoundary = startTime for each sounding lane.
 *  Returns the ids of lanes that were sounding (empty ⇒ nothing to export). */
export function restartSoundingLanesForExport(
  laneStates: Map<string, LanePlayState>,
  startTime: number,
): string[] {
  const sounding: string[] = [];
  for (const lp of laneStates.values()) {
    if (!lp.playing) continue;
    lp.queued = lp.playing;
    lp.queuedBoundary = startTime;
    sounding.push(lp.laneId);
  }
  return sounding;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/export/scene-restart.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/scene-restart.ts src/export/scene-restart.test.ts
git commit -m "feat(export): restart sounding lanes for a clean export pass"
```

---

## Task 5: Download helper

**Files:**
- Create: `src/export/download.ts`

No unit test — this touches the DOM (`document`, `URL.createObjectURL`) and is exercised by the Playwright e2e in Task 9. Keep it minimal.

- [ ] **Step 1: Write the implementation**

```typescript
// src/export/download.ts
// Triggers a browser download of a Blob and builds export filenames.

/** Filesystem-safe UTC timestamp, e.g. "2026-06-04T12-30-00". */
export function exportTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
}

/** Anchor-click download of `blob` as `filename`. Revokes the object URL after. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/export/download.ts
git commit -m "feat(export): blob download helper + export timestamp"
```

---

## Task 6: Recorder worklet source

**Files:**
- Create: `src/export/recorder-worklet.ts`
- Test: `src/export/recorder-worklet.test.ts`

The processor must run inside `AudioWorkletGlobalScope`, so it is authored as a **plain-JS source string** and loaded via a Blob URL (`addModule`). This avoids Vite asset-pipeline pitfalls and works identically in dev, the production `dist/`, and the Playwright e2e. The unit test only sanity-checks the source registers the named processor; real behavior is verified by the e2e.

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/recorder-worklet.test.ts
import { describe, it, expect } from 'vitest';
import { RECORDER_PROCESSOR_NAME, RECORDER_WORKLET_SOURCE } from './recorder-worklet';

describe('recorder worklet source', () => {
  it('registers the named processor', () => {
    expect(RECORDER_PROCESSOR_NAME).toBe('loom-scene-recorder');
    expect(RECORDER_WORKLET_SOURCE).toContain(`registerProcessor('${RECORDER_PROCESSOR_NAME}'`);
    expect(RECORDER_WORKLET_SOURCE).toContain('extends AudioWorkletProcessor');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/export/recorder-worklet.test.ts`
Expected: FAIL — `Cannot find module './recorder-worklet'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/recorder-worklet.ts
// AudioWorklet recorder: taps a 2-channel input, captures only the samples
// whose time falls in [startTime, endTime) (sample-accurate via the global
// `currentTime`/`sampleRate`), then posts the concatenated stereo PCM and
// stops. Authored as a source string so it can load via a Blob URL.

export const RECORDER_PROCESSOR_NAME = 'loom-scene-recorder';

export const RECORDER_WORKLET_SOURCE = `
class LoomSceneRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this._startTime = 0;
    this._endTime = Infinity;
    this._left = [];
    this._right = [];
    this._frames = 0;
    this._done = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'window') {
        this._startTime = e.data.startTime;
        this._endTime = e.data.endTime;
      }
    };
  }
  process(inputs) {
    if (this._done) return false;
    const input = inputs[0];
    const inL = input && input[0] ? input[0] : null;
    if (!inL) return true; // upstream not connected yet this quantum
    const inR = input[1] ? input[1] : inL;
    const n = inL.length;
    const sr = sampleRate;
    const blockStart = currentTime;
    const blockEnd = blockStart + n / sr;
    if (blockEnd > this._startTime && blockStart < this._endTime) {
      let from = 0, to = n;
      if (blockStart < this._startTime) from = Math.ceil((this._startTime - blockStart) * sr);
      if (blockEnd > this._endTime) to = Math.floor((this._endTime - blockStart) * sr);
      if (to > from) {
        this._left.push(inL.slice(from, to));
        this._right.push(inR.slice(from, to));
        this._frames += (to - from);
      }
    }
    if (blockEnd >= this._endTime) {
      const left = new Float32Array(this._frames);
      const right = new Float32Array(this._frames);
      let off = 0;
      for (let k = 0; k < this._left.length; k++) {
        left.set(this._left[k], off);
        right.set(this._right[k], off);
        off += this._left[k].length;
      }
      this._done = true;
      this.port.postMessage(
        { type: 'done', left, right, sampleRate: sr },
        [left.buffer, right.buffer],
      );
      return false;
    }
    return true;
  }
}
registerProcessor('${RECORDER_PROCESSOR_NAME}', LoomSceneRecorder);
`;

let modulePromise: Promise<void> | null = null;

/** Loads the recorder worklet module into `ctx` (once, cached via Blob URL). */
export function ensureRecorderWorklet(ctx: BaseAudioContext): Promise<void> {
  if (!modulePromise) {
    const blob = new Blob([RECORDER_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    modulePromise = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  }
  return modulePromise;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/export/recorder-worklet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export/recorder-worklet.ts src/export/recorder-worklet.test.ts
git commit -m "feat(export): AudioWorklet recorder source + module loader"
```

---

## Task 7: Real-time recorder backend

**Files:**
- Create: `src/export/realtime-recorder.ts`

This is an integration unit (live `AudioContext` + worklet + transport). It is verified end-to-end by the Playwright e2e in Task 9, not a node unit test (the worklet + Blob URL do not run under `node-web-audio-api`).

- [ ] **Step 1: Write the implementation**

```typescript
// src/export/realtime-recorder.ts
// Real-time backend: taps the live master output through the recorder worklet,
// plays the scene once from the top, and resolves with the captured stereo PCM.

import type { RenderedAudio, SceneRecorder } from './types';
import { RECORDER_PROCESSOR_NAME, ensureRecorderWorklet } from './recorder-worklet';

export interface RealtimeRecorderDeps {
  ctx: AudioContext;
  /** Node carrying the full master signal (audio-graph `masterComp.output`). */
  tap: AudioNode;
  /** Seconds to wait after setup before the recording window starts, so the
   *  worklet is live and the scene restart has been queued (e.g. 0.15). */
  leadSec: number;
  /** Called with the absolute window start time; the orchestrator uses it to
   *  restart the sounding lanes and start the transport. */
  onStart: (startTime: number) => void;
}

export class RealtimeSceneRecorder implements SceneRecorder {
  constructor(private deps: RealtimeRecorderDeps) {}

  async record(totalSec: number): Promise<RenderedAudio> {
    const { ctx, tap, leadSec, onStart } = this.deps;
    await ensureRecorderWorklet(ctx);

    const node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });

    const done = new Promise<RenderedAudio>((resolve) => {
      node.port.onmessage = (e: MessageEvent) => {
        const d = e.data as { type: string; left: Float32Array; right: Float32Array; sampleRate: number };
        if (d && d.type === 'done') {
          resolve({ channels: [d.left, d.right], sampleRate: d.sampleRate });
        }
      };
    });

    // Tap into the master output; the node emits silence to destination so it
    // is pulled every quantum without doubling the audible signal.
    tap.connect(node);
    node.connect(ctx.destination);

    const startTime = ctx.currentTime + leadSec;
    const endTime = startTime + totalSec;
    node.port.postMessage({ type: 'window', startTime, endTime });

    // Restart the scene + start the transport so the window captures beat 1.
    onStart(startTime);

    try {
      return await done;
    } finally {
      try { tap.disconnect(node); } catch { /* already torn down */ }
      try { node.disconnect(); } catch { /* already torn down */ }
    }
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/export/realtime-recorder.ts
git commit -m "feat(export): real-time scene recorder (live tap + worklet)"
```

---

## Task 8: Export orchestrator

**Files:**
- Create: `src/export/export-scene.ts`
- Test: `src/export/export-scene.test.ts`

The orchestrator is fully dependency-injected so it is unit-testable in node with a fake `SceneExporter` (no DOM, no audio). It owns the control flow: no-scene guard, busy state, record → encode → download, error reporting, and finish (stop transport).

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/export-scene.test.ts
import { describe, it, expect, vi } from 'vitest';
import { exportCurrentScene, type SceneExporter } from './export-scene';

function fakeExporter(over: Partial<SceneExporter> = {}): SceneExporter {
  return {
    totalSec: () => 4,
    record: vi.fn(async () => ({ channels: [Float32Array.of(0, 0)], sampleRate: 48000 })),
    encode: vi.fn(() => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })),
    download: vi.fn(),
    notify: vi.fn(),
    setBusy: vi.fn(),
    finish: vi.fn(),
    ...over,
  };
}

describe('exportCurrentScene', () => {
  it('notifies and does nothing when no scene is playing', async () => {
    const x = fakeExporter({ totalSec: () => 0 });
    await exportCurrentScene(x);
    expect(x.notify).toHaveBeenCalledWith('Lanzá una escena primero');
    expect(x.record).not.toHaveBeenCalled();
    expect(x.setBusy).not.toHaveBeenCalled();
  });

  it('records, encodes, downloads, then finishes on the happy path', async () => {
    const x = fakeExporter();
    await exportCurrentScene(x);
    expect(x.setBusy).toHaveBeenNthCalledWith(1, true);
    expect(x.record).toHaveBeenCalledWith(4);
    expect(x.encode).toHaveBeenCalledTimes(1);
    expect(x.download).toHaveBeenCalledTimes(1);
    expect(x.finish).toHaveBeenCalledTimes(1);
    expect(x.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('reports errors and still finishes + clears busy', async () => {
    const x = fakeExporter({ record: vi.fn(async () => { throw new Error('boom'); }) });
    await exportCurrentScene(x);
    expect(x.notify).toHaveBeenCalledWith('No se pudo exportar: boom');
    expect(x.download).not.toHaveBeenCalled();
    expect(x.finish).toHaveBeenCalledTimes(1);
    expect(x.setBusy).toHaveBeenLastCalledWith(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/export/export-scene.test.ts`
Expected: FAIL — `Cannot find module './export-scene'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/export-scene.ts
// Orchestrates one scene export. Backend-agnostic: it asks for the total
// duration, records it, encodes, downloads, and finishes (stop transport).
// All side-effecting steps are injected so this is unit-testable.

import type { RenderedAudio } from './types';

export interface SceneExporter {
  /** Total seconds to record (music + tail). 0 ⇒ nothing is playing. */
  totalSec(): number;
  record(totalSec: number): Promise<RenderedAudio>;
  encode(channels: Float32Array[], sampleRate: number): Blob;
  download(blob: Blob): void;
  notify(message: string): void;
  setBusy(busy: boolean): void;
  /** Stop the transport + reset the play button. Always runs after a run. */
  finish(): void;
}

export async function exportCurrentScene(x: SceneExporter): Promise<void> {
  const total = x.totalSec();
  if (total <= 0) {
    x.notify('Lanzá una escena primero');
    return;
  }
  x.setBusy(true);
  try {
    const rendered = await x.record(total);
    const blob = x.encode(rendered.channels, rendered.sampleRate);
    x.download(blob);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    x.notify('No se pudo exportar: ' + msg);
  } finally {
    x.finish();
    x.setBusy(false);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/export/export-scene.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/export-scene.ts src/export/export-scene.test.ts
git commit -m "feat(export): backend-agnostic export orchestrator"
```

---

## Task 9: Wire the UI (button + main.ts) and e2e

**Files:**
- Modify: `index.html` (add the button)
- Modify: `src/main.ts` (build the concrete `SceneExporter` and wire the click)
- Create: `tests/e2e/scene-export.spec.ts`

- [ ] **Step 1: Add the export button to the transport bar**

In `index.html`, immediately after the `#play` button (line 61), add:

```html
        <button id="export-scene" class="io" title="Export the current scene to WAV (real-time)">&#10515; WAV</button>
```

(`&#10515;` is the ⤓ down-arrow glyph. The `io` class matches the existing New/Save/Load buttons.)

- [ ] **Step 2: Wire the button in `src/main.ts`**

Add the imports near the other `./app` / `./core` imports at the top of `src/main.ts`:

```typescript
import { exportCurrentScene, type SceneExporter } from './export/export-scene';
import { RealtimeSceneRecorder } from './export/realtime-recorder';
import { soundingSceneDurationSec } from './export/scene-duration';
import { restartSoundingLanesForExport } from './export/scene-restart';
import { wavEncoder } from './export/wav-encoder';
import { downloadBlob, exportTimestamp } from './export/download';
```

Then, after `wireTransport(transportDeps);` (`src/main.ts:585`), add the export wiring. `masterComp` and `playBtn` and `seq` and `sessionHost` are already in scope:

```typescript
// ── Scene export (real-time WAV) ─────────────────────────────────────────
const exportBtn = $<HTMLButtonElement>('export-scene');
const EXPORT_TAIL_SEC = 2;   // let reverb/delay tails decay before the cut
const EXPORT_LEAD_SEC = 0.15; // worklet spin-up + scene restart lead

const sceneExporter: SceneExporter = {
  totalSec: () => {
    const music = soundingSceneDurationSec(sessionHost.laneStates, seq.meter, seq.bpm);
    return music > 0 ? music + EXPORT_TAIL_SEC : 0;
  },
  record: (totalSec) => {
    void ctx.resume();
    const recorder = new RealtimeSceneRecorder({
      ctx,
      tap: masterComp.output,
      leadSec: EXPORT_LEAD_SEC,
      onStart: (startTime) => {
        restartSoundingLanesForExport(sessionHost.laneStates, startTime);
        if (!seq.isPlaying()) seq.start();
      },
    });
    return recorder.record(totalSec);
  },
  encode: (channels, sampleRate) => wavEncoder.encode(channels, sampleRate),
  download: (blob) => downloadBlob(blob, `loom-scene-${exportTimestamp()}.${wavEncoder.extension}`),
  notify: (msg) => { flashButton(exportBtn, msg); console.warn('[export]', msg); },
  setBusy: (busy) => {
    exportBtn.disabled = busy;
    playBtn.disabled = busy;
    exportBtn.textContent = busy ? 'Grabando…' : '⤓ WAV';
  },
  finish: () => { seq.stop(); playBtn.textContent = '▶'; },
};

exportBtn.addEventListener('click', () => { void exportCurrentScene(sceneExporter); });
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds (e2e serves `dist/`, so this is required before Step 5).

- [ ] **Step 4: Write the e2e test**

```typescript
// tests/e2e/scene-export.spec.ts
import { test, expect } from '@playwright/test';
import { statSync } from 'node:fs';

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('exports the current scene to a .wav download', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  // Launch one clip so a scene is sounding (the click also resumes audio).
  await page.locator('.session-cell-filled .session-cell-play').first().click();
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 2000 });

  // Export. The download fires after the real-time capture window completes
  // (one clip pass + 2s tail), so allow generous time.
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#export-scene').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^loom-scene-.*\.wav$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  expect(statSync(filePath!).size).toBeGreaterThan(44); // header + some PCM
});
```

- [ ] **Step 5: Run the e2e**

Run: `npm run test:e2e -- scene-export`
Expected: PASS — a `.wav` download fires with size > 44 bytes.
(If it fails with "element not found", confirm `npm run build` ran in Step 3 — e2e serves the prebuilt `dist/`.)

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts tests/e2e/scene-export.spec.ts
git commit -m "feat(export): transport-bar export button + real-time wiring + e2e"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS. (If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` *after* all tests pass, that is the known flaky teardown — re-run to confirm green.)

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke (browser)**

Run: `npm run dev`, open http://localhost:5173, launch a scene, click **⤓ WAV**. Expected: button shows "Grabando…", the scene plays one pass, transport stops, a `loom-scene-<ts>.wav` downloads and plays back correctly in an external player.

- [ ] **Step 4: Commit any fixes, then finish the branch**

Per project convention: `git rebase main`, then `git merge --ff-only`, then `ExitWorktree`.

---

## Phase 1 self-review (spec coverage)

- "Current scene = sounding clips" → Tasks 2 & 4 read `lp.playing`. ✅
- "Duration = longest clip + 2s tail, shorter clips loop to fill" → Task 2 (longest) + Task 9 (`EXPORT_TAIL_SEC`); looping is the runtime's existing behavior. ✅
- "Clean start at beat 1 via re-launch" → Task 4 + Task 7 `onStart`. ✅
- "WAV 16-bit stereo now, encoder seam for MP3 later" → Tasks 1 & 3 (`AudioEncoder`). ✅
- "Real-time AudioWorklet tap on master output, no MediaRecorder" → Tasks 6 & 7, tapping `masterComp.output`. ✅
- "Stop transport on finish" → Task 8 `finish()` + Task 9 impl. ✅
- "No scene → disabled/hint" → Task 8 guard (`totalSec()<=0` ⇒ notify). ✅
- "Graceful errors, never break live audio" → Task 7 `finally` disconnect + Task 8 try/catch/finally. ✅
- Testing layers: pure (Tasks 2/3/4/6/8), e2e (Task 9). ✅

---

# Phase 2 — Offline backend (roadmap; separate plan)

**Status:** Not implemented here. Gets its own `writing-plans` pass **after Phase 1 merges**, because its no-placeholder tasks depend on (a) the Phase 1 interfaces below existing, and (b) a deeper read of `src/app/lane-allocator.ts`, `src/core/lane-resources.ts`, and `src/app/trigger-dispatch.ts` to parameterize the audio graph by context.

**What Phase 1 already gives Phase 2 (reused unchanged):** `RenderedAudio`, `SceneRecorder`, `AudioEncoder`/`wavEncoder`, `soundingSceneDurationSec`, `downloadBlob`, and the `exportCurrentScene` orchestrator. The offline backend is simply a second class implementing `SceneRecorder.record(totalSec)` that returns `RenderedAudio` — the orchestrator, encoder, download, and duration code do not change.

**Architecture (from the spec):**

1. **`buildOfflineGraph(offlineCtx, state)`** — instantiate against an `OfflineAudioContext(2, (music+tail)·sr, sr)`: `master → masterInsertChain → masterComp → offlineCtx.destination`, the `SidechainBus`, and per sounding lane its strip + engine + insert chain. This requires **parameterizing `createAudioGraph` and `createLaneAllocator` by an `AudioContext`/`BaseAudioContext`** (today they assume the live `ctx`). `engine.createVoice(ctx, output)` is already context-agnostic.
2. **Shared note-expansion** — **extract the note→event math from `tickLane`** (`src/core/lane-scheduler.ts`) into a pure function that yields `{ midi, scheduleTime, gateSec, accent, slidingIn }` for a clip across `[0, music)`, looping shorter clips to fill. Use it from **both** the live `tickSession` and the offline batch scheduler so slide/accent/gate rules are not duplicated.
3. **`scheduleSceneOffline(...)`** — for each sounding lane, expand its clip's notes across the window and call `voice.trigger(...)` at absolute offline times; then `await offlineCtx.startRendering()`.
4. **Sampler preload** — `await` the decoded-buffer cache for any sounding Sampler lane before rendering (IndexedDB is async).
5. **UI** — convert the single `#export-scene` button into a small menu: **"Tiempo real"** (default, the Phase 1 backend) and **"Offline (rápido)"** (this backend). Real-time stays the default.

**Acceptance gate:** an **A↔C parity test** — render the same scene through both backends and assert relative RMS/peak closeness (reuse the `wav-diff` approach), tolerating noise/karplus randomness. Plus a `*.dsp.test.ts` that renders a known scene offline and asserts non-silent, relatively-correct energy.

**Risk to document:** any engine using `ScriptProcessorNode` will not render correctly offline (AudioWorklets do, but need `addModule` on the offline context). Detect or document per-engine.
