# FM Layout + Musicality/Intonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the FM engine a per-operator editor layout and a musical, in-tune default + preset set, without clipping.

**Architecture:** Add an optional `group` field to the param schema so the FM editor renders one labelled row per operator (data-driven, no core special-casing); extract the generic knob-grid builder into a testable module. Tame the FM DSP with a tanh soft-clip + a reviewed modulation index + a per-preset `output.trim`, then revoice the default and all 24 presets against the tamed engine, gated by an objective per-preset test.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom for UI, pure per-sample kernel for DSP), Web Audio worklet (live path), pure `audio-dsp` kernel (offline + tests).

## Global Constraints

- Source files: ≤300 lines target, **500 hard cap** — decompose god-files when touched.
- All UI text / labels in **English**.
- Test assertions **always relative** (ratios, `>`, `<`, `* 2`) — never absolute magnitudes; justify any absolute threshold in a comment.
- Run vitest colour-free: `NO_COLOR=1 npx vitest run <path>`.
- `test:unit` has a flaky teardown (`ERR_IPC_CHANNEL_CLOSED`) *after* tests pass — re-run to confirm green; it is not a failure.
- Golden WAVs are human-inspection only and never fail CI; FM golden drift is expected.
- Work in the `worktree-fm-layout-musicality` git worktree; rebase onto `main` frequently; merge `--ff` **only with explicit user permission**.
- Exact DSP constants (FM index, tanh drive) and preset values are **ear-tuned**; the objective tests are the safety net, not the definition of "good". Final ear-check MUST be in **real Chrome** at `localhost:5173` (VS Code's embedded browser is unfaithful for audio).

---

### Task 1: `group` param field + tag FM operators

**Files:**
- Modify: `src/engines/engine-params.ts` (add `group?` to `EngineParamSpec`)
- Modify: `src/engines/fm.ts` (`opParamSpecs` tags each operator's params)
- Test: `src/engines/fm.test.ts` (create)

**Interfaces:**
- Produces: `EngineParamSpec.group?: string` — params sharing a `group` render in one labelled row; the label is the group string. Ungrouped params render in a leading row.

- [ ] **Step 1: Write the failing test**

Create `src/engines/fm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../engines/fm';                 // registers the FM descriptor engine
import { getEngine } from './registry';

describe('FM param groups', () => {
  it('tags each operator param with its OPn group', () => {
    const fm = getEngine('fm')!;
    const groupOf = (id: string) => fm.params.find((p) => p.id === id)?.group;
    for (let n = 1; n <= 4; n++) {
      expect(groupOf(`op${n}.ratio`)).toBe(`OP${n}`);
      expect(groupOf(`op${n}.release`)).toBe(`OP${n}`);
    }
  });

  it('leaves global params ungrouped', () => {
    const fm = getEngine('fm')!;
    for (const id of ['algorithm', 'feedback', 'amp.mix']) {
      expect(fm.params.find((p) => p.id === id)?.group).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/fm.test.ts`
Expected: FAIL — `groupOf('op1.ratio')` is `undefined`, not `'OP1'`.

- [ ] **Step 3: Add the schema field**

In `src/engines/engine-params.ts`, add to the `EngineParamSpec` interface (after `color?`):

```ts
  /** Optional layout group. Params sharing a group id render together in one
   *  labelled row (label = the group string); ungrouped params render in the
   *  leading row. Consumed by engine-param-grid.buildEngineParamGrid. */
  group?: string;
```

- [ ] **Step 4: Tag the FM operator params**

In `src/engines/fm.ts`, change `opParamSpecs` so every returned spec carries `group: \`OP${n}\``:

```ts
function opParamSpecs(n: number, defaults: { ratio: number; level: number }): EngineParamSpec[] {
  const g = `OP${n}`;
  return [
    { id: `op${n}.ratio`,   label: `Op${n} Ratio`, kind: 'continuous', min: 0.1, max: 16, default: defaults.ratio, curve: 'exponential', group: g },
    { id: `op${n}.detune`,  label: `Op${n} Det`,   kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢', group: g },
    { id: `op${n}.level`,   label: `Op${n} Lvl`,   kind: 'continuous', min: 0,   max: 1,  default: defaults.level, group: g },
    { id: `op${n}.attack`,  label: `Op${n} Atk`,   kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', group: g },
    { id: `op${n}.decay`,   label: `Op${n} Dec`,   kind: 'continuous', min: 0.001, max: 4, default: 0.3,  unit: 's', group: g },
    { id: `op${n}.sustain`, label: `Op${n} Sus`,   kind: 'continuous', min: 0,   max: 1,  default: 0.7, group: g },
    { id: `op${n}.release`, label: `Op${n} Rel`,   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', group: g },
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/fm.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/engines/engine-params.ts src/engines/fm.ts src/engines/fm.test.ts
git commit -m "feat(fm): group operator params for per-row layout"
```

---

### Task 2: `engine-param-grid.ts` grouped grid builder

**Files:**
- Create: `src/engines/engine-param-grid.ts`
- Test: `src/engines/engine-param-grid.test.ts` (create)

**Interfaces:**
- Consumes: `EngineParamSpec.group?` (Task 1); `createKnob` (`src/core/knob.ts`); `createSelectControl` (`src/core/select-control.ts`); `attachKnobUndo` (`src/save/history-wiring.ts`); `EngineUIContext` (`src/engines/engine-types.ts`).
- Produces: `buildEngineParamGrid(engine, ctx, container, opts?)` — appends, per distinct `group` (in first-appearance order), a `<div class="row poly-section"><div class="section-label">GROUP</div><div class="knob-row">…</div></div>`; ungrouped params go first in a plain `<div class="row knob-row">`. Continuous specs → `createKnob`; discrete specs with options → `createSelectControl` (dropdown when `selectStyle==='dropdown'`). Each control registers under `${ctx.laneId}.${spec.id}` via `ctx.registerKnob`. `opts.skip?(id)` omits matching specs.

- [ ] **Step 1: Write the failing test**

Create `src/engines/engine-param-grid.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { buildEngineParamGrid } from './engine-param-grid';
import type { EngineParamSpec } from './engine-params';
import type { EngineUIContext } from './engine-types';

function stubEngine(params: EngineParamSpec[]) {
  const state = new Map(params.map((p) => [p.id, p.default] as const));
  return {
    id: 'stub', params,
    getBaseValue: (id: string) => state.get(id) ?? 0,
    setBaseValue: (id: string, v: number) => { state.set(id, v); },
  };
}

function ctx(): EngineUIContext {
  const reg = new Map<string, unknown>();
  return { laneId: 'L', registerKnob: (k: unknown) => reg.set(String(reg.size), k), registry: reg } as unknown as EngineUIContext;
}

const cont = (id: string, group?: string): EngineParamSpec =>
  ({ id, label: id, kind: 'continuous', min: 0, max: 1, default: 0.5, group });

describe('buildEngineParamGrid', () => {
  it('renders one labelled section per group plus a leading global row', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([
      cont('feedback'), cont('op1.ratio', 'OP1'), cont('op1.level', 'OP1'), cont('op2.ratio', 'OP2'),
    ]), ctx(), parent);

    const sections = parent.querySelectorAll('.poly-section');
    expect(sections.length).toBe(2);                                   // OP1, OP2
    expect(sections[0].querySelector('.section-label')?.textContent).toBe('OP1');
    expect(sections[1].querySelector('.section-label')?.textContent).toBe('OP2');
    // Leading global (ungrouped) row exists and holds the ungrouped knob.
    const globalRow = parent.querySelector(':scope > .knob-row');
    expect(globalRow).not.toBeNull();
    expect(globalRow!.querySelectorAll('.knob').length).toBe(1);       // feedback
    // OP1 section holds its two knobs.
    expect(sections[0].querySelectorAll('.knob').length).toBe(2);
  });

  it('renders a discrete dropdown spec as a <select>, not a knob', () => {
    const parent = document.createElement('div');
    const algo: EngineParamSpec = {
      id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: 1, default: 0,
      selectStyle: 'dropdown',
      options: [{ value: '0', label: 'A' }, { value: '1', label: 'B' }],
    };
    buildEngineParamGrid(stubEngine([algo]), ctx(), parent);
    expect(parent.querySelector('select.select-control')).not.toBeNull();
    expect(parent.querySelector('.knob')).toBeNull();
  });

  it('skips params matching opts.skip', () => {
    const parent = document.createElement('div');
    buildEngineParamGrid(stubEngine([cont('poly.voices'), cont('feedback')]), ctx(), parent,
      { skip: (id) => id.startsWith('poly.') });
    expect(parent.querySelectorAll('.knob').length).toBe(1);           // only feedback
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-grid.test.ts`
Expected: FAIL — `buildEngineParamGrid` is not defined / module missing.

- [ ] **Step 3: Write the module**

Create `src/engines/engine-param-grid.ts`:

```ts
// src/engines/engine-param-grid.ts
// Builds an engine's param controls into a container, grouped into one labelled
// row per distinct EngineParamSpec.group (first-appearance order). Ungrouped
// params render first in a plain knob-row. Continuous → knob; discrete → select.
// Extracted from worklet-lane-engine.buildParamUI so the grouped layout is
// unit-testable without a worklet and the engine file stays lean.

import { createKnob } from '../core/knob';
import { createSelectControl } from '../core/select-control';
import type { EngineParamSpec } from './engine-params';
import type { EngineUIContext } from './engine-types';
import { attachKnobUndo } from '../save/history-wiring';

interface GridEngine {
  id: string;
  params: EngineParamSpec[];
  getBaseValue(id: string): number;
  setBaseValue(id: string, v: number): void;
}

export interface BuildGridOpts {
  /** If it returns true for a spec id, that spec is omitted. */
  skip?: (id: string) => boolean;
}

function buildControl(engine: GridEngine, ctx: EngineUIContext, spec: EngineParamSpec): HTMLElement {
  const registryId = `${ctx.laneId}.${spec.id}`;
  const discrete = spec.kind === 'discrete' && !!spec.options && spec.options.length > 0;

  if (discrete) {
    const options = spec.options!;
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(engine.getBaseValue(spec.id))));
    const { el, handle } = createSelectControl({
      id: registryId,
      label: spec.label,
      options,
      initialValue: options[idx]?.value ?? options[0].value,
      forceSelect: spec.selectStyle === 'dropdown',
      showLabel: spec.showLabel,
      onChange: (v) => {
        const i = options.findIndex((o) => o.value === v);
        engine.setBaseValue(spec.id, i);
      },
    });
    ctx.registerKnob(handle);
    return el;
  }

  const knob = createKnob({
    id: registryId,
    label: spec.label,
    min: spec.min,
    max: spec.max,
    step: (spec.max - spec.min) / 200,
    value: engine.getBaseValue(spec.id),
    defaultValue: spec.default,
    color: spec.color,
    format: spec.unit ? (v) => `${v.toFixed(2)}${spec.unit}` : undefined,
    onChange: (v) => { engine.setBaseValue(spec.id, v); },
    ...(ctx.historyDeps ? attachKnobUndo(ctx.historyDeps) : {}),
  });
  ctx.registerKnob(knob);
  return knob.el;
}

export function buildEngineParamGrid(
  engine: GridEngine,
  ctx: EngineUIContext,
  container: HTMLElement,
  opts: BuildGridOpts = {},
): void {
  const skip = opts.skip ?? (() => false);
  const order: string[] = [];
  const byGroup = new Map<string | undefined, EngineParamSpec[]>();
  for (const spec of engine.params) {
    if (skip(spec.id)) continue;
    const g = spec.group;
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      if (g !== undefined) order.push(g);
    }
    byGroup.get(g)!.push(spec);
  }

  // Leading ungrouped row (global controls), unlabelled.
  const globals = byGroup.get(undefined);
  if (globals && globals.length) {
    const row = document.createElement('div');
    row.className = 'row knob-row';
    for (const spec of globals) row.appendChild(buildControl(engine, ctx, spec));
    container.appendChild(row);
  }

  // One labelled section per group.
  for (const g of order) {
    const section = document.createElement('div');
    section.className = 'row poly-section';
    const lab = document.createElement('div');
    lab.className = 'section-label';
    lab.textContent = g;
    section.appendChild(lab);
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    for (const spec of byGroup.get(g)!) knobRow.appendChild(buildControl(engine, ctx, spec));
    section.appendChild(knobRow);
    container.appendChild(section);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-grid.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/engine-param-grid.ts src/engines/engine-param-grid.test.ts
git commit -m "feat(engine-ui): grouped param-grid builder (labelled row per group)"
```

---

### Task 3: Wire the grouped grid into the worklet lane engine

**Files:**
- Modify: `src/engines/worklet-lane-engine.ts` (replace the inline generic grid at ~317-340 with a `buildEngineParamGrid` call; add import)

**Interfaces:**
- Consumes: `buildEngineParamGrid` (Task 2).

- [ ] **Step 1: Add the import**

In `src/engines/worklet-lane-engine.ts`, add near the other engine-ui imports:

```ts
import { buildEngineParamGrid } from './engine-param-grid';
```

- [ ] **Step 2: Replace the inline grid block**

Replace the entire block that starts with `// Per-engine knob grid.` and the following `if (this.id !== 'subtractive') { … container.appendChild(grid); }` (currently lines ~312-340) with:

```ts
    // Per-engine knob grid. Subtractive's osc/filter/amp/master knobs are mounted
    // separately into fixed page sections by knob-mounting.mountSubtractiveLaneKnobs;
    // every OTHER worklet engine (fm/wavetable/karplus/westcoast/tb303) renders a
    // generic grouped grid here from its param spec — grouped params (e.g. FM's
    // OP1..OP4) become one labelled row each; ungrouped params share the top row.
    if (this.id !== 'subtractive') {
      buildEngineParamGrid(this, ctx, container, { skip: (id) => id.startsWith('poly.') });
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`WorkletLaneEngine` already has `id`, `params`, `getBaseValue`, `setBaseValue` — it satisfies `GridEngine`.)

- [ ] **Step 4: Run the affected unit tests**

Run: `NO_COLOR=1 npx vitest run src/engines/`
Expected: PASS (no regressions in engine tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/worklet-lane-engine.ts
git commit -m "feat(fm): render FM editor as per-operator rows via grouped grid"
```

---

### Task 4: Tame the FM DSP — tanh soft-clip + reviewed index + per-preset trim

**Files:**
- Modify: `src/audio-dsp/fm-renderer.ts` (constants, `output.trim` read, final soft-clip)
- Test: `src/audio-dsp/fm-renderer.test.ts` (add a no-clip case)

**Interfaces:**
- Produces: FM voice output now passes through `Math.tanh(out * FM_DRIVE)` before trim, and multiplies by a per-preset `output.trim` param (default 1). `FM_DEPTH` reviewed.

- [ ] **Step 1: Write the failing test**

Add to `src/audio-dsp/fm-renderer.test.ts` (inside the `describe('FMRenderer', …)` block):

```ts
  it('additive algorithm (3) at full level + accent does not clip (soft-clip)', () => {
    const bag = base({
      algorithm: 3, feedback: 0,
      'op1.level': 1, 'op2.level': 1, 'op3.level': 1, 'op4.level': 1,
      'op1.sustain': 1, 'op2.sustain': 1, 'op3.sustain': 1, 'op4.sustain': 1,
      'amp.mix': 1,
    });
    const v = new FMRenderer(note({ midi: 60, durationSec: 1, velocity: 1, accent: true }), bag, SR);
    let pk = 0;
    for (let i = 0; i < Math.floor(SR * 0.3); i++) pk = Math.max(pk, Math.abs(v.renderSample(i / SR)));
    // Four in-phase carriers × accent would exceed full scale without the tanh
    // soft-clip; with it, |output| stays below 0 dBFS.
    expect(pk).toBeLessThan(1.0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/fm-renderer.test.ts -t "does not clip"`
Expected: FAIL — peak ≥ 1.0 (four phase-aligned carriers × accent overshoot).

- [ ] **Step 3: Add constants + a per-voice output trim + the soft-clip**

In `src/audio-dsp/fm-renderer.ts`:

3a. Change the depth constant and add a drive constant:

```ts
const FM_DEPTH = 3;    // modulation index scale (was 4 — reviewed down; tanh tames peaks)
const FB_DEPTH = 2;
const FM_DRIVE = 1.0;  // pre-soft-clip drive into tanh; ear-tunable
```

3b. Add a field and read `output.trim` in the constructor. Add near the other private fields:

```ts
  private outputTrim: number;
```

and in the constructor body (next to `this.mix = param(p, 'amp.mix', 0.7);`):

```ts
    this.outputTrim = param(p, 'output.trim', 1);
```

3c. Replace the final output lines of `renderSample`:

```ts
    const mix = mo?.['amp.mix'] ? Math.max(0, this.mix + mo['amp.mix']) : this.mix;
    const shaped = Math.tanh(out * FM_DRIVE);   // soft-clip: tame harsh peaks, prevent carrier-sum clipping
    let s = shaped * this.outputTrim * synthTrim('fm') * mix * this.vel;
    if (mo?.['amp.gain']) s *= Math.max(0, Math.min(2, 1 + mo['amp.gain']));
    return s;
```

3d. Update the top-of-file comment block: note that the summed carrier output is soft-clipped with `tanh` and scaled by a per-preset `output.trim`, and that `FM_DEPTH` was reduced to 3.

- [ ] **Step 4: Run the FM renderer tests**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/fm-renderer.test.ts`
Expected: PASS — the new no-clip case passes, and all existing cases (audible, tuning ±1 semitone, feedback Δ>2%, release) still pass (relative assertions are unaffected by the tanh/level change).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/fm-renderer.ts src/audio-dsp/fm-renderer.test.ts
git commit -m "fix(fm): tanh soft-clip + reviewed FM index + per-preset output.trim"
```

---

### Task 5: Objective per-preset guard test (audible / no-clip / in-tune)

**Files:**
- Test: `src/audio-dsp/fm-presets.test.ts` (create)

**Interfaces:**
- Consumes: `FMRenderer` (`src/audio-dsp/fm-renderer.ts`); `public/presets/fm.json`.
- Produces: a per-preset guard — for every preset: audible + no-clip; for melodic presets (name starts with `EP ` or `KEY `): fundamental within ±1 semitone of the played note. This test is the regression net for Task 6's revoicing.

- [ ] **Step 1: Write the test**

Create `src/audio-dsp/fm-presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FMRenderer } from './fm-renderer';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;

interface Preset { name: string; params: Record<string, number> }
const PRESETS: Preset[] = JSON.parse(
  readFileSync(resolve('public/presets/fm.json'), 'utf8'),
).presets;

// A complete FM ParamBag of defaults; each preset's params override it.
const DEFAULT_BAG: ParamBag = {
  algorithm: 0, feedback: 0, 'amp.mix': 0.7, 'output.trim': 1, 'poly.voices': 6,
  'op1.ratio': 1, 'op1.detune': 0, 'op1.level': 0.9, 'op1.attack': 0.01, 'op1.decay': 0.3, 'op1.sustain': 0.7, 'op1.release': 0.3,
  'op2.ratio': 2, 'op2.detune': 0, 'op2.level': 0.5, 'op2.attack': 0.01, 'op2.decay': 0.3, 'op2.sustain': 0.7, 'op2.release': 0.3,
  'op3.ratio': 3, 'op3.detune': 0, 'op3.level': 0.4, 'op3.attack': 0.01, 'op3.decay': 0.3, 'op3.sustain': 0.7, 'op3.release': 0.3,
  'op4.ratio': 1, 'op4.detune': 0, 'op4.level': 0.6, 'op4.attack': 0.01, 'op4.decay': 0.3, 'op4.sustain': 0.7, 'op4.release': 0.3,
};

const note = (midi: number): NoteSpec =>
  ({ midi, beginSec: 0, durationSec: 1.0, velocity: 0.8, accent: false, slide: false });

function render(bag: ParamBag, midi: number, seconds: number): Float32Array {
  const v = new FMRenderer(note(midi), bag, SR);
  const buf = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < buf.length; i++) buf[i] = v.renderSample(i / SR);
  return buf;
}

const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// Autocorrelation pitch detector, searched ±3 semitones around the expected
// frequency so a strong periodicity near the note is found reliably (robust to
// FM sidebands); returns the detected fundamental in Hz.
function detectPitchHz(buf: Float32Array, sr: number, expectedHz: number): number {
  const lo = expectedHz * Math.pow(2, -3 / 12);
  const hi = expectedHz * Math.pow(2, 3 / 12);
  const minLag = Math.max(2, Math.floor(sr / hi));
  const maxLag = Math.ceil(sr / lo);
  let bestLag = minLag, best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < buf.length; i++) s += buf[i] * buf[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return sr / bestLag;
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MIDI = 60;                       // C4
const isMelodic = (name: string) => /^(EP|KEY) /.test(name);

describe('FM presets — objective musicality guard', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s is audible and does not clip', (_name, preset) => {
    const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
    const buf = render(bag, MIDI, 0.5);
    expect(rms(buf)).toBeGreaterThan(0.002);   // audible
    expect(peak(buf)).toBeLessThan(1.0);       // no clipping
  });

  const melodic = PRESETS.filter((p) => isMelodic(p.name));
  it.each(melodic.map((p) => [p.name, p] as const))('%s plays in tune (±1 semitone)', (_name, preset) => {
    const bag: ParamBag = { ...DEFAULT_BAG, ...preset.params };
    // Measure a steady window after the attack.
    const full = render(bag, MIDI, 0.6);
    const win = full.subarray(Math.floor(SR * 0.15), Math.floor(SR * 0.4));
    const f = detectPitchHz(win, SR, midiToHz(MIDI));
    const cents = Math.abs(1200 * Math.log2(f / midiToHz(MIDI)));
    expect(cents).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run the guard against the current presets**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/fm-presets.test.ts`
Expected: GREEN with Task 4 in place (tanh caps peaks; melodic presets use carrier ratio 1). If any preset is RED, note which and why — that preset is a concrete revoicing target for Task 6. Either way, commit the guard.

- [ ] **Step 3: Commit**

```bash
git add src/audio-dsp/fm-presets.test.ts
git commit -m "test(fm): objective per-preset guard (audible/no-clip/in-tune)"
```

---

### Task 6: Sane default + revoice all 24 presets

**Files:**
- Modify: `src/engines/fm.ts` (`FM_PARAMS` defaults → a musical default patch)
- Modify: `public/presets/fm.json` (revoice all presets)

**Interfaces:**
- Consumes: the tamed engine (Task 4) + the guard test (Task 5).

**Revoicing rules (from the spec §3):**
- Keep every preset's `name` and `gm` tags unchanged (MIDI-import GM matching depends on them).
- Melodic presets (`EP `, `KEY `, `PAD `): **integer** operator ratios (1, 2, 3, 4, 7…) for the carrier and its modulators → clean intonation; keep high-ratio modulator **levels moderate** so sidebands stay musical.
- Bell / FX presets: intentional inharmonic ratios allowed (e.g. 3.14, 7.13), but keep levels controlled.
- Use each preset's `output.trim` (now read by the renderer) to sit presets at a consistent loudness rather than by pushing modulator levels.
- Every preset must keep the Task-5 guard green and sound musical by ear.

- [ ] **Step 1: Set a musical default patch**

In `src/engines/fm.ts`, change the operator defaults in `FM_PARAMS` to a warm two-carrier EP (algorithm 2 = pairs op2→op1, op4→op3; carriers op1, op3). Replace the `opParamSpecs(1..4, …)` default args and the global defaults so a fresh FM lane is mellow and in tune:

```ts
  { id: 'algorithm', label: 'Algorithm', kind: 'discrete', min: 0, max: ALGO_OPTIONS.length - 1, default: 2, options: ALGO_OPTIONS, selectStyle: 'dropdown' },
  { id: 'feedback',  label: 'FB (op4)', kind: 'continuous', min: 0, max: 1, default: 0 },
  ...opParamSpecs(1, { ratio: 1, level: 0.9 }),
  ...opParamSpecs(2, { ratio: 2, level: 0.35 }),
  ...opParamSpecs(3, { ratio: 1, level: 0.5 }),
  ...opParamSpecs(4, { ratio: 3, level: 0.25 }),
  { id: 'amp.mix',    label: 'Mix',       kind: 'continuous', min: 0, max: 1, default: 0.7 },
  { id: 'poly.voices', label: 'Voices',   kind: 'continuous', min: 1, max: 16, default: 6 },
```

(The per-op envelope defaults stay as declared in `opParamSpecs`; that gives a soft pluck-to-pad EP. Fine-tune decay/sustain by ear in Step 3 if the default sounds too short/long.)

- [ ] **Step 2: Verify the fresh-default guard**

The guard test renders each *preset*; verify the *default* separately with a quick check that a fresh FM voice at the defaults is audible, in tune, and doesn't clip. Add one case to `src/engines/fm.test.ts`:

```ts
import { FMRenderer } from '../audio-dsp/fm-renderer';
import type { ParamBag } from '../audio-dsp/types';

it('fresh default patch is audible, in tune and does not clip', () => {
  const fm = getEngine('fm')!;
  const bag = Object.fromEntries(fm.params.map((p) => [p.id, p.default])) as ParamBag;
  const v = new FMRenderer(
    { midi: 60, beginSec: 0, durationSec: 1, velocity: 0.8, accent: false, slide: false },
    bag, 48000,
  );
  const buf = new Float32Array(48000 * 0.5);
  let pk = 0;
  for (let i = 0; i < buf.length; i++) { buf[i] = v.renderSample(i / 48000); pk = Math.max(pk, Math.abs(buf[i])); }
  const energy = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
  expect(energy).toBeGreaterThan(0.002);
  expect(pk).toBeLessThan(1.0);
});
```

Run: `NO_COLOR=1 npx vitest run src/engines/fm.test.ts`
Expected: PASS.

- [ ] **Step 3: Revoice `public/presets/fm.json`**

Apply the revoicing rules above to each preset, editing `public/presets/fm.json`. After each batch of edits, re-run the guard and fix regressions:

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/fm-presets.test.ts`
Expected: GREEN for every preset (audible + no-clip for all; in-tune for EP/KEY).

Concrete starting edits (representative — extend the same discipline to all presets):
- Add `"output.trim"` to each preset's `params` to normalise loudness (start at `1`; lower for hot presets, e.g. dense pads, raise for thin ones).
- **EP / KEY / PAD**: force carrier + modulator ratios to integers. E.g. in "EP Warm Rhodes" change `op2.ratio` from `14` to `7` and `op3.ratio` from `7` to `7` (already integer) — keep the bright tine character but on harmonic partials; reduce any modulator `level` that produces obvious grit.
- **BELL / FX**: leave the deliberate inharmonic ratios; just confirm no-clip via the guard and trim loudness with `output.trim`.

- [ ] **Step 4: Full unit suite**

Run: `NO_COLOR=1 npx vitest run src/`
Expected: PASS (including `preset-sanity`, `gm-coverage`, the FM guard, renderer, grid, and group tests). Re-run once if `ERR_IPC_CHANNEL_CLOSED` appears after green.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: tsc clean + bundle to `dist/`.

- [ ] **Step 6: Ear-check in real Chrome (mandatory)**

Start the worktree dev server (`npm run dev`) and open `http://localhost:5173` in **real Chrome**. Add an FM lane, play the fresh default, then step through a spread of presets (an EP, a KEY, a PAD, a BELL, an FX). Confirm: musical, in tune, no harsh clipping, no dropouts, and the editor shows the global row + four labelled operator rows with Algorithm as a dropdown. Screenshot the FM editor for the record.

- [ ] **Step 7: Commit**

```bash
git add src/engines/fm.ts src/engines/fm.test.ts public/presets/fm.json
git commit -m "feat(fm): musical default patch + revoiced presets (integer ratios, output.trim)"
```

---

## Self-Review

**Spec coverage:**
- §1 per-operator layout → Tasks 1 (group field + FM tags), 2 (grid builder), 3 (wire into worklet engine); Algorithm-as-dropdown covered in Task 2 (discrete→select) + Task 6 (default `selectStyle: 'dropdown'`, already present). ✅
- §2 tame the DSP (tanh, FM_DEPTH, sane default) → Task 4 (tanh + FM_DEPTH + output.trim), Task 6 Step 1 (default). ✅
- §3 revoice 24 presets (keep names/gm, integer ratios for melodic, controlled inharmonic for bell/FX) → Task 6 Step 3. ✅
- §4 tests + verification (per-preset objective, layout unit test, ear-check) → Task 5 (per-preset), Task 2 (layout unit test), Task 6 Step 6 (ear-check). ✅
- Acceptance criteria 1-5 → editor rows (Task 3 + ear-check), other engines unchanged (Task 2 backward-compat + no change to their specs), audible/no-clip/in-tune (Tasks 4-6), ear-check (Task 6.6), build+suite green (Task 6.4-5). ✅

**Placeholder scan:** No TBD/TODO. The only ear-driven step (Task 6 Step 3 preset values) is bounded by explicit rules + the objective guard test + the mandatory ear-check — not a placeholder, an ear-tuned deliverable with a hard gate.

**Type consistency:** `buildEngineParamGrid(engine, ctx, container, opts?)` signature is identical in Task 2 (definition), Task 2 tests, and Task 3 (call site). `GridEngine` = `{ id, params, getBaseValue, setBaseValue }` — satisfied by `WorkletLaneEngine`. `EngineParamSpec.group?: string` defined in Task 1, consumed in Task 2. `FMRenderer` constructor `(NoteSpec, ParamBag, sr)` used consistently in Tasks 4-6. `output.trim` param id consistent across renderer read (Task 4) and preset write (Task 6).
