# Preset is a per-channel property — remove per-scene preset recall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `SessionScene.presetPerLane` so a channel (lane) has exactly one synth configuration; launching clips or scenes never changes the sound.

**Architecture:** The sound of a channel already lives in `SessionLane.engineState` + `SessionLane.enginePresetName`. The only thing breaking that model is `scene.presetPerLane`, which is re-applied on every scene launch. We remove the two apply sites, stop MIDI import from emitting the field, delete the field from the type, and strip it from the demo JSON assets. No saved-state migration — old saves that still contain the field simply stop being read. Per-clip parameter automation (`ClipEnvelope`) is unaffected.

**Tech Stack:** TypeScript, Vite, Vitest (Node env, `node-web-audio-api`). JSON demo assets in `public/demos/`.

**Spec:** [docs/superpowers/specs/2026-06-01-preset-per-channel-design.md](../specs/2026-06-01-preset-per-channel-design.md)

---

## Pre-flight

This is feature work on top of `main`. Per the project workflow, execute it in an isolated **branch + worktree** (via the `superpowers:using-git-worktrees` skill), commit freely on the branch, then rebase onto `main` and `merge --ff` at the end. The spec commit (`5a10e1a`) is already on `main`; rebase will pick it up.

**Test conventions (from CLAUDE.md):**
- Single file: `NO_COLOR=1 npx vitest run <path>` (do NOT add `--reporter=`).
- Full unit suite: `npm run test:unit`. It has a flaky teardown that can exit non-zero with `ERR_IPC_CHANNEL_CLOSED` *after all tests pass* — that is not a failure; re-run to confirm green.
- Typecheck + bundle: `npm run build`.

**Commit message footer (every commit):**
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## File Structure

Files touched (no new files):

- `src/session/session-host.ts` — remove preset apply in `onLaunchScene` (runtime). *(Task 1)*
- `src/main.ts` — remove preset apply in `launchSceneById`, replace with a one-time per-lane `enginePresetName` apply for freshly-allocated (imported) lanes; fix a stale boot comment. *(Task 1)*
- `src/session/session-host-presets.test.ts` — delete the now-obsolete `onLaunchScene` preset test; keep the load-time test. *(Task 1)*
- `src/midi/midi-to-session.ts` — stop building/emitting `presetPerLane`; keep setting `lane.enginePresetName`. *(Task 2)*
- `src/midi/midi-to-session.test.ts` — retarget 3 assertions from `scene.presetPerLane` to `lane.enginePresetName`. *(Task 2)*
- `src/session/session.ts` — delete the `presetPerLane` field + JSDoc from `SessionScene`. *(Task 3)*
- `src/session/session.test.ts` — remove the `SessionScene.presetPerLane` describe block; trim now-unused imports. *(Task 3)*
- `public/demos/*.json` (6 files) — strip the `presetPerLane` property from every scene. *(Task 4)*

Task ordering keeps every commit compiling: consumers are removed first (Tasks 1–2), then the field (Task 3), then the inert demo data (Task 4).

---

### Task 1: Stop applying presets on scene launch

**Files:**
- Modify: `src/session/session-host.ts:462-474` (`onLaunchScene`)
- Modify: `src/main.ts:574-595` (`launchSceneById`) and `src/main.ts:650-653` (boot comment)
- Test: `src/session/session-host-presets.test.ts:63-88` (delete one `describe`)

- [ ] **Step 1: Remove the preset-apply block in `onLaunchScene`**

In `src/session/session-host.ts`, replace this exact block:

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
        if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
        self.renderWithMixer();
      },
```

with:

```ts
      onLaunchScene(idx) {
        const scene = self.state.scenes[idx];
        if (!scene) return;
        void ctx.resume();
        launchScene(self.laneStates, self.state, scene, idx, ctx.currentTime, seq.bpm);
        if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
        self.renderWithMixer();
      },
```

(The `applyPresetForLane` dep is still used by `applyLoadedSessionState` at `session-host.ts:262`; leave the dep and that call alone.)

- [ ] **Step 2: Replace the preset-apply block in `launchSceneById` with a one-time per-lane apply**

In `src/main.ts`, replace this exact block (lines ~575-594):

```ts
  const idx = sessionHost.state.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) return;
  const scene = sessionHost.state.scenes[idx];
  void ctx.resume();
  // Ensure resources exist for any freshly-imported lanes BEFORE launch — the
  // host's normal path runs this in applyLoadedSessionState; importer-added
  // lanes bypass that, so do it here.
  for (const lane of sessionHost.state.lanes) {
    ensureLaneResource(lane.id, lane.engineId);
  }
  launchSceneRuntime(sessionHost.laneStates, sessionHost.state, scene, idx, ctx.currentTime, seq.bpm);
  if (scene.presetPerLane) {
    for (const [laneId, presetName] of Object.entries(scene.presetPerLane)) {
      const inst = getLaneEngineInstance(laneId);
      if (!inst) continue;
      applyPresetToEngine(inst, presetName);
    }
  }
  if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
  sessionHost.renderWithMixer();
```

with:

```ts
  const idx = sessionHost.state.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) return;
  const scene = sessionHost.state.scenes[idx];
  void ctx.resume();
  // Ensure resources exist for any freshly-imported lanes BEFORE launch — the
  // host's normal path runs this in applyLoadedSessionState; importer-added
  // lanes bypass that, so do it here. Apply each lane's preset once, when its
  // resource is first allocated, so imported tracks play their matched GM
  // preset. Launching a scene never re-applies a preset to an already-allocated
  // lane — the sound is a per-channel property.
  for (const lane of sessionHost.state.lanes) {
    const isNew = !laneResources.get(lane.id);
    ensureLaneResource(lane.id, lane.engineId);
    if (isNew && lane.enginePresetName) {
      const inst = getLaneEngineInstance(lane.id);
      if (inst) applyPresetToEngine(inst, lane.enginePresetName);
    }
  }
  launchSceneRuntime(sessionHost.laneStates, sessionHost.state, scene, idx, ctx.currentTime, seq.bpm);
  if (!seq.isPlaying()) { resetAutomationPosition(); seq.start(); playBtn.textContent = '■'; }
  sessionHost.renderWithMixer();
```

Notes for the implementer:
- `laneResources` is already in scope — it is destructured at `src/main.ts:113` as `const { resources: laneResources, ... } = lanes;`.
- `getLaneEngineInstance` and `applyPresetToEngine` are already in scope (`main.ts:504`, imported at `main.ts:31`).
- `laneResources.get(lane.id)` returns the existing resource or `undefined`; `!...` is therefore "this lane has no resource yet" = freshly allocated.

- [ ] **Step 3: Fix the stale boot comment**

In `src/main.ts`, replace this exact comment (lines 650-653):

```ts
// Boot demo: fetched as a static JSON asset rather than constructed
// programmatically. The JSON drives both the SessionState and the
// per-scene preset map; applyLoadedSessionState reads lane.enginePresetName
// and onLaunchScene reads scene.presetPerLane.
```

with:

```ts
// Boot demo: fetched as a static JSON asset rather than constructed
// programmatically. The JSON drives the SessionState; applyLoadedSessionState
// reads each lane.enginePresetName to set that channel's sound.
```

- [ ] **Step 4: Delete the obsolete scene-launch preset test**

In `src/session/session-host-presets.test.ts`, delete this entire block (lines 63-88), including the blank line above it:

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
    // Build callbacks without going through init() (which touches the DOM toolbar).
    (host as unknown as { buildCallbacks(): void }).buildCallbacks();
    // Reach into the host's callbacks to launch scene 0 without rendering DOM.
    const cbs = (host as unknown as { callbacks: { onLaunchScene(i: number): void } }).callbacks;
    cbs.onLaunchScene(0);
    expect(applied).toEqual(['subtractive-1=factory:LEAD Bright Saw']);
  });
});
```

The first describe (`SessionHost.applyLoadedSessionState — preset application`, lines 42-61) stays — it verifies the per-channel `enginePresetName` is applied on load, which is exactly the behavior we keep.

- [ ] **Step 5: Typecheck + bundle**

Run: `npm run build`
Expected: completes with no TypeScript errors (`tsc` clean, Vite bundle written). `scene.presetPerLane` is no longer referenced by `session-host.ts` or `main.ts`; the field still exists on the type, so this compiles.

- [ ] **Step 6: Run the preset test file**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-presets.test.ts`
Expected: PASS — 1 test (`calls deps.applyPresetForLane for every lane with enginePresetName`).

- [ ] **Step 7: Commit**

```bash
git add src/session/session-host.ts src/main.ts src/session/session-host-presets.test.ts
git commit -m "refactor(session): scene launch no longer applies presets

Preset/synth state is a per-channel property. onLaunchScene and the MIDI
import launch path stop re-applying scene.presetPerLane; imported lanes get
their enginePresetName once, when their resource is first allocated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Stop MIDI import from emitting `presetPerLane`

**Files:**
- Modify: `src/midi/midi-to-session.ts:48,95,105-110`
- Test: `src/midi/midi-to-session.test.ts:31,69,85`

- [ ] **Step 1: Retarget the test assertions to `enginePresetName`**

In `src/midi/midi-to-session.test.ts`, change the three assertions.

Line 31 — replace:
```ts
    expect(result.scene.presetPerLane?.[result.newLanes[0].id]).toBe('factory:BASS Acid Classic');
```
with:
```ts
    expect(result.newLanes[0].enginePresetName).toBe('factory:BASS Acid Classic');
```

Line 69 — replace:
```ts
    expect(result.scene.presetPerLane?.[result.newLanes[0].id]).toBe('factory:Init');
```
with:
```ts
    expect(result.newLanes[0].enginePresetName).toBe('factory:Init');
```

Line 85 — replace:
```ts
    expect(result.scene.presetPerLane?.[result.newLanes[0].id]).toBe('factory:Init');
```
with:
```ts
    expect(result.newLanes[0].enginePresetName).toBe('factory:Init');
```

- [ ] **Step 2: Run the test — it already passes**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-to-session.test.ts`
Expected: PASS. `midi-to-session.ts:91` already sets `lane.enginePresetName = \`factory:${match.presetName}\``, so the per-lane assertion holds before we touch the source. This confirms the preset is carried on the lane independently of `presetPerLane`.

- [ ] **Step 3: Remove the `presetPerLane` emission from the importer**

In `src/midi/midi-to-session.ts`:

(a) Delete the accumulator declaration (line 48):
```ts
  const presetPerLane: Record<string, string> = {};
```

(b) Delete the assignment inside the track loop (line 95):
```ts
    presetPerLane[lane.id] = `factory:${match.presetName}`;
```

(c) Remove the field from the returned scene. Replace (lines 105-110):
```ts
  const scene: SessionScene = {
    id: nextId('scene'),
    name: 'MIDI Import',
    clipPerLane,
    presetPerLane,
  };
```
with:
```ts
  const scene: SessionScene = {
    id: nextId('scene'),
    name: 'MIDI Import',
    clipPerLane,
  };
```

Leave `lane.enginePresetName = \`factory:${match.presetName}\`` (line 91) untouched.

- [ ] **Step 4: Typecheck + bundle**

Run: `npm run build`
Expected: clean. (The field still exists on `SessionScene`; we just no longer set it.)

- [ ] **Step 5: Re-run the importer test**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-to-session.test.ts`
Expected: PASS (all `midiToSession` tests green).

- [ ] **Step 6: Commit**

```bash
git add src/midi/midi-to-session.ts src/midi/midi-to-session.test.ts
git commit -m "refactor(midi): import sets per-lane enginePresetName, not scene.presetPerLane

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Delete `presetPerLane` from the data model

**Files:**
- Modify: `src/session/session.ts:65-73` (`SessionScene` interface)
- Test: `src/session/session.test.ts:2,4-18`

- [ ] **Step 1: Remove the field + JSDoc from `SessionScene`**

In `src/session/session.ts`, replace this exact interface:

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

with:

```ts
export interface SessionScene {
  id: string;
  name?: string;
  clipPerLane: Record<string, number | null>;
}
```

- [ ] **Step 2: Remove the obsolete describe block + trim imports in `session.test.ts`**

In `src/session/session.test.ts`, delete this block (lines 4-18, including the trailing blank line):

```ts
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

Then trim the now-unused imports. Replace line 2:
```ts
import { emptyScene, audioClip, type SessionScene } from './session';
```
with:
```ts
import { audioClip } from './session';
```

(The remaining `describe('audioClip', ...)` block uses only `audioClip`.)

- [ ] **Step 3: Typecheck + bundle**

Run: `npm run build`
Expected: clean. No file references `presetPerLane` any more (verified in Step 4), so removing the field compiles.

- [ ] **Step 4: Verify zero source references remain**

Run: `NO_COLOR=1 npx vitest run src/session/session.test.ts`
Expected: PASS — 2 tests in the `audioClip` describe.

Also confirm nothing in `src/` still mentions the field:
Run (Grep tool, or `git grep`): search for `presetPerLane` across `src/`.
Expected: **no matches**.

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/session.test.ts
git commit -m "refactor(session): drop SessionScene.presetPerLane field

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Strip `presetPerLane` from demo JSON assets

**Files (modify):**
- `public/demos/minimal-techno.json` (4 scenes)
- `public/demos/mgmt-kids.json` (1 scene)
- `public/demos/lfo-test.json` (1 scene, empty map)
- `public/demos/solid-sessions-janeiro.json` (1 scene)
- `public/demos/untitled.json` (1 scene)
- `public/demos/sweet-dreams.json` (1 scene)

Each scene object ends with `clipPerLane` followed by `presetPerLane` as its **last** property:

```json
      "clipPerLane": {
        ...
      },
      "presetPerLane": {
        ...
      }
    }
```

Removing `presetPerLane` means deleting the comma after `clipPerLane`'s closing brace **and** the whole `presetPerLane` block, leaving:

```json
      "clipPerLane": {
        ...
      }
    }
```

All demo lanes already carry a matching `enginePresetName` (verified), so removing this drops no sound. The only audible change is `minimal-techno`: each channel now plays one fixed preset (what was Scene 1's) across all four scenes instead of varying per scene.

- [ ] **Step 1: Edit each demo file**

For each of the 6 files: open it, locate every `"presetPerLane"` occurrence, and remove the property (plus the preceding comma on `clipPerLane`'s closing brace). Read the surrounding lines first so the `Edit` `old_string` matches exactly. Two worked examples:

`minimal-techno.json` — Scene 1 (around line 3296):
```json
        "subtractive-2": null
      },
      "presetPerLane": {
        "subtractive-1": "factory:PAD Warm",
        "subtractive-2": "factory:PAD Sweep",
        "tb-303-1": "engine:Acid Classic"
      }
    }
```
becomes:
```json
        "subtractive-2": null
      }
    }
```
Repeat for its other three scenes (lines ~3313, ~3328, ~3343).

`lfo-test.json` — empty map (around line 2417):
```json
        "subtractive-1": 1
      },
      "presetPerLane": {}
    }
```
becomes:
```json
        "subtractive-1": 1
      }
    }
```

- [ ] **Step 2: Verify no occurrences remain and JSON is valid**

Run: search for `presetPerLane` across `public/demos/` (Grep tool or `git grep presetPerLane -- public/demos`).
Expected: **no matches**.

Run (validates every demo parses):
```bash
node -e "const fs=require('fs');for(const f of fs.readdirSync('./public/demos')){JSON.parse(fs.readFileSync('./public/demos/'+f,'utf8'));console.log('ok',f);}"
```
Expected: `ok <file>` for each `.json`, no parse errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add public/demos/minimal-techno.json public/demos/mgmt-kids.json public/demos/lfo-test.json public/demos/solid-sessions-janeiro.json public/demos/untitled.json public/demos/sweet-dreams.json
git commit -m "chore(demos): strip presetPerLane from demo sessions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification

- [ ] **Step 1: Full unit suite**

Run: `npm run test:unit`
Expected: all tests pass. If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` after the summary shows all green, that is the known flaky teardown — re-run to confirm.

- [ ] **Step 2: Build (serves the e2e/preview bundle)**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Browser smoke (manual)**

Start `npm run dev`, open <http://localhost:5173>:
- Load the **minimal-techno** demo. Launch Scene 1, then Scene 2, 3, 4 in turn. The TB-303 and subtractive channels must keep the **same** preset/sound across all scenes (no preset change on scene switch).
- Tweak a knob on a channel, then launch a different scene — the tweak must persist (scene launch does not reset the sound).
- Import a small MIDI file — each imported track must play its matched GM preset (not the engine default) on first launch.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch`: rebase onto `main`, `merge --ff` (no merge commit), per the project workflow.

---

## Self-Review (completed during planning)

- **Spec coverage:** every spec section maps to a task — data model → Task 3; runtime (both apply sites) → Task 1; MIDI import + imported-lane apply → Tasks 1–2; no migration → no task (explicitly stated); demos (6 files) → Task 4; tests (3 files) → Tasks 1–3; verification → Task 5. No gaps.
- **Placeholder scan:** no TBD/TODO/"handle errors"; every code step shows exact before/after.
- **Type/name consistency:** `laneResources` matches the `main.ts:113` destructure name; `enginePresetName` / `applyPresetToEngine` / `getLaneEngineInstance` match their definitions; `SessionScene` shape after Task 3 (`id`/`name?`/`clipPerLane`) matches what `emptyScene` already returns.
