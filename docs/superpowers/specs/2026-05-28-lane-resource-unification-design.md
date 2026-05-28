# Lane Resource Unification — Design

**Date:** 2026-05-28
**Status:** Design approved, awaiting implementation plan

## Problem

The codebase carries two parallel "lane" models that the original Classic→Session migration left half-merged:

- **Classic singletons** wired at boot in `main.ts`: a single `polysynth`, a `bassStrip`, `drumBusStrip`, `polyStrip`, plus lazy `extraPolys[poly1..16]` / `extraStrips[poly1..16]`.
- **Session lanes** in `SessionState.lanes[]`, each with an `id`, `name`, `engineId`, `clips[]`.

Code that needs to route audio for a lane uses **hardcoded id checks** to bridge the two models:

```ts
if (laneId === 'main') return polyStrip;        // singleton route
if (laneId === 'bass') return bassStrip;
if (laneId === 'drums') return drumBusStrip;
// else assume extra lane
```

These checks appear in 23+ files. Renaming `'main'` → `'subtractive-1'` does not solve the problem — it just moves the literal. The fundamental issue is that the code differentiates *the first poly lane* from the rest as if they were structurally different, when they are not.

### Concrete symptoms

1. **Knobs leak across Subtractive lanes.** Subtractive 1 and Subtractive 2 share the singleton `polysynth.params`, so editing cutoff on one tab changes cutoff on the other. Modulator state (LFO/ADSR settings, depths, connections) is similarly shared.
2. **Modulation routing is brittle.** Lane-specific paramIds (`subtractive-2.filter.cutoff`) only bind because of fallbacks; the default path expects the singleton's id.
3. **Naming inconsistency.** Internal ids (`main`, `bass`, `drums`, `poly1`) leak into automation paramId display, modulator destination dropdowns, and the mixer column header — none of which match the session lane display names.
4. **Engine swap complexity.** Code paths for "switch engine on an existing lane" allocate/dispose engine instances mid-session, preserving partial state across switches.

## Requirements

1. **No hardcoded lane-id literals** in routing logic. Any decision that today reads `laneId === 'X'` reads `lane.engineId` (or another structural attribute) instead.
2. **Per-lane independence**: every lane has its own ChannelStrip, engine instance, modulators, and params. Changing one lane never affects another.
3. **Single data model**: Session state is the only model. `seq.pattern` and `bank.slots` as primary stores are gone.
4. **Per-lane independent clip loops**: each clip loops at its own `lengthBars` independent of other lanes' clips.
5. **Engine type is fixed at lane creation**. Changing the sound of a lane means deleting it and creating a new one.
6. **Test floor**: the engine DSP batteries (236 audio-real tests in `*.dsp.test.ts`) stay green throughout the refactor. Other tests are updated or retired at the close of each phase.
7. **No saved-state migration**: there are no field saves to preserve.

## Out of scope

- Save format migration from older app versions (none exist).
- Multi-window or multi-document support.
- New audio features beyond what already works.

## Data model

`SessionState` becomes the only top-level state container:

```ts
SessionState {
  lanes: SessionLane[]
  scenes: SessionScene[]
  globalQuantize: LaunchQuantize
}

SessionLane {
  id: string                    // slug derived from initial name; fixed for life of lane
  name: string                  // display, user-editable
  engineId: string              // 'tb303' | 'drums-machine' | 'subtractive' | 'wavetable' | 'fm' | 'karplus'
                                // FIXED at lane creation; cannot change after
  clips: (SessionClip | null)[] // indexed parallel to scenes
  engineState?: {               // persisted per-lane state of the engine
    params?: Record<string, number>
    modulators?: ModulatorState[]
  }
  enginePresetName?: string     // name of currently applied factory/user preset
}

SessionClip {
  id: string
  name?: string
  lengthBars: number            // per-clip loop length, independent of other clips
  notes: NoteEvent[]            // pitched events (bass, poly) OR drum events (mapped to drum voices)
  envelopes?: ClipEnvelope[]    // per-clip automation (paramId, values[], stepped, enabled)
}

SessionScene {
  id: string
  name?: string
  clipPerLane: Record<laneId, clipIndex>
}
```

### Eliminated

- `seq.pattern` as primary state (`bass`/`melody`/`drums`/`automation`/`extraPolyTracks` etc.).
- `bank.slots[]`.
- The `Pattern`/`PatternBank`/`PatternData` types as application-level data containers. (Sub-types like `BassStep`, `DrumStep`, `PolyStep` survive only inside legacy import helpers, if any.)

### Added

- `SessionLane.engineState` and `SessionLane.enginePresetName` — new, persist per-lane sound state. The fix for the "knobs leak between tabs" bug.

## Lane resources (kill the singleton)

A single map owns all per-lane audio resources:

```ts
class LaneResources {
  strip:   ChannelStrip       // EQ + sends + pan + level
  engine:  SynthEngine        // dedicated engine instance for this lane
}

const laneResources = new Map<laneId, LaneResources>()
```

### Lifecycle

- **At boot**: iterate `sessionState.lanes`; for each lane, create one `LaneResources` (allocate strip + engine instance via `createEngineInstance(lane.engineId)`).
- **On "+" tab**: open a small picker (TB-303 / Drums / Subtractive / Wavetable / FM / Karplus). On selection, append a `SessionLane` with a slugified default name (`subtractive-3`, `wavetable-1`, etc.) and create its `LaneResources`.
- **On lane delete**: dispose the strip and engine, remove from the map.
- **Never recreate mid-life**: a lane's resources are created once and disposed at delete.

### Singletons that die

- `polysynth` (global), `subtractiveEngine` (singleton in `subtractive.ts`).
- `bassStrip`, `polyStrip`, `drumBusStrip`, `masterStrip` (the last stays — it's a true master bus).
- `extraPolys[]`, `extraStrips[]`.
- `ensureExtraPoly`, `ensureLaneStrip`, `ensureLaneVoice`, `ensureLaneEngine`, `stripFor`, `activeTracks`, `rebuildMixer`, `LANE_LABELS`, `ALL_TRACKS`, `EXTRA_IDS`.

### Routing decisions

All by `lane.engineId`, never by `lane.id`:

- `engineId === 'tb303'` → mono trigger path (slide-aware), edit in bass step grid.
- `engineId === 'drums-machine'` → drum trigger path (MIDI → drum voice), edit in drum step grid.
- Other (`subtractive`/`wavetable`/`fm`/`karplus`) → poly trigger path, edit in piano roll OR step grid.

## Scheduler — per-lane independent loops

Replaces the current `Sequencer.tick()` model.

### Transport state

```ts
GlobalTransport {
  bpm: number
  isPlaying: boolean
  startedAt: number            // ctx.currentTime when play was pressed
}

LaneTransport {
  currentClipIndex: number | null
  loopStartedAt: number        // ctx.currentTime when this clip's current loop iteration began
  playing: boolean
}

const laneTransports = new Map<laneId, LaneTransport>()
```

### Tick (look-ahead, 25 ms cadence, 120 ms horizon)

Every 25 ms, for each lane:

1. If `laneTransport.playing === false`, skip.
2. `clip = activeClip(lane)` — the clip whose index is `scene.clipPerLane[lane.id]`. Null if cell empty.
3. If clip is null, skip.
4. `clipDurSec = clip.lengthBars * 4 * 60 / globalTransport.bpm`.
5. For notes in `clip.notes` whose **clip-time** falls in `[now − loopStartedAt, now + 120ms − loopStartedAt]` (modulo `clipDurSec`), compute their absolute schedule time and call `laneResources.get(lane.id).engine.createVoice(...)` + `voice.trigger(midi, scheduleTime, options)`.
6. For each `envelope` in `clip.envelopes`, evaluate the envelope at each scheduled note's clip-time and write the result to the lane's `AudioParam` (via `voice.getAudioParams()` + `getAudioParamRange()`).

Each lane has its own `loopStartedAt`. A 1-bar clip and a 4-bar clip on adjacent lanes loop independently and re-sync at their LCM.

### Scene launch

- Click on scene: for every lane, set `laneTransport.currentClipIndex = scene.clipPerLane[lane.id] ?? null`. `loopStartedAt = ctx.currentTime` (resync at clip start).
- Respect `lane.launchQuantize` / `state.globalQuantize`: defer the swap to the next bar/beat boundary if quantize ≠ `immediate`.

### Stop

- Global stop: all `laneTransport.playing = false`.
- Per-lane stop (column ⏹ button): only that lane's `playing = false`.

## UI surfaces

### Dies

- Pages `data-page="303"` (TB-303 step grid global), `"drums"` (drum step grid global), `"poly"` (poly step grid global), `"rolls"` (piano rolls stack), `"auto"` (global automation lanes).
- Static page tabs `TB-303 / Drums / Poly Synth / Piano Rolls / Automation`.
- `.mixer-classic` row at the bottom of Classic with global columns.
- Inner engine selector `<select id="engine-select">` in the synth editor (the one that switched engines on an existing lane).
- The `ENGINE | <lane-name> | <engine-select>` toolbar row inside the poly page.

### Survives

- Session view as the only top-level UI.
- Lane tabs (`TB-303 1`, `Drums 1`, `Subtractive 1`, `Subtractive 2`, `+`).
- The `+` button's adjacent engine-type picker (the OUTER selector — for choosing the engine of a NEW lane).
- Clip editor (in the inspector panel under the scene grid): step grid for bass / drums / poly, plus piano roll for poly.
- Engine controls panel: reads from `LaneResources.engine` of the active lane. Knobs rebind on tab change.
- Modulators panel: the LFO/ADSR cards. Persisted in `lane.engineState.modulators`.
- Per-lane mixer columns (one strip per session lane).
- Master FX panel (reverb, delay, master filters).
- Transport bar (play, BPM, swing, volume, save, load).
- Arpeggiator (scope = list of lane ids).

## Engine state per lane

### `lane.engineState.params`

- Updated when the user moves a knob on the active lane.
- Read at boot / load to repopulate `LaneResources.engine` initial values.
- Source of truth for save serialization.

### `lane.engineState.modulators`

- Updated when the user adds/removes/edits a modulator card (LFO / ADSR / connection / depth).
- Read at boot / load to seed `LaneResources.engine.modulators`.
- The modulator UI binds to the active lane's modHost.

### Presets

- `lane.enginePresetName` remembers the currently applied preset name for this lane.
- The preset dropdown shows only presets whose engine matches `lane.engineId` (the engine is now fixed, so the filtering is trivial).
- Auto-load on dropdown change (already implemented) writes the preset's params into `lane.engineState.params` + into the engine's AudioParams.

### Save / Load

- Serialize whole `SessionState` (lanes with engineState, scenes, clips with envelopes).
- Load: parse, recreate each `LaneResources` applying `engineState`.
- All `SaveManager` code that touches `bank` / `seq.pattern` is removed.

### Modulation vs automation

- **Modulator** (LFO/ADSR cards in the modulators panel) → `lane.engineState.modulators`. Per-lane, applies to all clips of that lane.
- **Automation** (per-step envelope drawn in the clip editor) → `clip.envelopes`. Per-clip.

## Phase plan

Each phase is one commit. The engine DSP batteries stay green throughout. Other tests are updated or retired at phase close.

### Phase A — Lane resources unified (no audible change)

- Add `LaneResources` and `laneResources: Map<laneId, LaneResources>`.
- At boot, iterate `sessionState.lanes` and allocate strip + engine instance per lane. Keep the existing globals (`polysynth`, `bassStrip`, etc.) as aliases pointing at the same objects in the Map — no functional change.
- Verify: identical audio behaviour. DSP battery green.
- Commit.

### Phase B — Routing by engineId (no data changes)

- Replace every `=== 'subtractive-1' | 'tb-303-1' | 'drums-1' | 'main' | 'bass' | 'drums' | 'poly1'` literal in routing decisions with a check on `lane.engineId` or with a `LaneResources` lookup keyed by `laneId`.
- Delete the `subtractiveEngine` singleton export at the bottom of `subtractive.ts` (the class itself stays — the registry's factory continues to use it). Every lane allocates via `createEngineInstance(engineId)`.
- Verify: identical audio. DSP battery green.
- Commit.

### Phase C — Per-lane engine state (fixes "knobs leak between tabs")

- Introduce `SessionLane.engineState`. On knob change, write to the lane's engine AND mirror into `engineState.params`.
- On tab switch, rebind the knob UI to the active lane's engine instance, reading current values from `engineState.params` or the engine's AudioParams.
- Verify: editing cutoff on Subtractive 1 does not change Subtractive 2; modulator settings are independent per tab.
- Commit.

### Phase D — Per-lane independent scheduler

- Replace `Sequencer.tick()` with the per-lane model: each lane tracks its own loop position via its `LaneTransport`.
- Delete `seq.pattern.bass/melody/drums/automation/extraPolyTracks` as source of truth. Delete `bank.slots`.
- Demo (`applyMinimalTechnoDemo`) is rewritten to build a `SessionState` with scenes + clips directly. The current 4-pattern variant goes away. Replacement scope: 1 scene with 3 lanes (TB-303 bass clip, drums clip, subtractive pad clip), each clip with its own `lengthBars` so the per-lane loop behaviour is audible. Re-adding multi-scene variants is left for a follow-up.
- Drop obsolete sequencer tests (`src/core/sequencer.test.ts`). Write a focused set of new TDD tests:
  - 1-bar clip loops 4× under a 4-bar clip on another lane.
  - Scene launch resyncs `loopStartedAt` for all lanes whose clip changed.
  - Stop kills scheduled-but-unfired events.
  - Per-clip envelope evaluation at correct clip-time.
- Verify: demo audible, lanes with different `lengthBars` loop independently.
- Commit.

### Phase E — Kill Classic UI

- Remove pages `data-page="303" | "drums" | "poly" | "rolls" | "auto"`.
- Remove `ENGINE | name | selector` row and the inner engine selector.
- Remove `.mixer-classic`.
- Remove all functions / types listed under "Singletons that die" and "Dies".
- Drop now-obsolete tests (e.g., `engine-selector-ui.test.ts` if it only tests the inner selector path).
- Commit.

### Phase F — Save format clean-up

- `SaveManager` writes only `SessionState`. Reads parse only `SessionState`.
- Remove all `bank` / `seq.pattern` serialization code.
- No migration: users start fresh.
- Commit.

## Risks & mitigations

- **Phase A regression risk**: aliasing the Map back to the globals may cause subtle reference identity bugs. Mitigation: TDD with the existing DSP batteries — they instantiate engines directly, so they catch regressions independent of `main.ts` wiring.
- **Phase D demo break**: the `applyMinimalTechnoDemo` may not be obviously translatable to the new clip model. Mitigation: rewrite the demo small (1 scene, 3 lanes with 1-bar drums + 2-bar bass + 4-bar pad). Acceptable to lose the 4-scene sequence — it can be re-added later as scenes.
- **Phase D scheduler edge cases**: notes that straddle a loop boundary, clip changes mid-bar, BPM changes mid-play. Mitigation: cover each in the new TDD test set.
- **Phase E orphaned references**: removing pages may leave broken event listeners or stale references in main.ts. Mitigation: typecheck after deletion catches obvious orphans; smoke test in browser per phase catches the rest.

## Success criteria

- App boots into Session view directly. No Classic pages reachable.
- Adding a Subtractive lane via "+" allocates an independent strip + engine. Editing its knobs does not affect any other lane.
- LFO routed to Subtractive 1's `filter.cutoff` is audible only on Subtractive 1.
- Two lanes with `lengthBars = 1` and `lengthBars = 4` loop independently and re-sync every 4 bars.
- All 236 engine DSP-battery tests stay green throughout.
- `npx tsc --noEmit` is clean at the end of each phase.
- `grep -rEn "=== ['\"]main['\"]|=== ['\"]bass['\"]|=== ['\"]drums['\"]|=== ['\"]poly1['\"]" src/` returns zero results at the close of Phase B.
- `grep -rEn "polysynth\b|bassStrip\b|polyStrip\b|drumBusStrip\b" src/` outside `lane-resources.ts` at the close of Phase E returns only references local to `LaneResources` allocation (the variables `polysynth`/`strip` inside its constructor are fine — what must be zero is **module-scope global** references in `main.ts`/`session-host.ts`/etc.).
