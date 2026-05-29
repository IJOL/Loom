# main.ts Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink [src/main.ts](src/main.ts) from 1093 → ~250 lines by extracting 8 focused modules under `src/app/`, with no behavior change.

**Architecture:** Each extracted module exposes a `createXxx(deps): Xxx` factory that owns its state and returns a handle. main.ts constructs handles in dependency order and passes them into existing `wireXxx` calls. This matches the established pattern in the codebase (`createHistory`, `createAudioGraph` will follow `LaneResourceMap` / `wireFxUI` shape).

**Tech Stack:** TypeScript (Vite), Vitest for unit/scheduling/DSP tests, Playwright for e2e.

**Spec:** [docs/superpowers/specs/2026-05-29-main-ts-refactor-design.md](docs/superpowers/specs/2026-05-29-main-ts-refactor-design.md)

**Branch:** `worktree-refactor-main-ts` (worktree at `.claude/worktrees/refactor-main-ts`).

---

## Conventions

- **Verify between every task:** `npx tsc --noEmit && npm run test:fast`. Both must pass before commit. The repo has no linter; `tsc` is the contract.
- **Manual smoke** for tasks 5, 6, 7, 8 (engine/dispatch-touching): `npm run dev`, then in the browser confirm
  1. Bass lane plays a note when you arm play.
  2. Subtractive 1 (poly) plays its track.
  3. Drum bus triggers kick/snare.
  4. REC button arms (red), and dragging a bass knob during playback creates an automation lane.
  5. Add a Subtractive 2 lane via the session UI → cutoff knob on Sub 2 does NOT affect Sub 1 (lane isolation still works).
- **Commit style:** `refactor(main): <short description>` for each task. Co-author trailer auto-added by the bash skill harness.
- **Never delete a comment without checking the lines it gates.** Several `// moved to ...` comments sit immediately above or below code that uses the moved module — read 3 lines of context first.
- **DOM globals stay in main.ts.** `$`, `$$`, `playBtn`, `bpmInput`, etc. are not extracted; modules receive what they need via deps.

---

## Task 1: Dead-code cleanup

**Files:**
- Modify: [src/main.ts](src/main.ts) — remove orphan `// moved to ...` comments and dead section headers.

**Background.** Roughly 30 comments in main.ts mark code that was moved out in previous passes (`// moved to src/automation-ui.ts`, `// ── Cosmic Arpeggiator ──`, etc.). They no longer mark anything — the headers sit alone, often next to one-liner imports. Removing them now (before any extraction) makes the later diffs smaller and the file scannable.

**What stays:** Comments that document non-obvious *behavior* (e.g., the "Slide bleeds across synth.ts and sequencer.ts" architectural notes, the `// Phase A: ...` block above `laneResources` since it explains the migration state).

**What goes:** Any comment whose body is just "moved to <file>" or "see <file>" with no other content. The dashed section banners that sit above one short block can also be removed where the block is now self-explanatory.

- [ ] **Step 1: Scan main.ts and identify removal candidates**

Run:
```bash
grep -n '// moved to\|→ src/\|→ moved' src/main.ts
grep -n '^// ──' src/main.ts
```

Walk each hit. Keep banner lines that introduce a code block ≥ 8 lines or convey non-derivable info; delete the rest.

- [ ] **Step 2: Delete identified comments with Edit**

Use the Edit tool, one block at a time. Do NOT do a bulk regex replace — the surrounding code matters and you must preserve indentation.

Typical removal:
```ts
// ── Copy notes between lanes (303 ↔ main poly ↔ extra polys) ──────────────
// Moved to src/core/copy-notes.ts — wired at boot via wireCopyNotesPanel()
```
becomes nothing (delete both lines).

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

Both must pass with zero output diff vs baseline.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "refactor(main): drop orphan 'moved to' comments and dead section banners"
```

---

## Task 2: Extract `src/app/audio-graph.ts`

**Files:**
- Create: `src/app/audio-graph.ts`
- Modify: [src/main.ts](src/main.ts) lines ~109-149 (audio graph construction block) and any downstream readers.

**Module contract.**

```ts
// src/app/audio-graph.ts
import { FxBus, ChannelStrip, FilterChain } from '../core/fx';
import { TB303 } from '../core/synth';
import { DrumMachine } from '../core/drums';
import { PolySynth } from '../polysynth/polysynth';
import { configureTB303EngineMainInstance, tb303Engine } from '../engines/tb303';
import { configureDrumsEngineSharedFx } from '../engines/drums-engine';
import { getEngine } from '../engines/registry';
import type { SynthEngine } from '../engines/engine-types';

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
  drumsEngineInstance: SynthEngine | null;
}

export function createAudioGraph(): AudioGraph {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.connect(ctx.destination);
  const filterChain = new FilterChain(ctx, master, analyser);
  const fx = new FxBus(ctx, master);
  configureDrumsEngineSharedFx(fx);

  const bassStrip    = new ChannelStrip(ctx, master, fx);
  const polyStrip    = new ChannelStrip(ctx, master, fx);
  const drumBusStrip = new ChannelStrip(ctx, master, fx);

  const synth = new TB303(ctx, bassStrip.input);
  configureTB303EngineMainInstance(bassStrip.input, synth);
  const drums = new DrumMachine(ctx, fx, drumBusStrip.input);
  const polysynth = new PolySynth(ctx, polyStrip.input);

  const mainSubtractive = getEngine('subtractive');
  if (mainSubtractive) {
    (mainSubtractive as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(polysynth);
  }
  const drumsEngineInstance = getEngine('drums-machine');

  return {
    ctx, master, analyser, filterChain, fx,
    bassStrip, polyStrip, drumBusStrip,
    synth, drums, polysynth,
    mainSubtractive, drumsEngineInstance,
  };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/audio-graph.ts` with the exact contents shown in "Module contract" above.

- [ ] **Step 2: Update main.ts — import and replace construction**

In main.ts, find the existing audio-graph construction block (~lines 109-149: `const ctx = new AudioContext()` through `(drumsEngineInstance as unknown as ...).setBusStrip?.(drumBusStrip)`).

Replace with:
```ts
import { createAudioGraph } from './app/audio-graph';

const audio = createAudioGraph();
const { ctx, master, analyser, filterChain, fx,
        bassStrip, polyStrip, drumBusStrip,
        synth, drums, polysynth,
        mainSubtractive, drumsEngineInstance } = audio;
```

Keep the import for `tb303Engine` (used downstream by `wireLaneKnobs(... tb303Engine ...)` and `refreshKnobsFromSynth`). Keep the `laneResources` seeding block (Phase A) — that's part of lane-allocator, not audio-graph; it stays in main.ts for now and moves in Task 5.

- [ ] **Step 3: Remove leftover imports**

Top of main.ts no longer needs: `FxBus`, `ChannelStrip`, `FilterChain` (still needed if used elsewhere — keep `ChannelStrip` for `extraStrips: Partial<Record<ExtraId, ChannelStrip>>` typing). Check each before deleting. Run tsc to confirm what's actually unused.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 5: Commit**

```bash
git add src/app/audio-graph.ts src/main.ts
git commit -m "refactor(main): extract createAudioGraph into src/app/audio-graph.ts"
```

---

## Task 3: Extract `src/app/bpm-broadcast.ts`

**Files:**
- Create: `src/app/bpm-broadcast.ts`
- Modify: [src/main.ts](src/main.ts) — `propagateBpmToLaneEngines` body (~525-533) and `bpmInput` listener (~535-545).

**Module contract.**

```ts
// src/app/bpm-broadcast.ts
import { getEngine } from '../engines/registry';
import type { FxBus, FilterChain } from '../core/fx';
import type { Sequencer } from '../core/sequencer';
import type { PolySynth } from '../polysynth/polysynth';

export interface BpmBroadcasterDeps {
  seq: Sequencer;
  fx: FxBus;
  filterChain: FilterChain;
  polysynth: PolySynth;
  getExtraPolys(): Iterable<PolySynth>;
}

export interface BpmBroadcaster {
  broadcast(bpm: number): void;
}

const LANE_HOST_ENGINE_IDS = ['fm', 'karplus', 'subtractive', 'wavetable', 'drums-machine'];

export function createBpmBroadcaster(deps: BpmBroadcasterDeps): BpmBroadcaster {
  const propagateToLaneEngines = (bpm: number): void => {
    for (const id of LANE_HOST_ENGINE_IDS) {
      const eng = getEngine(id) as unknown as { bpm?: number } | undefined;
      if (eng && typeof eng.bpm === 'number') eng.bpm = bpm;
    }
  };
  return {
    broadcast(bpm: number) {
      deps.seq.bpm = bpm;
      deps.fx.setBpmSync(bpm);
      deps.filterChain.updateBpm(bpm);
      deps.polysynth.bpm = bpm;
      for (const p of deps.getExtraPolys()) p.bpm = bpm;
      propagateToLaneEngines(bpm);
    },
  };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/bpm-broadcast.ts` with the contents above.

- [ ] **Step 2: Update main.ts — wire the broadcaster**

After the `audio` block, add:
```ts
import { createBpmBroadcaster } from './app/bpm-broadcast';

const bpmBroadcast = createBpmBroadcaster({
  seq, fx, filterChain, polysynth,
  getExtraPolys: () => Object.values(extraPolys).filter((p): p is PolySynth => !!p),
});
```

Note: `extraPolys` is still in main.ts (moves in Task 5). Use the `Object.values` closure so the broadcaster reads the live map.

- [ ] **Step 3: Replace the listener body**

Find the `bpmInput.addEventListener('input', ...)` block. Replace its body:
```ts
bpmInput.addEventListener('input', () => {
  const v = parseInt(bpmInput.value, 10);
  if (!isNaN(v)) bpmBroadcast.broadcast(Math.max(40, Math.min(240, v)));
});
```

Replace the boot-time fan-out (`fx.setBpmSync(seq.bpm); polysynth.bpm = seq.bpm; for (const id of EXTRA_IDS) ...; propagateBpmToLaneEngines(seq.bpm);`) with:
```ts
bpmBroadcast.broadcast(seq.bpm);
```

Delete the `propagateBpmToLaneEngines` function definition.

- [ ] **Step 4: Update `wireMidiImportUI` setBpm**

The MIDI import wiring has its own `setBpm` (~lines 993-1001) that duplicates the broadcast. Replace its body with:
```ts
setBpm: (bpm: number) => {
  const clamped = Math.max(40, Math.min(240, Math.round(bpm)));
  bpmBroadcast.broadcast(clamped);
  bpmInput.value = String(clamped);
},
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 6: Commit**

```bash
git add src/app/bpm-broadcast.ts src/main.ts
git commit -m "refactor(main): extract createBpmBroadcaster into src/app/bpm-broadcast.ts"
```

---

## Task 4: Extract `src/app/mute-solo.ts`

**Files:**
- Create: `src/app/mute-solo.ts`
- Modify: [src/main.ts](src/main.ts) — `muteState`/`soloState`/`applyMuteSolo` block (~298-326).

**Module contract.**

```ts
// src/app/mute-solo.ts
import { computeStripMutes, type MuteSoloLane } from '../core/mute-solo';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';
import { DRUM_LANES } from '../core/drums';
import type { LaneResourceMap } from '../core/lane-resources';
import type { ChannelStrip } from '../core/fx';

export interface MuteSoloDeps {
  laneResources: LaneResourceMap;
  stripFor(t: string): ChannelStrip;
  allTrackIds: readonly string[];
}

export interface MuteSoloController {
  muteState: Record<string, boolean>;
  soloState: Record<string, boolean>;
  apply(): void;
}

export function createMuteSolo(deps: MuteSoloDeps): MuteSoloController {
  const muteState: Record<string, boolean> = Object.fromEntries(deps.allTrackIds.map((t) => [t, false]));
  const soloState: Record<string, boolean> = Object.fromEntries(deps.allTrackIds.map((t) => [t, false]));

  const apply = () => {
    const lanes: MuteSoloLane[] = [];
    for (const laneId of deps.laneResources.ids()) {
      const ownedTrackIds: string[] = [];
      if (laneId === LANE_ID_BASS)  ownedTrackIds.push('bass');
      if (laneId === LANE_ID_POLY)  ownedTrackIds.push('poly');
      if (laneId === LANE_ID_DRUMS) {
        ownedTrackIds.push('drumBus');
        for (const voice of DRUM_LANES) ownedTrackIds.push(voice);
      }
      lanes.push({ id: laneId, ownedTrackIds });
    }
    const mutes = computeStripMutes({ lanes, muteState, soloState });
    for (const [id, muted] of Object.entries(mutes)) {
      deps.stripFor(id).setMuted(muted);
    }
  };

  return { muteState, soloState, apply };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/mute-solo.ts` with the contents above.

- [ ] **Step 2: Update main.ts — replace the inline block**

Delete the inline `muteState`/`soloState`/`applyMuteSolo` definitions (lines ~298-326). Replace with:
```ts
import { createMuteSolo } from './app/mute-solo';

const muteSolo = createMuteSolo({
  laneResources, stripFor,
  allTrackIds: ALL_TRACKS as readonly string[],
});
const { muteState, soloState } = muteSolo;
const applyMuteSolo = () => muteSolo.apply();
```

Keep the local `muteState`/`soloState`/`applyMuteSolo` names as aliases so existing call sites and the `mixerDeps` object continue to work.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 4: Commit**

```bash
git add src/app/mute-solo.ts src/main.ts
git commit -m "refactor(main): extract createMuteSolo into src/app/mute-solo.ts"
```

---

## Task 5: Extract `src/app/lane-allocator.ts`

**Files:**
- Create: `src/app/lane-allocator.ts`
- Modify: [src/main.ts](src/main.ts) — the `extraStrips`/`extraPolys`/`extraLaneStrips`/`laneVoices` declarations, `slugFromExtraId`, `ensureExtraPoly`, `stripFor`, `ensureLaneStrip`, `ensureLaneVoice`, `ensureLaneResource`, and the Phase A `laneResources` seed (lines ~138-213, ~397-449).

**This is the largest extraction.** Read all five functions and their call sites in main.ts before starting.

**Module contract.**

```ts
// src/app/lane-allocator.ts
import { LaneResourceMap } from '../core/lane-resources';
import { ChannelStrip } from '../core/fx';
import { PolySynth } from '../polysynth/polysynth';
import { getEngine, createEngineInstance } from '../engines/registry';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';
import { DRUM_LANES, type DrumVoice, type DrumMachine } from '../core/drums';
import type { SynthEngine, Voice } from '../engines/engine-types';
import type { FxBus } from '../core/fx';
import type { TB303 } from '../core/synth';

export interface LaneAllocatorDeps {
  ctx: AudioContext;
  master: GainNode;
  fx: FxBus;
  bassStrip: ChannelStrip;
  polyStrip: ChannelStrip;
  drumBusStrip: ChannelStrip;
  drums: DrumMachine;
  synth: TB303;
  polysynth: PolySynth;
  tb303Engine: SynthEngine;
  mainSubtractive: SynthEngine | null;
  drumsEngineInstance: SynthEngine | null;
  getBpm(): number;
  extraIds: readonly string[]; // pass EXTRA_IDS from main.ts
}

export type ExtraId = string; // kept loose; main.ts narrows
export interface LaneAllocator {
  resources: LaneResourceMap;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  extraPolys:  Partial<Record<string, PolySynth>>;
  stripFor(t: string): ChannelStrip;
  ensureExtraPoly(id: string): PolySynth;
  ensureLaneStrip(laneId: string): ChannelStrip;
  ensureLaneVoice(laneId: string, engineId: string): Voice | null;
  ensureLaneResource(laneId: string, engineId: string): void;
  getLaneEngineInstance(laneId: string): SynthEngine | null;
  slugFromExtraId(id: string): string;
}

export function createLaneAllocator(deps: LaneAllocatorDeps): LaneAllocator {
  const resources = new LaneResourceMap();
  const extraStrips: Partial<Record<string, ChannelStrip>> = {};
  const extraPolys: Partial<Record<string, PolySynth>> = {};
  const extraLaneStrips = new Map<string, ChannelStrip>();
  const laneVoices = new Map<string, Voice>();

  // Seed built-in lanes (was the Phase A block in main.ts).
  if (deps.drumsEngineInstance && deps.mainSubtractive) {
    resources.set(LANE_ID_BASS,  { strip: deps.bassStrip,    engine: deps.tb303Engine });
    resources.set(LANE_ID_DRUMS, { strip: deps.drumBusStrip, engine: deps.drumsEngineInstance });
    (deps.drumsEngineInstance as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(deps.drumBusStrip);
    resources.set(LANE_ID_POLY,  { strip: deps.polyStrip,    engine: deps.mainSubtractive });
  }

  const slugFromExtraId = (id: string): string => {
    const n = parseInt(id.replace('poly', ''), 10) + 1;
    return `subtractive-${n}`;
  };

  const ensureExtraPoly = (id: string): PolySynth => {
    let p = extraPolys[id];
    if (p) return p;
    const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx);
    p = new PolySynth(deps.ctx, strip.input);
    p.bpm = deps.getBpm();
    extraStrips[id] = strip;
    extraPolys[id] = p;
    const engine = createEngineInstance('subtractive');
    if (engine) {
      const setPS = (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth;
      if (setPS) setPS.call(engine, p);
      resources.set(slugFromExtraId(id), { strip, engine });
    }
    return p;
  };

  const ensureLaneStrip = (laneId: string): ChannelStrip => {
    if (laneId === 'tb-303-1')      return deps.bassStrip;
    if (laneId === 'drums-1')       return deps.drumBusStrip;
    if (laneId === 'subtractive-1') return deps.polyStrip;
    if (deps.extraIds.includes(laneId)) {
      ensureExtraPoly(laneId);
      return extraStrips[laneId]!;
    }
    let s = extraLaneStrips.get(laneId);
    if (!s) {
      s = new ChannelStrip(deps.ctx, deps.master, deps.fx);
      extraLaneStrips.set(laneId, s);
    }
    return s;
  };

  const stripFor = (t: string): ChannelStrip => {
    if (t in deps.drums.channels) {
      const ch = deps.drums.channels[t as DrumVoice];
      if (ch) return ch;
    }
    const res = resources.get(t);
    if (res) return res.strip;
    if (t === 'bass')    return resources.get(LANE_ID_BASS)!.strip;
    if (t === 'poly')    return resources.get(LANE_ID_POLY)!.strip;
    if (t === 'drumBus') return resources.get(LANE_ID_DRUMS)!.strip;
    if (deps.extraIds.includes(t)) {
      ensureExtraPoly(t);
      return extraStrips[t]!;
    }
    return ensureLaneStrip(t);
  };

  const ensureLaneVoice = (laneId: string, engineId: string): Voice | null => {
    const cached = laneVoices.get(laneId);
    if (cached) return cached;
    const engine = getEngine(engineId);
    if (!engine) return null;
    const strip = ensureLaneStrip(laneId);
    setCurrentLaneForVoice(laneId);
    const voice = engine.createVoice(deps.ctx, strip.input);
    setCurrentLaneForVoice(null);
    laneVoices.set(laneId, voice);
    return voice;
  };

  const ensureLaneResource = (laneId: string, engineId: string): void => {
    if (resources.get(laneId)) return;
    const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx);
    const engine = createEngineInstance(engineId);
    if (!engine) return;
    if (engineId === 'subtractive') {
      const p = new PolySynth(deps.ctx, strip.input);
      p.bpm = deps.getBpm();
      (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
    }
    if (engineId === 'drums-machine') {
      (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
    }
    resources.set(laneId, { strip, engine });
  };

  const getLaneEngineInstance = (laneId: string): SynthEngine | null =>
    resources.get(laneId)?.engine ?? null;

  return {
    resources, extraStrips, extraPolys,
    stripFor, ensureExtraPoly, ensureLaneStrip, ensureLaneVoice, ensureLaneResource,
    getLaneEngineInstance, slugFromExtraId,
  };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/lane-allocator.ts` with the contents above.

- [ ] **Step 2: Update main.ts — instantiate the allocator**

After `mainSubtractive` is in scope from `audio`, add:
```ts
import { createLaneAllocator } from './app/lane-allocator';

const lanes = createLaneAllocator({
  ctx, master, fx,
  bassStrip, polyStrip, drumBusStrip,
  drums, synth, polysynth,
  tb303Engine,
  mainSubtractive,
  drumsEngineInstance,
  getBpm: () => seq.bpm,
  extraIds: EXTRA_IDS,
});
const { resources: laneResources, extraStrips, extraPolys,
        stripFor, ensureExtraPoly, ensureLaneStrip, ensureLaneVoice,
        ensureLaneResource, getLaneEngineInstance, slugFromExtraId } = lanes;
```

The local aliases preserve the existing names so every call site downstream works unchanged.

- [ ] **Step 3: Delete the inlined functions from main.ts**

Remove:
- The Phase A `laneResources` seeding (`const laneResources = new LaneResourceMap(); ... resources.set(LANE_ID_POLY, ...)`).
- `const extraStrips = ...`, `const extraPolys = ...`, `const extraLaneStrips = ...`, `const laneVoices = ...`.
- `slugFromExtraId`, `ensureExtraPoly`, `stripFor`, `activeTracks` (untouched — stays), `ensureLaneStrip`, `ensureLaneVoice`, `ensureLaneResource`.
- The standalone helper `function activeTracks() { ... }` stays.

`slugFromExtraId` is unused outside the allocator now — verify with grep before deleting the alias destructure line if you want it gone.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

In browser: play, confirm bass/poly/drums all sound. Add a Sub 2 lane via session UI; confirm Sub 1's cutoff doesn't move Sub 2's, and vice versa.

- [ ] **Step 6: Commit**

```bash
git add src/app/lane-allocator.ts src/main.ts
git commit -m "refactor(main): extract createLaneAllocator into src/app/lane-allocator.ts"
```

---

## Task 6: Extract `src/app/automation-recording.ts`

**Files:**
- Create: `src/app/automation-recording.ts`
- Modify: [src/main.ts](src/main.ts) — `automationRegistry`, `automationRecording`, `registerKnob`, `recordAutomationValue` (~221-291) and the REC button wiring (~771-776).

**Module contract.**

```ts
// src/app/automation-recording.ts
import type { Sequencer } from '../core/sequencer';
import type { KnobHandle } from '../core/knob';
import { AUTOMATION_SUB_RES, type AutomationLane } from '../core/pattern';
import { clamp01 } from '../automation/automation-painter';

export interface AutomationRecorderDeps {
  seq: Sequencer;
  getAutoAbsSubIdx(): number;
  onLaneAdded(): void;
}

export interface AutomationRecorder {
  registry: Map<string, KnobHandle>;
  registerKnob(k: KnobHandle): void;
  recordValue(paramId: string, value: number): void;
  setRecording(on: boolean): void;
  isRecording(): boolean;
  wireRecButton(btn: HTMLButtonElement): void;
}

export function createAutomationRecorder(deps: AutomationRecorderDeps): AutomationRecorder {
  const registry = new Map<string, KnobHandle>();
  let recording = false;

  const recordValue = (paramId: string, value: number) => {
    const entry = registry.get(paramId);
    if (!entry) return;
    const range = entry.meta.max - entry.meta.min;
    if (range === 0) return;
    const norm = clamp01((value - entry.meta.min) / range);
    let lane = deps.seq.pattern.automation.find((l: AutomationLane) => l.paramId === paramId);
    if (!lane) {
      const lengthBars = Math.max(1, deps.seq.length / 16);
      const total = lengthBars * 16 * AUTOMATION_SUB_RES;
      lane = {
        paramId, enabled: true, stepped: false, lengthBars,
        values: Array.from({ length: total }, () => norm),
      };
      deps.seq.pattern.automation.push(lane);
      deps.onLaneAdded();
    }
    const idx = deps.getAutoAbsSubIdx() % lane.values.length;
    lane.values[idx] = norm;
    if (idx > 0) lane.values[idx - 1] = (lane.values[idx - 1] + norm) / 2;
    if (idx + 1 < lane.values.length) lane.values[idx + 1] = (lane.values[idx + 1] + norm) / 2;
  };

  return {
    registry,
    registerKnob(k: KnobHandle) {
      if (!k.meta.id) return;
      registry.set(k.meta.id, k);
      k.onValueChanged = (v, fromUser) => {
        if (fromUser && recording && deps.seq.isPlaying()) {
          recordValue(k.meta.id!, v);
        }
      };
    },
    recordValue,
    setRecording(on: boolean) { recording = on; },
    isRecording: () => recording,
    wireRecButton(btn: HTMLButtonElement) {
      btn.addEventListener('click', () => {
        recording = !recording;
        btn.classList.toggle('armed', recording);
        btn.textContent = recording ? '● REC ON' : '● REC';
      });
    },
  };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/automation-recording.ts` with the contents above.

- [ ] **Step 2: Update main.ts — instantiate recorder**

After `seq` is in scope, add:
```ts
import { createAutomationRecorder } from './app/automation-recording';

const automation = createAutomationRecorder({
  seq,
  getAutoAbsSubIdx,
  onLaneAdded: () => renderLanes(),
});
const automationRegistry = automation.registry;
const registerKnob = (k: KnobHandle) => automation.registerKnob(k);
```

Note: `renderLanes` is the late-bound wrapper (assigned in the boot section). At the time `automation` is constructed, the wrapper closure still works because it reads the *current* value of `renderLanes` at call time — `onLaneAdded` fires only when user records, which is after boot.

Delete the inline `automationRegistry`, `automationRecording`, `registerKnob`, `recordAutomationValue`.

- [ ] **Step 3: Replace REC button wiring**

Find the existing `recBtn.addEventListener('click', ...)` block and the `automationRecording` references. Replace with:
```ts
const recBtn = $<HTMLButtonElement>('rec');
automation.wireRecButton(recBtn);
```

- [ ] **Step 4: Update read sites of `automationRecording`**

Search for the variable `automationRecording`. The only writer was the REC button (now in the module); readers (if any survive) become `automation.isRecording()`.

```bash
grep -n 'automationRecording' src/main.ts
```

Should return zero matches after this step.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
```

Play. Arm REC. Drag a bass cutoff knob. Confirm a new automation lane appears in the Automation tab and its values reflect the drag.

- [ ] **Step 7: Commit**

```bash
git add src/app/automation-recording.ts src/main.ts
git commit -m "refactor(main): extract createAutomationRecorder into src/app/automation-recording.ts"
```

---

## Task 7: Extract `src/app/trigger-dispatch.ts`

**Files:**
- Create: `src/app/trigger-dispatch.ts`
- Modify: [src/main.ts](src/main.ts) — `triggerForLane` block (~649-694).

**Module contract.**

```ts
// src/app/trigger-dispatch.ts
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { scheduleArpForNote } from '../arp/arp';
import { GM_DRUM_MAP } from '../engines/drum-gm-map';
import type { LaneResourceMap } from '../core/lane-resources';
import type { DrumMachine } from '../core/drums';
import type { Sequencer } from '../core/sequencer';
import type { arp as ArpSingleton } from '../arp/arp-ui';

export type TriggerForLane = (
  laneId: string, note: number, time: number, gate: number,
  accent: boolean, slidingIn?: boolean,
) => void;

export interface TriggerDispatchDeps {
  ctx: AudioContext;
  laneResources: LaneResourceMap;
  drums: DrumMachine;
  arp: typeof ArpSingleton;
  seq: Sequencer;
}

export function createTriggerForLane(deps: TriggerDispatchDeps): TriggerForLane {
  return (laneId, note, time, gate, accent, slidingIn = false) => {
    const res = deps.laneResources.get(laneId);
    if (!res) return;
    const engineId = res.engine.id;

    const fire = (m: number, t: number, g: number, a: boolean, sl: boolean) => {
      if (engineId === 'tb303') {
        setCurrentLaneForVoice(laneId);
        const v = res.engine.createVoice(deps.ctx, res.strip.input);
        setCurrentLaneForVoice(null);
        v.trigger(m, t, { gateDuration: g, accent: a, slide: sl });
        return;
      }
      if (engineId === 'drums-machine') {
        const dv = GM_DRUM_MAP[m];
        if (dv) deps.drums.trigger(dv, t, a);
        return;
      }
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(deps.ctx, res.strip.input);
      setCurrentLaneForVoice(null);
      v.trigger(m, t, { gateDuration: g, accent: a });
    };

    if (deps.arp.enabled && deps.arp.scope.includes(laneId) && engineId !== 'drums-machine') {
      scheduleArpForNote(
        (m, t, g, a) => fire(m, t, g, a, false),
        deps.arp, deps.seq.bpm, note, time, gate, accent,
      );
      return;
    }
    fire(note, time, gate, accent, slidingIn);
  };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/trigger-dispatch.ts` with the contents above.

- [ ] **Step 2: Update main.ts**

After `arp` is imported (already done), and after `lanes`/`drums`/`ctx`/`seq` are in scope, replace the inline `const triggerForLane = (...) => { ... }` block with:
```ts
import { createTriggerForLane } from './app/trigger-dispatch';

const triggerForLane = createTriggerForLane({
  ctx, laneResources, drums, arp, seq,
});
```

Also delete the standalone helper `const midiToFreqLocal = (m: number) => ...` if it is unused — it appears next to `triggerForLane` and is not referenced elsewhere (verify with grep).

```bash
grep -n 'midiToFreqLocal' src/main.ts
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Play. Confirm bass / poly / drum bus all trigger. Enable arp on the bass lane; confirm it arpeggiates and that drum lane stays unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/app/trigger-dispatch.ts src/main.ts
git commit -m "refactor(main): extract createTriggerForLane into src/app/trigger-dispatch.ts"
```

---

## Task 8: Extract `src/app/knob-mounting.ts`

**Files:**
- Create: `src/app/knob-mounting.ts`
- Modify: [src/main.ts](src/main.ts) — `wireLaneKnobs`, `refreshKnobsFromSynth`, `refreshLaneKnobs`, `mountSubtractiveLaneKnobs`, `mountDrumMasterLaneKnobs`, and the late-bound `_sessionStateForKnobs` plumbing.

**Module contract.**

```ts
// src/app/knob-mounting.ts
import { wireEngineParams } from '../engines/engine-ui';
import { wireDrumMasterUI } from '../core/drum-master-ui';
import { tb303Engine } from '../engines/tb303';
import { LANE_ID_BASS } from '../core/lane-ids';
import type { KnobHandle } from '../core/knob';
import type { SynthEngine, EngineUIContext } from '../engines/engine-types';
import type { LaneResourceMap } from '../core/lane-resources';
import type { TB303 } from '../core/synth';
import type { SessionState } from '../session/session';

export interface KnobMounterDeps {
  registerKnob(k: KnobHandle): void;
  registry: Map<string, KnobHandle>;
  laneResources: LaneResourceMap;
  synth: TB303;
  fmtPct(v: number): string;
  fmtDb(v: number): string;
  getSessionState(): SessionState | undefined;
  getLaneDisplayName(id: string): string | undefined;
}

export interface LaneWiringOpts {
  laneId: string;
  engine: SynthEngine;
  parent: HTMLElement;
  formatter?: (id: string, v: number) => string;
}

export interface KnobMounter {
  wireLaneKnobs(opts: LaneWiringOpts): void;
  mountSubtractiveLaneKnobs(laneId: string): void;
  mountDrumMasterLaneKnobs(laneId: string): void;
  refreshKnobsFromSynth(): void;
  refreshLaneKnobs(laneId: string, engine: SynthEngine): void;
}

export function createKnobMounter(deps: KnobMounterDeps): KnobMounter {
  const buildCtx = (laneId: string): EngineUIContext => ({
    laneId,
    registerKnob: deps.registerKnob,
    registry: deps.registry as unknown as Map<string, unknown>,
    lookupLaneDisplayName: deps.getLaneDisplayName,
    sessionState: deps.getSessionState(),
  });

  const wireLaneKnobs = (opts: LaneWiringOpts) => {
    wireEngineParams(opts.engine, buildCtx(opts.laneId), opts.parent, { formatter: opts.formatter });
  };

  const mountSubtractiveLaneKnobs = (laneId: string) => {
    const sectionMap: Array<[string, string]> = [
      ['osc1.',   'poly-osc1-knobs'],
      ['osc2.',   'poly-osc2-knobs'],
      ['sub.',    'poly-sub-knobs'],
      ['noise.',  'poly-noise-knobs'],
      ['filter.', 'poly-filter-knobs'],
      ['amp.',    'poly-amp-knobs'],
      ['master.', 'poly-master-knobs'],
    ];
    const engine = deps.laneResources.get(laneId)?.engine;
    if (!engine) return;
    const ctx = buildCtx(laneId);
    for (const [prefix, divId] of sectionMap) {
      const parent = document.getElementById(divId);
      if (!parent) continue;
      parent.innerHTML = '';
      wireEngineParams(engine, ctx, parent, { filter: (id) => id.startsWith(prefix) });
    }
  };

  const mountDrumMasterLaneKnobs = (laneId: string) => {
    const strip = deps.laneResources.get(laneId)?.strip;
    if (!strip) return;
    wireDrumMasterUI({
      laneId, drumBusStrip: strip,
      registerKnob: deps.registerKnob,
      fmtPct: deps.fmtPct,
      fmtDb: deps.fmtDb,
    });
  };

  const refreshKnobsFromSynth = () => {
    const liveValue = (specId: string): number | null => {
      switch (specId) {
        case 'filter.cutoff':    return deps.synth.params.cutoff;
        case 'filter.resonance': return deps.synth.params.resonance;
        case 'env.amount':       return deps.synth.params.envMod;
        case 'env.decay':        return deps.synth.params.decay;
        case 'env.accent':       return deps.synth.params.accent;
        case 'osc.wave':         return deps.synth.params.wave === 'square' ? 1 : 0;
      }
      return null;
    };
    for (const spec of tb303Engine.params) {
      const v = liveValue(spec.id);
      if (v == null) continue;
      deps.registry.get(`${LANE_ID_BASS}.${spec.id}`)?.setValue(v);
    }
  };

  const refreshLaneKnobs = (laneId: string, engine: SynthEngine) => {
    for (const spec of engine.params) {
      const handle = deps.registry.get(`${laneId}.${spec.id}`);
      handle?.setValue(engine.getBaseValue(spec.id));
    }
  };

  return {
    wireLaneKnobs, mountSubtractiveLaneKnobs, mountDrumMasterLaneKnobs,
    refreshKnobsFromSynth, refreshLaneKnobs,
  };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/knob-mounting.ts` with the contents above.

- [ ] **Step 2: Update main.ts — instantiate mounter**

After `automation` and `lanes` are in scope, add:
```ts
import { createKnobMounter } from './app/knob-mounting';

const knobs = createKnobMounter({
  registerKnob,
  registry: automationRegistry,
  laneResources,
  synth,
  fmtPct, fmtDb,
  getSessionState: () => sessionHost?.state,
  getLaneDisplayName: (id) => sessionHost?.state.lanes.find((l) => l.id === id)?.name,
});

const wireLaneKnobs = knobs.wireLaneKnobs;
const mountSubtractiveLaneKnobs = knobs.mountSubtractiveLaneKnobs;
const mountDrumMasterLaneKnobs = knobs.mountDrumMasterLaneKnobs;
const refreshKnobsFromSynth = knobs.refreshKnobsFromSynth;
const refreshLaneKnobs = knobs.refreshLaneKnobs;
```

Note: `sessionHost` is declared later (still `const`), but the deps use lazy getters, so the late-binding holds. The first call to `mountSubtractiveLaneKnobs` is *before* sessionHost exists (the boot block does `mountSubtractiveLaneKnobs(LANE_ID_POLY)` early) — `getSessionState()` returns `undefined` then, matching today's behavior (the existing code reads `_sessionStateForKnobs` which is also `undefined` at that point).

- [ ] **Step 3: Delete the inlined helpers**

Remove:
- `let _sessionStateForKnobs: ... | undefined;`
- `interface LaneWiringDeps { ... }` (now `LaneWiringOpts` in the module).
- `function wireLaneKnobs(deps: LaneWiringDeps) { ... }`.
- `function refreshKnobsFromSynth() { ... }`.
- `function refreshLaneKnobs(laneId, engine) { ... }`.
- `function mountSubtractiveLaneKnobs(laneId) { ... }`.
- `function mountDrumMasterLaneKnobs(laneId) { ... }`.

Keep the `_sessionStateForKnobs = sessionHost.state;` assignment? No — delete it. The mounter reads via `getSessionState()` on every call, so it always sees the live state.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

Confirm: knobs render under each section (OSC1/OSC2/SUB/NOISE/FILTER/AMP/MASTER). Drag a bass cutoff knob. Switch session lane to Sub 2, drag cutoff there — Sub 1's value must not change. Switch to a drums lane — the drum-master strip mounts.

- [ ] **Step 6: Commit**

```bash
git add src/app/knob-mounting.ts src/main.ts
git commit -m "refactor(main): extract createKnobMounter into src/app/knob-mounting.ts"
```

---

## Task 9: Extract `src/app/lane-host-wiring.ts`

**Files:**
- Create: `src/app/lane-host-wiring.ts`
- Modify: [src/main.ts](src/main.ts) — the `_lehState`, `_lehDeps`, `_lookupEngineIdFn`, and `getLaneEngineId` / `setActiveEngineLane` wrappers (~366-391).

**Module contract.**

```ts
// src/app/lane-host-wiring.ts
import * as leh from '../engines/lane-engine-host';
import type { LaneEngineHostState } from '../engines/lane-engine-host';

export interface LaneHostDeps {
  // Exposed lazily because some are declared after createLaneHost is called.
  getSeq(): import('../core/sequencer').Sequencer;
  getBank(): import('../core/pattern').PatternBank;
  getEngineSel(): HTMLSelectElement;
  rebuildEngineParamUI: (laneId: string) => void;
  getLaneLabels(): Record<string, string>;
}

export interface LaneHost {
  state: LaneEngineHostState;
  getLaneEngineId(laneId: string): string;
  setActiveEngineLane(laneId: string): void;
  setLookupEngineId(fn: (laneId: string) => string): void;
}

export function createLaneHost(deps: LaneHostDeps): LaneHost {
  const state = leh.createLaneEngineState();
  let lookup: (laneId: string) => string = () => 'subtractive';

  const hostDeps: import('../engines/lane-engine-host').LaneEngineHostDeps = {
    get seq() { return deps.getSeq(); },
    get bank() { return deps.getBank(); },
    get engineSel() { return deps.getEngineSel(); },
    get rebuildEngineParamUI() { return deps.rebuildEngineParamUI; },
    get laneLabels() { return deps.getLaneLabels(); },
    lookupEngineId: (laneId) => lookup(laneId),
  };

  return {
    state,
    getLaneEngineId: (laneId) => leh.getLaneEngineId(state, hostDeps, laneId),
    setActiveEngineLane: (laneId) => leh.setActiveEngineLane(state, hostDeps, laneId),
    setLookupEngineId: (fn) => { lookup = fn; },
  };
}
```

- [ ] **Step 1: Create the new file**

Create `src/app/lane-host-wiring.ts` with the contents above.

- [ ] **Step 2: Update main.ts — instantiate**

Find the existing `_lehState`/`_lehDeps`/`_lookupEngineIdFn` block. Replace with:
```ts
import { createLaneHost } from './app/lane-host-wiring';
import { rebuildEngineParamUI } from './engines/engine-selector-ui';

const laneHost = createLaneHost({
  getSeq: () => seq,
  getBank: () => bank,
  getEngineSel: () => engineSel,
  rebuildEngineParamUI,
  getLaneLabels: () => LANE_LABELS as Record<string, string>,
});

const getLaneEngineId = (laneId: string) => laneHost.getLaneEngineId(laneId);
const setActiveEngineLane = (laneId: string) => laneHost.setActiveEngineLane(laneId);
const _lehState = laneHost.state; // kept for engineSelectorDeps below
```

After `sessionHost` is constructed, replace the existing `_lookupEngineIdFn = (laneId) => ...` assignment with:
```ts
laneHost.setLookupEngineId((laneId) =>
  sessionHost.state.lanes.find((l) => l.id === laneId)?.engineId ?? 'subtractive');
```

The boot fallback (`if (laneId === 'subtractive-1') return seq.pattern.engineId ?? 'subtractive'`) is dropped — by the time anyone calls `getLaneEngineId`, `setLookupEngineId` has run. Verify by grep: nothing reads `getLaneEngineId` before `sessionHost.init()` in main.ts.

```bash
grep -n 'getLaneEngineId' src/main.ts
```

If something does read it earlier, keep the boot fallback inside the module instead.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 4: Commit**

```bash
git add src/app/lane-host-wiring.ts src/main.ts
git commit -m "refactor(main): extract createLaneHost into src/app/lane-host-wiring.ts"
```

---

## Task 10: Final cleanup

**Files:**
- Modify: [src/main.ts](src/main.ts).

**What's left.** After tasks 1–9, main.ts contains: imports, constants, DOM refs, populate selects, bass mode helpers, tab switching, the eight handle constructions, `SessionHost` construction with its giant deps object, all `wireXxx` calls, `launchSceneById`, the boot chain, and save manager wiring. Goal of this task: regroup, drop orphans, get a sensible top-to-bottom narrative.

- [ ] **Step 1: Reorder main.ts into clear sections**

Target ordering (top to bottom):
1. Imports.
2. Top-level constants + helpers (`fmtPct`, `EXTRA_IDS`, `TrackId`, `ALL_TRACKS`, `LANE_LABELS`, `$`, `$$`, `NOTE_NAMES`, `midiLabel`, `activeTracks`).
3. Preset loader kickoff (`presetsLoaded`).
4. Handles: `audio`, `lanes`, `automation`, `bpmBroadcast`, `muteSolo`, `triggerForLane`, `knobs`, `laneHost`.
5. Pattern state (`seq`, `bank`).
6. DOM refs.
7. Populate kit/root selects.
8. UI listeners (bpm/swing/vol/wave/bars/kit) — each is a one-liner now.
9. Bass-mode buttons + tab switching.
10. `mixerDeps` + `activeEnginePrefix` definition.
11. `SessionHost` construction.
12. After `sessionHost` is live: `laneHost.setLookupEngineId(...)`, `automation.wireRecButton(recBtn)`, `mountSubtractiveLaneKnobs(LANE_ID_POLY)`.
13. Deps blocks: `engineSelectorDeps`, `polySynthPresetsDeps`, `polyModeDeps`, `synthEditorDeps`, `arpUIDeps`, `fxUIDeps`, `transportDeps`, `automationTickDeps`.
14. `wireXxx` calls: `wireEngineSelector`, `wirePolyControls`, `wirePolyMode`, `wireFxUI`, `wireTransport`, `wireAutomationTab`, `wirePresetLibrary`, `wireSlotCopyPanel`, `wireCopyNotesPanel`, `wireMidiImportUI`, `wireRandomizeUI`, `wireDemoPicker`, `wireSaveManager`, `wireHistoryKeyboard`.
15. `setupInitialPattern`, `startAutomationTick`, `startVisualizer`.
16. Boot chain: `presetsLoaded.then(fetchDemoSession(...))`, `bootRecoveryLoad`.

Move blocks with the Edit tool. Do NOT introduce new behavior or new constants in this step — just reorder.

- [ ] **Step 2: Drop orphan helpers**

After reordering, check for unused symbols:
```bash
grep -n 'function \|const ' src/main.ts | head -50
```

Any local helper still defined but no longer referenced (likely candidates: `flashButton` if no `wireXxx` still consumes it, `midiToFreqLocal`, leftover `_*` deferred lets) — delete it. Verify with `grep` before deleting.

- [ ] **Step 3: Run full verification**

```bash
npx tsc --noEmit
npm run test:fast
```

- [ ] **Step 4: Manual smoke + full suite**

```bash
npm run dev   # smoke
# Confirm: play, bass/poly/drums all trigger; REC arms and records; lane swap mounts the right knobs; demo loads from JSON; save+reload restores state.
# Stop dev server, then:
npm test      # full suite, including DSP renders and e2e
```

If `npm test` passes (325+ unit tests + e2e green), the refactor is complete.

- [ ] **Step 5: Confirm final size**

```bash
wc -l src/main.ts
```

Expect ~250–300 lines.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "refactor(main): reorder boot into handles → deps → wireXxx → boot chain"
```

---

## Final handoff

After Task 10 lands and `npm test` is green:

```bash
git log --oneline worktree-refactor-main-ts ^feat/undo-global
```

Should show 10 commits (one per task). At that point the worktree branch is ready to merge back to `feat/undo-global` per the user's instruction.

---

## Self-review notes

- **Spec coverage:** All 8 modules in the spec map to tasks 2–9. Phase 0 (dead-code cleanup) → Task 1. Phase 9 (final cleanup) → Task 10. Every spec phase has a task.
- **Type consistency:** `LaneAllocator.resources` is the `LaneResourceMap` and is destructured as `laneResources` in main.ts; later modules (`AutomationRecorder` deps, `KnobMounter` deps, `TriggerForLane` deps, `LaneHost` deps) all consume `laneResources` via the same alias. `automation.registry` is destructured as `automationRegistry` and used by knob-mounter and engineSelectorDeps. `knobs.mountSubtractiveLaneKnobs` matches the signature in `engineSelectorDeps.remountSubtractiveLaneKnobs`. `automation.wireRecButton(recBtn)` matches the module export.
- **Placeholders:** None. Every code block is concrete and self-contained.
- **Manual smoke is documented** at tasks 5, 6, 7, 8, 10 — the steps say exactly what to click and what to observe.
- **The `getBpm()` getter** in lane-allocator deps reads `seq.bpm` at call time, not at construction — so extra polys get the *current* tempo, not the boot tempo.
