# Session view reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder Loom's Session view to scenes → synth → clip, fold the lane selector into the grid column headers (active column marked, collapsible synth via a chevron), and replace the lane-tabs row's add controls with a single `+` engine menu that includes Audio channel.

**Architecture:** No new subsystem. Promote the existing per-lane `laneHeader()` in `renderSessionGrid` into the lane selector; add a UI-only `synthCollapsed` flag on `SessionHost` (mirrors `masterFxOpen`); relocate the `.page` engine editors in the DOM to sit between `#session-grid` and `#session-inspector`; delete the `#synth-tabs` row (`renderSessionTabBar`).

**Tech Stack:** TypeScript, Vite, Web Audio; Vitest (`@vitest-environment jsdom`) for DOM-construction tests; SCSS partials.

**Spec:** [2026-07-12-session-view-reorder-design.md](../specs/2026-07-12-session-view-reorder-design.md) · **Approved mockup:** [2026-07-12-session-view-reorder-mockup.html](../specs/2026-07-12-session-view-reorder-mockup.html)

## Global Constraints

- UI text (labels, titles, menu items) in **English**. Spanish only in conversation, never in the product.
- Source files ≤300 lines target, 500 hard cap. `session-ui.ts` is ~330 lines today — keep new logic tight; extract a helper module if a single function balloons.
- Assertions in DSP/behaviour tests are **relative**, never absolute magnitudes (N/A here — these are DOM-structure tests).
- Run tests colour-free: `NO_COLOR=1 npx vitest run <file>`.
- Do **not** touch audio, scheduling, persistence, or scene/clip/mixer behaviour.
- Do **not** merge to `main` — stop at a green branch and ask.
- The manual (prose + screenshots) is **out of scope** — a separate spec owns the full 62-commit refresh, including regenerating all screenshots.

---

### Task 1: Column header is the lane selector + active-column marking

Promote `laneHeader` to a click-to-edit selector and let `renderSessionGrid` mark the active lane's header + clip cells. Add an options arg carrying `activeEditLane`/`synthCollapsed`.

**Files:**
- Modify: `src/session/session-ui.ts` (`renderSessionGrid` signature + `laneHeader`; clip-cell `col-active`)
- Test: `src/session/session-ui-reorder.test.ts` (create)

**Interfaces:**
- Produces: `renderSessionGrid(host, state, laneStates, cb, openClip?, opts?: RenderGridOpts)` where `interface RenderGridOpts { activeEditLane?: string | null; synthCollapsed?: boolean }` (exported).
- Produces: active lane's header gets class `session-lane-header-active`; its `.session-lane-name` gets `session-lane-name-active`; every clip cell of the active lane gets `session-cell-col-active`.
- Consumes: `cb.onEditLane(laneId)` (already in `SessionUICallbacks`).

- [ ] **Step 1: Write the failing test**

Append to a new file `src/session/session-ui-reorder.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSessionGrid, _resetSceneClickStateForTesting } from './session-ui';
import { makeState, noopCallbacks } from './session-ui-rename.test';
import type { LanePlayState } from './session-runtime';

beforeEach(() => _resetSceneClickStateForTesting());

describe('column header as lane selector', () => {
  it('a single click on the lane header edits that lane', () => {
    const host = document.createElement('div');
    const onEditLane = vi.fn();
    renderSessionGrid(host, makeState(), new Map<string, LanePlayState>(), noopCallbacks({ onEditLane }));
    const header = host.querySelector('.session-lane-header[data-lane-id="bass"]') as HTMLElement;
    header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onEditLane).toHaveBeenCalledWith('bass');
  });

  it('marks the active lane header + its clip cells', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks(), undefined, { activeEditLane: 'bass' });
    const header = host.querySelector('.session-lane-header[data-lane-id="bass"]') as HTMLElement;
    expect(header.classList.contains('session-lane-header-active')).toBe(true);
    const cell = host.querySelector('.session-cell[data-lane-id="bass"][data-clip-idx="0"]') as HTMLElement;
    expect(cell.classList.contains('session-cell-col-active')).toBe(true);
  });

  it('marks no header when there is no active lane', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks());
    expect(host.querySelectorAll('.session-lane-header-active').length).toBe(0);
    expect(host.querySelectorAll('.session-cell-col-active').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-reorder.test.ts`
Expected: FAIL — header click does not call `onEditLane` (only the removed `⚙` did), and `session-lane-header-active` / `session-cell-col-active` do not exist.

- [ ] **Step 3: Implement**

In `src/session/session-ui.ts`:

Add near the scene-click state (top of file):

```ts
// Single-vs-double click disambiguation for lane headers, keyed by lane id —
// same rationale as sceneLastClick (a select re-renders the header, so the
// second click of a rename double lands on a fresh element).
const laneLastClick = new Map<string, number>();
const LANE_DBLCLICK_MS = 350;
```

Extend `_resetSceneClickStateForTesting` to also clear it:

```ts
export function _resetSceneClickStateForTesting(): void { sceneLastClick.clear(); laneLastClick.clear(); }
```

Add the exported options type and thread it through the signature + header/cell calls:

```ts
export interface RenderGridOpts { activeEditLane?: string | null; synthCollapsed?: boolean }

export function renderSessionGrid(
  host: HTMLElement,
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  openClip?: ClipSlot,
  opts: RenderGridOpts = {},
): void {
```

In the header-row loop, pass the active flag:

```ts
  for (const lane of state.lanes) headerRow.appendChild(laneHeader(lane, cb, lane.id === opts.activeEditLane, !!opts.synthCollapsed));
```

In the body-row loop, pass the active flag to each cell:

```ts
    for (const lane of state.lanes) row.appendChild(clipCell(lane, r, laneStates, cb, state, openClip, lane.id === opts.activeEditLane));
```

Rewrite `laneHeader` to be the click target and drop the `⚙` button:

```ts
function laneHeader(lane: SessionLane, cb: SessionUICallbacks, isActive: boolean, synthCollapsed: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `session-lane-header lane-engine-${lane.engineId}`;
  if (isActive) el.classList.add('session-lane-header-active');
  el.dataset.laneId = lane.id;
  el.title = 'Click to edit this instrument · double-click the name to rename';
  el.appendChild(deleteCross('Delete track', () => cb.onDeleteLane(lane.id)));

  const name = document.createElement('div');
  name.className = isActive ? 'session-lane-name session-lane-name-active' : 'session-lane-name';
  name.textContent = lane.name ?? lane.id.toUpperCase();
  el.appendChild(name);

  // Whole header selects the lane (opens its editor). A quick second click
  // renames instead — index-timed like the scene launch, because the select
  // re-renders the grid and the rename must land on the fresh element.
  el.addEventListener('click', () => {
    const now = performance.now();
    const prev = laneLastClick.get(lane.id);
    if (prev !== undefined && now - prev < LANE_DBLCLICK_MS) {
      laneLastClick.delete(lane.id);
      beginInlineRename(name, lane.name ?? lane.id.toUpperCase(), { commit: (v) => cb.onRenameLane?.(lane.id, v) });
    } else {
      laneLastClick.set(lane.id, now);
      cb.onEditLane(lane.id);
    }
  });

  el.addEventListener('contextmenu', (e) =>
    openContextMenu(e, [
      { label: 'Rename track', onSelect: () => beginInlineRename(name, lane.name ?? lane.id.toUpperCase(), { commit: (v) => cb.onRenameLane?.(lane.id, v) }) },
      { label: 'Edit instrument', onSelect: () => cb.onEditLane(lane.id) },
      { label: 'Duplicate track', onSelect: () => cb.onDuplicateLane(lane.id) },
      { label: 'Stop track', onSelect: () => cb.onStopLane(lane.id) },
      { label: 'Delete track', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteLane(lane.id) },
    ]),
  );

  return el;
}
```

Give `clipCell` the extra param and apply the class (signature + one line):

```ts
function clipCell(
  lane: SessionLane,
  rowIdx: number,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  state: SessionState,
  openClip?: ClipSlot,
  colActive = false,
): HTMLElement {
  const clip: SessionClip | null = lane.clips[rowIdx] ?? null;
  const cell = document.createElement('div');
  cell.className = 'session-cell';
  if (colActive) cell.classList.add('session-cell-col-active');
```

(The `beginInlineRename` import already exists; the removed `⚙`/`session-lane-edit` button and its `edit` handler are deleted with the rewrite.)

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-reorder.test.ts src/session/session-ui-rename.test.ts`
Expected: PASS (new selector tests + the existing rename/open-clip tests stay green — the rename test drives `.session-lane-name` double-click, still supported via the index-timed path when dispatched as two clicks; if the existing test dispatches a raw `dblclick`, update it in this task to two `click`s as shown in `session-ui-rename.test.ts` `it('a quick second click…')`).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-ui.ts src/session/session-ui-reorder.test.ts src/session/session-ui-rename.test.ts
git commit -m "feat(session-ui): lane column header is the lane selector + active-column marking"
```

---

### Task 2: Collapse chevron on the active header

Render a `▾`/`▸` chevron on the active header; clicking it calls a new `onToggleSynthEditor` callback (and never selects).

**Files:**
- Modify: `src/session/session-ui-types.ts` (add `onToggleSynthEditor?`)
- Modify: `src/session/session-ui.ts` (`laneHeader`)
- Test: `src/session/session-ui-reorder.test.ts` (extend)

**Interfaces:**
- Produces: `SessionUICallbacks.onToggleSynthEditor?: () => void`.
- Produces: active header contains `button.session-lane-collapse` with text `▾` when open / `▸` when `synthCollapsed`.

- [ ] **Step 1: Write the failing test**

Append to `src/session/session-ui-reorder.test.ts`:

```ts
describe('synth collapse chevron', () => {
  it('shows a chevron only on the active header and toggles via onToggleSynthEditor', () => {
    const host = document.createElement('div');
    const onToggleSynthEditor = vi.fn();
    const onEditLane = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onToggleSynthEditor, onEditLane }), undefined, { activeEditLane: 'bass' });
    const chevron = host.querySelector('.session-lane-header-active .session-lane-collapse') as HTMLButtonElement;
    expect(chevron).toBeTruthy();
    expect(chevron.textContent).toBe('▾');
    chevron.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleSynthEditor).toHaveBeenCalledTimes(1);
    expect(onEditLane).not.toHaveBeenCalled(); // chevron must not also select
  });

  it('shows ▸ when the synth is collapsed', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks(), undefined, { activeEditLane: 'bass', synthCollapsed: true });
    const chevron = host.querySelector('.session-lane-collapse') as HTMLButtonElement;
    expect(chevron.textContent).toBe('▸');
  });

  it('renders no chevron on inactive headers', () => {
    const host = document.createElement('div');
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks(), undefined, { activeEditLane: null });
    expect(host.querySelectorAll('.session-lane-collapse').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-reorder.test.ts`
Expected: FAIL — `.session-lane-collapse` does not exist and `onToggleSynthEditor` is not a callback.

- [ ] **Step 3: Implement**

In `src/session/session-ui-types.ts`, add to `SessionUICallbacks`:

```ts
  /** Collapse / reopen the synth editor of the active lane (the header chevron). */
  onToggleSynthEditor?: () => void;
```

In `laneHeader` (after appending `name`, before the click handler), add the chevron only when active:

```ts
  if (isActive) {
    const chevron = document.createElement('button');
    chevron.className = 'session-lane-collapse';
    chevron.textContent = synthCollapsed ? '▸' : '▾';
    chevron.title = synthCollapsed ? 'Show the instrument editor' : 'Collapse the instrument editor';
    chevron.addEventListener('pointerdown', (e) => e.stopPropagation());
    chevron.addEventListener('pointerup', (e) => e.stopPropagation());
    chevron.addEventListener('click', (e) => { e.stopPropagation(); cb.onToggleSynthEditor?.(); });
    el.appendChild(chevron);
  }
```

Add `onToggleSynthEditor() {}` to the `noopCallbacks` factory in `session-ui-rename.test.ts` so fixtures compile.

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-reorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-ui.ts src/session/session-ui-types.ts src/session/session-ui-rename.test.ts src/session/session-ui-reorder.test.ts
git commit -m "feat(session-ui): collapse chevron on the active lane header"
```

---

### Task 3: `+` engine menu in the header row (Audio channel included)

Replace the scenes-header spacer position's add affordance: add a `+` control to the grid header row that opens a menu listing every polyhost engine plus an **Audio channel** entry.

**Files:**
- Modify: `src/session/session-ui.ts` (`renderSessionGrid` header row — add the `+` cell + menu)
- Test: `src/session/session-ui-reorder.test.ts` (extend)

**Interfaces:**
- Consumes: `cb.onAddLane(engineId)`, `cb.onAddAudioChannel?()` (both already in `SessionUICallbacks`); `listEngines('polyhost')` from `../engines/registry`.
- Produces: `button.session-lane-add` in the header row; clicking it renders `.session-lane-add-menu` with `.session-add-item` entries; the last entry is `Audio channel`.

- [ ] **Step 1: Write the failing test**

Append to `src/session/session-ui-reorder.test.ts`:

```ts
describe('+ add-lane engine menu', () => {
  it('opens a menu whose Audio channel entry calls onAddAudioChannel', () => {
    const host = document.createElement('div');
    const onAddAudioChannel = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onAddAudioChannel }));
    (host.querySelector('.session-lane-add') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const items = Array.from(host.querySelectorAll('.session-add-item')) as HTMLElement[];
    const audio = items.find((i) => /audio channel/i.test(i.textContent ?? ''));
    expect(audio).toBeTruthy();
    audio!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onAddAudioChannel).toHaveBeenCalledTimes(1);
  });

  it('an engine entry calls onAddLane with the engine id', () => {
    const host = document.createElement('div');
    const onAddLane = vi.fn();
    renderSessionGrid(host, makeState(), new Map(), noopCallbacks({ onAddLane }));
    (host.querySelector('.session-lane-add') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const item = host.querySelector('.session-add-item[data-engine-id]') as HTMLElement;
    const id = item.dataset.engineId!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onAddLane).toHaveBeenCalledWith(id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-reorder.test.ts`
Expected: FAIL — `.session-lane-add` does not exist.

- [ ] **Step 3: Implement**

Add the import at the top of `src/session/session-ui.ts`:

```ts
import { listEngines } from '../engines/registry';
```

In `renderSessionGrid`, replace the header-row assembly so a `+` cell sits before the scenes header:

```ts
  headerRow.appendChild(spacer());
  for (const lane of state.lanes) headerRow.appendChild(laneHeader(lane, cb, lane.id === opts.activeEditLane, !!opts.synthCollapsed));
  headerRow.appendChild(addLaneHeader(cb));
  headerRow.appendChild(scenesHeader());
```

Add the `addLaneHeader` builder (a nested function inside `renderSessionGrid`, next to `scenesHeader`, so it closes over `cb`):

```ts
  function addLaneHeader(cb: SessionUICallbacks) {
    const wrap = document.createElement('div');
    wrap.className = 'session-lane-add-wrap';
    const btn = document.createElement('button');
    btn.className = 'session-lane-add';
    btn.textContent = '+';
    btn.title = 'Add a lane';
    const menu = document.createElement('div');
    menu.className = 'session-lane-add-menu';
    menu.hidden = true;

    const addItem = (label: string, onClick: () => void, engineId?: string) => {
      const it = document.createElement('button');
      it.className = 'session-add-item';
      if (engineId) it.dataset.engineId = engineId;
      it.textContent = label;
      it.addEventListener('click', () => { menu.hidden = true; onClick(); });
      menu.appendChild(it);
    };
    for (const engine of listEngines('polyhost')) {
      if (engine.id === 'audio') continue; // audio is added via the explicit entry below
      addItem(engine.name, () => cb.onAddLane(engine.id), engine.id);
    }
    if (cb.onAddAudioChannel) addItem('Audio channel', () => cb.onAddAudioChannel!());

    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    wrap.append(btn, menu);
    return wrap;
  }
```

Note: the column template `--session-cols` (`24px repeat(n,120px) 140px`) already ends with a wide scenes column; the `+` cell is narrow content inside the header row — verify visually it doesn't distort the grid; if needed, adjust the template in Task 6 to `24px repeat(n,120px) 40px 140px` and mirror the extra 40px column in every body row's assembly. (Keep this as a Task 6 layout concern; the unit test only checks behaviour, not columns.)

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-ui-reorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-ui.ts src/session/session-ui-reorder.test.ts
git commit -m "feat(session-ui): + engine menu in the grid header (Audio channel included)"
```

---

### Task 4: SessionHost — collapse state, pass render opts, drop synth-tabs

Wire the new grid opts and collapse toggle into the host; stop building the `#synth-tabs` row; mark the active lane's mixer column.

**Files:**
- Modify: `src/session/session-host.ts` (`synthCollapsed` + `toggleSynthEditor`; `render()` passes opts; `renderWithMixer()` marks active mixer column; remove `refreshSynthTabs`)

**Interfaces:**
- Consumes: `renderSessionGrid(..., opts)`, `SessionUICallbacks.onToggleSynthEditor`.
- Produces: `SessionHost.synthCollapsed: boolean`, `SessionHost.toggleSynthEditor(): void`.

- [ ] **Step 1: Add the flag + toggle**

In `session-host.ts`, beside `masterFxOpen = false;`:

```ts
  /** UI-only (NOT serialized): whether the active lane's synth editor is
   *  collapsed. Only the header chevron sets it; selecting a lane clears it. */
  synthCollapsed = false;

  /** Toggle the active lane's synth editor collapsed/open (the header chevron).
   *  Hides/shows the .page and re-renders so the chevron + column marking update. */
  toggleSynthEditor(): void {
    this.synthCollapsed = !this.synthCollapsed;
    document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
      if (this.synthCollapsed) p.hidden = true;
    });
    if (!this.synthCollapsed && this.activeEditLane) this.showLaneEditor(this.activeEditLane);
    this.renderWithMixer();
  }
```

- [ ] **Step 2: Pass opts into the grid render**

In `render()`, extend the `renderSessionGrid` call:

```ts
    renderSessionGrid(hostEl, this.state, this.laneStates, this.callbacks, openClip,
      { activeEditLane: this.activeEditLane, synthCollapsed: this.synthCollapsed });
```

- [ ] **Step 3: Mark the active mixer column**

In `renderWithMixer()`, after `row.appendChild(buildMixerColumn(lane.id, this.deps.mixerDeps));`, tag the active one. Replace the lane loop body with:

```ts
    for (const lane of this.state.lanes) {
      const col = buildMixerColumn(lane.id, this.deps.mixerDeps);
      if (lane.id === this.activeEditLane) col.classList.add('session-mixer-col-active');
      row.appendChild(col);
    }
```

- [ ] **Step 4: Remove the synth-tabs row build**

Delete the `refreshSynthTabs()` method and its call sites (in `init()`, `renderWithMixer()`, and anywhere else); remove the `renderSessionTabBar` import. Wire `onToggleSynthEditor` into the callbacks: in `buildSessionCallbacks` (`session-host-callbacks.ts`) add `onToggleSynthEditor: () => host.toggleSynthEditor()`.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors (the `#synth-tabs` element removal happens in Task 6; until then the host just stops populating it — harmless).

- [ ] **Step 6: Commit**

```bash
git add src/session/session-host.ts src/session/session-host-callbacks.ts
git commit -m "feat(session-host): synth collapse state + active mixer column, drop synth-tabs build"
```

---

### Task 5: showLaneEditor — drop the tab toggle, honour collapse, mark the header

**Files:**
- Modify: `src/session/session-host-lane-editor.ts` (`showLaneEditor`)

**Interfaces:**
- Consumes: `self.synthCollapsed`, `self.renderWithMixer()`.

- [ ] **Step 1: Implement**

In `showLaneEditor`, remove the `.session-lane-tab` branch of the `.tab` toggle (there is no tab bar). Replace the `document.querySelectorAll('.tab')...` block with a page-only version (the poly/303/drums page toggle stays):

```ts
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === targetTab && !t.classList.contains('synth-tab'));
  });
```

At the top of the page-showing branch, honour collapse — if `self.synthCollapsed`, keep every `.page` hidden:

```ts
  } else {
    document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
      p.hidden = self.synthCollapsed || p.dataset.page !== targetTab;
    });
```

and mirror the guard in the `showPolyEditor` branch by early-hiding when collapsed (add before `self.deps.showPolyEditor(...)`):

```ts
    if (self.synthCollapsed) document.querySelectorAll<HTMLElement>('.page').forEach((p) => { p.hidden = true; });
    else self.deps.showPolyEditor(laneId, polyTarget, displayName);
```

Selecting a lane should clear a stale collapse so a click always opens the editor — set `self.synthCollapsed = false;` at the very top of `showLaneEditor` (before the page logic). End the function with a grid refresh so the active column marks: ensure the host's `onEditLane` path calls `renderWithMixer()` (it already does via `focusLane`; if `onEditLane` does not run through `focusLane`, add `self.renderWithMixer()` at the end of `showLaneEditor`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify active-lane test still green**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-active-lane.test.ts`
Expected: PASS (update the test if it asserted on `.session-lane-tab` active state — assert on `.session-lane-header-active` instead).

- [ ] **Step 4: Commit**

```bash
git add src/session/session-host-lane-editor.ts src/session/session-host-active-lane.test.ts
git commit -m "feat(session-host): route lane selection through the grid header, honour collapse"
```

---

### Task 6: Layout — relocate the engine editors, flex order, remove #synth-tabs (index.html + SCSS)

**Files:**
- Modify: `index.html` (move `.page` blocks into `.session-view`; remove `#synth-tabs`/`.synth-row` + empty `.tab-bar`; drop dead `order:` rules)
- Modify: `src/styles/_session-grid.scss` (`.session-view` flex column; header-as-button, active label, `col-active` wash, chevron, `+` menu; remove `.synth-row` rules)

- [ ] **Step 1: index.html — relocate + prune**

Move the three `<div class="page" data-page="303|drums|poly">…</div>` blocks so they sit **inside** `.session-view#session-view`, between `<div id="session-grid">` and `<div id="session-inspector">`. Delete the `<div class="tab-bar"></div>` and `<div class="synth-row" id="synth-tabs"></div>` lines. In the inline `<style>`, delete the now-dead rules:

```
.synth > .tab-bar { order: 1; }
.synth > .synth-row { order: 2; }
.synth > .page { order: 3; }
.synth > .session-view { order: 4; }
```

- [ ] **Step 2: SCSS — layout + look**

In `src/styles/_session-grid.scss`, make the view a column and add the new styles (append):

```scss
.session-view { display: flex; flex-direction: column; gap: 10px; padding: 8px; }
#session-grid { order: 0; }
.session-view .page { order: 1; }
#session-inspector { order: 2; }
#master-fx-panel { order: 3; }

.session-lane-header { cursor: pointer; }
.session-lane-header:hover { border-color: var(--amber-soft); }
.session-lane-name-active { color: var(--z-synths, #5bb8c4); font-weight: 600; }
.session-lane-header-active { box-shadow: inset 0 -2px 0 var(--z-synths, #5bb8c4); }
.session-cell-col-active,
.session-mixer-col-active {
  background-image: linear-gradient(rgba(91,184,196,0.12), rgba(91,184,196,0.12));
}
.session-lane-collapse {
  margin-left: 4px; background: transparent; border: 1px solid var(--z-synths, #5bb8c4);
  color: var(--z-synths, #5bb8c4); border-radius: 3px; font-size: 11px; line-height: 1; cursor: pointer;
}
.session-lane-add-wrap { position: relative; }
.session-lane-add {
  background: transparent; border: 1px dashed var(--border-soft); color: var(--text-faint);
  border-radius: 4px; cursor: pointer; padding: 4px 8px;
}
.session-lane-add:hover { color: var(--amber); border-color: var(--amber-soft); }
.session-lane-add-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
  display: flex; flex-direction: column; gap: 2px; min-width: 150px;
  background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; padding: 5px;
  box-shadow: 0 10px 26px rgba(0,0,0,0.55);
}
.session-lane-add-menu[hidden] { display: none; }
.session-add-item {
  text-align: left; background: transparent; border: none; color: var(--text-dim);
  padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.session-add-item:hover { background: var(--surface-2); color: var(--text); }
```

Define `--z-synths` once in `src/styles/_design-tokens.scss` (`--z-synths: #5bb8c4;`) so the fallback isn't needed, and remove any dead `.synth-row` rules (search `.synth-row` in the partials).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: typecheck + bundle succeed.

- [ ] **Step 4: Commit**

```bash
git add index.html src/styles/_session-grid.scss src/styles/_design-tokens.scss
git commit -m "feat(session): scenes -> synth -> clip order; header selector styles; drop lane-tabs row"
```

---

### Task 7: Delete session-tab-bar.ts + clean references; suite + typecheck green

**Files:**
- Delete: `src/session/session-tab-bar.ts`
- Modify: any remaining importers/tests (`renderSessionTabBar`, `SessionTabBarDeps`)

- [ ] **Step 1: Find references**

Run: `NO_COLOR=1 npx vitest run --reporter=dot 2>/dev/null; git grep -n "session-tab-bar\|renderSessionTabBar\|SessionTabBarDeps\|synth-tabs\|session-lane-tab\|session-lane-edit"`
Expected: a list of remaining references to clean.

- [ ] **Step 2: Remove + fix**

Delete `src/session/session-tab-bar.ts`. Remove its import in `session-host.ts` (already dropped in Task 4 — confirm). Delete or rewrite any test asserting on `#synth-tabs` / `.session-lane-tab` / `.session-lane-edit` / `renderSessionTabBar` to target the new surfaces.

- [ ] **Step 3: Full typecheck + unit suite**

Run: `npx tsc --noEmit` then `npm run test:unit`
Expected: typecheck clean; unit suite green (a `ERR_IPC_CHANNEL_CLOSED` teardown after all-pass is not a failure — re-run to confirm).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(session): remove dead session-tab-bar + stale selectors"
```

---

### Task 8: Visual parity check (mandatory human look) + branch finish

**Files:** none (verification)

- [ ] **Step 1: Build + serve**

Run: `npm run build` then `npm run dev` (worktree serves its own on :5173).

- [ ] **Step 2: Human verification against the mockup**

In a real Chrome (not the VS Code embedded browser — audio/rendering fidelity), confirm:
1. Vertical order is scenes → synth → clip.
2. Clicking a lane column header opens that lane's editor; no separate lane-tabs row exists.
3. The active lane's column is marked (header label cyan + column/mixer wash).
4. The header chevron `▾` collapses the synth and `▸` reopens it; clicking the header itself only selects.
5. The `+` opens an engine menu that includes Audio channel and adds lanes.
Take a screenshot and compare side-by-side with [the approved mockup](../specs/2026-07-12-session-view-reorder-mockup.html).

- [ ] **Step 3: Rebase + stop for merge permission**

Run: `git rebase main` (resolve any conflicts), confirm suite green, then **STOP** and ask the user before `git merge --ff-only` (do not merge to main without explicit permission).

- [ ] **Step 4: Note follow-up**

The manual (prose + screenshots) refresh — auditing `d022e54..HEAD` (62 commits) — is a separate spec/plan and is **not** part of this branch.

## Self-Review

- **Spec coverage:** order (Task 6) ✓; header-as-selector (Task 1) ✓; active-column marking (Tasks 1, 4, 6) ✓; chevron collapse (Tasks 2, 4, 5) ✓; `+` engine menu incl Audio channel (Task 3) ✓; remove lane-tabs row (Tasks 4, 6, 7) ✓; visual parity (Task 8) ✓; manual deferred (Task 8 note + Global Constraints) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows code; the one "adjust column template if needed" is an explicit, bounded Task 6 layout check, not a hidden gap.
- **Type consistency:** `RenderGridOpts { activeEditLane?: string|null; synthCollapsed?: boolean }` defined in Task 1 and consumed identically in Task 4; `onToggleSynthEditor?: () => void` defined in Task 2 and wired in Task 4; class names (`session-lane-header-active`, `session-lane-name-active`, `session-cell-col-active`, `session-mixer-col-active`, `session-lane-collapse`, `session-lane-add`, `session-add-item`) are used identically across tasks and SCSS.
