# Desktop-style menu bar & chrome — Part 1 (menu + MIDI dialogs + Project Options)

- **Date:** 2026-07-12
- **Status:** design approved, ready for plan
- **Mockup:** [2026-07-12-desktop-menu-chrome-mockup.html](./2026-07-12-desktop-menu-chrome-mockup.html) (target look for **both** phases; P2 elements are tagged in the mockup)

## Problem

Loom's top chrome is two crowded rows of loose buttons plus a few inline
`<details>` panels (Import MIDI, MIDI Control) and a musicality popover. New
users can't find features; the layout reads as a pile of controls, not an
application. We want the coherence of a classic desktop app: a **menu bar** that
holds every general action, and proper **modal dialogs** instead of inline
dropdowns.

## Scope — this is Part 1 of 2

The work is split so we regularise the menu first and only touch the toolbar
minimally, then reshape the rest of the toolbar later.

**Part 1 (this spec) delivers:**

1. A **menu bar** (`File · Edit · View · Tools · Help`) that lists every general
   action. Listing an action in a menu does **not** remove its toolbar button —
   the menu duplicates existing controls. The menu wires to the **existing**
   action handlers; it does not fork logic.
2. **Import MIDI** and **MIDI Control** move out of the toolbar, from inline
   `<details>` panels into **modal dialogs** launched from the menu.
3. **Musicality** (key / scale / style / lock) moves out of the toolbar into a
   **Project Options dialog** in the **File** menu, which also holds the
   **project name**. Both are per-project state saved with the session — not
   global preferences. This requires a small model addition: a new
   `SessionState.name` field (see *Data & state* below).
4. **Status-chip principle:** anything whose *editing* moved into a dialog still
   shows its *state* on the toolbar as a compact, clickable chip that opens the
   dialog. Part 1 adds two chips: a **musicality chip** (`C min · Techno · 🔒`,
   opens Project Options) and a **MIDI controller chip** (`MIDI ●` / `MIDI ○`).

**Explicitly deferred to Part 2 (not built here):**

- The **Preferences** dialog (global defaults: new-session BPM/Meter, **max
  recording size**). In Part 1 the `File ▸ Preferences…` item exists but is
  **disabled** with a "Part 2" tooltip.
- The **live-record size meter + max-size auto-stop** next to REC.
- Any **toolbar trimming / reflow** of the non-MIDI, non-musicality controls
  (REC group, Capture, PERF, Save/Load, demos, transport). These stay exactly
  where they are today.

**Never touched (neither phase):** **Follow** and **⌨ Keys** stay exactly where
they are today (the clip-editor toolbar). They are not surfaced in the menu, not
moved, and not added to Preferences — in Part 1 or Part 2.

Part 1 is a chrome/wiring change plus **one** small model addition: the
`SessionState.name` field that backs the Project Options dialog. It does not
change audio, scheduling, DSP, or any existing session data.

## Design

### 1. Menu bar

A new, lightweight, self-built menu bar (not an OS-native menu). It renders as a
strip **directly below the existing `<h1>` Loom title row and above the
transport row**. The title row and both existing toolbar rows stay.

**Mechanics (classic desktop feel):**

- Click a top-level label to open its dropdown; while any menu is open, moving
  the pointer over a sibling label switches to that menu (hover-follow).
- `Esc`, click-outside, or activating an item closes the menu.
- Items show their keyboard accelerator right-aligned (`Ctrl+S`).
- Checkable items (View ▸ Session/Performance, PERF) show a check/● that
  reflects live state each time the menu opens.
- A submenu (`Open Demo ▸`) opens to the side on hover.
- Disabled items (Preferences… in Part 1) are dimmed and non-interactive with a
  tooltip explaining they arrive in Part 2.

**Accessibility (baseline, not exhaustive):** `role="menubar"/"menu"/"menuitem"`,
`aria-haspopup`, focusable labels, `ArrowLeft/Right` between menus and
`ArrowUp/Down` within a menu. Full roving-tabindex polish is a nice-to-have, not
a blocker.

**Wiring principle:** the menu is defined as **data** — a declarative spec of
`{ label, shortcut?, enabled?, checked?, run() }` grouped into menus — and the
`run()` callbacks call the **same functions the existing buttons already call**
(e.g. `sessionHost.captureScene()`, the existing `#save`/`#new-session`
handlers, `perfDiagnostics.toggle()`). No behaviour is reimplemented. Keyboard
accelerators are registered from the same spec so a shortcut and its menu item
can never drift.

### 2. Menu contents (Part 1)

```text
File                                   Edit                    View
  New Session            Ctrl+N          Undo         Ctrl+Z     ● Session
  Open…  (Save Manager)  Ctrl+O          Redo   Ctrl+Shift+Z     ○ Performance
  Save                   Ctrl+S                                  ──
  Save As…                                                       Performance diagnostics (PERF)  ☐
  ──
  Project Options…                     Tools                   Help
  Open Demo ▸ (submenu)                  MIDI Controller…        Manual ↗
  ──                                     Capture Scene  Ctrl+I    About Loom
  Import MIDI…                           Copy Scenes → Performance
  Separate into Stems…
  ──
  Preferences…   Ctrl+,  (disabled, Part 2)
```

Handler mapping (all pre-existing except the three new dialogs):

| Item | Wires to |
| --- | --- |
| New Session | existing `#new-session` handler |
| Open… / Save As… | opens the Save Manager modal (existing `#load` / `#save` flow) |
| Save | existing `#save` handler |
| Project Options… | **new** Project Options dialog (project name + musicality) |
| Open Demo ▸ | items built from the existing `#demo-picker` options; selecting one loads that demo |
| Import MIDI… | **new** Import MIDI dialog |
| Separate into Stems… | existing `#stems-open` → `#stems-modal` |
| Undo / Redo | existing history controller |
| Session / Performance | existing `#mode-toggle` mode switch |
| Performance diagnostics | existing `perfDiagnostics.toggle()` (`#perf-toggle`) |
| MIDI Controller… | **new** MIDI Control dialog |
| Capture Scene | `sessionHost.captureScene()` (`#capture-scene`) |
| Copy Scenes → Performance | existing `#copy-to-performance` handler |
| Manual ↗ | opens `manual/` in a new tab (existing link target) |
| About Loom | tiny about dialog showing the app version |

### 3. Dialogs

All three reuse the **existing DOM and logic**; only the wrapper changes from an
inline `<details>` / popover to a modal `<dialog>`. They follow the existing
modal pattern already used by the Save Manager and Stems modals (backdrop,
header with title + `×`, `Esc`/backdrop-click closes).

- **Import MIDI dialog** — the file input, per-track preview list, and Import
  button move inside a modal. The existing two-step commit flow (choose file →
  preview → the `app-dialog` Cancel / Sustituir / Añadir confirm) is preserved
  exactly; we only relocate the first panel into the dialog.
- **MIDI Controller dialog** — Enable button, status text, device-override
  select, and `● Rec` mapping button move inside a modal. Same handlers.
- **Project Options dialog** (File ▸ Project Options…) — holds the **project
  name** plus the current musicality controls (root, scale, style, lock). The
  musicality controls reuse the existing `renderMusicalityBar` deps
  (`get`/`onChange`) so they read and write the same `MusicalityState`, and the
  piano-roll's own 🔒 stays in sync as today. The name field reads/writes the new
  `SessionState.name` (see *Data & state*). Edits route through the existing undo
  system like any other session mutation.

### 4. Toolbar changes (Part 1, minimal)

- **Remove** the Import MIDI `<details>` and MIDI Control `<details>` from the
  session bar.
- **Replace** the musicality popover button (`#musicality-bar`) in the transport
  row with a compact, read-only **musicality status chip** that opens the
  Project Options dialog on click.
- **Add** a small **MIDI controller status chip** (`MIDI ●` when enabled,
  `MIDI ○` when off) that opens the MIDI Controller dialog. It reflects the
  controller's live state (the state the old panel showed inline).
- Everything else on both toolbar rows is untouched.

## Architecture & file boundaries

New modules (each focused, well under the 300-line target):

- `src/app/menu-bar.ts` — builds the menu bar from the declarative spec, owns the
  open/close/hover-follow controller and keyboard-accelerator registration.
  Receives an `actions` object from `main.ts`; holds **no** business logic.
- `src/app/menu-spec.ts` — the data: the menu tree (`File/Edit/View/Tools/Help`),
  labels, shortcuts, `enabled/checked` resolvers. Pure, unit-testable.
- `src/midi/midi-import-dialog.ts` — wraps the existing import UI in a modal.
- `src/control/midi-control-dialog.ts` — wraps the existing MIDI-control UI in a
  modal.
- `src/session/project-options-dialog.ts` — renders the project name + musicality
  controls in a modal (reuses the musicality-bar renderer/deps).
- `src/app/toolbar-status-chips.ts` — the musicality + MIDI status chips.
- `src/styles/_menu-bar.scss` — menu bar + dropdown styling (matches the dark
  theme in the mockup).

`main.ts` gains only: build the `actions` object from handlers it already wires,
construct the menu bar, mount the three dialogs and the status chips, and remove
the two `<details>` panels + old musicality button from `index.html`. Existing
handlers keep their identity so the menu, the (still-present) buttons, and the
keyboard shortcuts all funnel through one implementation.

## Data & state — the new `SessionState.name`

The only data-model change: an additive `name: string` on `SessionState`.

- **Default:** `emptySessionState()` and demo loads seed `name: "Untitled"`.
- **Migration:** `session-migration.ts` fills `name` for any loaded session that
  lacks it (older saves) — defaulting to `"Untitled"`, or to the Save Manager
  entry's name when available. No `schemaVersion` bump: the field is optional on
  the wire and defaulted on load, so old and new saves interoperate.
- **Persistence:** `buildSavedStateV3`/`applyLoadedStateV3` round-trip `name`
  with the rest of the session.
- **Save Manager coupling:** when the user opens Save / Save As…, the project
  name pre-fills the save-name input (they can still override it). This is a
  convenience, not a hard link — the two names may diverge.

No other session data, `SaveManager` behaviour, scheduling, or DSP changes.
Musicality already persisted; only its UI location moves.

## Testing (one test per user path — no `(or …)` alternatives)

**Unit (Vitest):**

- `menu-spec` builds the expected menu tree with the expected shortcuts, and the
  `enabled/checked` resolvers return correct values for given state (e.g.
  Preferences disabled; Session checked in session mode).
- Keyboard-accelerator registration maps each shortcut to its item's `run()`.
- The Project Options dialog round-trips `MusicalityState` through
  `get`/`onChange`, and edits the project name.
- `SessionState.name` round-trips through save → load; `session-migration`
  defaults a missing `name` to `"Untitled"`.

**e2e (Playwright, against a fresh `npm run build`):**

- Open the **File** menu → **New Session** runs (session resets).
- Open the **File** menu → **Save** opens the Save Manager modal.
- **Tools ▸ MIDI Controller…** opens the MIDI Controller **dialog**; the old
  inline MIDI Control `<details>` is **gone** from the DOM.
- **File ▸ Import MIDI…** opens the Import MIDI **dialog**; the old inline
  Import MIDI `<details>` is **gone**.
- The **musicality chip** is present in the toolbar and clicking it opens the
  **Project Options** dialog; the old musicality popover button is gone.
- **File ▸ Project Options…** shows the project name; editing it and saving,
  then reloading, preserves the new name.
- **File ▸ Preferences…** is present but **disabled**.

## Visual-parity acceptance (mandatory human look)

Because this has an approved mockup, "done" requires loading the real screen in
**real Chrome**, screenshotting the new chrome, and comparing side-by-side with
the committed mockup (menu bar + open menu + the three dialogs + the two status
chips). Automated tests do not verify the approved look.

## Non-goals / risks

- **Non-goal:** any Part 2 item (Preferences, record meter/cap, toolbar reflow,
  Follow/Keys surfacing).
- **Risk — Import MIDI two-step flow:** the import commit already opens a modal
  `app-dialog`; nesting the first panel in its own dialog must not break the
  file-chooser → preview → confirm sequence. Mitigated by relocating the panel
  only, keeping the commit flow byte-for-byte.
- **Risk — keyboard-shortcut collisions:** `Ctrl+Z/S/N/O/I` and `Ctrl+,` must not
  fight existing global handlers; the accelerator registry is the single owner
  and reuses the existing undo/capture bindings rather than adding duplicates.

## Part 2 backlog (for later, not now)

Preferences dialog (new-session BPM/Meter defaults + max-recording setting) ·
live-record size meter + auto-stop at the cap · toolbar trimming & reflow ·
possibly a Transport menu · optionally show the project name in the title/window
chrome. (Follow and ⌨ Keys are out of scope in every phase.)
