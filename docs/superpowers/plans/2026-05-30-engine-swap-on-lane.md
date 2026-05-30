# Engine Swap On Lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user change the synth engine of an existing session lane via the engine `<select>`, resetting that lane's sound to the new engine's defaults while keeping its clips and channel strip.

**Architecture:** A small orchestrator (`swapLaneEngineFlow`) mutates `SessionState` (engineId + reset engineState/preset), reconciles clip automation envelopes, replaces only the live audio engine in the `LaneAllocator` (keeping the `ChannelStrip` + `InsertChain`), then re-routes the editor to the new engine's page and persists. Two selector surfaces drive it (poly page `#engine-select`, new 303 page `#engine-select-303`). State-apply (load/undo/redo) reconciles each lane's live engine against its `engineId`.

**Tech Stack:** TypeScript, Web Audio API, Vite, Vitest (node env, `node-web-audio-api` globalized), Playwright (e2e).

**Scope:** 5 melodic (`piano-roll`) engines: `tb303`, `subtractive`, `fm`, `wavetable`, `karplus`. `drums-machine` excluded by its `drum-grid` editor. Symmetric swap (tb303 included).

**Spec:** `docs/superpowers/specs/2026-05-30-engine-swap-on-lane-design.md`

**Test conventions:** Run vitest colour-free: `NO_COLOR=1 npx vitest run <file>`. Assertions on DSP output must be **relative** (ratios), never absolute magnitudes.

---

## Task 1: `reconcileLaneEnvelopes` pure helper

When a lane's engine changes, each clip's automation `envelopes` reference the old engine's paramIds. Mirror the existing `reEvaluateEnvelopes` behavior (used by `moveClip`/`copyClip`): keep the envelope but set `enabled` based on whether its `paramId` exists in the new engine.

**Files:**
- Modify: `src/session/session.ts` (add exported helper near `reEvaluateEnvelopes`, ~line 147)
- Test: `src/session/reconcile-lane-envelopes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/session/reconcile-lane-envelopes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcileLaneEnvelopes } from './session';
import type { SessionLane } from './session';

function laneWithEnv(paramId: string): SessionLane {
  return {
    id: 'L',
    engineId: 'subtractive',
    clips: [
      {
        id: 'c1',
        lengthBars: 1,
        notes: [],
        envelopes: [{ paramId, values: [0, 1], enabled: true }],
      },
    ],
  };
}

describe('reconcileLaneEnvelopes', () => {
  it('disables envelopes whose paramId is absent from the new engine set', () => {
    const lane = laneWithEnv('osc1.level');
    reconcileLaneEnvelopes(lane, new Set(['filter.cutoff']));
    expect(lane.clips[0]!.envelopes![0].enabled).toBe(false);
  });

  it('keeps (enables) envelopes whose paramId is shared', () => {
    const lane = laneWithEnv('filter.cutoff');
    reconcileLaneEnvelopes(lane, new Set(['filter.cutoff']));
    expect(lane.clips[0]!.envelopes![0].enabled).toBe(true);
  });

  it('no-ops on clips without envelopes and on null clip slots', () => {
    const lane: SessionLane = {
      id: 'L',
      engineId: 'fm',
      clips: [null, { id: 'c', lengthBars: 1, notes: [] }],
    };
    expect(() => reconcileLaneEnvelopes(lane, new Set())).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/reconcile-lane-envelopes.test.ts`
Expected: FAIL — `reconcileLaneEnvelopes` is not exported from `./session`.

- [ ] **Step 3: Add the helper**

In `src/session/session.ts`, after the existing `reEvaluateEnvelopes` function (around line 147), add:

```ts
/** After a lane's engine changes, re-evaluate every clip's automation
 *  envelopes against the new engine's param set: an envelope whose paramId
 *  is absent from `paramIds` is disabled (kept, not deleted — mirrors
 *  reEvaluateEnvelopes used by moveClip/copyClip). Mutates the lane in place. */
export function reconcileLaneEnvelopes(
  lane: SessionLane,
  paramIds: ReadonlySet<string>,
): void {
  for (const clip of lane.clips) {
    if (!clip?.envelopes) continue;
    for (const env of clip.envelopes) {
      env.enabled = paramIds.has(env.paramId);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/reconcile-lane-envelopes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/reconcile-lane-envelopes.test.ts
git commit -m "feat(session): reconcileLaneEnvelopes — disable orphaned clip envelopes on engine change"
```

---

## Task 2: `LaneResourceMap.replaceEngine`

A surgical replace that disposes only the old engine and keeps the strip + inserts (channel-level resources survive an engine swap). `set()` disposes all three; this does not.

**Files:**
- Modify: `src/core/lane-resources.ts` (add method to `LaneResourceMap`)
- Test: `src/core/lane-resources.test.ts` (append a test)

- [ ] **Step 1: Write the failing test**

Append to `src/core/lane-resources.test.ts` inside the `describe('LaneResourceMap', ...)` block:

```ts
  it('replaceEngine disposes the old engine but keeps strip + inserts', () => {
    const m = new LaneResourceMap();
    let oldEngineDisposed = false;
    const strip = { dispose: () => {} } as unknown as import('./fx').ChannelStrip;
    const inserts = { dispose: () => {} } as unknown as InsertChain;
    const oldEngine = {
      dispose: () => { oldEngineDisposed = true; },
    } as unknown as import('../engines/engine-types').SynthEngine;
    const newEngine = { dispose: () => {} } as unknown as import('../engines/engine-types').SynthEngine;

    m.set('L', { strip, engine: oldEngine, inserts });
    m.replaceEngine('L', newEngine);

    expect(oldEngineDisposed).toBe(true);
    expect(m.get('L')!.engine).toBe(newEngine);
    expect(m.get('L')!.strip).toBe(strip);     // same strip reference
    expect(m.get('L')!.inserts).toBe(inserts); // same inserts reference
  });

  it('replaceEngine is a no-op when the lane has no resource', () => {
    const m = new LaneResourceMap();
    const newEngine = { dispose: () => {} } as unknown as import('../engines/engine-types').SynthEngine;
    expect(() => m.replaceEngine('missing', newEngine)).not.toThrow();
    expect(m.get('missing')).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/lane-resources.test.ts`
Expected: FAIL — `m.replaceEngine is not a function`.

- [ ] **Step 3: Add the method**

In `src/core/lane-resources.ts`, add this method to the `LaneResourceMap` class (after `set`, before `dispose`):

```ts
  /** Replace ONLY the engine for a lane, disposing the old engine but keeping
   *  the existing strip + inserts (channel-level resources survive an engine
   *  swap). No-op if the lane has no resource. */
  replaceEngine(laneId: string, engine: SynthEngine): void {
    const res = this.inner.get(laneId);
    if (!res) return;
    res.engine.dispose?.();
    res.engine = engine;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/lane-resources.test.ts`
Expected: PASS (all tests including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/core/lane-resources.ts src/core/lane-resources.test.ts
git commit -m "feat(core): LaneResourceMap.replaceEngine — swap engine, keep strip + inserts"
```

---

## Task 3: Extract engine creation + wiring helpers in the allocator (refactor)

`ensureLaneResource` inlines engine creation (registry + plugin fallback) and per-engine wiring (subtractive PolySynth, drums sharedFx). Extract both into reusable helpers so Task 4's `swapLaneEngine` shares the exact same logic — no second copy that can drift. **No behavior change**; the existing `lane-allocator.test.ts` is the regression guard.

**Files:**
- Modify: `src/app/lane-allocator.ts`

- [ ] **Step 1: Add the two helpers inside `createLaneAllocator`**

In `src/app/lane-allocator.ts`, inside `createLaneAllocator` (after the `laneVoices` declaration, before `ensureExtraPoly`), add:

```ts
  /** Resolve an engine instance: legacy registry first, plugin registry as
   *  fallback (plugin-only synths get wrapped via pluginSynthAsEngine). */
  const createLaneEngine = (engineId: string, inserts: InsertChain): SynthEngine | null => {
    let engine = createEngineInstance(engineId);
    if (!engine) {
      const factory = getPlugin('synth', engineId);
      if (factory && factory.kind === 'synth') {
        const inst = createInstance('synth', engineId, deps.ctx, inserts.inputNode);
        if (inst) engine = pluginSynthAsEngine(factory.manifest, inst);
      }
    }
    return engine ?? null;
  };

  /** Per-engine wiring against a lane's strip + inserts. Shared by
   *  ensureLaneResource (initial alloc) and swapLaneEngine (in-place swap). */
  const wireEngineIntoLane = (
    engineId: string,
    engine: SynthEngine,
    strip: ChannelStrip,
    inserts: InsertChain,
  ): void => {
    if (engineId === 'subtractive') {
      const p = new PolySynth(deps.ctx, inserts.inputNode);
      p.bpm = deps.getBpm();
      (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
    }
    if (engineId === 'drums-machine') {
      (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
      (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
      (engine as unknown as { setOutputTarget?(n: AudioNode): void }).setOutputTarget?.(inserts.inputNode);
    }
    // tb303: TB303Engine.createVoice is self-registering — no external call.
  };
```

- [ ] **Step 2: Rewrite `ensureLaneResource` to use the helpers**

Replace the body of `ensureLaneResource` (currently lines ~213-256, from `if (resources.get(laneId)) return;` through `resources.set(...)`) with:

```ts
  const ensureLaneResource = (laneId: string, engineId: string): void => {
    if (resources.get(laneId)) return;
    const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx,
      { sidechain: { bus: deps.sidechainBus, id: laneId, label: laneId.toUpperCase() } });
    // Phase H: every lane gets an InsertChain between the engine voice and the
    // channel strip. The chain's entry node is a GainNode (pass-through when
    // empty); its output is strip.input.
    const inserts = new InsertChain(deps.ctx.createGain(), strip.input);
    const engine = createLaneEngine(engineId, inserts);
    if (!engine) return;
    wireEngineIntoLane(engineId, engine, strip, inserts);
    resources.set(laneId, { strip, engine, inserts });
  };
```

- [ ] **Step 3: Run the existing allocator tests to verify no regression**

Run: `NO_COLOR=1 npx vitest run src/app/lane-allocator.test.ts`
Expected: PASS (all existing tests — drums `setSharedFx`-before-`createVoice`, InsertChain routing, save/load round-trip — still green).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/lane-allocator.ts
git commit -m "refactor(allocator): extract createLaneEngine + wireEngineIntoLane from ensureLaneResource"
```

---

## Task 4: `swapLaneEngine` in the allocator

In-place engine replacement reusing the lane's existing strip + inserts.

**Files:**
- Modify: `src/app/lane-allocator.ts` (add `swapLaneEngine`; add to `LaneAllocator` interface + returned object)
- Test: `src/app/lane-allocator.test.ts` (append a describe block; add `fm` side-effect import)

- [ ] **Step 1: Write the failing test**

At the top of `src/app/lane-allocator.test.ts`, add an `fm` engine side-effect import next to the existing ones:

```ts
import '../engines/fm';
```

Append this describe block to `src/app/lane-allocator.test.ts`:

```ts
describe('swapLaneEngine replaces the engine in place', () => {
  it('keeps the same strip + inserts and swaps the engine instance', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('L', 'subtractive');
    const before = lanes.resources.get('L')!;
    const stripRef = before.strip;
    const insertsRef = before.inserts;
    expect(before.engine.id).toBe('subtractive');

    lanes.swapLaneEngine('L', 'fm');

    const after = lanes.resources.get('L')!;
    expect(after.engine.id).toBe('fm');
    expect(after.strip).toBe(stripRef);     // strip preserved
    expect(after.inserts).toBe(insertsRef); // inserts preserved
  });

  it('invalidates the cached voice so the next ensureLaneVoice builds a fresh one', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    lanes.ensureLaneResource('L', 'fm');
    const v1 = lanes.ensureLaneVoice('L', 'fm');
    lanes.swapLaneEngine('L', 'wavetable');
    const v2 = lanes.ensureLaneVoice('L', 'wavetable');
    expect(v1).not.toBeNull();
    expect(v2).not.toBe(v1); // fresh voice from the new engine
  });

  it('is a no-op when the lane has no resource', () => {
    const ctx = makeCtx();
    const { master, fx, sidechainBus } = makeDeps(ctx);
    const lanes = createLaneAllocator({ ctx, master, fx, sidechainBus, getBpm: () => 120, extraIds: [] });
    expect(() => lanes.swapLaneEngine('nope', 'fm')).not.toThrow();
    expect(lanes.resources.get('nope')).toBeUndefined();
  });
});
```

(`wavetable` is already registered through the eager engine imports pulled in by `subtractive`/`fm` side-effects? No — add `import '../engines/wavetable';` at the top alongside the others to be safe.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/lane-allocator.test.ts`
Expected: FAIL — `lanes.swapLaneEngine is not a function`.

- [ ] **Step 3: Add `swapLaneEngine` and expose it**

In `src/app/lane-allocator.ts`:

(a) Add the implementation inside `createLaneAllocator` (after `ensureLaneResource`):

```ts
  /** Replace the live engine of an already-allocated lane, reusing its strip
   *  and inserts. The old engine (and its cached voice) is disposed. No-op if
   *  the lane isn't allocated or the new engineId can't be resolved. */
  const swapLaneEngine = (laneId: string, newEngineId: string): void => {
    const res = resources.get(laneId);
    if (!res) return;
    const engine = createLaneEngine(newEngineId, res.inserts);
    if (!engine) return; // unknown engine → leave the lane intact
    wireEngineIntoLane(newEngineId, engine, res.strip, res.inserts);
    laneVoices.delete(laneId);                  // drop the old engine's cached voice
    resources.replaceEngine(laneId, engine);    // disposes old engine, keeps strip+inserts
  };
```

(b) Add to the `LaneAllocator` interface (after `ensureLaneResource`):

```ts
  swapLaneEngine(laneId: string, newEngineId: string): void;
```

(c) Add `swapLaneEngine` to the returned object at the bottom of `createLaneAllocator`:

```ts
  return {
    resources, extraStrips, extraPolys,
    stripFor, ensureExtraPoly, ensureLaneStrip, ensureLaneVoice, ensureLaneResource,
    swapLaneEngine,
    getLaneEngineInstance,
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/app/lane-allocator.test.ts`
Expected: PASS (existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/lane-allocator.ts src/app/lane-allocator.test.ts
git commit -m "feat(allocator): swapLaneEngine — in-place engine replacement keeping strip + inserts"
```

---

## Task 5: `swapLaneEngineFlow` orchestrator

The pure-ish coordinator: guards, state reset, envelope reconcile, audio swap, UI re-route, persist. All registry/DOM/audio access is injected so it unit-tests with doubles.

**Files:**
- Create: `src/app/engine-swap.ts`
- Test: `src/app/engine-swap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/engine-swap.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { swapLaneEngineFlow, type EngineSwapDeps } from './engine-swap';
import type { SessionState } from '../session/session';

function makeState(): SessionState {
  return {
    lanes: [
      {
        id: 'L',
        engineId: 'subtractive',
        engineState: { params: { 'filter.cutoff': 0.9 }, modulators: [] },
        enginePresetName: 'factory:Acid',
        clips: [
          {
            id: 'c',
            lengthBars: 1,
            notes: [],
            envelopes: [
              { paramId: 'filter.cutoff', values: [0, 1], enabled: true },
              { paramId: 'osc1.level', values: [1, 1], enabled: true },
            ],
          },
        ],
      },
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}

const EDITORS: Record<string, 'piano-roll' | 'drum-grid'> = {
  subtractive: 'piano-roll',
  fm: 'piano-roll',
  tb303: 'piano-roll',
  'drums-machine': 'drum-grid',
};
const PARAMS: Record<string, Set<string>> = {
  fm: new Set(['filter.cutoff', 'op1.level']), // shares filter.cutoff, not osc1.level
  subtractive: new Set(['filter.cutoff', 'osc1.level']),
};

function makeDeps(state: SessionState, over: Partial<EngineSwapDeps> = {}): EngineSwapDeps {
  return {
    state,
    getEngineEditor: (id) => EDITORS[id],
    getEngineParamIds: (id) => PARAMS[id] ?? new Set<string>(),
    swapLaneEngine: vi.fn(),
    onSwapped: vi.fn(),
    saveSession: vi.fn(),
    ...over,
  };
}

describe('swapLaneEngineFlow', () => {
  it('switches engineId, resets engineState + preset, fires side effects once', () => {
    const state = makeState();
    const deps = makeDeps(state);
    const ok = swapLaneEngineFlow(deps, 'L', 'fm');
    expect(ok).toBe(true);
    const lane = state.lanes[0];
    expect(lane.engineId).toBe('fm');
    expect(lane.engineState).toEqual({});
    expect(lane.enginePresetName).toBeUndefined();
    expect(deps.swapLaneEngine).toHaveBeenCalledWith('L', 'fm');
    expect(deps.onSwapped).toHaveBeenCalledWith('L', 'fm');
    expect(deps.saveSession).toHaveBeenCalledOnce();
  });

  it('reconciles envelopes: shared paramId kept enabled, missing paramId disabled', () => {
    const state = makeState();
    swapLaneEngineFlow(makeDeps(state), 'L', 'fm');
    const envs = state.lanes[0].clips[0]!.envelopes!;
    expect(envs.find((e) => e.paramId === 'filter.cutoff')!.enabled).toBe(true);
    expect(envs.find((e) => e.paramId === 'osc1.level')!.enabled).toBe(false);
  });

  it('no-op when target equals current engine', () => {
    const state = makeState();
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'L', 'subtractive')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
    expect(state.lanes[0].enginePresetName).toBe('factory:Acid'); // unchanged
  });

  it('no-op when target is a drum-grid engine', () => {
    const state = makeState();
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'L', 'drums-machine')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
    expect(state.lanes[0].engineId).toBe('subtractive');
  });

  it('no-op when the current lane engine is drum-grid', () => {
    const state = makeState();
    state.lanes[0].engineId = 'drums-machine';
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'L', 'fm')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
  });

  it('no-op when the lane id is unknown', () => {
    const state = makeState();
    const deps = makeDeps(state);
    expect(swapLaneEngineFlow(deps, 'ghost', 'fm')).toBe(false);
    expect(deps.swapLaneEngine).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/engine-swap.test.ts`
Expected: FAIL — cannot find module `./engine-swap`.

- [ ] **Step 3: Create the module**

Create `src/app/engine-swap.ts`:

```ts
// src/app/engine-swap.ts
// Orchestrates changing the synth engine of an existing session lane:
// resets the lane's sound to the new engine's defaults, reconciles clip
// automation envelopes, swaps the live audio engine (keeping the channel
// strip + inserts), refreshes the UI, and persists. Pure WRT globals: every
// registry / DOM / audio dependency is injected so it unit-tests with doubles.

import type { SessionState } from '../session/session';
import { reconcileLaneEnvelopes } from '../session/session';

export interface EngineSwapDeps {
  state: SessionState;
  /** Editor kind for an engineId ('piano-roll' | 'drum-grid' | undefined). */
  getEngineEditor: (engineId: string) => 'piano-roll' | 'drum-grid' | undefined;
  /** Automatable paramIds the engine exposes (for envelope reconciliation). */
  getEngineParamIds: (engineId: string) => ReadonlySet<string>;
  /** Replace the live audio engine for the lane (allocator.swapLaneEngine). */
  swapLaneEngine: (laneId: string, newEngineId: string) => void;
  /** Re-route the editor to the new engine's page, rebuild panels, and sync
   *  the engine selectors. */
  onSwapped: (laneId: string, newEngineId: string) => void;
  /** Persist the session (autosave). Optional. */
  saveSession?: () => void;
}

/** Change a lane's engine in place. Returns true if the swap happened, false
 *  if a guard rejected it (same engine, non-melodic source or target,
 *  unknown lane). Callers wrap this in withUndo so it is one undo entry. */
export function swapLaneEngineFlow(
  deps: EngineSwapDeps,
  laneId: string,
  newEngineId: string,
): boolean {
  const lane = deps.state.lanes.find((l) => l.id === laneId);
  if (!lane) return false;
  if (lane.engineId === newEngineId) return false;                       // same engine
  if (deps.getEngineEditor(newEngineId) !== 'piano-roll') return false;  // target not melodic
  if (deps.getEngineEditor(lane.engineId) !== 'piano-roll') return false; // source is drums

  // 1. State: switch engine, reset sound + preset to the new engine's defaults.
  lane.engineId = newEngineId;
  lane.engineState = {};
  lane.enginePresetName = undefined;

  // 2. Clips: keep notes; reconcile automation envelopes against the new set.
  reconcileLaneEnvelopes(lane, deps.getEngineParamIds(newEngineId));

  // 3. Audio: replace the live engine (strip + inserts preserved).
  deps.swapLaneEngine(laneId, newEngineId);

  // 4. UI: re-route page, rebuild panels, sync selectors.
  deps.onSwapped(laneId, newEngineId);

  // 5. Persist.
  deps.saveSession?.();
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/app/engine-swap.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/engine-swap.ts src/app/engine-swap.test.ts
git commit -m "feat(app): swapLaneEngineFlow orchestrator (state reset + envelope reconcile + guards)"
```

---

## Task 6: Filter the engine selector to melodic engines

Extract a pure `melodicSynthEngineIds()` (testable in the node env, no DOM) and use it in `populateEngineSelect` so drums (`drum-grid`) drops out of the dropdown.

**Files:**
- Modify: `src/engines/engine-selector-ui.ts`
- Test: `src/engines/engine-selector-ui.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/engines/engine-selector-ui.test.ts`:

```ts
import { melodicSynthEngineIds } from './engine-selector-ui';
import { bootstrapPlugins } from '../app/plugin-bootstrap';

describe('engine-selector-ui — melodic engine filter', () => {
  it('lists the 5 piano-roll engines and excludes drums-machine', () => {
    bootstrapPlugins(); // registers all builtin synth plugins + engines
    const ids = melodicSynthEngineIds();
    expect(ids).toEqual(
      expect.arrayContaining(['tb303', 'subtractive', 'fm', 'wavetable', 'karplus']),
    );
    expect(ids).not.toContain('drums-machine');
  });
});
```

(Add the two imports at the top of the file if not already present.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-selector-ui.test.ts`
Expected: FAIL — `melodicSynthEngineIds` is not exported.

- [ ] **Step 3: Add the helper and use it in `populateEngineSelect`**

In `src/engines/engine-selector-ui.ts`:

(a) Add `getEngine` to the registry import at the top:

```ts
import { listPlugins } from '../plugins/registry';
import { getEngine } from './registry';
```

(b) Add the pure helper (near the top, after the imports):

```ts
/** EngineIds eligible for the swap dropdown: registered 'synth' plugins whose
 *  engine uses the piano-roll editor. drum-grid engines (drums-machine) edit
 *  on the drum-grid page and are excluded. */
export function melodicSynthEngineIds(): string[] {
  return listPlugins('synth')
    .map((p) => p.manifest.id)
    .filter((id) => getEngine(id)?.editor === 'piano-roll');
}
```

(c) Replace the body of `populateEngineSelect` with:

```ts
export function populateEngineSelect(deps: EngineSelectorUIDeps, currentEngineId: string): void {
  deps.engineSel.innerHTML = '';
  for (const id of melodicSynthEngineIds()) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = getEngine(id)?.name ?? id;
    if (id === currentEngineId) opt.selected = true;
    deps.engineSel.appendChild(opt);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-selector-ui.test.ts`
Expected: PASS (existing `unregisterKnobsByPrefix` test + new filter test).

- [ ] **Step 5: Commit**

```bash
git add src/engines/engine-selector-ui.ts src/engines/engine-selector-ui.test.ts
git commit -m "feat(engine-ui): melodicSynthEngineIds — exclude drum-grid engines from the selector"
```

---

## Task 7: Reconcile lane engines on state-apply (load / undo / redo)

`applyLoadedSessionState` calls the idempotent `ensureLaneResource`, which bails if a resource exists — so after undo/redo (or loading a saved session with a changed engine) the live engine wouldn't be rebuilt. Reconcile: if a resource exists but its engine differs from the lane's `engineId`, `swapLaneEngine` instead. `applyEngineState()` already runs afterward, so restored params/mods apply to the reconciled engine.

> **Testing note:** `SessionHost` cannot be unit-constructed in the node env (its `init()` builds DOM via `SessionInspector` / `renderSessionTabBar`). This task is verified by typecheck + the existing session suite, and by the manual undo/redo check in Task 12.

**Files:**
- Modify: `src/session/session-host.ts` (add dep + reconcile block)

- [ ] **Step 1: Add the `swapLaneEngine` dep to `SessionHostDeps`**

In `src/session/session-host.ts`, in the `SessionHostDeps` interface, right after the `ensureLaneResource?` declaration (~line 100), add:

```ts
  /** Replace the live engine for an already-allocated lane (allocator
   *  .swapLaneEngine). Used to reconcile a lane whose engineId changed via
   *  undo/redo or a loaded session. Optional so test fixtures can skip it. */
  swapLaneEngine?: (laneId: string, newEngineId: string) => void;
```

- [ ] **Step 2: Reconcile in the apply loop**

In `applyLoadedSessionState`, replace the single `ensureLaneResource` call inside the `for (const lane of this.state.lanes)` loop (currently `this.deps.ensureLaneResource?.(lane.id, lane.engineId);`, ~line 237) with:

```ts
      // Allocate lazily, OR reconcile a lane whose engineId changed (undo/redo
      // or a loaded session): if a resource exists but its live engine differs
      // from the lane's engineId, swap it in place rather than skip (the
      // idempotent ensureLaneResource would otherwise leave the old engine).
      const existing = this.deps.laneResources?.get(lane.id);
      if (existing && existing.engine.id !== lane.engineId) {
        this.deps.swapLaneEngine?.(lane.id, lane.engineId);
      } else {
        this.deps.ensureLaneResource?.(lane.id, lane.engineId);
      }
```

- [ ] **Step 3: Typecheck + run the session suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `NO_COLOR=1 npx vitest run src/session/`
Expected: PASS (existing session tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/session/session-host.ts
git commit -m "fix(session): reconcile lane engine on state-apply so undo/redo/load rebuild it"
```

---

## Task 8: Extract `SessionHost.showLaneEditor` from `onEditLane`

`onEditLane` both toggles a lane off (when it's already active) and shows a lane's editor. The post-swap re-route needs the "show" half without the toggle. Extract it to a public method. **No behavior change** for `onEditLane`.

**Files:**
- Modify: `src/session/session-host.ts`

- [ ] **Step 1: Add the `showLaneEditor` method**

In `src/session/session-host.ts`, add a public method on the `SessionHost` class (e.g. just before `injectEngineModulatorPanel`, ~line 556). Move the body of the current `onEditLane` "show" branch (lines ~487-545, from `const lane = self.state.lanes.find(...)` through `self.injectEngineModulatorPanel(...)` and `self.deps.onActiveLaneChanged?.()`) into it, rewriting `self.` → `this.` and the bare `showPolyEditor(...)` call → `this.deps.showPolyEditor(...)`:

```ts
  /** Show a lane's editor: route to its engine's page (poly / 303 / drums),
   *  rebuild the engine param UI + modulator panel + labels. Does NOT toggle.
   *  Used by onEditLane (non-toggle path) and by the post-engine-swap re-route. */
  showLaneEditor(laneId: string): void {
    const lane = this.state.lanes.find((l) => l.id === laneId);

    let polyTarget: PolySynth | null = null;
    if (lane?.engineId === 'subtractive') {
      const engine = this.deps.laneResources?.get(laneId)?.engine;
      const getPS = (engine as unknown as { getPolySynth?(): PolySynth | null })?.getPolySynth;
      polyTarget = getPS ? getPS.call(engine) ?? null : null;
    }

    const targetTab =
      lane?.engineId === 'tb303' ? '303' :
      (lane?.engineId === 'drums-machine' || laneId.startsWith('drum:')) ? 'drums' :
                                                                           'poly';
    document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
      if (t.classList.contains('session-lane-tab')) {
        t.classList.toggle('active', t.dataset.laneId === laneId);
      } else {
        t.classList.toggle('active', t.dataset.tab === targetTab && !t.classList.contains('synth-tab'));
      }
    });
    const displayName = lane?.name ?? laneId.toUpperCase();
    if (polyTarget) {
      this.deps.showPolyEditor(laneId, polyTarget, displayName);
    } else {
      document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
        p.hidden = p.dataset.page !== targetTab;
      });
      if (targetTab === 'poly') {
        this.deps.setActiveEngineLane?.(laneId);
      }
    }
    const polyPage = document.querySelector('[data-page="poly"]');
    if (polyPage) {
      const subRows = polyPage.querySelectorAll<HTMLElement>('[data-engine="subtractive"]');
      const showSubRows = lane?.engineId === 'subtractive';
      for (const row of subRows) row.style.display = showSubRows ? '' : 'none';
    }
    const laneLabelEl = document.getElementById('engine-lane-label');
    if (laneLabelEl) laneLabelEl.textContent = displayName;
    const polyActiveLabel = document.getElementById('poly-active-label');
    if (polyActiveLabel) polyActiveLabel.textContent = displayName;
    this.activeEditLane = laneId;
    this.injectEngineModulatorPanel(laneId, targetTab);
    this.deps.onActiveLaneChanged?.();
  }
```

- [ ] **Step 2: Make `onEditLane` delegate to it**

Replace the `onEditLane(laneId)` callback body in `buildCallbacks` with:

```ts
      onEditLane(laneId) {
        // Toggle off when the user clicks the already-active lane tab.
        if (self.activeEditLane === laneId) {
          document.querySelectorAll<HTMLElement>('.page').forEach((p) => { p.hidden = true; });
          document.querySelectorAll<HTMLButtonElement>('.session-lane-tab').forEach((t) => {
            t.classList.remove('active');
          });
          self.activeEditLane = null;
          self.deps.onActiveLaneChanged?.();
          return;
        }
        self.showLaneEditor(laneId);
      },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (in particular, `injectEngineModulatorPanel` is now called from a sibling method — confirm it remains accessible; keep it `private` since `showLaneEditor` is on the same class).

- [ ] **Step 4: Build to confirm the bundle compiles**

Run: `npm run build`
Expected: typecheck + bundle succeed.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts
git commit -m "refactor(session): extract SessionHost.showLaneEditor from onEditLane"
```

---

## Task 9: Add the 303-page engine selector

A mirror selector on the 303 page so tb303 lanes can be swapped. Both selectors share the swap flow.

**Files:**
- Modify: `index.html` (add ENGINE row to the 303 page)
- Modify: `src/engines/engine-selector-ui.ts` (add `populateEngineSelect303` + `wireEngineSelector303`)

- [ ] **Step 1: Add the selector markup to the 303 page**

In `index.html`, inside `<div class="page" data-page="303" hidden>` (line 161), insert a new ENGINE row **before** the existing PRESET row (before line 162 `<div class="row poly-section"> <span class="section-label">PRESET</span>`):

```html
        <div class="row poly-section">
          <span class="section-label">ENGINE</span>
          <span id="engine-lane-label-303" class="active-edit-label">303</span>
          <select id="engine-select-303"></select>
        </div>
```

- [ ] **Step 2: Add the 303 selector wiring (no separate unit test — DOM glue, verified by typecheck + Task 12 manual)**

In `src/engines/engine-selector-ui.ts`, add:

```ts
export interface EngineSelector303Deps {
  engineSel303: HTMLSelectElement;
  /** The lane currently being edited (sessionHost.activeEditLane). */
  getActiveLaneId: () => string | null;
  /** Wrap-in-undo swap entry point. Receives the lane id + chosen engine id. */
  onEngineChange: (laneId: string, newEngineId: string) => void;
}

/** Populate a <select> with the 5 melodic engines. */
export function populateEngineSelect303(sel: HTMLSelectElement, currentEngineId: string): void {
  sel.innerHTML = '';
  for (const id of melodicSynthEngineIds()) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = getEngine(id)?.name ?? id;
    if (id === currentEngineId) opt.selected = true;
    sel.appendChild(opt);
  }
}

/** Wire the 303-page engine selector: a change swaps the engine of the lane
 *  currently in edit. */
export function wireEngineSelector303(deps: EngineSelector303Deps): void {
  populateEngineSelect303(deps.engineSel303, 'tb303');
  deps.engineSel303.addEventListener('change', () => {
    const laneId = deps.getActiveLaneId();
    if (laneId) deps.onEngineChange(laneId, deps.engineSel303.value);
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add index.html src/engines/engine-selector-ui.ts
git commit -m "feat(engine-ui): 303-page engine selector (populate + wire)"
```

---

## Task 10: Wire the swap into `main.ts` (both selectors + reconcile dep)

Connect everything: build `EngineSwapDeps`, route both selector changes through `swapLaneEngineFlow` (wrapped in `withUndo`), implement `onSwapped` (re-route + selector sync), and pass `swapLaneEngine` to `SessionHost`.

> DOM/integration glue — verified by typecheck, build, and the Task 12 manual run.

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports + destructure `swapLaneEngine`**

(a) Near the top imports of `src/main.ts`, add:

```ts
import { swapLaneEngineFlow, type EngineSwapDeps } from './app/engine-swap';
import { wireEngineSelector303 } from './engines/engine-selector-ui';
import { getEngine, getEngineParamIds } from './engines/registry';
```

(Keep existing `engine-selector-ui` imports; merge `wireEngineSelector303` into that import line if cleaner. `getEngine`/`getEngineParamIds` may already be imported elsewhere — dedupe if so.)

(b) Add `swapLaneEngine` to the allocator destructure (currently ~line 127):

```ts
const { resources: laneResources, extraStrips, extraPolys,
        stripFor, ensureExtraPoly, ensureLaneVoice,
        ensureLaneResource, getLaneEngineInstance, swapLaneEngine } = lanes;
```

- [ ] **Step 2: Pass `swapLaneEngine` to the `SessionHost` deps**

In the `new SessionHost({ ... })` object (line 371), add next to `ensureLaneResource,` (~line 402):

```ts
  swapLaneEngine,
```

- [ ] **Step 3: Grab the 303 selector element**

Next to `const engineSel = $<HTMLSelectElement>('engine-select');` (line 168), add:

```ts
const engineSel303 = $<HTMLSelectElement>('engine-select-303');
```

- [ ] **Step 4: Build `EngineSwapDeps` + `onEngineChange`, after `sessionHost` is constructed**

After `sessionHost.init();` (line 419) and the `laneHost.setLookupEngineId(...)` block, add:

```ts
// Engine swap: change the engine of an existing lane in place.
const engineSwapDeps: EngineSwapDeps = {
  state: sessionHost.state,
  getEngineEditor: (id) => getEngine(id)?.editor,
  getEngineParamIds: (id) => getEngineParamIds(id),
  swapLaneEngine,
  onSwapped: (laneId, newId) => {
    // Re-route the editor to the new engine's page + rebuild its panels, then
    // keep both engine selectors in sync with the swapped lane.
    sessionHost.showLaneEditor(laneId);
    engineSel.value = newId;
    engineSel303.value = newId;
  },
  // saveSession is optional; SessionHost is not currently wired with an
  // autosave callback. The swap mutates SessionState (engineId/engineState),
  // which is what serializes on save; undo is the immediate safety net.
};

// One undoable entry per swap; getActiveLaneId resolves to the lane in edit.
const onEngineChangeUndoable = (laneId: string, newId: string) => {
  const run = () => swapLaneEngineFlow(engineSwapDeps, laneId, newId);
  if (_discreteHistoryDeps) withUndo(_discreteHistoryDeps, run); else run();
};
```

(`withUndo` and `_discreteHistoryDeps` are already in scope in main.ts — `withUndo` is imported from `./save/history-wiring`, `_discreteHistoryDeps` is the late-bound discrete history deps used by the existing selector. Confirm both names; if `_discreteHistoryDeps` is declared later in the file, move this block below its declaration or keep the getter pattern.)

- [ ] **Step 5: Route the poly selector through the swap flow**

The poly `#engine-select` is wired by `wireEngineSelector(engineSelectorDeps, currentEngineId)` (line 511). Add an `onEngineChange` to `EngineSelectorUIDeps` and use it in the change handler.

(a) In `src/engines/engine-selector-ui.ts`, add to `EngineSelectorUIDeps`:

```ts
  /** When provided, a selection swaps the active lane's engine via this
   *  callback (already wrapped in withUndo by the caller's run()). When
   *  omitted, the handler falls back to rebuildEngineParamUI only. */
  onEngineChange?: (laneId: string, newEngineId: string) => void;
```

(b) Update the change handler in `wireEngineSelector`:

```ts
  deps.engineSel.addEventListener('change', () => {
    const run = () => {
      if (deps.onEngineChange) deps.onEngineChange(deps.getActiveLaneId(), deps.engineSel.value);
      else rebuildEngineParamUI();
    };
    if (deps.historyDeps) withUndo(deps.historyDeps, run); else run();
  });
```

(c) In `src/main.ts`, add `onEngineChange` to `engineSelectorDeps` (line 497). Because the handler already wraps in `withUndo`, pass the **raw** flow here (not the undoable wrapper, to avoid a double snapshot):

```ts
  onEngineChange: (laneId, newId) => { swapLaneEngineFlow(engineSwapDeps, laneId, newId); },
```

> Note: `engineSelectorDeps` is declared at line 497, **above** the `engineSwapDeps` block from Step 4. Move the Step-4 `engineSwapDeps`/`onEngineChangeUndoable` block **above** line 497 (right after `sessionHost.init()` and the lookup wiring, which are also above 497), OR reference `engineSwapDeps` via a getter. Simplest: declare `engineSwapDeps` before `engineSelectorDeps`.

- [ ] **Step 6: Wire the 303 selector**

In `src/main.ts`, after `wireEngineSelector(engineSelectorDeps, currentEngineId);` (line 511), add:

```ts
wireEngineSelector303({
  engineSel303,
  getActiveLaneId: () => sessionHost.activeEditLane,
  onEngineChange: onEngineChangeUndoable,
});
```

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/engines/engine-selector-ui.ts
git commit -m "feat(app): wire engine swap into both selectors + SessionHost reconcile dep"
```

---

## Task 11: DSP test — swap changes the lane's timbre

Prove end-to-end through the allocator that after `swapLaneEngine` the lane holds the new engine instance and it produces a measurably different spectrum from the same note. Use `fm → wavetable` (both build their voice fresh on the render context — avoids subtractive's pre-bound PolySynth).

**Files:**
- Test: `src/app/engine-swap.dsp.test.ts` (create)

- [ ] **Step 1: Write the test**

Create `src/app/engine-swap.dsp.test.ts`:

```ts
// src/app/engine-swap.dsp.test.ts
// Layer-3: after swapLaneEngine the lane's engine instance is the new one and
// renders a measurably different spectrum from the same note.

import { describe, it, expect } from 'vitest';
import '../engines/fm';
import '../engines/wavetable';
import { createLaneAllocator } from './lane-allocator';
import { FxBus } from '../core/fx';
import { SidechainBus } from '../core/sidechain-bus';
import { OfflineAudioContext } from 'node-web-audio-api';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import type { SynthEngine } from '../engines/engine-types';

const SR = 44100, DUR = 0.35, MIDI = 48;

function renderLaneEngine(engine: SynthEngine): Promise<Float32Array> {
  return renderEngine(
    (ctx) => {
      const out = ctx.createGain();
      const voice = engine.createVoice(ctx as unknown as AudioContext, out as unknown as AudioNode);
      return { voice, output: out };
    },
    {
      durationSec: DUR,
      sampleRate: SR,
      events: [{ time: 0, type: 'trigger', midi: MIDI, gateDuration: DUR * 0.9 }],
    },
  );
}

describe('swapLaneEngine changes the lane timbre', () => {
  it('fm → wavetable swaps the engine instance and the spectrum shifts', async () => {
    const ctx = new OfflineAudioContext(1, 128, SR) as unknown as AudioContext;
    const master = ctx.createGain();
    const lanes = createLaneAllocator({
      ctx, master, fx: new FxBus(ctx, master), sidechainBus: new SidechainBus(),
      getBpm: () => 120, extraIds: [],
    });

    lanes.ensureLaneResource('L', 'fm');
    const fm = lanes.getLaneEngineInstance('L')!;
    expect(fm.id).toBe('fm');
    const before = await renderLaneEngine(fm); // render BEFORE swap disposes fm

    lanes.swapLaneEngine('L', 'wavetable');
    const wt = lanes.getLaneEngineInstance('L')!;
    expect(wt.id).toBe('wavetable');
    expect(wt).not.toBe(fm);

    const after = await renderLaneEngine(wt);

    const cBefore = spectralCentroid(before, SR);
    const cAfter  = spectralCentroid(after, SR);
    // Same note, different engine → centroids differ by a clear margin (relative).
    expect(Math.abs(cAfter - cBefore)).toBeGreaterThan(cBefore * 0.1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `NO_COLOR=1 npx vitest run src/app/engine-swap.dsp.test.ts`
Expected: PASS. If the margin is too tight for these two engines at this note, widen the note/duration or adjust the relative threshold — keep it **relative**, never an absolute magnitude (document any change in a comment).

- [ ] **Step 3: Commit**

```bash
git add src/app/engine-swap.dsp.test.ts
git commit -m "test(dsp): swapLaneEngine fm→wavetable shifts the lane spectrum"
```

---

## Task 12: Full verification + manual run + rebase

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the unit + fast suite**

Run: `npm run test:unit`
Expected: all green. Investigate and fix any failure before continuing.

- [ ] **Step 3: Manual run — verify the swap in the real app**

Use the run/verify flow (or `npm run dev`) and check, in the browser at http://localhost:5173:
1. On the **poly page**, with a subtractive lane active, change `ENGINE` to `FM` → the FM param/mod UI appears, the lane keeps its clips, the sound resets to FM's default. Play it.
2. Change `ENGINE` to `tb303` → the editor re-routes to the **303 page**; the lane plays as a 303.
3. On the **303 page**, change the new `ENGINE` selector to `Wavetable` → editor re-routes to the **poly page**; plays as wavetable.
4. Press **Ctrl+Z** → the engine reverts (live sound + UI) in one undo step. **Ctrl+Shift+Z** redoes it.
5. Confirm the `ENGINE` dropdowns do **not** list Drums.

Capture a screenshot of step 1 or 2 for the record.

- [ ] **Step 4: Run e2e (optional but recommended)**

Run: `npm run test:e2e`
Expected: existing e2e green (no regressions). If e2e is flaky/slow in this environment, note it and rely on the manual run.

- [ ] **Step 5: Rebase onto main (no merge commit at merge time)**

```bash
git fetch --all
git rebase main
```

Resolve any conflicts, re-run `npx tsc --noEmit` and `npm run test:unit` after the rebase. The actual merge back to `main` (fast-forward / no merge commit) is done via the finishing-a-development-branch flow when the user approves.

- [ ] **Step 6: Final commit (if the rebase produced fixups)**

```bash
git status
# commit any conflict resolutions with a clear message if needed
```

---

## Self-Review notes (author)

- **Spec coverage:** scope filter (Task 6), reset sound (Task 5), keep clips + envelope reconcile (Tasks 1, 5), `replaceEngine`/`swapLaneEngine` keeping strip+inserts (Tasks 2, 4), `swapLaneEngineFlow` guards (Task 5), 303 selector + symmetric tb303 + page re-route (Tasks 8, 9, 10), state-apply reconciliation for undo/redo/load (Task 7), persistence (Task 10, optional `saveSession`), DSP proof (Task 11). All spec sections map to a task.
- **Type consistency:** `swapLaneEngine(laneId, newEngineId)` signature identical across allocator interface, `EngineSwapDeps`, and `SessionHostDeps`. `reconcileLaneEnvelopes(lane, paramIds)` and `melodicSynthEngineIds()` names used consistently. `EngineSwapDeps`/`EngineSelector303Deps` field names match between definition and main.ts wiring.
- **Known integration caveat:** Tasks 7, 9, 10 are DOM/integration glue not unit-tested in the node env (SessionHost.init builds DOM); they are covered by typecheck, build, and the Task 12 manual run. This is called out explicitly rather than hidden behind a fake test.
