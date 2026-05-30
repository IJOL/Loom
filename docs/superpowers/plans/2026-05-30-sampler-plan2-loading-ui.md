# Sampler Plan 2 — Loading UI + Keymap Editor

> **For agentic workers:** execute task-by-task (subagent-driven). Checkbox steps. Builds on Plan 1 (the `src/samples/` domain + `SamplerEngine` playing one-shots).

**Goal:** Make the sampler usable from the app: load an audio file via a picker (and drag-drop) in the Sampler lane inspector, manage a keymap (sample → root note + key range), and play it melodically from the piano-roll. Keymap survives tab switches within a session (full reload-hydration is Plan 4).

**Architecture:** A shared `IdbSampleStore` singleton + a pure `addSampleToKeymap` helper. `lane.engineState.sampler.keymap` persists the keymap (mirrored on edit, restored in `applyEngineState`). `EngineUIContext` gains the live `AudioContext`. `SamplerEngine.buildParamUI` renders the param knobs (via `wireEngineParams`) plus a keymap editor (file picker + drop zone + per-entry root/range/remove). On load: `importFile` → `store.put` → `sampleCache.put` → `setKeymap` → mirror → re-render.

**Tech stack:** TypeScript, Web Audio, Vitest (node) for logic, Playwright (app) for the UI flow.

**Scope:** one-shot load + play + keymap edit + intra-session persistence. **Out (later):** loop/song clips (Plan 3); reload hydration from IndexedDB, missing-sample relink, drag-onto-grid-cell, waveform thumbnail (Plan 4).

---

## File Structure

**Create:**
- `src/samples/store-singleton.ts` — shared `sampleStore` (`IdbSampleStore`).
- `src/samples/keymap-edit.ts` — pure `addSampleToKeymap`, `removeKeymapEntry`, `setEntryRoot`, `setEntryRange`.
- `src/samples/keymap-edit.test.ts`.
- `tests/e2e/sampler.spec.ts` — Playwright: add a Sampler lane, load a generated WAV, confirm the keymap row appears.

**Modify:**
- `src/session/session.ts` — `engineState.sampler?: { keymap: KeymapEntry[] }`.
- `src/session/session-engine-state.ts` — `mirrorKeymapChange` + `readLaneKeymap`.
- `src/session/session-engine-state.test.ts` — tests for the above (create if absent).
- `src/engines/engine-types.ts` — `EngineUIContext.audioContext?: AudioContext`.
- `src/session/session-host.ts` — pass `audioContext: this.deps.ctx` into `buildParamUI`; restore `engineState.sampler.keymap` in `applyEngineState`.
- `src/engines/sampler.ts` — implement `buildParamUI` (knobs + keymap editor); `dispose` unchanged.

---

## Task 1: Shared store singleton + pure keymap-edit helpers

**Files:** Create `src/samples/store-singleton.ts`, `src/samples/keymap-edit.ts`, `src/samples/keymap-edit.test.ts`.

- [ ] **Step 1: failing test** — `src/samples/keymap-edit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addSampleToKeymap, removeKeymapEntry, setEntryRoot, setEntryRange } from './keymap-edit';
import type { KeymapEntry } from './types';

const base: KeymapEntry[] = [{ sampleId: 'a', rootNote: 60, loNote: 0, hiNote: 127 }];

describe('keymap-edit', () => {
  it('addSampleToKeymap appends a full-range melodic entry by default', () => {
    const out = addSampleToKeymap([], 'a');
    expect(out).toEqual([{ sampleId: 'a', rootNote: 60, loNote: 0, hiNote: 127 }]);
  });
  it('addSampleToKeymap accepts a root override and does not mutate the input', () => {
    const input: KeymapEntry[] = [];
    const out = addSampleToKeymap(input, 'b', { rootNote: 48 });
    expect(out[0].rootNote).toBe(48);
    expect(input).toEqual([]); // immutability
  });
  it('removeKeymapEntry removes by index', () => {
    expect(removeKeymapEntry(base, 0)).toEqual([]);
  });
  it('setEntryRoot updates one entry root, leaving others intact', () => {
    const two = [...base, { sampleId: 'c', rootNote: 36, loNote: 36, hiNote: 36 }];
    const out = setEntryRoot(two, 1, 40);
    expect(out[1].rootNote).toBe(40);
    expect(out[0].rootNote).toBe(60);
  });
  it('setEntryRange clamps lo<=hi and stays in 0..127', () => {
    const out = setEntryRange(base, 0, 200, -5);
    expect(out[0].loNote).toBeGreaterThanOrEqual(0);
    expect(out[0].hiNote).toBeLessThanOrEqual(127);
    expect(out[0].loNote).toBeLessThanOrEqual(out[0].hiNote);
  });
});
```

- [ ] **Step 2: run → FAIL** — `npx cross-env NO_COLOR=1 vitest run src/samples/keymap-edit.test.ts`

- [ ] **Step 3: implement** — `src/samples/store-singleton.ts`:

```ts
// src/samples/store-singleton.ts
// One shared IndexedDB sample store for the whole app (UI imports + Plan-4
// hydration use the same instance / database).
import { IdbSampleStore } from './sample-store';
export const sampleStore = new IdbSampleStore();
```

`src/samples/keymap-edit.ts`:

```ts
// src/samples/keymap-edit.ts
// Pure, immutable edits to a one-shot keymap. No DOM, no audio.
import type { KeymapEntry } from './types';

const clampNote = (n: number) => Math.max(0, Math.min(127, Math.round(n)));

/** Append a sample as a melodic full-range entry (root C3 by default). */
export function addSampleToKeymap(
  keymap: KeymapEntry[],
  sampleId: string,
  opts: { rootNote?: number } = {},
): KeymapEntry[] {
  const rootNote = clampNote(opts.rootNote ?? 60);
  return [...keymap, { sampleId, rootNote, loNote: 0, hiNote: 127 }];
}

export function removeKeymapEntry(keymap: KeymapEntry[], index: number): KeymapEntry[] {
  return keymap.filter((_, i) => i !== index);
}

export function setEntryRoot(keymap: KeymapEntry[], index: number, rootNote: number): KeymapEntry[] {
  return keymap.map((e, i) => (i === index ? { ...e, rootNote: clampNote(rootNote) } : e));
}

export function setEntryRange(keymap: KeymapEntry[], index: number, lo: number, hi: number): KeymapEntry[] {
  let loN = clampNote(lo);
  let hiN = clampNote(hi);
  if (loN > hiN) [loN, hiN] = [hiN, loN];
  return keymap.map((e, i) => (i === index ? { ...e, loNote: loN, hiNote: hiN } : e));
}
```

- [ ] **Step 4: run → PASS** (5 tests). Then `npx tsc --noEmit`.
- [ ] **Step 5: commit** — `git add src/samples/store-singleton.ts src/samples/keymap-edit.ts src/samples/keymap-edit.test.ts && git commit -m "feat(samples): shared store singleton + pure keymap-edit helpers"`

---

## Task 2: Persist keymap in engineState

**Files:** Modify `src/session/session.ts`, `src/session/session-engine-state.ts`; test `src/session/session-engine-state.test.ts`.

- [ ] **Step 1: failing test** — append to (or create) `src/session/session-engine-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mirrorKeymapChange, readLaneKeymap } from './session-engine-state';
import type { SessionState } from './session';
import type { KeymapEntry } from '../samples/types';

function stateWithLane(): SessionState {
  return { lanes: [{ id: 'sampler-1', engineId: 'sampler', clips: [] }], scenes: [], globalQuantize: '1/1' };
}

describe('keymap persistence in engineState', () => {
  it('mirrorKeymapChange writes the keymap onto lane.engineState.sampler.keymap', () => {
    const s = stateWithLane();
    const km: KeymapEntry[] = [{ sampleId: 'a', rootNote: 60, loNote: 0, hiNote: 127 }];
    mirrorKeymapChange(s, 'sampler-1', km);
    expect(s.lanes[0].engineState?.sampler?.keymap).toEqual(km);
  });
  it('readLaneKeymap round-trips, returns [] when absent', () => {
    const s = stateWithLane();
    expect(readLaneKeymap(s, 'sampler-1')).toEqual([]);
    const km: KeymapEntry[] = [{ sampleId: 'b', rootNote: 48, loNote: 0, hiNote: 127 }];
    mirrorKeymapChange(s, 'sampler-1', km);
    expect(readLaneKeymap(s, 'sampler-1')).toEqual(km);
  });
});
```

- [ ] **Step 2: run → FAIL**: `npx cross-env NO_COLOR=1 vitest run src/session/session-engine-state.test.ts`

- [ ] **Step 3: implement.** In `src/session/session.ts`, extend the `engineState` shape on `SessionLane` (add the `sampler` field; keep existing `params`/`modulators`):

```ts
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
    sampler?: { keymap: import('../samples/types').KeymapEntry[] };
  };
```

In `src/session/session-engine-state.ts`, add:

```ts
import type { KeymapEntry } from '../samples/types';

/** Mirror the lane's one-shot keymap into engineState so it survives tab
 *  switches and save/load. */
export function mirrorKeymapChange(state: SessionState, laneId: string, keymap: KeymapEntry[]): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  lane.engineState.sampler = { keymap };
}

/** Read a lane's persisted keymap (empty array if none). */
export function readLaneKeymap(state: SessionState, laneId: string): KeymapEntry[] {
  return state.lanes.find((l) => l.id === laneId)?.engineState?.sampler?.keymap ?? [];
}
```

(If `session-engine-state.ts` does not already `import type { SessionState }`, add it.)

- [ ] **Step 4: run → PASS** (2 tests) + the existing suite for that file. Then `npx tsc --noEmit`.
- [ ] **Step 5: commit** — `git add src/session/session.ts src/session/session-engine-state.ts src/session/session-engine-state.test.ts && git commit -m "feat(session): persist sampler keymap in engineState"`

---

## Task 3: Thread AudioContext into EngineUIContext + restore keymap on apply

**Files:** Modify `src/engines/engine-types.ts`, `src/session/session-host.ts`.

- [ ] **Step 1: add the context field.** In `src/engines/engine-types.ts`, add to `EngineUIContext` (after `fxBus?`):

```ts
  /** Live AudioContext — sampler/UI code uses it to decode imported audio. */
  audioContext?: AudioContext;
```

- [ ] **Step 2: pass it from the host.** In `src/session/session-host.ts`, find the `engine.buildParamUI(host, { ... })` call (~line 590, in `injectEngineModulatorPanel`) and add to the context object:

```ts
      audioContext: this.deps.ctx,
```

- [ ] **Step 3: restore the keymap on load.** In `src/session/session-host.ts` `applyEngineState()` (~line 273), inside the per-lane loop, after the params restore block, add keymap restore:

```ts
      const km = lane.engineState?.sampler?.keymap;
      if (km && typeof (engine as { setKeymap?: unknown }).setKeymap === 'function') {
        (engine as unknown as { setKeymap(k: typeof km): void }).setKeymap(km);
      }
```

- [ ] **Step 4: verify typecheck + full suite.** `npx tsc --noEmit` (clean) and `npm run test:unit` (all pass — no behavior change to existing tests).
- [ ] **Step 5: commit** — `git add src/engines/engine-types.ts src/session/session-host.ts && git commit -m "feat(sampler): thread AudioContext into engine UI + restore keymap on load"`

---

## Task 4: SamplerEngine.buildParamUI — knobs + keymap editor

**Files:** Modify `src/engines/sampler.ts`.

This task builds DOM, so it is verified by running the app (Task 5), not by a unit test. Keep the logic delegating to the already-tested pure helpers.

- [ ] **Step 1: implement `buildParamUI`.** Add these imports to `src/engines/sampler.ts`:

```ts
import { wireEngineParams } from './engine-ui';
import { sampleStore } from '../samples/store-singleton';
import { importFile } from '../samples/import';
import { addSampleToKeymap, removeKeymapEntry, setEntryRoot } from '../samples/keymap-edit';
import { mirrorKeymapChange } from '../session/session-engine-state';
```

Replace the empty `buildParamUI` stub with:

```ts
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    // Param knobs (gain/attack/release/pitch/cutoff/res/voices).
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    container.appendChild(knobRow);
    wireEngineParams(this, ctx, knobRow, {
      formatter: (id, v) => {
        if (id === 'pitch') return `${v.toFixed(0)} st`;
        if (id === 'poly.voices') return `${Math.round(v)}`;
        if (id.endsWith('.attack') || id.endsWith('.release')) {
          return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
        }
        return `${Math.round(v * 100)}%`;
      },
    });

    // Keymap editor.
    const section = document.createElement('div');
    section.className = 'sampler-keymap';
    container.appendChild(section);

    const rebuild = () => { container.innerHTML = ''; this.buildParamUI(container, ctx); };

    const heading = document.createElement('div');
    heading.className = 'label';
    heading.textContent = 'Keymap';
    section.appendChild(heading);

    // File picker.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.className = 'sampler-load';
    section.appendChild(fileInput);

    const drop = document.createElement('div');
    drop.className = 'sampler-dropzone';
    drop.textContent = 'Drop an audio file, or use the picker above';
    section.appendChild(drop);

    const loadFile = async (file: File) => {
      const audioCtx = ctx.audioContext;
      if (!audioCtx) return;
      try {
        const asset = await importFile(file, audioCtx);
        await sampleStore.put(asset);
        const buf = await audioCtx.decodeAudioData(asset.bytes.slice(0));
        sampleCache.put(asset.id, buf);
        const km = addSampleToKeymap(this.getKeymap(), asset.id);
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
        rebuild();
      } catch (err) {
        drop.textContent = `Could not load: ${(err as Error).message}`;
      }
    };

    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void loadFile(f);
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) void loadFile(f);
    });

    // Entry list.
    const list = document.createElement('div');
    list.className = 'sampler-keymap-list';
    section.appendChild(list);
    const keymap = this.getKeymap();
    keymap.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'sampler-keymap-row';

      const name = document.createElement('span');
      name.className = 'sampler-keymap-name';
      name.textContent = entry.sampleId;
      row.appendChild(name);

      const rootLabel = document.createElement('label');
      rootLabel.textContent = 'root ';
      const root = document.createElement('input');
      root.type = 'number';
      root.min = '0'; root.max = '127';
      root.value = String(entry.rootNote);
      root.className = 'sampler-keymap-root';
      root.addEventListener('change', () => {
        const km = setEntryRoot(this.getKeymap(), i, Number(root.value));
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
      });
      rootLabel.appendChild(root);
      row.appendChild(rootLabel);

      const del = document.createElement('button');
      del.className = 'sampler-keymap-del';
      del.textContent = '✕';
      del.title = 'Remove';
      del.addEventListener('click', () => {
        const km = removeKeymapEntry(this.getKeymap(), i);
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
        rebuild();
      });
      row.appendChild(del);

      list.appendChild(row);
    });
    if (keymap.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sampler-keymap-empty';
      empty.textContent = 'No samples loaded yet.';
      list.appendChild(empty);
    }
  }
```

Ensure `sampleCache` is imported in `sampler.ts` (it already is, from Task 1.7). If not, add `import { sampleCache } from '../samples/sample-cache';`.

- [ ] **Step 2: minimal styles.** Append to `src/style.css` (or the project's main stylesheet — check where `.knob-row` is styled and co-locate):

```css
.sampler-keymap { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.sampler-dropzone { border: 1px dashed #79c; border-radius: 8px; padding: 8px; text-align: center; font-size: 12px; color: #9cf; }
.sampler-dropzone.over { background: rgba(120,180,255,.15); }
.sampler-keymap-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.sampler-keymap-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sampler-keymap-root { width: 48px; }
.sampler-keymap-empty { font-size: 11px; opacity: .6; }
```

- [ ] **Step 3: typecheck + full unit suite** — `npx tsc --noEmit` clean; `npm run test:unit` all pass.
- [ ] **Step 4: commit** — `git add src/engines/sampler.ts src/style.css && git commit -m "feat(sampler): keymap editor UI (load + root + remove) in inspector"`

---

## Task 5: App verification (Playwright)

**Files:** Create `tests/e2e/sampler.spec.ts`. Also run the app manually via the dev server to confirm sound.

- [ ] **Step 1: write the e2e** — `tests/e2e/sampler.spec.ts` (follow the existing patterns in `tests/e2e/`):

```ts
import { test, expect } from '@playwright/test';

// Generates a tiny valid WAV (0.2s sine) as a Buffer for file upload.
function makeWav(): Buffer {
  const sr = 8000, secs = 0.2, n = Math.floor(sr * secs);
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / sr) * 16000), 44 + i * 2);
  return buf;
}

test('load a sample into a Sampler lane', async ({ page }) => {
  await page.goto('/');
  // Add a Sampler lane via the engine picker (exact selectors per the app —
  // the implementer should inspect the session tab bar markup and adjust).
  // Select 'sampler' in the new-lane engine <select>, click the '+' add button.
  const sel = page.locator('select.session-tabs-engine');
  await sel.selectOption('sampler');
  await page.locator('button.session-tabs-add-btn').click();
  // Open the lane inspector / Synth tab so buildParamUI renders.
  // (implementer: wire the exact click path to show the engine panel)
  // Upload the WAV through the sampler file input.
  await page.locator('input.sampler-load').setInputFiles({
    name: 'tone.wav', mimeType: 'audio/wav', buffer: makeWav(),
  });
  // The keymap row should now show one entry.
  await expect(page.locator('.sampler-keymap-row')).toHaveCount(1);
});
```

- [ ] **Step 2: run e2e** — `npm run test:e2e -- sampler` (or `npx playwright test tests/e2e/sampler.spec.ts`). If selectors differ, the implementer inspects the running app and corrects them. The test must genuinely drive the real UI.

- [ ] **Step 3: manual sound check (controller).** Start `npm run dev`, open the app, add a Sampler lane, load a WAV, draw a note in the piano-roll, press play, confirm audible sound. (Verified by the controller via the running app, not the subagent.)

- [ ] **Step 4: commit** — `git add tests/e2e/sampler.spec.ts && git commit -m "test(e2e): load a sample into a Sampler lane"`

---

## Self-Review checklist
- Pure helpers (`keymap-edit`, `mirrorKeymapChange`/`readLaneKeymap`) are unit-tested.
- `EngineUIContext.audioContext` is optional (no break to other engines).
- `engineState.sampler` is additive (old saves load fine; absence → empty keymap).
- The UI delegates all state changes to tested pure helpers + persists via `mirrorKeymapChange`.
- App-level behavior verified by Playwright + a manual sound check.

## Next: Plan 3 (loop/song clips) then Plan 4 (reload hydration + polish).
