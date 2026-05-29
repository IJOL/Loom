# main.ts Refactor — Design

**Date:** 2026-05-29
**Status:** Design approved, awaiting implementation plan
**Worktree branch:** `worktree-refactor-main-ts`

## Problem

[src/main.ts](src/main.ts) is 1093 lines. The file mixes:

- Audio graph construction (ctx, master, fx, strips, voices).
- Lane resource allocation (extra polys, generic lane strips, lazy voice cache).
- Mute/solo state.
- Automation registry + recording.
- BPM broadcast + UI listeners.
- Engine trigger dispatch (`triggerForLane`).
- Knob mounting and refresh.
- Lane-engine-host bookkeeping.
- DOM refs and `wireXxx` plumbing for ~12 UI modules.
- Boot orchestration (demo, presets, visualizer, save manager, history).

The project's established direction is extraction into focused modules — over 30 `// moved to src/...` comments scatter through `main.ts` from prior passes. What remains is the residue: large stateful blocks that were too tangled with each other to extract one-at-a-time. They are no longer tangled; they just haven't been moved yet.

### Concrete symptoms

1. **Hard to reason about.** A reader who wants to understand "what owns the automation registry" must scan top-to-bottom because the registry, the recorder, the REC button, and the `recordAutomationValue` smoothing are interleaved with unrelated code.
2. **Hard to test.** None of the in-file helpers (`stripFor`, `ensureExtraPoly`, `triggerForLane`, `recordAutomationValue`, `applyMuteSolo`, `mountSubtractiveLaneKnobs`) can be unit-tested — they close over module-level state.
3. **Edits are risky.** Every change in `main.ts` requires re-reading hundreds of lines of unrelated context to confirm no shared state is broken.
4. **Late-bound globals.** Several `let _foo: ... | null = null` exist purely to defer initialization between blocks that should not share a file (`_sessionStateForKnobs`, `_lookupEngineIdFn`, `_automationDeps`, `_lehState`).

## Goals

- `main.ts` shrinks to ~250–300 lines: imports, DOM refs, top-level constants, `wireXxx` calls, and the boot chain.
- Each extracted module owns one responsibility, has explicit deps, and is unit-testable.
- No behavior changes. Only code movement and dep wiring.
- Each extraction lands as a separate commit with `npx tsc --noEmit && npm run test:fast` passing.

## Non-goals

- No changes to engines, drums, sequencer, automation logic, save format, or any DSP.
- No new abstractions beyond what extraction requires.
- No touching `src/core/randomize-ui.ts` (uncommitted user work).
- No refactor of UI modules already in `src/core/`, `src/automation/`, `src/session/`, `src/save/`, `src/midi/`, `src/engines/`.

## Approach

Extract per layer of responsibility. Each new module exposes a factory `createXxx(deps): Xxx` that returns a closed-over handle. `main.ts` constructs handles in order and passes them to subsequent factories or to `wireXxx` calls.

This pattern matches what the project already does (`createHistory`, `wireXxx` modules, `LaneResourceMap`). It is the most familiar shape for a future reader.

### Final shape of main.ts

```ts
// imports
// top-level constants: ExtraId, TrackId, ALL_TRACKS, LANE_LABELS, formatters
// DOM refs
// populate kit/root selects

const audio       = createAudioGraph();
const lanes       = createLaneAllocator({ ctx: audio.ctx, master: audio.master, fx: audio.fx, ... });
const muteSolo    = createMuteSolo({ laneResources: lanes.resources, stripFor: lanes.stripFor, ALL_TRACKS, DRUM_LANES });
const automation  = createAutomationRecorder({ seq, getAutoAbsSubIdx, onLaneAdded: () => renderLanes() });
const bpm         = createBpmBroadcaster({ seq, fx: audio.fx, filterChain: audio.filterChain, polysynth: audio.polysynth, getExtraPolys: () => lanes.extraPolys });
const triggerForLane = createTriggerForLane({ ctx: audio.ctx, laneResources: lanes.resources, drums: audio.drums, arp, seq });
const knobs       = createKnobMounter({ ... });
const laneHost    = createLaneHost({ seq, bank, engineSel, rebuildEngineParamUI, lookupEngineId: () => sessionHost.state... });

// SessionHost construction (the giant deps object — stays in main.ts because it bridges everything)
const sessionHost = new SessionHost({ ... });

// wireXxx calls (transport, fx, automation tab, randomize, demo picker, etc.)
// boot chain: presetsLoaded.then(fetchDemoSession(...)).then(...)
```

### New modules

All live under `src/app/`.

#### 1. `src/app/audio-graph.ts`

```ts
export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  filterChain: FilterChain;
  fx: FxBus;
  bassStrip: ChannelStrip;
  polyStrip: ChannelStrip;
  drumBusStrip: ChannelStrip;
  synth: TB303;
  drums: DrumMachine;
  polysynth: PolySynth;
  mainSubtractive: SynthEngine | null;
}
export function createAudioGraph(): AudioGraph;
```

Construction-only module. Encapsulates the `new AudioContext()` and all immediate wiring (analyser, filterChain, fx, the three base strips, TB303, DrumMachine, PolySynth). Also runs `configureDrumsEngineSharedFx`, `configureTB303EngineMainInstance`, and `mainSubtractive.setPolySynth`.

Returns the bag of handles. Subsequent modules read from it; nothing else creates these objects.

Lines moved from main.ts: ~50.

#### 2. `src/app/lane-allocator.ts`

```ts
export interface LaneAllocator {
  resources: LaneResourceMap;
  extraStrips: Partial<Record<ExtraId, ChannelStrip>>;
  extraPolys:  Partial<Record<ExtraId, PolySynth>>;
  stripFor(t: TrackId | string): ChannelStrip;
  ensureExtraPoly(id: ExtraId): PolySynth;
  ensureLaneStrip(laneId: string): ChannelStrip;
  ensureLaneVoice(laneId: string, engineId: string): Voice | null;
  ensureLaneResource(laneId: string, engineId: string): void;
  getLaneEngineInstance(laneId: string): SynthEngine | null;
}
export function createLaneAllocator(deps: LaneAllocatorDeps): LaneAllocator;
```

Owns `laneResources`, the three `extra*` caches, and the `laneVoices` cache. Seeds the three built-in lanes (`tb-303-1`, `drums-1`, `subtractive-1`) at construction from the deps' handles.

Deps include: `ctx`, `master`, `fx`, `bassStrip`, `polyStrip`, `drumBusStrip`, `tb303Engine`, `drumsEngineInstance`, `mainSubtractive`, `synth`, `drums`, `polysynth`, `getBpm()`.

Lines moved from main.ts: ~110.

#### 3. `src/app/mute-solo.ts`

```ts
export interface MuteSoloController {
  muteState: Record<TrackId, boolean>;
  soloState: Record<TrackId, boolean>;
  applyMuteSolo(): void;
}
export function createMuteSolo(deps: MuteSoloDeps): MuteSoloController;
```

Owns the two state records. `applyMuteSolo` builds the `MuteSoloLane[]` from `deps.laneResources.ids()`, calls `computeStripMutes`, and pushes the result onto each strip via `deps.stripFor(id).setMuted(muted)`.

Lines moved from main.ts: ~30.

#### 4. `src/app/automation-recording.ts`

```ts
export interface AutomationRecorder {
  registry: Map<string, KnobHandle>;
  registerKnob(k: KnobHandle): void;
  recordValue(paramId: string, value: number): void;
  setRecording(on: boolean): void;
  isRecording(): boolean;
  wireRecButton(btn: HTMLButtonElement): void;
}
export function createAutomationRecorder(deps: AutomationRecorderDeps): AutomationRecorder;
```

Owns `automationRegistry` and the `recording` flag. `registerKnob` wires the `onValueChanged` bridge that calls `recordValue` when armed + playing. `recordValue` does the lane-create + smoothing currently inlined.

Deps: `seq`, `getAutoAbsSubIdx`, `onLaneAdded: () => void` (called when `recordValue` creates a new automation lane — main.ts passes `renderLanes`).

`wireRecButton` replaces the inline REC button listener.

Lines moved from main.ts: ~60.

#### 5. `src/app/bpm-broadcast.ts`

```ts
export interface BpmBroadcaster {
  broadcast(bpm: number): void;
}
export function createBpmBroadcaster(deps: BpmBroadcasterDeps): BpmBroadcaster;
```

`broadcast(bpm)` updates `seq.bpm`, `fx.setBpmSync`, `filterChain.updateBpm`, `polysynth.bpm`, each `extraPolys[id].bpm`, and calls `propagateBpmToLaneEngines`. main.ts replaces the `bpmInput` listener body with `bpm.broadcast(parsedValue)`.

Deps: `seq`, `fx`, `filterChain`, `polysynth`, `getExtraPolys()`, list of engine ids to update (`['fm', 'karplus', 'subtractive', 'wavetable', 'drums-machine']` from the existing `propagateBpmToLaneEngines`).

Lines moved from main.ts: ~30.

#### 6. `src/app/trigger-dispatch.ts`

```ts
export function createTriggerForLane(deps: TriggerDispatchDeps): TriggerForLane;
export type TriggerForLane = (laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn?: boolean) => void;
```

Wraps the existing `triggerForLane` closure. Deps: `ctx`, `laneResources`, `drums`, `arp` (the imported singleton from `arp-ui.ts`), `seq`, plus `setCurrentLaneForVoice`, `scheduleArpForNote`, `GM_DRUM_MAP` (imported within the module).

Lines moved from main.ts: ~50.

#### 7. `src/app/knob-mounting.ts`

```ts
export interface KnobMounter {
  wireLaneKnobs(opts: LaneWiringOpts): void;
  mountSubtractiveLaneKnobs(laneId: string): void;
  mountDrumMasterLaneKnobs(laneId: string): void;
  refreshKnobsFromSynth(): void;
  refreshLaneKnobs(laneId: string, engine: SynthEngine): void;
  setSessionState(s: SessionState): void;
}
export function createKnobMounter(deps: KnobMounterDeps): KnobMounter;
```

Hosts all mount/refresh helpers. The deferred `_sessionStateForKnobs` becomes a clean `setSessionState(s)` setter that main.ts calls after `sessionHost.init()`. The deferred `lookupLaneDisplayName` becomes a getter passed into deps.

Deps: `registerKnob`, `registry`, `laneResources`, `tb303Engine`, `synth`, `drumBusStrip` (default for drum-master), `LANE_ID_BASS`, `fmtPct`, `fmtDb`, `sessionHostStateGetter`.

Lines moved from main.ts: ~80.

#### 8. `src/app/lane-host-wiring.ts`

```ts
export interface LaneHost {
  state: LaneEngineHostState;
  getLaneEngineId(laneId: string): string;
  setActiveEngineLane(laneId: string): void;
  setLookupEngineId(fn: (laneId: string) => string): void;
}
export function createLaneHost(deps: LaneHostDeps): LaneHost;
```

Encapsulates `_lehState`, `_lehDeps`, and the late-bound `_lookupEngineIdFn`. `setLookupEngineId` replaces the current pattern where main.ts mutates a top-level `let`.

Lines moved from main.ts: ~30.

### What stays in main.ts

- Imports.
- Top-level constants: `ExtraId`, `EXTRA_IDS`, `TrackId`, `ALL_TRACKS`, `LANE_LABELS`, formatters (`fmtPct`, `fmtDb`, `fmtSec`, `fmtCents`, `fmtOct`), `$`/`$$` helpers, `midiLabel`.
- Preset loader kickoff (`presetsLoaded = loadAllPresets(...)`).
- DOM refs block.
- `setBassMode` / `updateBassModeButtons` (small, tied to UI buttons and `seq.pattern.bassMode`).
- Tab switching loop (small, generic DOM glue).
- Populating selects (kit dropdown, root note dropdown).
- All listeners on `bpmInput`, `swingInput`, `volInput`, `waveSel`, `barsSel`, `kitSel` — they become one-liners delegating to handles.
- `SessionHost` construction (the giant deps object — bridges everything by definition).
- `launchSceneById` (stays — it weaves session/scene/preset/audio together).
- `mixerDeps` and `activeEnginePrefix` (small, depend on `sessionHost.state`).
- Every `wireXxx(deps)` call: `wireFxUI`, `wireTransport`, `wireAutomationTab`, `wirePresetLibrary`, `wirePolyControls`, `wirePolyMode`, `wireSlotCopyPanel`, `wireCopyNotesPanel`, `wireMidiImportUI`, `wireRandomizeUI`, `wireEngineSelector`, `wireDemoPicker`, `wireSaveManager`, `wireHistoryKeyboard`.
- Boot chain: `setupInitialPattern`, `startAutomationTick`, `startVisualizer`, `presetsLoaded.then(fetchDemoSession(...))`, `bootRecoveryLoad`.
- The `recBtn` wiring becomes `automation.wireRecButton(recBtn)`.

Estimated remaining size: 250–300 lines.

## Phasing

Each phase is one commit. Between phases: `npx tsc --noEmit && npm run test:fast`. Phases that touch dispatch / engine state / lane wiring (4–7) get a manual smoke check via `npm run dev`: bass plays, poly plays, drums play, REC arms, automation moves on a knob drag.

| # | Phase | Risk | LOC moved | Verification |
|---|-------|------|-----------|--------------|
| 0 | Dead-code cleanup: delete `// moved to ...` comments and orphan boilerplate | trivial | -30 | tsc + test:fast |
| 1 | Extract `audio-graph.ts` | low | ~50 | tsc + test:fast |
| 2 | Extract `bpm-broadcast.ts` | low | ~30 | tsc + test:fast |
| 3 | Extract `mute-solo.ts` | low | ~30 | tsc + test:fast |
| 4 | Extract `lane-allocator.ts` | medium | ~110 | tsc + test:fast + manual smoke |
| 5 | Extract `automation-recording.ts` | medium | ~60 | tsc + test:fast + manual smoke (REC) |
| 6 | Extract `trigger-dispatch.ts` | medium | ~50 | tsc + test:fast + manual smoke (engine triggers) |
| 7 | Extract `knob-mounting.ts` | medium | ~80 | tsc + test:fast + manual smoke (knob drag, lane swap) |
| 8 | Extract `lane-host-wiring.ts` | low | ~30 | tsc + test:fast |
| 9 | Final cleanup: regroup deps + `wireXxx` calls, drop orphan helpers | trivial | reorganize | tsc + test:fast + manual smoke |

Final verification (after phase 9): `npm test` (full suite including e2e + DSP) before merging back to `feat/undo-global`.

## Risks

- **State coupling between extractions.** `automation-recording` calls back into `renderLanes`, which lives in `automation-ui.ts` and is wired via `automationDeps`. main.ts already late-binds `renderLanes` with a stable wrapper; the extraction keeps that wrapper.
- **Order of construction matters.** `sessionHost` is constructed after most modules but its `state` is read by some (knob-mounting, lane-host). Handled via getter functions in deps (the existing pattern).
- **Lane allocator is the riskiest single extraction** (~110 lines, many call sites). Mitigated by landing it as its own commit and smoke-testing immediately. If it breaks something, revert just that commit.
- **No automated coverage of the manual smoke flows.** The unit tests cover engine, sequencer, automation, save logic — they will catch wiring breaks at the type and function-contract level, but a "lane plays no audio" regression needs ear or scope. Smoke check at each medium-risk phase mitigates.

## Out of scope (deferred)

- Extracting `SessionHost` deps object into a builder — would change the surface area of `session-host.ts` and is large enough for its own spec.
- Splitting `LANE_LABELS` / formatters into their own files — would create churn without obvious payoff for this scope.
- Replacing `launchSceneById` — it bridges too many systems to extract cleanly without a separate design pass.
