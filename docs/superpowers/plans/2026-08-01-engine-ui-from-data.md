# Engine UI from data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every engine editor is built from the engine's declared data — params
*and* their groups — so no engine keeps a mounting path, a markup block, or an
`if (engineId === …)` branch of its own.

**Architecture:** An `EngineParamGroup[]` table on the engine descriptor (id,
title, shared row index, colour) drives `buildEngineParamGrid`, which already
paints every other engine's editor with lit-html. Subtractive's static rows in
`index.html`, its bespoke mount function and the three `subtractive` branches are
deleted. Before any of that, the knob registry gets the unmount contract it
never had, because today Subtractive is the accidental exception that keeps its
handles attached.

**Tech Stack:** TypeScript, lit-html (scaffolding only — knobs stay imperative
SVG), Vitest + jsdom for unit tests, Playwright for e2e, SCSS.

## Global Constraints

- **File size**: target 300 code lines, hard cap 500. Comments and blanks do not
  count.
- **Tests are colour-free**: run single files as
  `NO_COLOR=1 npx vitest run <path>`. Never add `--reporter=…`.
- **Relative assertions only** in any DSP-adjacent test. Not applicable to most
  of this plan (it is UI), but do not introduce absolute magnitudes.
- **Every UI write to an engine param goes through `commitParam`** — never
  `engine.setBaseValue` alone.
- **`engine.params` stays flat.** Automation, modulation, presets, saves, the
  destination registry and the dice all read it.
- **e2e serves `dist/` with no build step.** `npm run build` before
  `npm run test:e2e`, always.
- **English** for code, comments, commit messages and UI text.
- One test per user path. No `(or …)` alternatives in a test task.

---

## Decided by the owner, 2026-08-01 — implement these, do not re-open them

**1. FILTER is orange, all of it.** The teal knobs are an accident (see below);
the intent is restored. **This is the one deliberate visual change of Phase 2**,
and it is the only difference from the reference screenshots that is not one of
the three agreed convention shifts. Four knobs — Resonance, Env Amt, Drive, Key
Track — go from teal to orange.

**2. Dead params are deleted, not documented.** `poly.mode` and `poly.retrig`
leave `SUB_PARAM_SPECS`, and `poly.mode` leaves `westcoast.ts`. No engine
declares a param its own `setBaseValue` discards. Check for saved sessions
carrying the ids — they must load without error (the loader ignores unknown
param ids; verify, do not assume).

**3. Execution is subagent-per-task**, with review between tasks.

The reasoning behind 1 and 2, kept because both look like bugs when read cold:

**1. The FILTER section's teal knobs are an accident, and reproducing the page
faithfully means reproducing the accident.**

`src/styles/_knob.scss:138` says:

```scss
/* FILTER envelope subgroup (last four knobs F ATK / F DEC / F SUS / F REL)
 * teal — distinct from the main filter controls in orange. */
#poly-filter-knobs .knob:nth-last-child(-n+4) { … var(--knob-teal) … }
```

Those four envelope knobs are **no longer drawn** — `mountSubtractiveLaneKnobs`
skips every `attack/decay/sustain/release/builtinEnv` leaf, because the ADSRs in
the MODULATORS panel *are* those envelopes. So the rule now paints whatever the
last four children happen to be: **Resonance, Env Amt, Drive and Key Track are
teal today**, and only Cutoff is orange. Verified by reading the section's
member list against the selector.

- **(a)** Keep it exactly as seen: declare a second group for those four params.
- **(b)** Restore the intent: the whole FILTER group is orange, and this is
  recorded as the one deliberate visual change of Phase 2.

**2. `poly.mode` and `poly.retrig` are sound params with no control anywhere.**

Both are declared in `SUB_PARAM_SPECS` (`src/engines/subtractive-params.ts`),
neither is in the seven static sections nor in the hand-rolled POLY row (which
draws only `poly.voices`). The house rule is "no hidden sound params — expose
them or accept the silence".

- **(a)** Declare them into the POLY group; they become visible knobs.
- **(b)** Delete them from the spec if nothing reads them (check
  `audio-dsp/voice-manager.ts` and the DOT_TO_FIELD map first).
- **(c)** Leave them exactly as they are and record why.

Do not start Task 7 until both are answered.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/automation/automation-knob.test.ts` | tests for the shared landing path |
| `src/engines/engine-param-groups.ts` | `EngineParamGroup`, and the pure resolver that turns `(specs, groups)` into ordered rows |
| `src/engines/engine-param-groups.test.ts` | resolver tests (pure, no DOM) |
| `src/session/lane-editor-mount.test.ts` | mount-transaction tests |

**Modified**

| File | Change |
|---|---|
| `src/automation/automation-knob.ts` | gains `landAutomationValue` — drive the mounted knob, else fall back |
| `src/automation/automation-tick.ts` | uses it instead of its inline branch |
| `src/app/arrangement-playback.ts` | uses it — this is the bug fix |
| `src/app/automation-writes.ts` | exports the playback-unmounted writer and the ranges getter |
| `src/app/performance-feature.ts` | passes both through to arrangement playback |
| `src/main.ts` | wires the late-bound closure (the pattern already used for `applyLiveControlUnmountedWrite`) |
| `src/session/session-host-lane-editor.ts` | the mount transaction; loses the `display:none` sweep |
| `src/engines/engine-params.ts` | `drawnBy` on `EngineParamSpec` |
| `src/engines/engine-param-grid.ts` | renders declared groups, shared rows, dividers, colour |
| `src/engines/descriptor-engine.ts` | `groups` in the descriptor config, exposed on the engine |
| `src/engines/engine-types.ts` | `groups` on `SynthEngine` |
| `src/engines/worklet-lane-engine.ts` | loses the `!== 'subtractive'` branch and the hand-rolled POLY row |
| `src/engines/subtractive.ts` | declares its groups |
| `src/engines/subtractive-params.ts` | params carry group ids, `selectStyle: 'radio'`, `drawnBy` |
| `src/engines/fm.ts`, `tb303.ts`, `wavetable.ts`, `westcoast.ts` | declare groups |
| `plugins/karplus/*` + `packages/loom-plugin-sdk/src/manifest.ts` | `groups` in the plugin ABI |
| `src/app/knob-mounting.ts` | `mountSubtractiveLaneKnobs` deleted |
| `src/app/engine-selector-wiring.ts`, `src/engines/engine-selector-ui.ts` | remount hook + subtractive branch deleted |
| `index.html` | the three `data-engine="subtractive"` rows deleted |
| `src/styles/_knob.scss` | per-id accents replaced by the group-colour path |

---

## Task 1: One landing path for automation values

The two players that land an automation value on a param disagree today.
`automation-tick` falls back to the audio object when no knob is mounted;
`arrangement-playback` silently drops the value. That is a live bug (a take curve
for a lane whose editor was never opened does nothing) and it is also the
precondition for everything else: once Subtractive stops being the engine that
keeps its handles attached, the fallback has to be real.

**Files:**
- Modify: `src/automation/automation-knob.ts`
- Modify: `src/automation/automation-tick.ts:70-86`
- Modify: `src/app/arrangement-playback.ts:82-88`
- Modify: `src/app/automation-writes.ts:118-144`
- Modify: `src/app/performance-feature.ts:125-131`
- Modify: `src/main.ts` (performance-feature deps)
- Test: `src/automation/automation-knob.test.ts` (new)

**Interfaces:**
- Produces: `landAutomationValue(deps: LandingDeps, paramId: string, normalised: number): void`
  where `LandingDeps = { registry: ReadonlyMap<string, KnobHandle>; applyUnmounted?: (paramId: string, normalised: number, ranges: ReadonlyMap<string, {min:number;max:number}>) => void; getTargetRanges?: () => ReadonlyMap<string, {min:number;max:number}> }`
- Produces: `AutomationWrites.applyPlaybackUnmountedWrite` and
  `AutomationWrites.targetRanges` (same signatures as the internal ones today).

- [ ] **Step 1: Write the failing tests**

Create `src/automation/automation-knob.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { landAutomationValue } from './automation-knob';
import type { KnobHandle } from '../core/knob';

function stubHandle(min: number, max: number): KnobHandle & { last: number | null } {
  const h = {
    el: document.createElement('div'),
    last: null as number | null,
    meta: { id: 'L.filter.cutoff', label: 'Cutoff', min, max },
    setValue(v: number) { h.last = v; },
  };
  return h as unknown as KnobHandle & { last: number | null };
}

describe('landAutomationValue', () => {
  it('drives the mounted knob, denormalised against its own range', () => {
    const handle = stubHandle(0, 200);
    const registry = new Map([['L.filter.cutoff', handle as unknown as KnobHandle]]);
    const applyUnmounted = vi.fn();

    landAutomationValue({ registry, applyUnmounted, getTargetRanges: () => new Map() },
      'L.filter.cutoff', 0.25);

    expect((handle as unknown as { last: number }).last).toBe(50);
    expect(applyUnmounted).not.toHaveBeenCalled();
  });

  it('falls back to the audio object when no knob is mounted', () => {
    const applyUnmounted = vi.fn();
    const ranges = new Map([['L.filter.cutoff', { min: 0, max: 1 }]]);

    landAutomationValue({ registry: new Map(), applyUnmounted, getTargetRanges: () => ranges },
      'L.filter.cutoff', 0.25);

    expect(applyUnmounted).toHaveBeenCalledWith('L.filter.cutoff', 0.25, ranges);
  });

  it('asks for the range table at most once across many unmounted writes', () => {
    const getTargetRanges = vi.fn(() => new Map());
    const land = { registry: new Map(), applyUnmounted: vi.fn(), getTargetRanges };

    landAutomationValue(land, 'a.x', 0.1);
    landAutomationValue(land, 'b.y', 0.2);

    expect(getTargetRanges).toHaveBeenCalledTimes(2); // per call; the CALLER memoises per frame
  });

  it('is a no-op, never a throw, when there is no fallback wired', () => {
    expect(() => landAutomationValue({ registry: new Map() }, 'a.x', 0.5)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-knob.test.ts`
Expected: FAIL — `landAutomationValue` is not exported.

- [ ] **Step 3: Implement `landAutomationValue`**

Append to `src/automation/automation-knob.ts` (keep `driveKnobFromAutomation`
exported — `performance-feature.ts:413` and the XY pad still call it directly):

```ts
export interface LandingDeps {
  registry: ReadonlyMap<string, KnobHandle>;
  /** Where a value goes when no knob is mounted. Absent in test fixtures that
   *  do not build an audio graph, in which case the write is dropped — the
   *  behaviour every caller had before this existed. */
  applyUnmounted?: (
    paramId: string,
    normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
  getTargetRanges?: () => ReadonlyMap<string, { min: number; max: number }>;
}

/** Land an automation value on its target: the mounted knob when there is one
 *  (so the UI follows), the audio object itself when there is not. Automation
 *  is a property of the session, not of what happens to be on screen — the two
 *  players used to disagree about that, and the take player simply dropped the
 *  value. Callers that land many values in one frame should memoise
 *  `getTargetRanges` themselves; this function calls it at most once per value
 *  and only when it is needed. */
export function landAutomationValue(
  deps: LandingDeps, paramId: string, normalised: number,
): void {
  if (driveKnobFromAutomation(deps.registry, paramId, normalised)) return;
  if (!deps.applyUnmounted || !deps.getTargetRanges) return;
  deps.applyUnmounted(paramId, normalised, deps.getTargetRanges());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-knob.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Route `automation-tick` through it, preserving its per-frame memo**

In `src/automation/automation-tick.ts`, replace the body of the
`tickSessionEnvelopes` callback:

```ts
    let ranges: ReadonlyMap<string, { min: number; max: number }> | undefined;
    const landing = {
      registry: automationRegistry,
      applyUnmounted: deps.applyUnmounted,
      // Memoised for the frame: built lazily so a frame with no unmounted
      // envelope costs nothing, then reused by every later value in it.
      getTargetRanges: () => (ranges ??= deps.getTargetRanges?.() ?? new Map()),
    };
    tickSessionEnvelopes(getLaneStates(), ctx.currentTime, seq.bpm, seq.meter,
      (paramId, normalised) => landAutomationValue(landing, paramId, normalised));
```

Import `landAutomationValue` alongside `driveKnobFromAutomation`.

- [ ] **Step 6: Expose the playback writer and the ranges getter**

In `src/app/automation-writes.ts`, name the ranges closure and widen the
returned interface:

```ts
export interface AutomationWrites {
  applyLiveControlUnmountedWrite(
    paramId: string, normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ): void;
  /** Playback semantics: the value reaches the audio object and NOTHING else —
   *  no engineState mirror, because a curve belongs to the clip or the take.
   *  Handed to the arrangement player, which had no unmounted path at all. */
  applyPlaybackUnmountedWrite(
    paramId: string, normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ): void;
  /** The declared min/max of every destination the session offers. */
  targetRanges(): ReadonlyMap<string, { min: number; max: number }>;
}
```

```ts
  const targetRanges = () =>
    new Map(destinations.list().map((t) => [t.id, { min: t.min, max: t.max }]));

  const automationTickDeps: AutomationTickDeps = {
    …
    applyUnmounted: applyUnmountedWrite,
    getTargetRanges: targetRanges,
  };

  startAutomationTick(automationTickDeps);

  return {
    applyLiveControlUnmountedWrite,
    applyPlaybackUnmountedWrite: applyUnmountedWrite,
    targetRanges,
  };
```

- [ ] **Step 7: Give the arrangement player the fallback**

`src/app/arrangement-playback.ts` — add to `ArrangementPlaybackDeps`:

```ts
  /** Late-bound: automation-writes is built AFTER the performance feature, so
   *  main hands this in as a closure, never as a bare reference. Absent in test
   *  fixtures with no audio graph. */
  applyUnmounted?: (
    paramId: string, normalised: number,
    ranges: ReadonlyMap<string, { min: number; max: number }>,
  ) => void;
  getTargetRanges?: () => ReadonlyMap<string, { min: number; max: number }>;
```

and replace `applyAutomation`:

```ts
  function applyAutomation(paramId: string, valueNorm: number) {
    // A take curve is a property of the take, not of what is on screen: when
    // the lane's editor is closed there is no knob, and the value must still
    // reach the audio object. It used to be dropped here.
    landAutomationValue(
      { registry: automationRegistry, applyUnmounted: deps.applyUnmounted, getTargetRanges: deps.getTargetRanges },
      paramId, valueNorm,
    );
  }
```

- [ ] **Step 8: Pass it through performance-feature and main**

`src/app/performance-feature.ts`: add the same two optional deps to
`PerformanceFeatureDeps`, and forward them in the `createArrangementPlayback({…})`
call at line ~125.

`src/main.ts`: the performance feature is built before `createAutomationWrites`,
so use the existing late-bound pattern — a `let writes: AutomationWrites | undefined`
assigned at the `createAutomationWrites(...)` call site, and closures in the deps:

```ts
  applyUnmounted: (id, n, r) => writes?.applyPlaybackUnmountedWrite(id, n, r),
  getTargetRanges: () => writes?.targetRanges() ?? new Map(),
```

- [ ] **Step 9: Typecheck and run the full unit suite**

Run: `npx tsc --noEmit`
Run: `npm run test:unit`
Expected: PASS. (A single `ERR_IPC_CHANNEL_CLOSED` after all tests pass is the
known flaky teardown — re-run to confirm.)

- [ ] **Step 10: Commit**

```bash
git add src/automation/automation-knob.ts src/automation/automation-knob.test.ts \
        src/automation/automation-tick.ts src/app/arrangement-playback.ts \
        src/app/automation-writes.ts src/app/performance-feature.ts src/main.ts
git commit -m "fix(automation): a take curve no longer needs its editor open to land"
```

---

## Task 2: The mount transaction

`injectEngineModulatorPanel` wipes its host and rebuilds, but nothing removes the
previous lane's handles from the registry — they stay, pointing at detached DOM.
They still reach audio (the `onChange` closure holds the live engine), which is
why nobody noticed. Once Task 1 made the unmounted path real, the zombies can go.

**The trap:** do NOT unregister by lane prefix. `<laneId>.bus.*` is the mixer
column, mounted elsewhere and still visible. Ownership is by *what this call
registered*.

**Files:**
- Modify: `src/session/session-host-lane-editor.ts:93-186`
- Test: `src/session/lane-editor-mount.test.ts` (new)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no new export. The transaction is private to
  `injectEngineModulatorPanel`; its observable contract is the registry state.

- [ ] **Step 1: Write the failing test**

Create `src/session/lane-editor-mount.test.ts`. Build the smallest host that
exercises the real function — a `SessionHost`-shaped stub is enough because
`injectEngineModulatorPanel` only reads `state.lanes`, `deps.laneResources`,
`deps.automationRegistry`, `registerKnobHandle` and `inspector.mountLaneInserts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { injectEngineModulatorPanel } from './session-host-lane-editor';
import type { SessionHost } from './session-host';
import type { KnobHandle } from '../core/knob';

const knob = (id: string): KnobHandle =>
  ({ el: document.createElement('div'), setValue() {}, meta: { id, label: id, min: 0, max: 1 } }) as unknown as KnobHandle;

function hostWith(registry: Map<string, KnobHandle>, engineParamIds: (laneId: string) => string[]) {
  document.body.innerHTML = '<div class="page" data-page="poly"><div id="poly-fx-row"></div></div>';
  const lanes = [
    { id: 'fm-1', engineId: 'fm', name: 'FM', clips: [], inserts: [] },
    { id: 'sub-1', engineId: 'subtractive', name: 'Sub', clips: [], inserts: [] },
  ];
  const engineFor = (laneId: string) => ({
    id: lanes.find((l) => l.id === laneId)!.engineId,
    params: [],
    buildParamUI(container: HTMLElement, ctx: { registerKnob(k: KnobHandle): void }) {
      for (const id of engineParamIds(laneId)) {
        const k = knob(`${laneId}.${id}`);
        container.appendChild(k.el);
        ctx.registerKnob(k);
      }
    },
  });
  return {
    state: { lanes },
    deps: {
      automationRegistry: registry,
      laneResources: { get: (id: string) => ({ engine: engineFor(id) }) },
      registerKnob: (k: KnobHandle) => { if (k.meta.id) registry.set(k.meta.id, k); },
    },
    registerKnobHandle(k: KnobHandle) { this.deps.registerKnob(k); },
    inspector: { mountLaneInserts() {} },
  } as unknown as SessionHost;
}

describe('lane editor mount transaction', () => {
  let registry: Map<string, KnobHandle>;
  beforeEach(() => { registry = new Map(); });

  it('drops the previous lane engine knobs when the editor re-points', () => {
    const host = hostWith(registry, (laneId) => (laneId === 'fm-1' ? ['op1.ratio'] : ['filter.cutoff']));

    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    expect(registry.has('fm-1.op1.ratio')).toBe(true);

    injectEngineModulatorPanel(host, 'sub-1', 'poly');
    expect(registry.has('fm-1.op1.ratio')).toBe(false);
    expect(registry.has('sub-1.filter.cutoff')).toBe(true);
  });

  it('never drops a knob mounted outside the host — the mixer strip survives', () => {
    const host = hostWith(registry, () => ['op1.ratio']);
    registry.set('fm-1.bus.level', knob('fm-1.bus.level'));   // the mixer column owns this

    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    injectEngineModulatorPanel(host, 'sub-1', 'poly');

    expect(registry.has('fm-1.bus.level')).toBe(true);
  });

  it('re-opening the same lane leaves exactly one live handle per id', () => {
    const host = hostWith(registry, () => ['op1.ratio']);

    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    const first = registry.get('fm-1.op1.ratio');
    injectEngineModulatorPanel(host, 'fm-1', 'poly');
    const second = registry.get('fm-1.op1.ratio');

    expect(second).toBeDefined();
    expect(second).not.toBe(first);              // the rebuilt widget, not the stale one
    expect(second!.el.isConnected).toBe(true);   // and it is the one in the DOM
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/lane-editor-mount.test.ts`
Expected: FAIL on the first test — `fm-1.op1.ratio` is still registered.

- [ ] **Step 3: Implement the transaction**

In `src/session/session-host-lane-editor.ts`, above `injectEngineModulatorPanel`:

```ts
/** Ids the lane editor's host registered on its last build, per host element.
 *  Weak-keyed so a discarded page takes its bookkeeping with it.
 *
 *  Ownership, not prefix: `unregisterKnobsByPrefix('<laneId>.')` would also
 *  delete `<laneId>.bus.*`, which is the mixer column — mounted elsewhere,
 *  still on screen, and automatable. Deleting a live knob handle silently
 *  breaks the control it belongs to; that too-wide hammer is what produced the
 *  frozen-modulation-rings bug. */
const idsOwnedByHost = new WeakMap<HTMLElement, Set<string>>();
```

and inside the function, immediately before `host.innerHTML = '';`:

```ts
  // Everything this host registered last time is about to be detached with the
  // wipe below, so its registry entries go with it. Automation for a lane whose
  // editor is closed reaches the audio object through the unmounted path.
  const previouslyOwned = idsOwnedByHost.get(host);
  if (previouslyOwned) {
    for (const id of previouslyOwned) self.deps.automationRegistry.delete(id);
  }
  const owned = new Set<string>();
  idsOwnedByHost.set(host, owned);
  const registerOwned = (k: import('../core/knob').KnobHandle) => {
    if (k.meta?.id) owned.add(k.meta.id);
    self.registerKnobHandle(k);
  };
  host.innerHTML = '';
```

Then route **all three** mount sites through `registerOwned` — the engine grid
(`engine.buildParamUI`'s `registerKnob`), the note-FX panel, and
`self.inspector.mountLaneInserts`. The inserts panel registers through
`SessionInspector.deps.registerKnob`, which is bound to
`registerKnobHandle` in `session-host.ts:473`; give `mountLaneInserts` an
optional `registerKnob` override parameter and pass `registerOwned`:

```ts
  self.inspector.mountLaneInserts(laneId, host, registerOwned);
```

`SessionInspector.mountLaneInserts(laneId, host, registerKnob = this.deps.registerKnob)`
— default keeps every other caller unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/session/lane-editor-mount.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Prove the three by-id write surfaces still reach a closed lane**

Extend the same file with one test per surface — three user paths, three tests,
no `(or …)`:

```ts
  it('an XY-pad write reaches a lane whose editor is closed', () => { /* applyLiveControlWrite path */ });
  it('a MIDI-surface write reaches a lane whose editor is closed', () => { /* loom-facade commitParamForLane path */ });
  it('a take curve reaches a lane whose editor is closed', () => { /* landAutomationValue path, Task 1 */ });
```

Each builds the registry WITHOUT the lane's engine knobs (the state Task 2
now produces) and asserts the engine's base value changed. The XY one must also
assert the `engineState` mirror was written; the take one must assert it was
**not** (playback semantics).

- [ ] **Step 6: Run the whole unit suite + typecheck**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/session/session-host-lane-editor.ts src/session/session-inspector.ts \
        src/session/lane-editor-mount.test.ts
git commit -m "fix(ui): the lane editor unregisters what it mounted, by ownership not by prefix"
```

---

## Task 3: The group model — types and pure resolver

No rendering yet. A pure module, fully testable without a DOM, that answers:
given the params and the declared groups, what rows are drawn, in what order,
holding which controls, in what colour.

**Files:**
- Create: `src/engines/engine-param-groups.ts`
- Create: `src/engines/engine-param-groups.test.ts`
- Modify: `src/engines/engine-params.ts`

**Interfaces:**
- Produces: `EngineParamGroup { id: string; title: string; row?: number; color?: string }`
- Produces: `resolveParamRows(specs: EngineParamSpec[], groups?: EngineParamGroup[]): ParamRow[]`
  where `ParamRow = { sections: ParamSection[] }` and
  `ParamSection = { title?: string; color?: string; specs: EngineParamSpec[] }`.
  A section with no `title` is the leading ungrouped row.
- Produces: `EngineParamSpec.drawnBy?: 'mixer' | 'modulators'`

- [ ] **Step 1: Write the failing tests**

Create `src/engines/engine-param-groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveParamRows, type EngineParamGroup } from './engine-param-groups';
import type { EngineParamSpec } from './engine-params';

const p = (id: string, group?: string, extra: Partial<EngineParamSpec> = {}): EngineParamSpec =>
  ({ id, label: id, kind: 'continuous', min: 0, max: 1, default: 0, group, ...extra });

describe('resolveParamRows', () => {
  it('orders sections by the declared array, not by param order', () => {
    const groups: EngineParamGroup[] = [{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }];
    const rows = resolveParamRows([p('x', 'a'), p('y', 'b')], groups);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([['B'], ['A']]);
  });

  it('puts groups that share a row index into one row', () => {
    const groups: EngineParamGroup[] = [
      { id: 'osc1', title: 'OSC 1', row: 0 },
      { id: 'osc2', title: 'OSC 2', row: 0 },
      { id: 'filter', title: 'FILTER', row: 1 },
    ];
    const rows = resolveParamRows([p('a', 'osc1'), p('b', 'osc2'), p('c', 'filter')], groups);
    expect(rows).toHaveLength(2);
    expect(rows[0].sections.map((s) => s.title)).toEqual(['OSC 1', 'OSC 2']);
    expect(rows[1].sections.map((s) => s.title)).toEqual(['FILTER']);
  });

  it('carries the group colour onto its section', () => {
    const rows = resolveParamRows([p('a', 'osc1')], [{ id: 'osc1', title: 'OSC 1', color: '#2ee0c0' }]);
    expect(rows[0].sections[0].color).toBe('#2ee0c0');
  });

  it('falls back to today behaviour when a group is not declared', () => {
    const rows = resolveParamRows([p('a'), p('b', 'OP1'), p('c', 'OP2')]);
    expect(rows[0].sections[0].title).toBeUndefined();     // leading ungrouped row
    expect(rows[1].sections[0].title).toBe('OP1');          // the string IS the title
    expect(rows[2].sections[0].title).toBe('OP2');
  });

  it('omits a param drawn by another surface, and the section it empties', () => {
    const groups: EngineParamGroup[] = [{ id: 'amp', title: 'AMP' }, { id: 'osc1', title: 'OSC 1' }];
    const rows = resolveParamRows(
      [p('amp.attack', 'amp', { drawnBy: 'modulators' }), p('osc1.level', 'osc1')], groups);
    expect(rows.flatMap((r) => r.sections.map((s) => s.title))).toEqual(['OSC 1']);
  });

  it('declared-but-absent groups produce no empty row', () => {
    const rows = resolveParamRows([p('a', 'osc1')], [{ id: 'osc1', title: 'OSC 1' }, { id: 'ghost', title: 'GHOST' }]);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-groups.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `drawnBy` to the spec**

In `src/engines/engine-params.ts`, inside `EngineParamSpec`:

```ts
  /** This param is declared for automation / modulation / presets / saves, but
   *  the editor grid does not draw it — the named surface does. It NEVER means
   *  "drawn nowhere": a sound param with no control at all is a bug, not a
   *  feature. 'modulators' = the ADSR/LFO panel owns it (the subtractive amp and
   *  filter envelope leaves); 'mixer' = the lane's mixer column owns it. */
  drawnBy?: 'mixer' | 'modulators';
```

- [ ] **Step 4: Implement the resolver**

Create `src/engines/engine-param-groups.ts`:

```ts
// src/engines/engine-param-groups.ts
// How an engine's params become rows of labelled sections. Pure: no DOM, no lit.
//
// This is the model that replaces hand-written markup. Before it, the ONLY way
// to say "OSC 1 │ OSC 2 │ SUB │ NOISE share one line, in that order, each in its
// own colour" was to write that line in index.html — which is why exactly one
// engine had a page of its own and three `if (engineId === 'subtractive')`
// branches existed to keep it out of everyone else's way.

import type { EngineParamSpec } from './engine-params';

export interface EngineParamGroup {
  /** Key referenced by EngineParamSpec.group. */
  id: string;
  /** Printed as the section header. Free of the id so a group can be renamed
   *  without touching every param that belongs to it. */
  title: string;
  /** Groups sharing a row index render side by side on one line, separated by a
   *  vertical divider. Default: a row of its own, in declaration order. */
  row?: number;
  /** CSS colour for this section's knob rings. A param's own `color` wins. */
  color?: string;
}

export interface ParamSection {
  /** The declared group's id, and the ONLY key row packing may use. Absent for
   *  the leading ungrouped row and for a group nobody declared. */
  id?: string;
  /** Absent for the leading row of ungrouped params, which has no header. */
  title?: string;
  color?: string;
  specs: EngineParamSpec[];
}

export interface ParamRow { sections: ParamSection[]; }

export function resolveParamRows(
  specs: EngineParamSpec[], groups?: EngineParamGroup[],
): ParamRow[] {
  const drawn = specs.filter((s) => !s.drawnBy);
  const byKey = new Map<string, EngineParamSpec[]>();
  const seen: string[] = [];
  for (const s of drawn) {
    const key = s.group ?? '';
    if (!byKey.has(key)) { byKey.set(key, []); seen.push(key); }
    byKey.get(key)!.push(s);
  }

  const declared = groups ?? [];
  const declaredIds = new Set(declared.map((g) => g.id));
  // Ungrouped first (the leading row), then declared groups in array order,
  // then any group nobody declared, in first-appearance order — which is
  // exactly what the grid did before groups were declarable at all.
  const ordered: ParamSection[] = [];
  if (byKey.has('')) ordered.push({ specs: byKey.get('')! });
  for (const g of declared) {
    const members = byKey.get(g.id);
    if (members?.length) ordered.push({ id: g.id, title: g.title, color: g.color, specs: members });
  }
  for (const key of seen) {
    if (key === '' || declaredIds.has(key)) continue;
    ordered.push({ title: key, specs: byKey.get(key)! });
  }

  // Row packing. A section whose group declares `row` joins that row; every
  // other section keeps a row to itself, so an engine that declares nothing
  // renders exactly as it does today.
  //
  // Keyed by group ID, never by title. Two declared groups may legitimately
  // share a title, and an UNDECLARED group's raw string may collide with a
  // declared group's title — keying by title silently packs unrelated sections
  // into one row. `id` is the stable key the type's own doc comment promises;
  // `ParamSection` therefore carries it, and an undeclared section has none.
  const rowOf = new Map<string, number>();
  for (const g of declared) if (g.row !== undefined) rowOf.set(g.id, g.row);
  const rows: ParamRow[] = [];
  const byRowIndex = new Map<number, ParamRow>();
  for (const section of ordered) {
    const idx = section.id !== undefined ? rowOf.get(section.id) : undefined;
    if (idx === undefined) { rows.push({ sections: [section] }); continue; }
    let row = byRowIndex.get(idx);
    if (!row) { row = { sections: [] }; byRowIndex.set(idx, row); rows.push(row); }
    row.sections.push(section);
  }
  return rows;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-groups.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/engines/engine-param-groups.ts src/engines/engine-param-groups.test.ts src/engines/engine-params.ts
git commit -m "feat(engines): a param group is data — title, order, row, colour"
```

---

## Task 4: The grid renders resolved rows

`buildEngineParamGrid`'s grouped branch stops bucketing by `spec.group` itself
and renders what Task 3 resolved. Nothing declares groups yet, so **every
existing test and every page must be byte-identical after this task** — that is
the point of the fallback path.

**Files:**
- Modify: `src/engines/engine-param-grid.ts:114-170`
- Test: `src/engines/engine-param-grid.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveParamRows`, `ParamRow`, `EngineParamGroup` from Task 3.
- Produces: `BuildGridOpts.groups?: EngineParamGroup[]`; `GridEngine.groups?: EngineParamGroup[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engines/engine-param-grid.test.ts`:

```ts
  it('renders two declared groups on one row, divider between them', () => {
    const parent = document.createElement('div');
    const engine = stubEngine([cont('osc1.level', 'osc1'), cont('osc2.level', 'osc2')]);
    buildEngineParamGrid(engine, ctx(), parent, {
      groups: [{ id: 'osc1', title: 'OSC 1', row: 0 }, { id: 'osc2', title: 'OSC 2', row: 0 }],
    });

    const rows = parent.querySelectorAll('.poly-section');
    expect(rows.length).toBe(1);
    expect([...rows[0].querySelectorAll('.section-label')].map((e) => e.textContent))
      .toEqual(['OSC 1', 'OSC 2']);
    expect(rows[0].querySelectorAll('.vert-divider').length).toBe(1);
  });

  it('paints the group colour on its knobs, and a param colour still wins', () => {
    const parent = document.createElement('div');
    const engine = stubEngine([
      cont('osc1.level', 'osc1'),
      { ...cont('osc1.detune', 'osc1'), color: '#ff0000' },
    ]);
    buildEngineParamGrid(engine, ctx(), parent, { groups: [{ id: 'osc1', title: 'OSC 1', color: '#2ee0c0' }] });

    const strokes = [...parent.querySelectorAll('.knob-value')].map((e) => (e as SVGElement).style.stroke);
    expect(strokes[0]).toBe('#2ee0c0');
    expect(strokes[1]).toBe('#ff0000');
  });

  it('does not draw a param owned by another surface', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(
      stubEngine([cont('osc1.level', 'osc1'), { ...cont('amp.attack', 'amp'), drawnBy: 'modulators' }]),
      ctx(), parent, { groups: [{ id: 'osc1', title: 'OSC 1' }, { id: 'amp', title: 'AMP' }] });

    expect([...parent.querySelectorAll('.section-label')].map((e) => e.textContent)).toEqual(['OSC 1']);
  });
```

- [ ] **Step 2: Run to verify the new tests fail and the OLD ones still pass**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-grid.test.ts`
Expected: the three new tests FAIL; every pre-existing test in the file PASSES.

- [ ] **Step 3: Implement**

In `src/engines/engine-param-grid.ts`, add to `GridEngine` and `BuildGridOpts`:

```ts
interface GridEngine {
  …
  /** Declared layout for this engine's params. Absent → first-appearance order,
   *  one row per group, no colour: what every engine did before groups existed. */
  groups?: EngineParamGroup[];
}

export interface BuildGridOpts {
  …
  /** Overrides the engine's own table. Used by callers that build a grid for a
   *  subset of an engine's params (the drum voice rack). */
  groups?: EngineParamGroup[];
}
```

Pass the section colour into `buildControl`:

```ts
function buildControl(
  engine: GridEngine, ctx: EngineUIContext, spec: EngineParamSpec,
  opts: BuildGridOpts, sectionColor?: string,
): HTMLElement {
  …
    color: spec.color ?? sectionColor,
  …
}
```

and replace the grouped branch's bucketing with:

```ts
  const rows = resolveParamRows(specs, opts.groups ?? engine.groups);
  const frag = document.createDocumentFragment();
  render(html`
    ${rows.map((row) => {
      // A row holding a single unlabelled section is the leading globals row,
      // which has no header and no divider — unchanged from before.
      const bare = row.sections.length === 1 && row.sections[0].title === undefined;
      return bare
        ? html`<div class="row knob-row">
            ${row.sections[0].specs.map((s) => buildControl(engine, ctx, s, opts))}
          </div>`
        : html`<div class="row poly-section">
            ${row.sections.map((section, i) => html`
              ${i > 0 ? html`<div class="vert-divider"></div>` : nothing}
              <div class="section-label">${section.title}</div>
              <div class="knob-row">
                ${section.specs.map((s) => buildControl(engine, ctx, s, opts, section.color))}
              </div>`)}
          </div>`;
    })}
  `, frag);
  container.appendChild(frag);
```

Note `createKnob` must apply `color` as an inline `stroke` on `.knob-value` and
`.knob-pointer` — check `src/core/knob.ts` before writing the colour test; if it
only strokes `.knob-value`, extend it there, since the SCSS accent mixin styles
both and the group colour must be able to replace it exactly.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-grid.test.ts`
Expected: PASS, including every pre-existing test unchanged.

- [ ] **Step 5: Prove nothing else moved**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engines/engine-param-grid.ts src/engines/engine-param-grid.test.ts
git commit -m "feat(ui): the param grid draws declared groups, shared rows and section colour"
```

---

## Task 5: `groups` on the descriptor and on `SynthEngine`

**Files:**
- Modify: `src/engines/engine-types.ts`
- Modify: `src/engines/descriptor-engine.ts:28-42,75-90`
- Modify: `src/engines/worklet-lane-engine.ts` (carry the descriptor's table onto the live engine)
- Modify: `src/engines/registry.ts` — `EngineDescriptor` must carry `groups` too
- Modify: `src/app/lane-allocator.ts:120-132` — the allocator constructs the live
  `WorkletLaneEngine`, so it must pass `groups: spec.groups` alongside the params
- Test: `src/engines/descriptor-engine.test.ts` (extend)
- Test: `src/engines/worklet-lane-engine.test.ts` (extend)

**The table has to survive FOUR hops, not two.** Descriptor config → registry
`EngineDescriptor` → allocator → live `WorkletLaneEngine`. The editor calls
`buildParamUI` on the LIVE engine, so a table that stops at any earlier hop is
silently empty in production while every unit test still passes. The failure
would surface for the first time in Task 8's Chrome check and would look like a
Task 8 defect. Assert the table on the engine the ALLOCATOR built, not only on
the descriptor.

**Interfaces:**
- Consumes: `EngineParamGroup` (Task 3).
- Produces: `SynthEngine.groups?: EngineParamGroup[]`, `DescriptorEngineConfig.groups?: EngineParamGroup[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/engines/descriptor-engine.test.ts`:

```ts
  it('carries the declared groups through to the engine', () => {
    const e = createDescriptorEngine({
      id: 'x', name: 'X', polyphony: 'poly',
      params: [{ id: 'osc1.level', label: 'L', kind: 'continuous', min: 0, max: 1, default: 0.5, group: 'osc1' }],
      groups: [{ id: 'osc1', title: 'OSC 1', row: 0, color: '#2ee0c0' }],
      presets: () => [],
    });
    expect(e.groups).toEqual([{ id: 'osc1', title: 'OSC 1', row: 0, color: '#2ee0c0' }]);
  });

  it('has no groups when none are declared', () => {
    const e = createDescriptorEngine({ id: 'y', name: 'Y', polyphony: 'poly', params: [], presets: () => [] });
    expect(e.groups).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/descriptor-engine.test.ts`
Expected: FAIL — `groups` is not a property.

- [ ] **Step 3: Implement**

`engine-types.ts`, on `SynthEngine`:

```ts
  /** Declared editor layout for `params`. Read by buildEngineParamGrid; absent
   *  means the pre-groups behaviour (one row per group, first-appearance order). */
  groups?: EngineParamGroup[];
```

`descriptor-engine.ts`: add `groups?: EngineParamGroup[]` to
`DescriptorEngineConfig` and `groups: cfg.groups,` to the returned object.

`worklet-lane-engine.ts`: the live engine builds its own param list from the
descriptor, so it must copy the table too — find where `cfg.params` is stored and
add the same for `cfg.groups`, exposing `groups` on the instance.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/engines/descriptor-engine.test.ts src/engines/worklet-lane-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/engine-types.ts src/engines/descriptor-engine.ts \
        src/engines/worklet-lane-engine.ts src/engines/descriptor-engine.test.ts
git commit -m "feat(engines): an engine declares its editor layout, not just its params"
```

---

## Task 6: The POLY row becomes a declared group

The hand-rolled POLY header in `WorkletLaneEngine.buildParamUI` is scaffolding
for a single knob, with its own `createKnob` call, its own lit fragment and a
`skip: id.startsWith('poly.')` to keep the grid off it. With groups it is data.

This task also deletes `poly.mode` and `poly.retrig` (decision 2): both are
dead on both sides — `WorkletLaneEngine.setBaseValue` returns early on them
(`worklet-lane-engine.ts:327`, "accept-and-ignore") and neither has a control.
`westcoast.ts` loses its `poly.mode` spec too, which removes a *visible* Mode
control whose value the engine discards. Update the header comment at
`worklet-lane-engine.ts:11-12`, which still describes them as pending work.

**Files:**
- Modify: `src/engines/worklet-lane-engine.ts:379-414`
- Modify: `src/engines/subtractive-params.ts` (the three `poly.*` specs)
- Test: `src/engines/worklet-lane-engine.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
  it('renders VOICES from the declared POLY group, not from hand-rolled markup', () => {
    const container = document.createElement('div');
    const engine = makeWorkletEngine('subtractive');       // existing helper in this file
    engine.buildParamUI(container, testCtx('sub-1'));

    const poly = [...container.querySelectorAll('.poly-section')]
      .find((s) => s.querySelector('.section-label')?.textContent === 'POLY');
    expect(poly).toBeDefined();
    expect(poly!.querySelector('.knob-label')?.textContent).toBe('VOICES');
  });

  it('a mono engine renders no POLY section', () => {
    const container = document.createElement('div');
    makeWorkletEngine('tb303').buildParamUI(container, testCtx('tb-1'));
    expect([...container.querySelectorAll('.section-label')].map((e) => e.textContent))
      .not.toContain('POLY');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts`
Expected: FAIL — the POLY section exists but is not produced by the grid (assert
on the structure the grid emits, e.g. `.poly-section > .knob-row > .knob`).

- [ ] **Step 3: Implement**

- In `subtractive-params.ts`, give `poly.voices` `group: 'poly'`, `step`-like
  integer behaviour via `min: 1, max: 16` (already so) and the label `VOICES`.
- Apply the ⛔ CONFIRMAR #2 decision to `poly.mode` / `poly.retrig`.
- In `worklet-lane-engine.ts`, delete the whole `if (this.polyphony === 'poly')`
  block and its `skip` option, and declare the group on the descriptor of every
  poly engine that should show it. A mono engine simply does not declare it.

Guard the regression the old code prevented: `poly.voices` never enters the
ParamBag, so its write must still go through `commitParam` — which the grid does
for every control, so this is satisfied by construction. Confirm with the
existing `engine-param-commit.test.ts`.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts src/engines/engine-param-commit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/worklet-lane-engine.ts src/engines/subtractive-params.ts src/engines/worklet-lane-engine.test.ts
git commit -m "refactor(engines): the POLY row is a declared group, not hand-rolled markup"
```

---

## Task 7: Subtractive declares its layout

The page is reproduced from data. **Capture the reference screenshots first** —
they are the approved mockup for this task, and per the repo's own rule they must
be committed artifacts, not something remembered.

**Files:**
- Modify: `src/engines/subtractive-params.ts`
- Modify: `src/engines/subtractive.ts`
- Create: `docs/superpowers/specs/2026-08-01-poly-page-before/*.png`

**Interfaces:**
- Consumes: `EngineParamGroup` (Task 3), descriptor `groups` (Task 5).

- [ ] **Step 1: Capture and commit the reference**

On `main` (not this branch), with `npm run dev` running, screenshot the poly page
for each of the six melodic engines. Commit the six PNGs under
`docs/superpowers/specs/2026-08-01-poly-page-before/`. These are the acceptance
reference for Task 9 and Task 10.

- [ ] **Step 2: Write the failing test**

Add to a new `src/engines/subtractive-layout.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { resolveParamRows } from './engine-param-groups';
import { SUB_PARAM_SPECS } from './subtractive-params';
import { SUB_PARAM_GROUPS } from './subtractive';

describe('the subtractive page, from data', () => {
  it('puts OSC 1, OSC 2, SUB and NOISE on one row, in that order', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows[0].sections.map((s) => s.title)).toEqual(['OSC 1', 'OSC 2', 'SUB', 'NOISE']);
  });

  it('gives FILTER and MASTER their own rows', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows.map((r) => r.sections.map((s) => s.title))).toEqual([
      ['OSC 1', 'OSC 2', 'SUB', 'NOISE'], ['FILTER'], ['MASTER'], ['POLY'],
    ]);
  });

  it('keeps the section colours the stylesheet used to key off the div ids', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    const byTitle = new Map(rows.flatMap((r) => r.sections).map((s) => [s.title, s.color]));
    expect(byTitle.get('OSC 1')).toBe('var(--knob-cyan)');
    expect(byTitle.get('OSC 2')).toBe('var(--knob-yellow)');
    expect(byTitle.get('SUB')).toBe('var(--knob-blue)');
    expect(byTitle.get('NOISE')).toBe('var(--knob-purple)');
    expect(byTitle.get('FILTER')).toBe('var(--knob-orange)');
    expect(byTitle.get('MASTER')).toBe('var(--knob-green)');
  });

  it('draws no AMP section — those envelopes belong to the modulators panel', () => {
    const rows = resolveParamRows(SUB_PARAM_SPECS, SUB_PARAM_GROUPS);
    expect(rows.flatMap((r) => r.sections.map((s) => s.title))).not.toContain('AMP');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/subtractive-layout.test.ts`
Expected: FAIL — `SUB_PARAM_GROUPS` is not exported.

- [ ] **Step 4: Declare the groups**

In `src/engines/subtractive.ts`:

```ts
/** The page, as data. The seven sections used to be three rows of hand-written
 *  markup in index.html, and their colours were seven CSS rules keyed on the
 *  div ids (`#poly-osc1-knobs { @include knob-accent(var(--knob-cyan)) }`).
 *  Both are gone: this table is the whole layout, and it is what every other
 *  engine can now declare too. AMP is deliberately absent — its four envelope
 *  params are drawn by the MODULATORS panel (`drawnBy: 'modulators'`), so a
 *  section here would be an empty header. */
export const SUB_PARAM_GROUPS: EngineParamGroup[] = [
  { id: 'osc1',   title: 'OSC 1',  row: 0, color: 'var(--knob-cyan)' },
  { id: 'osc2',   title: 'OSC 2',  row: 0, color: 'var(--knob-yellow)' },
  { id: 'sub',    title: 'SUB',    row: 0, color: 'var(--knob-blue)' },
  { id: 'noise',  title: 'NOISE',  row: 0, color: 'var(--knob-purple)' },
  { id: 'filter', title: 'FILTER', row: 1, color: 'var(--knob-orange)' },
  { id: 'master', title: 'MASTER', row: 2, color: 'var(--knob-green)' },
  { id: 'poly',   title: 'POLY',   row: 3 },
];
```

and pass `groups: SUB_PARAM_GROUPS` into `createDescriptorEngine`.

In `subtractive-params.ts`: give every spec its `group` id; mark the ten
envelope leaves (`filter.attack/decay/sustain/release/builtinEnv`,
`amp.*`) `drawnBy: 'modulators'`; add `selectStyle: 'radio'` to `osc1.wave`,
`osc2.wave`, `filter.model` and `filter.type` so they stay radio strips under the
grouped conventions.

Decision 1 needs nothing extra here: one FILTER group, orange, and the
`nth-last-child` teal rule dies with the rest of the per-id CSS in Task 8.
Record in the Task 8 commit that four knobs changed colour on purpose.

- [ ] **Step 5: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/engines/subtractive-layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/engines/subtractive.ts src/engines/subtractive-params.ts \
        src/engines/subtractive-layout.test.ts docs/superpowers/specs/2026-08-01-poly-page-before/
git commit -m "feat(subtractive): the page is declared data, and the reference shots are committed"
```

---

## Task 8: Delete the static markup and the three branches

Nothing reads the old path after this. Symmetry is the deliverable: after this
task, `grep -rn "subtractive" src --include=*.ts | grep -v test` returns only
engine-identity matches — no branch, no remount hook, no div map.

**Files:**
- Modify: `index.html:202-226`
- Modify: `src/app/knob-mounting.ts` (delete `mountSubtractiveLaneKnobs`)
- Modify: `src/app/engine-selector-wiring.ts` (delete the dep + hook)
- Modify: `src/engines/engine-selector-ui.ts:76-88`
- Modify: `src/session/session-host-lane-editor.ts:63-73`
- Modify: `src/engines/worklet-lane-engine.ts:413`
- Modify: `src/styles/_knob.scss:118-142`
- Modify: `src/main.ts:317,623,741`
- Test: `src/engines/engine-selector-ui.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
  it('leaves no subtractive-only rows in the document', () => {
    document.body.innerHTML = pageFixture();       // the poly page as index.html ships it
    expect(document.querySelectorAll('[data-engine="subtractive"]').length).toBe(0);
  });
```

Plus, in `src/app/knob-registry-prune.test.ts` or the mount test from Task 2:

```ts
  it('a TB-303 lane leaves no orphan knob labels behind on the poly page', () => {
    // Before: 35 labels, 19 of them Subtractive's, all invisible.
    openLaneEditor('sub-1'); openLaneEditor('tb-1');
    const labels = [...document.querySelectorAll('.knob-label')].map((e) => e.textContent);
    expect(labels.filter((l) => l === 'Cutoff')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-selector-ui.test.ts`
Expected: FAIL — the rows are still in the fixture.

- [ ] **Step 3: Delete, in this order**

1. `worklet-lane-engine.ts:413` — drop `if (this.id !== 'subtractive')`, so the
   grid runs for every engine. **Verify by hand at this point that the page now
   double-draws** (the static rows AND the grid): that proves the grid is
   producing the sections before anything is removed.
2. `index.html` — delete the three `data-engine="subtractive"` rows (lines
   202-226) entirely.
3. `knob-mounting.ts` — delete `mountSubtractiveLaneKnobs`, its entry in the
   `KnobMounter` interface and the `sectionMap`/`ENV_LEAVES`/AMP-hide code.
4. `engine-selector-wiring.ts` — delete `mountSubtractiveLaneKnobs` from the deps
   and `remountSubtractiveLaneKnobs` from `engineSelectorDeps`.
5. `engine-selector-ui.ts` — delete the `subtractiveRows` sweep, the
   `remountSubtractiveLaneKnobs` dep and its call; `_polyPage` may become unused.
6. `session-host-lane-editor.ts` — delete the second `subRows` sweep.
7. `main.ts` — delete the `mountSubtractiveLaneKnobs` alias, its dep and the boot
   call at line ~741.
8. `_knob.scss` — delete the seven `#poly-*-knobs` accent rules and the
   `nth-last-child` rule. Keep the `knob-accent` mixin only if another selector
   still uses it; otherwise delete it too.

- [ ] **Step 4: Typecheck, unit, build, e2e**

```bash
npx tsc --noEmit
npm run test:unit
npm run build          # e2e serves dist/ with NO build step
npm run test:e2e
```
Expected: PASS. e2e locators that used `:visible` to dodge the duplicate "Cutoff"
still work (the selector is merely no longer necessary) — do **not** edit them in
this task.

- [ ] **Step 5: Visual parity — the acceptance gate**

Open the app in real Chrome, select a Subtractive lane, screenshot, and compare
side by side with the reference from Task 7. The only admissible differences are
the three agreed convention shifts: unit suffix on Osc1 Det / Osc2 Det / Tune /
Detune, 200-step drag, radio strips unchanged. **Anything else is a defect** —
fix it before committing rather than filing it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ui): the subtractive page comes from its spec, and its markup is gone"
```

---

## Task 9: The other five declare their groups

**Files:**
- Modify: `src/engines/fm.ts`, `src/engines/tb303.ts`, `src/engines/wavetable.ts`, `src/engines/westcoast.ts`
- Test: one layout test per engine, mirroring `subtractive-layout.test.ts`

- [ ] **Step 1: For each engine, write its layout test first**

Same shape as Task 7's: assert the row/section structure the engine intends. FM
already groups by `OP1`…`OP4` (`src/engines/fm.ts:32`) — those strings are
currently both key and title, so its table is
`[{ id: 'OP1', title: 'OP 1', row: 0 }, …]` and the test asserts the four
operators now share rows two-by-two rather than stacking four deep.

- [ ] **Step 2: Run each to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/<engine>-layout.test.ts`

- [ ] **Step 3: Declare the table on each descriptor**

Group ids come from the existing dot-prefix of each engine's params. Assign
colours from the same palette (`--knob-cyan` … `--knob-green`) — no new colours.
**`Algorithm` must keep `selectStyle: 'dropdown'`.**

- [ ] **Step 4: Run the tests, build, and look at all five pages**

```bash
npx tsc --noEmit && npm run test:unit && npm run build && npm run test:e2e
```
Then open each of the five in Chrome against the Task 7 reference shots.

- [ ] **Step 5: Commit — one commit per engine**

```bash
git commit -m "feat(fm): the operator sections are declared, not stacked"
```

---

## Task 10: `groups` enters the plugin ABI

Karplus already ships as an external plugin, so a plugin that cannot declare its
layout is a plugin that cannot be symmetric with a built-in engine. This is the
task that makes the claim true.

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts:81`
- Modify: `packages/loom-plugin-sdk/src/types.ts` (re-export `EngineParamGroup`)
- Modify: `plugins/karplus/*` (declare its groups)
- Modify: `public/plugins/karplus/*` (the built copy the app loads)
- Test: `packages/loom-plugin-sdk/src/sdk-parity.test.ts` (extend)

- [ ] **Step 1: Write the failing parity test**

```ts
  it('a plugin engine can declare its editor layout like a built-in one', () => {
    const manifest = loadManifest('karplus');
    expect(manifest.groups?.map((g) => g.title)).toBeDefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run packages/loom-plugin-sdk/src/sdk-parity.test.ts`

- [ ] **Step 3: Add `groups?: EngineParamGroup[]` to the manifest type, declare Karplus's table, rebuild the plugin into `public/plugins/`**

- [ ] **Step 4: Verify in the browser**

The Karplus page must show its sections. `src/` alone cannot prove this — the
plugin is loaded at runtime.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(plugins): a plugin engine declares its editor layout too"
```

---

## Task 11: Retire the prefix hammer

`rebuildEngineParamUI` still calls `unregisterKnobsByPrefix('<activeLaneId>.')`
on every lane switch, deleting the *new* lane's mixer knobs; they survive only
because `showLaneEditor` calls `renderWithMixer()` afterwards. With Task 2's
transaction the hammer has no job left, but the ordering must be pinned by a test
before it moves.

**Files:**
- Modify: `src/engines/engine-selector-ui.ts:65-99`
- Test: `src/engines/engine-selector-ui.test.ts`

- [ ] **Step 1: Write the test that pins today's behaviour**

```ts
  it('a lane switch never leaves the new lane without its mixer knobs', () => {
    registry.set('fm-1.bus.level', knob('fm-1.bus.level'));
    switchToLane('fm-1');
    expect(registry.has('fm-1.bus.level')).toBe(true);
  });
```

- [ ] **Step 2: Run it — it must PASS before the change** (it documents the
      status quo, luck included).

- [ ] **Step 3: Delete the `unregisterKnobsByPrefix` call from `rebuildEngineParamUI`**

Keep the exported function: `engine-swap` still needs a wholesale clear when a
lane's engine changes and its param ids genuinely cease to exist.

- [ ] **Step 4: Run the test again — it must still PASS**, now by construction
      rather than by call order.

- [ ] **Step 5: Full suite + build + e2e, then commit**

```bash
npx tsc --noEmit && npm run test:unit && npm run build && npm run test:e2e
git commit -m "refactor(ui): lane switching no longer clears knobs it does not own"
```

---

## Task 12: Close the paperwork

- [ ] **Step 1: Update `docs/superpowers/REMAINING-WORK.md`** — delete the
      "Subtractive's knobs are hand-written in index.html" debt entry; it is
      closed, and a closed debt left on the list is how the list stops being read.

- [ ] **Step 2: Update `CLAUDE.md`** — the "Add an engine — FIVE steps" section
      gains the group table as part of step 1, and the Architecture section's
      description of `engine-param-grid.ts` mentions `engine-param-groups.ts`.

- [ ] **Step 3: Run `npm test` end to end** (unit + e2e, after a build).

- [ ] **Step 4: Rebase onto main and commit**

```bash
git rebase main
git add docs/superpowers/REMAINING-WORK.md CLAUDE.md
git commit -m "docs: the hand-written engine page is gone, and the list says so"
```

---

## Self-review notes

- **Spec coverage.** Phase 0 → Tasks 1-2. Phase 1 → Tasks 3-6. Phase 2 → Tasks
  7-8. Phase 3 → Tasks 9-10. Phase 4 → Task 11. Docs → Task 12. The spec's
  `drawnBy` field is implemented in Task 3 and applied in Tasks 6-7. The spec's
  demand that visual parity be checked against committed reference images is
  Task 7 Step 1 and Task 8 Step 5.
- **Naming is consistent across tasks**: `resolveParamRows`, `ParamRow`,
  `ParamSection`, `EngineParamGroup`, `landAutomationValue`, `LandingDeps`,
  `applyPlaybackUnmountedWrite`, `targetRanges`, `SUB_PARAM_GROUPS`.
- **Two knowingly deferred checks**, both flagged in-task rather than assumed:
  whether `createKnob` strokes `.knob-pointer` as well as `.knob-value` for a
  custom colour (Task 4 Step 3), and where `WorkletLaneEngine` stores the
  descriptor's param list so `groups` can ride along (Task 5 Step 3).

---

## Task 8b: one rule for every discrete control

Added 2026-08-01 after the owner saw the rebuilt page. Subtractive's discrete
params had regressed to knobs (fixed in Task 8's fix round 1), and looking at the
result raised the real question: the same choice is drawn four different ways
across the app, and none of them is compact.

**Audited inventory: 27 discrete params, five different renderings.** An
oscillator waveform is a native select in Subtractive, a knob in Westcoast, an
8-position knob in Wavetable, a 2-position knob in TB-303, and a radio strip in
Drums — with no functional difference between them.

**A third render path exists and was undocumented.** `src/session/lane-insert-ui.ts:181-195`
builds its own `<select class="insert-sel">` for FX insert params, bypassing
`createSelectControl` entirely. Reverb's and Multifilter's 4-option `Type` are
forced dropdowns purely because they live in the insert chain. Any single rule
must cover this path or the FX rack keeps diverging.

### The rule (owner decision, measured)

A vertical strip is `24·N − 2` px tall; a full knob is 68 px. So:

| options | stacked height (22px button) | with a 15px button |
|---|---|---|
| 2 | 46 | 32 |
| 3 | 70 (over) | 47 |
| 4 | 94 (over) | **62 — fits under 68** |
| 5+ | 118+ | 77+ (over) |

**Therefore:**

1. **Every discrete param renders as a select control. The knob branch for
   discrete params is deleted.** `selectStyle: 'radio'` stops being an opt-in and
   becomes the default; only `'dropdown'` remains, as a force.
2. **≤ 4 options → a VERTICAL radio strip**, `flex-direction: column`, button
   height ~15px, strip width equal to a knob's (50px) so a row of mixed controls
   aligns.
3. **> 4 options, or `selectStyle: 'dropdown'` → native select**, which is
   already compact. This covers Wavetable's 8 waveforms, the 5-option CHOKEs, the
   7-option Syncs and FM's long-labelled Algorithm (where stacking would not fix
   the width anyway).
4. **All three paths obey it** — the grouped grid, the flat layout, and the FX
   insert rack. `lane-insert-ui.ts` must route through `createSelectControl`
   instead of hand-rolling a `<select>`.

### Scope of visible change

Westcoast (6 params), Wavetable (3), TB-303 (1) currently draw discrete params as
knobs and will become strips or selects. Reverb / Multifilter / Tremolo gain
strips for their ≤4-option params. This is deliberate: it is what "the same
choice looks the same everywhere" costs.

### Tests

- a discrete param with ≤4 options renders a strip, not a knob, in BOTH layouts;
- a discrete param with >4 options renders a native select in both;
- `selectStyle: 'dropdown'` still forces a select at any option count;
- the strip is `flex-direction: column`;
- an FX insert param with 4 options renders the same control as an engine param
  with 4 options — the assertion that pins the third path to the rule;
- no discrete param anywhere produces a `.knob` element.

### Verification

Coordinator opens the six engine pages plus a drum lane, a sampler pad and an FX
insert in Chrome, and measures: every discrete control's width ≤ a knob's, and
its height ≤ a knob's for ≤4 options.
