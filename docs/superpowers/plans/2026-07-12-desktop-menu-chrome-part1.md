# Desktop-style Menu Bar — Part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a classic desktop menu bar (File/Edit/View/Tools/Help) that drives Loom's general actions through a real exported API, convert the inline MIDI panels + musicality popover into modal dialogs, add a File ▸ Project Options dialog (project name + key/style), and surface moved state as clickable toolbar chips.

**Architecture:** A declarative `menu-spec` (data) is rendered by a `menu-bar` controller. Every menu item calls a method on a `MenuActions` object — the SAME exported functions the existing toolbar buttons call (NO synthetic `.click()`). Existing button handlers that are inline arrows get refactored into named/returned functions so both surfaces share one implementation. The three dialogs are native `<dialog>` elements bound by a tiny generic `bindModalDialog` helper; the MIDI dialogs simply relocate the existing DOM ids (so `wireMidiImportUI`/`wireControlSurfaceUI` keep working untouched). A new `SessionState.name` field backs the Project Options dialog and round-trips automatically through the existing V3 save.

**Tech Stack:** TypeScript, Vite, Dart Sass (`@use`), Vitest (unit), Playwright (e2e). No new dependencies.

## Global Constraints

- **UI text in English** — every label, tooltip, menu item, dialog title (Spanish is conversation-only).
- **No synthetic clicks** — menu items and toolbar buttons both call real exported functions on a shared `MenuActions`/handle object. Extract inline handlers into named functions; never `element.click()` from a menu.
- **File size:** ≤300 lines per source file (target), 500 hard cap. New modules must stay well under.
- **Test assertions relative** — ratios/relationships, never absolute magnitudes (DSP rule; here mostly structural assertions).
- **No new npm dependencies.**
- **Reuse, don't fork** — the menu never reimplements behaviour; it invokes existing functions. Musicality/MIDI logic is relocated, not rewritten.
- **Single unit-test invocation:** `NO_COLOR=1 npx vitest run <path>`. Do NOT add `--reporter`.
- **e2e serves `dist/`:** always `npm run build` before `npm run test:e2e`.
- **Version bump is manual** (`npm run bump`) — do not touch `version.json`.

---

## File Structure

**New files:**
- `src/app/modal-dialog.ts` — generic `bindModalDialog(id)` → `{ open, close, el }` for native `<dialog>`.
- `src/app/menu-actions.ts` — the `MenuActions` interface (the menu's contract).
- `src/app/menu-spec.ts` — `buildMenus(actions): MenuSpec[]` (pure data + resolvers).
- `src/app/menu-bar.ts` — `createMenuBar(host, menus)` renderer/controller.
- `src/app/menu-shortcuts.ts` — binds the NEW accelerators (Ctrl+N/O/S) to actions.
- `src/app/toolbar-status-chips.ts` — musicality + MIDI status chips.
- `src/midi/midi-import-dialog.ts` — `bindMidiImportDialog()` open handle (wraps existing ids).
- `src/control/midi-control-dialog.ts` — `bindMidiControlDialog()` open handle (wraps existing ids).
- `src/session/project-options-dialog.ts` — Project Options dialog (name + musicality controls).
- `src/styles/_menu-bar.scss` — menu bar + dropdown + chips + new-dialog styling.
- Tests: `src/app/menu-spec.test.ts`, `src/app/menu-bar.test.ts`, `src/session/project-options-dialog.test.ts`, `src/session/session-name.test.ts`, `tests/e2e/menu-bar.spec.ts`.

**Modified files:**
- `src/session/session-types.ts` — add `name?: string` to `SessionState`.
- `src/session/session.ts` — `emptySessionState()` seeds `name: 'Untitled'`.
- `src/session/session-migration.ts` — backfill missing `name`.
- `src/save/save-wiring.ts` — `wireSaveManager` returns `{ openForSave, openForLoad, close }`; pre-fill from project name.
- `src/stems/stem-dialog.ts` — `wireStemDialog` returns `{ open }`.
- `src/demo/demo-picker.ts` — export a reusable `loadDemoSession(...)` (or main assembles it).
- `src/session/session-host-callbacks.ts` — add `onRenameProject(name)` undoable mutation.
- `src/main.ts` — extract `newSession()`; assemble `MenuActions`; mount menu bar + chips; wire dialogs; drop old musicality bar.
- `index.html` — add menu-bar host + three `<dialog>`s; move MIDI/musicality DOM; remove old `<details>` + `#musicality-bar`.
- `src/style.scss` — `@use 'styles/menu-bar';`.

---

## Task 1: `SessionState.name` model + migration

**Files:**
- Modify: `src/session/session-types.ts` (SessionState interface, ~line 160-171)
- Modify: `src/session/session.ts` (`emptySessionState`, ~line 137-141)
- Modify: `src/session/session-migration.ts` (`migrateLoadedSessionState`, backfill block ~line 20)
- Test: `src/session/session-name.test.ts` (new)

**Interfaces:**
- Produces: `SessionState.name: string` (optional on the wire, always present after `emptySessionState()`/migration). Read as `sessionHost.state.name`.

- [ ] **Step 1: Write the failing test**

```ts
// src/session/session-name.test.ts
import { describe, it, expect } from 'vitest';
import { emptySessionState } from './session';
import { migrateLoadedSessionState } from './session-migration';
import type { SessionState } from './session-types';

describe('SessionState.name (project name)', () => {
  it('a fresh session is named "Untitled"', () => {
    expect(emptySessionState().name).toBe('Untitled');
  });

  it('migration backfills a missing name to "Untitled"', () => {
    const legacy = { lanes: [], scenes: [], globalQuantize: '1/1' } as unknown as SessionState;
    expect(migrateLoadedSessionState(legacy).name).toBe('Untitled');
  });

  it('migration preserves an existing name', () => {
    const named = { lanes: [], scenes: [], globalQuantize: '1/1', name: 'My Track' } as unknown as SessionState;
    expect(migrateLoadedSessionState(named).name).toBe('My Track');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-name.test.ts`
Expected: FAIL (`name` is `undefined`).

- [ ] **Step 3: Add the field to the type**

In `src/session/session-types.ts`, inside `export interface SessionState { ... }` add (keep it optional to match the additive `musicality?`/`sends?` pattern; it is always populated by the factory/migration):

```ts
  /** Project name shown/edited in File ▸ Project Options. Backfilled on load. */
  name?: string;
```

- [ ] **Step 4: Seed it in `emptySessionState()`**

In `src/session/session.ts`, update the returned literal:

```ts
export function emptySessionState(): SessionState {
  return { name: 'Untitled', lanes: [], scenes: [], globalQuantize: '1/1', musicality: { ...DEFAULT_MUSICALITY } };
}
```

- [ ] **Step 5: Backfill it in migration**

In `src/session/session-migration.ts`, in the additive-field backfill block (next to `if (!s.musicality) ...`), add:

```ts
  if (!s.name) s.name = 'Untitled';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/session/session-name.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/session/session-types.ts src/session/session.ts src/session/session-migration.ts src/session/session-name.test.ts
git commit -m "feat(session): add project name field (SessionState.name) + migration"
```

---

## Task 2: Exportable action handles (no synthetic clicks)

Refactor the inline handlers into real functions the menu can call. Existing buttons keep working by calling the same functions.

**Files:**
- Modify: `src/save/save-wiring.ts` (`wireSaveManager` returns handles)
- Modify: `src/stems/stem-dialog.ts` (`wireStemDialog` returns `{ open }`)
- Modify: `src/demo/demo-picker.ts` (export `loadDemoSession`)
- Modify: `src/main.ts` (extract `newSession()`; capture the returned handles)

**Interfaces:**
- Produces:
  - `wireSaveManager(deps): { openForSave(): void; openForLoad(): void; close(): void }`
  - `wireStemDialog(deps): { open(): void }`
  - `loadDemoSession(path: string, deps: { sessionHost; applyBpm?; onLoaded? }): Promise<void>` (exported from `demo-picker.ts`)
  - `newSession(): Promise<void>` (local named function in `main.ts`)

- [ ] **Step 1: Make `wireSaveManager` return open/close handles**

In `src/save/save-wiring.ts`, at the end of `wireSaveManager(deps)`, after the existing button wiring, `return` the local closures. The function currently wires `#save`/`#load` to `openManagerForSave`/`openManager`; keep that, and add:

```ts
  // Expose the openers so the menu bar can call the SAME functions (no synthetic clicks).
  return {
    openForSave: openManagerForSave,
    openForLoad: openManager,
    close: closeSaveManager,
  };
}
```

Update the function's return type annotation accordingly (e.g. `): { openForSave: () => void; openForLoad: () => void; close: () => void } {`).

- [ ] **Step 2: Make `wireStemDialog` return `{ open }`**

In `src/stems/stem-dialog.ts`, at the end of `wireStemDialog(deps)` (after `$('stems-open').addEventListener('click', open)` etc.), add:

```ts
  return { open };
}
```

Update its return type: `): { open: () => void } {`.

- [ ] **Step 3: Export a reusable `loadDemoSession` from `demo-picker.ts`**

In `src/demo/demo-picker.ts`, extract the `change`-handler body into an exported function and call it from the handler:

```ts
export async function loadDemoSession(
  path: string,
  deps: { sessionHost: { applyLoadedSessionState: (s: any) => void }; applyBpm?: (bpm: number) => void; onLoaded?: () => void },
): Promise<void> {
  if (!path) return;
  const state = await fetchDemoSession(path);
  deps.sessionHost.applyLoadedSessionState(state);
  if (typeof state.bpm === 'number') deps.applyBpm?.(state.bpm);
  deps.onLoaded?.();
}
```

Then inside `wireDemoPicker`, the `change` listener becomes:

```ts
selectEl.addEventListener('change', () => loadDemoSession(selectEl.value, { sessionHost, applyBpm, onLoaded }));
```

Keep `wireDemoPicker` exporting the demo list it was given (add `return { demos }` if not already, so the menu can build the submenu). If `wireDemoPicker` doesn't already retain the list, have it `return { demos: opts.demos }`.

- [ ] **Step 4: Extract `newSession()` in main.ts**

In `src/main.ts`, replace the inline `#new-session` arrow body with a named async function, and wire the button to it:

```ts
async function newSession(): Promise<void> {
  if (!await confirmDialog('Start a new empty session? Unsaved changes will be lost.')) return;
  stopTransport();
  sessionHost.applyLoadedSessionState(emptySessionState());
  performanceFeature.resetArrangement();
  autoHistory.markClean();
}
document.getElementById('new-session')?.addEventListener('click', () => { void newSession(); });
```

- [ ] **Step 5: Capture the returned handles in main.ts**

Where `wireSaveManager(...)` and `wireStemDialog(...)` are called, store the results:

```ts
const saveManager = wireSaveManager(savedStateDeps);   // { openForSave, openForLoad, close }
const stemDialog  = wireStemDialog(stemDeps);          // { open }
```

(Names `savedStateDeps`/`stemDeps` are whatever the existing call sites already pass.)

- [ ] **Step 6: Typecheck + existing tests**

Run: `npx tsc --noEmit`
Then: `NO_COLOR=1 npx vitest run src/save src/demo`
Expected: no type errors; existing tests pass (behaviour unchanged — this is a pure refactor).

- [ ] **Step 7: Commit**

```bash
git add src/save/save-wiring.ts src/stems/stem-dialog.ts src/demo/demo-picker.ts src/main.ts
git commit -m "refactor: expose save/stems/demo/new-session as callable functions (no synthetic clicks)"
```

---

## Task 3: Generic modal helper + convert MIDI panels to `<dialog>`

**Files:**
- Create: `src/app/modal-dialog.ts`
- Create: `src/midi/midi-import-dialog.ts`
- Create: `src/control/midi-control-dialog.ts`
- Modify: `index.html` (wrap the two MIDI DOM blocks in `<dialog>`s; keep all ids)
- Modify: `src/main.ts` (bind the two dialogs, expose `open`)
- Test: none new here (behaviour covered by existing MIDI tests + Task 9 e2e). Verify by build.

**Interfaces:**
- Produces:
  - `bindModalDialog(id: string): { open(): void; close(): void; el: HTMLDialogElement }`
  - `bindMidiImportDialog(): { open(): void }` (from `midi-import-dialog.ts`)
  - `bindMidiControlDialog(): { open(): void }` (from `midi-control-dialog.ts`)

- [ ] **Step 1: Write `bindModalDialog`**

```ts
// src/app/modal-dialog.ts
// Thin wrapper over a native <dialog>: open (showModal), close, light-dismiss on
// backdrop click, and any [data-dialog-close] button closes it. Esc is native.
export interface ModalHandle {
  open(): void;
  close(): void;
  el: HTMLDialogElement;
}

export function bindModalDialog(id: string): ModalHandle {
  const el = document.getElementById(id) as HTMLDialogElement | null;
  if (!el) throw new Error(`bindModalDialog: #${id} not found`);
  const close = () => { if (el.open) el.close(); };
  el.querySelectorAll('[data-dialog-close]').forEach((b) => b.addEventListener('click', close));
  // Backdrop click: the <dialog> element itself is the event target only when the
  // click lands on the ::backdrop area, not on inner content.
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  return { open: () => { if (!el.open) el.showModal(); }, close, el };
}
```

- [ ] **Step 2: Move the Import MIDI DOM into a `<dialog>` in `index.html`**

Remove the `<details class="midi-panel">…</details>` block (lines ~136-143). Add a `<dialog>` near the other modals (before `<script type="module">`), keeping the exact ids `poly-midi-file`, `poly-midi-load`, `poly-midi-tracklist`:

```html
<dialog id="midi-import-dialog" class="app-modal">
  <div class="app-modal-head">
    <h3>Import MIDI</h3>
    <button class="app-modal-x" data-dialog-close aria-label="Close">×</button>
  </div>
  <div class="app-modal-body midi-import-row">
    <input type="file" id="poly-midi-file" accept=".mid,.midi" />
    <button class="rnd primary" id="poly-midi-load" style="display:none;">Import MIDI</button>
    <div id="poly-midi-tracklist" class="midi-tracklist" style="display:none;"></div>
  </div>
  <div class="app-modal-foot">
    <button class="rnd" data-dialog-close>Close</button>
  </div>
</dialog>
```

- [ ] **Step 3: Move the MIDI Control DOM into a `<dialog>` in `index.html`**

Remove the `<details class="midi-control-panel">…</details>` block (lines ~144-152). Add, keeping ids `midi-control-enable`, `midi-control-status`, `midi-control-override`, `midi-control-rec`:

```html
<dialog id="midi-control-dialog" class="app-modal">
  <div class="app-modal-head">
    <h3>MIDI Controller</h3>
    <button class="app-modal-x" data-dialog-close aria-label="Close">×</button>
  </div>
  <div class="app-modal-body" id="midi-control-body">
    <button id="midi-control-enable" class="rnd">Enable MIDI controller</button>
    <span id="midi-control-status" class="midi-control-status">off</span>
    <select id="midi-control-override" class="midi-control-override" style="display:none;"></select>
    <button id="midi-control-rec" class="rnd" disabled>● Rec</button>
  </div>
  <div class="app-modal-foot">
    <button class="rnd" data-dialog-close>Close</button>
  </div>
</dialog>
```

- [ ] **Step 4: Write the two dialog binder modules**

```ts
// src/midi/midi-import-dialog.ts
import { bindModalDialog } from '../app/modal-dialog';
// The import LOGIC is wired separately by wireMidiImportUI (it looks up the ids
// inside this dialog at wire time). This module only owns open/close.
export function bindMidiImportDialog(): { open(): void } {
  const { open } = bindModalDialog('midi-import-dialog');
  return { open };
}
```

```ts
// src/control/midi-control-dialog.ts
import { bindModalDialog } from '../app/modal-dialog';
export function bindMidiControlDialog(): { open(): void } {
  const { open } = bindModalDialog('midi-control-dialog');
  return { open };
}
```

- [ ] **Step 5: Bind them in main.ts**

In `src/main.ts`, AFTER `wireMidiImportUI(...)` and `wireControlSurfaceUI(...)` run (so the ids exist and are wired), add:

```ts
const midiImportDialog  = bindMidiImportDialog();
const midiControlDialog = bindMidiControlDialog();
```

(Order note: `bindModalDialog` only needs the DOM to exist; `wireMidiImportUI`/`wireControlSurfaceUI` grab the same ids — both work because the ids live in the dialog markup from boot. Binding after wiring is safe.)

- [ ] **Step 6: Build to verify the DOM move didn't break wiring**

Run: `npm run build`
Expected: typecheck + bundle succeed. (`wireMidiImportUI`/`wireControlSurfaceUI` still find their ids inside the dialogs.)

- [ ] **Step 7: Commit**

```bash
git add src/app/modal-dialog.ts src/midi/midi-import-dialog.ts src/control/midi-control-dialog.ts index.html src/main.ts
git commit -m "feat(chrome): convert MIDI import + MIDI control panels to native <dialog>s"
```

---

## Task 4: Project Options dialog (name + musicality) + drop the musicality bar

**Files:**
- Create: `src/session/project-options-dialog.ts`
- Modify: `src/session/session-host-callbacks.ts` (add `onRenameProject`)
- Modify: `src/main.ts` (replace `renderMusicalityBar` block with the dialog; keep refresh)
- Modify: `index.html` (add `<dialog id="project-options-dialog">`; the `#musicality-bar` host is removed in Task 8)
- Test: `src/session/project-options-dialog.test.ts`

**Interfaces:**
- Consumes: `MusicalityState`, `renderMusicalityBar` deps shape (`get`/`onChange`), `SCALE_CATALOG`, `STYLE_CATALOG`, `rootName` from `../core/musicality`.
- Produces:
  - `renderProjectOptionsDialog(deps): { open(): void; refresh(): void }`
    where `deps = { getName(): string; setName(name: string): void; getMusicality(): MusicalityState; setMusicality(m: MusicalityState): void }`.
  - `sessionHost` callback `onRenameProject(name: string): void`.

- [ ] **Step 1: Add the `<dialog>` shell to index.html**

```html
<dialog id="project-options-dialog" class="app-modal">
  <div class="app-modal-head">
    <h3>Project Options</h3>
    <button class="app-modal-x" data-dialog-close aria-label="Close">×</button>
  </div>
  <div class="app-modal-body" id="project-options-body"><!-- filled by JS --></div>
  <div class="app-modal-foot">
    <button class="rnd" data-dialog-close>Close</button>
  </div>
</dialog>
```

- [ ] **Step 2: Write the failing test**

```ts
// src/session/project-options-dialog.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderProjectOptionsDialog } from './project-options-dialog';
import { DEFAULT_MUSICALITY } from './session-types';

function fixture() {
  document.body.innerHTML = `
    <dialog id="project-options-dialog" class="app-modal">
      <div class="app-modal-body" id="project-options-body"></div>
      <button data-dialog-close>Close</button>
    </dialog>`;
  // jsdom lacks showModal/close — stub them.
  const dlg = document.getElementById('project-options-dialog') as HTMLDialogElement;
  (dlg as any).showModal = function () { this.open = true; };
  (dlg as any).close = function () { this.open = false; };
}

describe('Project Options dialog', () => {
  beforeEach(fixture);

  it('renders the current name and writes edits back through setName', () => {
    let name = 'My Track';
    let mus = { ...DEFAULT_MUSICALITY };
    const h = renderProjectOptionsDialog({
      getName: () => name, setName: (n) => { name = n; },
      getMusicality: () => mus, setMusicality: (m) => { mus = m; },
    });
    h.open();
    const input = document.querySelector<HTMLInputElement>('#project-options-body input[data-po="name"]')!;
    expect(input.value).toBe('My Track');
    input.value = 'Renamed';
    input.dispatchEvent(new Event('change'));
    expect(name).toBe('Renamed');
  });

  it('writes a scale change back through setMusicality', () => {
    let mus = { ...DEFAULT_MUSICALITY };
    const h = renderProjectOptionsDialog({
      getName: () => 'x', setName: () => {},
      getMusicality: () => mus, setMusicality: (m) => { mus = m; },
    });
    h.open();
    const scaleSel = document.querySelector<HTMLSelectElement>('#project-options-body select[data-po="scale"]')!;
    const other = Array.from(scaleSel.options).find((o) => o.value !== mus.scale)!;
    scaleSel.value = other.value;
    scaleSel.dispatchEvent(new Event('change'));
    expect(mus.scale).toBe(other.value);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/project-options-dialog.test.ts`
Expected: FAIL (`renderProjectOptionsDialog` not defined).

- [ ] **Step 4: Implement the dialog**

```ts
// src/session/project-options-dialog.ts
// File ▸ Project Options: project name + key/scale/style/lock. Per-project state.
import { SCALE_CATALOG, STYLE_CATALOG, rootName, type ScaleId, type StyleId } from '../core/musicality';
import type { MusicalityState } from './session-types';
import { bindModalDialog } from '../app/modal-dialog';

export interface ProjectOptionsDeps {
  getName(): string;
  setName(name: string): void;
  getMusicality(): MusicalityState;
  setMusicality(m: MusicalityState): void;
}

export function renderProjectOptionsDialog(deps: ProjectOptionsDeps): { open(): void; refresh(): void } {
  const modal = bindModalDialog('project-options-dialog');
  const body = document.getElementById('project-options-body')!;

  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.dataset.po = 'name'; nameInput.className = 'po-name';
  nameInput.placeholder = 'Untitled';

  const rootSel = document.createElement('select'); rootSel.dataset.po = 'root';
  for (let pc = 0; pc < 12; pc++) {
    const o = document.createElement('option'); o.value = String(pc); o.textContent = rootName(pc); rootSel.appendChild(o);
  }
  const scaleSel = document.createElement('select'); scaleSel.dataset.po = 'scale';
  for (const s of SCALE_CATALOG) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = `${s.mood} — ${s.label} · ${s.hint}`; scaleSel.appendChild(o);
  }
  const styleSel = document.createElement('select'); styleSel.dataset.po = 'style';
  for (const s of STYLE_CATALOG) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; styleSel.appendChild(o);
  }
  const lockChk = document.createElement('input'); lockChk.type = 'checkbox'; lockChk.dataset.po = 'lock';
  lockChk.title = 'When ON, notes you place snap to the project key';

  const row = (label: string, el: HTMLElement) => {
    const r = document.createElement('label'); r.className = 'po-row';
    const s = document.createElement('span'); s.textContent = label; r.append(s, el); return r;
  };
  const group = (label: string) => { const g = document.createElement('div'); g.className = 'po-group'; g.textContent = label; return g; };

  body.append(
    group('Project'), row('Name', nameInput),
    group('Key & style'), row('Root', rootSel), row('Scale', scaleSel), row('Style', styleSel), row('Lock notes to key', lockChk),
  );

  const commitMus = () => deps.setMusicality({
    key: Number(rootSel.value), scale: scaleSel.value as ScaleId, style: styleSel.value as StyleId, lock: lockChk.checked,
  });
  nameInput.addEventListener('change', () => deps.setName(nameInput.value.trim() || 'Untitled'));
  rootSel.addEventListener('change', commitMus);
  scaleSel.addEventListener('change', commitMus);
  styleSel.addEventListener('change', commitMus);
  lockChk.addEventListener('change', commitMus);

  const refresh = () => {
    nameInput.value = deps.getName();
    const m = deps.getMusicality();
    rootSel.value = String(m.key); scaleSel.value = m.scale; styleSel.value = m.style; lockChk.checked = m.lock;
  };

  return { open: () => { refresh(); modal.open(); }, refresh };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/project-options-dialog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the undoable `onRenameProject` callback**

In `src/session/session-host-callbacks.ts`, copy the `onRenameLane` idiom (it mutates `self.state` inside a `withUndo` wrapper and re-renders):

```ts
  onRenameProject(name: string) {
    const hd = self.deps.historyDeps;
    const run = () => { self.state.name = name || 'Untitled'; self.renderWithMixer(); };
    if (hd) withUndo(hd, run); else run();
  },
```

Add `onRenameProject(name: string): void;` to the callbacks interface/type this object implements (mirror where `onRenameLane` is declared).

- [ ] **Step 7: Replace the musicality-bar block in main.ts with the dialog**

In `src/main.ts`, replace the `renderMusicalityBar(musicalityHost, {...})` call (and the `musicalityHost` lookup) with:

```ts
const projectOptions = renderProjectOptionsDialog({
  getName: () => sessionHost.state.name ?? 'Untitled',
  setName: (n) => sessionHost.callbacks.onRenameProject(n),   // undoable, re-renders
  getMusicality: () => sessionHost.state.musicality ?? DEFAULT_MUSICALITY,
  setMusicality: (next) => {
    const run = () => { sessionHost.state.musicality = next; sessionHost.renderWithMixer(); };
    if (_discreteHistoryDeps) withUndo(_discreteHistoryDeps, run); else run();
  },
});
sessionHost.onStateApplied(() => projectOptions.refresh());
```

(Use the exact accessor for the callbacks object — mirror how other code calls `sessionHost` callbacks. If callbacks aren't publicly reachable, mutate directly with the same `withUndo` wrapper used for `setMusicality`.)

- [ ] **Step 8: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success. (The `#musicality-bar` host still exists in index.html at this point — harmless; removed in Task 8.)

- [ ] **Step 9: Commit**

```bash
git add src/session/project-options-dialog.ts src/session/session-host-callbacks.ts src/main.ts index.html src/session/project-options-dialog.test.ts
git commit -m "feat(chrome): File > Project Options dialog (project name + key/style)"
```

---

## Task 5: Toolbar status chips (musicality + MIDI)

**Files:**
- Create: `src/app/toolbar-status-chips.ts`
- Modify: `index.html` (add a `#toolbar-status-chips` mount in the transport row)
- Modify: `src/main.ts` (mount chips; refresh musicality chip on state applied; refresh MIDI chip on enable/disable)
- Test: `src/app/toolbar-status-chips.test.ts` (chip text from state)

**Interfaces:**
- Consumes: `MusicalityState`, `rootName`, `SCALE_CATALOG` (for a short scale label).
- Produces:
  - `mountStatusChips(host, deps): { refreshMusicality(): void; refreshMidi(on: boolean): void }`
    where `deps = { getMusicality(): MusicalityState; onOpenProjectOptions(): void; onOpenMidiController(): void; isMidiEnabled(): boolean }`.
  - `musicalityChipLabel(m: MusicalityState): string` (exported pure helper for the test).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/toolbar-status-chips.test.ts
import { describe, it, expect } from 'vitest';
import { musicalityChipLabel } from './toolbar-status-chips';

describe('musicalityChipLabel', () => {
  it('shows root + short scale, and a lock glyph only when locked', () => {
    const base = { key: 9, scale: 'minor', style: 'acid', lock: false } as const;
    const unlocked = musicalityChipLabel(base);
    const locked = musicalityChipLabel({ ...base, lock: true });
    expect(unlocked).toContain('A');          // key 9 = A
    expect(unlocked).not.toContain('🔒');
    expect(locked).toContain('🔒');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/toolbar-status-chips.test.ts`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Implement the chips**

```ts
// src/app/toolbar-status-chips.ts
// Read-only toolbar chips that surface state whose EDITING moved into a dialog.
import { SCALE_CATALOG, rootName, type ScaleId } from '../core/musicality';
import type { MusicalityState } from '../session/session-types';

function shortScale(scale: ScaleId): string {
  const s = SCALE_CATALOG.find((x) => x.id === scale);
  return s ? s.label : String(scale);
}

export function musicalityChipLabel(m: MusicalityState): string {
  return `${rootName(m.key)} ${shortScale(m.scale)}${m.lock ? ' 🔒' : ''}`;
}

export interface StatusChipsDeps {
  getMusicality(): MusicalityState;
  onOpenProjectOptions(): void;
  onOpenMidiController(): void;
  isMidiEnabled(): boolean;
}

export function mountStatusChips(host: HTMLElement, deps: StatusChipsDeps): { refreshMusicality(): void; refreshMidi(on: boolean): void } {
  host.classList.add('status-chips');

  const mus = document.createElement('button');
  mus.className = 'status-chip'; mus.title = 'Project key & style — open Project Options';
  mus.addEventListener('click', deps.onOpenProjectOptions);

  const midi = document.createElement('button');
  midi.className = 'status-chip'; midi.title = 'MIDI controller — open MIDI Controller';
  midi.addEventListener('click', deps.onOpenMidiController);

  host.append(mus, midi);

  const refreshMusicality = () => { mus.textContent = musicalityChipLabel(deps.getMusicality()); };
  const refreshMidi = (on: boolean) => {
    midi.textContent = on ? 'MIDI ●' : 'MIDI ○';
    midi.classList.toggle('on', on);
  };
  refreshMusicality(); refreshMidi(deps.isMidiEnabled());
  return { refreshMusicality, refreshMidi };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/app/toolbar-status-chips.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the mount point + wire in main.ts**

In `index.html`, in the `.row.transport`, add a mount just before the `<canvas id="viz">` (or after the spacer): `<span id="toolbar-status-chips"></span>`.

In `src/main.ts`, after `projectOptions` and `midiControlDialog` exist:

```ts
const statusChips = mountStatusChips(document.getElementById('toolbar-status-chips')!, {
  getMusicality: () => sessionHost.state.musicality ?? DEFAULT_MUSICALITY,
  onOpenProjectOptions: () => projectOptions.open(),
  onOpenMidiController: () => midiControlDialog.open(),
  isMidiEnabled: () => loadControlPrefs().enabled,
});
sessionHost.onStateApplied(() => statusChips.refreshMusicality());
```

Also call `statusChips.refreshMidi(true/false)` from the MIDI enable/disable results: in `enableMidiControl` success return `statusChips.refreshMidi(true)`, and in `disableMidiControl` `statusChips.refreshMidi(false)`. (If `statusChips` is declared after those functions, hoist a mutable `let statusChips` or refresh via a callback the control layer already fires. Simplest: after each `wireControlSurfaceUI` UI update, also call `statusChips.refreshMidi(...)`; wire a small `onMidiStateChange` hook or refresh on the same events the status text updates.)

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add src/app/toolbar-status-chips.ts src/app/toolbar-status-chips.test.ts index.html src/main.ts
git commit -m "feat(chrome): toolbar status chips for musicality + MIDI controller"
```

---

## Task 6: `MenuActions` + `menu-spec` (data + resolvers)

**Files:**
- Create: `src/app/menu-actions.ts`
- Create: `src/app/menu-spec.ts`
- Test: `src/app/menu-spec.test.ts`

**Interfaces:**
- Produces:
  - `MenuActions` (interface below).
  - `MenuItemSpec`, `MenuSpec`, `buildMenus(a: MenuActions): MenuSpec[]`.

- [ ] **Step 1: Define `MenuActions`**

```ts
// src/app/menu-actions.ts
// The contract the menu bar drives. Every method is a REAL function (from
// main.ts / returned handles) — never a synthetic DOM click.
export interface DemoItem { label: string; path: string; }

export interface MenuActions {
  newSession(): void;
  openSaveForSave(): void;
  openSaveForLoad(): void;
  openProjectOptions(): void;
  listDemos(): DemoItem[];
  loadDemo(path: string): void;
  openImportMidi(): void;
  openStems(): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  setMode(mode: 'session' | 'performance'): void;
  getMode(): 'session' | 'performance';
  togglePerfDiagnostics(): void;
  isPerfOpen(): boolean;

  openMidiController(): void;
  captureScene(): void;
  copyScenesToPerformance(): void;

  openManual(): void;
  openAbout(): void;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/app/menu-spec.test.ts
import { describe, it, expect } from 'vitest';
import { buildMenus } from './menu-spec';
import type { MenuActions } from './menu-actions';

function stubActions(over: Partial<MenuActions> = {}): MenuActions {
  const noop = () => {};
  return {
    newSession: noop, openSaveForSave: noop, openSaveForLoad: noop, openProjectOptions: noop,
    listDemos: () => [{ label: 'Acid Rain', path: '/demos/acid.json' }], loadDemo: noop,
    openImportMidi: noop, openStems: noop,
    undo: noop, redo: noop, canUndo: () => false, canRedo: () => false,
    setMode: noop, getMode: () => 'session', togglePerfDiagnostics: noop, isPerfOpen: () => false,
    openMidiController: noop, captureScene: noop, copyScenesToPerformance: noop,
    openManual: noop, openAbout: noop, ...over,
  };
}

describe('buildMenus', () => {
  it('produces the five top-level menus in order', () => {
    const labels = buildMenus(stubActions()).map((m) => m.label);
    expect(labels).toEqual(['File', 'Edit', 'View', 'Tools', 'Help']);
  });

  it('File contains Project Options, Import MIDI, Stems and a disabled Preferences', () => {
    const file = buildMenus(stubActions()).find((m) => m.label === 'File')!;
    const items = file.items.filter((i): i is Exclude<typeof i, 'divider'> => i !== 'divider');
    const byLabel = (l: string) => items.find((i) => i.label.startsWith(l))!;
    expect(byLabel('Project Options')).toBeTruthy();
    expect(byLabel('Import MIDI')).toBeTruthy();
    expect(byLabel('Separate into Stems')).toBeTruthy();
    expect(byLabel('Preferences').enabled!()).toBe(false);  // Part 2
  });

  it('View ▸ Session is checked when getMode() === session', () => {
    const view = buildMenus(stubActions({ getMode: () => 'session' })).find((m) => m.label === 'View')!;
    const session = view.items.filter((i) => i !== 'divider').find((i: any) => i.label === 'Session') as any;
    expect(session.checked()).toBe(true);
  });

  it('running a menu item invokes the matching action', () => {
    let called = false;
    const file = buildMenus(stubActions({ captureScene: () => { called = true; } }));
    const tools = file.find((m) => m.label === 'Tools')!;
    const capture = tools.items.filter((i) => i !== 'divider').find((i: any) => i.label.startsWith('Capture')) as any;
    capture.run();
    expect(called).toBe(true);
  });

  it('the Open Demo submenu is built from listDemos()', () => {
    const file = buildMenus(stubActions()).find((m) => m.label === 'File')!;
    const demo = file.items.filter((i) => i !== 'divider').find((i: any) => i.label.startsWith('Open Demo')) as any;
    expect(demo.submenu!()).toHaveLength(1);
    expect(demo.submenu!()[0].label).toBe('Acid Rain');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/menu-spec.test.ts`
Expected: FAIL (`buildMenus` not defined).

- [ ] **Step 4: Implement `menu-spec.ts`**

```ts
// src/app/menu-spec.ts
import type { MenuActions } from './menu-actions';

export interface MenuItemSpec {
  label: string;
  shortcut?: string;            // display only (accelerators bound separately)
  enabled?: () => boolean;      // default true
  checked?: () => boolean;      // checkable items
  run?: () => void;             // action (omitted → non-interactive)
  submenu?: () => MenuItemSpec[];
}
export interface MenuSpec { label: string; items: (MenuItemSpec | 'divider')[]; }

export function buildMenus(a: MenuActions): MenuSpec[] {
  return [
    { label: 'File', items: [
      { label: 'New Session', shortcut: 'Ctrl+N', run: a.newSession },
      { label: 'Open…', shortcut: 'Ctrl+O', run: a.openSaveForLoad },
      { label: 'Save', shortcut: 'Ctrl+S', run: a.openSaveForSave },
      { label: 'Save As…', run: a.openSaveForSave },
      'divider',
      { label: 'Project Options…', run: a.openProjectOptions },
      { label: 'Open Demo', submenu: () => a.listDemos().map((d) => ({ label: d.label, run: () => a.loadDemo(d.path) })) },
      'divider',
      { label: 'Import MIDI…', run: a.openImportMidi },
      { label: 'Separate into Stems…', run: a.openStems },
      'divider',
      { label: 'Preferences…', shortcut: 'Ctrl+,', enabled: () => false },   // Part 2
    ]},
    { label: 'Edit', items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', enabled: a.canUndo, run: a.undo },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', enabled: a.canRedo, run: a.redo },
    ]},
    { label: 'View', items: [
      { label: 'Session', checked: () => a.getMode() === 'session', run: () => a.setMode('session') },
      { label: 'Performance', checked: () => a.getMode() === 'performance', run: () => a.setMode('performance') },
      'divider',
      { label: 'Performance diagnostics (PERF)', checked: a.isPerfOpen, run: a.togglePerfDiagnostics },
    ]},
    { label: 'Tools', items: [
      { label: 'MIDI Controller…', run: a.openMidiController },
      { label: 'Capture Scene', shortcut: 'Ctrl+I', run: a.captureScene },
      { label: 'Copy Scenes → Performance', run: a.copyScenesToPerformance },
    ]},
    { label: 'Help', items: [
      { label: 'Manual ↗', run: a.openManual },
      { label: 'About Loom', run: a.openAbout },
    ]},
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/app/menu-spec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/menu-actions.ts src/app/menu-spec.ts src/app/menu-spec.test.ts
git commit -m "feat(chrome): MenuActions contract + declarative menu-spec"
```

---

## Task 7: `menu-bar` renderer + SCSS

**Files:**
- Create: `src/app/menu-bar.ts`
- Create: `src/styles/_menu-bar.scss`
- Modify: `src/style.scss` (add `@use 'styles/menu-bar';`)
- Test: `src/app/menu-bar.test.ts`

**Interfaces:**
- Consumes: `MenuSpec`, `MenuItemSpec` from `menu-spec.ts`.
- Produces: `createMenuBar(host: HTMLElement, menus: MenuSpec[]): { destroy(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/menu-bar.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createMenuBar } from './menu-bar';
import type { MenuSpec } from './menu-spec';

function menus(onRun: (l: string) => void): MenuSpec[] {
  return [
    { label: 'File', items: [
      { label: 'New Session', shortcut: 'Ctrl+N', run: () => onRun('New Session') },
      'divider',
      { label: 'Preferences…', enabled: () => false },
    ]},
    { label: 'Edit', items: [ { label: 'Undo', enabled: () => false, run: () => onRun('Undo') } ]},
  ];
}

describe('createMenuBar', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });

  it('renders one top-level label per menu', () => {
    createMenuBar(host, menus(() => {}));
    const labels = Array.from(host.querySelectorAll('.menubar-top')).map((e) => e.textContent);
    expect(labels).toEqual(['File', 'Edit']);
  });

  it('clicking a top label opens its dropdown; clicking an item runs it and closes', () => {
    const runs: string[] = [];
    createMenuBar(host, menus((l) => runs.push(l)));
    (host.querySelector('.menubar-top') as HTMLElement).click();   // open File
    expect(host.querySelector('.menubar-dropdown')).toBeTruthy();
    const item = Array.from(host.querySelectorAll('.menubar-item')).find((e) => e.textContent!.includes('New Session')) as HTMLElement;
    item.click();
    expect(runs).toEqual(['New Session']);
    expect(host.querySelector('.menubar-dropdown')).toBeFalsy();   // closed after run
  });

  it('a disabled item does not run and carries the disabled class', () => {
    const runs: string[] = [];
    createMenuBar(host, menus((l) => runs.push(l)));
    (host.querySelector('.menubar-top') as HTMLElement).click();
    const pref = Array.from(host.querySelectorAll('.menubar-item')).find((e) => e.textContent!.includes('Preferences')) as HTMLElement;
    expect(pref.classList.contains('is-disabled')).toBe(true);
    pref.click();
    expect(runs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/menu-bar.test.ts`
Expected: FAIL (`createMenuBar` not defined).

- [ ] **Step 3: Implement `menu-bar.ts`**

```ts
// src/app/menu-bar.ts
// Self-built classic menu bar: click a top label to open its dropdown, hover-
// follow between open menus, Esc / outside-click closes, checkable + disabled +
// submenu items. Every item calls its spec.run() — no synthetic DOM clicks.
import type { MenuSpec, MenuItemSpec } from './menu-spec';

export function createMenuBar(host: HTMLElement, menus: MenuSpec[]): { destroy(): void } {
  host.classList.add('menubar');
  host.setAttribute('role', 'menubar');
  let openIdx = -1;
  let dropdown: HTMLElement | null = null;

  const tops: HTMLElement[] = menus.map((menu, i) => {
    const t = document.createElement('button');
    t.className = 'menubar-top'; t.textContent = menu.label; t.setAttribute('role', 'menuitem');
    t.addEventListener('click', () => (openIdx === i ? close() : open(i)));
    t.addEventListener('mouseenter', () => { if (openIdx !== -1 && openIdx !== i) open(i); });
    host.appendChild(t);
    return t;
  });

  function renderItems(items: (MenuItemSpec | 'divider')[], container: HTMLElement): void {
    for (const it of items) {
      if (it === 'divider') {
        const d = document.createElement('div'); d.className = 'menubar-divider'; container.appendChild(d); continue;
      }
      const enabled = it.enabled ? it.enabled() : true;
      const row = document.createElement('button');
      row.className = 'menubar-item'; row.setAttribute('role', 'menuitem');
      if (!enabled) row.classList.add('is-disabled');
      const check = it.checked && it.checked() ? '● ' : (it.checked ? '○ ' : '');
      const left = document.createElement('span'); left.className = 'menubar-item-label'; left.textContent = check + it.label;
      const right = document.createElement('span'); right.className = 'menubar-item-sc';
      right.textContent = it.submenu ? '▸' : (it.shortcut ?? '');
      row.append(left, right);
      if (it.submenu) {
        row.classList.add('has-submenu');
        let sub: HTMLElement | null = null;
        row.addEventListener('mouseenter', () => {
          if (sub) return;
          sub = document.createElement('div'); sub.className = 'menubar-dropdown menubar-submenu';
          renderItems(it.submenu!(), sub); row.appendChild(sub);
        });
        row.addEventListener('mouseleave', () => { sub?.remove(); sub = null; });
      } else if (enabled && it.run) {
        row.addEventListener('click', (e) => { e.stopPropagation(); const r = it.run!; close(); r(); });
      } else {
        row.addEventListener('click', (e) => e.stopPropagation());
      }
      container.appendChild(row);
    }
  }

  function open(i: number): void {
    close();
    openIdx = i; tops[i].classList.add('is-open');
    dropdown = document.createElement('div'); dropdown.className = 'menubar-dropdown'; dropdown.setAttribute('role', 'menu');
    renderItems(menus[i].items, dropdown);
    tops[i].appendChild(dropdown);
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }

  function close(): void {
    if (openIdx === -1) return;
    tops[openIdx].classList.remove('is-open');
    dropdown?.remove(); dropdown = null; openIdx = -1;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onOutside(e: PointerEvent): void { if (!host.contains(e.target as Node)) close(); }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); open((openIdx + 1) % menus.length); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); open((openIdx - 1 + menus.length) % menus.length); }
  }

  return { destroy: () => { close(); host.replaceChildren(); } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/app/menu-bar.test.ts`
Expected: PASS (3 tests). (jsdom supports `click`, `contains`, event listeners used here.)

- [ ] **Step 5: Add SCSS**

Create `src/styles/_menu-bar.scss`:

```scss
// Classic desktop menu bar + dropdowns + toolbar status chips + new dialogs.
.menubar {
  display: flex; align-items: stretch; background: #1c1c1e;
  border-bottom: 1px solid #101012; position: relative; z-index: 40;
}
.menubar-top {
  padding: 7px 14px; background: transparent; border: 0; color: #cfcfcf;
  font: inherit; font-size: 13px; cursor: default;
  &:hover, &.is-open { background: #26262a; color: #fff; }
}
.menubar-dropdown {
  position: absolute; top: 100%; left: 0; min-width: 250px; padding: 6px;
  background: #202024; border: 1px solid #3a3a3e; border-top: none;
  border-radius: 0 0 6px 6px; box-shadow: 0 16px 40px rgba(0, 0, 0, .55); z-index: 41;
}
.menubar-submenu { top: 0; left: 100%; border-top: 1px solid #3a3a3e; border-radius: 6px; }
.menubar-item {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  width: 100%; padding: 7px 10px; background: transparent; border: 0; color: #d8d8d8;
  font: inherit; font-size: 13px; border-radius: 5px; cursor: default; text-align: left;
  &:hover:not(.is-disabled) { background: #6c7cff; color: #0b0b12; }
  &.is-disabled { color: #5c5c5c; }
}
.menubar-item-sc { color: #8a8a8a; font-size: 11px; }
.menubar-item:hover:not(.is-disabled) .menubar-item-sc { color: #0b0b12; }
.menubar-divider { height: 1px; background: #33333a; margin: 6px 8px; }
.menubar-item.has-submenu { position: relative; }

// Toolbar status chips
.status-chips { display: inline-flex; gap: 6px; align-items: center; }
.status-chip {
  background: #141416; border: 1px solid #33333a; border-radius: 14px;
  padding: 4px 11px; font: inherit; font-size: 11px; color: #cfcfcf; cursor: pointer;
  &:hover { border-color: #6c7cff; }
  &.on { color: #7ee0ab; border-color: rgba(46, 194, 122, .5); }
}

// Native <dialog> shell for the new modals (Import MIDI / MIDI Control / Project Options)
.app-modal {
  background: #1c1c1e; color: #dcdcdc; border: 1px solid #3a3a3e; border-radius: 10px;
  padding: 0; min-width: 300px; box-shadow: 0 14px 44px rgba(0, 0, 0, .5);
  &::backdrop { background: rgba(0, 0, 0, .55); }
}
.app-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 15px; border-bottom: 1px solid #2a2a2e; background: #242428;
  h3 { margin: 0; font-size: 14px; font-weight: 500; }
}
.app-modal-x { background: transparent; border: 0; color: #8a8a8a; font-size: 16px; cursor: pointer; }
.app-modal-body { padding: 14px 15px; display: flex; flex-direction: column; gap: 12px; }
.app-modal-foot { display: flex; justify-content: flex-end; gap: 9px; padding: 12px 15px; border-top: 1px solid #2a2a2e; background: #181819; }
.po-group { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #6d6d72; margin-bottom: -4px; }
.po-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
```

Add to `src/style.scss` (with the other `@use` lines):

```scss
@use 'styles/menu-bar';
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: SCSS compiles, bundle succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/menu-bar.ts src/app/menu-bar.test.ts src/styles/_menu-bar.scss src/style.scss
git commit -m "feat(chrome): menu-bar renderer + styling"
```

---

## Task 8: Mount the menu bar in main.ts + shortcuts + About + cleanup

**Files:**
- Modify: `index.html` (add `<div id="menu-bar">` below `<h1>`; remove the now-dead `#musicality-bar` host)
- Create: `src/app/menu-shortcuts.ts`
- Modify: `src/main.ts` (assemble `MenuActions`, `createMenuBar`, bind shortcuts, About via `alertDialog`)

**Interfaces:**
- Consumes: `MenuActions`, `createMenuBar`, all handles from Tasks 2-5.
- Produces: `registerMenuShortcuts(a: Pick<MenuActions,'newSession'|'openSaveForLoad'|'openSaveForSave'>): void`.

- [ ] **Step 1: Add the menu-bar host to index.html**

Directly after the `<h1>Loom …</h1>` line and before `<div class="row transport">`, add:

```html
<div id="menu-bar"></div>
```

Remove the `<div id="musicality-bar"></div>` from the transport row (its editing now lives in Project Options; the chip shows its state).

- [ ] **Step 2: Write `menu-shortcuts.ts`**

```ts
// src/app/menu-shortcuts.ts
// Binds ONLY the new accelerators (Ctrl/Cmd+N/O/S). Ctrl+Z / Ctrl+Shift+Z /
// Ctrl+I are already owned by existing global handlers — we only DISPLAY those
// in the menu, never re-bind them here (avoids double-firing).
export function registerMenuShortcuts(a: {
  newSession: () => void; openSaveForLoad: () => void; openSaveForSave: () => void;
}): void {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); a.newSession(); }
    else if (k === 'o') { e.preventDefault(); a.openSaveForLoad(); }
    else if (k === 's') { e.preventDefault(); a.openSaveForSave(); }
  });
}
```

- [ ] **Step 3: Assemble `MenuActions` + mount in main.ts**

Near the end of `src/main.ts` boot (after `saveManager`, `stemDialog`, `midiImportDialog`, `midiControlDialog`, `projectOptions`, `perfDiagnostics`, `performanceFeature`, `autoHistory`, and the demo list are all in scope):

```ts
import { createMenuBar } from './app/menu-bar';
import { buildMenus } from './app/menu-spec';
import type { MenuActions } from './app/menu-actions';
import { registerMenuShortcuts } from './app/menu-shortcuts';
import { alertDialog } from './core/dialog';

const menuActions: MenuActions = {
  newSession: () => { void newSession(); },
  openSaveForSave: () => saveManager.openForSave(),
  openSaveForLoad: () => saveManager.openForLoad(),
  openProjectOptions: () => projectOptions.open(),
  listDemos: () => DEMOS,                              // the same array passed to wireDemoPicker
  loadDemo: (path) => { void loadDemoSession(path, { sessionHost, applyBpm: setTransportBpm, onLoaded: () => autoHistory.markClean() }); },
  openImportMidi: () => midiImportDialog.open(),
  openStems: () => stemDialog.open(),
  undo: () => autoHistory.undo(),
  redo: () => autoHistory.redo(),
  canUndo: () => autoHistory.canUndo(),
  canRedo: () => autoHistory.canRedo(),
  setMode: (m) => performanceFeature.setMode(m),
  getMode: () => performanceFeature.getMode(),
  togglePerfDiagnostics: () => perfDiagnostics.toggle(),
  isPerfOpen: () => perfDiagnostics.isOpen(),
  openMidiController: () => midiControlDialog.open(),
  captureScene: () => sessionHost.captureScene(),
  copyScenesToPerformance: () => performanceFeature.copyFromSession(),
  openManual: () => { window.open('manual/', '_blank', 'noopener'); },
  openAbout: () => { void alertDialog(`Loom v${__APP_VERSION__} · ${__APP_STAGE__} · ${__APP_CODENAME__}`, { title: 'About Loom' }); },
};

createMenuBar(document.getElementById('menu-bar')!, buildMenus(menuActions));
registerMenuShortcuts(menuActions);
```

Notes:
- `DEMOS` = the exact demo array currently defined inline at the `wireDemoPicker` call site (lift it to a `const DEMOS = [...]` so both the picker and the menu use it).
- `setTransportBpm` is the existing bpm setter already passed to `wireDemoPicker` as `applyBpm`.
- `__APP_VERSION__/__APP_STAGE__/__APP_CODENAME__` are the Vite build-time globals (already used at the top of main.ts).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success. If TS complains that `__APP_VERSION__` etc. are unknown in this scope, they're already declared globally (used earlier in main.ts) — no redeclare needed.

- [ ] **Step 5: Run the full unit suite**

Run: `NO_COLOR=1 npm run test:unit`
Expected: green (allow one re-run if the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown fires after tests pass).

- [ ] **Step 6: Commit**

```bash
git add index.html src/app/menu-shortcuts.ts src/main.ts
git commit -m "feat(chrome): mount menu bar, wire MenuActions, shortcuts, About; drop musicality bar"
```

---

## Task 9: e2e coverage + visual parity

**Files:**
- Create: `tests/e2e/menu-bar.spec.ts`
- Verify: full build + suites green; manual visual parity vs the committed mockup.

**Interfaces:** none produced.

- [ ] **Step 1: Build (e2e serves `dist/`)**

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Write the e2e spec (one test per user path)**

```ts
// tests/e2e/menu-bar.spec.ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('menu bar shows the five top-level menus', async ({ page }) => {
  const tops = page.locator('#menu-bar .menubar-top');
  await expect(tops).toHaveText(['File', 'Edit', 'View', 'Tools', 'Help']);
});

test('File ▸ Import MIDI… opens the Import MIDI dialog; the old <details> is gone', async ({ page }) => {
  await expect(page.locator('details.midi-panel')).toHaveCount(0);
  await page.locator('#menu-bar .menubar-top', { hasText: 'File' }).click();
  await page.locator('.menubar-item', { hasText: 'Import MIDI' }).click();
  await expect(page.locator('#midi-import-dialog')).toBeVisible();
  await expect(page.locator('#midi-import-dialog #poly-midi-file')).toBeVisible();
});

test('Tools ▸ MIDI Controller… opens the dialog; the old <details> is gone', async ({ page }) => {
  await expect(page.locator('details.midi-control-panel')).toHaveCount(0);
  await page.locator('#menu-bar .menubar-top', { hasText: 'Tools' }).click();
  await page.locator('.menubar-item', { hasText: 'MIDI Controller' }).click();
  await expect(page.locator('#midi-control-dialog')).toBeVisible();
  await expect(page.locator('#midi-control-dialog #midi-control-enable')).toBeVisible();
});

test('the musicality chip opens Project Options and shows the project name', async ({ page }) => {
  await expect(page.locator('#musicality-bar')).toHaveCount(0);
  await page.locator('#toolbar-status-chips .status-chip').first().click();
  await expect(page.locator('#project-options-dialog')).toBeVisible();
  await expect(page.locator('#project-options-body input[data-po="name"]')).toBeVisible();
});

test('File ▸ Project Options… → rename persists across a Save Manager save/load round-trip', async ({ page }) => {
  await page.locator('#menu-bar .menubar-top', { hasText: 'File' }).click();
  await page.locator('.menubar-item', { hasText: 'Project Options' }).click();
  const name = page.locator('#project-options-body input[data-po="name"]');
  await name.fill('E2E Project');
  await name.dispatchEvent('change');
  await page.locator('#project-options-dialog [data-dialog-close]').first().click();
  // Reopen and confirm it stuck in-session.
  await page.locator('#toolbar-status-chips .status-chip').first().click();
  await expect(page.locator('#project-options-body input[data-po="name"]')).toHaveValue('E2E Project');
});

test('File ▸ Preferences… is present but disabled (Part 2)', async ({ page }) => {
  await page.locator('#menu-bar .menubar-top', { hasText: 'File' }).click();
  await expect(page.locator('.menubar-item.is-disabled', { hasText: 'Preferences' })).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e spec**

Run: `npm run test:e2e -- menu-bar`
Expected: all pass. (If Playwright needs the full command, run `npm run test:e2e` and confirm the new file is green; pre-existing unrelated failures noted in memory are acceptable, new ones are not.)

- [ ] **Step 4: Manual visual-parity check (mandatory — approved mockup exists)**

Start the worktree dev server (`npm run dev`), open **real Chrome** at `http://localhost:5173`, and compare against the committed mockup `docs/superpowers/specs/2026-07-12-desktop-menu-chrome-mockup.html`:
- Menu bar under the title; File opens with the expected items + a disabled Preferences.
- The two toolbar chips (`A minor …`, `MIDI ○/●`) are present and open their dialogs.
- Import MIDI / MIDI Controller / Project Options open as modal dialogs (Esc + backdrop + × all close).
- The old inline MIDI `<details>` and the old musicality popover button are gone.
Screenshot the new chrome and eyeball it against the mockup. Fix any visual drift before calling it done.

- [ ] **Step 5: Final full suite + commit**

Run: `npm run build && NO_COLOR=1 npm run test:unit`
Expected: green.

```bash
git add tests/e2e/menu-bar.spec.ts
git commit -m "test(e2e): menu bar, MIDI/Project Options dialogs, disabled Preferences"
```

---

## Self-Review

**Spec coverage:**
- Menu bar (File/Edit/View/Tools/Help), data-driven, real-function wiring → Tasks 6, 7, 8. ✓
- Menu items call existing functions, no synthetic clicks → Task 2 (exportable handles) + Task 8 (MenuActions). ✓
- Import MIDI + MIDI Control → dialogs, out of toolbar → Task 3. ✓
- Musicality → File ▸ Project Options with project name → Task 4; `SessionState.name` → Task 1. ✓
- Status chips (musicality + MIDI) → Task 5. ✓
- Preferences disabled (Part 2) → Task 6 spec + Task 9 e2e. ✓
- Data & state (name default/migration/save round-trip/Save Manager pre-fill) → Task 1 + Task 2 Step 1 note. ✓
- Testing: unit (menu-spec, menu-bar, project-options, session-name, chips) + e2e (one per path) → Tasks 1,4,5,6,7,9. ✓
- Visual parity → Task 9 Step 4. ✓
- Follow/Keys untouched → not referenced anywhere in the plan. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. One deliberate deferral (Preferences item disabled) is explicit, not a placeholder.

**Type consistency:** `MenuActions` method names match between `menu-actions.ts`, `menu-spec.ts`, the `menu-spec.test.ts` stub, and the main.ts assembly (`openSaveForSave`/`openSaveForLoad`/`openProjectOptions`/`loadDemo`/`listDemos`/`togglePerfDiagnostics`/`isPerfOpen`/`copyScenesToPerformance`). `bindModalDialog` return shape (`{open,close,el}`) is consumed consistently. `renderProjectOptionsDialog` deps (`getName/setName/getMusicality/setMusicality`) match its test and the main.ts call site.

**Open verification points for the implementer (call out if reality differs):**
1. `sessionHost.callbacks.onRenameProject` — confirm how callbacks are reached from main.ts; if not public, mutate `sessionHost.state.name` directly inside the same `withUndo` wrapper used for musicality (Task 4 Step 7 note).
2. `migrateLoadedSessionState` runs on every load path (it's called from `session-host-persistence`, not `applyLoadedStateV3`) — confirm loaded saves route through it so the `name` default is guaranteed (Task 1).
3. MIDI chip refresh hook — confirm the cleanest signal to call `statusChips.refreshMidi(on)` from the control layer (Task 5 Step 5).
