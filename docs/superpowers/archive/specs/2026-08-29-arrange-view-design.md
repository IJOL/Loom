# Arrange view — the Performance mode becomes a DAW surface

**Date:** 2026-08-29 · **Status:** approved design, pending implementation plan
**Mockup (approved):** [2026-08-29-arrange-view-mockup.html](2026-08-29-arrange-view-mockup.html) — visual parity with it is an acceptance criterion.
**Background:** the "Loom as a DAW" audit report (2026-08-29) and `docs/manual/10-performance-and-arrangement.md` (accurate description of the *before* state).

## The idea, in one paragraph

The primary interface starts from **File → New**: an empty Arrange surface that invites you to **drop audio loops onto lanes**. Each dropped loop becomes an Audio lane with a band on the timeline, fitted to the session tempo. Around that primary gesture, the existing arrangement grows into a real DAW surface: one scrolling timeline, bands with identity (select, drag, trim honestly, mute), launch-solo per lane, and a ruler you can click. MIDI/clip bands keep working exactly as today — the center of gravity moves to audio.

## Decisions taken (with the user, 2026-08-29)

| Question | Decision |
|---|---|
| Scope of this round | F1 (one surface) + F2 (band identity & editing) + F3 (offsetSec). F4 (takes/comping, virtualisation) is explicitly out. |
| What does SOLO mean | **Launch-solo**: the arrangement stops driving the other lanes (via the dormant `overrideLane`). The mixer's audio m/s stays untouched, as a separate tool. |
| Default drag behaviour | **Free move + clamp** (gaps allowed; collision clamps against the neighbour). **Shift = ripple** (today's behaviour). **Alt = no snap.** |
| Weave/follow lanes under arrangement playback | **Timeline wins** — same contract as the grid: launching a band on a lane suspends its weave/follow (`suspendForGrid`); the WEAVE panel takes the lane back with its ▶. |
| Loop sources this round | **Drag & drop files from the OS** (primary). Record/capture (resample · system audio · mic) is **round 2**, its own spec. |
| Tempo on drop | **Fit to bars**: duration rounds to the nearest bar count at session BPM and stretches to fit (existing tempo-sync machinery). A bars-chip on the band corrects a bad fit by hand. No transient-based loop detection (that avenue was abandoned deliberately; this is arithmetic only). |

## 1 · Data model

Three additive fields on `ArrangementClipEvent` (`src/performance/performance.ts`):

- **`id: string`** — stable identity, generated at band creation (same `nextId(...)` mechanism clips and scenes use). Everything else hangs off it: selection, per-band mute, cross-lane drag, copy/paste. Edit APIs resolve by id; the index is derived internally so `arrangement-edit.ts` is extended, not rewritten.
- **`offsetSec?: number`** (absent = 0) — where inside the clip the band starts. A left-trim moves `atSec` **and** `offsetSec` together, so what you hear does not change bars — material is revealed or covered. Enables split (two bands, the second with an offset) and join.
- **`muted?: boolean`** — the band exists but never fires. Painted dimmed; gated in the scheduler.

Rules:

- The **no-overlap invariant stays** (overlap is F4's problem), but it is no longer enforced by ripple: new pure op `clampMove` in `arrangement-edit.ts` (free placement, clamped against neighbours). `rippleForward` survives only behind Shift.
- **Additive migration** through the existing `migrateArrangementCurves` pattern: an old save loads, ids are generated, absent optionals mean defaults. No user-facing migration ever.
- **Fix in passing:** the arrangement is **deep-cloned on save** (`saved-state-v3.ts` — today a live edit after saving mutates the serialized object; `weave` already clones).
- **Selection** (`Set<bandId>`) is runtime state in `performance-feature`, never persisted.

## 2 · Runtime

- **Launch-solo/mute per lane (F1).** Wire `overrideLane`/`isLaneOverridden` (`arrangement-runtime.ts` — currently zero production callers; `tickArrangement` already skips launches AND automation for overridden lanes). Solo on lane X = override every other lane **plus a `stopLane` quantized to the next bar** for what is already sounding (the musical goodbye). Un-solo re-anchors the affected lanes through the same mechanism seek uses (`anchorLanesAt` relaunches the band spanning the current position). Reversible mid-song.
- **Band mute (F2).** Skip `muted` events in `tickArrangement`'s launch loop and its stop pointer, respecting the existing contiguous-boundary logic.
- **Timeline wins.** `begin()` and every band launch go through the same door the grid uses — `SessionHost.deps.onGridLaunch` → `weaveWiring.suspendForGrid(laneId)` — before `launchClipAtTime`. Suspension remains runtime-only (never saved), and the WEAVE panel recovers the lane exactly as after a grid launch. Follow lanes behave the same.
- **Offset-aware launch (F3).** `launchClipAtTime` gains an optional `offsetSec`: for note clips it shifts the scheduler anchor (the clip "enters already started"); for audio clips `SampleSpawn` **already has** `offsetSec` — it is threaded through. Envelope interplay with loop regions is the known `KNOWN DEBT` (envelopes wrap on the whole clip) and stays out of scope, documented.
- **Mixer m/s become automatable (F2).** The audio mute/solo booleans register as destinations in the `DestinationRegistry`, so they appear in the + Automation picker and a take can capture a mute performance. (Today they are plain booleans outside all three doors: registry, `markParamTouched`, `landAutomationValue`.)
- **Seek (F1).** Ruler click = `anchorLanesAt` + `setSongAnchor`. Works stopped and playing. Ruler drag sets the A–B loop (existing `arrangement-brace.ts` math).
- **Ingestion (the drop).** File → decode → sample store (IndexedDB, existing) → ensure an Audio lane (`ensureLaneResource`; dropping on the "＋ new lane" strip creates one) → an audio clip carrying the sample + tempo-sync fit (duration → nearest bar count at session BPM; stretch via the existing warp machinery from the loop tempo-sync round) → a band `{id, clipId, atSec}` snapped to the drop bar. Everything through session-host ops so undo and persistence ride along.

## 3 · Surface & interaction

Approach: **evolve the current lit-html DOM view** (approach A). No canvas rewrite, no virtualisation — those belong to F4 if takes multiply elements. The full-repaint-per-commit scaling wall is accepted for this round.

- **One scroll container**: a two-column grid — sticky lane-header column left, sticky ruler on top, the timeline scrolls as one piece. The playhead is one absolute element over the content (the existing RAF already positions against the live ruler rect).
- **Lane header**: name + two visually distinct button pairs — `S▸/M▸` (launch-solo/mute, accent-coloured) and `m/s` (the mixer's audio pair, unchanged) + VU.
- **Bands**: audio bands render a **cached waveform** (peaks drawn once per clip to a small canvas — never per frame), loop-tiling tick marks, and a **bars-chip** to correct the fit. MIDI bands get a mini note preview. Muted = dimmed. Selected = outline.
- **Gestures** (copy the `session-clip-drag.ts` architecture: window capture-phase listeners, module-level gesture state that survives re-renders, threshold, ghost, Escape-cancel): click select, Shift-click add, marquee on empty space, drag = free move + clamp (Shift = ripple, Alt = no snap), vertical drag changes lane, edge handles resize (left edge slides `offsetSec` — the waveform stays anchored to the music), keyboard Del / Ctrl+D / Ctrl+C+V (paste at playhead) / Esc.
- **Context menu** per band: Mute, Split at playhead, Duplicate, Bars ▾ (audio), Delete.
- **Drop targets**: dragging a file highlights the lane row under the cursor; a permanent "＋ new lane" strip at the bottom creates an Audio lane on drop.
- **Empty state (File → New)**: a large "Drop audio loops to start" invitation replaces the "Back to Session" prompt; the record-a-loop button ships disabled until round 2.

## 4 · Persistence, undo, tests

- **Persistence:** the three new fields travel in `SavedStateV3.arrangement` as optionals (additive migration). Ingestion needs nothing new — samples and clips persist through existing paths. Zoom/scroll persists in `app-prefs` (localStorage), never in the save file (view state is machine-local).
- **Undo:** band edits go through the arrangement's own `arrHistory` (`commitArrUndo` before every mutation). **The drop touches two worlds** (session undo for lane+clip, arrangement undo for the band) and they are deliberately NOT fused — the arrangement stays outside session undo by design. Accepted consequence, documented: undoing only the session half leaves a band pointing at a missing clip; the runtime already skips launches for missing clips, and such a band renders as a dimmed "ghost".
- **Tests** (house layers, always-relative assertions, one test per user path):
  - *Pure:* `clampMove` (free+clamp, ripple behind Shift), split/join with `offsetSec`, id-backfilling migration, duration→bars rounding with edge cases (0.9 / 1.1 bars).
  - *Scheduling (fake clock):* band mute filters launches and stops; launch-solo = override + bar-quantized stop + relaunch on un-solo; **timeline-wins counted through the real transport** (the `weave-scheduling.test.ts` lesson — count triggers, don't test predicates in isolation).
  - *DSP/offset:* `launchClipAtTime` with offset emits shifted notes (lane-scheduler) and threads `offsetSec` into the audio spawn.
  - *e2e:* drop a wav on empty space → lane+band appear and **sound** (master tap); ruler click seeks; solo silences other lanes' launches at the bar; left-trim changes what sounds (measured, not eyeballed); a muted band is silent.
  - *Visual parity:* the real screen next to the approved mockup, by eye — mandatory.
- **File discipline:** new modules are born split (`perf-gestures`, `perf-ingest`, `band-render`, …), each under the 300-code-line target.

## Out of scope (deliberate)

- **Round 2 — record/capture a loop** (all three sources: internal resample → system audio → mic), looper-style bar-quantized. Own spec; lands on this round's surface.
- **F4 — takes/comping** (overlap model: sub-rows vs `takes[]`) and timeline virtualisation.
- **Tempo map** on the ruler (known debt, pinned by `arrangement-from-session.test.ts`).
- **Envelope × loop-region interplay** (known debt, pinned in `session-envelope-tick.test.ts`).
