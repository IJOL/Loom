# Remaining work

Audit of 2026-05-31 against the codebase. Every plan/spec under `archive/` was verified
**done in code** (not just by commit message). The items below are the gaps that survived;
the plans/specs still in `plans/` + `specs/` (currently just `performance-view`) are the ones
with real outstanding work.

## High — Performance view is captured but never surfaces (`performance-view`)

The record path and playback path are both live and wired, but the feature is **not usable
end-to-end through the UI** because of one missing computation:

- **`arrangement.durationSec` is never set.** Nothing in [src/performance/rec-state.ts](../../src/performance/rec-state.ts),
  [src/app/performance-feature.ts](../../src/app/performance-feature.ts), or the stop path ever
  computes it (spec §3 = "max `untilSec` across lanes"). It stays `0`, so
  `renderPerformanceView` always takes the `durationSec === 0` empty-state branch — recorded
  clips/automation live in the data model but never render as timeline bands, and the
  ruler/playhead never appear. The user always sees "Sin grabación." even after a good take.
- **No save persistence (Task 19).** [src/save/saved-state-v3.ts](../../src/save/saved-state-v3.ts)
  never serializes/restores `mode` or `arrangement`; the feature's `getMode`/`setArrangement`
  accessors are wired to nothing in save-wiring. `saved-state-v3.performance.test.ts` only
  passes because `parseSavedStateV3` casts through unknown extra fields.
- **No e2e for the round-trip (Task 22).** `tests/e2e/performance-view.spec.ts` covers only the
  mode toggle, empty-state, and REC button class; the record→switch→assert-`.perf-clip` loop was
  deliberately skipped as "too brittle."

What works: arming REC + Session Play sets `rec.recording`; clip launches append
`ArrangementClipEvent`s at promote time; knob moves are sampled into automation curves every
25 ms; in Performance mode `tickArrangement` replays launches/stops and applies automation back
onto knobs with an rAF playhead. The missing `durationSec` is the single blocker between
"data captured" and "user can see/replay it."

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
