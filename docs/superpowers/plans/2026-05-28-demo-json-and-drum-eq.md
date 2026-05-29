# Demo-as-JSON + Drum-Bus EQ Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the programmatic demo with a static JSON asset that drives per-scene preset selections for every lane, and make the drum-bus EQ automatable so the Drums lane LFO can target it.

**Architecture:** Two new fields on the session data model — `SessionLane.enginePresetName` (already exists, currently unused) for the boot preset, and `SessionScene.presetPerLane` for per-scene preset changes. A `public/demos/minimal-techno.json` file becomes the source of truth, replacing `applyMinimalTechnoDemo()` + `slotConfigurators[]`. For drums, `ChannelStrip` exposes its EQ filter gain AudioParams via getters, `DrumsEngine.setBusStrip()` accepts the lane's strip, and `DrumsVoice.getAudioParams()` returns `bus.eq.low/mid/high` so the modulation binder can wire LFO depth into them. Dead `master.level`/`master.tune` knobs are deleted.

**Tech Stack:** TypeScript, Vite (static asset serving), Vitest (unit tests), Playwright (e2e), Web Audio API.

---

## File structure

**New files:**
- `public/demos/minimal-techno.json` — serialized SessionState + per-scene preset map. Vite serves it untouched at `/demos/minimal-techno.json`.
- `scripts/snapshot-demo.ts` — one-shot script that runs the legacy `applyMinimalTechnoDemo` + `importClassicToSession` flow, augments the result with preset metadata, and writes the JSON.
- `src/demo/demo-loader.ts` — `fetchDemoSession(url)` + `applyDemoPresets(state, deps)` helpers that the boot path uses.

**Modified files:**
- `src/session/session.ts` — add `SessionScene.presetPerLane?: Record<string, string>`.
- `src/session/session-host.ts` — `applyLoadedSessionState` applies `enginePresetName` per lane; `onLaunchScene` reapplies `scene.presetPerLane`.
- `src/main.ts` — boot replaces `applyMinimalTechnoDemo(demoDeps); applyLoadedSessionState(importClassicToSession(bank))` with the JSON-loader path; removes `runSlotConfigurator(0)`.
- `src/engines/lane-engine-host.ts` — delete `slotConfigurators` field, `setSlotConfigurators`, `runSlotConfigurator`.
- `src/demo/demo-minimal-techno.ts` — keep `buildMinimalTechnoDemo()` (still used by the snapshot script) but delete `applyMinimalTechnoDemo()` and `wireDemoMinimalTechno()`; remove `applyPolyPresetForLane` from `DemoDeps`.
- `src/core/fx.ts` — `ChannelStrip` exposes `getEqGainParam(band)` returning the BiquadFilterNode's `.gain` AudioParam.
- `src/engines/drums-engine.ts` — drop `master.level`/`master.tune` from `DRUM_PARAMS`; add `bus.eq.low/mid/high`; add `setBusStrip(strip)`; `DrumsVoice.getAudioParams()` returns the new params; `setBaseValue` routes `bus.eq.*` to `strip.setEqLow/Mid/High`; drop the "MASTER" section of `buildParamUI` (now empty).
- `tests/e2e/lane-ui.spec.ts` — add per-lane preset tests + scene-launch preset test + drum bus EQ destination test.

---

## Task 1: Add `SessionScene.presetPerLane` to the data model

**Files:**
- Modify: `src/session/session.ts:41-45`
- Test: `src/session/session.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `src/session/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emptyScene, type SessionScene } from './session';

describe('SessionScene.presetPerLane', () => {
  it('is undefined by default on an empty scene', () => {
    const s = emptyScene('Scene 1');
    expect(s.presetPerLane).toBeUndefined();
  });

  it('accepts a laneId → preset-name map when set', () => {
    const s: SessionScene = {
      ...emptyScene('Scene 1'),
      presetPerLane: { 'subtractive-1': 'factory:PAD Warm' },
    };
    expect(s.presetPerLane?.['subtractive-1']).toBe('factory:PAD Warm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session.test.ts`
Expected: FAIL with TypeScript error "Object literal may only specify known properties" on `presetPerLane`.

- [ ] **Step 3: Add the field to the interface**

In `src/session/session.ts`, find the `SessionScene` interface (around line 41) and modify it to:

```ts
export interface SessionScene {
  id: string;
  name?: string;
  clipPerLane: Record<string, number | null>;
  /** Optional per-lane preset to apply when this scene is launched.
   *  Keyed by laneId, value uses the same shape as `polyPresetName`
   *  (`factory:Name` / `user:Name` / `engine:Name`). */
  presetPerLane?: Record<string, string>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/session/session.ts src/session/session.test.ts
git commit -m "feat(session): add SessionScene.presetPerLane for JSON-driven demos"
```

---

## Task 2: `applyLoadedSessionState` applies `lane.enginePresetName` at boot

**Files:**
- Modify: `src/session/session-host.ts:131-145` (`applyLoadedSessionState`)
- Modify: `src/session/session-host.ts:55-82` (`SessionHostDeps`)
- Modify: `src/main.ts:674-695` (where SessionHost is constructed)
- Test: `src/session/session-host-presets.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `src/session/session-host-presets.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SessionHost } from './session-host';
import type { SessionState } from './session';

function makeMinimalDeps(applied: string[]): ConstructorParameters<typeof SessionHost>[0] {
  // Only the fields applyLoadedSessionState touches need to be real.
  return {
    // @ts-expect-error — partial deps for unit test
    ctx: { currentTime: 0 },
    // @ts-expect-error — partial deps
    seq: { bpm: 120, isPlaying: () => false, start: () => {}, sessionMode: true },
    bank: { slots: [] } as never,
    playBtn: { textContent: '' } as never,
    resetAutomationPosition: () => {},
    triggerForLane: () => {},
    drums: {} as never,
    drumLanes: [],
    markTrackActive: () => {},
    ensureExtraPoly: () => ({}) as never,
    extraStrips: {},
    getLaneEngineId: () => 'subtractive',
    ensureLaneVoice: () => null,
    showPolyEditor: () => {},
    polysynth: {} as never,
    mixerDeps: {} as never,
    midiLabel: () => '',
    automationRegistry: new Map(),
    getAutoAbsSubIdx: () => 0,
    applyPresetForLane: (laneId: string, presetName: string) => {
      applied.push(`${laneId}=${presetName}`);
    },
  };
}

describe('SessionHost.applyLoadedSessionState — preset application', () => {
  it('calls deps.applyPresetForLane for every lane with enginePresetName', () => {
    const applied: string[] = [];
    const host = new SessionHost(makeMinimalDeps(applied));
    const state: SessionState = {
      lanes: [
        { id: 'subtractive-1', engineId: 'subtractive', clips: [], enginePresetName: 'factory:PAD Warm' },
        { id: 'subtractive-2', engineId: 'subtractive', clips: [], enginePresetName: 'factory:LEAD Soft Sine' },
        { id: 'tb-303-1',      engineId: 'tb303',       clips: [] /* no preset */ },
      ],
      scenes: [],
      globalQuantize: '1/1',
    };
    host.applyLoadedSessionState(state);
    expect(applied).toEqual([
      'subtractive-1=factory:PAD Warm',
      'subtractive-2=factory:LEAD Soft Sine',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-presets.test.ts`
Expected: FAIL — `applyPresetForLane` is not a recognised property on SessionHostDeps yet.

- [ ] **Step 3: Add `applyPresetForLane` to `SessionHostDeps`**

In `src/session/session-host.ts`, find the `SessionHostDeps` interface (around line 55) and add the optional field at the end (after `ensureLaneResource?` and `runSlotConfigurator?`):

```ts
  /** Apply a preset to a lane by name. Called by applyLoadedSessionState
   *  for every lane.enginePresetName, and by onLaunchScene for every
   *  scene.presetPerLane entry. Optional so test fixtures without audio
   *  can skip it. */
  applyPresetForLane?: (laneId: string, presetName: string) => void;
```

- [ ] **Step 4: Modify `applyLoadedSessionState` to invoke `applyPresetForLane`**

Find the `applyLoadedSessionState` method (around line 131) and replace the for-loop that calls `ensureLaneResource` with this version that also applies the preset:

```ts
  applyLoadedSessionState(sess: SessionState): void {
    const migrated = migrateLoadedSessionState(sess);
    this.state.lanes = migrated.lanes ?? [];
    this.state.scenes = migrated.scenes ?? [];
    this.state.globalQuantize = migrated.globalQuantize ?? '1/1';
    this.laneStates.clear();
    for (const lane of this.state.lanes) {
      this.laneStates.set(lane.id, emptyLanePlayState(lane.id));
      this.deps.ensureLaneResource?.(lane.id, lane.engineId);
      if (lane.enginePresetName) {
        this.deps.applyPresetForLane?.(lane.id, lane.enginePresetName);
      }
    }
    this.applyEngineState();
    this.renderWithMixer();
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-presets.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Wire `applyPresetForLane` in main.ts**

In `src/main.ts`, find the `new SessionHost({ ... })` constructor call (around line 674) and add the new dep just after `runSlotConfigurator,`:

```ts
  runSlotConfigurator,
  applyPresetForLane: (laneId, presetName) => {
    const inst = getLaneEngineInstance(laneId);
    const ps = (inst as { getPolySynth?(): PolySynth | null } | null)?.getPolySynth?.();
    if (!ps) return;
    applyPresetByName(ps, presetName);
    refreshPolyPresetSelect();
    if (inst) refreshLaneKnobs(laneId, inst);
  },
```

- [ ] **Step 7: Run typecheck + full unit suite**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: no errors, all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/session/session-host.ts src/session/session-host-presets.test.ts src/main.ts
git commit -m "feat(session): applyLoadedSessionState applies lane.enginePresetName"
```

---

## Task 3: `onLaunchScene` reapplies `scene.presetPerLane`

**Files:**
- Modify: `src/session/session-host.ts:243-250` (`onLaunchScene` callback)
- Test: `src/session/session-host-presets.test.ts` (extend)

- [ ] **Step 1: Add the failing test**

Append to `src/session/session-host-presets.test.ts`:

```ts
describe('SessionHost onLaunchScene — preset application', () => {
  it('applies scene.presetPerLane when a scene is launched', () => {
    const applied: string[] = [];
    const host = new SessionHost(makeMinimalDeps(applied));
    host.applyLoadedSessionState({
      lanes: [
        { id: 'subtractive-1', engineId: 'subtractive', clips: [] },
      ],
      scenes: [
        {
          id: 's1', name: 'A', clipPerLane: {},
          presetPerLane: { 'subtractive-1': 'factory:LEAD Bright Saw' },
        },
      ],
      globalQuantize: '1/1',
    });
    // Drop the boot-time applies (none in this state) and the launch's call.
    applied.length = 0;
    // Reach into the host's callbacks to launch scene 0 without rendering DOM.
    // host.callbacks is private — exercise via the wired session-ui callback
    // surface instead by invoking the public render path then triggering the
    // launch through the same path the UI uses.
    // (For this unit test we use the inspector's callback shortcut.)
    const cbs = (host as unknown as { callbacks: { onLaunchScene(i: number): void } }).callbacks;
    cbs.onLaunchScene(0);
    expect(applied).toEqual(['subtractive-1=factory:LEAD Bright Saw']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-presets.test.ts`
Expected: FAIL — `applied` ends empty because `onLaunchScene` doesn't read `presetPerLane`.

- [ ] **Step 3: Modify `onLaunchScene` to apply presets**

In `src/session/session-host.ts`, find the `onLaunchScene(idx)` callback (around line 243) and modify it to read `scene.presetPerLane`:

```ts
      onLaunchScene(idx) {
        const scene = self.state.scenes[idx];
        if (!scene) return;
        void ctx.resume();
        launchScene(self.laneStates, self.state, scene, idx, ctx.currentTime, seq.bpm);
        if (scene.presetPerLane) {
          for (const [laneId, presetName] of Object.entries(scene.presetPerLane)) {
            self.deps.applyPresetForLane?.(laneId, presetName);
          }
        }
        self.deps.runSlotConfigurator?.(idx);
        if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
        self.renderWithMixer();
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-presets.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts src/session/session-host-presets.test.ts
git commit -m "feat(session): onLaunchScene applies scene.presetPerLane"
```

---

## Task 4: Write the demo snapshot script

**Files:**
- Create: `scripts/snapshot-demo.ts`
- Create: `public/demos/.gitkeep`

- [ ] **Step 1: Create the script**

Create `scripts/snapshot-demo.ts`:

```ts
// One-shot: generate public/demos/minimal-techno.json from the existing
// programmatic demo. Run with `npx tsx scripts/snapshot-demo.ts`. The
// output is the source of truth — re-run only when the demo changes.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PatternBank } from '../src/core/pattern';
import { buildMinimalTechnoDemo } from '../src/demo/demo-minimal-techno';
import { importClassicToSession } from '../src/session/session-migration';
import type { SessionState } from '../src/session/session';

// Per-scene preset map. Order matches the 4 PatternBank slots the demo
// creates: A (warm), B (bright stab), C (glass), D (soft sine). TB-303
// rotates through its three engine presets, drums stays on default kit.
const SCENE_PRESETS: Array<Record<string, string>> = [
  { 'subtractive-1': 'factory:PAD Warm',         'subtractive-2': 'factory:PAD Sweep',          'tb-303-1': 'engine:Acid Classic' },
  { 'subtractive-1': 'factory:LEAD Bright Saw',  'subtractive-2': 'factory:LEAD Soft Sine',     'tb-303-1': 'engine:Dub Sub'      },
  { 'subtractive-1': 'factory:PAD Glass',        'subtractive-2': 'factory:PAD Detuned Strings','tb-303-1': 'engine:Squelch'      },
  { 'subtractive-1': 'factory:LEAD Soft Sine',   'subtractive-2': 'factory:PAD Choir Aah',      'tb-303-1': 'engine:Acid Classic' },
];

function main(): void {
  const bank = new PatternBank(32);
  const patterns = buildMinimalTechnoDemo();
  for (let i = 0; i < 4; i++) bank.slots[i] = patterns[i];
  const state: SessionState = importClassicToSession(bank);

  // Boot preset: scene A's selection per lane.
  for (const lane of state.lanes) {
    const bootPreset = SCENE_PRESETS[0][lane.id];
    if (bootPreset) lane.enginePresetName = bootPreset;
  }
  // Per-scene preset map.
  state.scenes.forEach((scene, idx) => {
    scene.presetPerLane = SCENE_PRESETS[idx] ?? {};
  });

  const outPath = resolve(import.meta.dirname, '../public/demos/minimal-techno.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath} (${state.lanes.length} lanes, ${state.scenes.length} scenes)`);
}

main();
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/snapshot-demo.ts`
Expected: prints "wrote .../public/demos/minimal-techno.json (4 lanes, 4 scenes)" (lane count is 3 built-in + extra polys created by the demo; verify the actual number matches what the demo produces).

- [ ] **Step 3: Sanity-check the JSON**

Run: `npx tsx -e "const j = require('./public/demos/minimal-techno.json'); console.log({lanes: j.lanes.map(l => l.id + ':' + (l.enginePresetName ?? '∅')), scenePresets: j.scenes.map(s => s.presetPerLane)});"`
Expected: every lane has the right `enginePresetName` (or `∅` for drums), every scene has a non-empty `presetPerLane`.

- [ ] **Step 4: Commit the JSON**

```bash
git add scripts/snapshot-demo.ts public/demos/minimal-techno.json
git commit -m "build: snapshot demo SessionState to JSON asset"
```

---

## Task 5: Boot loader fetches the JSON

**Files:**
- Create: `src/demo/demo-loader.ts`
- Modify: `src/main.ts:948-957` (the boot block that applies the demo)

- [ ] **Step 1: Write the failing test**

Create `src/demo/demo-loader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchDemoSession } from './demo-loader';
import type { SessionState } from '../session/session';

describe('fetchDemoSession', () => {
  it('parses a SessionState from the response body', async () => {
    const fake: SessionState = {
      lanes: [{ id: 'tb-303-1', engineId: 'tb303', clips: [] }],
      scenes: [],
      globalQuantize: '1/1',
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fake,
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchDemoSession('/demos/minimal-techno.json');
    expect(result.lanes[0].id).toBe('tb-303-1');
    expect(fetchSpy).toHaveBeenCalledWith('/demos/minimal-techno.json');
    vi.unstubAllGlobals();
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchDemoSession('/missing.json')).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/demo/demo-loader.test.ts`
Expected: FAIL — file `./demo-loader` doesn't exist.

- [ ] **Step 3: Create the loader**

Create `src/demo/demo-loader.ts`:

```ts
import type { SessionState } from '../session/session';

/** Fetch a demo SessionState from a URL (typically `/demos/*.json` served
 *  by Vite from `public/`). Throws on non-OK response. */
export async function fetchDemoSession(url: string): Promise<SessionState> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchDemoSession ${url}: HTTP ${res.status}`);
  return (await res.json()) as SessionState;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/demo/demo-loader.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Replace the boot block in main.ts**

In `src/main.ts`, find this block (around line 948):

```ts
applyMinimalTechnoDemo(demoDeps);
sessionHost.applyLoadedSessionState(importClassicToSession(bank));
buildArpUI(arpUIDeps);
// Apply the demo's slot-0 preset configurator so the boot state has a real
// preset selected (otherwise the dropdown shows "(custom)" until the user
// launches a scene).
runSlotConfigurator(0);
```

Replace with:

```ts
// Boot demo: fetched as a static JSON asset rather than constructed
// programmatically. The JSON drives both the SessionState and the
// per-scene preset map; applyLoadedSessionState reads lane.enginePresetName
// and onLaunchScene reads scene.presetPerLane.
fetchDemoSession('/demos/minimal-techno.json').then((state) => {
  sessionHost.applyLoadedSessionState(state);
  buildArpUI(arpUIDeps);
}).catch((err: unknown) => {
  console.error('Demo load failed; falling back to empty session.', err);
  buildArpUI(arpUIDeps);
});
```

- [ ] **Step 6: Add the import**

At the top of `src/main.ts`, near the other `./demo/*` imports, add:

```ts
import { fetchDemoSession } from './demo/demo-loader';
```

And remove these imports that are no longer used:

```ts
import { applyMinimalTechnoDemo, wireDemoMinimalTechno, buildMinimalTechnoDemoSession } from './demo/demo-minimal-techno';
```

Also remove the now-orphaned `wireDemoMinimalTechno(demoDeps);` call (search for it).

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: a few errors about `demoDeps`, `runSlotConfigurator`, and possibly `slotConfigurators`. Those are addressed in Task 6 — leave them for now.

If the typecheck shows errors unrelated to those three names, fix them inline before proceeding.

- [ ] **Step 8: Commit (will be amended if typecheck still failing)**

```bash
git add src/demo/demo-loader.ts src/demo/demo-loader.test.ts src/main.ts
git commit -m "feat(demo): replace programmatic apply with JSON loader (slotConfigurators still wired)"
```

---

## Task 6: Delete the slotConfigurators infrastructure

**Files:**
- Modify: `src/engines/lane-engine-host.ts:9-12, 27-32, 62-74`
- Modify: `src/main.ts:336, 363-364, 693, ...` (everywhere `slotConfigurators` / `setSlotConfigurators` / `runSlotConfigurator` are referenced)
- Modify: `src/session/session-host.ts:81-83` (the `runSlotConfigurator?` dep)
- Modify: `src/demo/demo-minimal-techno.ts` (delete `applyMinimalTechnoDemo`, `wireDemoMinimalTechno`, `applyPolyPresetForLane`; keep `buildMinimalTechnoDemo` because the snapshot script uses it)

- [ ] **Step 1: Strip the slotConfigurators state from lane-engine-host.ts**

Replace `src/engines/lane-engine-host.ts` lines 9-12 (interface) with:

```ts
export interface LaneEngineHostState {
  activeLaneId: string;
}
```

Replace lines 27-32 with:

```ts
export function createLaneEngineState(): LaneEngineHostState {
  return {
    activeLaneId: 'subtractive-1',
  };
}
```

Delete lines 62-74 (the `setSlotConfigurators` and `runSlotConfigurator` exports).

- [ ] **Step 2: Strip the wrappers from main.ts**

In `src/main.ts`, delete these lines:

```ts
const setSlotConfigurators = (cbs: Array<(() => void) | null>) => leh.setSlotConfigurators(_lehState, cbs);
const runSlotConfigurator = (idx: number) => leh.runSlotConfigurator(_lehState, idx);
```

And remove `runSlotConfigurator,` from the `new SessionHost({ ... })` props block.

Also remove the entire `demoDeps` object and any `demoDeps.setSlotConfigurators` / `demoDeps.applyPolyPresetForLane` references.

- [ ] **Step 3: Drop the dep from SessionHostDeps**

In `src/session/session-host.ts`, find these lines (around 80-83):

```ts
  /** Invoke the slot configurator for a given index (used by the demo to
   *  apply per-scene presets). No-op when there's no configurator registered. */
  runSlotConfigurator?: (idx: number) => void;
```

Delete them.

In the `onLaunchScene` callback, delete this line:

```ts
        self.deps.runSlotConfigurator?.(idx);
```

- [ ] **Step 4: Slim down demo-minimal-techno.ts**

In `src/demo/demo-minimal-techno.ts`:
- Delete `applyMinimalTechnoDemo`.
- Delete `wireDemoMinimalTechno`.
- Delete the `DemoDeps` interface entirely.
- Delete `buildMinimalTechnoDemoSession` if it has no remaining callers.
- Keep `buildMinimalTechnoDemo()` exported.

Run: `grep -rn "applyMinimalTechnoDemo\|wireDemoMinimalTechno\|buildMinimalTechnoDemoSession\|DemoDeps" src/`
Expected after edits: only the snapshot script (`scripts/snapshot-demo.ts`) references `buildMinimalTechnoDemo`; nothing references the deleted symbols.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full unit suite**

Run: `npm run test:unit`
Expected: 199 → ~201 tests passing (Task 1 added 2, Task 2 added 1, Task 3 added 1, Task 5 added 2; net +6 with no losses).

If `demo-minimal-techno.test.ts` fails because it referenced deleted exports, update it: keep only tests for `buildMinimalTechnoDemo()` (the patterns themselves).

- [ ] **Step 7: Commit**

```bash
git add src/engines/lane-engine-host.ts src/main.ts src/session/session-host.ts src/demo/demo-minimal-techno.ts src/demo/demo-minimal-techno.test.ts
git commit -m "refactor: delete slotConfigurators infrastructure (replaced by JSON presets)"
```

---

## Task 7: E2E test — demo presets visible at boot

**Files:**
- Modify: `tests/e2e/lane-ui.spec.ts` (append)

- [ ] **Step 1: Add the failing test**

Append to `tests/e2e/lane-ui.spec.ts`:

```ts
test.describe('demo JSON presets', () => {
  test('every poly lane shows its boot preset in the dropdown', async ({ page }) => {
    await page.goto('/');
    // Sub 1
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:PAD Warm');
    // Sub 2
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-2"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:PAD Sweep');
  });

  test('launching scene B switches presets on every lane', async ({ page }) => {
    await page.goto('/');
    // The four scene-launch buttons live in the session grid as ▶ buttons.
    // Launch scene index 1 (B).
    await page.locator('.session-scene-launch').nth(1).click();
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-1"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:LEAD Bright Saw');
    await page.locator('button.session-lane-tab[data-lane-id="subtractive-2"]').click();
    await expect(page.locator('#poly-preset-select')).toHaveValue('factory:LEAD Soft Sine');
  });
});
```

- [ ] **Step 2: Update the existing slot-0 preset test if needed**

If the test on line 47 (`boot applies the demo slot-0 preset (PAD Warm)`) still says `factory:PAD Warm` and that matches the JSON, leave it. Otherwise update the expected value to whatever the JSON's lane A preset is.

- [ ] **Step 3: Rebuild and run e2e**

Run: `npm run build && npm run test:e2e`
Expected: all tests pass, including the two new ones.

If the scene-launch test can't find `.session-scene-launch`, inspect the actual selector via Playwright snapshot in the dev server and adjust.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/lane-ui.spec.ts
git commit -m "test(e2e): assert demo JSON applies per-lane presets at boot and on scene launch"
```

---

## Task 8: Expose ChannelStrip EQ filter gain AudioParams

**Files:**
- Modify: `src/core/fx.ts:86-133` (ChannelStrip)
- Test: `src/core/fx.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `src/core/fx.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';

describe('ChannelStrip.getEqGainParam', () => {
  let ctx: AudioContext;
  let strip: ChannelStrip;

  beforeAll(() => {
    ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    strip = new ChannelStrip(ctx, ctx.destination, fx);
  });

  it('returns the AudioParam for the low band', () => {
    const p = strip.getEqGainParam('low');
    expect(p).toBeDefined();
    expect(typeof p.value).toBe('number');
  });

  it('the returned AudioParam reflects setEqLow writes', () => {
    const p = strip.getEqGainParam('low');
    strip.setEqLow(6);
    expect(p.value).toBeCloseTo(6, 5);
    strip.setEqLow(-3);
    expect(p.value).toBeCloseTo(-3, 5);
  });

  it('exposes mid and high too', () => {
    expect(strip.getEqGainParam('mid')).toBeDefined();
    expect(strip.getEqGainParam('high')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`
Expected: FAIL — `getEqGainParam` doesn't exist.

- [ ] **Step 3: Add the getter to ChannelStrip**

In `src/core/fx.ts`, find the existing `setEqLow / setEqMid / setEqHigh` methods (around line 128). Add this method right after them:

```ts
  /** Return the BiquadFilterNode gain AudioParam for the requested EQ band.
   *  Lets external code (modulation host, automation) write to the filter
   *  gain with sample-accurate scheduling — `setEqLow`/`setEqMid`/`setEqHigh`
   *  are convenience setters; `getEqGainParam` is the canonical handle. */
  getEqGainParam(band: 'low' | 'mid' | 'high'): AudioParam {
    if (band === 'low')  return this.eqLow.gain;
    if (band === 'mid')  return this.eqMid.gain;
    return this.eqHigh.gain;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/fx.ts src/core/fx.test.ts
git commit -m "feat(fx): ChannelStrip.getEqGainParam exposes EQ filter gain AudioParams"
```

---

## Task 9: DrumsEngine.setBusStrip + bus.eq.* params

**Files:**
- Modify: `src/engines/drums-engine.ts:26-39` (DRUM_PARAMS)
- Modify: `src/engines/drums-engine.ts:51-82` (DrumsVoice)
- Modify: `src/engines/drums-engine.ts:93-265` (DrumsEngine)
- Modify: `src/main.ts:397-410` (ensureLaneResource)
- Test: `src/engines/drums-engine.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `src/engines/drums-engine.test.ts`:

```ts
import { ChannelStrip, FxBus } from '../core/fx';

describe('DrumsEngine bus EQ', () => {
  it('exposes bus.eq.low/mid/high AudioParams once setBusStrip is called', () => {
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new (await import('./drums-engine')).DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    const voice = engine.createVoice(ctx, strip.input);
    const params = voice.getAudioParams();
    expect(params.has('bus.eq.low')).toBe(true);
    expect(params.has('bus.eq.mid')).toBe(true);
    expect(params.has('bus.eq.high')).toBe(true);
  });

  it('setBaseValue("bus.eq.low", v) routes to the strip\'s EQ gain', () => {
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    const engine = new (await import('./drums-engine')).DrumsEngine();
    engine.setSharedFx(fx);
    engine.setBusStrip(strip);
    engine.createVoice(ctx, strip.input);
    engine.setBaseValue('bus.eq.low', 9);
    expect(strip.getEqGainParam('low').value).toBeCloseTo(9, 5);
  });
});
```

The existing test file in `src/engines/drums-engine.test.ts` uses Vitest's `describe(..., () => {})` pattern with synchronous bodies. The `await import(...)` inside `it` is fine because Vitest awaits the `it` body's returned promise — keep it inline rather than top-of-file so the test stays self-contained.

If `DrumsEngine` isn't currently exported, change the file's declaration `export class DrumsEngine implements SynthEngine {` — but check first: grep for `export class DrumsEngine`. If it's not exported, export it.

- [ ] **Step 2: Export `DrumsEngine` if needed**

Run: `grep -n "export class DrumsEngine" src/engines/drums-engine.ts`
If no match, replace `class DrumsEngine implements SynthEngine` with `export class DrumsEngine implements SynthEngine`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: FAIL on the two new tests — `setBusStrip` doesn't exist; `bus.eq.low` isn't in params.

- [ ] **Step 4: Modify DRUM_PARAMS — drop dead `master.*`, add `bus.eq.*`**

In `src/engines/drums-engine.ts`, replace the entire `DRUM_PARAMS` array (lines 26-39) with:

```ts
const DRUM_PARAMS: EngineParamSpec[] = [
  // Bus EQ — automatable via the lane's modulators.
  { id: 'bus.eq.low',  label: 'EQ Lo',  kind: 'continuous', min: -18, max: 18, default: 0, unit: 'dB' },
  { id: 'bus.eq.mid',  label: 'EQ Mid', kind: 'continuous', min: -18, max: 18, default: 0, unit: 'dB' },
  { id: 'bus.eq.high', label: 'EQ Hi',  kind: 'continuous', min: -18, max: 18, default: 0, unit: 'dB' },
  // Per-voice levels (one .level spec per DRUM_LANES entry).
  { id: 'kick.level',      label: 'Kick',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'snare.level',     label: 'Snare', kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'closedHat.level', label: 'CHat',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'openHat.level',   label: 'OHat',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'clap.level',      label: 'Clap',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'cowbell.level',   label: 'Cwbll', kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'tom.level',       label: 'Tom',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'ride.level',      label: 'Ride',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
];
```

- [ ] **Step 5: Add `setBusStrip` and update `DrumsVoice.getAudioParams`**

In `src/engines/drums-engine.ts`, modify the `DrumsEngine` class to add a strip reference and a setter. Right after `setSharedFx(fx: FxBus): void { this.sharedFx = fx; }` (around line 119), add:

```ts
  private busStrip: import('../core/fx').ChannelStrip | null = null;
  setBusStrip(strip: import('../core/fx').ChannelStrip): void {
    this.busStrip = strip;
  }
```

Modify `DrumsVoice` so it can read the strip from the engine. Change the constructor signature to accept the engine reference, then use it in `getAudioParams`:

Replace the `DrumsVoice` class declaration (around line 51) with:

```ts
class DrumsVoice implements Voice {
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    private dm: DrumMachine,
    private busStrip: import('../core/fx').ChannelStrip | null,
  ) {}

  getAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    for (const voice of DRUM_LANES) {
      const ch = this.dm.channels[voice];
      if (ch && ch.level) m.set(`${voice}.level`, ch.level.gain);
    }
    if (this.busStrip) {
      m.set('bus.eq.low',  this.busStrip.getEqGainParam('low'));
      m.set('bus.eq.mid',  this.busStrip.getEqGainParam('mid'));
      m.set('bus.eq.high', this.busStrip.getEqGainParam('high'));
    }
    return m;
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const voice = GM_DRUM_MAP[midi];
    if (!voice) return;
    this.dm.trigger(voice, time, !!opts.accent);
  }

  release(_t: number): void {}
  connect(_d: AudioNode): void {}
  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
  }
}
```

Update `createVoice` to pass the busStrip:

Find `const drumVoice = new DrumsVoice(dm);` (around line 178) and change it to:

```ts
    const drumVoice = new DrumsVoice(dm, this.busStrip);
```

- [ ] **Step 6: Route `bus.eq.*` in `setBaseValue`**

In `src/engines/drums-engine.ts`, replace the `setBaseValue` method (around line 136-150) with:

```ts
  setBaseValue(id: string, v: number): void {
    if (!(id in this.paramValues)) return;
    this.paramValues[id] = v;
    if (id === 'bus.eq.low'  && this.busStrip) { this.busStrip.setEqLow (v); return; }
    if (id === 'bus.eq.mid'  && this.busStrip) { this.busStrip.setEqMid (v); return; }
    if (id === 'bus.eq.high' && this.busStrip) { this.busStrip.setEqHigh(v); return; }
    if (!this.lastInstance) return;
    const [scope, field] = id.split('.');
    if (field === 'level' && scope !== 'bus') {
      const ch = this.lastInstance.channels[scope as DrumVoice];
      if (ch && ch.level) ch.level.gain.value = v;
    }
  }
```

- [ ] **Step 7: Drop the now-empty MASTER section from buildParamUI**

In `src/engines/drums-engine.ts`, find the `buildParamUI` method. Replace the Master row block (the four lines that build `masterRow`, `masterLab`, `masterKnobs`, and the `wireEngineParams` call with `filter: (id) => id.startsWith('master.')`) with a single BUS row that emits the EQ knobs:

```ts
    // Bus EQ (automatable from the lane's LFO/ADSR).
    const busRow = document.createElement('div');
    busRow.className = 'row poly-section';
    const busLab = document.createElement('div');
    busLab.className = 'section-label';
    busLab.textContent = 'BUS EQ';
    busRow.appendChild(busLab);
    const busKnobs = document.createElement('div');
    busKnobs.className = 'knob-row';
    busRow.appendChild(busKnobs);
    container.appendChild(busRow);
    wireEngineParams(this, ctx, busKnobs, {
      filter: (id) => id.startsWith('bus.eq.'),
      formatter: (_id, v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`,
    });
```

Update the existing "Per-voice levels" section filter so it excludes both `bus.` and any leftover prefix — change the line that says `filter: (id) => !id.startsWith('master.'),` to:

```ts
      filter: (id) => !id.startsWith('bus.'),
```

- [ ] **Step 8: Run drums-engine tests**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: PASS, including the two new tests.

If the pre-existing tests check for `master.level` or `master.tune` in `DRUM_PARAMS`, update them to expect `bus.eq.low/mid/high` instead.

- [ ] **Step 9: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-engine.test.ts
git commit -m "feat(drums): expose bus EQ as automatable params; drop dead master.level/tune"
```

---

## Task 10: ensureLaneResource passes the strip to DrumsEngine

**Files:**
- Modify: `src/main.ts:397-410` (`ensureLaneResource`)

- [ ] **Step 1: Add the strip-setter call**

In `src/main.ts`, find the `ensureLaneResource` function (around line 397) and replace it with:

```ts
function ensureLaneResource(laneId: string, engineId: string): void {
  if (laneResources.get(laneId)) return;
  const strip = new ChannelStrip(ctx, master, fx);
  const engine = createEngineInstance(engineId);
  if (!engine) return;
  if (engineId === 'subtractive') {
    const p = new PolySynth(ctx, strip.input);
    p.bpm = seq.bpm;
    (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
  }
  if (engineId === 'drums-machine') {
    (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
  }
  laneResources.set(laneId, { strip, engine });
}
```

Also update the boot wiring at line 124-126 (where the built-in drum lane resource is created) so the existing `drumBusStrip` is passed:

```ts
  laneResources.set(LANE_ID_BASS,  { strip: bassStrip,    engine: tb303Engine });
  laneResources.set(LANE_ID_DRUMS, { strip: drumBusStrip, engine: drumsEngineInstance });
  drumsEngineInstance.setBusStrip(drumBusStrip);
  laneResources.set(LANE_ID_POLY,  { strip: polyStrip,    engine: mainSubtractive });
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `drumsEngineInstance.setBusStrip` is flagged because `drumsEngineInstance` has a wider type than `DrumsEngine`, cast: `(drumsEngineInstance as DrumsEngine).setBusStrip(drumBusStrip);` and import the `DrumsEngine` type.

- [ ] **Step 3: Add an e2e test asserting Drums LFO dropdown includes bus.eq.***

Append to `tests/e2e/lane-ui.spec.ts` inside the existing `modulator destination dropdown` describe block, OR as a new test:

```ts
test('Drums lane LFO dropdown includes bus EQ destinations', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.session-lane-tab[data-lane-id="drums-1"]').click();
  const options = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLSelectElement>('.mod-dest-select')]
      .filter((s) => s.offsetParent !== null)
      .flatMap((s) => [...s.options].map((o) => o.value)),
  );
  expect(options).toContain('drums-1.bus.eq.low');
  expect(options).toContain('drums-1.bus.eq.mid');
  expect(options).toContain('drums-1.bus.eq.high');
});
```

- [ ] **Step 4: Run full suite**

Run: `npm run build && npm test`
Expected: vitest passes, then playwright runs all e2e tests including the new Drums EQ one.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts tests/e2e/lane-ui.spec.ts
git commit -m "feat(main): wire DrumsEngine.setBusStrip in ensureLaneResource"
```

---

## Self-review notes

After completing the plan, run:

```bash
npm run build && npm test
```

and inspect manually at `http://localhost:5173`:
- Boot: Sub 1 dropdown shows "PAD Warm", Sub 2 shows "PAD Sweep", TB-303 (no dropdown — it's a different UI) is using its `engine:Acid Classic` preset values.
- Launch scene B (▶ button index 1): all four poly dropdowns update.
- Drums tab: open the LFO panel, the destination dropdown lists `drums-1.bus.eq.low/mid/high`. Add a connection, set depth — the corresponding LO/MID/HI knob on the drum-master strip should not visually move (the modulation writes to the AudioParam directly, not through the knob) but the audio EQ should swing audibly.
- MASTER section of the drum tab is gone; BUS EQ section is in its place.

If any of those fail, file the discrepancy as a follow-up before declaring done.
