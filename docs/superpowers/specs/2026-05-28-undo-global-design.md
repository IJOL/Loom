# Undo global

Status: design approved · 2026-05-28
Depends on: nothing
Blocks: `2026-05-28-clip-ops-design.md` (clip move/copy/colors)

## Goal

Single global undo/redo for every change that survives a page refresh: pattern edits, knobs, presets, BPM, swing, master volume, kit, wave, lane/scene/clip mutations. One stack, one keyboard shortcut, no per-feature history.

## Non-goals

- Undo of transport state (play/pause/seek).
- Undo of ephemeral UI state (active tab, lane focus, inspector selection).
- Persistence of history across page reloads. History is memory-only.
- Per-action labels in UI, branching history, multi-branch redo.
- Coverage of FX bus and `filterChain` state — they are not in `buildSavedStateV3` today; expanding undo to cover them happens when the save format expands. Out of scope here.

## Strategy

**Snapshot stack of the persisted-state shape.** Each undoable action clones the persisted shape (the V3 save object) into a past stack; `Ctrl+Z` pops it back. Chosen over command pattern and immer-style patches because:

- `cloneSessionState` (`JSON.parse(JSON.stringify(...))`) and `buildSavedStateV3` already exist; the snapshot is `buildSavedStateV3(deps)` verbatim.
- No refactor of mutation sites into command objects; the only thing each mutation site needs is to call `commit()` before mutating.
- Memory cost is bounded: a snapshot is plain JSON, on the order of 10–50 KB; a 100-entry stack is ~5 MB worst case, sitting in browser memory of a music app — acceptable.

## Granularity

One snapshot per **user gesture**:

- **Discrete actions** (single click/keypress that mutates state) snapshot eagerly: `commit(snapshot())` before the mutation.
- **Continuous gestures** (knob drag, slider drag, drag-to-edit) snapshot once at gesture start (`beginGesture(snapshot())` on `pointerdown`) and finalise at gesture end (`commitGesture()` on `pointerup` / `blur` / `Escape`). Intermediate `input` events during the drag do not snapshot.

A drag of a knob from 0.2 to 0.8 produces exactly one undo entry that restores 0.2.

## Components

### 1. `src/core/history.ts` — pure controller

```ts
export interface HistoryController<T> {
  commit(prev: T): void;
  beginGesture(prev: T): void;
  commitGesture(): void;
  cancelGesture(): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createHistory<T>(opts?: { maxSize?: number }): HistoryController<T>;
```

Semantics:

- `commit(prev)` pushes `prev` to past; **clears the future stack**.
- `beginGesture(prev)` records `prev` as a pending gesture snapshot. Repeated calls during an active gesture are no-ops (only the first state of the gesture matters). It does **not** push to past.
- `commitGesture()` pushes the pending snapshot to past and clears future. No-op if no gesture is active.
- `cancelGesture()` discards the pending snapshot without pushing.
- `undo(current)` pops past, pushes `current` to future, returns the restored state. Returns `null` if past is empty. **Cancels any active gesture** as a side effect.
- `redo(current)` mirrors undo from the future side.
- `maxSize` (default 100): on overflow, drop the oldest past entry.

Pure: no DOM, no audio, no `Date.now`, no `Math.random`. Generic over `T`.

### 2. `src/save/history-wiring.ts` — host glue

Extract a named type and two exports:

```ts
export interface SavedStateV3 {
  schemaVersion: 3;
  bpm: number;
  swing: number;
  masterVol: number;
  kit: string;
  wave: SynthWave;            // = TB303['params']['wave']
  synthParams: TB303['params'];
  sessionState: SessionState;
}

export function buildSavedStateV3(deps: SaveWiringDeps): SavedStateV3;
export function applyLoadedStateV3(s: SavedStateV3, deps: SaveWiringDeps): void;
```

The two functions already exist as **private** functions inside `src/save/save-wiring.ts` returning/accepting `Record<string, unknown>`. Extract them to a new file `src/save/saved-state-v3.ts` with the typed shape above so the history layer (and `save-wiring.ts`) can call them without duplicating the model. The runtime validation that `applyLoadedState` performs today (the `if (s.schemaVersion !== 3)` guard etc.) stays inside `applyLoadedStateV3`; the typed signature is a contract for in-app callers, file loads still pass through the validation path.

`history-wiring.ts` itself:

```ts
export interface HistoryDeps {
  history: HistoryController<SavedStateV3>;
  snapshot: () => SavedStateV3;     // = () => buildSavedStateV3(deps)
  restore: (s: SavedStateV3) => void; // = (s) => applyLoadedStateV3(s, deps)
}

export function wireHistoryKeyboard(d: HistoryDeps): void;
export function attachKnobUndo(knob: KnobHandle, d: HistoryDeps): void;
```

`wireHistoryKeyboard` installs a `keydown` handler on `document` for:

- `Ctrl+Z` / `Cmd+Z` → if `canUndo()`, `restore(history.undo(snapshot())!)`.
- `Ctrl+Shift+Z` / `Cmd+Shift+Z` / `Ctrl+Y` → redo analogue.

Handler ignores the event when the target is a text input/textarea/contentEditable to preserve native undo inside fields (rename prompts, save name dialogs).

`attachKnobUndo` wires `beginGesture` on the knob's pointerdown and `commitGesture` on pointerup. Implementation depends on the existing knob component (`src/core/knob.ts`); the helper hides the hook details.

### 3. Mutation-site refactor

Every place that mutates persisted state needs one of two changes:

| Site                              | Kind       | Hook                              |
|-----------------------------------|------------|-----------------------------------|
| Sequencer step toggle (UI)        | discrete   | `withUndo`                        |
| Add/remove lane                   | discrete   | `withUndo`                        |
| Add/remove scene                  | discrete   | `withUndo`                        |
| Add/remove clip (cell click)      | discrete   | `withUndo`                        |
| Clip move/copy (future spec)      | discrete   | `withUndo` (applied in clip-ops)  |
| Preset load                       | discrete   | `withUndo`                        |
| Engine selector change            | discrete   | `withUndo`                        |
| Kit change (`kitSel`)             | discrete   | `withUndo`                        |
| Wave change (`waveSel`)           | discrete   | `withUndo`                        |
| BPM/swing/volume input            | continuous | begin/commit on pointerdown/up    |
| Randomize / Clear pattern         | discrete   | `withUndo`                        |
| Knobs (engine params, FX, master) | continuous | `attachKnobUndo`                  |
| Modulation routing add/remove     | discrete   | `withUndo`                        |
| Modulation knobs (depth, rate)    | continuous | `attachKnobUndo`                  |
| Piano-roll note drag              | continuous | begin/commit around drag          |

A single helper for the discrete pattern:

```ts
export function withUndo<R>(d: HistoryDeps, fn: () => R): R {
  d.history.commit(d.snapshot());
  return fn();
}
```

Sites become `withUndo(historyDeps, () => doTheMutation())`.

### 4. Bootstrapping

In `main.ts`, after the existing wiring:

```ts
const history = createHistory<SavedStateV3>({ maxSize: 100 });
const historyDeps: HistoryDeps = {
  history,
  snapshot: () => buildSavedStateV3(deps),
  restore: (s) => applyLoadedStateV3(s, deps),
};
wireHistoryKeyboard(historyDeps);
```

Initial state on boot: history starts empty. The first user action snapshots the boot state into past, so `Ctrl+Z` immediately after that returns to boot.

## Testing

### `src/core/history.test.ts` (pure unit tests)

- `commit` pushes prev; `undo` returns the pushed value and pushes current to future.
- `redo` reverses `undo` exactly.
- A new `commit` after `undo` clears the future stack.
- `beginGesture` does not push to past; `commitGesture` pushes exactly one entry; intermediate `beginGesture` calls during an active gesture are ignored.
- `cancelGesture` discards without pushing.
- `undo` during an active gesture cancels the gesture.
- `maxSize` enforcement: when past length reaches `maxSize` and another `commit` arrives, the oldest entry is dropped.
- `canUndo` / `canRedo` reflect stack sizes in extreme states (empty, full, after undo/redo).

All tests use a trivial `T` (e.g. `number` or `{ v: number }`); no coupling to the project's real state shape.

### E2E (`tests/e2e/`)

One smoke test:

1. Load the app.
2. Toggle a step in the sequencer.
3. Send `Ctrl+Z`.
4. Assert the step is back to its previous visual state.

Verifies the wiring of keyboard → history → restore → DOM re-render end to end.

### What does not get a test

DSP and audio behaviour. Undo only restores state; the audio graph rebuilds itself from state via existing code paths covered by their own tests.

## Memory and edge cases

- **Stack growth**: capped at `maxSize` (100). At ~50 KB per snapshot the worst case is ~5 MB, well within browser memory budgets for an interactive app.
- **Save/load interaction**: loading a saved file does **not** push to history. The load callsites (`Load` button handler, file-load handler, save-manager `Load` row) call `history.clear()` immediately after `applyLoadedStateV3` so the past stack starts fresh from the loaded state. `applyLoadedStateV3` itself does not touch history (keeps it decoupled from the history layer; the call lives at the caller).
- **Autosave**: unaffected. Autosave fires on save events, not on undo/redo. Undo/redo do not trigger autosave (would defeat the purpose).
- **Boot recovery**: `bootRecoveryLoad` runs before any user action, so it precedes any history activity. No interaction.

## File layout summary

New:

- `src/core/history.ts`
- `src/core/history.test.ts`
- `src/save/saved-state-v3.ts` (extracted from `save-wiring.ts`)
- `src/save/history-wiring.ts`
- `tests/e2e/undo.spec.ts`

Modified:

- `src/save/save-wiring.ts` — import the extracted V3 helpers; no behaviour change.
- `src/main.ts` — instantiate history, install keyboard wiring, pass `historyDeps` to UI modules.
- `src/core/knob.ts` (or `src/core/knob-ui.ts`) — surface pointerdown/pointerup hooks if not already available, so `attachKnobUndo` can wire them.
- Every mutation site listed in the table above.

## Open implementation details

These are decided at plan/implementation time, not in the spec:

- Whether `withUndo` and `attachKnobUndo` live in `history-wiring.ts` or in a separate `history-helpers.ts`.
- Exact shape of the knob hook (callback vs event emitter).
- Whether to add a `historyDeps` argument to every UI module's constructor or expose a singleton — the former is consistent with the project's existing dependency-injection pattern; default to that.
