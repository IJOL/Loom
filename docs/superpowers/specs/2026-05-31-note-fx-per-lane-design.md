# Note-FX per-lane — design

**Date:** 2026-05-31
**Status:** Approved (design), pending implementation plan

## Problem

The arpeggiator does not work in the current Session-based flow. Two root causes:

1. **It lives outside the session model.** `arp` is a single global mutable
   singleton (`src/arp/arp-ui.ts`: `export const arp: ArpSettings`). It is NOT
   stored per-lane and is never serialized into `SessionState`. Demos are
   `SessionState` JSON, so loading a demo never touches the arp object — it
   keeps whatever configuration it had from the first demo. **This is the
   reported bug: "it stays on the initial demo's configuration."**
2. **Its UI is unreachable in Session.** The arp panel
   (`<details class="arp-panel">` in `index.html`) sits inside the legacy poly
   page, above the `Hidden in Session.` hint — so in the default Session flow
   the user cannot configure it.

By contrast, the LFO/ADSR modulators work correctly because they live in
`lane.engineState.modulators`: they serialize, load with each demo, and reset
themselves. The fix is to give note-transforming effects the same per-lane,
in-session home.

The user also wants future note-transforming plugins: a chord generator, a
scale filter, and note echoes. These are NOT modulators in the LFO/ADSR sense
(a modulator produces a continuous signal summed into an `AudioParam`). They
transform the **stream of note events** (1 note in → 0..N notes out). They are
a distinct, sibling plugin category.

## Scope

This spec covers:

1. The **note-FX** plugin category (infra) — per-lane, chained, in-session.
2. Porting the **arp** to it (the lone first member; reuses existing pure logic).
3. A **chord generator** as the second member — validates the abstraction with
   a transform that is structurally different from the arp (vertical vs
   horizontal expansion).
4. Removing the legacy global arp.

Out of scope (future specs, each on this same base): scale filter, note echo,
note-FX reordering UI.

## Concepts

- **Arp** expands a note in **time**: 1 note → N notes spread across the gate.
- **Chord** expands a note in **pitch**: 1 note → N simultaneous notes.
- Both are `NoteEvent[] → NoteEvent[]`, so they **chain**: the output of one is
  the input of the next. Order matters (`chord→arp` arpeggiates a chord;
  `arp→chord` turns each arp step into a chord). The chain processes in **order
  of addition** (no reordering UI in this spec — YAGNI).

## Architecture

### Data model

A note-FX event is the minimal note descriptor the trigger path already uses:

```ts
interface NoteFxEvent {
  note: number;      // MIDI
  time: number;      // absolute audio-context seconds
  gate: number;      // seconds the note holds
  accent: boolean;
}

interface NoteFxProcessor {
  /** Pure: transform the incoming note events. No Web Audio. */
  process(input: NoteFxEvent[], ctx: { bpm: number }): NoteFxEvent[];
}
```

Per-lane state, stored in `lane.engineState` next to `modulators`:

```ts
interface NoteFxState {
  id: string;                 // 'arp1', 'chord1', …
  kind: 'arp' | 'chord';
  enabled: boolean;
  params: Record<string, number | string>;
}
// lane.engineState.noteFx?: NoteFxState[]   // ORDERED; order = order of addition
```

Because it lives in `lane.engineState`, it serializes, loads with each demo, and
resets itself — exactly like `modulators`. This is what fixes the bug.

### Registry integration

Add `'notefx'` to `PluginKind` (alongside `'synth' | 'fx' | 'modulator'`). Each
note-FX is a registered plugin discovered by the build-time glob, mirroring how
modulators register. A per-lane `NoteFxChain` (sibling of `ModulationHost` /
`InsertChain`) owns the CRUD over `NoteFxState[]` and exposes
`process(events, {bpm})` that folds the chain in order, skipping disabled
entries.

The arp's **"scope"** concept disappears: a note-FX lives on the lane it
affects, so there is no lane-list to intercept.

## Data flow

The application point is unchanged — `src/app/trigger-dispatch.ts`, where a lane
turns a note into sound. Only *what* it invokes changes.

**Before:**
```
triggerForLane(note) →
  if (arp.enabled && arp.scope.includes(laneId) && engine !== drums)
    scheduleArpForNote(fire, arp, bpm, note, time, gate, accent)
  else fire(note, time, gate, accent, slidingIn)
```

**After:**
```
triggerForLane(note) →
  let events = [{ note, time, gate, accent }]
  for (const fx of laneNoteFxChain)        // order of addition
    if (fx.enabled) events = fx.process(events, { bpm })
  for (const e of events)
    fire(e.note, e.time, e.gate, e.accent, /*slide*/ false)
```

Rules:
- **Empty chain = passthrough.** No note-FX (or all disabled) → `events` holds
  the original note → behavior identical to today. Zero regression for lanes
  without note-FX.
- **`fire()` is unchanged** (`createVoice + trigger`). Note-FX decide *which*
  notes and *when*, never the audio graph.
- **Slide (303):** when the chain is non-empty the per-step `slidingIn` flag is
  ignored (matches today's arp, which already ignores slide). With an empty
  chain, slide is respected exactly as now.
- **Audio-clip samples** (loop/song) bypass the chain, as today.

## Components

- `src/notefx/notefx-types.ts` — `NoteFxEvent`, `NoteFxProcessor`, `NoteFxState`.
- `src/notefx/notefx-chain.ts` — `NoteFxChain`: CRUD + ordered `process()`.
- `src/plugins/notefx/arp.ts` — arp plugin. **Reuses** the existing pure logic
  (`generateArpSequence`, `buildPool`, `arpIntervalSec`, `SCALE_INTERVALS`)
  moved out of `src/arp/arp.ts`; the "how many notes fit in the gate" loop from
  `scheduleArpForNote` becomes its `process()`.
- `src/plugins/notefx/chord.ts` — chord plugin: each input note → a set of
  simultaneous notes (same `time`/`gate`), by chord type (maj/min/7/sus/…) plus
  octave/inversion. Exact param list finalized in the plan.
- `src/notefx/notefx-ui.ts` — per-lane "NOTE FX" panel, sibling of
  `renderModulatorsPanel`: `+ Arp` / `+ Chord`, per-card ON/OFF + × + params.
- Wiring: `session-engine-state.ts` mirrors note-FX edits into
  `lane.engineState.noteFx` (same mechanism as modulators);
  `trigger-dispatch.ts` folds the chain.

## Removal of the legacy arp

- Delete the `arp` singleton, `buildArpUI`, `ArpUIDeps`, the
  `<details class="arp-panel">` markup in `index.html`, and the `main.ts`
  wiring (`arpUIDeps`, `buildArpUI` calls, the `arp` field threaded into
  `TriggerDispatchDeps`).
- `scheduleArpForNote` is replaced by the chain fold in `trigger-dispatch.ts`.
- The arp's **pure logic is preserved and repackaged**, not rewritten.

## Migrations

**None.** The arp was never serialized, so there is no legacy state in saves or
demos. A lane without `noteFx` is simply an empty chain (passthrough); code that
reads the chain treats `undefined` as empty. No `session-migration.ts` change.

## Testing

- **Pure** (`*.test.ts`): `arp.process()` and `chord.process()` over
  `NoteFxEvent[]` — patterns, scales, note counts, correct chord intervals, and
  the chained `arp∘chord` in **both** orders.
- **Chain** (`notefx-chain.test.ts`): applies in order, skips disabled,
  passthrough on empty.
- **Integration**: a demo that includes a note-FX on a lane loads it; loading a
  different demo replaces/clears it — i.e. the reported regression, locked as a
  test.

## YAGNI / deferred

- Note-FX reordering UI (chain is order-of-addition for now).
- Scale filter and note echo plugins (future specs on this base).
- Per-note-FX modulation of note-FX params.
