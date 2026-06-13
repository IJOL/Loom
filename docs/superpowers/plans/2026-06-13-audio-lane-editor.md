# Audio Lane Editor (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An audio (stem) lane stops looking like an instrument — its editor hides the engine selector, preset, 🎲 Sound and NOTE FX; the per-lane insert FX stay; and **Gain + Warp** live in the clip editing window next to the waveform.

**Architecture:** A pure policy `laneEditorPanels(engineId)` decides which lane-editor panels render; `injectEngineModulatorPanel` consults it (skip engine-params/NOTE-FX/preset for `'audio'`, keep inserts) and hides the poly page's engine/preset header row for audio lanes. The audio engine's Gain knob is mounted in the clip editor's toolbar instead (the same `wireEngineParams` path, fed a minimal `EngineUIContext` threaded from the inspector). The engine-swap guard rejects `'audio'`.

**Tech Stack:** TypeScript, Web Audio, Vite, Vitest. Pure policy is unit-tested; DOM wiring is covered by `tsc` + live acceptance.

---

## File Structure

- `src/session/lane-editor-panels.ts` — **new** pure `laneEditorPanels(engineId)` policy. *Create.*
- `src/session/lane-editor-panels.test.ts` — test. *Create.*
- `src/session/clip-editors/clip-waveform-header.ts` — `renderAudioClipEditor` mounts the Gain knob. *Modify.*
- `src/session/clip-editors/clip-editor-router.ts` — `ClipEditorDeps` + audio branch build the Gain context. *Modify.*
- `src/session/session-inspector.ts` — pass `laneResources`/`automationRegistry`/`sessionState` into `ClipEditorDeps`. *Modify.*
- `src/session/session-host-lane-editor.ts` — `injectEngineModulatorPanel` consults the policy + hides the header row. *Modify.*
- `index.html` — give the poly engine/preset header row an id. *Modify.*
- `src/app/engine-swap.ts` — reject `'audio'` as swap source/target. *Modify.*

---

## Task 1: Pure lane-editor panel policy

**Files:**
- Create: `src/session/lane-editor-panels.ts`
- Test: `src/session/lane-editor-panels.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/session/lane-editor-panels.test.ts
import { describe, it, expect } from 'vitest';
import { laneEditorPanels } from './lane-editor-panels';

describe('laneEditorPanels', () => {
  it('audio lane shows NO instrument chrome but keeps inserts', () => {
    expect(laneEditorPanels('audio')).toEqual({
      engineParams: false, noteFx: false, preset: false, inserts: true, engineHeaderRow: false,
    });
  });
  it('a melodic engine shows everything', () => {
    expect(laneEditorPanels('subtractive')).toEqual({
      engineParams: true, noteFx: true, preset: true, inserts: true, engineHeaderRow: true,
    });
  });
  it('drums-machine keeps params/preset but no NOTE FX (unchanged behavior)', () => {
    expect(laneEditorPanels('drums-machine')).toEqual({
      engineParams: true, noteFx: false, preset: true, inserts: true, engineHeaderRow: true,
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/session/lane-editor-panels.test.ts`
Expected: FAIL — module `./lane-editor-panels` not found.

- [ ] **Step 3: Implement**

```ts
// src/session/lane-editor-panels.ts
// Which panels a lane's editor renders. An 'audio' lane is NOT an instrument:
// no engine-params/preset/NOTE-FX/engine-selector — only its insert FX. drums
// keep everything except NOTE FX (drums aren't note-transformed). Pure so the
// lane-editor wiring is testable.

export interface LaneEditorPanels {
  engineParams: boolean;    // the engine's knob UI (e.g. the audio Gain) in the lane editor
  noteFx: boolean;          // the per-lane NOTE FX (arp/chord) panel
  preset: boolean;          // the preset dropdown
  inserts: boolean;         // the per-lane insert FX chain
  engineHeaderRow: boolean; // the poly page's ENGINE/PRESET/🎲 header row
}

export function laneEditorPanels(engineId: string): LaneEditorPanels {
  const isAudio = engineId === 'audio';
  return {
    engineParams: !isAudio,
    noteFx: !isAudio && engineId !== 'drums-machine',
    preset: !isAudio,
    inserts: true,
    engineHeaderRow: !isAudio,
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/session/lane-editor-panels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/lane-editor-panels.ts src/session/lane-editor-panels.test.ts
git commit -m "feat(audio): lane-editor panel policy (audio lane != instrument)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Mount the Gain knob in the clip editor

This adds Gain to the clip editor toolbar. (Gain still also shows in the lane editor until Task 3 removes it there — no broken intermediate state.)

**Files:**
- Modify: `src/session/clip-editors/clip-waveform-header.ts` (`AudioClipEditorDeps` + `renderAudioClipEditor`, lines 104–130)
- Modify: `src/session/clip-editors/clip-editor-router.ts` (`ClipEditorDeps` + the audio branch, lines 22–33 and 126–130)
- Modify: `src/session/session-inspector.ts` (`editorDeps`, lines 240–247)

- [ ] **Step 1: Extend `renderAudioClipEditor` to mount a Gain knob**

In `src/session/clip-editors/clip-waveform-header.ts`, add the import near the top:

```ts
import { wireEngineParams } from '../../engines/engine-ui';
import type { SynthEngine, EngineUIContext } from '../../engines/engine-types';
```

Replace the `AudioClipEditorDeps` interface (currently lines 104–106):

```ts
export interface AudioClipEditorDeps {
  getPlayheadFrac?: () => number;
  /** When present, mount the audio engine's Gain knob in the toolbar (audio
   *  lanes show their controls here, next to the waveform — not in the lane
   *  editor). */
  gain?: { engine: SynthEngine; ctx: EngineUIContext };
}
```

In `renderAudioClipEditor`, after `toolbar.append(warpBtn);` (line 124) and before `host.appendChild(toolbar);` (line 125), insert:

```ts
  if (deps.gain) {
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    wireEngineParams(deps.gain.engine, deps.gain.ctx, knobRow, { filter: (id) => id === 'gain' });
    toolbar.append(knobRow);
  }
```

- [ ] **Step 2: Thread the Gain context through `ClipEditorDeps`**

In `src/session/clip-editors/clip-editor-router.ts`, add imports near the top:

```ts
import type { LaneResourceMap } from '../../core/lane-resources';
import type { KnobHandle } from '../../core/knob';
import type { EngineUIContext } from '../../engines/engine-types';
import type { SessionState } from '../session';
```

Extend `ClipEditorDeps` (currently lines 22–33) by adding these optional fields:

```ts
  /** Phase 2a: per-lane resources (to reach the audio lane's engine) +
   *  automation registry + session state, so the audio clip editor can mount
   *  the engine's Gain knob as an automatable control. Optional so non-audio
   *  callers/tests are unaffected. */
  laneResources?: LaneResourceMap;
  automationRegistry?: Map<string, KnobHandle>;
  sessionState?: SessionState;
```

Replace the audio branch (currently lines 126–130):

```ts
  // Audio-channel clip → waveform-only editor (no note grid). Mount the engine
  // Gain knob in its toolbar (audio lanes show controls here, not in the lane editor).
  if (isAudioClip(lane, clip)) {
    const engine = deps.laneResources?.get(lane.id)?.engine;
    const gain = (engine && deps.automationRegistry)
      ? {
          engine,
          ctx: {
            laneId: lane.id,
            registerKnob: (k: unknown) => {
              const h = k as KnobHandle;
              if (h.meta?.id) deps.automationRegistry!.set(h.meta.id, h);
            },
            registry: deps.automationRegistry as Map<string, unknown>,
            sessionState: deps.sessionState,
            historyDeps: deps.historyDeps,
          } as EngineUIContext,
        }
      : undefined;
    return renderAudioClipEditor(host, clip, deps.seq.meter, { getPlayheadFrac: playheadFrac, gain });
  }
```

- [ ] **Step 3: Supply the new deps from the inspector**

In `src/session/session-inspector.ts`, in `renderEditor()` where `editorDeps` is built (currently lines 240–247), add the three fields:

```ts
    const editorDeps: ClipEditorDeps = {
      ctx: this.deps.ctx,
      seq: this.deps.seq,
      laneStates: this.deps.laneStates,
      midiLabel: this.deps.midiLabel,
      historyDeps: this.deps.historyDeps,
      triggerForLane: this.deps.triggerForLane,
      laneResources: this.deps.laneResources,
      automationRegistry: this.deps.automationRegistry,
      sessionState: this.deps.state,
    };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `this.deps.state` is named differently, use the field the inspector already reads in `renderEditor` — it uses `this.deps.state.lanes.find(...)` at line 229, so `this.deps.state` is correct.)

- [ ] **Step 5: Run the clip-editor tests (regression)**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/`
Expected: PASS (existing clip-editor/waveform-header tests still green; the new optional deps don't change non-audio behavior).

- [ ] **Step 6: Commit**

```bash
git add src/session/clip-editors/clip-waveform-header.ts src/session/clip-editors/clip-editor-router.ts src/session/session-inspector.ts
git commit -m "feat(audio): Gain knob in the audio clip editor toolbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Strip instrument chrome from the audio lane editor

**Files:**
- Modify: `index.html` (poly page header row, line 230 — add an id)
- Modify: `src/session/session-host-lane-editor.ts` (`injectEngineModulatorPanel`, lines 88–175)

- [ ] **Step 1: Give the poly engine/preset header row an id**

In `index.html`, the poly page's first `.poly-section` (line 230) currently reads:

```html
        <div class="row poly-section">
          <span class="section-label">ENGINE</span>
          <span id="engine-lane-label" class="active-edit-label">MAIN</span>
          <select id="engine-select"></select>
```

Add `id="poly-engine-row"`:

```html
        <div class="row poly-section" id="poly-engine-row">
          <span class="section-label">ENGINE</span>
          <span id="engine-lane-label" class="active-edit-label">MAIN</span>
          <select id="engine-select"></select>
```

- [ ] **Step 2: Consult the policy in `injectEngineModulatorPanel`**

In `src/session/session-host-lane-editor.ts`, add the import near the top:

```ts
import { laneEditorPanels } from './lane-editor-panels';
```

After `host.innerHTML = '';` (line 121), insert:

```ts
  const panels = laneEditorPanels(lane?.engineId ?? engine.id);
```

Wrap the `engine.buildParamUI(...)` call (lines 123–142) so it only runs when `panels.engineParams`:

```ts
  if (panels.engineParams) {
    engine.buildParamUI(host, {
      laneId,
      registerKnob: (k: unknown) => {
        const handle = k as import('../core/knob').KnobHandle;
        if (handle.meta?.id) self.deps.automationRegistry.set(handle.meta.id, handle);
      },
      registry: self.deps.automationRegistry as Map<string, unknown>,
      lookupLaneDisplayName: (id: string) =>
        self.state.lanes.find((l) => l.id === id)?.name,
      sessionState: self.state,
      historyDeps: self.deps.historyDeps,
      laneInserts: self.deps.laneResources?.get(laneId)?.inserts,
      masterInserts: self.deps.masterInsertChain,
      fxBus: self.deps.fxBus,
      audioContext: self.deps.ctx,
    });
  }
```

Change the NOTE FX guard (line 146) from `if (engine.id !== 'drums-machine')` to `if (panels.noteFx)`:

```ts
  if (panels.noteFx) {
    const nfHost = document.createElement('div');
    nfHost.className = 'lane-notefx-panel-host';
    host.appendChild(nfHost);
    renderNoteFxPanel(nfHost, {
      laneId,
      chain: getNoteFxChain(laneId),
      onChange: (noteFx) => syncNoteFx(self.state, laneId, noteFx),
      historyDeps: self.deps.historyDeps,
    });
  }
```

(`self.inspector.mountLaneInserts(laneId, host);` at line 161 stays unconditional — `panels.inserts` is always true.)

Replace the preset block (lines 169–174) to gate on `panels.preset` and toggle the header row:

```ts
  // Hide the poly page's ENGINE/PRESET/🎲 header row for audio lanes (an audio
  // channel is not an instrument). The subtractive knob rows are already hidden
  // for non-subtractive engines elsewhere.
  if (targetTab === 'poly') {
    const headerRow = page.querySelector<HTMLElement>('#poly-engine-row');
    if (headerRow) headerRow.style.display = panels.engineHeaderRow ? '' : 'none';
  }
  if (panels.preset) {
    if (targetTab === 'poly') { populatePolyPresetSelectForLane(laneId); refreshPolyPresetSelect(); }
    if (targetTab === '303') mountBassPresetSelect(laneId);
    if (targetTab === 'drums') mountDrumsPresetSelect(laneId);
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Run the touched-area tests (regression)**

Run: `NO_COLOR=1 npx vitest run src/session/lane-editor-panels.test.ts src/session/clip-editors/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html src/session/session-host-lane-editor.ts
git commit -m "feat(audio): audio lane editor drops instrument chrome (keeps inserts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reject engine-swap for audio lanes

The engine selector is now hidden for audio lanes, but `audio`'s `editor` is `'piano-roll'`, so the swap guard would still allow a programmatic swap. Reject it explicitly.

**Files:**
- Modify: `src/app/engine-swap.ts` (`swapLaneEngineFlow`, guards around lines 36–38)

- [ ] **Step 1: Read the current guard**

Read `src/app/engine-swap.ts` `swapLaneEngineFlow` (~lines 29–57) to locate the early-return guards (they reject when `getEngineEditor(...)` isn't `'piano-roll'`) and confirm where `lane` and `newEngineId` are in scope.

- [ ] **Step 2: Add an explicit `'audio'` rejection**

Immediately after the function reads `lane` and `newEngineId` (before the existing editor guards), add:

```ts
  // An audio channel is not a swappable instrument (and a synth can't become one).
  if (lane.engineId === 'audio' || newEngineId === 'audio') return false;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/engine-swap.ts
git commit -m "fix(audio): reject engine-swap to/from the audio engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification + live acceptance

- [ ] **Step 1: Typecheck + fast suite**

Run: `npx tsc --noEmit` (expect exit 0)
Run: `npm run test:fast` (expect all green; a flaky `ERR_IPC_CHANNEL_CLOSED` teardown after green is not a failure — re-run once).

- [ ] **Step 2: Live acceptance (build/dev + a real import or a saved stems session)**

Run `npm run dev`, with the stem-service on :8765 import a song (Replace, Transcribe off). Confirm:
- **Open an audio (stem) lane** → its editor shows **only the FX inserts**: NO engine selector, NO preset, NO 🎲 Sound, NO NOTE FX, NO Gain knob in the lane editor.
- **Open the stem's clip** → the waveform editor's toolbar shows **[Gain] [♺ Warp]**; the Gain knob changes the level and is still automatable (appears in the modulation/automation destination list under `<laneId>.gain`).
- **A melodic lane (e.g. Sub/303)** is unchanged — full instrument editor (engine selector, preset, 🎲, NOTE FX, knobs).
- The engine selector is not shown for the audio lane (you can't swap it to a synth).

This step is **manual** (visual) and is the real acceptance gate per the spec.

---

## Self-review notes for the implementer

- **Order matters:** Task 2 adds Gain to the clip editor BEFORE Task 3 removes it from the lane editor, so Gain is never missing from the UI between commits.
- **`KnobHandle.meta?.id`:** the registry key is the canonical `<laneId>.gain` — the same id `injectEngineModulatorPanel` registers under today, so automation/modulation keeps working after the move.
- **Out of scope (Phase 2b):** beat detection + draggable warp markers + piecewise stretch. They will add controls to this same clip-editor toolbar later.
