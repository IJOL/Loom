# Curve & Drift Modulators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drawable point/segment curve control in the host control catalogue, a `curve` plugin with two modulator components (cyclic Curve LFO + per-note Curve Env) using it, and a `drift` plugin (smoothed-random / Lorenz motion) with no custom UI.

**Architecture:** The curve control is a host control (`src/core/controls/`, pure DOM+SVG, mounted once and kept alive across repaints) exposed to plugins through `Loom.controls` — an ABI addition to the SDK's `LoomApi` type. Both `curve` components share one `evalCurve` in the plugin's own `dsp.ts` and register kernels via `Loom.registerModulatorKernel`; the per-note envelope is a `driver:'time'` kernel with scope `per-voice` (the runtime hands it its voice's start as `origin`), NOT a gate-road change. `drift` is a kernel-only plugin rendered by the generic param grid.

**Tech Stack:** TypeScript, Vitest (jsdom for the control test), the plugin CLI (`npm run plugin -- new/build`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-curve-drift-modulators-design.md`

## Global Constraints

- Work in a git worktree at `.claude/worktrees/curve-drift` on branch `feat/curve-drift` (create with `git worktree add`, run `npm install` inside; NEVER junction node_modules).
- Commit messages in ENGLISH only, via bash heredoc, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Rebase onto `main` after (almost) every commit: `git rebase main`.
- TDD: the failing test is written and SEEN failing before implementation.
- Single-file test runs: `NO_COLOR=1 npx vitest run <path>`.
- **`npm run build:plugins` after every `plugins/*` edit** — the app loads `public/plugins/`, not `plugins/`. A stale build looks like a broken plugin.
- File size: target 300 code lines (comments/blanks excluded), hard cap 500.
- DSP assertions are RELATIVE (ratios), never absolute magnitudes; justify any absolute threshold in a comment.
- Kernels are pure and deterministic: no `Math.random` at render time; `valueAt` is arithmetic over `(t - origin)`.
- UI "done" claims require a browser look (Task 6).

---

### Task 1: `curve` plugin scaffold + `evalCurve` + Curve LFO kernel

**Files:**
- Create: `plugins/curve/plugin.json`
- Create: `plugins/curve/dsp.ts`
- Test: `plugins/curve/dsp.test.ts`

**Interfaces:**
- Consumes: `Loom.registerModulatorKernel({ id, valueAt(m, t, origin) })` (worklet global, same shape as `plugins/stepseq/dsp.ts`); `m.params` is the modulator's numeric bag.
- Produces: `evalCurve(params: Record<string, number> | undefined, x: number): number` (exported from `dsp.ts`, 0..1 in → 0..1 out, reads `pts`/`p{i}x`/`p{i}y`/`p{i}c` from the bag) and the registered kernel id `curve-lfo` (params `rate` Hz, `bipolar` 0/1). Task 2 reuses `evalCurve`; Task 4 writes the same bag keys.

- [ ] **Step 1: Scaffold the plugin**

```bash
cd .claude/worktrees/curve-drift && npm run plugin -- new plugins/curve
```

Then replace `plugins/curve/plugin.json` entirely with:

```json
{
  "id": "curve",
  "name": "Curve",
  "version": "1.0.0",
  "loomApi": 1,
  "author": "Loom",
  "dsp": "dsp.js",
  "main": "main.js",
  "components": [
    {
      "kind": "modulator",
      "id": "curve-lfo",
      "name": "Curve LFO",
      "params": [
        { "id": "rate",    "label": "Rate", "kind": "continuous", "min": 0.05, "max": 32, "default": 1, "unit": "Hz" },
        { "id": "bipolar", "label": "Polarity", "kind": "discrete", "min": 0, "max": 1, "default": 0,
          "options": [{ "value": "unipolar", "label": "Unipolar" }, { "value": "bipolar", "label": "Bipolar" }] }
      ],
      "modulator": { "driver": "time", "scopes": ["shared", "per-voice"], "idPrefix": "crv" }
    },
    {
      "kind": "modulator",
      "id": "curve-env",
      "name": "Curve Env",
      "params": [
        { "id": "duration", "label": "Time", "kind": "continuous", "min": 0.02, "max": 20, "default": 1, "unit": "s", "scale": "log" },
        { "id": "mode", "label": "Mode", "kind": "discrete", "min": 0, "max": 1, "default": 0,
          "options": [{ "value": "oneshot", "label": "One-shot" }, { "value": "loop", "label": "Loop" }] }
      ],
      "modulator": { "driver": "time", "scopes": ["per-voice"], "idPrefix": "cenv" }
    }
  ]
}
```

Delete any scaffolded `main.ts` content down to `export {};` (Task 4 fills it); leave the scaffold's build wiring untouched. If the scaffold generated engine-shaped files, remove them — this plugin is modulators only.

Note: if `manifest-validate` rejects TWO modulator components in one plugin or the `"scale": "log"` param field, that is new information — stop and report rather than working around it (both are believed supported; the stepseq/sh manifests are the precedent for one component).

- [ ] **Step 2: Write the failing tests for `evalCurve` + the LFO kernel**

`plugins/curve/dsp.test.ts`:

```ts
// plugins/curve/dsp.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';

// dsp.ts registers through the worklet-side global; capture the kernel.
type Kernel = { id: string; valueAt(m: unknown, t: number, origin: number): number };
const kernels = new Map<string, Kernel>();
beforeAll(async () => {
  (globalThis as Record<string, unknown>).Loom = {
    registerModulatorKernel: (k: Kernel) => kernels.set(k.id, k),
  };
  await import('./dsp');
});

/** Bag for a 2-point ramp (0,1)->(1,0), curvature c on the first point. */
const ramp = (c = 0): Record<string, number> => ({
  pts: 2, p0x: 0, p0y: 1, p0c: c, p1x: 1, p1y: 0, p1c: 0,
});

describe('evalCurve', () => {
  it('interpolates linearly when curvature is 0', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(ramp(0), 0)).toBeCloseTo(1, 5);
    expect(evalCurve(ramp(0), 0.25)).toBeCloseTo(0.75, 5);
    expect(evalCurve(ramp(0), 1)).toBeCloseTo(0, 5);
  });

  it('positive curvature bows toward the start (ease-in): stays above the line', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(ramp(1), 0.25)).toBeGreaterThan(evalCurve(ramp(0), 0.25));
  });

  it('negative curvature bows the other way: below the line', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(ramp(-1), 0.25)).toBeLessThan(evalCurve(ramp(0), 0.25));
  });

  it('a missing bag falls back to the seed ramp, never throws', async () => {
    const { evalCurve } = await import('./dsp');
    expect(evalCurve(undefined, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('curve-lfo kernel', () => {
  const m = (extra: Record<string, number>) => ({ id: 'crv1', kind: 'curve-lfo', enabled: true, params: { ...ramp(0), ...extra } });

  it('walks the curve at rate and wraps: one full cycle returns to the start', () => {
    const k = kernels.get('curve-lfo')!;
    const at = (t: number) => k.valueAt(m({ rate: 2 }), t, 0); // 2 Hz -> period 0.5s
    expect(at(0)).toBeCloseTo(1, 5);
    expect(at(0.25)).toBeCloseTo(0.5, 5);   // half cycle on the down-ramp
    expect(at(0.5)).toBeCloseTo(at(0), 5);  // wrapped
  });

  it('bipolar maps 0..1 onto -1..+1', () => {
    const k = kernels.get('curve-lfo')!;
    expect(k.valueAt(m({ rate: 1, bipolar: 1 }), 0, 0)).toBeCloseTo(1, 5);
    expect(k.valueAt(m({ rate: 1, bipolar: 1 }), 0.5, 0)).toBeCloseTo(-1 + 1, 5); // midpoint 0.5 -> 0
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
NO_COLOR=1 npx vitest run plugins/curve/dsp.test.ts
```

Expected: FAIL — `evalCurve` not exported / kernel `curve-lfo` not registered.

- [ ] **Step 4: Implement `plugins/curve/dsp.ts`**

```ts
// plugins/curve/dsp.ts
// One evaluator, two kernels. The curve is stored in the modulator's numeric
// bag as pts + p{i}x/p{i}y/p{i}c; c bends the segment LEAVING point i
// (0 linear, +1 ease-in, -1 ease-out) via a power curve — the same function
// the editor uses to draw, so what you see is what plays.

const MAX_PTS = 16;

/** The first-mount seed: a plain descending ramp. Also the fallback when the
 *  bag has no curve yet — audible from the first connection. */
const SEED = { pts: 2, p0x: 0, p0y: 1, p0c: 0, p1x: 1, p1y: 0, p1c: 0 };

const shape = (u: number, c: number): number =>
  c === 0 ? u : Math.pow(u, Math.pow(4, c));

export function evalCurve(p: Record<string, number> | undefined, x: number): number {
  const bag = p !== undefined && (p.pts ?? 0) >= 2 ? p : SEED;
  const n = Math.max(2, Math.min(MAX_PTS, Math.round(bag.pts ?? 2)));
  const cx = Math.max(0, Math.min(1, x));
  // Points are stored sorted by x (the editor guarantees it); walk segments.
  for (let i = 0; i < n - 1; i++) {
    const x0 = bag[`p${i}x`] ?? 0, x1 = bag[`p${i + 1}x`] ?? 1;
    if (cx <= x1 || i === n - 2) {
      const y0 = bag[`p${i}y`] ?? 0, y1 = bag[`p${i + 1}y`] ?? 0;
      const c = Math.max(-1, Math.min(1, bag[`p${i}c`] ?? 0));
      const w = x1 - x0;
      const u = w <= 0 ? 1 : Math.max(0, Math.min(1, (cx - x0) / w));
      return y0 + (y1 - y0) * shape(u, c);
    }
  }
  return bag[`p${n - 1}y`] ?? 0;
}

Loom.registerModulatorKernel({
  id: 'curve-lfo',
  valueAt(m, t, origin) {
    const p = m.params;
    const rate = p?.rate ?? 1;
    const dt = t - origin;
    const phase = dt <= 0 ? 0 : dt * rate - Math.floor(dt * rate);
    const v = evalCurve(p, phase);
    return (p?.bipolar ?? 0) !== 0 ? v * 2 - 1 : v;
  },
});

// A module, not a global script — same reason as stepseq's dsp.ts.
export {};
```

- [ ] **Step 5: Run tests, then build the plugin**

```bash
NO_COLOR=1 npx vitest run plugins/curve/dsp.test.ts
npm run build:plugins
```

Expected: PASS, and `public/plugins/index.json` now lists `curve`.

- [ ] **Step 6: Commit**

```bash
git add plugins/curve public/plugins && git commit -m "$(cat <<'EOF'
feat(curve): curve plugin — evalCurve + Curve LFO kernel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)" && git rebase main
```

---

### Task 2: Curve Env kernel (per-note, one-shot / loop)

**Files:**
- Modify: `plugins/curve/dsp.ts` (append second kernel)
- Test: `plugins/curve/dsp.test.ts` (append describe)

**Interfaces:**
- Consumes: `evalCurve` from Task 1; the runtime's contract that a `per-voice` scoped `driver:'time'` kernel receives that voice's start as `origin`.
- Produces: registered kernel id `curve-env` (params `duration` s, `mode` 0=one-shot / 1=loop).

- [ ] **Step 1: Write the failing tests** (append to `plugins/curve/dsp.test.ts`)

```ts
describe('curve-env kernel', () => {
  const m = (extra: Record<string, number>) => ({ id: 'cenv1', kind: 'curve-env', enabled: true, params: { ...ramp(0), ...extra } });

  it('one-shot: runs the curve over duration, then holds the final value', () => {
    const k = kernels.get('curve-env')!;
    const at = (t: number) => k.valueAt(m({ duration: 2, mode: 0 }), t, 1); // voice started at t=1
    expect(at(1)).toBeCloseTo(1, 5);       // start of the note = start of curve
    expect(at(2)).toBeCloseTo(0.5, 5);     // halfway through 2s
    expect(at(5)).toBeCloseTo(at(3.0), 5); // past the end: clamped at final y
    expect(at(5)).toBeCloseTo(0, 5);
  });

  it('loop: wraps while the voice sounds', () => {
    const k = kernels.get('curve-env')!;
    const at = (t: number) => k.valueAt(m({ duration: 2, mode: 1 }), t, 1);
    expect(at(4)).toBeCloseTo(at(2), 5);   // one full period later, same value
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `NO_COLOR=1 npx vitest run plugins/curve/dsp.test.ts` → `curve-env` not registered.

- [ ] **Step 3: Implement** (append to `plugins/curve/dsp.ts`, before `export {}`)

```ts
Loom.registerModulatorKernel({
  id: 'curve-env',
  valueAt(m, t, origin) {
    const p = m.params;
    const dur = Math.max(0.02, p?.duration ?? 1);
    const raw = (t - origin) / dur;
    const pos = (p?.mode ?? 0) !== 0
      ? raw - Math.floor(raw)               // loop while the voice sounds
      : Math.max(0, Math.min(1, raw));      // one-shot: clamp at the final y
    return evalCurve(p, pos);
  },
});
```

- [ ] **Step 4: Run tests + rebuild** — `NO_COLOR=1 npx vitest run plugins/curve/dsp.test.ts && npm run build:plugins` → PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/curve public/plugins && git commit -m "$(cat <<'EOF'
feat(curve): Curve Env kernel — per-note one-shot/loop over the drawn curve

A driver:'time' kernel scoped per-voice IS a per-note envelope: the
runtime hands it its voice's start as origin. The gate road (ModEnvHost)
stays untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)" && git rebase main
```

---

### Task 3: the curve control (host, pure DOM+SVG)

**Files:**
- Create: `src/core/controls/curve-control.ts`
- Test: `src/core/controls/curve-control.test.ts`

**Interfaces:**
- Consumes: nothing beyond DOM.
- Produces: `createCurveControl(opts: CurveControlOpts): CurveControlHandle` where

```ts
export interface CurvePoint { x: number; y: number; c: number }   // all 0..1, c -1..+1
export interface CurveControlOpts {
  points: CurvePoint[];
  onChange(points: CurvePoint[]): void;
  label: string;
  grid?: { x: number; y: number };
}
export interface CurveControlHandle { el: HTMLElement; set(points: CurvePoint[]): void }
```

Task 4 exposes this as `Loom.controls.curve` and consumes the handle shape.

- [ ] **Step 1: Write the failing tests**

`src/core/controls/curve-control.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createCurveControl, type CurvePoint } from './curve-control';

const RAMP: CurvePoint[] = [{ x: 0, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }];

function mount(points = RAMP, grid?: { x: number; y: number }) {
  const onChange = vi.fn();
  const h = createCurveControl({ points, onChange, label: 'test curve', grid });
  document.body.appendChild(h.el);
  // jsdom has no layout: give the SVG a box so pointer math has a frame.
  const svg = h.el.querySelector('svg')!;
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: 200, height: 100,
    right: 200, bottom: 100, toJSON: () => ({}),
  } as DOMRect);
  return { h, onChange, svg };
}

const pt = (el: Element, type: string, x: number, y: number) =>
  el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));

describe('createCurveControl', () => {
  it('renders one handle per point and an accessible label', () => {
    const { h } = mount();
    expect(h.el.querySelectorAll('.curve-point')).toHaveLength(2);
    expect(h.el.getAttribute('aria-label')).toBe('test curve');
  });

  it('dragging a handle moves the point and reports through onChange', () => {
    const { h, onChange } = mount();
    const handle = h.el.querySelectorAll<SVGElement>('.curve-point')[0];
    pt(handle, 'pointerdown', 0, 0);
    pt(handle, 'pointermove', 0, 50);   // down half the 100px height
    pt(handle, 'pointerup', 0, 50);
    const pts = onChange.mock.lastCall![0] as CurvePoint[];
    expect(pts[0].y).toBeLessThan(0.6); // moved down from y=1
    expect(pts[0].x).toBe(0);           // endpoint locked in x
  });

  it('double-click on empty space adds a point; double-click a point removes it', () => {
    const { h, onChange, svg } = mount();
    svg.dispatchEvent(new MouseEvent('dblclick', { clientX: 100, clientY: 20, bubbles: true }));
    expect((onChange.mock.lastCall![0] as CurvePoint[]).length).toBe(3);
    const mid = h.el.querySelectorAll<SVGElement>('.curve-point')[1];
    mid.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect((onChange.mock.lastCall![0] as CurvePoint[]).length).toBe(2);
  });

  it('never removes below 2 points', () => {
    const { h, onChange } = mount();
    for (const el of [...h.el.querySelectorAll<SVGElement>('.curve-point')]) {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }
    const last = onChange.mock.lastCall;
    if (last) expect((last[0] as CurvePoint[]).length).toBeGreaterThanOrEqual(2);
    expect(h.el.querySelectorAll('.curve-point').length).toBeGreaterThanOrEqual(2);
  });

  it('snaps to the grid when one is given', () => {
    const { h, onChange } = mount(RAMP, { x: 4, y: 4 });
    const handle = h.el.querySelectorAll<SVGElement>('.curve-point')[0];
    pt(handle, 'pointerdown', 0, 0);
    pt(handle, 'pointermove', 0, 30);   // 0.7 raw -> snaps to 0.75
    pt(handle, 'pointerup', 0, 30);
    const pts = onChange.mock.lastCall![0] as CurvePoint[];
    expect(Math.abs(pts[0].y * 4 - Math.round(pts[0].y * 4))).toBeLessThan(1e-9);
  });

  it('set() repaints from outside without replacing the element', () => {
    const { h } = mount();
    const before = h.el.querySelector('svg');
    h.set([{ x: 0, y: 0, c: 0 }, { x: 0.5, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }]);
    expect(h.el.querySelector('svg')).toBe(before);
    expect(h.el.querySelectorAll('.curve-point')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `NO_COLOR=1 npx vitest run src/core/controls/curve-control.test.ts` → module not found.

- [ ] **Step 3: Implement `src/core/controls/curve-control.ts`**

Implementation notes the code must honour (write the file from these, keeping it under 300 code lines):

- Root `<div class="curve-control" aria-label={label}>` containing one `<svg viewBox="0 0 200 100" preserveAspectRatio="none">`.
- Layers inside the svg: optional grid lines (from `opts.grid`), the curve `<path class="curve-path">`, one `<circle class="curve-point" r="5">` per point. Colors via CSS variables (`var(--amber)`, `var(--border)`, `var(--text-dim)`) with sane fallbacks — no hardcoded theme colors.
- The path is drawn by SAMPLING each segment 16 times through the same shaping function the DSP uses: `shape(u, c) = c === 0 ? u : Math.pow(u, Math.pow(4, c))` — duplicate the one-liner here with a comment naming `plugins/curve/dsp.ts` as its twin (the host cannot import plugin code, and the SDK earns no primitive for one consumer pair yet).
- Pointer handling on each point circle: `pointerdown` captures (`setPointerCapture` guarded in try/catch — jsdom lacks it), `pointermove` maps clientX/Y through `svg.getBoundingClientRect()` into 0..1, clamps, snaps to `grid` when given, locks x for the first and last point, keeps x strictly inside neighbours (min gap 0.01) so points stay sorted, then repaints and calls `onChange(copy)`.
- `dblclick` on the svg (not on a point): insert a point at the mapped position, sorted by x, max 16, `onChange`. `dblclick` on a point circle: remove it unless only 2 remain, `onChange`.
- Curvature: an invisible wider hit `<circle class="curve-bend" r="8">` at each segment's midpoint; vertical drag adjusts that segment's `c` by `dy / 60`, clamped -1..1.
- `set(points)` replaces internal state and repaints in place — the svg element is NEVER recreated (repaint = update attributes / add-remove circles).
- Everything repaints through one internal `paint()`; state is a private sorted array of `{x,y,c}`.

- [ ] **Step 4: Run tests to verify PASS** — `NO_COLOR=1 npx vitest run src/core/controls/curve-control.test.ts`.

- [ ] **Step 5: Add minimal styling** to `src/styles/_session-inspector.scss` (next to the other control styles):

```scss
/* The drawable curve control (modulator editors; later mod-remap and
 * automation). The svg scales with its host row; points are amber like every
 * other active control. */
.curve-control {
  flex: 1 1 160px;
  min-width: 160px;

  svg { display: block; width: 100%; height: 56px; }
  .curve-path { fill: none; stroke: var(--amber); stroke-width: 2; }
  .curve-point { fill: var(--surface-3); stroke: var(--amber); cursor: grab; }
  .curve-bend { fill: transparent; cursor: ns-resize; }
  .curve-grid { stroke: var(--border); stroke-width: 1; opacity: .5; }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/core/controls/curve-control.ts src/core/controls/curve-control.test.ts src/styles/_session-inspector.scss && git commit -m "$(cat <<'EOF'
feat(core): drawable curve control — points, curvature, snap, live repaint

One editor built to be paid three times: modulator shapes now, mod-remap
and automation editing later. Pure DOM+SVG, mounted once, repaints in
place so a pointer never loses the element it is holding.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)" && git rebase main
```

---

### Task 4: expose `Loom.controls.curve` + the plugin's editors

**Files:**
- Modify: `src/plugin-host/loom-api.ts` (the `controls:` object, ~line 288)
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (the `LoomApi['controls']` type)
- Create/fill: `plugins/curve/main.ts`
- Test: extend `src/plugin-host/loom-api.test.ts`

**Interfaces:**
- Consumes: `createCurveControl` (Task 3), `Loom.registerModulatorUI(id, configMount)` (host door), `ModulatorConfigApi` (`get(key, def)` / `set(key, value)` numbers).
- Produces: `Loom.controls.curve(opts) => { el, set }` for any plugin; the curve bag keys `pts`, `p{i}x/y/c` written exactly as Task 1's `evalCurve` reads them.

- [ ] **Step 1: Failing test** — append to `src/plugin-host/loom-api.test.ts` (follow the file's existing setup idiom for installing the api):

```ts
it('controls.curve builds a curve control a plugin can mount', () => {
  const api = (globalThis as unknown as { Loom: { controls: { curve: (o: {
    points: { x: number; y: number; c: number }[];
    onChange: (p: { x: number; y: number; c: number }[]) => void;
    label: string;
  }) => { el: HTMLElement; set: (p: { x: number; y: number; c: number }[]) => void } } } }).Loom;
  const h = api.controls.curve({
    points: [{ x: 0, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }],
    onChange: () => {},
    label: 'spec',
  });
  expect(h.el.querySelectorAll('.curve-point')).toHaveLength(2);
  expect(typeof h.set).toBe('function');
});
```

- [ ] **Step 2: Run to verify FAIL** — `NO_COLOR=1 npx vitest run src/plugin-host/loom-api.test.ts` → `curve` is not a function.

- [ ] **Step 3: Implement the exposure**

In `src/plugin-host/loom-api.ts`: import `createCurveControl` beside the other control imports and add to the `controls` object:

```ts
curve: createCurveControl,
```

In `packages/loom-plugin-sdk/src/manifest.ts`, extend the `LoomApi` controls type where `knob`/`steps` are declared (match the surrounding declaration style):

```ts
curve(opts: {
  points: Array<{ x: number; y: number; c: number }>;
  onChange(points: Array<{ x: number; y: number; c: number }>): void;
  label: string;
  grid?: { x: number; y: number };
}): { el: HTMLElement; set(points: Array<{ x: number; y: number; c: number }>): void };
```

- [ ] **Step 4: Run to verify PASS** — the loom-api test, then `npx tsc --noEmit`.

- [ ] **Step 5: Write `plugins/curve/main.ts`** (both editors; no test of its own — plugin main.js is exercised by the browser look in Task 6, like stepseq's):

```ts
// plugins/curve/main.ts
// Both components mount the SAME curve control plus their own knobs, all from
// the host catalogue. Points live in the numeric bag as pts + p{i}x/y/c —
// exactly what dsp.ts evalCurve reads.

interface Pt { x: number; y: number; c: number }
const MAX_PTS = 16;

const readPts = (api: { get(k: string, d: number): number }): Pt[] => {
  const n = Math.max(2, Math.min(MAX_PTS, Math.round(api.get('pts', 0))));
  return Array.from({ length: n }, (_, i) => ({
    x: api.get(`p${i}x`, 0), y: api.get(`p${i}y`, 0), c: api.get(`p${i}c`, 0),
  }));
};

const writePts = (api: { set(k: string, v: number): void }, pts: Pt[]): void => {
  api.set('pts', pts.length);
  pts.forEach((p, i) => { api.set(`p${i}x`, p.x); api.set(`p${i}y`, p.y); api.set(`p${i}c`, p.c); });
};

const mountEditor = (
  root: HTMLElement,
  api: { get(k: string, d: number): number; set(k: string, v: number): void },
  knobs: Array<{ el: HTMLElement }>,
): void => {
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.gap = '8px';
  // Seed on a bag never drawn (sentinel: pts absent). A modulator that
  // arrives silent-until-you-draw reads as broken — same rule as stepseq.
  if (api.get('pts', 0) < 2) {
    writePts(api, [{ x: 0, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }]);
  }
  const curve = Loom.controls.curve({
    points: readPts(api),
    label: 'Curve',
    grid: { x: 8, y: 4 },
    onChange: (pts) => writePts(api, pts),
  });
  curve.el.style.flex = '1 1 160px';
  root.append(curve.el, ...knobs.map((k) => k.el));
};

Loom.registerModulatorUI('curve-lfo', (root, api) => {
  const rate = Loom.controls.knob({
    min: 0.05, max: 32, value: api.get('rate', 1), defaultValue: 1, label: 'Rate',
    format: (v: number) => `${v.toFixed(2)}Hz`,
    onChange: (v: number) => api.set('rate', v),
  });
  const polarity = document.createElement('button');
  polarity.className = 'rnd';
  const paint = () => { polarity.textContent = api.get('bipolar', 0) !== 0 ? 'Bi' : 'Uni'; };
  polarity.addEventListener('click', () => { api.set('bipolar', api.get('bipolar', 0) !== 0 ? 0 : 1); paint(); });
  paint();
  mountEditor(root, api, [rate, { el: polarity }]);
});

Loom.registerModulatorUI('curve-env', (root, api) => {
  const dur = Loom.controls.knob({
    min: 0.02, max: 20, value: api.get('duration', 1), defaultValue: 1, label: 'Time',
    format: (v: number) => v >= 1 ? `${v.toFixed(1)}s` : `${Math.round(v * 1000)}ms`,
    onChange: (v: number) => api.set('duration', v),
  });
  const mode = document.createElement('button');
  mode.className = 'rnd';
  const paint = () => { mode.textContent = api.get('mode', 0) !== 0 ? 'Loop' : '1-shot'; };
  mode.addEventListener('click', () => { api.set('mode', api.get('mode', 0) !== 0 ? 0 : 1); paint(); });
  paint();
  mountEditor(root, api, [dur, { el: mode }]);
});

// A module, not a global script.
export {};
```

- [ ] **Step 6: Build + typecheck + full notefx/modulation area run**

```bash
npm run build:plugins && npx tsc --noEmit && NO_COLOR=1 npx vitest run src/plugin-host/ src/modulation/ plugins/curve/
```

- [ ] **Step 7: Commit**

```bash
git add src/plugin-host plugins/curve packages/loom-plugin-sdk public/plugins && git commit -m "$(cat <<'EOF'
feat(plugin-host): Loom.controls.curve + the curve plugin's two editors

The control enters the plugin-facing catalogue (an additive LoomApi
extension); curve-lfo and curve-env mount the same editor with their own
knobs, storing points in the numeric bag exactly as the kernels read it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)" && git rebase main
```

---

### Task 5: `drift` plugin

**Files:**
- Create: `plugins/drift/plugin.json`
- Create: `plugins/drift/dsp.ts`
- Test: `plugins/drift/dsp.test.ts`

**Interfaces:**
- Consumes: `Loom.registerModulatorKernel` (worklet global); `m.id` (instance id string) for the seed.
- Produces: registered kernel id `drift`; no `main.js` — the generic param grid renders `rate`/`amount`/`mode` (precedent: the `sh` plugin has no custom UI).

- [ ] **Step 1: Scaffold + manifest**

```bash
npm run plugin -- new plugins/drift
```

`plugins/drift/plugin.json`:

```json
{
  "id": "drift",
  "name": "Drift",
  "version": "1.0.0",
  "loomApi": 1,
  "author": "Loom",
  "dsp": "dsp.js",
  "components": [
    {
      "kind": "modulator",
      "id": "drift",
      "name": "Drift",
      "params": [
        { "id": "rate",   "label": "Rate",   "kind": "continuous", "min": 0.05, "max": 16, "default": 0.5, "unit": "Hz" },
        { "id": "amount", "label": "Amount", "kind": "continuous", "min": 0, "max": 1, "default": 1 },
        { "id": "mode", "label": "Mode", "kind": "discrete", "min": 0, "max": 1, "default": 0,
          "options": [{ "value": "drift", "label": "Drift" }, { "value": "chaos", "label": "Chaos" }] }
      ],
      "modulator": { "driver": "time", "scopes": ["shared", "per-voice"], "idPrefix": "drf" }
    }
  ]
}
```

Remove any scaffolded `main.ts` (this plugin has none) and its manifest `"main"` line.

- [ ] **Step 2: Failing tests** — `plugins/drift/dsp.test.ts`:

```ts
// plugins/drift/dsp.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

type Kernel = { id: string; valueAt(m: unknown, t: number, origin: number): number };
const kernels = new Map<string, Kernel>();
beforeAll(async () => {
  (globalThis as Record<string, unknown>).Loom = {
    registerModulatorKernel: (k: Kernel) => kernels.set(k.id, k),
  };
  await import('./dsp');
});

const m = (id: string, extra: Record<string, number> = {}) =>
  ({ id, kind: 'drift', enabled: true, params: { rate: 2, amount: 1, mode: 0, ...extra } });

describe('drift kernel', () => {
  it('stays within -1..+1 and scales with amount', () => {
    const k = kernels.get('drift')!;
    for (let i = 0; i < 500; i++) {
      const v = k.valueAt(m('drf1'), i * 0.013, 0);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(k.valueAt(m('drf1', { amount: 0.25 }), i * 0.013, 0)))
        .toBeLessThanOrEqual(Math.abs(v) + 1e-9);
    }
  });

  it('is continuous: adjacent samples move a small fraction of the range', () => {
    const k = kernels.get('drift')!;
    // At rate 2Hz a 1ms step should never jump more than a few percent of the
    // full span — RELATIVE to what a whole period could move (2 units).
    for (let i = 0; i < 2000; i++) {
      const a = k.valueAt(m('drf1'), i * 0.001, 0);
      const b = k.valueAt(m('drf1'), (i + 1) * 0.001, 0);
      expect(Math.abs(b - a)).toBeLessThan(2 * (2 * 0.001) * 4); // rate*dt, x4 slack
    }
  });

  it('is deterministic per instance and different across instances', () => {
    const k = kernels.get('drift')!;
    expect(k.valueAt(m('drf1'), 1.234, 0)).toBe(k.valueAt(m('drf1'), 1.234, 0));
    const a = Array.from({ length: 32 }, (_, i) => k.valueAt(m('drf1'), i * 0.11, 0));
    const b = Array.from({ length: 32 }, (_, i) => k.valueAt(m('drf2'), i * 0.11, 0));
    expect(a.some((v, i) => Math.abs(v - b[i]) > 1e-6)).toBe(true);
  });

  it('chaos mode also holds range and continuity', () => {
    const k = kernels.get('drift')!;
    let prev = k.valueAt(m('drf1', { mode: 1 }), 0, 0);
    for (let i = 1; i < 1000; i++) {
      const v = k.valueAt(m('drf1', { mode: 1 }), i * 0.002, 0);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.2); // continuous, never a step
      prev = v;
    }
  });
});
```

- [ ] **Step 3: Run to verify FAIL**, then **Step 4: implement `plugins/drift/dsp.ts`**:

```ts
// plugins/drift/dsp.ts
// Analog-style life: value noise ("drift") or a normalised Lorenz walk
// ("chaos"). PURE — no Math.random at render time (the Karplus lesson):
// drift hashes integer cell indices, chaos integrates deterministically from
// a seeded start, both keyed off the instance id so two Drifts differ.

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** Deterministic -1..+1 for an integer cell of one instance. */
const cell = (seed: number, i: number): number => {
  let x = Math.imul(seed ^ Math.imul(i | 0, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return ((x >>> 0) / 0xffffffff) * 2 - 1;
};

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** Lorenz x-coordinate after walking from a seeded start for `steps` steps.
 *  Cached per (seed) — the walk is resumed, never recomputed, so cost stays
 *  O(steps since last call) and a same-t re-ask is free. */
const lorenzRuns = new Map<number, { n: number; x: number; y: number; z: number }>();
const lorenzAt = (seed: number, steps: number): number => {
  let r = lorenzRuns.get(seed);
  if (!r || r.n > steps) r = { n: 0, x: 1 + (seed % 7) * 0.1, y: 1, z: 20 };
  const h = 0.004; // integration step; small enough to stay stable
  for (; r.n < steps; r.n++) {
    const dx = 10 * (r.y - r.x), dy = r.x * (28 - r.z) - r.y, dz = r.x * r.y - (8 / 3) * r.z;
    r.x += dx * h; r.y += dy * h; r.z += dz * h;
  }
  lorenzRuns.set(seed, r);
  return Math.max(-1, Math.min(1, r.x / 20));
};

Loom.registerModulatorKernel({
  id: 'drift',
  valueAt(m, t, origin) {
    const p = m.params;
    const rate = p?.rate ?? 0.5;
    const amount = p?.amount ?? 1;
    const seed = hash(m.id);
    const dt = Math.max(0, t - origin);
    if ((p?.mode ?? 0) !== 0) {
      // ~250 integration steps per second of musical time, scaled by rate.
      return lorenzAt(seed, Math.floor(dt * rate * 250)) * amount;
    }
    const pos = dt * rate;
    const i = Math.floor(pos);
    const a = cell(seed, i), b = cell(seed, i + 1);
    return (a + (b - a) * smooth(pos - i)) * amount;
  },
});

// A module, not a global script.
export {};
```

- [ ] **Step 5: Run tests + build** — `NO_COLOR=1 npx vitest run plugins/drift/dsp.test.ts && npm run build:plugins` → PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/drift public/plugins && git commit -m "$(cat <<'EOF'
feat(drift): drift modulator plugin — value-noise drift and Lorenz chaos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)" && git rebase main
```

---

### Task 6: full verification + browser look + merge gate

**Files:** none new.

- [ ] **Step 1: Full build + fast suite**

```bash
npm run build && npm run test:fast
```

Expected: green. A red anywhere is a real regression (the flaky teardown is fixed) — diagnose before proceeding.

- [ ] **Step 2: Browser look (mandatory for the UI done-claim)**

```bash
npm run dev   # inside the worktree; note the port it picks
```

In the app: select a melodic lane → MODULATORS panel → add **Curve LFO**; the editor must show the seeded ramp; draw points, bend a segment, connect it to a continuous param (e.g. cutoff) and HEAR it move. Add **Curve Env** on a per-voice connection and hear each note run its own shape. Add **Drift** and hear slow wander. Screenshot the curve editor card.

- [ ] **Step 3: Report + merge gate**

Squash to one commit per task if the history grew fix-ups (GIT_SEQUENCE_EDITOR todo-file flow), then STOP and ask Nacho for explicit permission before merging: `git rebase main` + `git merge --ff-only` from the main checkout, never without his OK. After merge: `npm run build:manual` only if he asks; push only if he asks.

---

## Self-review notes (already applied)

- Spec coverage: control (T3/T4), curve plugin both components (T1/T2/T4), drift (T5), tests per spec §4 (T1-T5), browser look (T6). The spec's "check modulation-pipeline walk" resolved during planning: that test walks ENGINES with the in-tree LFO kernel only; the stepseq precedent keeps plugin-kernel coverage in the plugin's own dsp.test.ts — no pipeline change.
- `scale: "log"` on the duration param and two modulator components in one manifest are believed valid; Task 1 carries an explicit stop-and-report instruction if `manifest-validate` disagrees.
- Type consistency: `CurvePoint {x,y,c}`, bag keys `pts`/`p{i}x|y|c`, kernel ids `curve-lfo`/`curve-env`/`drift` are spelled identically across tasks.
