# Scene Audio Export — Phase 2 (Offline Render) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second scene-export backend that renders the currently-playing scene through an `OfflineAudioContext` (faster than real-time), reusing the Phase 1 pipeline, and surface it as an "Offline (rápido)" option alongside the default "Tiempo real".

**Architecture:** Reuse the existing context-portable factories against an offline context. Extract `buildAudioGraph(ctx)` from `createAudioGraph`; stand up a parallel offline graph + a second `createLaneAllocator` bound to the offline ctx; `ensureLaneResource` each sounding lane; apply each lane's `engineState` via a shared `applyLaneEngineState` (extracted from `SessionHost`); preload sampler buffers + drumkits; batch-schedule every note by reusing `tickLane`; reuse `createTriggerForLane` to fire voices; `await offlineCtx.startRendering()` → `AudioBuffer` → the **same** Phase 1 `AudioEncoder` + download. The offline backend implements the Phase 1 `SceneRecorder` interface, so `exportCurrentScene`, the WAV encoder, and the download all stay unchanged.

**Tech Stack:** TypeScript, Web Audio (`OfflineAudioContext`), Vite, Vitest (+ `node-web-audio-api` for offline DSP tests), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-04-scene-audio-export-design.md` (Phase 2 section)

---

## Key facts verified by exploration

- **No engine uses `AudioWorkletNode` / `ScriptProcessorNode`.** The only worklet is Phase 1's recorder. Every engine + the whole mix chain takes a `ctx`/`BaseAudioContext` and renders offline. (Grep confirmed: worklet usage only in `src/export/realtime-recorder.ts` + `recorder-worklet.ts`; `fx.ts:188` uses an `AnalyserNode` for metering — harmless offline.)
- `createAudioGraph()` (`src/app/audio-graph.ts:18-33`) hardcodes `new AudioContext()`. Everything else it builds (`master` gain, `MasterCompressor`, `InsertChain`, `FxBus`, `SidechainBus`, `analyser`) is constructed from that ctx and is context-portable.
- `createLaneAllocator(deps)` (`src/app/lane-allocator.ts:108`) captures `deps.ctx` once and builds every lane's `ChannelStrip` + `InsertChain` + engine from it. `deps: { ctx, master, fx, sidechainBus, getBpm, extraIds }`. `ensureLaneResource(laneId, engineId)` is the sole alloc path.
- `createTriggerForLane({ ctx, laneResources, seq })` (`src/app/trigger-dispatch.ts:19`) fires a note by `res.engine.createVoice(ctx, res.strip.input)` then `v.trigger(...)`. It reads the **global** note-FX registry via `getNoteFxChain(laneId)`. Reusable offline with offline deps (the live transport must be stopped during render so the shared note-FX registry isn't mutated concurrently).
- `tickLane(clip, ctx)` (`src/core/lane-scheduler.ts:68`) is pure: with `now=0, loopStartedAt=0, lastScheduledAt=-Infinity, lookaheadSec=windowSec` it emits **every** note in `[0, windowSec)` via `ctx.onTrigger(note, scheduleTime)`.
- The slide/accent/gate math lives in `tickSession`'s `onTrigger` wrapper (`src/session/session-runtime.ts:220-242`): `accent = velocity >= 100`; `gateSec = max(0.01, duration * secPerTick(bpm))` where `secPerTick(bpm) = (60/bpm)/TICKS_PER_STEP`; `slidingIn` (tb303 only) = some other note overlaps this note's start tick.
- `SessionHost.applyEngineState` (`src/session/session-host.ts:306-361`) applies, per lane, in order: `setKitMode(kitMode ?? 'synth')`, `setBaseValue(id, v)` for each `engineState.params`, `modulators.deserialize(mods)`, `loadNoteFxForLane(laneId, noteFx)`, `setKeymap(km)`, async `reloadDrumkit(laneId, drumkitId, engine)`, `setPadStore(padParams)`, `setDrumVoiceMutes(drumMutes)`. All feature-detected. `reloadDrumkit` = `setKeymap(await loadDrumkit(await fetchDrumkitManifest(kitId), ctx))` + `mirrorKeymapChange`.
- Preload APIs: `sampleCache.ensureLoaded(ctx, id, store)` (async, decodes from `sampleStore`; cached buffers are reused) — `src/samples/sample-cache.ts:18`. `fetchDrumkitManifest(id)` + `loadDrumkit(manifest, ctx)` — `src/samples/drumkit-loader.ts:80,88`. `sampleStore` singleton — `src/samples/sample-store.ts`. `KeymapEntry.sampleId` carries the id.
- `loadNoteFxForLane(laneId, state)` — `src/notefx/notefx-registry.ts:17`.
- Offline DSP tests: `node-web-audio-api` globalizes `OfflineAudioContext` in `test/setup.ts`, so `*.dsp.test.ts` can `new OfflineAudioContext(...)` and `startRendering()`.
- Phase 1 contracts (already on this branch's base): `src/export/types.ts` → `RenderedAudio`, `SceneRecorder { record(totalSec): Promise<RenderedAudio> }`. `src/export/export-scene.ts` → `exportCurrentScene(x: SceneExporter)`, `SceneExporter { totalSec(); record(totalSec); encode(...); download(...); notify(...); setBusy(...); finish() }`. `src/export/scene-duration.ts` → `soundingSceneDurationSec(laneStates, meter, bpm)`. `src/export/wav-encoder.ts` → `wavEncoder`. Phase 1 wiring is in `src/main.ts` (the `sceneExporter` object + `#export-scene` button).

## Parity / testing note

The real-time backend (A) cannot run under Node (AudioWorklet is unavailable in `node-web-audio-api`), so an automated A↔C parity unit test is not possible. Phase 2's automated test is an **offline-render correctness** DSP test (Task 7). **A↔C parity** is verified in the browser (export the same scene both ways and compare with `npm run test:wav-diff`, or by ear) — documented, not automated.

## Scope (v1)

In scope: engines + per-lane `ChannelStrip` (EQ / pan / level / reverb+delay sends) + master `InsertChain` + `MasterCompressor` + `SidechainBus` + per-lane/master **insert plugin slots** (reproduced via `rehydrateInsertChain` — Task 6) → full parity with the live mix. Currently-playing clips only (same source as Phase 1). Duration = Phase 1's `soundingSceneDurationSec` + tail.

Out of scope (v1): exporting a non-playing scene; stems; bit depths other than 16-bit (the encoder seam already allows it later); per-clip envelope automation (the live tick keeps it minimal too).

## File structure

| File | Responsibility |
|------|----------------|
| `src/app/audio-graph.ts` (modify) | Extract `buildAudioGraph(ctx: AudioContext): AudioGraph`; `createAudioGraph()` = `buildAudioGraph(new AudioContext())`. |
| `src/core/lane-scheduler.ts` (modify) | Add pure `noteTrigger(...)` helper computing `{gateSec, accent, slidingIn}` (extracted so live tick + offline collector share it). |
| `src/session/session-runtime.ts` (modify) | `tickSession` uses the extracted `noteTrigger` helper (no behaviour change). |
| `src/export/collect-scene-triggers.ts` (create) | Pure: `collectSceneTriggers(state, soundingClipByLane, bpm, meter, windowSec)` → flat `OfflineTrigger[]` via `tickLane`. |
| `src/export/apply-lane-engine-state.ts` (create) | `applyLaneEngineState(engine, lane, ctx): Promise<void>` (extracted from `SessionHost`, awaits drumkit reload). |
| `src/session/session-host.ts` (modify) | `applyEngineState` calls the shared `applyLaneEngineState`. |
| `src/export/preload-scene-samples.ts` (create) | `preloadSceneSamples(ctx, lanes): Promise<void>` — ensure all referenced sample buffers are decoded. |
| `src/export/offline-recorder.ts` (create) | `OfflineSceneRecorder implements SceneRecorder` — build graph, apply state, preload, schedule, render. |
| `src/main.ts` (modify) | Add the offline backend to the export wiring + a backend menu. |
| `index.html` (modify) | Replace the single export button with a menu (Tiempo real / Offline). |
| `src/export/collect-scene-triggers.test.ts` (create) | Vitest for the pure collector. |
| `src/export/apply-lane-engine-state.test.ts` (create) | Vitest for the shared apply helper (fake engine). |
| `src/export/offline-recorder.dsp.test.ts` (create) | DSP render correctness. |
| `tests/e2e/scene-export-offline.spec.ts` (create) | Playwright: export via the Offline option downloads a `.wav`. |

---

## Task 1: Extract `buildAudioGraph(ctx)`

**Files:**
- Modify: `src/app/audio-graph.ts`

- [ ] **Step 1: Read the current file**

Current `src/app/audio-graph.ts:18-33`:
```typescript
export function createAudioGraph(): AudioGraph {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.connect(ctx.destination);
  const masterComp = new MasterCompressor(ctx);
  masterComp.output.connect(analyser);
  const masterInsertChain = new InsertChain(master, masterComp.input);
  const fx = new FxBus(ctx, master);
  const sidechainBus = new SidechainBus();
  return { ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus };
}
```

- [ ] **Step 2: Replace it with an extracted builder**

```typescript
/** Build the master audio graph against ANY context (live or offline). The
 *  analyser is wired to ctx.destination so the master signal reaches the
 *  output (or the offline render target). */
export function buildAudioGraph(ctx: AudioContext): AudioGraph {
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.connect(ctx.destination);
  const masterComp = new MasterCompressor(ctx);
  masterComp.output.connect(analyser);
  // master → InsertChain → masterComp → analyser → destination
  const masterInsertChain = new InsertChain(master, masterComp.input);
  const fx = new FxBus(ctx, master);
  const sidechainBus = new SidechainBus();
  return { ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus };
}

export function createAudioGraph(): AudioGraph {
  return buildAudioGraph(new AudioContext());
}
```

- [ ] **Step 3: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `NO_COLOR=1 npx vitest run src/app/audio-graph.test.ts`
Expected: PASS (the existing audio-graph test still passes — behaviour is unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/app/audio-graph.ts
git commit -m "refactor(audio-graph): extract buildAudioGraph(ctx) for offline reuse"
```

---

## Task 2: Extract the pure note-trigger math

**Files:**
- Modify: `src/core/lane-scheduler.ts`
- Modify: `src/session/session-runtime.ts`
- Test: `src/core/lane-scheduler.test.ts` (add cases)

The slide/accent/gate computation currently lives inline in `tickSession`. Extract it into a pure helper so the offline collector reuses the exact same rules.

- [ ] **Step 1: Add a failing test** in `src/core/lane-scheduler.test.ts` (append inside the existing file):

```typescript
import { noteTrigger } from './lane-scheduler';
import type { SessionClip } from '../session/session';

describe('noteTrigger', () => {
  const clip: SessionClip = {
    id: 'c', lengthBars: 1,
    // two overlapping tb303 notes: note A (tick 0, dur 48) overlaps note B (tick 24)
    notes: [
      { start: 0, duration: 48, midi: 36, velocity: 80 },
      { start: 24, duration: 12, midi: 38, velocity: 110 },
    ],
  };

  it('marks accent when velocity >= 100', () => {
    const a = noteTrigger('tb303', clip, clip.notes[0], 0, 0, 120, undefined);
    const b = noteTrigger('tb303', clip, clip.notes[1], 0.25, 0, 120, undefined);
    expect(a.accent).toBe(false);
    expect(b.accent).toBe(true);
  });

  it('gateSec = duration * secPerTick(bpm), floored at 0.01', () => {
    // bpm 120 → secPerTick = (60/120)/24 = 0.0208333; dur 48 → 1.0s
    const a = noteTrigger('tb303', clip, clip.notes[0], 0, 0, 120, undefined);
    expect(a.gateSec).toBeCloseTo(48 * ((60 / 120) / 24), 6);
  });

  it('slidingIn only for tb303 when a prior note overlaps this start', () => {
    // note B starts at tick 24; note A (0..48) overlaps tick 24 → B slides in (tb303)
    const bTb = noteTrigger('tb303', clip, clip.notes[1], 0.25, 0, 120, undefined);
    const bSub = noteTrigger('subtractive', clip, clip.notes[1], 0.25, 0, 120, undefined);
    expect(bTb.slidingIn).toBe(true);
    expect(bSub.slidingIn).toBe(false);
  });
});
```

- [ ] **Step 2: Run it (fails — `noteTrigger` not exported)**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: FAIL — `noteTrigger is not a function` / not exported.

- [ ] **Step 3: Add `noteTrigger` to `src/core/lane-scheduler.ts`** (append after `tickLane`):

```typescript
import type { NoteEvent } from './notes';

export interface NoteTrigger {
  midi: number;
  gateSec: number;
  accent: boolean;
  slidingIn: boolean;
}

/** Seconds per tick at the given bpm (16 steps/bar × TICKS_PER_STEP ticks/step). */
function secPerTickLocal(bpm: number): number {
  return (60 / bpm) / TICKS_PER_STEP;
}

/**
 * Pure note → trigger-shape computation, shared by the live tick (tickSession)
 * and the offline batch collector. `scheduleTime` is the absolute audio time;
 * `loopStart` is the absolute time the current clip iteration began.
 */
export function noteTrigger(
  engineId: string,
  clip: SessionClip,
  note: { midi: number; duration: number; velocity: number },
  scheduleTime: number,
  loopStart: number,
  bpm: number,
  meter: TimeSignature | undefined,
): NoteTrigger {
  const m = meter ?? DEFAULT_METER;
  const tickSec = secPerTickLocal(bpm);
  const accent = note.velocity >= 100;
  const gateSec = Math.max(0.01, note.duration * tickSec);
  const scheduledStartTick = Math.round((scheduleTime - loopStart) / tickSec)
    % (clip.lengthBars * ticksPerBar(m));
  const slidingIn = engineId === 'tb303'
    && (clip.notes as NoteEvent[]).some(
      (other) => other.start < scheduledStartTick
        && (other.start + other.duration) > scheduledStartTick + 1,
    );
  return { midi: note.midi, gateSec, accent, slidingIn };
}
```

Add the needed imports at the top of `lane-scheduler.ts` if missing: `ticksPerBar` from `./meter` (it already imports `quartersPerBar, DEFAULT_METER, type TimeSignature` — add `ticksPerBar`), and `TICKS_PER_STEP` from `./notes` (already imported).

- [ ] **Step 4: Run the test (passes)**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Make `tickSession` use the helper** — in `src/session/session-runtime.ts`, replace the inline accent/gate/slide computation inside the `onTrigger` callback (lines ~222-237) with a call to `noteTrigger`. Change the `onTrigger` body from the existing inline block to:

```typescript
      onTrigger: (note, scheduleTime) => {
        if (scheduleTime > lp.lastScheduledAt) lp.lastScheduledAt = scheduleTime;
        const t = noteTrigger(lane.engineId, clip, note, scheduleTime, currentLoopStart, bpm, meter);
        const tickSec = secPerTick(bpm);
        const scheduledStartTick = Math.round((scheduleTime - currentLoopStart) / tickSec)
          % (clip.lengthBars * ticksPerBar(meter));
        onLaneTrigger(lane.id, t.midi, scheduleTime, t.gateSec, t.accent, t.slidingIn, note.sample);
        onClipStepFired(lane.id, clip.id, Math.floor(scheduledStartTick / TICKS_PER_STEP), scheduleTime);
      },
```

Add `import { tickLane, noteTrigger } from '../core/lane-scheduler';` (extend the existing import). `secPerTick`, `ticksPerBar`, `TICKS_PER_STEP` are already in scope in that file.

- [ ] **Step 6: Run the runtime + scheduler tests (no behaviour change)**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime.test.ts src/core/lane-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts src/session/session-runtime.ts
git commit -m "refactor(scheduler): extract pure noteTrigger() shared by live tick + offline"
```

---

## Task 3: Pure scene-trigger collector

**Files:**
- Create: `src/export/collect-scene-triggers.ts`
- Test: `src/export/collect-scene-triggers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/collect-scene-triggers.test.ts
import { describe, it, expect } from 'vitest';
import { collectSceneTriggers } from './collect-scene-triggers';
import type { SessionClip } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

const clip = (id: string, lengthBars: number, notes: SessionClip['notes']): SessionClip =>
  ({ id, lengthBars, notes });

describe('collectSceneTriggers', () => {
  it('emits one trigger per note for a single-bar clip rendered once', () => {
    // 1 bar @120 4/4 = 2s. Two notes at tick 0 and tick 48 (= beat 2).
    const c = clip('a', 1, [
      { start: 0, duration: 24, midi: 60, velocity: 80 },
      { start: 48, duration: 24, midi: 64, velocity: 110 },
    ]);
    const triggers = collectSceneTriggers(
      [{ laneId: 'L', engineId: 'subtractive', clip: c }],
      120, DEFAULT_METER, 2.0,
    );
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toMatchObject({ laneId: 'L', midi: 60, accent: false });
    expect(triggers[0].time).toBeCloseTo(0, 6);
    expect(triggers[1]).toMatchObject({ midi: 64, accent: true });
    expect(triggers[1].time).toBeCloseTo(1.0, 6); // tick 48 = beat 2 @120 = 1.0s
  });

  it('loops a shorter clip to fill the window', () => {
    // 1-bar (2s) clip, window 4s → note fires at 0s and 2s.
    const c = clip('a', 1, [{ start: 0, duration: 24, midi: 60, velocity: 80 }]);
    const triggers = collectSceneTriggers(
      [{ laneId: 'L', engineId: 'subtractive', clip: c }], 120, DEFAULT_METER, 4.0,
    );
    expect(triggers.map((t) => Number(t.time.toFixed(3)))).toEqual([0, 2]);
  });

  it('sorts triggers across lanes by time', () => {
    const a = clip('a', 1, [{ start: 24, duration: 24, midi: 60, velocity: 80 }]); // 0.5s
    const b = clip('b', 1, [{ start: 0, duration: 24, midi: 40, velocity: 80 }]);  // 0.0s
    const triggers = collectSceneTriggers(
      [{ laneId: 'A', engineId: 'subtractive', clip: a },
       { laneId: 'B', engineId: 'tb303', clip: b }],
      120, DEFAULT_METER, 2.0,
    );
    expect(triggers.map((t) => t.laneId)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `NO_COLOR=1 npx vitest run src/export/collect-scene-triggers.test.ts`
Expected: FAIL — `Cannot find module './collect-scene-triggers'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/collect-scene-triggers.ts
// Pure: expand every sounding clip's notes across the render window [0, windowSec)
// into a time-sorted flat list of triggers. Reuses tickLane (one call per clip
// with lookahead = the whole window) and noteTrigger for slide/accent/gate, so
// the offline render matches the live scheduler exactly.

import type { SessionClip, ClipSample } from '../session/session';
import { tickLane, noteTrigger } from '../core/lane-scheduler';
import type { TimeSignature } from '../core/meter';

export interface SoundingLaneClip {
  laneId: string;
  engineId: string;
  clip: SessionClip;
}

export interface OfflineTrigger {
  laneId: string;
  midi: number;
  time: number;       // absolute offline seconds
  gateSec: number;
  accent: boolean;
  slidingIn: boolean;
  sample?: ClipSample;
}

export function collectSceneTriggers(
  lanes: SoundingLaneClip[],
  bpm: number,
  meter: TimeSignature,
  windowSec: number,
): OfflineTrigger[] {
  const out: OfflineTrigger[] = [];
  for (const { laneId, engineId, clip } of lanes) {
    tickLane(clip, {
      bpm,
      lookaheadSec: windowSec,
      now: 0,
      loopStartedAt: 0,
      lastScheduledAt: -Infinity,
      meter,
      onTrigger: (note, scheduleTime) => {
        if (scheduleTime >= windowSec) return;
        const t = noteTrigger(engineId, clip, note, scheduleTime, 0, bpm, meter);
        out.push({
          laneId,
          midi: t.midi,
          time: scheduleTime,
          gateSec: t.gateSec,
          accent: t.accent,
          slidingIn: t.slidingIn,
          sample: note.sample,
        });
      },
      onAutomation: () => { /* envelopes are out of scope for offline v1 */ },
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `NO_COLOR=1 npx vitest run src/export/collect-scene-triggers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/collect-scene-triggers.ts src/export/collect-scene-triggers.test.ts
git commit -m "feat(export): pure scene-trigger collector (tickLane batch over the window)"
```

---

## Task 4: Shared `applyLaneEngineState`

**Files:**
- Create: `src/export/apply-lane-engine-state.ts`
- Modify: `src/session/session-host.ts`
- Test: `src/export/apply-lane-engine-state.test.ts`

Extract the per-lane apply body from `SessionHost.applyEngineState` so the offline renderer applies sound state through the exact same path. The offline variant must **await** the drumkit reload (live is fire-and-forget).

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/apply-lane-engine-state.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applyLaneEngineState } from './apply-lane-engine-state';
import type { SessionLane } from '../session/session';

function fakeEngine() {
  return {
    calls: [] as string[],
    setKitMode: vi.fn(function (this: any, m: string) { this.calls.push(`kit:${m}`); }),
    setBaseValue: vi.fn(function (this: any, id: string, v: number) { this.calls.push(`p:${id}=${v}`); }),
    modulators: { deserialize: vi.fn() },
    setKeymap: vi.fn(),
    setPadStore: vi.fn(),
    setDrumVoiceMutes: vi.fn(),
  };
}

const ctx = {} as AudioContext;

describe('applyLaneEngineState', () => {
  it('applies params, modulators, mutes via feature-detected calls', async () => {
    const eng = fakeEngine();
    const lane: SessionLane = {
      id: 'drums-1', engineId: 'drums-machine', clips: [],
      engineState: {
        kitMode: 'synth',
        params: { 'bus.level': 0.8 },
        modulators: [{ kind: 'lfo' } as any],
        drumMutes: { kick: true },
      },
    };
    await applyLaneEngineState(eng as any, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit: vi.fn() });
    expect(eng.setKitMode).toHaveBeenCalledWith('synth');
    expect(eng.setBaseValue).toHaveBeenCalledWith('bus.level', 0.8);
    expect(eng.modulators.deserialize).toHaveBeenCalledWith(lane.engineState!.modulators);
    expect(eng.setDrumVoiceMutes).toHaveBeenCalledWith({ kick: true });
  });

  it('defaults kitMode to synth when absent', async () => {
    const eng = fakeEngine();
    const lane: SessionLane = { id: 'l', engineId: 'drums-machine', clips: [] };
    await applyLaneEngineState(eng as any, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit: vi.fn() });
    expect(eng.setKitMode).toHaveBeenCalledWith('synth');
  });

  it('awaits the drumkit reload when a drumkitId is present', async () => {
    const eng = fakeEngine();
    const reloadDrumkit = vi.fn(async () => { /* resolves */ });
    const lane: SessionLane = {
      id: 'l', engineId: 'sampler', clips: [],
      engineState: { sampler: { keymap: [], drumkitId: 'tr808' } },
    };
    await applyLaneEngineState(eng as any, lane, ctx, { loadNoteFx: vi.fn(), reloadDrumkit });
    expect(reloadDrumkit).toHaveBeenCalledWith('l', 'tr808', eng);
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `NO_COLOR=1 npx vitest run src/export/apply-lane-engine-state.test.ts`
Expected: FAIL — `Cannot find module './apply-lane-engine-state'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/apply-lane-engine-state.ts
// Apply a lane's persisted engineState onto an engine instance. Extracted from
// SessionHost.applyEngineState so the live host and the offline renderer use one
// path. `reloadDrumkit` is injected (live: fire-and-forget; offline: awaited).

import type { SessionLane } from '../session/session';
import type { NoteFxState } from '../notefx/notefx-types';
import type { KeymapEntry } from '../samples/types';

export interface ApplyLaneEngineStateDeps {
  loadNoteFx: (laneId: string, state: NoteFxState[] | undefined) => void;
  reloadDrumkit: (
    laneId: string,
    kitId: string,
    engine: { setKeymap(k: KeymapEntry[]): void },
  ) => void | Promise<void>;
}

// Structural type of the bits of an engine we touch (all feature-detected).
type AnyEngine = {
  setKitMode?(m: 'synth' | 'sample'): void;
  setBaseValue(id: string, v: number): void;
  modulators?: { deserialize(s: unknown[]): void };
  setKeymap?(k: KeymapEntry[]): void;
  setPadStore?(s: Record<number, Record<string, number>>): void;
  setDrumVoiceMutes?(m: Record<string, boolean>): void;
};

export async function applyLaneEngineState(
  engine: AnyEngine,
  lane: SessionLane,
  _ctx: AudioContext,
  deps: ApplyLaneEngineStateDeps,
): Promise<void> {
  const es = lane.engineState;

  if (typeof engine.setKitMode === 'function') {
    engine.setKitMode(es?.kitMode ?? 'synth');
  }
  const params = es?.params;
  if (params) {
    for (const [id, v] of Object.entries(params)) {
      if (typeof v === 'number') engine.setBaseValue(id, v);
    }
  }
  const mods = es?.modulators;
  if (mods && engine.modulators) engine.modulators.deserialize(mods);

  deps.loadNoteFx(lane.id, es?.noteFx);

  const km = es?.sampler?.keymap;
  if (km && typeof engine.setKeymap === 'function') engine.setKeymap(km);

  const drumkitId = es?.sampler?.drumkitId;
  if (drumkitId && typeof engine.setKeymap === 'function') {
    await deps.reloadDrumkit(lane.id, drumkitId, engine as { setKeymap(k: KeymapEntry[]): void });
  }

  const padParams = es?.sampler?.padParams;
  if (padParams && typeof engine.setPadStore === 'function') engine.setPadStore(padParams);

  const drumMutes = es?.drumMutes;
  if (drumMutes && typeof engine.setDrumVoiceMutes === 'function') engine.setDrumVoiceMutes(drumMutes);
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `NO_COLOR=1 npx vitest run src/export/apply-lane-engine-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Make `SessionHost.applyEngineState` use the shared helper.** In `src/session/session-host.ts`, replace the per-lane body of `applyEngineState` (lines 307-360) with a call to the shared helper, preserving live fire-and-forget for the drumkit reload:

```typescript
  private applyEngineState(): void {
    for (const lane of this.state.lanes) {
      const engine = this.deps.laneResources?.get(lane.id)?.engine;
      if (!engine) continue;
      void applyLaneEngineState(engine as never, lane, this.deps.ctx, {
        loadNoteFx: (laneId, state) => loadNoteFxForLane(laneId, state),
        // Live: fire-and-forget (the editor renders regardless; audio comes
        // alive once the fetch/decode resolves).
        reloadDrumkit: (laneId, kitId, eng) => { void this.reloadDrumkit(laneId, kitId, eng); },
      });
    }
  }
```

Add `import { applyLaneEngineState } from '../export/apply-lane-engine-state';` to `session-host.ts`. (`loadNoteFxForLane` is already imported there.)

- [ ] **Step 6: Verify the live path still works**

Run: `NO_COLOR=1 npx vitest run src/session/session-engine-state.test.ts src/session/session-host-sample-restore.test.ts src/session/session-host-kitmode.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/export/apply-lane-engine-state.ts src/export/apply-lane-engine-state.test.ts src/session/session-host.ts
git commit -m "refactor(export): shared applyLaneEngineState for live host + offline render"
```

---

## Task 5: Preload scene samples + drumkits

**Files:**
- Create: `src/export/preload-scene-samples.ts`
- Test: `src/export/preload-scene-samples.test.ts`

Offline render must have every referenced sample buffer decoded **before** `startRendering()` (sampler voices read synchronously from `sampleCache`). Enumerate sampleIds from each sounding lane's keymap + clip samples and ensure them; drumkit lanes are handled by `applyLaneEngineState`'s awaited `reloadDrumkit`, so only non-kit sample references need explicit preload here.

> **Insert slots note:** per-lane `lane.inserts` and `state.masterInserts` are insert *plugin* slots, NOT applied by `applyLaneEngineState`. They ARE reproduced offline by `rehydrateInsertChain(ctx, chain, slots)` (`src/session/insert-slot.ts:27`) — a pure, ctx-portable function the live `SessionHost` already uses on load (`session-host.ts:268,281`). Task 6 calls it on the offline lane chains + master chain, so offline reaches full mix parity.

- [ ] **Step 1: Write the failing test**

```typescript
// src/export/preload-scene-samples.test.ts
import { describe, it, expect, vi } from 'vitest';
import { collectSampleIds } from './preload-scene-samples';
import type { SessionLane } from '../session/session';

describe('collectSampleIds', () => {
  it('gathers keymap sampleIds and clip-sample ids from sounding lanes', () => {
    const lanes: SessionLane[] = [
      {
        id: 'samp', engineId: 'sampler', clips: [
          { id: 'c1', lengthBars: 1, notes: [], sample: { sampleId: 'loopA', mode: 'loop', trimStart: 0, trimEnd: 1 } },
        ],
        engineState: { sampler: { keymap: [
          { sampleId: 'kick', rootNote: 60, loNote: 60, hiNote: 60 },
          { sampleId: 'snare', rootNote: 62, loNote: 62, hiNote: 62 },
        ] } },
      },
    ];
    const ids = collectSampleIds(lanes);
    expect([...ids].sort()).toEqual(['kick', 'loopA', 'snare']);
  });

  it('returns empty for a pure-synth lane', () => {
    const lanes: SessionLane[] = [{ id: 'b', engineId: 'tb303', clips: [{ id: 'c', lengthBars: 1, notes: [] }] }];
    expect(collectSampleIds(lanes).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `NO_COLOR=1 npx vitest run src/export/preload-scene-samples.test.ts`
Expected: FAIL — `Cannot find module './preload-scene-samples'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/export/preload-scene-samples.ts
// Ensure every sample buffer referenced by the sounding lanes is decoded into
// the shared sampleCache before an offline render. Drumkit lanes decode via
// applyLaneEngineState's awaited reloadDrumkit; this covers keymap one-shots and
// clip (loop/song) samples.

import type { SessionLane } from '../session/session';
import { sampleCache } from '../samples/sample-cache';
import { sampleStore } from '../samples/store-singleton';

/** All distinct sampleIds referenced by the given lanes' keymaps + clip samples. */
export function collectSampleIds(lanes: SessionLane[]): Set<string> {
  const ids = new Set<string>();
  for (const lane of lanes) {
    for (const entry of lane.engineState?.sampler?.keymap ?? []) {
      if (entry.sampleId) ids.add(entry.sampleId);
    }
    for (const clip of lane.clips) {
      if (clip?.sample?.sampleId) ids.add(clip.sample.sampleId);
    }
  }
  return ids;
}

/** Decode all referenced sample buffers into sampleCache (no-op for ids already
 *  cached). Missing ids are skipped silently — the voice simply stays quiet. */
export async function preloadSceneSamples(ctx: AudioContext, lanes: SessionLane[]): Promise<void> {
  const ids = collectSampleIds(lanes);
  await Promise.all([...ids].map((id) => sampleCache.ensureLoaded(ctx, id, sampleStore)));
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `NO_COLOR=1 npx vitest run src/export/preload-scene-samples.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/preload-scene-samples.ts src/export/preload-scene-samples.test.ts
git commit -m "feat(export): preload sounding-lane sample buffers for offline render"
```

---

## Task 6: Offline scene recorder

**Files:**
- Create: `src/export/offline-recorder.ts`

This assembles everything and implements the Phase 1 `SceneRecorder`. It is integration code verified by the DSP test in Task 7 (not a standalone unit test).

- [ ] **Step 1: Write the implementation**

```typescript
// src/export/offline-recorder.ts
// Offline backend: rebuild the master graph + the sounding lanes against an
// OfflineAudioContext, apply each lane's sound state, preload samples, batch-
// schedule every note, then render. Implements the Phase 1 SceneRecorder so the
// orchestrator/encoder/download are reused unchanged.

import type { RenderedAudio, SceneRecorder } from './types';
import type { SessionState, SessionClip } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';
import type { TimeSignature } from '../core/meter';
import { buildAudioGraph } from '../app/audio-graph';
import { createLaneAllocator } from '../app/lane-allocator';
import { createTriggerForLane } from '../app/trigger-dispatch';
import { applyLaneEngineState } from './apply-lane-engine-state';
import { preloadSceneSamples } from './preload-scene-samples';
import { collectSceneTriggers, type SoundingLaneClip } from './collect-scene-triggers';
import { loadNoteFxForLane } from '../notefx/notefx-registry';
import { fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { mirrorKeymapChange } from '../session/session-engine-state';
import { rehydrateInsertChain } from '../session/insert-slot';
import type { KeymapEntry } from '../samples/types';

export interface OfflineRecorderDeps {
  state: SessionState;
  laneStates: Map<string, LanePlayState>;
  bpm: number;
  meter: TimeSignature;
  sampleRate?: number; // default 48000
}

export class OfflineSceneRecorder implements SceneRecorder {
  constructor(private deps: OfflineRecorderDeps) {}

  async record(totalSec: number): Promise<RenderedAudio> {
    const { state, laneStates, bpm, meter } = this.deps;
    const sampleRate = this.deps.sampleRate ?? 48000;

    // 1) The sounding lanes = lanes whose lp.playing is set, with that clip.
    const sounding: { laneId: string; engineId: string; clip: SessionClip }[] = [];
    for (const lane of state.lanes) {
      const lp = laneStates.get(lane.id);
      if (lp?.playing) sounding.push({ laneId: lane.id, engineId: lane.engineId, clip: lp.playing });
    }
    const frames = Math.max(1, Math.ceil(totalSec * sampleRate));
    const offlineCtx = new OfflineAudioContext(2, frames, sampleRate);

    // 2) Parallel master graph + lane allocator against the offline ctx.
    const graph = buildAudioGraph(offlineCtx as unknown as AudioContext);
    const lanes = createLaneAllocator({
      ctx: offlineCtx as unknown as AudioContext,
      master: graph.master,
      fx: graph.fx,
      sidechainBus: graph.sidechainBus,
      getBpm: () => bpm,
      extraIds: [],
    });

    // 3) Allocate + configure each sounding lane (await drumkit reloads).
    for (const { laneId, engineId } of sounding) {
      lanes.ensureLaneResource(laneId, engineId);
      const engine = lanes.getLaneEngineInstance(laneId);
      if (!engine) continue;
      const lane = state.lanes.find((l) => l.id === laneId)!;
      await applyLaneEngineState(engine as never, lane, offlineCtx as unknown as AudioContext, {
        loadNoteFx: (id, st) => loadNoteFxForLane(id, st),
        reloadDrumkit: async (id, kitId, eng: { setKeymap(k: KeymapEntry[]): void }) => {
          const manifest = await fetchDrumkitManifest(kitId);
          const km = await loadDrumkit(manifest, offlineCtx as unknown as AudioContext);
          eng.setKeymap(km);
          mirrorKeymapChange(state, id, km);
        },
      });
      // Per-lane insert plugin slots → full parity with the live mix.
      const res = lanes.resources.get(laneId);
      if (res?.inserts && lane.inserts && lane.inserts.length > 0) {
        rehydrateInsertChain(offlineCtx as unknown as AudioContext, res.inserts, lane.inserts);
      }
    }

    // 3b) Master insert plugin slots.
    if (state.masterInserts && state.masterInserts.length > 0) {
      rehydrateInsertChain(offlineCtx as unknown as AudioContext, graph.masterInsertChain, state.masterInserts);
    }

    // 4) Preload one-shot / clip sample buffers.
    await preloadSceneSamples(offlineCtx as unknown as AudioContext, state.lanes.filter((l) => sounding.some((s) => s.laneId === l.id)));

    // 5) Batch-schedule every note, fire through the reused trigger path.
    const trigger = createTriggerForLane({
      ctx: offlineCtx as unknown as AudioContext,
      laneResources: lanes.resources,
      seq: { bpm } as never,
    });
    const laneClips: SoundingLaneClip[] = sounding.map((s) => ({ laneId: s.laneId, engineId: s.engineId, clip: s.clip }));
    for (const ev of collectSceneTriggers(laneClips, bpm, meter, totalSec)) {
      trigger(ev.laneId, ev.midi, ev.time, ev.gateSec, ev.accent, ev.slidingIn, ev.sample);
    }

    // 6) Render.
    const buffer = await offlineCtx.startRendering();
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch).slice(0));
    return { channels, sampleRate: buffer.sampleRate };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Verified imports: `mirrorKeymapChange` is exported from `src/session/session-engine-state.ts`; `loadDrumkit`/`fetchDrumkitManifest` from `src/samples/drumkit-loader.ts`; `loadNoteFxForLane` from `src/notefx/notefx-registry.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/export/offline-recorder.ts
git commit -m "feat(export): offline scene recorder (parallel graph + batch render)"
```

---

## Task 7: Offline render DSP test

**Files:**
- Create: `src/export/offline-recorder.dsp.test.ts`

Renders a known minimal scene offline and asserts the output is non-silent with the expected *relative* shape. Uses the `node-web-audio-api` `OfflineAudioContext` globalized in `test/setup.ts`.

- [ ] **Step 1: Write the test**

```typescript
// src/export/offline-recorder.dsp.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { OfflineSceneRecorder } from './offline-recorder';
import { bootstrapPlugins } from '../app/plugin-bootstrap';
import { emptyLanePlayState, type LanePlayState } from '../session/session-runtime';
import { DEFAULT_METER } from '../core/meter';
import type { SessionState, SessionClip } from '../session/session';

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / ch.length);
}

describe('OfflineSceneRecorder (DSP)', () => {
  beforeAll(() => { bootstrapPlugins(); });

  it('renders a non-silent stereo buffer of the requested length for a tb303 scene', async () => {
    const clip: SessionClip = {
      id: 'c', lengthBars: 1,
      notes: [
        { start: 0, duration: 24, midi: 40, velocity: 110 },
        { start: 48, duration: 24, midi: 43, velocity: 110 },
      ],
    };
    const state: SessionState = {
      lanes: [{ id: 'tb-303-1', engineId: 'tb303', clips: [clip] }],
      scenes: [], globalQuantize: '1/1',
    };
    const laneStates = new Map<string, LanePlayState>();
    const lp = emptyLanePlayState('tb-303-1'); lp.playing = clip;
    laneStates.set('tb-303-1', lp);

    const rec = new OfflineSceneRecorder({ state, laneStates, bpm: 120, meter: DEFAULT_METER, sampleRate: 44100 });
    const totalSec = 2.5; // 1 bar (2s) + tail
    const rendered = await rec.record(totalSec);

    expect(rendered.channels).toHaveLength(2);
    expect(rendered.sampleRate).toBe(44100);
    // length within one render quantum of the request
    expect(Math.abs(rendered.channels[0].length - Math.ceil(totalSec * 44100))).toBeLessThan(256);
    // non-silent
    expect(rms(rendered.channels[0])).toBeGreaterThan(1e-4);
    // first half (notes playing) louder than the tail's last 0.25s (decayed)
    const ch = rendered.channels[0];
    const head = ch.subarray(0, Math.floor(ch.length * 0.4));
    const tail = ch.subarray(ch.length - Math.floor(0.25 * 44100));
    expect(rms(head)).toBeGreaterThan(rms(tail));
  });
});
```

- [ ] **Step 2: Run it**

Run: `NO_COLOR=1 npx vitest run src/export/offline-recorder.dsp.test.ts`
Expected: PASS. (`bootstrapPlugins` is exported from `src/app/plugin-bootstrap.ts`; keep the `beforeAll` — the lane allocator resolves engines via the registry.)

- [ ] **Step 3: Commit**

```bash
git add src/export/offline-recorder.dsp.test.ts
git commit -m "test(export): offline render produces non-silent audio of the right length"
```

---

## Task 8: UI — backend menu + wiring

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `docs/superpowers/specs/2026-06-04-scene-audio-export-design.md` (record the insert-slots v1 gap)

- [ ] **Step 1: Replace the single export button with a menu** in `index.html`. Find:

```html
        <button id="export-scene" class="io" title="Export the current scene to WAV (real-time)">&#10515; WAV</button>
```

Replace with a button + a sibling menu:

```html
        <span class="export-menu-wrap">
          <button id="export-scene" class="io" title="Export the current scene to WAV">&#10515; WAV ▾</button>
          <span id="export-menu" class="export-menu" hidden>
            <button id="export-rt" class="io">Tiempo real</button>
            <button id="export-offline" class="io">Offline (rápido)</button>
          </span>
        </span>
```

- [ ] **Step 2: Wire the menu + offline backend** in `src/main.ts`. Add the import near the other export imports:

```typescript
import { OfflineSceneRecorder } from './export/offline-recorder';
```

Replace the existing single click listener `exportBtn.addEventListener('click', () => { void exportCurrentScene(sceneExporter); });` with a menu toggle + per-mode runners. The existing `sceneExporter` is the real-time one; add an offline variant that swaps only `record`:

```typescript
const exportMenu = $<HTMLElement>('export-menu');
exportBtn.addEventListener('click', () => { exportMenu.hidden = !exportMenu.hidden; });

function runExport(mode: 'rt' | 'offline'): void {
  exportMenu.hidden = true;
  if (mode === 'rt') { void exportCurrentScene(sceneExporter); return; }
  // Offline: same orchestrator + encoder + download; only the recorder changes.
  void exportCurrentScene({
    ...sceneExporter,
    record: (totalSec) => new OfflineSceneRecorder({
      state: sessionHost.state,
      laneStates: sessionHost.laneStates,
      bpm: seq.bpm,
      meter: seq.meter,
    }).record(totalSec),
    // Offline doesn't run the live transport; finish() still stops it harmlessly.
  });
}
$<HTMLButtonElement>('export-rt').addEventListener('click', () => runExport('rt'));
$<HTMLButtonElement>('export-offline').addEventListener('click', () => runExport('offline'));
```

(`sceneExporter`, `exportBtn`, `sessionHost`, `seq`, `$` are already in scope from Phase 1.)

- [ ] **Step 3: Minimal CSS** — append to the inline `<style>` in `index.html` so the menu floats under the button:

```css
.export-menu-wrap { position: relative; display: inline-block; }
.export-menu { position: absolute; top: 100%; left: 0; z-index: 20; display: flex; flex-direction: column; background: #222; border: 1px solid #444; }
.export-menu[hidden] { display: none; }
.export-menu .io { white-space: nowrap; }
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: succeeds (required before e2e — it serves `dist/`).

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(export): backend menu (real-time default + offline) + offline wiring"
```

---

## Task 9: e2e — export via the Offline option

**Files:**
- Create: `tests/e2e/scene-export-offline.spec.ts`

- [ ] **Step 1: Write the e2e**

```typescript
// tests/e2e/scene-export-offline.spec.ts
import { test, expect } from '@playwright/test';
import { statSync } from 'node:fs';

test('offline export downloads a .wav for the current scene', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );

  // Launch one clip so a scene is sounding.
  await page.locator('.session-cell-filled .session-cell-play').first().click();
  await expect(page.locator('.session-cell-playing').first()).toBeVisible({ timeout: 2000 });

  // Open the export menu and pick Offline.
  await page.locator('#export-scene').click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#export-offline').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^loom-scene-.*\.wav$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  expect(statSync(filePath!).size).toBeGreaterThan(44);
});
```

- [ ] **Step 2: Run it** (build first per Task 8)

Run: `npm run test:e2e -- scene-export-offline`
Expected: PASS — an offline-rendered `.wav` downloads. (Offline render is faster than real-time, so this is quick.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/scene-export-offline.spec.ts
git commit -m "test(export): e2e offline export downloads a .wav"
```

---

## Task 10: Full verification + A↔C spot check

- [ ] **Step 1: Unit suite**

Run: `npm run test:unit`
Expected: PASS. (If it exits non-zero only on the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown after all tests pass, re-run to confirm.)

- [ ] **Step 2: Build + e2e**

Run: `npm run build && npm run test:e2e`
Expected: all e2e PASS (including both `scene-export.spec.ts` and `scene-export-offline.spec.ts`).

- [ ] **Step 3: Manual A↔C parity (browser)**

`npm run dev`, launch a scene, export once via **Tiempo real** and once via **Offline (rápido)**. Confirm both `.wav`s sound the same and have ~the same duration. (Optional: drop both in `test/output/` and `npm run test:wav-diff` for a numeric peak/RMS delta.)

- [ ] **Step 4: Finish the branch**

Per project convention: `git rebase main`, then `git merge --ff-only`, then `ExitWorktree`.

---

## Self-review (spec coverage)

- "Offline render via OfflineAudioContext, parallel graph" → Tasks 1, 6. ✅
- "Parameterize the graph by context" → Task 1 (`buildAudioGraph(ctx)`) + Task 6 (offline `createLaneAllocator`). ✅
- "Extract note→event math shared by live tick + offline batch" → Task 2 (`noteTrigger`) + Task 3 (`collectSceneTriggers`). ✅
- "Build each sounding lane's strip+engine+inserts offline + apply preset/engineState" → Task 4 (`applyLaneEngineState`) + Task 6. ✅
- "Sampler preload before render" → Task 5 + Task 6 step 4 (+ awaited drumkit reload). ✅
- "Reuse the Phase 1 pipeline (SceneRecorder/encoder/download/orchestrator)" → Task 6 implements `SceneRecorder`; Task 8 reuses `exportCurrentScene` + `wavEncoder` + `downloadBlob`. ✅
- "ScriptProcessor/AudioWorklet offline incompatibility" → verified none exist in engines; only Phase 1's recorder, which offline doesn't use. ✅
- "UI: real-time default + offline option" → Task 8. ✅
- "A↔C parity gate" → automated offline-correctness DSP test (Task 7) + manual/`wav-diff` browser parity (Task 10 step 3), since A can't run under Node. ✅
- Insert plugin slots reproduced via `rehydrateInsertChain` (Task 6) → full mix parity, no gap. ✅
