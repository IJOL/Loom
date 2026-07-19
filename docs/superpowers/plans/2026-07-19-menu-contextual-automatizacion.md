# Knob Automation Context Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click a knob and jump straight to that parameter's automation, creating it if it doesn't exist yet, instead of hunting for the parameter in a dropdown of dozens.

**Architecture:** All the routing logic lives in one pure function (`resolveAutomationTarget`) that takes the param id, the view mode and the lane play states and returns where the automation should go. The context menu just calls it and renders. Two pre-existing warts are fixed first: knobs start a drag on right-press, and clip-envelope creation has no reusable function.

**Tech Stack:** TypeScript, Vite, Web Audio, Vitest (+ jsdom for DOM tests), Playwright for the final hand check.

## Global Constraints

- Branch: `worktree-automation-destination-registry`, in the worktree at `c:\Users\nacho\git\tb303-synth\.claude\worktrees\automation-destination-registry`. **Never touch the main checkout.**
- Test commands colour-free: `NO_COLOR=1 npx vitest run <path>`. Never add `--reporter=`.
- `ERR_IPC_CHANNEL_CLOSED` **after** all tests pass is a known flaky teardown — re-run to confirm; it is not a failure.
- UI strings and code comments in English. Conversation is Spanish; the code is not.
- Source files ≤300 lines target, 500 hard limit.
- Test assertions relative, never absolute magnitudes, unless justified in a comment.
- Deps are threaded explicitly. **No module-level singletons** — this branch just deleted a fallback that silently built a second registry.
- DOM tests need `// @vitest-environment jsdom` on line 1.
- Two silent traps in this repo: `listAutomationTargets` returns `[]` **silently** for an unregistered plugin id, and `getEngine()` returns `undefined` for an engine module never imported. Either makes an assertion pass for reasons unrelated to the code under test. See `docs/automation-destinations.md`.

---

### Task 1: Knobs ignore non-primary mouse buttons

**Files:**
- Modify: `src/core/knob.ts` (the `pointerdown` handler, ~line 160)
- Test: `src/core/knob-right-click.test.ts` (create)

**Interfaces:**
- Produces: no new API. Behaviour change only.

**Why first:** `createKnob`'s `pointerdown` does not filter by button, so a right-press calls `svg.setPointerCapture(...)`, sets `dragging = true`, fires `onGestureStart`, and lets subsequent moves change the value. Nobody notices today because nothing right-clicks a knob. The moment Task 4 lands, every use of the new menu would drag the knob it was opened on.

- [ ] **Step 1: Write the failing test**

Create `src/core/knob-right-click.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createKnob } from './knob';

function rightPointerDown(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointerdown', {
    button: 2, buttons: 2, bubbles: true, cancelable: true, pointerId: 1,
  }));
}

describe('knob mouse buttons', () => {
  it('does not start a drag on a right-press', () => {
    const onGestureStart = vi.fn();
    const onChange = vi.fn();
    const k = createKnob({
      min: 0, max: 1, value: 0.5, onChange, onGestureStart, label: 'CUTOFF',
    });
    const svg = k.el.querySelector('svg')!;
    // jsdom has no pointer capture; stub it so the handler can run either way.
    (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

    rightPointerDown(svg);

    expect(onGestureStart).not.toHaveBeenCalled();
    expect(k.el.classList.contains('dragging')).toBe(false);
  });

  it('still starts a drag on a left-press', () => {
    const onGestureStart = vi.fn();
    const k = createKnob({ min: 0, max: 1, value: 0.5, onChange: () => {}, onGestureStart });
    const svg = k.el.querySelector('svg')!;
    (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

    svg.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1,
    }));

    expect(onGestureStart).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/core/knob-right-click.test.ts`
Expected: FAIL — the first test fails because `onGestureStart` WAS called.

- [ ] **Step 3: Filter the button**

In `src/core/knob.ts`, at the top of the `pointerdown` handler, before anything else:

```ts
  svg.addEventListener('pointerdown', (e) => {
    // Only the primary button drags. Without this a right-press captures the
    // pointer and subsequent moves change the value — which the knob context
    // menu would trigger on every use.
    if (e.button !== 0) return;
    // …existing body unchanged…
  });
```

Read the current handler first and keep every existing line after the guard.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/core/`
Expected: PASS, including the pre-existing knob tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/knob.ts src/core/knob-right-click.test.ts
git commit -m "fix(knob): only the primary button starts a drag"
git rebase main
```

---

### Task 2: Extract clip-envelope creation into a reusable function

**Files:**
- Modify: `src/session/clip-automation-lanes.ts:71-84` (the `+ Automation` click handler)
- Test: `src/session/clip-envelope-ops.test.ts` (create)
- Create: `src/session/clip-envelope-ops.ts`

**Interfaces:**
- Produces: `addClipEnvelope(clip: SessionClip, paramId: string): boolean` — returns `true` if it created one, `false` if that param already had an envelope. Lives in a new leaf module with no UI imports.

**Why:** the creation logic (lazily init the array, dedupe by `paramId`, fill `clip.lengthBars * 16 * AUTOMATION_SUB_RES` values with `0.5`) is currently inlined in a DOM click handler. Task 4 needs exactly that behaviour. Two copies would drift.

- [ ] **Step 1: Write the failing test**

Create `src/session/clip-envelope-ops.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addClipEnvelope } from './clip-envelope-ops';
import { AUTOMATION_SUB_RES } from '../automation/automation-tick';
import type { SessionClip } from './session-types';

function clipOf(lengthBars: number): SessionClip {
  return { id: 'c1', name: 'Verse 1', lengthBars, notes: [] } as unknown as SessionClip;
}

describe('addClipEnvelope', () => {
  it('creates an envelope sized to the clip and centred at 0.5', () => {
    const clip = clipOf(2);
    expect(addClipEnvelope(clip, 'poly1.filter.cutoff')).toBe(true);
    const env = clip.envelopes![0];
    expect(env.paramId).toBe('poly1.filter.cutoff');
    expect(env.values.length).toBe(2 * 16 * AUTOMATION_SUB_RES);
    expect(new Set(env.values)).toEqual(new Set([0.5]));
    expect(env.enabled).toBe(true);
  });

  it('does not duplicate an envelope that already exists', () => {
    const clip = clipOf(1);
    addClipEnvelope(clip, 'poly1.filter.cutoff');
    expect(addClipEnvelope(clip, 'poly1.filter.cutoff')).toBe(false);
    expect(clip.envelopes!.length).toBe(1);
  });

  it('keeps existing envelopes for other params', () => {
    const clip = clipOf(1);
    addClipEnvelope(clip, 'poly1.filter.cutoff');
    addClipEnvelope(clip, 'poly1.amp.attack');
    expect(clip.envelopes!.map((e) => e.paramId))
      .toEqual(['poly1.filter.cutoff', 'poly1.amp.attack']);
  });
});
```

**Before writing this test, verify two things in the real source** and adjust if they differ: that `SessionClip.envelopes` is the real field name (`src/session/session-types.ts:75`), and where `AUTOMATION_SUB_RES` is actually exported from — grep for it; the import path above is a guess and a wrong one will make the test fail for the wrong reason.

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/session/clip-envelope-ops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `src/session/clip-envelope-ops.ts`:

```ts
// src/session/clip-envelope-ops.ts
// Creating a clip automation envelope. Extracted from the "+ Automation" button
// so the knob context menu can create one the same way — two copies of the
// sizing and dedupe rules would drift.

import type { SessionClip } from './session-types';
import { AUTOMATION_SUB_RES } from '../automation/automation-tick';

/** Add a flat (0.5) envelope for `paramId`, sized to the clip's length.
 *  Returns false and changes nothing when that param already has one. */
export function addClipEnvelope(clip: SessionClip, paramId: string): boolean {
  if (!clip.envelopes) clip.envelopes = [];
  if (clip.envelopes.some((e) => e.paramId === paramId)) return false;
  const stepCount = clip.lengthBars * 16 * AUTOMATION_SUB_RES;
  clip.envelopes.push({
    paramId,
    enabled: true,
    stepped: false,
    values: Array.from({ length: stepCount }, () => 0.5),
  });
  return true;
}
```

- [ ] **Step 4: Use it from the existing button**

In `src/session/clip-automation-lanes.ts`, replace the inlined body of the `+ Automation` click handler with a call to `addClipEnvelope`, keeping the re-render:

```ts
  addBtn.addEventListener('click', () => {
    const paramId = sel.value;
    if (!paramId) return;
    if (!addClipEnvelope(clip, paramId)) return;   // already exists
    renderClipAutomationLanes(host, clip, deps);
  });
```

Add the import and delete any now-unused local (`stepCount`, `AUTOMATION_SUB_RES`) if nothing else in the file uses them.

- [ ] **Step 5: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/session/`
Expected: PASS. The existing clip-automation tests must still pass — this is a pure extraction, no behaviour change.

- [ ] **Step 6: Commit**

```bash
git add src/session/clip-envelope-ops.ts src/session/clip-envelope-ops.test.ts src/session/clip-automation-lanes.ts
git commit -m "refactor(automation): one function creates a clip envelope"
git rebase main
```

---

### Task 3: `resolveAutomationTarget` — the whole decision, with no DOM

**Files:**
- Create: `src/automation/automation-target-resolver.ts`
- Test: `src/automation/automation-target-resolver.test.ts`

**Interfaces:**
- Consumes: `parseAutomationParamId` from `src/automation/automation-apply.ts`; `LanePlayState` from `src/session/session-runtime.ts`; `SessionState` from `src/session/session-types.ts`.
- Produces:

```ts
export type AutomationTarget =
  | { kind: 'clip'; laneId: string; clipIdx: number; clipName: string; existing: boolean }
  | { kind: 'timeline'; existing: boolean }
  | { kind: 'unavailable'; reason: string };

export interface ResolveTargetInput {
  paramId: string;
  mode: 'session' | 'performance';
  state: SessionState;
  laneStates: ReadonlyMap<string, LanePlayState>;
  /** Curve param ids already present in the arrangement (lane + global). */
  timelineParamIds: readonly string[];
}

export function resolveAutomationTarget(input: ResolveTargetInput): AutomationTarget;
```

**This is the heart of the feature.** The user's rule has five branches; each writes somewhere different. Keeping them in a pure function is what makes them testable without a browser.

The rule, in order:
1. `mode === 'performance'` → `{ kind: 'timeline' }`. `existing` = whether `paramId` is in `timelineParamIds`.
2. Otherwise, if the param's scope is a lane that exists in `state.lanes` → that lane's **playing** clip (`laneStates.get(laneId)?.playing`), matched back to its index in `lane.clips` by `id`. If nothing is playing → the lane's **first non-null clip**. `existing` = whether the clip already has an envelope for `paramId`.
3. Otherwise, if the lane exists but has no clips at all → `{ kind: 'unavailable', reason: 'This track has no clips' }`.
4. Otherwise (scope is `fx.master` or `fx.send.<id>`, i.e. not a lane) → `{ kind: 'unavailable', reason: 'Master and send FX automate on the timeline — switch to Performance' }`.
5. If the lane named by the id no longer exists → `{ kind: 'unavailable', reason: 'That track is gone' }`.

- [ ] **Step 1: Write the failing tests**

Create `src/automation/automation-target-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveAutomationTarget } from './automation-target-resolver';
import type { SessionState } from '../session/session-types';
import type { LanePlayState } from '../session/session-runtime';

function playState(laneId: string, playing: { id: string } | null): LanePlayState {
  return { laneId, playing, queued: null, queuedBoundary: 0, queuedStop: null,
    startTime: 0, nextStepIdx: 0, loopCount: 0, loopStartedAt: 0,
    lastScheduledAt: -Infinity } as unknown as LanePlayState;
}

function stateWith(clips: ({ id: string; name?: string } | null)[]): SessionState {
  return {
    lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips, inserts: [] }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

const NO_TIMELINE: string[] = [];

describe('resolveAutomationTarget', () => {
  it('routes to the timeline in Performance mode', () => {
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'performance',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toEqual({ kind: 'timeline', existing: false });
  });

  it('reports an existing timeline curve', () => {
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'performance',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: ['poly1.filter.cutoff'],
    });
    expect(t).toEqual({ kind: 'timeline', existing: true });
  });

  it('routes to the clip PLAYING on that param\'s lane', () => {
    const state = stateWith([{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }]);
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state,
      laneStates: new Map([['poly1', playState('poly1', { id: 'c2' })]]),
      timelineParamIds: NO_TIMELINE,
    });
    expect(t).toEqual({ kind: 'clip', laneId: 'poly1', clipIdx: 1, clipName: 'B', existing: false });
  });

  it('falls back to the first clip when nothing is playing', () => {
    const state = stateWith([null, { id: 'c2', name: 'B' }]);
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state,
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toEqual({ kind: 'clip', laneId: 'poly1', clipIdx: 1, clipName: 'B', existing: false });
  });

  it('reports an envelope the clip already has', () => {
    const state = stateWith([
      { id: 'c1', name: 'A', envelopes: [{ paramId: 'poly1.filter.cutoff' }] } as never,
    ]);
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state,
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t).toMatchObject({ kind: 'clip', existing: true });
  });

  it('is unavailable for a master FX param outside Performance', () => {
    const t = resolveAutomationTarget({
      paramId: 'fx.master.fx:slotA.freq', mode: 'session',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t.kind).toBe('unavailable');
    expect((t as { reason: string }).reason).toMatch(/Performance/);
  });

  it('is unavailable when the track has no clips', () => {
    const t = resolveAutomationTarget({
      paramId: 'poly1.filter.cutoff', mode: 'session', state: stateWith([null, null]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t.kind).toBe('unavailable');
    expect((t as { reason: string }).reason).toMatch(/no clips/i);
  });

  it('is unavailable when the lane no longer exists', () => {
    const t = resolveAutomationTarget({
      paramId: 'ghost.filter.cutoff', mode: 'session',
      state: stateWith([{ id: 'c1' }]),
      laneStates: new Map(), timelineParamIds: NO_TIMELINE,
    });
    expect(t.kind).toBe('unavailable');
  });
});
```

**Before running these, verify the field names against the real types** in `src/session/session-types.ts`: that a clip's curves are `envelopes` (NOT `automation` — that exact confusion silently produced a do-nothing migration earlier on this branch), that `SessionClip` really has a `name`, and that `LanePlayState.playing` is a `SessionClip | null`. The fixtures above are cast, so TypeScript will not catch a wrong name for you.

- [ ] **Step 2: Run them and watch them fail**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-target-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/automation/automation-target-resolver.ts`. Decide the lane from the param id via `parseAutomationParamId` (its `scopeId` is a lane id for lane params, and `fx.master` / `fx.send.<id>` for the global racks — verify that in `src/automation/automation-apply.ts` before relying on it). Then follow the five-branch rule above in order. No DOM, no imports from any UI module.

Keep the reason strings short and user-facing — they are shown verbatim in a disabled menu item, because `ContextMenuItem` has no tooltip support (`src/core/context-menu.ts`).

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/automation/ && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/automation/automation-target-resolver.ts src/automation/automation-target-resolver.test.ts
git commit -m "feat(automation): resolve where a knob's automation should go"
git rebase main
```

---

### Task 4: Wire the context menu onto every automatable control

**Files:**
- Create: `src/automation/knob-automation-menu.ts`
- Test: `src/automation/knob-automation-menu.test.ts`
- Modify: `src/main.ts` (the `registerKnob` wrapper, ~line 204)

**Interfaces:**
- Consumes: `resolveAutomationTarget` (Task 3); `addClipEnvelope` (Task 2); `openContextMenu` / `ContextMenuItem` from `src/core/context-menu.ts`; `addAutomationCurve` from `src/performance/arrangement-ops.ts`; `KnobHandle` from `src/core/knob.ts`.
- Produces:

```ts
export interface KnobMenuDeps {
  destinations: DestinationRegistry;
  getMode: () => 'session' | 'performance';
  getState: () => SessionState;
  getLaneStates: () => ReadonlyMap<string, LanePlayState>;
  getArrangement: () => ArrangementState;
  laneIds: () => string[];
  openClip: (laneId: string, clipIdx: number) => void;
  onArrangementEdited: () => void;
  onClipEdited: (laneId: string, clipIdx: number) => void;
}

export function attachKnobAutomationMenu(handle: KnobHandle, deps: KnobMenuDeps): void;
```

**Where to attach.** `registerKnob` in `src/main.ts` is the single funnel every automatable control passes through — both `createKnob` knobs and the hand-built `KnobHandle`s from `src/core/select-control.ts`. It is also the only scope that has the destination registry, the session host and the performance feature together. Attach there.

**Yes, this also attaches to select-controls, and that is fine.** The spec scopes the feature to knobs. Select-controls represent *discrete* params, which the destination catalogue does not list, so the listener runs and immediately bails — no menu. That is the correct behaviour, not a leak of scope, and it means the day discrete params become automatable the menu works with no extra wiring. Do not add a type check to exclude them; the destination check already does the right thing for the right reason.

Guard against double-wiring with a `WeakSet<HTMLElement>`: `registerKnob` is called again with a fresh element on every re-mount, but nothing guarantees the same handle is never re-registered.

**Menu contents**, built fresh on each right-click so they reflect live state:

| Target | Item |
|---|---|
| `clip`, not existing | `Automate in clip "<name>"` → create + open |
| `clip`, existing | `Edit automation in clip "<name>"` → open |
| `timeline`, not existing | `Automate on the timeline` → create + refresh |
| `timeline`, existing | `Edit automation on the timeline` → refresh |
| `unavailable` | the `reason` string, `disabled: true` |

Do NOT call `e.preventDefault()` — `openContextMenu` already does. DO call `e.stopPropagation()`: no existing `contextmenu` handler stops propagation, so a knob inside a lane header would otherwise open two menus in sequence.

Open no menu at all when `handle.meta.id` is absent or is not in `deps.destinations.list()` — a control that cannot be automated should behave exactly as it does today.

- [ ] **Step 1: Write the failing test**

Create `src/automation/knob-automation-menu.test.ts` with `// @vitest-environment jsdom` on line 1.

Build the knob with the real `createKnob` and register the real `multifilter` plugin (`_resetRegistry` + `registerPlugin`) plus a side-effect `import '../engines/subtractive'` — otherwise the catalogue is silently empty and every assertion passes or fails for the wrong reason. Copy the setup block verbatim from `src/modulation/modulation-ui-dest-refresh.test.ts`.

Here is one test written in full. **Write the other four in exactly this shape** — same helpers, same fixture, only the arrangement and the assertion change:

```ts
function rightClick(el: Element): void {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}
const menuItems = () =>
  [...document.querySelectorAll('.context-menu-item')].map((li) => ({
    text: (li.textContent ?? '').trim(),
    disabled: li.classList.contains('disabled'),
  }));

it('offers the playing clip by name, and creates the envelope on select', () => {
  const clip = { id: 'c2', name: 'Chorus', lengthBars: 1, notes: [] };
  const state = {
    lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive',
              clips: [{ id: 'c1', name: 'Verse', lengthBars: 1, notes: [] }, clip],
              inserts: [] }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;

  const handle = createKnob({ id: 'poly1.filter.cutoff', label: 'CUTOFF',
    min: 0, max: 1, value: 0.5, onChange: () => {} });
  document.body.appendChild(handle.el);

  attachKnobAutomationMenu(handle, {
    destinations: createDestinationRegistry({ getState: () => state, getKnobRegistry: () => new Map() }),
    getMode: () => 'session',
    getState: () => state,
    getLaneStates: () => new Map([['poly1', { laneId: 'poly1', playing: clip } as never]]),
    getArrangement: () => emptyArrangementState(120),
    laneIds: () => ['poly1'],
    openClip: () => {},
    onArrangementEdited: () => {},
    onClipEdited: () => {},
  });

  rightClick(handle.el);
  expect(menuItems()[0].text).toContain('Chorus');   // names the PLAYING clip, not the first

  (document.querySelector('.context-menu-item') as HTMLElement).click();
  expect(clip.envelopes?.map((e) => e.paramId)).toEqual(['poly1.filter.cutoff']);
});
```

The other four, same shape:

- `opens no menu for a control that is not a destination` — give the knob id `poly1.mod.lfo1.rate`; assert `document.querySelector('.context-menu')` is `null`.
- `says "Edit" when the clip already has that envelope, and does not duplicate it` — seed `clip.envelopes` with that paramId; assert the label contains `Edit` and that after clicking, `clip.envelopes.length` is still 1.
- `shows a disabled item with the reason for a master FX knob in Session view` — knob id `fx.master.fx:<slotId>.freq` with a matching insert in `state.masterInserts`; assert the single item is `disabled` and its text mentions Performance.
- `creates a timeline curve in Performance mode` — `getMode: () => 'performance'`; hold the arrangement in a `const` so you can assert it gained a curve for that paramId after the click.

- [ ] **Step 2: Run them and watch them fail**

Run: `NO_COLOR=1 npx vitest run src/automation/knob-automation-menu.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`attachKnobAutomationMenu` adds one `contextmenu` listener to `handle.el` that: bails when the id is missing or not a destination; calls `resolveAutomationTarget`; builds the item list from the table above; calls `openContextMenu(e, items)`.

For the `clip` create path use `addClipEnvelope(clip, paramId)` then `deps.openClip(laneId, clipIdx)` then `deps.onClipEdited(laneId, clipIdx)`.
For the `timeline` create path use `addAutomationCurve(deps.getArrangement(), paramId, deps.laneIds())` then `deps.onArrangementEdited()` — `addAutomationCurve` does not refresh the UI by itself.

- [ ] **Step 4: Wire it in main.ts**

Find the `registerKnob` wrapper (around `src/main.ts:204`) and attach after registration. Supply `openClip` from `sessionHost.inspector.setSelectedClip({ laneId, clipIdx })` plus whatever re-render the existing callers of `setSelectedClip` pair it with — read `src/session/session-host-callbacks.ts:44` and copy that pairing rather than guessing. Supply `getMode`/`getArrangement`/`refreshPerformanceView` from the performance feature, and `onArrangementEdited` from the same hook the Performance view already uses for undo.

- [ ] **Step 5: Run the tests and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(automation): right-click a knob to reach its automation"
git rebase main
```

---

### Task 5: Drive it by hand in the real app

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Build and start the dev server in the worktree**

```bash
npm run build
npm run dev
```

- [ ] **Step 2: Check every branch of the rule, in Chrome**

1. Open a lane's editor. **Right-drag a knob** — the value must not change and the knob must not stick in drag. (Task 1.)
2. Launch a clip on that lane. Right-click a knob → the item must name **that** clip. Select it → the envelope appears and the clip opens.
3. Right-click the same knob again → it must say **Edit**, and must not create a second envelope.
4. Stop the lane. Right-click → it must name the lane's **first** clip.
5. Right-click a **master FX** knob in Session view → a disabled item explaining it needs Performance. **Nothing must stop playing.**
6. Switch to Performance. Right-click any knob → it must offer the **timeline**, and the curve must appear.
7. Right-click a **modulator's own rate knob** (`…mod.lfo1.rate`) → **no menu at all**; it is not a destination.

- [ ] **Step 3: Report honestly**

Record what was checked by hand and what only by test. Do not claim the UI works without having looked at it.

---

## Risks

1. **Task 4 touches `main.ts`**, already 1491 lines and over the hard cap. Keep the addition to the wiring call; all logic belongs in the new module.
2. **`setMode` stops the transport.** Nothing in this plan calls it — that is why master/send knobs show a disabled item instead of switching views. Do not "improve" this by switching automatically.
3. **The resolver's five branches are the whole feature.** If a browser check disagrees with a unit test, the unit test is probably asserting the wrong shape — fix the test, do not paper over it in the menu.
