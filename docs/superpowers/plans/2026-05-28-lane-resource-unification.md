# Lane Resource Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the audio engine model so every lane has its own ChannelStrip + SynthEngine instance + per-lane state, and the Classic step-grid UI is removed in favour of Session view as the sole UI surface.

**Architecture:** Single `Map<laneId, LaneResources>` replaces all per-lane globals (`polysynth`, `bassStrip`, `polyStrip`, `drumBusStrip`, `extraPolys`, `extraStrips`). Routing decisions consult `lane.engineId` instead of `=== 'main'`-style id literals. A per-lane independent scheduler reads from each lane's active clip (variable `lengthBars` per clip). Lane creation via the "+" tab is the only way to add a synth; engine type is fixed at creation.

**Tech Stack:** TypeScript + Vite + Web Audio API. Tests via Vitest (`*.test.ts`, `*.dsp.test.ts`, `*.wiring.test.ts`). Real-audio rendering via `node-web-audio-api` in setup.ts. Playwright for visual + browser smoke checks.

**Spec:** [docs/superpowers/specs/2026-05-28-lane-resource-unification-design.md](../specs/2026-05-28-lane-resource-unification-design.md)

---

## Pre-flight (Task 0)

**Files:**
- Inspect: `git status`

- [ ] **Step 1: Reconcile pending working-tree changes.**

```bash
git status --short
```

The repo currently has uncommitted edits from the prior session (color/CSS fixes, scheduler depth scaling, partial id rename). Confirm with the user which to keep before starting the refactor; commit the good ones, discard the partial renames in `main.ts` / `session-host.ts` / `session-step-scheduler.ts` / `lane-engine-host.ts` that the spec supersedes.

- [ ] **Step 2: Confirm test baseline.**

Run: `npx vitest run`
Expected: 236+ passing. Record the exact count — this is the floor that Phase E must still respect.

- [ ] **Step 3: Confirm typecheck baseline.**

Run: `npx tsc --noEmit`
Expected: clean (zero output).

---

## Phase A — Lane resources, no audible change

### Task A.1: Create `LaneResources` container

**Files:**
- Create: `src/core/lane-resources.ts`
- Test: `src/core/lane-resources.test.ts`

- [ ] **Step 1: Write failing test.**

```ts
// src/core/lane-resources.test.ts
import { describe, it, expect } from 'vitest';
import { LaneResourceMap } from './lane-resources';

describe('LaneResourceMap', () => {
  it('allocates and retrieves resources by laneId', () => {
    const m = new LaneResourceMap();
    const stripStub = { dispose: () => {} } as unknown as import('./fx').ChannelStrip;
    const engineStub = { dispose: () => {} } as unknown as import('../engines/engine-types').SynthEngine;
    m.set('subtractive-1', { strip: stripStub, engine: engineStub });
    expect(m.get('subtractive-1')?.engine).toBe(engineStub);
  });

  it('dispose() tears down strip and engine', () => {
    const m = new LaneResourceMap();
    let stripDisposed = false;
    let engineDisposed = false;
    m.set('a', {
      strip:  { dispose: () => { stripDisposed = true; } } as unknown as import('./fx').ChannelStrip,
      engine: { dispose: () => { engineDisposed = true; } } as unknown as import('../engines/engine-types').SynthEngine,
    });
    m.dispose('a');
    expect(stripDisposed).toBe(true);
    expect(engineDisposed).toBe(true);
    expect(m.get('a')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify RED.**

Run: `npx vitest run src/core/lane-resources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation.**

```ts
// src/core/lane-resources.ts
// Per-lane audio resources. One entry per session lane; created at lane
// creation, disposed at lane delete. Replaces the legacy singleton globals
// (polysynth/bassStrip/polyStrip/drumBusStrip/extraPolys/extraStrips).

import type { ChannelStrip } from './fx';
import type { SynthEngine } from '../engines/engine-types';

export interface LaneResources {
  strip:  ChannelStrip;
  engine: SynthEngine;
}

export class LaneResourceMap {
  private inner = new Map<string, LaneResources>();

  get(laneId: string): LaneResources | undefined {
    return this.inner.get(laneId);
  }

  set(laneId: string, res: LaneResources): void {
    const existing = this.inner.get(laneId);
    if (existing) {
      existing.strip.dispose?.();
      existing.engine.dispose?.();
    }
    this.inner.set(laneId, res);
  }

  dispose(laneId: string): void {
    const res = this.inner.get(laneId);
    if (!res) return;
    res.strip.dispose?.();
    res.engine.dispose?.();
    this.inner.delete(laneId);
  }

  ids(): string[] {
    return [...this.inner.keys()];
  }

  *[Symbol.iterator](): Iterator<[string, LaneResources]> {
    yield* this.inner;
  }
}
```

- [ ] **Step 4: Run, verify GREEN.**

Run: `npx vitest run src/core/lane-resources.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/core/lane-resources.ts src/core/lane-resources.test.ts
git commit -m "feat(core): LaneResourceMap container (Phase A)"
```

---

### Task A.2: Allocate resources at boot, aliased to existing globals

**Files:**
- Modify: `src/main.ts` (the boot sequence around line 90-160 where `polysynth`/`bassStrip`/`polyStrip`/`drumBusStrip` are created)

- [ ] **Step 1: Read main.ts boot block.**

Read lines 80-160 of `src/main.ts` to locate the construction of `polysynth`, `bassStrip`, `polyStrip`, `drumBusStrip`, `subtractiveEngine.setPolySynth(polysynth)`.

- [ ] **Step 2: Insert LaneResourceMap import and allocation.**

After the existing global construction, add:

```ts
import { LaneResourceMap, type LaneResources } from './core/lane-resources';
import { createEngineInstance } from './engines/registry';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from './core/lane-ids';

const laneResources = new LaneResourceMap();

// Phase A: legacy singletons are aliased into the map. The objects in
// laneResources are the SAME instances as polysynth / bassStrip / etc.
// Reading either path returns identical state. Phase B will replace each
// global with its laneResources.get(id) lookup; Phase E deletes the globals.
laneResources.set(LANE_ID_BASS,  { strip: bassStrip,    engine: tb303Engine });
laneResources.set(LANE_ID_DRUMS, { strip: drumBusStrip, engine: drumsEngine });
laneResources.set(LANE_ID_POLY,  { strip: polyStrip,    engine: subtractiveEngine });
```

(`tb303Engine` / `drumsEngine` references — confirm by inspecting the existing imports; they are the singleton engine instances already in main.ts. If `drumsEngine` doesn't exist as a name, import the drums engine instance from `src/engines/drums-engine.ts`.)

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify app still boots in browser.**

Open the running Vite dev server (or restart: `npm run dev`). Open http://localhost:5173 in playwright/Browser. Confirm session tabs render. Press play on a scene — confirm audio fires identically to before. No regression.

- [ ] **Step 5: Commit.**

```bash
git add src/main.ts
git commit -m "feat(boot): allocate LaneResourceMap as aliases of existing singletons (Phase A)"
```

---

### Task A.3: Allocate extras through LaneResourceMap too

**Files:**
- Modify: `src/main.ts` (ensureExtraPoly function around line 120)

- [ ] **Step 1: Locate `ensureExtraPoly`.**

Find the function that lazily allocates `extraPolys[id]` + `extraStrips[id]`.

- [ ] **Step 2: After creating the extra strip + polysynth, also register them in `laneResources`.**

Modify `ensureExtraPoly`:

```ts
function ensureExtraPoly(id: ExtraId): PolySynth {
  let p = extraPolys[id];
  if (p) return p;
  const strip = new ChannelStrip(ctx, fx, masterStrip.input);
  p = new PolySynth(ctx, strip.input);
  extraStrips[id] = strip;
  extraPolys[id] = p;
  // Phase A: also seed laneResources so consumers can opt into the new path.
  // The SubtractiveEngine instance is created via the registry factory so it
  // has its own modHost (no more shared singleton modulators).
  const engine = createEngineInstance('subtractive');
  if (engine) {
    (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
    laneResources.set(slugFromExtraId(id), { strip, engine });
  }
  return p;
}
```

Helper to map legacy ExtraId (`poly1`) to slug (`subtractive-2`):

```ts
function slugFromExtraId(id: ExtraId): string {
  // poly1 → subtractive-2, poly2 → subtractive-3, …
  const n = parseInt(id.replace('poly', ''), 10) + 1;
  return `subtractive-${n}`;
}
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify audio.**

In Browser, open Subtractive 2 lane (creates `poly1` extra), confirm it sounds. DSP battery still green.

Run: `npx vitest run`
Expected: 236+ passing.

- [ ] **Step 5: Commit.**

```bash
git add src/main.ts
git commit -m "feat(boot): seed LaneResourceMap from ensureExtraPoly (Phase A)"
```

---

### Task A.4: Phase A self-check

- [ ] **Step 1: Run full suite.**

Run: `npx vitest run` — expect 236+ green.
Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 2: Manual browser check.**

Open http://localhost:5173. Confirm: session tabs render, scene playback works, lane mixer columns exist for `tb-303-1`, `drums-1`, `subtractive-1`, `subtractive-2` (slugs from previous turn). No console errors.

- [ ] **Step 3: Commit checkpoint tag (optional).**

```bash
git tag refactor/phase-a-done
```

---

## Phase B — Routing by engineId

### Task B.1: Replace `stripFor` to use LaneResourceMap

**Files:**
- Modify: `src/main.ts` (the `stripFor` function around line 135)

- [ ] **Step 1: Rewrite `stripFor`.**

```ts
const stripFor = (laneId: string): ChannelStrip => {
  // Drum voice strips are sub-channels of the drum bus; kept as-is.
  if (laneId in drums.channels) {
    const ch = drums.channels[laneId as DrumVoice];
    if (ch) return ch;
  }
  const res = laneResources.get(laneId);
  if (res) return res.strip;
  // For lane ids not yet allocated (lazy extras), allocate now.
  // This path supersedes ensureLaneStrip.
  // — but lazy alloc requires knowing the engineId, which the caller may
  // not pass. For now, throw — Phase B replaces every call site so we'll
  // know the engineId.
  throw new Error(`stripFor: no resources for laneId='${laneId}'`);
};
```

- [ ] **Step 2: Typecheck + run tests.**

```
npx tsc --noEmit && npx vitest run
```
Expected: clean + 236+ green.

- [ ] **Step 3: Browser smoke.**

Confirm no regression. The legacy `'bass'`/`'poly'`/`'drumBus'` ids should NOT appear in stripFor calls anymore (because Phase A.2 registered the slugs); if anywhere does and it throws, those call sites get fixed in subsequent B tasks.

- [ ] **Step 4: Commit.**

```bash
git add src/main.ts
git commit -m "refactor(routing): stripFor reads from LaneResourceMap (Phase B)"
```

---

### Task B.2: Replace `polyTriggerDirect` / `bassTriggerDirect` with engineId-routed trigger

**Files:**
- Modify: `src/main.ts` (the trigger functions around line 560-590)

- [ ] **Step 1: Rewrite the lane trigger entry point.**

Replace `polyTriggerDirect` + `bassTriggerDirect` with a single `triggerForLane(laneId, note, time, gate, accent, slidingIn?)` that consults `laneResources.get(laneId).engine` and dispatches by `engine.id`:

```ts
const triggerForLane = (
  laneId: string,
  note: number,
  time: number,
  gate: number,
  accent: boolean,
  slidingIn: boolean = false,
) => {
  const res = laneResources.get(laneId);
  if (!res) return;
  const engineId = res.engine.id;
  if (engineId === 'tb303') {
    setCurrentLaneForVoice(laneId);
    const voice = res.engine.createVoice(ctx, res.strip.input);
    setCurrentLaneForVoice(null);
    voice.trigger(note, time, { gateDuration: gate, accent, slide: slidingIn });
    return;
  }
  if (engineId === 'drums-machine') {
    // drums use midi → voice mapping
    const dv = GM_DRUM_MAP[note];
    if (dv) drums.trigger(dv, time, accent);
    return;
  }
  // Poly synths (subtractive/wavetable/fm/karplus)
  setCurrentLaneForVoice(laneId);
  const voice = res.engine.createVoice(ctx, res.strip.input);
  setCurrentLaneForVoice(null);
  voice.trigger(note, time, { gateDuration: gate, accent });
};
```

- [ ] **Step 2: Update all callers of `polyTriggerDirect` / `bassTriggerDirect` / `bassTriggerForArp` to use `triggerForLane` with the lane id.**

`src/session/session-step-scheduler.ts` and `src/arp/arp.ts` are the main callers. They already receive a `laneId`.

- [ ] **Step 3: Typecheck + tests.**

```
npx tsc --noEmit && npx vitest run
```
Expected: clean + green.

- [ ] **Step 4: Browser smoke.**

Play a scene. Confirm bass / drums / poly all sound.

- [ ] **Step 5: Commit.**

```bash
git add src/main.ts src/session/session-step-scheduler.ts src/arp/arp.ts
git commit -m "refactor(routing): triggerForLane dispatches by engine.id (Phase B)"
```

---

### Task B.3: Replace session-host hardcoded id checks

**Files:**
- Modify: `src/session/session-host.ts` (the `injectEngineModulatorPanel`, `onActivateLaneEditor`, `laneToTrackId`)

- [ ] **Step 1: In `injectEngineModulatorPanel`, replace `laneId === 'tb-303-1' ? 'tb303' : ...` chain with a lookup on `LaneResources`.**

The function should accept the LaneResourceMap via deps (add `laneResources` to `SessionHostDeps`). The engine is `laneResources.get(laneId)?.engine`. No more `getEngine(engineId)` singleton lookup.

- [ ] **Step 2: In `onActivateLaneEditor`, the `targetTab` decision needs to query `engineId` not laneId.**

```ts
const lane = this.state.lanes.find((l) => l.id === laneId);
const engineId = lane?.engineId ?? '';
const targetTab =
  engineId === 'tb303'         ? '303'   :
  engineId === 'drums-machine' ? 'drums' :
                                 'poly';
```

(Phase E removes the `targetTab` concept entirely with the Classic pages; Phase B keeps it temporarily.)

- [ ] **Step 3: Delete `laneToTrackId` — lane ids ARE the canonical slugs now.**

Update every call site (probably 2-3) to pass `laneId` directly.

- [ ] **Step 4: Typecheck + tests.**

```
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 5: Commit.**

```bash
git add src/session/session-host.ts
git commit -m "refactor(session-host): route by engine.id, drop laneId literals (Phase B)"
```

---

### Task B.4: Replace lane-engine-host hardcoded `=== 'main'` / `=== 'subtractive-1'`

**Files:**
- Modify: `src/engines/lane-engine-host.ts`

- [ ] **Step 1: The whole module's purpose was to manage the singleton vs extra split. Phase B eliminates that split.**

Refactor to: every lane has a real engine instance in `laneResources`. The "active engine lane" is just the active edit lane (the tab the user has open). No more `getLaneEngineId` / `ensureLaneEngine` magic.

Rewrite `getLaneEngineId(laneId)` to read from `lane.engineId` in SessionState (single source of truth):

```ts
export function getLaneEngineId(state: SessionState, laneId: string): string {
  return state.lanes.find((l) => l.id === laneId)?.engineId ?? 'subtractive';
}
```

`setLaneEngineIdInPattern` is OBSOLETE (engine can't change after lane creation per spec). Delete it. Find every call site and remove.

`ensureLaneEngine` — DELETE. Engine instances live in `laneResources`.

`setActiveEngineLane(laneId)` — keep as a thin wrapper that:
- updates `_lehState.activeLaneId = laneId`
- calls `rebuildEngineParamUI()`
- updates `engine-lane-label` text

- [ ] **Step 2: Update all consumers in main.ts.**

Anywhere main.ts called `ensureLaneEngine` or `setLaneEngineIdInPattern`, remove. The engine selector dropdown (`<select id="engine-select">`) ALSO becomes a no-op — but its full removal is deferred to Phase E.

- [ ] **Step 3: Typecheck + tests.**

```
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 4: Commit.**

```bash
git add src/engines/lane-engine-host.ts src/main.ts
git commit -m "refactor(lane-engine-host): drop singleton/extra split, drop setLaneEngineId (Phase B)"
```

---

### Task B.5: Delete `subtractiveEngine` singleton export

**Files:**
- Modify: `src/engines/subtractive.ts` (the bottom of the file, around line 350)

- [ ] **Step 1: Locate the singleton export.**

```ts
// Bottom of subtractive.ts (current state)
export const subtractiveEngine = new SubtractiveEngine();
registerEngine(subtractiveEngine);
registerEngineFactory('subtractive', () => new SubtractiveEngine());
```

- [ ] **Step 2: Remove the singleton; register only the factory.**

```ts
// New
const factoryRegistration = () => new SubtractiveEngine();
registerEngineFactory('subtractive', factoryRegistration);
// Also register an instance into the engine registry for legacy `getEngine`
// callers (most will be deleted in Phase E; this keeps Phase B compiling).
registerEngine(factoryRegistration());
```

- [ ] **Step 3: Update all imports of `subtractiveEngine` to `createEngineInstance('subtractive')`.**

Run a grep:

```
grep -rEn "subtractiveEngine\b" src/
```

Each call site needs replacement. The boot in main.ts already uses it for the `subtractive-1` lane's resources — replace with `createEngineInstance('subtractive')` so the singleton truly dies.

- [ ] **Step 4: Typecheck + tests.**

```
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 5: Commit.**

```bash
git add src/engines/subtractive.ts src/main.ts
git commit -m "refactor(subtractive): drop singleton export, route through factory (Phase B)"
```

---

### Task B.6: Phase B self-check

- [ ] **Step 1: Grep for any remaining id literals.**

```
grep -rEn "=== ['\"]main['\"]|=== ['\"]bass['\"]|=== ['\"]drums['\"]|=== ['\"]poly1['\"]" src/
```
Expected: zero results.

- [ ] **Step 2: Run full suite.**

`npx vitest run` — 236+ green.
`npx tsc --noEmit` — clean.

- [ ] **Step 3: Browser smoke.**

http://localhost:5173 — play bass, drums, subtractive 1, subtractive 2 (add via "+" if needed). All sound. LFO/ADSR on Subtractive 1 modulates Subtractive 1 only.

- [ ] **Step 4: Tag.**

```bash
git tag refactor/phase-b-done
```

---

## Phase C — Per-lane engine state (fixes "knobs leak between tabs")

### Task C.1: Add `engineState` field to SessionLane

**Files:**
- Modify: `src/session/session.ts`

- [ ] **Step 1: Extend SessionLane type.**

```ts
export interface SessionLane {
  id: string;
  engineId: string;
  name?: string;
  clips: (SessionClip | null)[];
  launchQuantize?: LaunchQuantize;
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
  };
  enginePresetName?: string;
}
```

Note: the old `engineState: { modulators?: ... }` field already exists. Just add `params?` and `enginePresetName?`.

- [ ] **Step 2: Typecheck.**

`npx tsc --noEmit` — clean.

- [ ] **Step 3: Commit.**

```bash
git add src/session/session.ts
git commit -m "feat(session): add SessionLane.engineState.params + enginePresetName (Phase C)"
```

---

### Task C.2: Knob change mirrors into `lane.engineState.params`

**Files:**
- Modify: `src/engines/engine-ui.ts` (where wireEngineParams hooks `onChange`)
- Test: `src/session/session-engine-state.test.ts` (new)

- [ ] **Step 1: Write failing test.**

```ts
// src/session/session-engine-state.test.ts
import { describe, it, expect } from 'vitest';
import { emptySessionState } from './session';
import { mirrorParamChange } from './session-engine-state'; // to be created

describe('per-lane engineState persistence', () => {
  it('mirrorParamChange writes to lane.engineState.params', () => {
    const state = emptySessionState();
    mirrorParamChange(state, 'subtractive-1', 'filter.cutoff', 0.42);
    const lane = state.lanes.find((l) => l.id === 'subtractive-1')!;
    expect(lane.engineState?.params?.['filter.cutoff']).toBe(0.42);
  });

  it('mirrorParamChange does not affect other lanes', () => {
    const state = emptySessionState();
    mirrorParamChange(state, 'subtractive-1', 'filter.cutoff', 0.42);
    const otherLane = state.lanes.find((l) => l.id === 'tb-303-1')!;
    expect(otherLane.engineState?.params?.['filter.cutoff']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify RED.**

`npx vitest run src/session/session-engine-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper.**

```ts
// src/session/session-engine-state.ts
import type { SessionState } from './session';

export function mirrorParamChange(
  state: SessionState,
  laneId: string,
  paramId: string,
  value: number,
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  if (!lane.engineState.params) lane.engineState.params = {};
  lane.engineState.params[paramId] = value;
}
```

- [ ] **Step 4: Run, verify GREEN.**

`npx vitest run src/session/session-engine-state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire from engine-ui.ts.**

In `wireEngineParams`, after `engine.setBaseValue(spec.id, v)`, call `mirrorParamChange(sessionState, ctx.laneId, spec.id, v)`. The session state is accessible via `ctx.sessionState` — add to `EngineUIContext` type.

```ts
// In src/engines/engine-ui.ts
onChange: (v) => {
  engine.setBaseValue(spec.id, v);
  if (ctx.sessionState) mirrorParamChange(ctx.sessionState, ctx.laneId, spec.id, v);
},
```

- [ ] **Step 6: Commit.**

```bash
git add src/session/session-engine-state.ts src/session/session-engine-state.test.ts src/engines/engine-ui.ts src/engines/engine-types.ts
git commit -m "feat(session): mirror knob changes into lane.engineState.params (Phase C)"
```

---

### Task C.3: Modulator change mirrors into `lane.engineState.modulators`

**Files:**
- Modify: `src/modulation/modulation-ui.ts` (after host.addModulator / removeModulator / setConnection)
- Modify: `src/session/session-engine-state.ts` (add `syncModulators` helper)
- Modify: `src/session/session-engine-state.test.ts` (new test)

- [ ] **Step 1: Write failing test.**

```ts
// Append to src/session/session-engine-state.test.ts
it('syncModulators writes the modulator array into lane.engineState.modulators', () => {
  const state = emptySessionState();
  const mods = [{ id: 'lfo1', kind: 'lfo' as const, enabled: true, connections: [] }];
  syncModulators(state, 'subtractive-1', mods);
  const lane = state.lanes.find((l) => l.id === 'subtractive-1')!;
  expect(lane.engineState?.modulators).toHaveLength(1);
  expect(lane.engineState?.modulators?.[0].id).toBe('lfo1');
});
```

(Import `syncModulators` from `./session-engine-state`.)

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement.**

```ts
// In src/session/session-engine-state.ts
import type { ModulatorState } from '../modulation/types';

export function syncModulators(
  state: SessionState,
  laneId: string,
  modulators: ModulatorState[],
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  // Deep-copy via JSON to detach from the live array.
  lane.engineState.modulators = JSON.parse(JSON.stringify(modulators));
}
```

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Wire from modulation-ui.ts.**

After every mutation (`host.addModulator(...)`, `host.removeModulator(...)`, `host.setConnection(...)`, `mod.enabled = !mod.enabled`, ADSR/LFO knob `onChange` callbacks), call `syncModulators(deps.sessionState, deps.laneId, deps.host.modulators)`.

Add `sessionState` to `ModulationUIDeps`.

- [ ] **Step 6: Commit.**

```bash
git add src/session/session-engine-state.ts src/session/session-engine-state.test.ts src/modulation/modulation-ui.ts
git commit -m "feat(session): mirror modulator edits into lane.engineState.modulators (Phase C)"
```

---

### Task C.4: Tab switch rebinds UI to active lane's engine

**Files:**
- Modify: `src/main.ts` (the `mountSubtractiveLaneKnobs` call inside `rebuildEngineParamUI` and the active-lane change handler)
- Modify: `src/engines/engine-selector-ui.ts` (the `rebuildEngineParamUI` function)

- [ ] **Step 1: Write a DSP-level regression test.**

```ts
// src/session/session-knobs-per-lane.dsp.test.ts (NEW)
import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from '../engines/subtractive';
import { renderEngine } from '../../test/render';
import { rms, spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100, DUR = 0.5, MIDI = 48;

async function renderLaneWith(cutoff: number) {
  const engine = new SubtractiveEngine();
  engine.setBaseValue('filter.cutoff', cutoff);
  return renderEngine(
    (ctx) => {
      const out = (ctx as unknown as { createGain(): GainNode }).createGain();
      const voice = engine.createVoice(ctx as unknown as AudioContext, out);
      return { voice, output: out };
    },
    { durationSec: DUR, sampleRate: SR, events: [{ time: 0, type: 'trigger', midi: MIDI, gateDuration: DUR * 0.9 }] },
  );
}

describe('per-lane SubtractiveEngine instances are independent', () => {
  it('two separate engine instances do not share filter cutoff', async () => {
    const dark = await renderLaneWith(0.15);
    const bright = await renderLaneWith(0.85);
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 2);
  });
});
```

- [ ] **Step 2: Run RED first.**

This test should PASS even today — SubtractiveEngine is constructable. But the test pins the contract that two instances are isolated. The Phase C breakage was at the UI layer, not engine layer. Mark this test as ✓ baseline.

`npx vitest run src/session/session-knobs-per-lane.dsp.test.ts`
Expected: PASS.

- [ ] **Step 3: Update `rebuildEngineParamUI` to read from the active lane's engine.**

The `engineSelectorDeps.getActiveLaneId()` returns the active lane id. Replace `subtractiveEngine` references in `mountSubtractiveLaneKnobs(laneId)` with `laneResources.get(laneId)?.engine`:

```ts
// In main.ts mountSubtractiveLaneKnobs
function mountSubtractiveLaneKnobs(laneId: string): void {
  const res = laneResources.get(laneId);
  if (!res) return;
  const engine = res.engine;
  // ... build sections using `engine` (not the singleton) ...
}
```

- [ ] **Step 4: Update knob `onChange` to dispatch into the LANE'S engine, not the singleton.**

Already covered by `engine.setBaseValue` if `engine` is the lane's instance.

- [ ] **Step 5: Run all tests.**

`npx vitest run` — 236+ green.
`npx tsc --noEmit` — clean.

- [ ] **Step 6: Browser smoke — the REAL test.**

Open Subtractive 1, lower filter.cutoff to ~0.2. Switch to Subtractive 2 tab. Its filter.cutoff should be 0.55 (default), NOT 0.2. Switch back — Subtractive 1 still at 0.2.

- [ ] **Step 7: Commit.**

```bash
git add src/main.ts src/engines/engine-selector-ui.ts src/session/session-knobs-per-lane.dsp.test.ts
git commit -m "feat(ui): tab switch rebinds knob UI to active lane's engine (Phase C)"
```

---

### Task C.5: Phase C self-check

- [ ] **Step 1: Per-lane LFO modulation test in browser.**

Open Subtractive 1. Add LFO1 routing to `filter.cutoff` with depth=1.0. Play a note — hear sweep.
Switch to Subtractive 2. No LFO routing here. Play — clean note, no sweep.
Switch back to Subtractive 1 — sweep still there.

- [ ] **Step 2: Tag.**

```bash
git tag refactor/phase-c-done
```

---

## Phase D — Per-lane independent scheduler

### Task D.1: GlobalTransport + LaneTransport state types

**Files:**
- Create: `src/core/transport-state.ts`
- Test: `src/core/transport-state.test.ts`

- [ ] **Step 1: Write failing tests.**

```ts
// src/core/transport-state.test.ts
import { describe, it, expect } from 'vitest';
import { createGlobalTransport, createLaneTransport } from './transport-state';

describe('transport state', () => {
  it('createGlobalTransport defaults to stopped, bpm=120', () => {
    const g = createGlobalTransport();
    expect(g.isPlaying).toBe(false);
    expect(g.bpm).toBe(120);
  });

  it('createLaneTransport defaults to stopped, no clip', () => {
    const l = createLaneTransport();
    expect(l.playing).toBe(false);
    expect(l.currentClipIndex).toBeNull();
    expect(l.loopStartedAt).toBe(0);
  });
});
```

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement.**

```ts
// src/core/transport-state.ts
export interface GlobalTransport {
  bpm: number;
  isPlaying: boolean;
  startedAt: number;
}

export interface LaneTransport {
  currentClipIndex: number | null;
  loopStartedAt: number;
  playing: boolean;
}

export function createGlobalTransport(): GlobalTransport {
  return { bpm: 120, isPlaying: false, startedAt: 0 };
}

export function createLaneTransport(): LaneTransport {
  return { currentClipIndex: null, loopStartedAt: 0, playing: false };
}
```

- [ ] **Step 4: Run GREEN. Commit.**

```bash
git add src/core/transport-state.ts src/core/transport-state.test.ts
git commit -m "feat(transport): GlobalTransport + LaneTransport types (Phase D)"
```

---

### Task D.2: Per-lane scheduler tick

**Files:**
- Create: `src/core/lane-scheduler.ts`
- Test: `src/core/lane-scheduler.test.ts`

- [ ] **Step 1: Write failing test — a 1-bar clip loops 4 times in 4 bars.**

```ts
// src/core/lane-scheduler.test.ts
import { describe, it, expect } from 'vitest';
import { tickLane, type SchedulerContext } from './lane-scheduler';
import type { SessionClip } from '../session/session';
import { TICKS_PER_STEP } from './notes';

describe('lane scheduler', () => {
  it('a 1-bar clip loops 4× under a 4-bar window', () => {
    const clip: SessionClip = {
      id: 'c1',
      lengthBars: 1,
      notes: [{ start: 0, duration: TICKS_PER_STEP, midi: 60, velocity: 100 }],
    };
    const triggered: number[] = [];
    const ctx: SchedulerContext = {
      bpm: 120,
      lookaheadSec: 0.12,
      now: 0,
      loopStartedAt: 0,
      onTrigger: (note, time) => { triggered.push(time); },
      onAutomation: () => {},
    };
    // 4 bars at 120 bpm = 8 seconds. Tick the scheduler at 200ms cadence,
    // accumulating fired notes. Expect 4 fires (one per loop iteration).
    for (let t = 0; t < 8.0; t += 0.2) {
      tickLane(clip, { ...ctx, now: t });
    }
    expect(triggered).toHaveLength(4);
    // Triggers should be at t=0, 2, 4, 6 (1 bar = 2 seconds at 120 bpm).
    expect(triggered[1] - triggered[0]).toBeCloseTo(2.0, 1);
  });
});
```

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement.**

```ts
// src/core/lane-scheduler.ts
import type { SessionClip, ClipEnvelope } from '../session/session';
import { TICKS_PER_STEP } from './notes';

export interface SchedulerContext {
  bpm: number;
  lookaheadSec: number;     // schedule horizon (e.g., 0.12)
  now: number;              // current audio time
  loopStartedAt: number;    // ctx-time when current loop iteration began
  onTrigger: (note: { midi: number; duration: number; velocity: number }, scheduleTime: number) => void;
  onAutomation: (env: ClipEnvelope, clipTimeNorm: number, scheduleTime: number) => void;
}

/** Returns the updated `loopStartedAt` so the caller can persist it. */
export function tickLane(clip: SessionClip, ctx: SchedulerContext): number {
  const secPerBeat = 60 / ctx.bpm;
  const ticksPerBar = TICKS_PER_STEP * 16; // 16 steps per bar
  const clipDurSec = clip.lengthBars * 4 * secPerBeat;

  let loopStart = ctx.loopStartedAt;
  const windowStart = ctx.now;
  const windowEnd = ctx.now + ctx.lookaheadSec;

  // Advance loop boundaries until we cover the window.
  while (loopStart + clipDurSec < windowStart) loopStart += clipDurSec;

  // Iterate possibly multiple loop instances within the window.
  let iterStart = loopStart;
  while (iterStart < windowEnd) {
    for (const n of clip.notes) {
      const clipTimeSec = (n.start / ticksPerBar) * 4 * secPerBeat;
      const scheduleAt = iterStart + clipTimeSec;
      if (scheduleAt >= windowStart && scheduleAt < windowEnd) {
        ctx.onTrigger({ midi: n.midi, duration: n.duration, velocity: n.velocity }, scheduleAt);
      }
    }
    iterStart += clipDurSec;
  }

  return loopStart;
}
```

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Add more tests — scene launch resync, stop, envelope evaluation.**

```ts
it('two clips with different lengths re-sync at their LCM', () => {
  const oneBar: SessionClip   = { id: 'a', lengthBars: 1, notes: [{ start: 0, duration: 10, midi: 60, velocity: 100 }] };
  const fourBar: SessionClip  = { id: 'b', lengthBars: 4, notes: [{ start: 0, duration: 10, midi: 48, velocity: 100 }] };
  const triggered: Array<{ midi: number; time: number }> = [];
  const ctxBase: SchedulerContext = {
    bpm: 120, lookaheadSec: 0.2, now: 0, loopStartedAt: 0,
    onTrigger: (n, t) => triggered.push({ midi: n.midi, time: t }),
    onAutomation: () => {},
  };
  // 8 seconds = 4 bars at 120 bpm. 1-bar clip fires 4 times, 4-bar clip fires 1 time.
  for (let t = 0; t < 8.0; t += 0.2) {
    tickLane(oneBar,  { ...ctxBase, now: t });
    tickLane(fourBar, { ...ctxBase, now: t });
  }
  const aFires = triggered.filter((x) => x.midi === 60).length;
  const bFires = triggered.filter((x) => x.midi === 48).length;
  expect(aFires).toBe(4);
  expect(bFires).toBe(1);
});
```

- [ ] **Step 6: Run GREEN. Commit.**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts
git commit -m "feat(scheduler): per-lane tick respects clip lengthBars (Phase D)"
```

---

### Task D.3: Integrate per-lane scheduler into transport tick loop

**Files:**
- Modify: `src/core/transport.ts` (or wherever the rAF/setTimeout tick is wired)
- Modify: `src/main.ts` (boot the new scheduler instead of the old `seq.tick()`)

- [ ] **Step 1: Locate the legacy `seq.tick()` invocation.**

Read `src/core/transport.ts`. Find where it advances `seq` every 25ms.

- [ ] **Step 2: Replace with new per-lane scheduler invocation.**

```ts
// In the 25ms interval handler:
const now = ctx.currentTime;
for (const lane of sessionState.lanes) {
  const lt = laneTransports.get(lane.id);
  if (!lt || !lt.playing) continue;
  if (lt.currentClipIndex == null) continue;
  const clip = lane.clips[lt.currentClipIndex];
  if (!clip) continue;
  const res = laneResources.get(lane.id);
  if (!res) continue;
  const newLoopStart = tickLane(clip, {
    bpm: globalTransport.bpm,
    lookaheadSec: 0.12,
    now,
    loopStartedAt: lt.loopStartedAt,
    onTrigger: (n, scheduleTime) => triggerForLane(lane.id, n.midi, scheduleTime, n.duration / 96, false),
    onAutomation: (env, clipTimeNorm, scheduleTime) => {
      // Sample envelope at clipTimeNorm, write to AudioParam at scheduleTime.
      const value = sampleEnvelope(env, clipTimeNorm);
      const registry = automationRegistry.get(env.paramId);
      registry?.setValue(value);
    },
  });
  lt.loopStartedAt = newLoopStart;
}
```

- [ ] **Step 3: Delete the old `Sequencer.tick` body (or stub it out).**

The legacy sequencer might still expose `tick()` from other modules; check. If unused, delete the function.

- [ ] **Step 4: Wire scene launch.**

`onLaunchScene(sceneIdx)`:
```ts
for (const lane of sessionState.lanes) {
  const clipIdx = sessionState.scenes[sceneIdx].clipPerLane[lane.id];
  let lt = laneTransports.get(lane.id) ?? createLaneTransport();
  lt.currentClipIndex = clipIdx ?? null;
  lt.loopStartedAt = ctx.currentTime;
  lt.playing = clipIdx != null;
  laneTransports.set(lane.id, lt);
}
globalTransport.isPlaying = true;
globalTransport.startedAt = ctx.currentTime;
```

`onStopAll()`:
```ts
globalTransport.isPlaying = false;
for (const lt of laneTransports.values()) lt.playing = false;
```

- [ ] **Step 5: Run tests + browser smoke.**

`npx vitest run` — green.
`npx tsc --noEmit` — clean.
Browser: launch a scene, hear playback. Add a 1-bar clip to one lane and a 4-bar clip to another via the clip editor; play and confirm they loop independently.

- [ ] **Step 6: Commit.**

```bash
git add src/core/transport.ts src/main.ts
git commit -m "feat(scheduler): drive playback via per-lane tickLane (Phase D)"
```

---

### Task D.4: Drop legacy seq.pattern fields

**Files:**
- Modify: `src/core/pattern.ts` (the PatternData type — remove all per-track fields)
- Modify: All callers of `seq.pattern.bass` / `seq.pattern.melody` / `seq.pattern.drums` / `seq.pattern.automation` / `seq.pattern.extraPolyTracks`

- [ ] **Step 1: Grep call sites.**

```
grep -rEn "seq\.pattern\.(bass|melody|drums|automation|extraPolyTracks|polyNotes|bassNotes|polyMode|bassMode)" src/
```

- [ ] **Step 2: For each call site, replace with the equivalent read from the active clip of the appropriate lane.**

The active clip per lane is `sessionState.lanes.find(...).clips[laneTransports.get(...).currentClipIndex]`. Build a helper:

```ts
// src/session/active-clip.ts
export function activeClipForLane(
  state: SessionState,
  transports: Map<string, LaneTransport>,
  laneId: string,
): SessionClip | null {
  const t = transports.get(laneId);
  if (!t || t.currentClipIndex == null) return null;
  const lane = state.lanes.find((l) => l.id === laneId);
  return lane?.clips[t.currentClipIndex] ?? null;
}
```

Replace each seq.pattern.X read with the helper or — if the call site is now dead Classic UI code — delete it.

- [ ] **Step 3: Delete `PatternData.bass/melody/drums/automation/extraPolyTracks` fields.**

```ts
// src/core/pattern.ts — new PatternData (mostly empty, kept only for transport length/bpm)
export interface PatternData {
  length: number;
  // bass, melody, drums, automation, extraPolyTracks — DELETED
}
```

Actually: at this point `seq.pattern` itself may be vestigial. The transport carries `bpm`. Length per clip lives on the clip. Delete `PatternBank` and `bank.slots` entirely, and update `Sequencer` to be a thin shell that just holds bpm + isPlaying.

- [ ] **Step 4: Delete `seq.setLength`, `seq.bpm =`, `bank.current`, `bank.slots[]`, `applyMinimalTechnoDemo` references.**

Update demo file separately in next task.

- [ ] **Step 5: Run tests + typecheck.**

Expect failures in tests that read `seq.pattern.*`. Triage:

- `src/core/sequencer.test.ts` — **DELETE** (legacy step-based sequencer; replaced by lane-scheduler).
- `src/session/session-migration.test.ts` — **DELETE** (classic→session migration is gone).
- `src/session/session-add-lane.test.ts` — **REWRITE** to use the new `+ Add lane` flow (slug-id derived from engine type, allocates LaneResources).
- DSP batteries under `src/engines/*.dsp.test.ts` — **MUST stay green** (they don't touch `seq.pattern`; they instantiate engines directly).
- Anything else flagged by `npx vitest run`: read the failing assertion, decide DELETE (tested deleted behaviour) vs REWRITE (tested behaviour still valid with new shape).

Run `npx tsc --noEmit` after fixes; expect clean.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor: drop seq.pattern as source of truth; reads route through clips (Phase D)"
```

---

### Task D.5: Rewrite minimal-techno demo for SessionState

**Files:**
- Modify: `src/demo/demo-minimal-techno.ts`

- [ ] **Step 1: Replace `buildMinimalTechnoDemo()` with a function that returns a `SessionState`.**

```ts
import { emptySessionState, type SessionState, type SessionLane, type SessionClip, type SessionScene } from '../session/session';
import { TICKS_PER_STEP } from '../core/notes';
import type { NoteEvent } from '../core/notes';

function makeBassClip(notes: Array<{ s: number; n: number; a?: boolean; sl?: boolean }>): SessionClip {
  return {
    id: 'bass-clip-1',
    lengthBars: 2,
    notes: notes.map((e) => ({
      start: e.s * TICKS_PER_STEP,
      duration: Math.floor(TICKS_PER_STEP * (e.sl ? 1.5 : 0.92)),
      midi: e.n,
      velocity: e.a ? 115 : 80,
    })),
  };
}

export function buildMinimalTechnoDemo(): SessionState {
  const state = emptySessionState();

  // 1-bar drums clip on `drums-1` (kick on 1/5/9/13, closed hat on 3/7/11/15)
  const drumsClip: SessionClip = {
    id: 'demo-drums-1',
    lengthBars: 1,
    notes: [
      // Drum lanes use MIDI → DrumVoice via GM_DRUM_MAP. 36 = kick, 42 = ch hat.
      { start: 0,                  duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 4, duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 8, duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 12,duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 2, duration: TICKS_PER_STEP / 2, midi: 42, velocity:  85 },
      { start: TICKS_PER_STEP * 6, duration: TICKS_PER_STEP / 2, midi: 42, velocity:  85 },
      { start: TICKS_PER_STEP * 10,duration: TICKS_PER_STEP / 2, midi: 42, velocity:  85 },
      { start: TICKS_PER_STEP * 14,duration: TICKS_PER_STEP / 2, midi: 42, velocity:  85 },
    ],
  };

  // 2-bar bass clip on `tb-303-1`
  const bassClip = makeBassClip([
    { s: 0,  n: 36, a: true  }, { s: 3, n: 36, sl: true },
    { s: 4,  n: 39, a: true  }, { s: 7, n: 39 },
    { s: 16, n: 36, a: true  }, { s: 19, n: 41, sl: true },
    { s: 22, n: 43 },           { s: 26, n: 36 },
  ]);

  // 4-bar pad clip on `subtractive-1`
  const padClip: SessionClip = {
    id: 'demo-pad-1',
    lengthBars: 4,
    notes: [
      { start: 0,                  duration: TICKS_PER_STEP * 32, midi: 48, velocity: 80 },
      { start: 0,                  duration: TICKS_PER_STEP * 32, midi: 55, velocity: 80 },
      { start: TICKS_PER_STEP * 32,duration: TICKS_PER_STEP * 32, midi: 46, velocity: 80 },
      { start: TICKS_PER_STEP * 32,duration: TICKS_PER_STEP * 32, midi: 53, velocity: 80 },
    ],
  };

  // Place clips into the lanes' clip arrays and create a scene referencing them.
  const bass  = state.lanes.find((l) => l.id === 'tb-303-1')!;
  const drums = state.lanes.find((l) => l.id === 'drums-1')!;
  const poly  = state.lanes.find((l) => l.id === 'subtractive-1')!;
  bass.clips[0]  = bassClip;
  drums.clips[0] = drumsClip;
  poly.clips[0]  = padClip;

  const scene: SessionScene = {
    id: 'demo-scene-1',
    name: 'Demo',
    clipPerLane: { 'tb-303-1': 0, 'drums-1': 0, 'subtractive-1': 0 },
  };
  state.scenes.push(scene);

  return state;
}
```

- [ ] **Step 2: Update `applyMinimalTechnoDemo(deps)` to assign the state to sessionHost + recreate laneResources.**

```ts
export function applyMinimalTechnoDemo(deps: DemoDeps): void {
  const state = buildMinimalTechnoDemo();
  deps.sessionHost.applyLoadedSessionState(state);
}
```

- [ ] **Step 3: Test in browser.**

Click the demo button (wherever it lives). Confirm: 1 scene with 3 clips. Each clip's lengthBars visible. Play scene → hear playback with independent loops.

- [ ] **Step 4: Commit.**

```bash
git add src/demo/demo-minimal-techno.ts
git commit -m "feat(demo): rewrite minimal-techno for SessionState (Phase D)"
```

---

### Task D.6: Phase D self-check

- [ ] **Step 1: Run full suite.**

`npx vitest run` — engine DSP batteries green (236+). Old sequencer tests deleted or adapted.

- [ ] **Step 2: Browser independence smoke.**

Add a 1-bar drums clip and a 4-bar bass clip in the same scene. Hit play. Listen: drums clip loops 4× under one bass clip cycle.

- [ ] **Step 3: Tag.**

```bash
git tag refactor/phase-d-done
```

---

## Phase E — Kill Classic UI

### Task E.1: Remove Classic pages from index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Remove the page divs.**

Delete:
- `<div class="page" data-page="303">` and its body (TB-303 step grid).
- `<div class="page" data-page="drums">` and its body.
- `<div class="page" data-page="poly">` and its body.
- `<div class="page" data-page="rolls">` and its body.
- `<div class="page" data-page="auto">` and its body.
- `<div class="page" data-page="fx">` — KEEP (Master FX panel).

- [ ] **Step 2: Remove the page tab buttons.**

Delete the static page tabs (`TB-303`, `Drums`, `Poly Synth`, `Piano Rolls`, `Automation`). Keep `Master FX`.

- [ ] **Step 3: Reload in browser.**

App should render Session view immediately on boot. No console errors.

- [ ] **Step 4: Commit.**

```bash
git add index.html
git commit -m "refactor(ui): remove Classic page DOM (Phase E)"
```

---

### Task E.2: Delete obsolete JS modules

**Files:**
- Delete: `src/engines/engine-selector-ui.ts` (the inner engine selector for existing lanes)
- Delete: `src/engines/engine-selector-ui.test.ts`
- Delete: `src/automation/` (the global automation tab) — but keep `clip-automation-lanes.ts` (per-clip envelopes UI which lives in the session inspector)

- [ ] **Step 1: List candidates.**

Inspect:
- `src/engines/engine-selector-ui.ts` — DELETE.
- `src/automation/automation-ui.ts` — DELETE if all consumers go away.
- `src/automation/automation-tick.ts` — KEEP if per-clip automation reads from it; else delete.
- `src/core/drum-master-ui.ts` — DELETE (master drum bus UI; the new mixer column covers it).

- [ ] **Step 2: Remove imports from main.ts.**

For each deleted module, remove `import` lines and call sites.

- [ ] **Step 3: Delete the files.**

```bash
git rm src/engines/engine-selector-ui.ts src/engines/engine-selector-ui.test.ts
# ... etc.
```

- [ ] **Step 4: Typecheck + tests.**

`npx tsc --noEmit` — fix any remaining references.
`npx vitest run` — green.

- [ ] **Step 5: Commit.**

```bash
git commit -m "refactor(ui): delete classic-only modules (Phase E)"
```

---

### Task E.3: Delete now-orphaned helpers in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Grep for now-unused symbols.**

Look for the following names. For each, confirm no remaining callers (after Phase E.2's deletions), then remove:
- `polyTriggerDirect`, `bassTriggerDirect`, `bassTriggerForArp`
- `ensureExtraPoly`, `ensureLaneStrip`, `ensureLaneVoice`
- `rebuildMixer` (replaced by session mixer rendering)
- `LANE_LABELS`, `ALL_TRACKS`, `EXTRA_IDS`
- `ExtraId` type, `TrackId` type
- `bank`, `PatternBank` (consumed by SaveManager — keep until Phase F)
- `seq` if it's now empty except for bpm — fold bpm into globalTransport.

- [ ] **Step 2: Typecheck + smoke.**

`npx tsc --noEmit` — clean.
Browser smoke.

- [ ] **Step 3: Commit.**

```bash
git add src/main.ts
git commit -m "refactor(main): delete now-unused classic helpers (Phase E)"
```

---

### Task E.4: Drop the `<select id=\"engine-select\">` inner selector

**Files:**
- Modify: `index.html` (the ENGINE row inside what was the poly page — confirmed deleted by E.1, so this may already be gone).
- Modify: `src/engines/engine-selector-ui.ts` — already deleted in E.2.

- [ ] **Step 1: Confirm deletion.**

```
grep -rn "engine-select" src/ index.html
```
Expected: zero hits.

- [ ] **Step 2: Make sure the "+" tab's engine-type picker still works.**

The OUTER selector is part of the session tab bar. Confirm it still creates lanes with the chosen engine.

- [ ] **Step 3: Commit if any cleanup happened.**

---

### Task E.5: Phase E self-check

- [ ] **Step 1: Grep verifications per spec success criteria.**

```
grep -rEn "polysynth\b|bassStrip\b|polyStrip\b|drumBusStrip\b" src/
```
Expected: zero results in module-scope `let`/`const` declarations outside `lane-resources.ts`. Function-local variable names are fine.

- [ ] **Step 2: Run full suite.**

`npx vitest run` — green.
`npx tsc --noEmit` — clean.

- [ ] **Step 3: Tag.**

```bash
git tag refactor/phase-e-done
```

---

## Phase F — Save format cleanup

### Task F.1: Strip bank/seq.pattern from SaveManager

**Files:**
- Modify: `src/save/save-wiring.ts` (and `save/` siblings)

- [ ] **Step 1: Locate `buildSavedStateV2` / `applyLoadedState`.**

Read the current SaveManager code.

- [ ] **Step 2: Rewrite serialization to dump only `SessionState`.**

```ts
export function buildSavedStateV2(deps: SaveDeps): SavedStateV2 {
  return {
    schemaVersion: 3, // bump
    sessionState: deps.getSessionState(),
    bpm: deps.bpm,
    masterFx: deps.masterFx.serialize(),
  };
}

export function applyLoadedState(state: SavedStateV2, deps: SaveDeps): void {
  if (state.schemaVersion !== 3) {
    console.warn('Save schema mismatch — skipping load.');
    return;
  }
  deps.applyLoadedSessionState(state.sessionState);
  deps.setBpm(state.bpm);
  deps.masterFx.restore(state.masterFx);
}
```

- [ ] **Step 3: Delete all bank/seq.pattern serialization code.**

- [ ] **Step 4: Test save/load round-trip in browser.**

Save the current session, refresh, load. Expect: lanes restored with engine state, presets, clips, automation, names.

- [ ] **Step 5: Commit.**

```bash
git add src/save/
git commit -m "refactor(save): serialize SessionState only (Phase F)"
```

---

### Task F.2: Phase F self-check

- [ ] **Step 1: Final full sweep.**

```
grep -rEn "bank\.slots|seq\.pattern\.|seq\.setPattern" src/
```
Expected: zero hits.

- [ ] **Step 2: Final test run.**

`npx vitest run` — green.
`npx tsc --noEmit` — clean.

- [ ] **Step 3: Final browser walkthrough.**

- Boot directly into Session view.
- 3 lanes by default: TB-303 1, Drums 1, Subtractive 1.
- "+" → add Subtractive 2; its knobs are independent of Subtractive 1.
- Add LFO to filter.cutoff on Subtractive 2; play scene with both clips; only Subtractive 2 sweeps.
- 1-bar drums clip + 4-bar bass clip loop independently.
- Save, refresh, load — state restored.

- [ ] **Step 4: Tag final.**

```bash
git tag refactor/lane-unification-done
```

---

## Success criteria recap (from spec)

- [ ] App boots into Session view directly. No Classic pages reachable.
- [ ] Adding a Subtractive lane via "+" allocates an independent strip + engine.
- [ ] LFO routed to Subtractive 1's `filter.cutoff` is audible only on Subtractive 1.
- [ ] Two lanes with `lengthBars = 1` and `lengthBars = 4` loop independently and re-sync every 4 bars.
- [ ] All 236+ engine DSP-battery tests stay green throughout.
- [ ] `npx tsc --noEmit` clean at the close of each phase.
- [ ] `grep -rEn "=== ['\"]main['\"]|=== ['\"]bass['\"]|=== ['\"]drums['\"]|=== ['\"]poly1['\"]" src/` returns zero results at the close of Phase B.
- [ ] No module-scope global refs to `polysynth`/`bassStrip`/`polyStrip`/`drumBusStrip` outside `lane-resources.ts` at the close of Phase E.
