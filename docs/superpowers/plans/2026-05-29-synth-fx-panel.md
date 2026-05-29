# Synth FX Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the per-lane COMP + SC ducker UI from the mixer column into a new "FX" section inside each synth page. The underlying audio mechanism on `ChannelStrip` is not touched.

**Architecture:** A new `src/core/lane-fx-panel.ts` module exports `mountLaneFxPanel(opts)` which fills an empty `.lane-fx-knobs` slot inside the active synth page with COMP + SC controls. Knob ids use the `<laneId>.fx.*` convention so they appear in the per-lane modulator destination dropdown and the automation lane painter. `mountLaneFxPanel` is mounted at boot and on every lane switch, in parallel with the existing `mountSubtractiveLaneKnobs` / `mountDrumMasterLaneKnobs` hooks.

**Tech Stack:** TypeScript, Vitest, vanilla DOM. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-29-synth-fx-panel-design.md](../specs/2026-05-29-synth-fx-panel-design.md)

**Plan verified against HEAD on 2026-05-29.** `buildMixerColumn` has the COMP+SC sections at lines 111-112 of [src/core/mixer.ts](../../src/core/mixer.ts). `mountSubtractiveLaneKnobs` is at [src/app/knob-mounting.ts:57](../../src/app/knob-mounting.ts#L57); `mountDrumMasterLaneKnobs` at [src/app/knob-mounting.ts:78](../../src/app/knob-mounting.ts#L78); both are extracted in main.ts at lines 315-316 and called from boot (553/571) and lane-switch hooks (395, 495, 546). Synth pages live in `index.html` at `[data-page="303"]`, `[data-page="poly"]`, `[data-page="drums"]`. `ChannelStrip` exposes `getCompState/setCompState/getSidechain/setSidechain`. `SidechainBus` is constructed in `src/app/audio-graph.ts` and threaded into main.ts via `createAudioGraph()`.

---

## Phase A — Revert mixer column

### Task 1: Strip COMP + SC from the mixer column

**Files:**

- Modify: `src/core/mixer.ts`

- [ ] **Step 1: Delete `buildCompSection` and `buildSidechainSection`**

Open `src/core/mixer.ts`. Delete the entire `buildCompSection` function (currently around lines 181-241) and the entire `buildSidechainSection` function (currently around lines 243-320). Delete the module-local `const fmtRatio = (v: number) => \`${v.toFixed(1)}:1\`;` (currently around line 179) — only consumer is the deleted COMP section.

- [ ] **Step 2: Delete the appendChild calls inside `buildMixerColumn`**

Inside `buildMixerColumn`, delete the two lines (currently 111-112):

```typescript
  col.appendChild(buildCompSection(trackId, strip, deps));
  col.appendChild(buildSidechainSection(trackId, strip, deps));
```

The column order returns to: name → EQ → SEND → PAN → M+S → Fader.

- [ ] **Step 3: Delete dead imports**

At the top of `src/core/mixer.ts`, delete the three import lines that become unused:

```typescript
import { createSelectControl } from './select-control';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';
import type { CompState, SidechainState } from './comp-state';
```

- [ ] **Step 4: Remove `sidechainBus` field from `MixerColumnDeps`**

Delete the `sidechainBus: import('./sidechain-bus').SidechainBus;` line from the `MixerColumnDeps` interface (currently around line 30). Other fields (`stripFor`, `label`, `muteState`, `soloState`, `applyMuteSolo`, `registerKnob`, `historyDeps`) remain.

- [ ] **Step 5: Drop `sidechainBus,` from the `mixerDeps` literal in main.ts**

Open `src/main.ts`. Locate the `mixerDeps` object literal (search for `mixerDeps`). Remove the `sidechainBus,` shorthand line from the literal. Do NOT remove `sidechainBus` from anywhere else in `main.ts` — it's still consumed by `createLaneAllocator` and stays in scope for the new `KnobMounter` wiring in Phase C.

- [ ] **Step 6: Typecheck + fast tests**

Run:

```
npx tsc --noEmit
NO_COLOR=1 npm run test:fast
```

Expected: 0 errors, 0 failures. (Existing tests target audio, not mixer DOM.)

- [ ] **Step 7: Commit**

```
git add src/core/mixer.ts src/main.ts
git commit -m "refactor(mixer): drop COMP+SC sections; revert column to EQ/SEND/PAN/M+S/Fader"
```

---

## Phase B — Build the per-lane FX panel module

### Task 2: New module `src/core/lane-fx-panel.ts`

**Files:**

- Create: `src/core/lane-fx-panel.ts`

- [ ] **Step 1: Scaffold the module**

Create `src/core/lane-fx-panel.ts` with the exports:

```typescript
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';
import type { ChannelStrip } from './fx';
import type { SidechainBus } from './sidechain-bus';

const COMP_COLOR = '#1abc9c';
const SC_COLOR   = '#e74c3c';
const KNOB_SIZE  = 32;

const fmtPct   = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb    = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;
const fmtMs    = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
const fmtMult  = (v: number) => `${v.toFixed(2)}×`;

export interface LaneFxPanelOpts {
  laneId: string;
  strip: ChannelStrip;
  bus: SidechainBus;
  parent: HTMLElement;
  registerKnob: (k: KnobHandle) => void;
  historyDeps?: HistoryDeps;
  lookupLabel?: (laneId: string) => string | undefined;
}

interface KnobCfg {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue?: number;
  color: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function addKnob(parent: HTMLElement, opts: LaneFxPanelOpts, cfg: KnobCfg): void {
  const undoHooks = opts.historyDeps ? attachKnobUndo(opts.historyDeps) : {};
  const k = createKnob({ ...cfg, size: KNOB_SIZE, ...undoHooks });
  parent.appendChild(k.el);
  opts.registerKnob(k);
}

function buildCompSubsection(opts: LaneFxPanelOpts): HTMLElement {
  const { laneId, strip } = opts;
  const sec = document.createElement('div');
  sec.className = 'row poly-section lane-fx-comp';
  const lab = document.createElement('div');
  lab.className = 'section-label';
  lab.textContent = 'COMP';
  sec.appendChild(lab);

  const row = document.createElement('div');
  row.className = 'knob-row';
  sec.appendChild(row);

  const init = strip.getCompState();

  addKnob(row, opts, {
    id: `${laneId}.fx.comp.thr`, label: 'THR', min: -60, max: 0, step: 0.5,
    value: init.threshold, defaultValue: -24, color: COMP_COLOR, format: fmtDb,
    onChange: (v) => strip.setCompState({ threshold: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.rat`, label: 'RAT', min: 1, max: 20, step: 0.1,
    value: init.ratio, defaultValue: 4, color: COMP_COLOR, format: fmtRatio,
    onChange: (v) => strip.setCompState({ ratio: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.atk`, label: 'ATK', min: 0.001, max: 1, step: 0.001,
    value: init.attack, defaultValue: 0.003, color: COMP_COLOR, format: fmtMs,
    onChange: (v) => strip.setCompState({ attack: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.rel`, label: 'REL', min: 0.001, max: 1, step: 0.001,
    value: init.release, defaultValue: 0.25, color: COMP_COLOR, format: fmtMs,
    onChange: (v) => strip.setCompState({ release: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.knee`, label: 'KNEE', min: 0, max: 40, step: 0.5,
    value: init.knee, defaultValue: 30, color: COMP_COLOR, format: fmtDb,
    onChange: (v) => strip.setCompState({ knee: v }),
  });
  addKnob(row, opts, {
    id: `${laneId}.fx.comp.mkup`, label: 'MKUP', min: 0, max: 4, step: 0.01,
    value: init.makeup, defaultValue: 1, color: COMP_COLOR, format: fmtMult,
    onChange: (v) => strip.setCompState({ makeup: v }),
  });

  const byp = document.createElement('button');
  byp.className = 'rnd lane-fx-bypass';
  byp.textContent = 'BYP';
  byp.classList.toggle('active', init.bypass);
  byp.addEventListener('click', () => {
    const next = !strip.getCompState().bypass;
    strip.setCompState({ bypass: next });
    byp.classList.toggle('active', next);
  });
  row.appendChild(byp);

  return sec;
}

function buildSidechainSubsection(opts: LaneFxPanelOpts): HTMLElement {
  const { laneId, strip, bus, lookupLabel } = opts;
  const sec = document.createElement('div');
  sec.className = 'row poly-section lane-fx-sc';
  const lab = document.createElement('div');
  lab.className = 'section-label';
  lab.textContent = 'SC';
  sec.appendChild(lab);

  const row = document.createElement('div');
  row.className = 'knob-row';
  sec.appendChild(row);

  const current = (): import('./comp-state').SidechainState | null => strip.getSidechain();

  const sel = document.createElement('select');
  sel.className = 'lane-fx-sc-src';
  const offOpt = document.createElement('option');
  offOpt.value = '';
  offOpt.textContent = 'off';
  sel.appendChild(offOpt);
  for (const src of bus.listSources(laneId)) {
    const o = document.createElement('option');
    o.value = src.id;
    o.textContent = lookupLabel?.(src.id) ?? src.label ?? src.id;
    sel.appendChild(o);
  }
  sel.value = current()?.source ?? '';
  row.appendChild(sel);

  const knobsBox = document.createElement('div');
  knobsBox.className = 'lane-fx-sc-knobs';
  row.appendChild(knobsBox);

  const reflectSource = () => {
    knobsBox.style.display = current()?.source ? '' : 'none';
  };

  sel.addEventListener('change', () => {
    const v = sel.value;
    const cur = current() ?? { ...DEFAULT_SIDECHAIN_STATE };
    if (v === '') strip.setSidechain(bus, null);
    else          strip.setSidechain(bus, { ...cur, source: v });
    reflectSource();
  });

  addKnob(knobsBox, opts, {
    id: `${laneId}.fx.sc.depth`, label: 'DEPTH', min: 0, max: 1, step: 0.01,
    value: current()?.depth ?? 0.6, defaultValue: 0.6, color: SC_COLOR, format: fmtPct,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(bus, { ...cur, depth: v });
    },
  });
  addKnob(knobsBox, opts, {
    id: `${laneId}.fx.sc.atk`, label: 'ATK', min: 0.001, max: 0.5, step: 0.001,
    value: current()?.attack ?? 0.005, defaultValue: 0.005, color: SC_COLOR, format: fmtMs,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(bus, { ...cur, attack: v });
    },
  });
  addKnob(knobsBox, opts, {
    id: `${laneId}.fx.sc.rel`, label: 'REL', min: 0.005, max: 1, step: 0.005,
    value: current()?.release ?? 0.25, defaultValue: 0.25, color: SC_COLOR, format: fmtMs,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(bus, { ...cur, release: v });
    },
  });

  reflectSource();
  return sec;
}

export function mountLaneFxPanel(opts: LaneFxPanelOpts): void {
  opts.parent.innerHTML = '';
  opts.parent.appendChild(buildCompSubsection(opts));
  opts.parent.appendChild(buildSidechainSubsection(opts));
}
```

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors. (No tests yet; tests come in Task 3.)

- [ ] **Step 3: Commit**

```
git add src/core/lane-fx-panel.ts
git commit -m "feat(lane-fx): mountLaneFxPanel module — COMP + SC controls in horizontal knob-rows"
```

---

### Task 3: Unit-test the panel

**Files:**

- Create: `src/core/lane-fx-panel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/lane-fx-panel.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { mountLaneFxPanel } from './lane-fx-panel';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';
import type { KnobHandle } from './knob';

describe('mountLaneFxPanel', () => {
  let ctx: AudioContext;
  let fx: FxBus;
  let bus: SidechainBus;
  let strip: ChannelStrip;
  let parent: HTMLElement;
  let registered: KnobHandle[];

  beforeEach(() => {
    ctx = new AudioContext();
    fx = new FxBus(ctx, ctx.destination);
    bus = new SidechainBus();
    strip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'tb-303-1', label: '303 1' },
    });
    parent = document.createElement('div');
    registered = [];
  });

  function mount(): void {
    mountLaneFxPanel({
      laneId: 'tb-303-1',
      strip,
      bus,
      parent,
      registerKnob: (k) => registered.push(k),
    });
  }

  it('clears parent and appends COMP + SC subsections', () => {
    parent.innerHTML = '<span>old</span>';
    mount();
    expect(parent.querySelector('.lane-fx-comp')).toBeTruthy();
    expect(parent.querySelector('.lane-fx-sc')).toBeTruthy();
    expect(parent.querySelector('span')).toBeNull();
  });

  it('registers knobs under the <laneId>.fx.* prefix', () => {
    mount();
    const ids = registered.map((k) => k.meta.id);
    expect(ids).toContain('tb-303-1.fx.comp.thr');
    expect(ids).toContain('tb-303-1.fx.comp.mkup');
    expect(ids).toContain('tb-303-1.fx.sc.depth');
  });

  it('moving a COMP knob writes through to strip.getCompState()', () => {
    mount();
    const thr = registered.find((k) => k.meta.id === 'tb-303-1.fx.comp.thr');
    expect(thr).toBeTruthy();
    thr!.setValue(-12);
    expect(strip.getCompState().threshold).toBeCloseTo(-12, 5);
  });

  it('BYP button toggles strip.getCompState().bypass', () => {
    mount();
    const byp = parent.querySelector('.lane-fx-bypass') as HTMLButtonElement;
    expect(strip.getCompState().bypass).toBe(true);
    byp.click();
    expect(strip.getCompState().bypass).toBe(false);
    byp.click();
    expect(strip.getCompState().bypass).toBe(true);
  });

  it('SC SRC select shows other lanes; selecting one writes through to strip.getSidechain().source', () => {
    new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'drums-1', label: 'Drums 1' },
    });
    mount();
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain('');
    expect(opts).toContain('drums-1');
    sel.value = 'drums-1';
    sel.dispatchEvent(new Event('change'));
    expect(strip.getSidechain()?.source).toBe('drums-1');
  });

  it('SC DEPTH/ATK/REL knobs are hidden until a source is selected', () => {
    mount();
    const box = parent.querySelector('.lane-fx-sc-knobs') as HTMLElement;
    expect(box.style.display).toBe('none');

    new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'drums-1', label: 'Drums 1' },
    });
    parent.innerHTML = ''; registered.length = 0; mount();
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    sel.value = 'drums-1';
    sel.dispatchEvent(new Event('change'));
    const box2 = parent.querySelector('.lane-fx-sc-knobs') as HTMLElement;
    expect(box2.style.display).not.toBe('none');
  });

  it('SC SRC label uses lookupLabel when provided', () => {
    new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'drums-1', label: 'DRUMS' },
    });
    parent.innerHTML = '';
    mountLaneFxPanel({
      laneId: 'tb-303-1', strip, bus, parent,
      registerKnob: (k) => registered.push(k),
      lookupLabel: (id) => (id === 'drums-1' ? 'My Drums' : undefined),
    });
    const sel = parent.querySelector('.lane-fx-sc-src') as HTMLSelectElement;
    const drumsOpt = Array.from(sel.options).find((o) => o.value === 'drums-1');
    expect(drumsOpt?.textContent).toBe('My Drums');
  });
});
```

- [ ] **Step 2: Run; expect green**

```
NO_COLOR=1 npx vitest run src/core/lane-fx-panel.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```
git add src/core/lane-fx-panel.test.ts
git commit -m "test(lane-fx): COMP + SC knob wiring, BYP toggle, SRC dropdown, lookupLabel"
```

---

## Phase C — Wire mount lifecycle

### Task 4: Add `mountLaneFxPanel` to `KnobMounter`

**Files:**

- Modify: `src/app/knob-mounting.ts`

- [ ] **Step 1: Extend `KnobMounterDeps`**

Add a field at the end of `KnobMounterDeps`:

```typescript
  sidechainBus: import('../core/sidechain-bus').SidechainBus;
```

- [ ] **Step 2: Extend the `KnobMounter` interface**

Add a method at the end of the interface:

```typescript
  mountLaneFxPanel(laneId: string): void;
```

- [ ] **Step 3: Implement `mountLaneFxPanel` inside `createKnobMounter`**

Add an import near the top:

```typescript
import { mountLaneFxPanel as mountLaneFxPanelInner } from '../core/lane-fx-panel';
```

Inside `createKnobMounter`, after `mountDrumMasterLaneKnobs`, add:

```typescript
  const mountLaneFxPanel = (laneId: string) => {
    const strip = deps.laneResources.get(laneId)?.strip;
    if (!strip) return;
    const slot = document.querySelector('.page:not([hidden]) .lane-fx-knobs') as HTMLElement | null;
    if (!slot) return;
    mountLaneFxPanelInner({
      laneId,
      strip,
      bus: deps.sidechainBus,
      parent: slot,
      registerKnob: (k) => deps.registerKnob(k),
      historyDeps: deps.getHistoryDeps?.(),
      lookupLabel: deps.getLaneDisplayName,
    });
  };
```

Add it to the returned object:

```typescript
  return {
    wireLaneKnobs, mountSubtractiveLaneKnobs, mountDrumMasterLaneKnobs, mountLaneFxPanel,
    refreshKnobsFromSynth, refreshLaneKnobs,
  };
```

- [ ] **Step 4: Typecheck**

```
npx tsc --noEmit
```

Expected: 0 errors. (`main.ts`'s `createKnobMounter` call will fail until Step 5 lands the new `sidechainBus` arg, so this step is expected to show ONE error pointing at the call site. That's the cue for the next step.)

- [ ] **Step 5: Pass `sidechainBus` from main.ts**

Open `src/main.ts`. Find the `createKnobMounter({ ... })` call (search for it). Add `sidechainBus,` to the deps object.

Then add the extraction next to the existing `mountSubtractiveLaneKnobs` / `mountDrumMasterLaneKnobs` extractions (currently around lines 315-316):

```typescript
const mountLaneFxPanel = knobs.mountLaneFxPanel;
```

- [ ] **Step 6: Boot and lane-switch calls in main.ts**

Add a boot call alongside the existing ones at the bottom of the boot section (currently around lines 553/571):

```typescript
mountLaneFxPanel(LANE_ID_POLY);
mountLaneFxPanel(LANE_ID_BASS);
mountLaneFxPanel(LANE_ID_DRUMS);
```

In every place that already calls `mountSubtractiveLaneKnobs(activeLaneId)` or `mountDrumMasterLaneKnobs(active)`, add a parallel `mountLaneFxPanel(activeLaneId)` call. These are at:
- main.ts:395 (the drum-master onActiveLaneChanged handler)
- main.ts:495 (the engine-selector-ui hook)
- main.ts:546 (the refreshPolyKnobsFromState callback)

For each, search for the existing mount call and add the new one right after.

- [ ] **Step 7: Typecheck + fast tests**

```
npx tsc --noEmit
NO_COLOR=1 npm run test:fast
```

Expected: 0 errors, 0 failures.

- [ ] **Step 8: Commit**

```
git add src/app/knob-mounting.ts src/main.ts
git commit -m "feat(lane-fx): wire mountLaneFxPanel into KnobMounter + boot + lane-switch hooks"
```

---

## Phase D — DOM mount + manual smoke

### Task 5: Add the `.lane-fx-knobs` slots in `index.html`

**Files:**

- Modify: `index.html`

- [ ] **Step 1: Add a slot inside each synth page**

In `index.html`, locate `<div class="page" data-page="303" hidden>`, `<div class="page" data-page="poly" hidden>`, and `<div class="page" data-page="drums" hidden>`. Inside EACH of those three pages, at the bottom of the page's content (before the page's closing `</div>`), add:

```html
        <div class="row poly-section">
          <div class="section-label">FX</div>
          <div class="lane-fx-knobs knob-row"></div>
        </div>
```

For the `data-page="poly"` page specifically: place the FX row AFTER the existing engine-specific rows (osc1/osc2/sub/noise/filter/amp/master) and BEFORE the modulators/engine-mod-host injection point and the SEQ MODE row. If unsure, append at the very end of the page's content.

- [ ] **Step 2: Build to verify HTML is valid**

```
npm run build
```

Expected: build succeeds, no parser errors.

- [ ] **Step 3: Commit**

```
git add index.html
git commit -m "feat(html): per-lane FX knob-row in bass/poly/drums pages"
```

---

### Task 6: Manual Playwright smoke

**Files:** none.

- [ ] **Step 1: Start the dev server**

```
npm run dev
```

(Note the chosen port — it picks the first free one starting from 5173.)

- [ ] **Step 2: Open the dev URL in Playwright; visually confirm**

Navigate to the printed local URL. Verify by visual inspection:

- The mixer columns at the bottom of the session view are SHORT — no COMP, no SC. Order: name → EQ → SEND → PAN → M+S → Fader.
- The synth pages (303, poly, drums) each show a new "FX" section near the bottom with COMP + SC subsections.
- COMP shows 6 horizontal knobs + a BYP toggle.
- SC shows a SRC `<select>` and three knobs (DEPTH/ATK/REL) hidden when SRC is "off".
- The SRC `<select>` lists "off" plus the other lanes by their DISPLAY names (e.g. "Drums 1", "Sub 1"), NOT the legacy "BASS/POLY/DRUMS".
- Toggling BYP changes its `.active` class.
- Switching between lane tabs rebuilds the FX section so the knobs reflect the new lane's COMP state.

- [ ] **Step 3: No commit unless an unexpected fix was needed**

If the smoke uncovers a small bug (e.g., the FX slot is in the wrong page), fix it minimally and commit the fix as a follow-up.

---

## Phase E — Full verification + finish

### Task 7: Full suite + build

**Files:** none.

- [ ] **Step 1: Confirm clean tree**

```
git status
```

Expected: clean.

- [ ] **Step 2: Fetch + rebase onto main**

```
git fetch origin 2>/dev/null; git rebase main
```

(No origin remote in this repo; the rebase against local `main` is the load-bearing step. Per the memory: rebase before merging back is unconditional.)

- [ ] **Step 3: Full suite**

```
NO_COLOR=1 npm run test:fast
NO_COLOR=1 npm run test:dsp
npm run build
NO_COLOR=1 npm run test:e2e
```

Expected: all green. If e2e fails on the pre-existing TDZ fix (already on main), no extra work; otherwise diagnose.

- [ ] **Step 4: Hand off**

Branch is ready to merge. Use `superpowers:finishing-a-development-branch` or fast-forward main from the main worktree:

```
git -C C:/Users/nacho/git/tb303-synth merge --ff-only worktree-synth-fx-panel
```

Then remove the worktree + branch.

---

## Risks called out for the implementer

- **Lane-switch ordering**: `mountLaneFxPanel(activeLaneId)` must run AFTER `unregisterKnobsByPrefix(<oldLaneId>.)`. Verify by inspecting `engine-selector-ui.ts:42-67` — the existing subtractive mount already runs after the unregister, so co-locating the new call gets the order right by construction.
- **`.lane-fx-knobs` class vs id**: classes (not ids) prevent duplicate-id violations across the three synth pages. `mountLaneFxPanel` queries `'.page:not([hidden]) .lane-fx-knobs'` to target the active page's slot. If multiple pages were visible simultaneously, only the first match would be hit — that doesn't happen today (page switching is mutually exclusive), but it's worth knowing.
- **No SidechainBus subscribe**: the SRC `<select>` options are baked at mount time. Lane add/remove triggers a session-host rebuild path, which in turn re-runs the mount; no live subscription needed and no leak.
- **Mixer column tests**: existing pure tests target audio state, not DOM. No fixture updates needed. The `session-host-presets.test.ts` uses `mixerDeps: {} as never` — the cast still satisfies the narrower interface.
