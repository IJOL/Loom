# Remaining work

Audit of 2026-05-31 against the codebase. Implemented design docs are removed from the
tree (recover from git history). The items below are what's left.

## ✅ Closed since the audit

- **Performance view now surfaces *and* persists takes** (was the only High item; plan +
  spec deleted). `finalizeArrangement` ([src/performance/arrangement-ops.ts](../../src/performance/arrangement-ops.ts))
  clamps open clip events on stop and computes `durationSec`, so a recorded take renders as
  timeline bands instead of the ever-empty `durationSec === 0` state; it's wired into
  `performance-feature`'s stop/disarm paths. `mode` + `arrangement` now persist in v3 saves
  ([src/save/saved-state-v3.ts](../../src/save/saved-state-v3.ts)) — save/load only, **not**
  undo/redo (so a take survives undoing an unrelated session edit). A round-trip e2e
  (record → switch → assert `.perf-clip`) replaces the old empty-state-only coverage.
  Verified in the real app (record → save → reload → load → the take re-renders). Commits
  `dced8d9` + `e77fd5c`.

## Low — minor, isolated

- **`modular-modulators` Task 19 — preset selector not automatable.** The preset dropdowns
  (`#bass-preset-select`, `#poly-preset-select`, `#drums-preset-select`) are plain `<select>`s,
  not wrapped in `createSelectControl` nor registered under a `<laneId>.preset` automation id.
  No `.preset` knob id exists. Everything else in that plan shipped.
- **`lane-resource-unification` cleanup debt.** `seq.pattern.bass/drums/automation/melody` is
  still read in ~7 files (main.ts, automation-ui.ts, copy/lane-copy.ts, …) and
  [src/session/session-migration.ts](../../src/session/session-migration.ts) still exists
  (now a load-time normaliser). The plan's "Phase E: kill Classic UI" was effectively
  *reinterpreted*, not skipped: the `data-page="303"/"drums"/"poly"/"fx"` divs were **repurposed**
  as the per-engine Session inspector pages (engine-swap mounts `#engine-select-303`,
  lane-fx-panel mounts into `[data-page] .lane-fx-knobs`), so they are live, not dead.

## Intentionally superseded (no action — recorded for context)

`session-view` and `session-clip-editors-and-copy-paste` were authored against a
`kind`/per-type-steps model that was later replaced by `engineId` + a unified
`SessionClip.notes: NoteEvent[]`. Their Classic-coupled deliverables (the mode toggle, the
`importClassicToSession` migration, the four per-type clip editors, cross-kind paste guards)
are genuinely absent because **Classic mode was removed entirely** — the work evolved, it
wasn't dropped. `classic-tracks-extraction` was done and then deliberately reverted for the
same reason. `main-ts-refactor` met its extraction goal but `main.ts` is ~824 lines (not the
~250 target) after absorbing later features.
