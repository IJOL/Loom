# Lane Selection Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The clip editor and the instrument controls can never show two different lanes.

**Architecture:** `SessionHost.focusLane` becomes the single funnel every lane-selection path goes through. It paints the instrument page (via the existing `showLaneEditor`) and then moves the clip editor to the same lane using one new pure function. The mixer column gains a click-to-select dead zone, the clip editor header gains mute/solo sharing the mixer's own state, and the historical "poly" name becomes "instrument".

**Tech Stack:** TypeScript, Vite, lit-html, Vitest (jsdom + node), Playwright.

**Spec:** [2026-08-07-lane-selection-coherence-design.md](../specs/2026-08-07-lane-selection-coherence-design.md)

## Global Constraints

- **No clip is ever created by a lane switch.** An empty slot closes the editor.
- **No migrations.** Saved sessions and `localStorage` shapes are untouched.
- **Never rename** `polyBlep`, `polyphony`, or `POLY_PRESETS_KEY = 'tb303-poly-presets-v1'`.
- **Assertions are relative**, never absolute magnitudes (project rule).
- **One test per user path.** No `(or …)` alternatives in a test.
- **File size:** 300 code lines target, 500 hard cap (comments and blanks do not count).
- **Commit messages in English.** Always via a Bash heredoc, never a PowerShell here-string.
- **`npm run build` before `npm run test:e2e`** — e2e serves `dist/` with no build step.
- **Unit tests:** `NO_COLOR=1 npx vitest run <path>` for a single file; never add `--reporter=`.
- **Rebase onto `main` after every task.** Another session is actively editing `src/core/mixer.ts` (commit `6cb5bd0` landed mid-design), which Task 3 touches.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/session/session-host-util.ts` | gains `clipToShowOnLaneSwitch`; keeps `shouldCloseClipEditorOnLaneSwitch` | 2 |
| `src/session/session-host.ts` | `focusLane` becomes the funnel; gains `syncClipEditorToLane` | 1, 2 |
| `src/session/session-host-lane-editor.ts` | loses its `closeIfOtherLane` call — the funnel owns that now | 1 |
| `src/core/mixer.ts` | `MixerColumnDeps.onSelect` + the column's click handler | 3 |
| `src/session/session-inspector.ts` | mute/solo buttons in the clip header | 4 |
| `index.html` | `#insp-mute` / `#insp-solo`; the `poly-*` id rename | 4, 5 |
| `src/session/lane-focus.test.ts` | **new** — the funnel's jsdom tests | 1, 2 |
| `src/core/mixer-select.test.ts` | **new** — the column's click rules | 3 |
| `src/session/inspector-mute-solo.test.ts` | **new** — shared mute/solo state | 4 |

---

## Task 1: `focusLane` becomes the single funnel

Today two functions select a lane and only one tells the clip editor.
`showLaneEditor` closes another lane's clip; `focusLane` says nothing. This task
merges them without changing any visible behaviour — the clip still just
*closes*; Task 2 makes it *follow*.

**Files:**
- Modify: `src/session/session-host.ts` (`focusLane`, `showLaneEditor`)
- Modify: `src/session/session-host-lane-editor.ts` (remove the `closeIfOtherLane` call)
- Modify: `src/session/session-host.ts` (`onClipFocused` wiring in `init()`)
- Test: `src/session/lane-focus.test.ts` (create)

**Interfaces:**
- Consumes: `SessionInspector.closeIfOtherLane(laneId)`, `SessionInspector.getSelectedClip()`, `showLaneEditor(self, laneId)` (the free function in `session-host-lane-editor.ts`, imported as `showLaneEditorImpl`).
- Produces: `type LaneFocusOrigin = 'lane' | 'clip'` and `SessionHost.focusLane(laneId: string, origin?: LaneFocusOrigin): void`, exported from `src/session/session-host.ts`. Task 2 adds `syncClipEditorToLane` behind the same funnel.

**Why `origin` exists:** opening a clip already calls `focusLane` through
`onClipFocused`. Once `focusLane` also drives the clip editor, a clip announcing
its own lane would close the editor it just opened. `origin: 'clip'` means "the
clip grid already decided; only move the instrument page".

- [ ] **Step 1: Write the failing test**

Create `src/session/lane-focus.test.ts`:

```ts
// @vitest-environment jsdom
//
// focusLane is the ONE door. Every path that selects a lane goes through it,
// and the clip editor never ends up on a different lane than the knobs.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rollMock = vi.hoisted(() => ({ redraw: () => {}, getOctaveBase: () => 60, setOctaveBase: vi.fn() }));
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: () => rollMock,
}));
vi.mock('./clip-automation-lanes', () => ({ renderClipAutomationLanes: () => {} }));
vi.mock('./example-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./example-loader')>()),
  loadAllExamples: async () => [],
}));

import { SessionInspector } from './session-inspector';
import type { SessionHost } from './session-host';
import { focusLaneImpl } from './session-host';
import type { SessionState, SessionClip, SessionLane } from './session';
import { fakeDestinations } from './fake-destinations';

function mountDom(): void {
  document.body.innerHTML = `
    <div id="session-view-root">
      <div class="page" data-page="drums" hidden></div>
      <div class="page" data-page="poly" hidden></div>
    </div>
    <div id="session-inspector" hidden>
      <div id="insp-context">
        <span id="insp-context-swatch"></span>
        <span id="insp-context-track"></span>
        <span id="insp-context-scene"></span>
        <span id="insp-context-row"></span>
      </div>
      <input id="insp-name" type="text" />
      <input id="insp-length" type="number" />
      <button id="insp-play"></button>
      <button id="insp-rec" hidden></button>
      <select id="insp-rec-mode" hidden></select>
      <button id="insp-tempo-double"></button>
      <button id="insp-tempo-halve"></button>
      <select id="insp-quantize"><option value=""></option></select>
      <button id="insp-duplicate"></button><button id="insp-delete"></button>
      <button id="insp-copy"></button>
      <button id="insp-paste-replace" disabled></button>
      <button id="insp-paste-layer" disabled></button>
      <button id="insp-random-notes"></button><button id="insp-variate"></button>
      <button id="insp-invert-melodic"></button><button id="insp-retrograde"></button>
      <button id="insp-chords"></button>
      <select id="insp-style-select"></select>
      <select id="insp-pattern-select"></select>
      <button id="insp-save-example"></button><button id="insp-export-example"></button>
      <button id="insp-toggle-editor"></button>
      <div id="insp-tonality"></div>
      <div id="insp-roll-host"></div>
    </div>`;
}

function clip(id: string, name: string): SessionClip {
  return { id, name, lengthBars: 2, notes: [] } as unknown as SessionClip;
}

function makeState(): SessionState {
  return {
    lanes: [
      { id: 'drums-1', engineId: 'drums-machine', name: 'Drums 1', clips: [clip('c-d0', 'Beat')] },
      { id: 'tb-303-1', engineId: 'tb303', name: 'Bass', clips: [clip('c-b0', 'Acid')] },
    ] as unknown as SessionLane[],
    scenes: [{ id: 's0', name: 'Drop', clipPerLane: {} }],
  } as unknown as SessionState;
}

function makeInspector(state: SessionState): SessionInspector {
  return new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: () => {},
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    destinations: fakeDestinations(),
    getAutoAbsSubIdx: () => 0,
  });
}

/** A SessionHost stub carrying only what focusLaneImpl reads. */
function makeSelf(state: SessionState, insp: SessionInspector, activeEditLane: string | null): SessionHost {
  return {
    state,
    inspector: insp,
    activeEditLane,
    activeSceneIdx: -1,
    synthCollapsed: false,
    renderWithMixer: () => {},
    deps: { onActiveLaneChanged: vi.fn(), setActiveEngineLane: vi.fn() },
  } as unknown as SessionHost;
}

const panel = () => document.getElementById('session-inspector') as HTMLElement;

describe('focusLane — the one door', () => {
  beforeEach(() => mountDom());

  it('closes a clip left open on another lane', () => {
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
    insp.openInspector();
    expect(panel().hidden, 'precondition: the drums clip is open').toBe(false);

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(insp.getSelectedClip(), 'the drums selection is dropped').toBeNull();
    expect(self.activeEditLane, 'the bass lane is now selected').toBe('tb-303-1');
  });

  it('a clip announcing its own lane never closes the editor it just opened', () => {
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'tb-303-1', clipIdx: 0 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'clip');

    expect(insp.getSelectedClip(), 'the bass clip stays open').toEqual({ laneId: 'tb-303-1', clipIdx: 0 });
    expect(self.activeEditLane, 'the instrument page still follows').toBe('tb-303-1');
  });

  it('re-selecting the open clip\'s own lane leaves the editor alone', () => {
    // The chevron, an engine swap and an undo repaint all land here.
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'drums-1', 'lane');

    expect(panel().hidden).toBe(false);
    expect(insp.getSelectedClip()).toEqual({ laneId: 'drums-1', clipIdx: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/lane-focus.test.ts`
Expected: FAIL — `focusLaneImpl` is not exported from `./session-host`.

- [ ] **Step 3: Add the funnel to `session-host.ts`**

Add near the top of `src/session/session-host.ts`, after the existing imports:

```ts
/** Where a lane selection came from. `'clip'` means the clip grid already chose
 *  the clip and only the instrument page needs to move — without it, opening a
 *  clip in another lane would open the editor and immediately close it. */
export type LaneFocusOrigin = 'lane' | 'clip';
```

Add the free function, next to the class (so tests can drive it with a stub):

```ts
/** THE single door for changing which lane is selected. Every path — lane
 *  header, clip cell, mixer column, APC, engine-swap re-route, chevron, undo
 *  repaint — goes through here, so the instrument page and the clip editor can
 *  never end up on two different lanes. */
export function focusLaneImpl(self: SessionHost, laneId: string, origin: LaneFocusOrigin = 'lane'): void {
  const sameLane = self.activeEditLane === laneId;
  // A clip announcing a lane that is already selected has nothing to move.
  if (sameLane && origin === 'clip') return;
  showLaneEditorImpl(self, laneId);
  if (origin === 'lane' && !sameLane) self.inspector?.closeIfOtherLane(laneId);
}
```

Replace the existing `focusLane` method body with a delegation, and make
`showLaneEditor` delegate too:

```ts
  /** Make a lane the active/edit lane. Single source of truth shared with the
   *  APC and the mixer; see focusLaneImpl. */
  focusLane(laneId: string, origin: LaneFocusOrigin = 'lane'): void {
    focusLaneImpl(this, laneId, origin);
  }

  showLaneEditor(laneId: string): void {
    focusLaneImpl(this, laneId, 'lane');
  }
```

- [ ] **Step 4: Move the clip rule out of `showLaneEditor`**

In `src/session/session-host-lane-editor.ts`, delete these three lines from
`showLaneEditor` (the funnel owns the decision now — leaving it here would run
it twice and, after Task 2, would close the editor instead of moving it):

```ts
  // The clip editor follows the lane selection: a clip left open on ANOTHER lane
  // would keep taking the edits, generators and ▶ meant for the lane just picked.
  // Same-lane callers (engine swap, collapse chevron, undo repaint) are no-ops.
  self.inspector?.closeIfOtherLane(laneId);
```

Replace with a comment recording where it went:

```ts
  // The clip editor is NOT touched here. focusLaneImpl (session-host.ts) owns
  // that decision for every entry point, so this function is pure painting.
```

- [ ] **Step 5: Tell the inspector its announcements come from a clip**

In `SessionHost.init()`, change the `onClipFocused` wiring:

```ts
      onClipFocused: (laneId) => this.focusLane(laneId, 'clip'),
```

- [ ] **Step 6: Run the new test**

Run: `NO_COLOR=1 npx vitest run src/session/lane-focus.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the existing lane-switch suite — it must still pass**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editor-lane-switch.test.ts src/session/session-host-active-lane.test.ts src/session/session-host-lane-editor.test.ts`
Expected: PASS. If `showLaneEditor — the lane the user clicked owns the editor`
fails, the free `showLaneEditor` is being called directly somewhere instead of
through the funnel — route that caller through `SessionHost.showLaneEditor`.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/session/session-host.ts src/session/session-host-lane-editor.ts src/session/lane-focus.test.ts
git commit -F - <<'EOF'
fix(session): one door decides which lane you are looking at

Two functions set the selected lane and only showLaneEditor told the clip
editor, so selecting a lane through focusLane — the APC, and opening a clip —
left the piano roll on one lane while the knobs below it belonged to another.

focusLaneImpl is now the only door. It paints the instrument page and then
moves the clip editor, and it takes an origin so a clip announcing its own lane
cannot close the editor it just opened.

EOF
```

- [ ] **Step 10: Rebase onto main**

```bash
git rebase main
```

---

## Task 2: The clip follows the lane

**Files:**
- Modify: `src/session/session-host-util.ts` (add `clipToShowOnLaneSwitch`)
- Modify: `src/session/session-host.ts` (`focusLaneImpl` uses it)
- Test: `src/session/session-host-util.test.ts` (create if absent; otherwise append)
- Test: `src/session/lane-focus.test.ts` (append)

**Interfaces:**
- Consumes: `SessionState`, `SessionHost.activeSceneIdx` (public field, `-1` when no scene is launched), `SessionInspector.setSelectedClip` / `openInspector` / `closeIfOtherLane`.
- Produces: `clipToShowOnLaneSwitch(state, nextLaneId, openClip, launchedSceneIdx): { laneId: string; clipIdx: number } | null` exported from `src/session/session-host-util.ts`.

- [ ] **Step 1: Write the failing pure test**

Create `src/session/session-host-util.test.ts` (if it already exists, append the
`describe` block):

```ts
import { describe, it, expect } from 'vitest';
import { clipToShowOnLaneSwitch } from './session-host-util';
import type { SessionState, SessionClip, SessionLane } from './session';

function clip(id: string): SessionClip {
  return { id, name: id, lengthBars: 2, notes: [] } as unknown as SessionClip;
}

/** drums-1 has clips in rows 0 and 1; tb-303-1 only in row 0. */
function makeState(): SessionState {
  return {
    lanes: [
      { id: 'drums-1', engineId: 'drums-machine', name: 'Drums', clips: [clip('d0'), clip('d1')] },
      { id: 'tb-303-1', engineId: 'tb303', name: 'Bass', clips: [clip('b0')] },
    ] as unknown as SessionLane[],
    scenes: [{ id: 's0', name: 'A', clipPerLane: {} }, { id: 's1', name: 'B', clipPerLane: {} }],
  } as unknown as SessionState;
}

describe('clipToShowOnLaneSwitch', () => {
  it('follows the open clip\'s row into the new lane', () => {
    const openClip = { laneId: 'drums-1', clipIdx: 0 };
    expect(clipToShowOnLaneSwitch(makeState(), 'tb-303-1', openClip, -1))
      .toEqual({ laneId: 'tb-303-1', clipIdx: 0 });
  });

  it('returns null when the new lane\'s slot in that row is empty', () => {
    // Row 1 exists in drums but not in the bass lane.
    const openClip = { laneId: 'drums-1', clipIdx: 1 };
    expect(clipToShowOnLaneSwitch(makeState(), 'tb-303-1', openClip, -1)).toBeNull();
  });

  it('falls back to the launched scene\'s row when no clip is open', () => {
    expect(clipToShowOnLaneSwitch(makeState(), 'drums-1', null, 1))
      .toEqual({ laneId: 'drums-1', clipIdx: 1 });
  });

  it('returns null when nothing is open and no scene is launched', () => {
    expect(clipToShowOnLaneSwitch(makeState(), 'drums-1', null, -1)).toBeNull();
  });

  it('returns null for an unknown lane', () => {
    expect(clipToShowOnLaneSwitch(makeState(), 'nope-1', { laneId: 'drums-1', clipIdx: 0 }, -1)).toBeNull();
  });

  it('never adds a clip to the session', () => {
    const state = makeState();
    const before = JSON.stringify(state);
    clipToShowOnLaneSwitch(state, 'tb-303-1', { laneId: 'drums-1', clipIdx: 1 }, -1);
    expect(JSON.stringify(state), 'the state is untouched').toBe(before);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-util.test.ts`
Expected: FAIL — `clipToShowOnLaneSwitch` is not exported.

- [ ] **Step 3: Implement the pure function**

Append to `src/session/session-host-util.ts`:

```ts
/** Which clip the editor should show after the user selects `nextLaneId`.
 *
 *  The row is the one the user is already looking at: the open clip's row, or —
 *  with nothing open — the launched scene's row. `null` means CLOSE the editor,
 *  and it never means create: a lane with an empty slot in that row simply
 *  shows no clip, while its instrument page still opens. Creating one here
 *  would silently grow the session every time the user browsed lanes. */
export function clipToShowOnLaneSwitch(
  state: { lanes: { id: string; clips: unknown[] }[] },
  nextLaneId: string,
  openClip: { laneId: string; clipIdx: number } | null,
  launchedSceneIdx: number,
): { laneId: string; clipIdx: number } | null {
  const row = openClip ? openClip.clipIdx : (launchedSceneIdx >= 0 ? launchedSceneIdx : -1);
  if (row < 0) return null;
  const lane = state.lanes.find((l) => l.id === nextLaneId);
  if (!lane || lane.clips[row] == null) return null;
  return { laneId: nextLaneId, clipIdx: row };
}
```

- [ ] **Step 4: Run the pure test**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-util.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing wiring test**

Append to `src/session/lane-focus.test.ts`, inside the existing
`describe('focusLane — the one door')`:

```ts
  it('opens the new lane\'s clip in the same row', () => {
    // makeState already gives the bass lane a clip in row 0.
    const state = makeState();
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 0 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(insp.getSelectedClip(), 'the bass clip in row 0 is now open')
      .toEqual({ laneId: 'tb-303-1', clipIdx: 0 });
    expect(panel().hidden, 'the editor stays open').toBe(false);
  });

  it('closes the editor and creates nothing when the row is empty', () => {
    const state = makeState();
    // Row 1 exists in drums only.
    (state.lanes[0] as unknown as { clips: SessionClip[] }).clips.push(clip('c-d1', 'Fill'));
    const insp = makeInspector(state);
    insp.setSelectedClip({ laneId: 'drums-1', clipIdx: 1 });
    insp.openInspector();

    const self = makeSelf(state, insp, 'drums-1');
    focusLaneImpl(self, 'tb-303-1', 'lane');

    expect(insp.getSelectedClip(), 'nothing is open').toBeNull();
    expect(panel().hidden, 'the panel is hidden').toBe(true);
    expect(state.lanes[1].clips.length, 'no clip was created in the bass lane').toBe(1);
    expect(self.activeEditLane, 'the instrument page still switched').toBe('tb-303-1');
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/lane-focus.test.ts`
Expected: FAIL — `opens the new lane's clip in the same row` fails because the
funnel still only closes.

- [ ] **Step 7: Use the rule in the funnel**

In `src/session/session-host.ts`, import the new helper alongside the existing
`session-host-util` imports, then replace the `closeIfOtherLane` line in
`focusLaneImpl`:

```ts
export function focusLaneImpl(self: SessionHost, laneId: string, origin: LaneFocusOrigin = 'lane'): void {
  const sameLane = self.activeEditLane === laneId;
  if (sameLane && origin === 'clip') return;
  showLaneEditorImpl(self, laneId);
  if (origin !== 'lane' || sameLane) return;

  const insp = self.inspector;
  if (!insp) return;
  const next = clipToShowOnLaneSwitch(self.state, laneId, insp.getSelectedClip(), self.activeSceneIdx);
  // No clip to show in this row: close, never create. closeIfOtherLane (rather
  // than closeInspector) keeps the "a lane never closes its own clip" guarantee
  // even if the row rule is ever loosened.
  if (!next) { insp.closeIfOtherLane(laneId); return; }
  insp.setSelectedClip(next);
  insp.openInspector();
}
```

- [ ] **Step 8: Run both test files**

Run: `NO_COLOR=1 npx vitest run src/session/lane-focus.test.ts src/session/session-host-util.test.ts src/session/clip-editor-lane-switch.test.ts`
Expected: PASS.

- [ ] **Step 8b: Prove the teardown paths still close both sides together**

Two other functions write the selected lane, and they CLEAR it: deleting the
selected lane, and loading a session that no longer contains it
(`reconcileOpenEditors`, which also closes the clip inspector in the same pass).
They do not route through the funnel and must not have been broken by it.

Run: `NO_COLOR=1 npx vitest run src/session/session-host-delete-lane.test.ts src/session/session-host-reconcile-editors.test.ts`
Expected: PASS. If either fails, the funnel is now fighting the teardown path —
the fix is in `focusLaneImpl`, not in the teardown.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit and rebase**

```bash
git add src/session/session-host-util.ts src/session/session-host.ts src/session/session-host-util.test.ts src/session/lane-focus.test.ts
git commit -F - <<'EOF'
feat(session): the clip editor follows the lane instead of just closing

Selecting another lane used to close whatever clip was open. Now it moves: same
row as the clip you were looking at, or the launched scene's row when nothing
was open. An empty slot closes the editor and creates nothing — browsing lanes
must not grow the session.

The row rule is a pure function, so the "never creates a clip" guarantee is
asserted directly rather than inferred from the UI.

EOF
git rebase main
```

---

## Task 3: The mixer column selects its lane

**Files:**
- Modify: `src/core/mixer.ts` (`MixerColumnDeps`, the column root)
- Modify: `src/session/session-host.ts` (`renderWithMixer` passes `onSelect`)
- Modify: `src/styles/_mixer.scss` (hover affordance)
- Test: `src/core/mixer-select.test.ts` (create)

**Interfaces:**
- Consumes: `buildMixerColumn(trackId, deps)`, called only from `SessionHost.renderWithMixer` in production (`src/core/mixer.test.ts` is the other caller); `SessionHost.focusLane` from Task 1.
- Produces: `MixerColumnDeps.onSelect?: (trackId: string) => void`.

**The rule (user's explicit choice):** only the column's dead zones select. A
click on a live control does that control's job and nothing else, so moving a
fader never yanks the user out of the clip they are editing.

- [ ] **Step 1: Write the failing test**

Create `src/core/mixer-select.test.ts`:

```ts
// @vitest-environment jsdom
//
// Clicking a mixer column's dead zone selects its lane; clicking a live control
// does only that control's job. The user chose the conservative rule so that
// moving a fader never pulls them out of the clip they are editing.

import { describe, it, expect, vi } from 'vitest';
import { buildMixerColumn, type MixerColumnDeps } from './mixer';
import type { ChannelStrip } from './fx';

function fakeStrip(): ChannelStrip {
  return {
    serialize: () => ({ eqHigh: 0, eqMid: 0, eqLow: 0, sendA: 0, sendB: 0, pan: 0, level: 0.8 }),
    getMeterAnalyser: () => ({ frequencyBinCount: 8, getByteTimeDomainData: () => {} }),
    setLevel: () => {}, setEqHigh: () => {}, setEqMid: () => {}, setEqLow: () => {},
    setSendA: () => {}, setSendB: () => {}, setPan: () => {},
  } as unknown as ChannelStrip;
}

function makeDeps(over: Partial<MixerColumnDeps> = {}): MixerColumnDeps {
  return {
    stripFor: () => fakeStrip(),
    label: (id) => id,
    muteState: {},
    soloState: {},
    applyMuteSolo: () => {},
    registerKnob: () => {},
    ...over,
  };
}

describe('mixer column selection', () => {
  it('selects the lane when the dead zone is clicked', () => {
    const onSelect = vi.fn();
    const col = buildMixerColumn('tb-303-1', makeDeps({ onSelect }));
    document.body.appendChild(col);

    (col.querySelector('.mix-name') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith('tb-303-1');
  });

  it('does not select when the mute button is clicked', () => {
    const onSelect = vi.fn();
    const applyMuteSolo = vi.fn();
    const col = buildMixerColumn('tb-303-1', makeDeps({ onSelect, applyMuteSolo }));
    document.body.appendChild(col);

    (col.querySelector('.mix-btn.mute') as HTMLElement).click();

    expect(applyMuteSolo, 'mute still does its own job').toHaveBeenCalled();
    expect(onSelect, 'but the lane is not selected').not.toHaveBeenCalled();
  });

  it('does not select when the fader is clicked', () => {
    const onSelect = vi.fn();
    const col = buildMixerColumn('tb-303-1', makeDeps({ onSelect }));
    document.body.appendChild(col);

    (col.querySelector('.mix-fader') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('builds a working column when no onSelect is supplied', () => {
    const col = buildMixerColumn('tb-303-1', makeDeps());
    document.body.appendChild(col);
    expect(() => (col.querySelector('.mix-name') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/mixer-select.test.ts`
Expected: FAIL — `onSelect` is not a `MixerColumnDeps` property.

- [ ] **Step 3: Add `onSelect` to the deps**

In `src/core/mixer.ts`, add to `MixerColumnDeps` after `applyMuteSolo`:

```ts
  /** Selects this column's lane. Fires only for clicks on the column's DEAD
   *  ZONES — the name, the section labels, the padding. A click that lands on a
   *  live control (fader, knob, mute/solo, an insert slot, a dropdown) does that
   *  control's job and nothing else, so moving a fader never pulls the user out
   *  of the clip they are editing. Optional: the Classic mixer panel does not
   *  own a lane selection. */
  onSelect?: (trackId: string) => void;
```

- [ ] **Step 4: Attach the handler to the column root**

In `buildMixerColumn`, immediately after `const col = renderElement(html\`…\`)`
and before the `return`, add:

```ts
  // One listener on the root, not per dead zone: the column is rebuilt whole on
  // every render, and enumerating the dead zones would need updating each time a
  // control is added. Ask what was hit instead.
  if (deps.onSelect) {
    const onSelect = deps.onSelect;
    col.addEventListener('click', (e) => {
      const hit = e.target as Element | null;
      if (hit?.closest('button, input, select, .knob, [role="slider"]')) return;
      onSelect(trackId);
    });
  }
```

- [ ] **Step 5: Run the test**

Run: `NO_COLOR=1 npx vitest run src/core/mixer-select.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire it from the session host**

In `src/session/session-host.ts`, in `renderWithMixer`, replace the
`buildMixerColumn` call:

```ts
      const col = buildMixerColumn(lane.id, { ...this.deps.mixerDeps, onSelect: (id) => this.focusLane(id) });
```

- [ ] **Step 7: Give the dead zone a hover affordance**

In `src/styles/_mixer.scss`, add next to the existing
`.session-mixer-col-active` rule:

The column root's class is `mix-col` — `buildMixerColumn` renders
`class="mix-col ${trackId}"`. `session-mixer-col-active` is added on top by
`SessionHost.renderWithMixer` and marks only the selected column, so the
affordance hangs off `.mix-col`:

```scss
// The column's dead zones select their lane (see buildMixerColumn's onSelect).
// Without a cursor there is nothing telling the user the background is live.
.mix-col { cursor: pointer; }
.mix-col button,
.mix-col input,
.mix-col select,
.mix-col .knob { cursor: default; }
```

- [ ] **Step 8: Run the mixer suite and typecheck**

Run: `NO_COLOR=1 npx vitest run src/core/mixer-select.test.ts src/core/mixer.test.ts src/session/session-host-mixer-persistence.test.ts`
Then: `npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit and rebase**

```bash
git add src/core/mixer.ts src/core/mixer-select.test.ts src/session/session-host.ts src/styles/_mixer.scss
git commit -F - <<'EOF'
feat(mixer): the column's dead zones pick the lane

The mixer column marked the selected lane but clicking it selected nothing, so
the one strip that shows a lane's whole signal path was the one place you could
not choose it from.

Now the background, the name and the padding select. The fader, knobs, mute,
solo and the dropdowns keep doing only their own job, so a fader move never
pulls you out of the clip you are editing.

EOF
git rebase main
```

**Note for the implementer:** another session is editing `src/core/mixer.ts`.
If this rebase conflicts, keep both changes — theirs is layout, this is a
listener on the root.

---

## Task 4: Mute and solo in the clip editor header

**Files:**
- Modify: `index.html` (two buttons inside `.ctx-rec-group`)
- Modify: `src/session/session-inspector.ts` (refresh + click handlers)
- Modify: `src/session/session-host.ts` (pass the mute/solo seam to the inspector)
- Modify: `src/session/session-inspector.ts` `InspectorDeps` (new optional dep)
- Test: `src/session/inspector-mute-solo.test.ts` (create)

**Interfaces:**
- Consumes: `MixerColumnDeps.muteState` / `soloState` / `applyMuteSolo` — reached from the host as `this.deps.mixerDeps`.
- Produces: `InspectorDeps.muteSolo?: { muteState: Record<string, boolean>; soloState: Record<string, boolean>; apply: () => void }` and `SessionInspector.refreshMuteSolo(): void`.

**The one rule:** these are not a second implementation. They mutate the same
two records and call the same `applyMuteSolo` the mixer column already uses, so
a lane muted from either place reads as muted in both.

- [ ] **Step 1: Write the failing test**

Create `src/session/inspector-mute-solo.test.ts`:

```ts
// @vitest-environment jsdom
//
// The clip header's M/S and the mixer column's M/S are two faces of one state.
// A second copy of the mute flags would drift the moment either side wrote it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rollMock = vi.hoisted(() => ({ redraw: () => {}, getOctaveBase: () => 60, setOctaveBase: vi.fn() }));
vi.mock('./clip-editors/clip-editor-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clip-editors/clip-editor-router')>()),
  renderClipEditor: () => rollMock,
}));
vi.mock('./clip-automation-lanes', () => ({ renderClipAutomationLanes: () => {} }));
vi.mock('./example-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./example-loader')>()),
  loadAllExamples: async () => [],
}));

import { SessionInspector } from './session-inspector';
import type { SessionState, SessionClip, SessionLane } from './session';
import { fakeDestinations } from './fake-destinations';

function mountDom(): void {
  document.body.innerHTML = `
    <div id="session-inspector" hidden>
      <div id="insp-context">
        <span id="insp-context-swatch"></span>
        <span id="insp-context-track"></span>
        <span id="insp-context-scene"></span>
        <span id="insp-context-row"></span>
      </div>
      <input id="insp-name" type="text" />
      <input id="insp-length" type="number" />
      <button id="insp-play"></button>
      <button id="insp-mute"></button>
      <button id="insp-solo"></button>
      <button id="insp-rec" hidden></button>
      <select id="insp-rec-mode" hidden></select>
      <button id="insp-tempo-double"></button>
      <button id="insp-tempo-halve"></button>
      <select id="insp-quantize"><option value=""></option></select>
      <button id="insp-duplicate"></button><button id="insp-delete"></button>
      <button id="insp-copy"></button>
      <button id="insp-paste-replace" disabled></button>
      <button id="insp-paste-layer" disabled></button>
      <button id="insp-random-notes"></button><button id="insp-variate"></button>
      <button id="insp-invert-melodic"></button><button id="insp-retrograde"></button>
      <button id="insp-chords"></button>
      <select id="insp-style-select"></select>
      <select id="insp-pattern-select"></select>
      <button id="insp-save-example"></button><button id="insp-export-example"></button>
      <button id="insp-toggle-editor"></button>
      <div id="insp-tonality"></div>
      <div id="insp-roll-host"></div>
    </div>`;
}

function makeState(): SessionState {
  return {
    lanes: [{
      id: 'tb-303-1', engineId: 'tb303', name: 'Bass',
      clips: [{ id: 'c0', name: 'Acid', lengthBars: 2, notes: [] } as unknown as SessionClip],
    }] as unknown as SessionLane[],
    scenes: [{ id: 's0', name: 'A', clipPerLane: {} }],
  } as unknown as SessionState;
}

const muteBtn = () => document.getElementById('insp-mute') as HTMLButtonElement;
const soloBtn = () => document.getElementById('insp-solo') as HTMLButtonElement;

function openBassClip(muteSolo: {
  muteState: Record<string, boolean>; soloState: Record<string, boolean>; apply: () => void;
}): SessionInspector {
  const state = makeState();
  const insp = new SessionInspector({
    ctx: {} as AudioContext,
    seq: { meter: { num: 4, den: 4 }, bpm: 120 } as unknown as InstanceType<typeof import('../core/sequencer').Sequencer>,
    state,
    laneStates: new Map(),
    renderWithMixer: () => {},
    midiLabel: (m: number) => String(m),
    automationRegistry: new Map(),
    destinations: fakeDestinations(),
    getAutoAbsSubIdx: () => 0,
    muteSolo,
  });
  insp.setSelectedClip({ laneId: 'tb-303-1', clipIdx: 0 });
  insp.openInspector();
  return insp;
}

describe('clip header mute/solo', () => {
  beforeEach(() => mountDom());

  it('mutes the open clip\'s lane in the shared state', () => {
    const apply = vi.fn();
    const muteState: Record<string, boolean> = {};
    openBassClip({ muteState, soloState: {}, apply });

    muteBtn().click();

    expect(muteState['tb-303-1'], 'the shared record is written').toBe(true);
    expect(apply, 'and the audio graph is told').toHaveBeenCalled();
  });

  it('shows a lane the mixer already muted as muted', () => {
    // The mixer wrote the flag before the clip was opened.
    openBassClip({ muteState: { 'tb-303-1': true }, soloState: {}, apply: () => {} });

    expect(muteBtn().classList.contains('active')).toBe(true);
  });

  it('solos through the same seam', () => {
    const apply = vi.fn();
    const soloState: Record<string, boolean> = {};
    openBassClip({ muteState: {}, soloState, apply });

    soloBtn().click();

    expect(soloState['tb-303-1']).toBe(true);
    expect(apply).toHaveBeenCalled();
  });

  it('disables both buttons when no clip is open', () => {
    const insp = openBassClip({ muteState: {}, soloState: {}, apply: () => {} });
    insp.closeInspector();

    expect(muteBtn().disabled).toBe(true);
    expect(soloBtn().disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/inspector-mute-solo.test.ts`
Expected: FAIL — `muteSolo` is not an `InspectorDeps` property and the buttons
are never wired.

- [ ] **Step 3: Add the buttons to the markup**

In `index.html`, inside `<span class="ctx-rec-group">`, between `#insp-play` and
`#insp-rec`:

```html
              <button id="insp-mute" class="rnd" title="Mute this clip's track">M</button>
              <button id="insp-solo" class="rnd" title="Solo this clip's track">S</button>
```

- [ ] **Step 4: Declare the dep**

In `src/session/session-inspector.ts`, add to `InspectorDeps`:

```ts
  /** The mixer's own mute/solo records and its apply hook. The clip header's
   *  M/S write THESE — a second copy would drift from the mixer column the
   *  moment either side was used. Optional so test fixtures can omit it. */
  muteSolo?: {
    muteState: Record<string, boolean>;
    soloState: Record<string, boolean>;
    apply: () => void;
  };
```

- [ ] **Step 5: Implement the refresh**

Add to `SessionInspector`, next to `refreshPlayButton`:

```ts
  /** Paint and wire the clip header's M/S from the SHARED mixer state. Called
   *  wherever refreshPlayButton is, so the pair tracks the open clip. */
  refreshMuteSolo(): void {
    const ms = this.deps.muteSolo;
    const pairs: [HTMLButtonElement | null, Record<string, boolean> | undefined][] = [
      [document.getElementById('insp-mute') as HTMLButtonElement | null, ms?.muteState],
      [document.getElementById('insp-solo') as HTMLButtonElement | null, ms?.soloState],
    ];
    const sel = this.selectedClip;
    for (const [btn, bag] of pairs) {
      if (!btn) continue;
      btn.disabled = !sel || !ms;
      const on = !!(sel && bag?.[sel.laneId]);
      btn.classList.toggle('active', on);
      btn.onclick = !sel || !ms || !bag ? null : () => {
        bag[sel.laneId] = !bag[sel.laneId];
        ms.apply();
        this.refreshMuteSolo();
        // The mixer column paints from the same records, so it has to repaint.
        this.deps.renderWithMixer();
      };
    }
  }
```

- [ ] **Step 6: Call it wherever the play button refreshes**

In `src/session/session-inspector.ts`, add `this.refreshMuteSolo();` immediately
after each existing `this.refreshPlayButton();` call — in `openInspector()` and
in `closeInspector()`.

- [ ] **Step 7: Hand the seam in from the host**

In `SessionHost.init()`, add to the `SessionInspector` constructor object:

```ts
      muteSolo: {
        muteState: this.deps.mixerDeps.muteState,
        soloState: this.deps.mixerDeps.soloState,
        apply: () => this.deps.mixerDeps.applyMuteSolo(),
      },
```

- [ ] **Step 8: Run the test**

Run: `NO_COLOR=1 npx vitest run src/session/inspector-mute-solo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the inspector suite and typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/session-inspector.test.ts src/session/lane-focus.test.ts src/session/clip-editor-lane-switch.test.ts`
Then: `npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit and rebase**

```bash
git add index.html src/session/session-inspector.ts src/session/session-host.ts src/session/inspector-mute-solo.test.ts
git commit -F - <<'EOF'
feat(session): mute and solo where you are already looking

Silencing the track you are editing meant leaving the clip editor for the mixer
row. The two buttons now sit next to the clip's own play and rec.

They are not a second implementation: they write the mixer's own muteState and
soloState records and call its applyMuteSolo, so either surface shows what the
other did. A private copy would have drifted on the first click.

EOF
git rebase main
```

---

## Task 5: Rename the "poly" inheritance to "instrument"

"poly" names **the instrument page** — the one page that paints the controls of
every non-drum lane. It has nothing to do with polyphony and nothing to do with
any live synth: the `PolySynth` class it was named after is already deleted.

**Files:**
- Modify: `index.html` (page/tab attribute, 14 ids)
- Modify: `src/styles/_tabs.scss`, `src/styles/_mixer.scss` (2 classes)
- Rename: `src/polysynth/` → `src/instrument-presets/`
- Modify: `src/engines/lane-engine-host.ts` (`activeLaneId` → `instrumentPageLaneId`)
- Modify: every importer of the above (the compiler lists them)
- Modify: `CLAUDE.md` (the stale `polysynth.ts` claim)

**Interfaces:**
- Consumes: nothing new.
- Produces: no API changes — a rename only.

### Blacklist — the build must still contain these afterwards

- `polyBlep` — oscillator anti-aliasing (`packages/loom-plugin-sdk/src/dsp/osc.ts`, `sync-osc.ts`). Renaming corrupts the DSP.
- `polyphony` — a **plugin manifest field** validated by `src/plugin-host/manifest-validate.ts` and present in every `plugin.json`. Part of the plugin ABI.
- `POLY_PRESETS_KEY = 'tb303-poly-presets-v1'` and the JSON shape stored under it — the user's saved presets. There are no migrations in this project.

- [ ] **Step 1: Write the failing guard test**

Create `src/presets/preset-key-stability.test.ts`:

```ts
// The rename may touch the TYPE name but never the storage key or its shape.
// Changing either silently loses every preset the user saved, and this project
// has no migrations.

import { describe, it, expect } from 'vitest';
import { loadUserPolyPresets, saveUserPolyPresets } from '../polysynth/poly-preset-store';

describe('user preset storage survives the rename', () => {
  it('reads back what a pre-rename build wrote under its own key', () => {
    const stored = { 'My Patch': { filter: { cutoff: 0.42 } } };
    localStorage.setItem('tb303-poly-presets-v1', JSON.stringify(stored));

    const loaded = loadUserPolyPresets();

    expect(loaded['My Patch'], 'the saved patch is still there').toBeTruthy();
    expect((loaded['My Patch'] as unknown as { filter: { cutoff: number } }).filter.cutoff).toBe(0.42);
  });

  it('writes to that exact key', () => {
    localStorage.removeItem('tb303-poly-presets-v1');
    saveUserPolyPresets({} as Parameters<typeof saveUserPolyPresets>[0]);
    expect(localStorage.getItem('tb303-poly-presets-v1')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it — it must PASS before the rename**

Run: `NO_COLOR=1 npx vitest run src/presets/preset-key-stability.test.ts`
Expected: PASS. This is the guard, not a red test: it locks the current
behaviour so the rename cannot break it. Commit it on its own.

```bash
git add src/presets/preset-key-stability.test.ts
git commit -F - <<'EOF'
test(presets): pin the saved-preset key before renaming around it

EOF
```

- [ ] **Step 3: Rename the page and its tab**

In `index.html`, change `data-page="poly"` → `data-page="instrument"` and the
matching tab's `data-tab="poly"` → `data-tab="instrument"`. Then update every
selector that names them:

Run: `grep -rn 'data-page="poly"\|data-tab="poly"\|"poly"' src/ index.html tests/`
Fix each hit. The known ones are `session-host-lane-editor.ts` (`targetTab`),
`engine-selector-ui.ts` (`[data-page="poly"]`) and `_tabs.scss`.

- [ ] **Step 4: Rename the 14 ids**

Instrument-page ids → `instrument-*`:
`poly-active-label`, `poly-engine-row`, `poly-fx-row`, `poly-preset-select`,
`poly-preset-save`, `poly-preset-load`, `poly-preset-delete`,
`poly-seq-mode-row`, `poly-tracks`, `poly-add-track`, `poly-target-select`.

MIDI-import ids — these belong to the import dialog, not the page:
`poly-midi-file` → `midi-import-file`, `poly-midi-load` → `midi-import-load`,
`poly-midi-tracklist` → `midi-import-tracklist`.

Rename one id at a time, and after each: `grep -rn '<old-id>' src/ index.html tests/ tools/`
must return nothing.

- [ ] **Step 5: Rename the two SCSS classes**

`.poly-section` → `.instrument-section`, `.poly-wave-sel` → `.instrument-wave-sel`.

- [ ] **Step 6: Rename the folder and the state field**

```bash
git mv src/polysynth src/instrument-presets
```

Then in `src/engines/lane-engine-host.ts`, rename the `LaneEngineHostState`
field `activeLaneId` → `instrumentPageLaneId`, and update its doc comment to
state the rule out loud:

```ts
export interface LaneEngineHostState {
  /** The lane currently painted on the INSTRUMENT page. Not "the selected
   *  lane": selecting a drum lane routes to the drums page and deliberately
   *  leaves this pointing at the last melodic lane. Pointing it at a drum lane
   *  would blank the engine dropdown (drums-machine is not among its options),
   *  mount the instrument page's FX panel under the drum lane's id, repopulate
   *  the melodic preset dropdown for it, and aim the engine-swap dropdown at
   *  it. Written only by showLaneEditor, only on the instrument-page branch. */
  instrumentPageLaneId: string;
}
```

Let the compiler find the rest: `npx tsc --noEmit` and fix each error.

- [ ] **Step 7: Fix the stale claim in CLAUDE.md**

In `CLAUDE.md`, the `src/polysynth/` bullet says `polysynth.ts` "still holds"
the node-per-note `PolySynth` class. That file does not exist. Replace the
sentence with:

```
`polysynth.ts` and its node-per-note `PolySynth` class are gone — deleted with the worklet cutover. What kept the name is the preset surface, now `src/instrument-presets/`, plus the `PolySynthParams` shape user presets are serialized into.
```

Update the folder name in that bullet and anywhere else `src/polysynth/`
appears in `CLAUDE.md`.

- [ ] **Step 8: Verify the blacklist survived**

Run: `grep -rn 'polyBlep' packages/ && grep -rn '"polyphony"' public/plugins/ plugins/ && grep -rn 'tb303-poly-presets-v1' src/`
Expected: all three still return hits. If any returns nothing, the rename went
too wide — revert that hunk.

- [ ] **Step 9: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS. A flaky `ERR_IPC_CHANNEL_CLOSED` on teardown after all tests
pass is a known non-failure — re-run to confirm.

- [ ] **Step 10: Build, then run e2e**

```bash
npm run build
npm run test:e2e
```

Expected: PASS. The e2e suite serves `dist/` with no build step, so the build is
mandatory or it tests the pre-rename bundle. Known pre-existing reds unrelated
to this work: the six preset-load failures (empty `#poly-preset-select` at
boot). If those are the only failures, they are not regressions — but their
selector now reads `#instrument-preset-select`, so update it in the spec files
as part of this task.

- [ ] **Step 11: Commit and rebase**

```bash
git add -A
git commit -F - <<'EOF'
refactor: the page is the instrument page, not the poly page

"poly" named a class that no longer exists. What it actually names is the one
page that paints the controls of every non-drum lane, so it is now called that,
and the lane it tracks is instrumentPageLaneId — with the rule written down
instead of implied: a drum lane routes elsewhere and leaves it alone.

polyBlep, the polyphony manifest field and the saved-preset key are untouched
on purpose; a blind rename over "poly" would have broken the DSP, the plugin
ABI and every preset the user saved. Three of the fourteen ids turned out to
belong to the MIDI import dialog and are named for that now.

CLAUDE.md said polysynth.ts still holds the PolySynth class. It does not.

EOF
git rebase main
```

---

## Final verification

- [ ] **Full suite from a clean build**

```bash
npm run build
npm test
```

- [ ] **Look at it.** Selection coherence is a visual claim and the automated
tests cannot check what the user sees. Start `npm run dev` in the worktree, open
Chrome (not the VS Code browser), and for each of these confirm the clip editor
and the instrument controls name the SAME lane:

  1. click a lane header
  2. click a clip cell in another lane
  3. click a mixer column's background
  4. select a lane whose row has no clip — editor closes, **no clip appears in the grid**
  5. move a fader in another lane's column — selection must NOT change
  6. mute from the clip header, check the mixer column shows it; unmute from the mixer, check the header follows
  7. undo/redo after a lane switch
  8. swap the engine of the lane whose clip is open — the clip must stay open
  9. delete the selected lane — both the instrument page and the clip editor clear
  10. with an APC Key 25 connected, select a lane from the controller — same rule.
      This is the one entry point with no automated test (it needs hardware), so
      it is checked here or not at all. Without the hardware, say so rather than
      ticking it.

- [ ] **Report honestly.** Any step above that does not behave as written is a
finding, not a rounding error. Say which one and what it did instead.
