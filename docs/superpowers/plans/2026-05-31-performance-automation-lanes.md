# Performance Automation Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users author automation in Performance view without recording — set an arrangement length in bars, create automation lanes for any param, draw them with the existing canvas painter, and navigate the whole timeline with continuous zoom.

**Architecture:** A new self-contained module `performance-automation-ui.ts` reuses the shared `automation-painter.ts` engine (`drawLane`/`attachLanePainter`). `renderPerformanceView` gains a toolbar (Length + zoom) and renders editable automation lanes at a shared, variable `pxPerBar`. The `AutomationCurve` model is reconciled with the painter (`samples`→`values`, `+enabled`/`+stepped`) and the arrangement gains a user-set `lengthBars`. Playback (`tickArrangement`) and v3 save persistence already cover the new data with two small additions (respect `enabled`, migrate old `samples`).

**Tech Stack:** TypeScript, Vite, Web Audio, Vitest (unit + DSP via `node-web-audio-api`), Playwright (e2e). No linter. Tests assert **relative** magnitudes (repo convention).

**Working dir:** worktree on branch `feat/perf-automation-lanes`. Spec: `docs/superpowers/specs/2026-05-31-performance-automation-lanes-design.md`.

**Conventions:**
- Run a single unit file: `npx vitest run <file>` (npm scripts already set `NO_COLOR=1`; for a bare invocation prefer `NO_COLOR=1 npx vitest run <file>`).
- Typecheck: `npx tsc --noEmit`.
- e2e serves `dist/` with **no build step** → always `npm run build` before `npm run test:e2e`.
- Commit after every green task.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/performance/performance.ts` | Data model: `AutomationCurve`, `ArrangementState` | Modify (rename + flags + `lengthBars`) |
| `src/performance/arrangement-ops.ts` | Pure arrangement mutations | Modify (rename; add length/curve helpers) |
| `src/performance/arrangement-runtime.ts` | Playback scheduler | Modify (respect `enabled`) |
| `src/performance/performance-automation-ui.ts` | **NEW** — automation lane editor (picker, +/-, painter, header) | Create |
| `src/performance/performance-ui.ts` | Timeline render: toolbar, ruler, clips, automation, zoom | Modify |
| `src/app/performance-feature.ts` | Wiring: registry, toolbar state, refresh, undo | Modify |
| `src/save/saved-state-v3.ts` | v3 save load migration `samples`→`values` | Modify |
| `src/styles/_performance-view.scss` | Toolbar + editable-lane styles | Modify |
| `index.html` | (no change needed — toolbar built in JS inside `#performance-view-root`) | — |
| `tests/e2e/performance-view.spec.ts` | e2e round-trip | Modify (add one test) |

`src/automation/automation-painter.ts` is reused **unchanged**.

---

## Task 1: Reconcile `AutomationCurve` with the painter (rename + flags + `lengthBars`)

**Files:**
- Modify: `src/performance/performance.ts:11-29`
- Modify: `src/performance/arrangement-ops.ts` (refs at lines 52, 76-77, 81-83, 88)
- Modify: `src/performance/performance-ui.ts:96`
- Test: `src/performance/arrangement-ops.test.ts` (refs at lines 100-101, 108, 116)

- [ ] **Step 1: Update the existing test field name `samples` → `values`**

In `src/performance/arrangement-ops.test.ts`, replace the four `.samples` reads with `.values`:

```ts
    expect(curve.values.length).toBeGreaterThanOrEqual(4);
    expect(curve.values[3]).toBe(0.42);
    // ...
    expect(s.globalAutomation[0].values[1]).toBe(0.8);
    // ...
    expect(s.lanes[0].automation[0].values[5]).toBe(0.9);
```

- [ ] **Step 2: Run the test to verify it fails (field still named `samples`)**

Run: `npx vitest run src/performance/arrangement-ops.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'length')` (curve has `samples`, not `values`).

- [ ] **Step 3: Rename the field and add flags in the model**

In `src/performance/performance.ts`, replace the `AutomationCurve` interface and add `lengthBars` to `ArrangementState`:

```ts
export interface AutomationCurve {
  paramId: string;
  /** Normalized 0..1 per sub-step at the arrangement's bpm. Length =
   *  ceil(effectiveDurationSec * stepsPerSec * AUTOMATION_SUB_RES). */
  values: number[];
  /** undefined/true = applied during playback; false = muted. */
  enabled?: boolean;
  /** snap-to-step while drawing (mirrors clip envelopes / global tab). */
  stepped?: boolean;
}

export interface ArrangementState {
  bpm: number;
  durationSec: number;
  /** User-set length in bars (toolbar). 0 = unset. Render/curve sizing use
   *  effectiveDurationSec = max(durationSec, lengthBars * barSec). */
  lengthBars: number;
  lanes: ArrangementLaneRec[];
  globalAutomation: AutomationCurve[];
}
```

And update `emptyArrangementState`:

```ts
export function emptyArrangementState(bpm: number): ArrangementState {
  return { bpm, durationSec: 0, lengthBars: 0, lanes: [], globalAutomation: [] };
}
```

- [ ] **Step 4: Rename `samples`→`values` in `arrangement-ops.ts`**

In `src/performance/arrangement-ops.ts`, update `getOrCreateCurve`, `writeAutomationSample`, `sampleAutomationAt`, `automationEndSec` (the local `holdExtend` param may keep its name; it now receives `curve.values`):

```ts
function getOrCreateCurve(list: AutomationCurve[], paramId: string): AutomationCurve {
  let c = list.find((x) => x.paramId === paramId);
  if (!c) {
    c = { paramId, values: [], enabled: true, stepped: false };
    list.push(c);
  }
  return c;
}

function holdExtend(values: number[], idx: number): void {
  if (idx < values.length) return;
  const last = values.length > 0 ? values[values.length - 1] : 0.5;
  while (values.length <= idx) values.push(last);
}

export function writeAutomationSample(
  s: ArrangementState, paramId: string, valueNorm: number,
  subIdx: number, laneIds: readonly string[],
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? getOrCreateLane(s, route.laneId).automation
    : s.globalAutomation;
  const curve = getOrCreateCurve(list, paramId);
  holdExtend(curve.values, subIdx);
  curve.values[subIdx] = valueNorm;
}

export function sampleAutomationAt(curve: AutomationCurve, subIdx: number): number {
  if (curve.values.length === 0) return 0.5;
  const i = Math.min(subIdx, curve.values.length - 1);
  return curve.values[i];
}

function automationEndSec(curve: AutomationCurve, bpm: number): number {
  return curve.values.length / (stepsPerSec(bpm) * AUTOMATION_SUB_RES);
}
```

- [ ] **Step 5: Rename `samples`→`values` in `performance-ui.ts:96`**

```ts
    const v = curve.values[Math.min(subIdx, curve.values.length - 1)] ?? 0.5;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/performance/arrangement-ops.test.ts` → Expected: PASS.
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/performance/performance.ts src/performance/arrangement-ops.ts src/performance/performance-ui.ts src/performance/arrangement-ops.test.ts
git commit -m "refactor(performance): AutomationCurve samples->values + enabled/stepped + arrangement lengthBars"
```

---

## Task 2: `effectiveDurationSec` + `setArrangementLengthBars` (resize curves on length change)

**Files:**
- Modify: `src/performance/arrangement-ops.ts`
- Test: `src/performance/arrangement-ops.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/performance/arrangement-ops.test.ts`:

```ts
import {
  effectiveDurationSec, setArrangementLengthBars,
} from './arrangement-ops';
import { emptyArrangementState } from './performance';
import { AUTOMATION_SUB_RES } from '../core/pattern';

describe('arrangement length', () => {
  it('effectiveDurationSec is max(durationSec, lengthBars*barSec)', () => {
    const s = emptyArrangementState(120);          // barSec = 2s at 120bpm
    s.durationSec = 3;
    s.lengthBars = 4;                               // 4 bars * 2s = 8s
    expect(effectiveDurationSec(s)).toBe(8);
    s.lengthBars = 1;                               // 2s < 3s recorded
    expect(effectiveDurationSec(s)).toBe(3);
  });

  it('setArrangementLengthBars grows curves by hold and truncates on shrink', () => {
    const s = emptyArrangementState(120);
    s.globalAutomation.push({ paramId: 'fx.reverb.wet', values: [0.2, 0.9], enabled: true });
    setArrangementLengthBars(s, 1);                 // 1 bar -> 16*SUB_RES samples
    const curve = s.globalAutomation[0];
    const expected = 1 * 16 * AUTOMATION_SUB_RES;
    expect(curve.values.length).toBe(expected);
    expect(curve.values[curve.values.length - 1]).toBe(0.9);   // held last value
    expect(s.lengthBars).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/performance/arrangement-ops.test.ts`
Expected: FAIL — `effectiveDurationSec`/`setArrangementLengthBars` are not exported.

- [ ] **Step 3: Implement in `arrangement-ops.ts`**

Add at the end of `src/performance/arrangement-ops.ts`:

```ts
/** Bars * seconds-per-bar at the arrangement bpm. */
function barSec(bpm: number): number { return (60 / bpm) * 4; }

/** Render/sizing length: the larger of the recorded duration and the
 *  user-set bar length. 0 only when nothing is recorded AND no length set. */
export function effectiveDurationSec(s: ArrangementState): number {
  return Math.max(s.durationSec, s.lengthBars * barSec(s.bpm));
}

/** Sub-step count for a given number of bars at AUTOMATION_SUB_RES. */
export function subStepsForBars(bars: number): number {
  return Math.max(0, Math.round(bars)) * 16 * AUTOMATION_SUB_RES;
}

function resizeCurve(curve: AutomationCurve, targetLen: number): void {
  if (targetLen <= 0) return;
  if (curve.values.length < targetLen) {
    const last = curve.values.length > 0 ? curve.values[curve.values.length - 1] : 0.5;
    while (curve.values.length < targetLen) curve.values.push(last);
  } else if (curve.values.length > targetLen) {
    curve.values.length = targetLen;
  }
}

/** Set the user length (bars) and resize every curve (lane + global) to the
 *  effective length, holding the last value when growing, truncating on shrink. */
export function setArrangementLengthBars(s: ArrangementState, bars: number): void {
  s.lengthBars = Math.max(0, Math.round(bars));
  const targetBars = Math.ceil(effectiveDurationSec(s) / barSec(s.bpm));
  const targetLen = subStepsForBars(targetBars);
  for (const lane of s.lanes) for (const c of lane.automation) resizeCurve(c, targetLen);
  for (const c of s.globalAutomation) resizeCurve(c, targetLen);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/performance/arrangement-ops.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-ops.ts src/performance/arrangement-ops.test.ts
git commit -m "feat(performance): arrangement length helpers (effectiveDurationSec, setArrangementLengthBars)"
```

---

## Task 3: `addAutomationCurve` / `removeAutomationCurve` (route by prefix, init to length)

**Files:**
- Modify: `src/performance/arrangement-ops.ts`
- Test: `src/performance/arrangement-ops.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/performance/arrangement-ops.test.ts`:

```ts
import { addAutomationCurve, removeAutomationCurve } from './arrangement-ops';

describe('addAutomationCurve', () => {
  const laneIds = ['tb-303-1', 'subtractive-1'];

  it('routes a lane-prefixed param into that lane and sizes to the arrangement', () => {
    const s = emptyArrangementState(120);
    s.lengthBars = 1;
    addAutomationCurve(s, 'tb-303-1.cutoff', laneIds);
    const lane = s.lanes.find((l) => l.laneId === 'tb-303-1')!;
    expect(lane.automation[0].paramId).toBe('tb-303-1.cutoff');
    expect(lane.automation[0].values.every((v) => v === 0.5)).toBe(true);
    expect(lane.automation[0].values.length).toBe(1 * 16 * AUTOMATION_SUB_RES);
  });

  it('routes a non-lane param into globalAutomation and is idempotent', () => {
    const s = emptyArrangementState(120);
    s.lengthBars = 1;
    addAutomationCurve(s, 'fx.reverb.wet', laneIds);
    addAutomationCurve(s, 'fx.reverb.wet', laneIds);   // no duplicate
    expect(s.globalAutomation.length).toBe(1);
  });

  it('removeAutomationCurve removes by paramId from the routed list', () => {
    const s = emptyArrangementState(120);
    s.lengthBars = 1;
    addAutomationCurve(s, 'fx.reverb.wet', laneIds);
    removeAutomationCurve(s, 'fx.reverb.wet', laneIds);
    expect(s.globalAutomation.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/performance/arrangement-ops.test.ts`
Expected: FAIL — `addAutomationCurve`/`removeAutomationCurve` not exported.

- [ ] **Step 3: Implement in `arrangement-ops.ts`**

Add at the end of `src/performance/arrangement-ops.ts`:

```ts
/** Create an empty (0.5-filled) automation curve for `paramId`, routed by
 *  prefix into its lane or globalAutomation. No-op if it already exists. */
export function addAutomationCurve(
  s: ArrangementState, paramId: string, laneIds: readonly string[],
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? getOrCreateLane(s, route.laneId).automation
    : s.globalAutomation;
  if (list.some((c) => c.paramId === paramId)) return;
  const targetBars = Math.max(1, Math.ceil(effectiveDurationSec(s) / barSec(s.bpm)));
  const len = subStepsForBars(targetBars);
  list.push({ paramId, values: Array.from({ length: len }, () => 0.5), enabled: true, stepped: false });
}

/** Remove the curve for `paramId` from its routed list. */
export function removeAutomationCurve(
  s: ArrangementState, paramId: string, laneIds: readonly string[],
): void {
  const route = routeParamId(paramId, laneIds);
  const list = route.kind === 'lane'
    ? s.lanes.find((l) => l.laneId === route.laneId)?.automation
    : s.globalAutomation;
  if (!list) return;
  const i = list.findIndex((c) => c.paramId === paramId);
  if (i >= 0) list.splice(i, 1);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/performance/arrangement-ops.test.ts` → Expected: PASS.
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-ops.ts src/performance/arrangement-ops.test.ts
git commit -m "feat(performance): add/remove automation curve helpers (prefix-routed)"
```

---

## Task 4: `tickArrangement` skips `enabled === false` curves

**Files:**
- Modify: `src/performance/arrangement-runtime.ts:82-91`
- Test: `src/performance/arrangement-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/performance/arrangement-runtime.test.ts` (match the file's existing import of `tickArrangement`, `createArrangementPlayState`, `startArrangement`):

```ts
describe('tickArrangement respects curve.enabled', () => {
  it('does not apply a disabled global automation curve', () => {
    const state = emptyArrangementState(120);
    state.durationSec = 4;
    state.globalAutomation.push({ paramId: 'fx.reverb.wet', values: [0.9, 0.9, 0.9, 0.9], enabled: false });
    const ps = createArrangementPlayState();
    startArrangement(ps, 0);
    const applied: string[] = [];
    tickArrangement({
      ps, state, nowCtx: 0.01, lookaheadSec: 0.1, bpm: 120,
      onLaunchClip: () => {}, onStopLane: () => {},
      applyAutomation: (id) => applied.push(id),
    });
    expect(applied).not.toContain('fx.reverb.wet');
  });
});
```

(Ensure `emptyArrangementState` is imported in that test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/performance/arrangement-runtime.test.ts`
Expected: FAIL — `applied` contains `'fx.reverb.wet'` (enabled not yet checked).

- [ ] **Step 3: Implement the guard**

In `src/performance/arrangement-runtime.ts`, change the automation loops to skip disabled curves:

```ts
  const subIdx = Math.floor(tNow * stepsPerSec(bpm) * AUTOMATION_SUB_RES);
  for (const lane of state.lanes) {
    if (isLaneOverridden(ps, lane.laneId)) continue;
    for (const curve of lane.automation) {
      if (curve.enabled === false) continue;
      applyAutomation(curve.paramId, sampleAutomationAt(curve, subIdx));
    }
  }
  for (const curve of state.globalAutomation) {
    if (curve.enabled === false) continue;
    applyAutomation(curve.paramId, sampleAutomationAt(curve, subIdx));
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/performance/arrangement-runtime.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/performance/arrangement-runtime.ts src/performance/arrangement-runtime.test.ts
git commit -m "feat(performance): tickArrangement skips disabled automation curves"
```

---

## Task 5: Save-load migration `samples`→`values` + flag defaults

**Files:**
- Modify: `src/save/saved-state-v3.ts` (inside `applyLoadedStateV3`, before `deps.setArrangement`)
- Test: `src/save/saved-state-v3.performance.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/save/saved-state-v3.performance.test.ts`:

```ts
import { migrateArrangementCurves } from './saved-state-v3';

describe('arrangement curve migration', () => {
  it('renames legacy samples->values and defaults flags', () => {
    const arr: any = {
      bpm: 120, durationSec: 4, lengthBars: 0,
      lanes: [{ laneId: 'tb-303-1', clipEvents: [], automation: [{ paramId: 'tb-303-1.cutoff', samples: [0.1, 0.2] }] }],
      globalAutomation: [{ paramId: 'fx.reverb.wet', samples: [0.3] }],
    };
    migrateArrangementCurves(arr);
    expect(arr.lanes[0].automation[0].values).toEqual([0.1, 0.2]);
    expect(arr.lanes[0].automation[0].samples).toBeUndefined();
    expect(arr.lanes[0].automation[0].enabled).toBe(true);
    expect(arr.globalAutomation[0].values).toEqual([0.3]);
    expect(arr.lengthBars).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/save/saved-state-v3.performance.test.ts`
Expected: FAIL — `migrateArrangementCurves` not exported.

- [ ] **Step 3: Implement and call the migration**

In `src/save/saved-state-v3.ts`, add the exported helper and call it before restoring the arrangement:

```ts
/** Older performance takes stored automation as `samples` with no flags.
 *  Normalize to the painter-compatible `{ values, enabled, stepped }` shape. */
export function migrateArrangementCurves(arr: ArrangementState): void {
  if (typeof (arr as { lengthBars?: number }).lengthBars !== 'number') {
    (arr as { lengthBars: number }).lengthBars = 0;
  }
  const fix = (c: { samples?: number[]; values?: number[]; enabled?: boolean; stepped?: boolean }) => {
    if (!c.values && Array.isArray(c.samples)) { c.values = c.samples; delete c.samples; }
    if (!c.values) c.values = [];
    if (c.enabled === undefined) c.enabled = true;
    if (c.stepped === undefined) c.stepped = false;
  };
  for (const lane of arr.lanes ?? []) for (const c of lane.automation ?? []) fix(c);
  for (const c of arr.globalAutomation ?? []) fix(c);
}
```

Then inside `applyLoadedStateV3`, change the restore block:

```ts
  if (s.arrangement && deps.setArrangement) {
    migrateArrangementCurves(s.arrangement);
    deps.setArrangement(s.arrangement);
  }
  if (s.mode && deps.setMode) deps.setMode(s.mode);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/save/saved-state-v3.performance.test.ts` → Expected: PASS.
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/save/saved-state-v3.ts src/save/saved-state-v3.performance.test.ts
git commit -m "feat(save): migrate legacy arrangement automation samples->values on load"
```

---

## Task 6: New module `performance-automation-ui.ts` (param picker, +/-, editable lane)

This module builds the editable automation lanes and the param picker, reusing `automation-painter`. It is consumed by `performance-ui.ts` (Task 7).

**Files:**
- Create: `src/performance/performance-automation-ui.ts`
- Test: `src/performance/performance-automation-ui.test.ts`

- [ ] **Step 1: Write the failing test (pure helper only — DOM bits are covered by e2e)**

Create `src/performance/performance-automation-ui.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupParamsByPrefix } from './performance-automation-ui';

describe('groupParamsByPrefix', () => {
  it('groups param ids by their dotted prefix in registry order', () => {
    const ids = ['tb-303-1.cutoff', 'tb-303-1.reso', 'fx.reverb.wet', 'mix.bass.vol'];
    const groups = groupParamsByPrefix(ids);
    expect(groups.get('tb-303-1')).toEqual(['tb-303-1.cutoff', 'tb-303-1.reso']);
    expect(groups.get('fx')).toEqual(['fx.reverb.wet']);
    expect(groups.get('mix')).toEqual(['mix.bass.vol']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/performance/performance-automation-ui.test.ts`
Expected: FAIL — module/`groupParamsByPrefix` not found.

- [ ] **Step 3: Implement the module**

Create `src/performance/performance-automation-ui.ts`:

```ts
// Editable automation lanes for Performance view. Reuses automation-painter
// (drawLane/attachLanePainter). Pure-render: callers pass the arrangement +
// callbacks; we never touch the audio graph here.
import type { KnobHandle } from '../core/knob';
import type { AutomationCurve } from './performance';
import { drawLane, attachLanePainter, formatNum, type AutoBrush } from '../automation/automation-painter';

/** Group dotted param ids by their first segment, preserving insertion order. */
export function groupParamsByPrefix(ids: Iterable<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const prefix = id.split('.')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(id);
  }
  return groups;
}

export interface PerfAutoDeps {
  registry: Map<string, KnobHandle>;
  /** Width in px for a full-arrangement canvas at the current zoom. */
  laneWidthPx: number;
  getBrush: () => AutoBrush;
  /** Painter deps: a single global playhead is used, so isPlaying() stays the
   *  master seq (false during arrangement play) and sub-index is 0. */
  painterDeps: { seq: { isPlaying: () => boolean }; getAutoAbsSubIdx: () => number };
  onAdd: (paramId: string) => void;
  onRemove: (paramId: string) => void;
  onEdited: () => void;   // called after a draw/flag change so the host can snapshot for undo
}

/** Build the "+ Automation" header (grouped param select + add button). */
export function buildAutomationHeader(deps: PerfAutoDeps): HTMLElement {
  const header = document.createElement('div');
  header.className = 'perf-auto-header';
  const sel = document.createElement('select');
  sel.className = 'perf-auto-param-select';
  for (const [prefix, ids] of groupParamsByPrefix(deps.registry.keys())) {
    const og = document.createElement('optgroup');
    og.label = prefix;
    for (const id of ids) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${id} — ${deps.registry.get(id)?.meta.label ?? ''}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'rnd primary';
  addBtn.textContent = '+ Automation';
  addBtn.addEventListener('click', () => { if (sel.value) deps.onAdd(sel.value); });
  header.append(sel, addBtn);
  return header;
}

/** Build one editable lane for a curve. Mutates curve.values via the painter. */
export function buildAutomationLane(curve: AutomationCurve, deps: PerfAutoDeps): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'perf-auto-lane';
  const entry = deps.registry.get(curve.paramId);

  const hdr = document.createElement('div');
  hdr.className = 'perf-auto-lane-header';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${curve.paramId}${entry ? '' : ' (no disponible)'}`;
  if (!entry) wrap.classList.add('missing');

  const enableBtn = document.createElement('button');
  enableBtn.className = 'enable' + (curve.enabled !== false ? ' active' : '');
  enableBtn.textContent = curve.enabled !== false ? 'On' : 'Off';
  enableBtn.addEventListener('click', () => {
    curve.enabled = curve.enabled === false ? true : false;
    enableBtn.classList.toggle('active', curve.enabled);
    enableBtn.textContent = curve.enabled ? 'On' : 'Off';
    draw(); deps.onEdited();
  });

  const stepBtn = document.createElement('button');
  stepBtn.className = 'stepped' + (curve.stepped ? ' active' : '');
  stepBtn.textContent = curve.stepped ? 'Stepped' : 'Smooth';
  stepBtn.addEventListener('click', () => {
    curve.stepped = !curve.stepped;
    stepBtn.classList.toggle('active', !!curve.stepped);
    stepBtn.textContent = curve.stepped ? 'Stepped' : 'Smooth';
    draw(); deps.onEdited();
  });

  const range = document.createElement('span');
  range.className = 'perf-auto-range';
  if (entry) range.textContent = `[${formatNum(entry.meta.min)} .. ${formatNum(entry.meta.max)}]`;

  const rm = document.createElement('button');
  rm.className = 'rnd';
  rm.textContent = '×';
  rm.title = 'Quitar lane';
  rm.addEventListener('click', () => deps.onRemove(curve.paramId));

  hdr.append(label, enableBtn, stepBtn, range, rm);
  wrap.appendChild(hdr);

  const canvas = document.createElement('canvas');
  canvas.className = 'perf-auto-canvas';
  canvas.width = Math.max(120, Math.round(deps.laneWidthPx));
  canvas.height = 64;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = '64px';
  wrap.appendChild(canvas);

  // The painter mutates curve.values in place; AutomationCurve already matches
  // its {values, enabled, stepped} shape.
  const laneView = curve as { values: number[]; enabled: boolean; stepped?: boolean };
  const draw = () => drawLane(canvas, { ...laneView, enabled: curve.enabled !== false }, deps.painterDeps);
  draw();
  attachLanePainter(canvas, laneView, () => { draw(); }, deps.getBrush);
  canvas.addEventListener('pointerup', () => deps.onEdited());

  return wrap;
}
```

- [ ] **Step 4: Run to verify the helper test passes**

Run: `npx vitest run src/performance/performance-automation-ui.test.ts` → Expected: PASS.
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/performance/performance-automation-ui.ts src/performance/performance-automation-ui.test.ts
git commit -m "feat(performance): editable automation lane module (picker + painter, reuses automation-painter)"
```

---

## Task 7: Toolbar (Length + zoom) and zoom-aware render in `performance-ui.ts`

Rewrite `performance-ui.ts` so the render takes a UI-state object (`pxPerBar`, callbacks for length/zoom/add/remove/edit), threads `pxPerBar` through ruler/clips/automation, and renders **editable** automation lanes via Task 6.

**Files:**
- Modify: `src/performance/performance-ui.ts`

- [ ] **Step 1: Extend `PerfUICallbacks` and thread `pxPerBar`**

Add imports at the top of `performance-ui.ts`:

```ts
import type { KnobHandle } from '../core/knob';
import type { AutoBrush } from '../automation/automation-painter';
```

Replace the `PerfUICallbacks` interface so the host passes UI state:

```ts
export interface PerfUICallbacks {
  onPlay: () => void;
  onStop: () => void;
  onGoToSession: () => void;
  resolveClipColor: (clipId: string) => string;
  resolveClipName: (clipId: string) => string;
  // NEW:
  registry: Map<string, KnobHandle>;
  laneIds: readonly string[];
  pxPerBar: number;
  getBrush: () => AutoBrush;
  setBrush: (b: AutoBrush) => void;
  painterDeps: { seq: { isPlaying: () => boolean }; getAutoAbsSubIdx: () => number };
  onSetLengthBars: (bars: number) => void;
  onZoom: (pxPerBar: number) => void;
  onAddCurve: (paramId: string) => void;
  onRemoveCurve: (paramId: string) => void;
  onEdited: () => void;
}
```

- [ ] **Step 2: Replace `PX_PER_BAR` constant usage with a parameter**

Change `makeRuler`, `makeClipBand` to take `pxPerBar` (replace the `const PX_PER_BAR = 80;` references). Use `effectiveDurationSec(state)` for `durationSec` everywhere in the render. Import:

```ts
import { effectiveDurationSec } from './arrangement-ops';
import { buildAutomationHeader, buildAutomationLane } from './performance-automation-ui';
```

- [ ] **Step 3: Add the toolbar builder**

Add to `performance-ui.ts`:

```ts
function makeToolbar(state: ArrangementState, cb: PerfUICallbacks): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'perf-toolbar';
  const lenWrap = document.createElement('label');
  lenWrap.className = 'perf-length';
  lenWrap.textContent = 'Length: ';
  const len = document.createElement('input');
  len.type = 'number'; len.min = '1'; len.value = String(state.lengthBars || 0);
  len.className = 'perf-length-input';
  len.addEventListener('change', () => cb.onSetLengthBars(parseInt(len.value, 10) || 0));
  lenWrap.append(len, document.createTextNode(' bars'));

  const zoom = document.createElement('input');
  zoom.type = 'range'; zoom.min = '16'; zoom.max = '400'; zoom.step = '1';
  zoom.value = String(cb.pxPerBar);
  zoom.className = 'perf-zoom';
  zoom.addEventListener('input', () => cb.onZoom(parseInt(zoom.value, 10)));

  const bars = Math.ceil(effectiveDurationSec(state) / ((60 / state.bpm) * 4));
  const readout = document.createElement('span');
  readout.className = 'perf-readout';
  readout.textContent = `${bars} bars · ${state.bpm} BPM`;

  bar.append(lenWrap, document.createTextNode(' · Zoom '), zoom, document.createTextNode(' · '), readout);
  return bar;
}
```

- [ ] **Step 4: Rewrite `renderPerformanceView`**

```ts
export function renderPerformanceView(host: HTMLElement, state: ArrangementState, cb: PerfUICallbacks): void {
  host.innerHTML = '';
  host.classList.add('performance-view');

  host.appendChild(makeToolbar(state, cb));
  const dur = effectiveDurationSec(state);

  if (dur === 0) {
    const empty = document.createElement('div');
    empty.className = 'perf-empty';
    empty.innerHTML = `
      <p>Sin grabación. Fija una <b>longitud</b> arriba para empezar a dibujar automatización,</p>
      <p>o arma <b>REC</b>, vuelve a Session, lanza clips y mueve knobs.</p>
      <button class="perf-empty-back">Volver a Session</button>`;
    empty.querySelector('.perf-empty-back')!.addEventListener('click', cb.onGoToSession);
    host.appendChild(empty);
    return;
  }

  // Wheel-zoom (Ctrl) around the cursor; the scroll container is `host`.
  attachWheelZoom(host, cb);

  host.appendChild(makeRuler(dur, state.bpm, cb.pxPerBar));

  const totalBars = Math.ceil(dur / ((60 / state.bpm) * 4));
  const laneWidthPx = totalBars * cb.pxPerBar;
  const autoDeps = {
    registry: cb.registry, laneWidthPx, getBrush: cb.getBrush,
    painterDeps: cb.painterDeps, onAdd: cb.onAddCurve, onRemove: cb.onRemoveCurve, onEdited: cb.onEdited,
  };

  for (const lane of state.lanes) {
    host.appendChild(makeClipBand(lane, dur, state.bpm, cb.pxPerBar, cb.resolveClipColor, cb.resolveClipName));
    for (const curve of lane.automation) host.appendChild(buildAutomationLane(curve, autoDeps));
    host.appendChild(buildAutomationHeader(autoDeps));
  }

  const masterLabel = document.createElement('div');
  masterLabel.className = 'perf-row perf-master-header';
  masterLabel.appendChild(makeLabel('MASTER'));
  host.appendChild(masterLabel);
  for (const curve of state.globalAutomation) host.appendChild(buildAutomationLane(curve, autoDeps));
  host.appendChild(buildAutomationHeader(autoDeps));

  const playhead = document.createElement('div');
  playhead.className = 'perf-playhead';
  playhead.id = 'perf-playhead';
  host.appendChild(playhead);
}

function attachWheelZoom(host: HTMLElement, cb: PerfUICallbacks): void {
  host.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(16, Math.min(400, cb.pxPerBar * factor));
    cb.onZoom(Math.round(next));
  }, { passive: false });
}
```

Update `makeRuler`/`makeClipBand` signatures to accept `pxPerBar` and use it instead of the removed constant. Keep `makeLabel` as-is.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `performance-feature.ts` (the caller hasn't been updated to pass the new callbacks yet — fixed in Task 8). `performance-ui.ts` itself compiles.

- [ ] **Step 6: Commit**

```bash
git add src/performance/performance-ui.ts
git commit -m "feat(performance): toolbar (Length + zoom) and editable, zoom-aware automation lanes"
```

---

## Task 8: Wire the UI state into `performance-feature.ts`

**Files:**
- Modify: `src/app/performance-feature.ts`

- [ ] **Step 1: Add UI state + imports**

At the top imports add:

```ts
import { setArrangementLengthBars, addAutomationCurve, removeAutomationCurve } from '../performance/arrangement-ops';
import type { AutoBrush } from '../automation/automation-painter';
```

Inside `createPerformanceFeature`, after `let mode`, add:

```ts
  let pxPerBar = 80;
  let brush: AutoBrush = 'line';
  const laneIds = () => sessionHost.state.lanes.map((l) => l.id);
```

- [ ] **Step 2: Add an undo snapshot hook**

`performance-feature` does not currently own historyDeps. Add an optional callback to `PerformanceFeatureDeps`:

```ts
  /** Optional: snapshot current state for undo after a performance edit. */
  onPerformanceEdited?: () => void;
```

and read it: `const { ..., onPerformanceEdited } = deps;` Use `onPerformanceEdited?.()` as the `onEdited` callback. (Wiring the actual historyDeps is done in `main.ts` where it is available; passing `undefined` keeps edits working without undo.)

- [ ] **Step 3: Rewrite `refreshPerformanceView` to pass the new callbacks**

```ts
  function refreshPerformanceView() {
    const host = document.getElementById('performance-view-root');
    if (!host) return;
    const findClip = (id: string) => {
      for (const lane of sessionHost.state.lanes)
        for (const c of lane.clips) if (c?.id === id) return c;
      return null;
    };
    renderPerformanceView(host, arrangement, {
      onPlay: () => startArrangement(arrangementPlayState, ctx.currentTime),
      onStop: () => stopArrangement(arrangementPlayState),
      onGoToSession: () => setMode('session'),
      resolveClipColor: (id) => findClip(id)?.color ?? '',
      resolveClipName: (id) => findClip(id)?.name ?? findClip(id)?.id ?? 'missing',
      registry: automationRegistry,
      laneIds: laneIds(),
      pxPerBar,
      getBrush: () => brush,
      setBrush: (b) => { brush = b; },
      painterDeps: { seq: { isPlaying: () => seq.isPlaying() }, getAutoAbsSubIdx: () => 0 },
      onSetLengthBars: (bars) => { setArrangementLengthBars(arrangement, bars); onPerformanceEdited?.(); refreshPerformanceView(); },
      onZoom: (px) => { pxPerBar = px; refreshPerformanceView(); },
      onAddCurve: (paramId) => { addAutomationCurve(arrangement, paramId, laneIds()); onPerformanceEdited?.(); refreshPerformanceView(); },
      onRemoveCurve: (paramId) => { removeAutomationCurve(arrangement, paramId, laneIds()); onPerformanceEdited?.(); refreshPerformanceView(); },
      onEdited: () => { onPerformanceEdited?.(); },
    });
  }
```

- [ ] **Step 4: Make the rAF playhead use the live `pxPerBar`**

In `rafPlayhead`, replace the local `const PX_PER_BAR = 80;` with the closure `pxPerBar`:

```ts
        el.style.left = `${90 + bars * pxPerBar}px`;
```

(remove the now-unused `const PX_PER_BAR = 80;`).

- [ ] **Step 5: Typecheck + run the performance unit suite**

Run: `npx tsc --noEmit` → Expected: no errors.
Run: `npx vitest run src/performance/` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/performance-feature.ts
git commit -m "feat(performance): wire toolbar/zoom/add-remove/edit callbacks into the feature"
```

---

## Task 9: Styles for the toolbar + editable lanes

**Files:**
- Modify: `src/styles/_performance-view.scss`

- [ ] **Step 1: Append styles**

Add to `src/styles/_performance-view.scss` (match existing `.perf-*` colors; values are illustrative — adjust to the file's palette):

```scss
.performance-view { overflow-x: auto; }

.perf-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-bottom: 1px solid #222; font-size: 12px; color: #ccc;
  .perf-length-input { width: 56px; }
  .perf-zoom { width: 160px; }
  .perf-readout { color: #888; }
}

.perf-auto-header {
  display: flex; gap: 6px; align-items: center; padding: 4px 0 4px 90px;
  .perf-auto-param-select { max-width: 240px; }
}

.perf-auto-lane {
  display: flex; flex-direction: column; padding-left: 90px;
  &.missing { opacity: 0.5; }
  .perf-auto-lane-header {
    display: flex; gap: 6px; align-items: center; font-size: 11px; color: #aaa;
    button.enable.active, button.stepped.active { color: #f4c8a8; }
    .perf-auto-range { color: #666; }
  }
  .perf-auto-canvas { display: block; cursor: crosshair; }
}
```

- [ ] **Step 2: Build to verify SCSS compiles**

Run: `npm run build`
Expected: build succeeds (tsc + vite bundle), no SCSS errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/_performance-view.scss
git commit -m "style(performance): toolbar + editable automation lane styles"
```

---

## Task 10: e2e round-trip (Length → +Automation → draw → play)

**Files:**
- Modify: `tests/e2e/performance-view.spec.ts`

- [ ] **Step 1: Build first (e2e serves `dist/`)**

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Add the test**

Append to `tests/e2e/performance-view.spec.ts`:

```ts
test('set length → add an automation lane → draw → it persists', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('[data-mode="performance"]').click();

  // Leave empty-state by setting a length.
  const len = page.locator('.perf-length-input');
  await len.fill('4');
  await len.dispatchEvent('change');

  // Toolbar + ruler now present; pick a param and add a lane.
  await expect(page.locator('.perf-toolbar')).toBeVisible();
  const sel = page.locator('.perf-auto-param-select').first();
  await sel.selectOption({ index: 0 });
  await page.locator('.perf-auto-header .rnd.primary').first().click();

  // An editable lane canvas should exist; draw on it.
  const canvas = page.locator('.perf-auto-canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
  await page.mouse.up();

  // The lane survives a re-render (toggle zoom).
  await page.locator('.perf-zoom').fill('120');
  await expect(page.locator('.perf-auto-canvas').first()).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS (all existing + the new test). If a selector misses, inspect with `npm run test:e2e:headed`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/performance-view.spec.ts
git commit -m "test(e2e): performance automation lane create+draw round-trip"
```

---

## Task 11: Full suite + manual smoke

- [ ] **Step 1: Full unit suite**

Run: `npm run test:unit`
Expected: PASS (re-run once if the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown appears — see CLAUDE.md gotchas).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build` → Expected: clean.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, open `http://localhost:5173`:
- Switch to Performance. Set Length: 8. Confirm ruler appears (no empty-state).
- Add an automation lane for `tb-303-1.cutoff` (or any lane param) and one global (`fx.reverb.wet`). Draw both.
- Ctrl+wheel over the timeline: clips + automation zoom together, cursor bar stays put.
- Press Play (Performance transport): the drawn cutoff curve audibly sweeps; global playhead moves.
- Toggle a lane Off → it stops affecting playback. Save, reload (autosave/recovery) → lanes + drawings restored.

- [ ] **Step 4: Final commit (if any smoke fixes)**

```bash
git add -A
git commit -m "fix(performance): smoke-test adjustments for automation lanes"
```

---

## Self-Review notes (author)

- **Spec coverage:** Length toolbar (T7/T8), create lanes routed by prefix (T3/T6), editable lanes via painter (T6/T7), continuous whole-timeline zoom (T7 wheel + slider), `enabled` in playback (T4), `samples`→`values`+flags (T1), save migration (T5), tests incl. DSP already exist for `arrangement.dsp.test.ts` (the drawn-curve audible test can be added there if deeper coverage is wanted; e2e T10 covers the authoring round-trip). Edge cases (param-missing → `.missing` lane; length resize hold/truncate T2) covered.
- **DSP test (optional deepening):** if desired, add to `src/performance/arrangement.dsp.test.ts` a case that pushes a ramp curve on a filter-cutoff param and asserts spectral/energy change vs a flat curve — relative assertion per repo convention.
- **No placeholders:** all steps carry concrete code/commands.
- **Type consistency:** `AutomationCurve.values`, `enabled?`, `stepped?`; `ArrangementState.lengthBars`; `effectiveDurationSec`/`setArrangementLengthBars`/`addAutomationCurve`/`removeAutomationCurve`/`subStepsForBars` used consistently across tasks; `PerfUICallbacks` fields match `performance-feature` wiring.

## Spec 2 handoff
Once shipped, the global Classic "Automation" tab is superseded → its removal (with all of `seq.pattern`) is the separate Spec 2, gated on this. See memory `project_classic_pattern_removal_deferred`.
