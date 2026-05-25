# Engine System Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the plugin architecture foundation (interfaces, registry, sequencer broadcast, engine selector UI) so that future synthesis engines can be added by implementing an interface and calling `register()`.

**Architecture:** A `SynthEngine` interface + global registry pattern. The existing PolySynth behavior is wrapped as a "subtractive" engine (the default). The sequencer broadcasts `onStep` to all registered engine sequencers. The UI gets an engine selector dropdown that swaps the parameter panel.

**Tech Stack:** TypeScript, Web Audio API, Vite (no new dependencies)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/engines/engine-types.ts` | All type interfaces (SynthEngine, Voice, EngineSequencer, ParamDef) |
| Create | `src/engines/registry.ts` | Engine registry (Map + register/get/list helpers) |
| Create | `src/engines/subtractive.ts` | Wraps existing PolySynth as the default engine |
| Modify | `src/sequencer.ts` | Add `onStep` broadcast to registered engine sequencers |
| Modify | `src/pattern.ts` | Add `engineId` + `engineStepData` to PatternData |
| Modify | `src/main.ts` | Add engine selector dropdown, swap param panel on change |

---

### Task 1: Create engine type interfaces

**Files:**
- Create: `src/engines/engine-types.ts`

- [ ] **Step 1: Create the types file with all interfaces**

```typescript
// src/engines/engine-types.ts

export interface ParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  curve?: 'linear' | 'exponential' | 'log';
  unit?: string;
}

export interface Voice {
  trigger(midi: number, time: number, options: VoiceTriggerOptions): void;
  release(time: number): void;
  connect(dest: AudioNode): void;
  dispose(): void;
}

export interface VoiceTriggerOptions {
  accent?: boolean;
  slide?: boolean;
  velocity?: number;
  gateDuration: number;
}

export interface EngineSequencer {
  getStepAt(index: number): unknown;
  setLength(n: number): void;
  highlight(step: number): void;
  serialize(): unknown;
  deserialize(data: unknown): void;
  dispose(): void;
}

export interface SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type: 'polyhost' | 'tab';
  readonly polyphony: number | 'mono';
  readonly params: ParamDef[];
  createVoice(ctx: AudioContext, output: AudioNode): Voice;
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer;
  buildParamUI(container: HTMLElement): void;
  dispose(): void;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: No errors (new file, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/engines/engine-types.ts
git commit -m "feat: add SynthEngine plugin interface types"
```

---

### Task 2: Create the engine registry

**Files:**
- Create: `src/engines/registry.ts`

- [ ] **Step 1: Create registry with register/get/list functions**

```typescript
// src/engines/registry.ts

import type { SynthEngine } from './engine-types';

const engines = new Map<string, SynthEngine>();

export function registerEngine(engine: SynthEngine): void {
  if (engines.has(engine.id)) {
    console.warn(`Engine "${engine.id}" already registered, overwriting.`);
  }
  engines.set(engine.id, engine);
}

export function getEngine(id: string): SynthEngine | undefined {
  return engines.get(id);
}

export function listEngines(type?: 'polyhost' | 'tab'): SynthEngine[] {
  const all = Array.from(engines.values());
  return type ? all.filter((e) => e.type === type) : all;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/engines/registry.ts
git commit -m "feat: add engine registry (register/get/list)"
```

---

### Task 3: Create the subtractive engine (wrapping existing PolySynth)

**Files:**
- Create: `src/engines/subtractive.ts`

This engine wraps the existing `PolySynth` class as the default engine. It delegates `createVoice` to the PolySynth's existing `trigger()` method pattern. Since PolySynth currently creates per-note voice subgraphs inside `trigger()`, the Voice wrapper schedules the same way.

- [ ] **Step 1: Create the subtractive engine file**

```typescript
// src/engines/subtractive.ts

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef } from './engine-types';
import { registerEngine } from './registry';
import { PolySynth, POLY_DEFAULTS, type PolySynthParams } from '../polysynth';

class SubtractiveVoice implements Voice {
  constructor(
    private polysynth: PolySynth,
    private output: AudioNode,
  ) {}

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    this.polysynth.trigger(midi, time, options.gateDuration, options.accent ?? false);
  }

  release(_time: number): void {
    // PolySynth handles release internally via gateDuration scheduling
  }

  connect(_dest: AudioNode): void {
    // PolySynth already connected to destination in constructor
  }

  dispose(): void {
    // PolySynth voices self-cleanup after stopTime
  }
}

class SubtractiveSequencer implements EngineSequencer {
  getStepAt(_index: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_step: number): void {}
  serialize(): unknown { return null; }
  deserialize(_data: unknown): void {}
  dispose(): void {}
}

const SUBTRACTIVE_PARAMS: ParamDef[] = [
  { id: 'cutoff', label: 'Cutoff', min: 0, max: 1, default: POLY_DEFAULTS.filter.cutoff },
  { id: 'resonance', label: 'Resonance', min: 0, max: 1, default: POLY_DEFAULTS.filter.resonance },
  { id: 'envAmount', label: 'Env Amount', min: 0, max: 1, default: POLY_DEFAULTS.filter.envAmount },
  { id: 'drive', label: 'Drive', min: 0, max: 1, default: POLY_DEFAULTS.filter.drive },
  { id: 'osc1Level', label: 'Osc 1', min: 0, max: 1, default: POLY_DEFAULTS.osc1.level },
  { id: 'osc2Level', label: 'Osc 2', min: 0, max: 1, default: POLY_DEFAULTS.osc2.level },
  { id: 'subLevel', label: 'Sub', min: 0, max: 1, default: POLY_DEFAULTS.sub.level },
  { id: 'noiseLevel', label: 'Noise', min: 0, max: 1, default: POLY_DEFAULTS.noise.level },
];

class SubtractiveEngine implements SynthEngine {
  readonly id = 'subtractive';
  readonly name = 'Subtractive';
  readonly type = 'polyhost' as const;
  readonly polyphony = 8;
  readonly params = SUBTRACTIVE_PARAMS;

  private polysynth: PolySynth | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.polysynth) {
      this.polysynth = new PolySynth(ctx, output);
    }
    return new SubtractiveVoice(this.polysynth, output);
  }

  getPolySynth(): PolySynth | null {
    return this.polysynth;
  }

  setPolySynth(ps: PolySynth): void {
    this.polysynth = ps;
  }

  buildSequencer(container: HTMLElement, _stepCount: number): EngineSequencer {
    // Subtractive uses the main poly sequencer (melody steps) — no custom sequencer needed
    return new SubtractiveSequencer();
  }

  buildParamUI(_container: HTMLElement): void {
    // For subtractive, main.ts already builds the poly param UI
    // This becomes relevant when other engines need their own panel
  }

  dispose(): void {
    this.polysynth = null;
  }
}

export const subtractiveEngine = new SubtractiveEngine();
registerEngine(subtractiveEngine);
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/engines/subtractive.ts
git commit -m "feat: wrap existing PolySynth as subtractive engine"
```

---

### Task 4: Add engine step data to PatternData

**Files:**
- Modify: `src/pattern.ts`

- [ ] **Step 1: Add engineId and engineStepData fields to PatternData**

In `src/pattern.ts`, add two fields to the `PatternData` interface after `automation`:

```typescript
export interface PatternData {
  length: number;
  bass: BassStep[];
  drums: Record<DrumVoice, DrumStep[]>;
  melody: PolyStep[];
  polyNotes: NoteEvent[];
  polyMode: PolyTrackMode;
  extraPolyTracks: PolyTrack[];
  automation: AutomationLane[];
  engineId: string;                    // NEW — which engine is active for the poly host
  engineStepData: unknown;             // NEW — engine-specific sequencer state (serialized)
}
```

- [ ] **Step 2: Update emptyPattern() to include the new fields**

In `emptyPattern()`, add defaults at the end of the return object:

```typescript
export function emptyPattern(length: number): PatternData {
  return {
    length,
    bass: Array.from({ length }, () => ({ on: false, note: 36, accent: false, slide: false })),
    drums: Object.fromEntries(
      DRUM_LANES.map((lane) => [
        lane,
        Array.from({ length }, () => ({ on: false, accent: false })),
      ]),
    ) as Record<DrumVoice, DrumStep[]>,
    melody: Array.from({ length }, () => ({ on: false, notes: [60], accent: false, tie: false })),
    polyNotes: [],
    polyMode: 'step',
    extraPolyTracks: [],
    automation: [],
    engineId: 'subtractive',
    engineStepData: null,
  };
}
```

- [ ] **Step 3: Update clonePattern() to copy the new fields**

In `clonePattern()`, add to the return object:

```typescript
engineId: p.engineId,
engineStepData: p.engineStepData ? JSON.parse(JSON.stringify(p.engineStepData)) : null,
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: No errors (existing code that constructs PatternData will error if it doesn't include the new fields — fix those in the next step if needed)

- [ ] **Step 5: Fix any remaining type errors**

If `PatternBank` or other code constructs `PatternData` objects directly, add the `engineId: 'subtractive', engineStepData: null` fields to those locations.

- [ ] **Step 6: Commit**

```bash
git add src/pattern.ts
git commit -m "feat: add engineId + engineStepData to PatternData"
```

---

### Task 5: Add onStep broadcast to the sequencer

**Files:**
- Modify: `src/sequencer.ts`

The sequencer needs to notify registered engine sequencers when a step fires, so each engine can trigger its own sounds.

- [ ] **Step 1: Add engine sequencer registration to Sequencer class**

At the top of the `Sequencer` class, add a list of registered engine sequencers and a registration method:

```typescript
import type { EngineSequencer } from './engines/engine-types';
```

Add after the existing class properties (after `private pendingPattern`):

```typescript
private engineSequencers: EngineSequencer[] = [];

registerEngineSequencer(seq: EngineSequencer): void {
  this.engineSequencers.push(seq);
}

unregisterEngineSequencer(seq: EngineSequencer): void {
  const idx = this.engineSequencers.indexOf(seq);
  if (idx >= 0) this.engineSequencers.splice(idx, 1);
}
```

- [ ] **Step 2: Broadcast step to engine sequencers in scheduleStep()**

At the end of the `scheduleStep()` method (after the `onStep` callback), add:

```typescript
for (const es of this.engineSequencers) {
  es.highlight(idx);
}
```

- [ ] **Step 3: Update setLength to notify engine sequencers**

At the end of the existing `setLength()` method, add:

```typescript
for (const es of this.engineSequencers) {
  es.setLength(n);
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/sequencer.ts
git commit -m "feat: sequencer broadcasts onStep to engine sequencers"
```

---

### Task 6: Add engine selector to the UI

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Import the engine registry and subtractive engine**

Add these imports at the top of `main.ts`:

```typescript
import { listEngines, getEngine } from './engines/registry';
import './engines/subtractive';  // side-effect: registers the subtractive engine
```

- [ ] **Step 2: Add a state variable for the current engine ID**

After the `const seq = new Sequencer(...)` line (~line 110), add:

```typescript
let currentEngineId = 'subtractive';
```

- [ ] **Step 3: Create the engine selector dropdown**

Find where the PolySynth section header is built in the DOM (search for the poly section heading). Add a `<select>` element for engine selection. The exact insertion point depends on how the poly section is structured. Add this helper function before the DOM building code:

```typescript
function buildEngineSelector(parent: HTMLElement): HTMLSelectElement {
  const select = document.createElement('select');
  select.id = 'engine-select';
  for (const engine of listEngines('polyhost')) {
    const opt = document.createElement('option');
    opt.value = engine.id;
    opt.textContent = engine.name;
    if (engine.id === currentEngineId) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    const prev = getEngine(currentEngineId);
    if (prev) prev.dispose();
    currentEngineId = select.value;
    seq.pattern.engineId = currentEngineId;
    // Future: swap param panel UI here
  });
  parent.appendChild(select);
  return select;
}
```

- [ ] **Step 4: Insert the selector into the poly section**

Find the poly section heading in the DOM-building code and call `buildEngineSelector()` on its parent/header element. The selector will initially show only "Subtractive" — future engines appear automatically when registered.

- [ ] **Step 5: Verify it typechecks and runs**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run dev`
Expected: App starts. The poly section shows an engine dropdown with "Subtractive" selected. Changing it (once more engines exist) will call dispose/swap. All existing functionality works unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat: add engine selector dropdown to PolySynth section"
```

---

### Task 7: Integration test — verify everything works together

**Files:**
- No new files — manual verification

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 2: Start dev server and verify**

Run: `npm run dev`

Verify in browser:
1. App loads without console errors
2. Play button works — bass, drums, and poly all sound normally
3. Engine selector appears in the PolySynth section with "Subtractive" option
4. Pattern slot switching works (A/B/C/D)
5. Randomize and clear still work
6. Automation lanes work
7. No audio glitches or orphan nodes

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Builds successfully with no errors

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: integration fixes for engine system"
```

---

## Summary

After completing all tasks, the codebase has:
- A clean `SynthEngine` interface that any future engine implements
- A global registry with `register()` / `get()` / `list()` helpers
- The existing PolySynth behavior wrapped as the default `subtractive` engine
- `PatternData` extended with `engineId` + `engineStepData` for per-slot engine state
- The sequencer broadcasting steps to registered engine sequencers
- A UI dropdown (currently showing only "Subtractive") ready for new engines

**Next phase:** Implement the Wavetable engine (`src/engines/wavetable.ts`) — it will implement `SynthEngine`, call `registerEngine()`, and immediately appear in the dropdown.
