# Unified Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TB-303 and DrumMachine first-class `SynthEngine` implementations, drop `lane.kind` special-casing, unify clip data to `NoteEvent[]`, and consolidate Classic + Session through one engine-driven trigger path.

**Architecture:** Wrap the existing `TB303` and `DrumMachine` classes in `SynthEngine` adapters (no rewrite of their internals). Extend the `SynthEngine` interface with `editor`, `presets`, `applyPreset`, and a narrowed `polyphony: 'mono' | 'poly'`. Drum routing uses a General-MIDI drum map. Each phase keeps `npx tsc --noEmit` clean and leaves the running app playable.

**Tech Stack:** TypeScript strict, Web Audio API, Vite. No test harness — verification is `npx tsc --noEmit` + manual smoke test in the browser (`npm run dev` → http://localhost:5173).

**Spec:** [docs/superpowers/specs/2026-05-26-unified-engines-design.md](../specs/2026-05-26-unified-engines-design.md)

---

## File map

| File | Status | Purpose |
|---|---|---|
| `src/engines/engine-types.ts` | modify | Extend `SynthEngine` with `editor`, `presets`, `applyPreset`; narrow `polyphony` |
| `src/engines/subtractive.ts` | modify | Satisfy new interface fields |
| `src/engines/wavetable.ts` | modify | Satisfy new interface fields |
| `src/engines/fm.ts` | modify | Satisfy new interface fields |
| `src/engines/karplus.ts` | modify | Satisfy new interface fields |
| `src/engines/tb303.ts` | create | `TB303Engine` wrapping `src/core/synth.ts` |
| `src/engines/drums-engine.ts` | create | `DrumsEngine` wrapping `src/core/drums.ts` |
| `src/engines/drum-gm-map.ts` | create | `GM_DRUM_MAP` + `VOICE_MIDI` constants |
| `src/core/notes.ts` | modify | Add `drumStepsToNotes`, `drumLaneToNotes` |
| `src/session/clip-editors/clip-editor-drum-grid.ts` | create | New unified drum grid editor |
| `src/session/clip-editors/clip-editor-router.ts` | modify | Route by `engine.editor` |
| `src/session/session.ts` | modify | Unified `clip.notes`, `lane.engineId`, drop `kind`/`expanded` |
| `src/session/session-migration.ts` | modify | `migrateClip` + updated import |
| `src/session/session-host.ts` | modify | `onAddLane(engineId)` callbacks + new toolbar wiring |
| `src/session/session-step-scheduler.ts` | modify | Engine-driven dispatch (one path) |
| `src/session/session-ui.ts` | modify | Drop drum-bus expand toggle |
| `src/main.ts` | modify | Engine-driven Classic triggers + remove old singletons paths |
| `src/core/sequencer.ts` | modify | Per-lane engine voice dispatch for Classic |
| `session.html`, `index.html` | modify | New toolbar buttons; remove 303/Drums pages in Phase 7 |
| `src/session/clip-editors/clip-editor-drum-bus.ts` | delete | Phase 7 |
| `src/session/clip-editors/clip-editor-drum-lane.ts` | delete | Phase 7 |
| `src/classic/bass-grid.ts` | delete | Phase 7 |
| `src/classic/drum-cells.ts` | delete | Phase 7 |

---

## Verification pattern

Every task ends with these two checks (no test framework exists):

- **Typecheck:** `npx tsc --noEmit` → expected: no output (clean).
- **Smoke test:** specific steps in browser at `http://localhost:5173` (Classic) or `http://localhost:5173/session.html` (Session). Each task lists what to look for.

---

# Phase 1 — Foundation

Extend the engine interface and adjust the four existing engines to satisfy the new fields. After this phase, all engines have `editor` and `presets`, but nothing uses them yet.

## Task 1: Extend `SynthEngine` interface

**Files:**
- Modify: `src/engines/engine-types.ts`

- [ ] **Step 1: Add `EnginePreset` type and extend `SynthEngine`**

Replace the contents of `src/engines/engine-types.ts` with:

```ts
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

export interface EngineUIContext {
  laneId: string;
  idPrefix: string;
  registerKnob: (k: unknown) => void;
}

export interface EnginePreset {
  name: string;
  params: Record<string, number>;
}

export interface SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type: 'polyhost' | 'tab';
  readonly polyphony: 'mono' | 'poly';
  readonly editor: 'piano-roll' | 'drum-grid';
  readonly params: ParamDef[];
  readonly presets: EnginePreset[];
  createVoice(ctx: AudioContext, output: AudioNode): Voice;
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer;
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void;
  applyPreset(name: string): void;
  randomize?(): void;
  dispose(): void;
}
```

- [ ] **Step 2: Typecheck (expected: errors in 4 engine files)**

Run: `npx tsc --noEmit`
Expected: errors in `subtractive.ts`, `wavetable.ts`, `fm.ts`, `karplus.ts` complaining about missing `editor`, `presets`, `applyPreset`, wrong `polyphony` type. The next tasks fix each one.

- [ ] **Step 3: Commit**

```bash
git add src/engines/engine-types.ts
git commit -m "feat(engines): extend SynthEngine with editor/presets/applyPreset

Narrows polyphony to 'mono' | 'poly'. Existing engines will fail
typecheck until Phase 1 tasks 2-5 update each one."
```

## Task 2: Update `subtractive` engine

**Files:**
- Modify: `src/engines/subtractive.ts`

- [ ] **Step 1: Adjust `SubtractiveEngine` class**

In `src/engines/subtractive.ts`, find the class declaration:

```ts
class SubtractiveEngine implements SynthEngine {
  readonly id = 'subtractive';
  readonly name = 'Subtractive';
  readonly type = 'polyhost' as const;
  readonly polyphony = 8;
  readonly params = SUBTRACTIVE_PARAMS;
```

Replace with:

```ts
class SubtractiveEngine implements SynthEngine {
  readonly id = 'subtractive';
  readonly name = 'Subtractive';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SUBTRACTIVE_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  applyPreset(_name: string): void {
    // Subtractive presets currently live in src/polysynth/poly-presets.ts and
    // are applied via the existing polysynth preset wiring. This engine-level
    // applyPreset is a no-op until that wiring moves here in a later phase.
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `wavetable.ts`, `fm.ts`, `karplus.ts` only. Subtractive should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/engines/subtractive.ts
git commit -m "feat(engines): subtractive satisfies extended SynthEngine"
```

## Task 3: Update `wavetable` engine

**Files:**
- Modify: `src/engines/wavetable.ts`

- [ ] **Step 1: Adjust `WavetableEngine` class fields**

In `src/engines/wavetable.ts`, find the line `readonly type = 'polyhost' as const;` and locate the surrounding class fields. Add directly below the existing readonly fields:

```ts
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  applyPreset(_name: string): void {}
```

If the existing class already has `readonly polyphony = <number>;`, replace it with `readonly polyphony = 'poly' as const;`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `fm.ts` and `karplus.ts` only.

- [ ] **Step 3: Commit**

```bash
git add src/engines/wavetable.ts
git commit -m "feat(engines): wavetable satisfies extended SynthEngine"
```

## Task 4: Update `fm` engine

**Files:**
- Modify: `src/engines/fm.ts`

- [ ] **Step 1: Adjust `FMEngine` class fields**

Same change as Task 3: locate `readonly type = 'polyhost' as const;`, add below:

```ts
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  applyPreset(_name: string): void {}
```

Replace any existing `readonly polyphony` field with the new one.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `karplus.ts` only.

- [ ] **Step 3: Commit**

```bash
git add src/engines/fm.ts
git commit -m "feat(engines): fm satisfies extended SynthEngine"
```

## Task 5: Update `karplus` engine

**Files:**
- Modify: `src/engines/karplus.ts`

- [ ] **Step 1: Adjust `KarplusEngine` class fields**

Same change as Task 3 — locate `readonly type = 'polyhost' as const;`, add below:

```ts
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  applyPreset(_name: string): void {}
```

Replace any existing `readonly polyphony` field with the new one.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Open http://localhost:5173. The app should boot cleanly with the Minimal Techno demo. Press Play — bass + drums + main poly all play normally. Open Session view, launch Scene 1 — still works. Engine selector dropdown shows the four engines as before.

- [ ] **Step 4: Commit**

```bash
git add src/engines/karplus.ts
git commit -m "feat(engines): karplus satisfies extended SynthEngine

Phase 1 complete: all four existing engines satisfy the extended
SynthEngine interface. The new editor/presets/applyPreset fields are
in place but not yet exercised."
```

---

# Phase 2 — TB303 as Engine

Add a `TB303Engine` that wraps the existing `TB303` class. After this phase, the engine appears in the registry but no lane uses it yet — the next phases hook it up.

## Task 6: Create `TB303Engine` skeleton

**Files:**
- Create: `src/engines/tb303.ts`

- [ ] **Step 1: Create the file with imports + class skeleton**

Create `src/engines/tb303.ts`:

```ts
// src/engines/tb303.ts
// Adapts the existing TB303 monosynth to the SynthEngine interface so it can
// be picked as a lane engine alongside subtractive/wavetable/fm/karplus.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext, EnginePreset, ParamDef,
} from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { TB303 } from '../core/synth';

const PARAMS: ParamDef[] = [
  { id: 'cutoff',    label: 'CUTOFF', min: 0, max: 1, default: 0.42 },
  { id: 'resonance', label: 'RES',    min: 0, max: 1, default: 0.55 },
  { id: 'envMod',    label: 'ENV',    min: 0, max: 1, default: 0.5  },
  { id: 'decay',     label: 'DECAY',  min: 0, max: 1, default: 0.4  },
  { id: 'accent',    label: 'ACCENT', min: 0, max: 1, default: 0.6  },
  { id: 'wave',      label: 'WAVE',   min: 0, max: 1, default: 0    },
];

// Acid bass presets — migrated from src/presets/presets.ts. Each preset
// only sets the params relevant to the TB-303; unspecified params keep
// their current value.
const TB303_PRESETS: EnginePreset[] = [
  { name: 'Acid Classic', params: { cutoff: 0.35, resonance: 0.70, envMod: 0.60, decay: 0.50, accent: 0.70, wave: 0 } },
  { name: 'Dub Sub',      params: { cutoff: 0.20, resonance: 0.40, envMod: 0.30, decay: 0.65, accent: 0.45, wave: 1 } },
  { name: 'Squelch',      params: { cutoff: 0.45, resonance: 0.85, envMod: 0.75, decay: 0.35, accent: 0.80, wave: 0 } },
];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

class TB303Voice implements Voice {
  constructor(private tb303: TB303) {}

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    this.tb303.trigger({
      freq: midiToFreq(midi),
      accent: !!opts.accent,
      slide: !!opts.slide,
      duration: opts.gateDuration,
    }, time);
  }

  release(_time: number): void {}
  connect(_dest: AudioNode): void {}
  dispose(): void {}
}

class TB303Sequencer implements EngineSequencer {
  getStepAt(_i: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_s: number): void {}
  serialize(): unknown { return null; }
  deserialize(_d: unknown): void {}
  dispose(): void {}
}

export class TB303Engine implements SynthEngine {
  readonly id = 'tb303';
  readonly name = 'TB-303';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'mono' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = PARAMS;
  readonly presets = TB303_PRESETS;

  // One TB303 hardware instance per (ctx, output) pair. Multiple lanes that
  // route to different output nodes each get their own monosynth (correct
  // for "multiple 303 lanes" use case).
  private instances = new WeakMap<AudioNode, TB303>();
  private lastInstance: TB303 | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    let tb = this.instances.get(output);
    if (!tb) {
      tb = new TB303(ctx, output);
      this.instances.set(output, tb);
    }
    this.lastInstance = tb;
    return new TB303Voice(tb);
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new TB303Sequencer();
  }

  buildParamUI(_container: HTMLElement, _ctx?: EngineUIContext): void {
    // The Classic 303 page already renders the TB303 knobs against the
    // singleton synth. Per-lane UI binding moves into this method in
    // Phase 7 when the dedicated TB-303 tab is dismantled.
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p || !this.lastInstance) return;
    const params = this.lastInstance.params as Record<string, number | string>;
    for (const [k, v] of Object.entries(p.params)) {
      if (k === 'wave') {
        params.wave = v < 0.5 ? 'sawtooth' : 'square';
      } else {
        params[k] = v;
      }
    }
  }

  dispose(): void {}
}

const tb303Engine = new TB303Engine();
registerEngine(tb303Engine);
registerEngineFactory('tb303', () => new TB303Engine());
```

- [ ] **Step 2: Import the new engine from main.ts so it's registered**

Open `src/main.ts`. Find the existing engine imports (near the top):

```ts
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
```

Add below them:

```ts
import './engines/tb303';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Open http://localhost:5173, switch to Session, click `⚙` on the **MAIN** lane to enter the synth editor, then in the engine dropdown verify "TB-303" now appears as an option. Don't select it (no lane wiring yet) — just confirm it shows up. Click Back to Session.

- [ ] **Step 5: Commit**

```bash
git add src/engines/tb303.ts src/main.ts
git commit -m "feat(engines): add TB303Engine

Wraps the existing TB303 monosynth from src/core/synth.ts in the
SynthEngine adapter. Mono with per-output WeakMap caching so multiple
lanes routed to different strips get independent monosynths. Slide
flows through VoiceTriggerOptions.slide. No lane uses it yet."
```

---

# Phase 3 — Drums as Engine

Add the General-MIDI drum map constants and a `DrumsEngine` that wraps the existing `DrumMachine`. Again, engine appears in registry but no lane uses it yet.

## Task 7: Create the GM drum map constants

**Files:**
- Create: `src/engines/drum-gm-map.ts`

- [ ] **Step 1: Create the file**

Create `src/engines/drum-gm-map.ts`:

```ts
// src/engines/drum-gm-map.ts
// General-MIDI drum map: which MIDI numbers play which DrumMachine voice.
// Used by DrumsEngine to route midi-based note events to drum voices.

import type { DrumVoice } from '../core/drums';

export const GM_DRUM_MAP: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  38: 'snare', 40: 'snare',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  39: 'clap',
  56: 'cowbell',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom',
  51: 'ride', 53: 'ride', 59: 'ride',
};

// Canonical MIDI for each voice — the value the drum-grid editor writes
// when the user toggles a cell on a given voice row.
export const VOICE_MIDI: Record<DrumVoice, number> = {
  kick: 36,
  snare: 38,
  closedHat: 42,
  openHat: 46,
  clap: 39,
  cowbell: 56,
  tom: 45,
  ride: 51,
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/engines/drum-gm-map.ts
git commit -m "feat(engines): add GM drum map + canonical voice midi"
```

## Task 8: Create `DrumsEngine`

**Files:**
- Create: `src/engines/drums-engine.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create the engine file**

Create `src/engines/drums-engine.ts`:

```ts
// src/engines/drums-engine.ts
// Adapts DrumMachine to the SynthEngine interface. Triggers are routed via
// the GM drum map so drum clips can use NoteEvent[] like every other engine.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext, EnginePreset, ParamDef,
} from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { DrumMachine } from '../core/drums';
import { FxBus } from '../core/fx';
import { GM_DRUM_MAP } from './drum-gm-map';

const PARAMS: ParamDef[] = [
  { id: 'master-gain', label: 'LEVEL', min: 0,   max: 1.5, default: 1 },
  { id: 'master-tune', label: 'TUNE',  min: -12, max: 12,  default: 0 },
];

// Drum presets = the existing KITS. Their full per-voice param shapes live
// on the DrumMachine itself; this engine-level preset just stores the kit
// id so applyPreset can call dm.setKit().
const DRUM_PRESETS: EnginePreset[] = [
  { name: '808',       params: { kitId: 0 } },
  { name: '909',       params: { kitId: 1 } },
  { name: 'Linn',      params: { kitId: 2 } },
  { name: 'Acoustic',  params: { kitId: 3 } },
];
// The actual presets list is regenerated lazily on first registry read so
// it picks up however many kits drums.ts ships. See applyPreset below.

class DrumsVoice implements Voice {
  constructor(private dm: DrumMachine) {}

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const voice = GM_DRUM_MAP[midi];
    if (!voice) return;
    this.dm.trigger(voice, time, !!opts.accent);
  }

  release(_t: number): void {}
  connect(_d: AudioNode): void {}
  dispose(): void {}
}

class DrumsSequencer implements EngineSequencer {
  getStepAt(_i: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_s: number): void {}
  serialize(): unknown { return null; }
  deserialize(_d: unknown): void {}
  dispose(): void {}
}

export class DrumsEngine implements SynthEngine {
  readonly id = 'drums-machine';
  readonly name = 'Drums';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'drum-grid' as const;
  readonly params = PARAMS;
  readonly presets = DRUM_PRESETS;

  private instances = new WeakMap<AudioNode, DrumMachine>();
  private lastInstance: DrumMachine | null = null;

  // The drum machine constructor needs an FxBus reference for sends; the
  // host injects one shared FxBus via setSharedFx so lanes can share reverb/
  // delay tails with the rest of the mix.
  private sharedFx: FxBus | null = null;
  setSharedFx(fx: FxBus): void { this.sharedFx = fx; }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    let dm = this.instances.get(output);
    if (!dm) {
      if (!this.sharedFx) {
        throw new Error('DrumsEngine: setSharedFx must be called before createVoice');
      }
      dm = new DrumMachine(ctx, this.sharedFx, output);
      this.instances.set(output, dm);
    }
    this.lastInstance = dm;
    return new DrumsVoice(dm);
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new DrumsSequencer();
  }

  buildParamUI(_container: HTMLElement, _ctx?: EngineUIContext): void {
    // Drum master knobs render via the existing drum-master-ui code path
    // for now. Migration of that UI into this method happens in Phase 7.
  }

  applyPreset(name: string): void {
    if (!this.lastInstance) return;
    const kits = this.lastInstance.listKits();
    const kit = kits.find((k) => k.name === name);
    if (kit) this.lastInstance.setKit(kit.id);
  }

  dispose(): void {}
}

const drumsEngine = new DrumsEngine();
registerEngine(drumsEngine);
registerEngineFactory('drums-machine', () => new DrumsEngine());

export function configureDrumsEngineSharedFx(fx: FxBus): void {
  drumsEngine.setSharedFx(fx);
}
```

- [ ] **Step 2: Wire up shared FX in main.ts**

Open `src/main.ts`. Find the engine import block:

```ts
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import './engines/tb303';
```

Replace the `karplus` line and below with:

```ts
import './engines/subtractive';
import './engines/wavetable';
import './engines/fm';
import './engines/karplus';
import './engines/tb303';
import './engines/drums-engine';
import { configureDrumsEngineSharedFx } from './engines/drums-engine';
```

Then find the line where `fx` is constructed (search for `const fx = new FxBus`) — it's around line 114. Directly after that line, add:

```ts
configureDrumsEngineSharedFx(fx);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Open http://localhost:5173. Demo should still play normally. In Session, click `⚙` on the MAIN lane and verify the engine dropdown now lists both "TB-303" and "Drums" alongside the existing four. Don't select them.

- [ ] **Step 5: Commit**

```bash
git add src/engines/drums-engine.ts src/main.ts
git commit -m "feat(engines): add DrumsEngine

Wraps DrumMachine via GM drum map. Voice trigger looks up
GM_DRUM_MAP[midi] and dispatches to dm.trigger(voiceName, time,
accent). Shared FxBus injected via configureDrumsEngineSharedFx so
drum sends share the master reverb/delay. No lane uses it yet."
```

---

# Phase 4 — Drum grid editor + clip data unification

Build the new drum-grid clip editor that reads `clip.notes` via GM map, add the conversion helpers, then migrate the clip data shape. This is the largest single phase.

## Task 9: Add `drumStepsToNotes` + `drumLaneToNotes` helpers

**Files:**
- Modify: `src/core/notes.ts`

- [ ] **Step 1: Add the conversion helpers**

Open `src/core/notes.ts`. Add this block at the end of the file (before any `export function patternTicks` if it's last, otherwise just append):

```ts
import type { DrumStep } from './sequencer';
import type { DrumVoice } from './drums';
import { VOICE_MIDI } from '../engines/drum-gm-map';

// Convert a drum-bus step grid (Record<DrumVoice, DrumStep[]>) into a flat
// note-event list using each voice's canonical GM midi. Roll factors expand
// into multiple closely-spaced notes.
export function drumStepsToNotes(steps: Partial<Record<DrumVoice, DrumStep[]>>): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const [voice, arr] of Object.entries(steps) as Array<[DrumVoice, DrumStep[] | undefined]>) {
    if (!arr) continue;
    const midi = VOICE_MIDI[voice];
    if (midi == null) continue;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!s || !s.on) continue;
      const div = s.roll && s.roll > 1 ? s.roll : 1;
      const subDur = TICKS_PER_STEP / div;
      for (let r = 0; r < div; r++) {
        out.push({
          midi,
          start: i * TICKS_PER_STEP + Math.floor(r * subDur),
          duration: Math.max(1, Math.floor(subDur * 0.9)),
          velocity: s.accent ? 115 : 80,
        });
      }
    }
  }
  return out;
}

// Convert a single drum-lane (DrumVoice + DrumStep[]) to notes.
export function drumLaneToNotes(voice: DrumVoice, steps: DrumStep[]): NoteEvent[] {
  return drumStepsToNotes({ [voice]: steps } as Partial<Record<DrumVoice, DrumStep[]>>);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/core/notes.ts
git commit -m "feat(notes): add drumStepsToNotes + drumLaneToNotes

Convert legacy step-based drum patterns into NoteEvent[] using the
GM drum map. Used by clip migration when loading old saves and by
the importClassicToSession path."
```

## Task 10: Create the unified drum-grid clip editor

**Files:**
- Create: `src/session/clip-editors/clip-editor-drum-grid.ts`

- [ ] **Step 1: Write the file**

Create `src/session/clip-editors/clip-editor-drum-grid.ts`:

```ts
// src/session/clip-editors/clip-editor-drum-grid.ts
// Renders an 8-row × N-step drum grid for any clip that uses NoteEvent[]
// with GM drum-mapped midis. Replaces clip-editor-drum-bus and clip-editor-
// drum-lane (which read the legacy drumSteps/drumLaneSteps fields).

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { TICKS_PER_STEP } from '../../core/notes';
import { GM_DRUM_MAP, VOICE_MIDI } from '../../engines/drum-gm-map';

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

export function renderDrumGridEditor(host: HTMLElement, clip: SessionClip): void {
  host.innerHTML = '';
  const steps = clip.lengthBars * 16;
  if (!clip.notes) clip.notes = [];

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  for (const voice of DRUM_LANES) {
    container.appendChild(buildVoiceRow(clip, voice, steps));
  }
  host.appendChild(container);
}

function buildVoiceRow(clip: SessionClip, voice: DrumVoice, totalSteps: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `track drum-track ${voice}`;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = LANE_LABELS[voice];
  row.appendChild(label);

  const cells = document.createElement('div');
  cells.className = 'cells';
  cells.style.setProperty('--steps', String(totalSteps));

  for (let i = 0; i < totalSteps; i++) {
    cells.appendChild(buildCell(clip, voice, i));
  }
  row.appendChild(cells);
  return row;
}

function buildCell(clip: SessionClip, voice: DrumVoice, stepIdx: number): HTMLElement {
  const btn = document.createElement('button');
  btn.className = `dcell ${voice}`;
  if (stepIdx % 16 === 0 && stepIdx > 0) btn.classList.add('seg-start');
  if (stepIdx % 4  === 0)                btn.classList.add('downbeat');
  applyCellVisual(btn, findNoteAtStep(clip, voice, stepIdx));

  btn.addEventListener('click', () => {
    const existing = findNoteAtStep(clip, voice, stepIdx);
    if (!existing) {
      addHit(clip, voice, stepIdx, false);
    } else if (existing.velocity < 100) {
      existing.velocity = 115;            // off → on → accent cycle
    } else {
      removeHit(clip, voice, stepIdx);    // accent → off
    }
    applyCellVisual(btn, findNoteAtStep(clip, voice, stepIdx));
  });
  return btn;
}

function findNoteAtStep(clip: SessionClip, voice: DrumVoice, stepIdx: number): NoteEvent | null {
  const start = stepIdx * TICKS_PER_STEP;
  const end   = start + TICKS_PER_STEP;
  return clip.notes.find((n) =>
    GM_DRUM_MAP[n.midi] === voice && n.start >= start && n.start < end,
  ) ?? null;
}

function addHit(clip: SessionClip, voice: DrumVoice, stepIdx: number, accent: boolean): void {
  clip.notes.push({
    midi: VOICE_MIDI[voice],
    start: stepIdx * TICKS_PER_STEP,
    duration: Math.max(1, Math.floor(TICKS_PER_STEP * 0.9)),
    velocity: accent ? 115 : 80,
  });
}

function removeHit(clip: SessionClip, voice: DrumVoice, stepIdx: number): void {
  const start = stepIdx * TICKS_PER_STEP;
  const end   = start + TICKS_PER_STEP;
  clip.notes = clip.notes.filter((n) =>
    !(GM_DRUM_MAP[n.midi] === voice && n.start >= start && n.start < end),
  );
}

function applyCellVisual(btn: HTMLElement, note: NoteEvent | null): void {
  btn.classList.toggle('on',     !!note);
  btn.classList.toggle('accent', !!note && note.velocity >= 100);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: type errors — `SessionClip` does not yet have a `notes` field. We add it in Task 12. For now, just confirm the only errors are about `clip.notes` being missing on `SessionClip`.

- [ ] **Step 3: Do NOT commit yet**

Task 12 adds the `notes` field that this file depends on. Tasks 10–12 commit together at the end of Task 12.

## Task 11: Update the clip editor router to use `engine.editor`

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts`

- [ ] **Step 1: Replace the router to read from engine.editor**

Replace the entire contents of `src/session/clip-editors/clip-editor-router.ts` with:

```ts
// src/session/clip-editors/clip-editor-router.ts
// Detects the engine assigned to the lane and dispatches to the matching
// editor (piano-roll or drum-grid). Falls back to piano-roll if engine has
// no explicit preference.

import type { SessionClip, SessionLane } from '../session';
import type { Sequencer } from '../../core/sequencer';
import type { LanePlayState } from '../session-runtime';
import { createPianoRoll, type PianoRollHandle } from '../../core/pianoroll';
import { TICKS_PER_STEP, type NoteEvent } from '../../core/notes';
import { getEngine } from '../../engines/registry';
import { renderDrumGridEditor } from './clip-editor-drum-grid';

export interface ClipEditorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  laneStates: Map<string, LanePlayState>;
  midiLabel: (m: number) => string;
}

export function renderClipEditor(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
): PianoRollHandle | null {
  host.innerHTML = '';
  const engine = getEngine(lane.engineId);

  if (engine?.editor === 'drum-grid') {
    renderDrumGridEditor(host, clip);
    return null;
  }

  return buildPianoRoll(host, lane, clip, deps);
}

function buildPianoRoll(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
): PianoRollHandle {
  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(800, clip.lengthBars * 240);
  canvas.height = 240;
  canvas.style.height = '240px';
  canvas.style.width  = `${canvas.width}px`;
  host.appendChild(canvas);

  const getNotes = (): NoteEvent[] => clip.notes ?? [];
  const setNotes = (notes: NoteEvent[]) => { clip.notes = notes; };

  const isBassLikeEngine = lane.engineId === 'tb303';
  const { ctx, seq, laneStates } = deps;
  return createPianoRoll({
    canvas,
    getNotes,
    setNotes,
    patternTicks: clip.lengthBars * 16 * TICKS_PER_STEP,
    minMidi: isBassLikeEngine ? 24 : 36,
    maxMidi: isBassLikeEngine ? 60 : 96,
    onChange: () => {},
    getPlayheadTick: () => {
      const lp = laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const now = ctx.currentTime;
      const stepDur = 60 / seq.bpm / 4;
      const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * 16;
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors about `lane.engineId` not existing on `SessionLane` and `clip.notes` not existing on `SessionClip`. Task 12 adds both.

- [ ] **Step 3: Do NOT commit yet** — bundled with Task 12.

## Task 12: Unify clip data model + lane.engineId

**Files:**
- Modify: `src/session/session.ts`
- Modify: `src/session/session-migration.ts`

- [ ] **Step 1: Update `SessionClip` and `SessionLane` types**

Replace the relevant portion of `src/session/session.ts` (the `SessionClip` and `SessionLane` interfaces) with:

```ts
export interface SessionClip {
  id: string;
  name?: string;
  color?: string;
  lengthBars: number;
  launchQuantize?: LaunchQuantize;
  notes: NoteEvent[];
  envelopes?: ClipEnvelope[];
}

export interface SessionLane {
  id: string;
  engineId: string;
  clips: (SessionClip | null)[];
  launchQuantize?: LaunchQuantize;
}
```

Also delete `LaneKind` and any references in this file:

- Remove the `export type LaneKind = 'bass' | 'poly' | 'drum-bus' | 'drum-lane';` line.
- Update `emptyClip` and `emptyLane` signatures:

```ts
export function emptyClip(lengthBars: number): SessionClip {
  return { id: nextId('clip'), lengthBars, notes: [] };
}

export function emptyLane(id: string, engineId: string): SessionLane {
  return { id, engineId, clips: [] };
}
```

- Update `emptySessionState` to set engineIds:

```ts
export function emptySessionState(): SessionState {
  return {
    lanes: [
      emptyLane('bass',  'tb303'),
      emptyLane('drums', 'drums-machine'),
      emptyLane('main',  'subtractive'),
    ],
    scenes: [],
    globalQuantize: '1/1',
  };
}
```

- [ ] **Step 2: Add `migrateClip` to `session-migration.ts`**

In `src/session/session-migration.ts`, replace the existing `clipFromBass`, `clipFromDrums`, `clipFromMainPoly`, `clipFromExtra` with these versions:

```ts
import { bassStepsToNotes, stepsToNotes, drumStepsToNotes } from '../core/notes';

function clipFromBass(pat: PatternData): SessionClip {
  const fromSteps = pat.bassMode !== 'piano' ? bassStepsToNotes(pat.bass) : [];
  const fromNotes = (pat.bassNotes ?? []).map((n) => ({ ...n }));
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: fromNotes.length ? fromNotes : fromSteps,
  };
}

function clipFromDrums(pat: PatternData): SessionClip {
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: drumStepsToNotes(pat.drums),
  };
}

function clipFromMainPoly(pat: PatternData): SessionClip {
  const fromSteps = pat.polyMode !== 'piano' ? stepsToNotes(pat.melody) : [];
  const fromNotes = (pat.polyNotes ?? []).map((n) => ({ ...n }));
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: fromNotes.length ? fromNotes : fromSteps,
  };
}

function clipFromExtra(pat: PatternData, extraId: string): SessionClip | null {
  const track = (pat.extraPolyTracks ?? []).find((t) => t.id === extraId);
  if (!track) return null;
  return {
    id: nextId('clip'),
    lengthBars: Math.max(1, Math.floor(pat.length / 16)),
    notes: track.notes.map((n) => ({ ...n })),
  };
}
```

Then near the top of `session-migration.ts`, **inside** `importClassicToSession`, find the line:

```ts
for (const id of extraIds) {
  state.lanes.push(emptyLane(id, 'poly'));
}
```

Replace with:

```ts
for (const id of extraIds) {
  state.lanes.push(emptyLane(id, 'subtractive'));
}
```

Also delete the `expandDrumsLane` and `collapseDrumsLane` exports at the bottom of the file (lines ~105 to end). Drum lanes no longer have expand/collapse — the grid editor shows every voice as a row already.

- [ ] **Step 3: Add a migration helper for loaded saves**

Still in `src/session/session-migration.ts`, add at the bottom of the file:

```ts
// Apply to clips that came from older saves (still have legacy fields like
// bassSteps/polySteps/drumSteps and no `notes`).
export function migrateLoadedSessionState(s: SessionState): SessionState {
  for (const lane of s.lanes) {
    // Old saves may have `kind` and `expanded` — strip them.
    delete (lane as { kind?: unknown }).kind;
    delete (lane as { expanded?: unknown }).expanded;
    if (!lane.engineId) lane.engineId = guessEngineId(lane.id);

    lane.clips = lane.clips.map((c) => c ? migrateClip(c) : null);
  }
  return s;
}

function guessEngineId(laneId: string): string {
  if (laneId === 'bass')  return 'tb303';
  if (laneId === 'drums' || laneId.startsWith('drum:')) return 'drums-machine';
  return 'subtractive';
}

function migrateClip(c: SessionClip): SessionClip {
  if (c.notes && c.notes.length >= 0) return c;
  type LegacyClip = SessionClip & {
    bassNotes?: NoteEvent[];
    polyNotes?: NoteEvent[];
    bassSteps?: import('../core/sequencer').BassStep[];
    polySteps?: import('../core/sequencer').PolyStep[];
    drumSteps?: Partial<Record<import('../core/drums').DrumVoice, import('../core/sequencer').DrumStep[]>>;
    drumLane?: import('../core/drums').DrumVoice;
    drumLaneSteps?: import('../core/sequencer').DrumStep[];
  };
  const legacy = c as LegacyClip;
  let notes: NoteEvent[] = [];
  if      (legacy.bassNotes?.length) notes = legacy.bassNotes;
  else if (legacy.polyNotes?.length) notes = legacy.polyNotes;
  else if (legacy.bassSteps)         notes = bassStepsToNotes(legacy.bassSteps);
  else if (legacy.polySteps)         notes = stepsToNotes(legacy.polySteps);
  else if (legacy.drumSteps)         notes = drumStepsToNotes(legacy.drumSteps);
  else if (legacy.drumLaneSteps && legacy.drumLane) {
    notes = drumStepsToNotes({ [legacy.drumLane]: legacy.drumLaneSteps });
  }
  return {
    id: c.id, name: c.name, color: c.color,
    lengthBars: c.lengthBars, launchQuantize: c.launchQuantize,
    envelopes: c.envelopes, notes,
  };
}
```

Add this import at the top of `session-migration.ts` if not already present:

```ts
import type { NoteEvent } from '../core/notes';
```

- [ ] **Step 4: Call `migrateLoadedSessionState` from session-host**

In `src/session/session-host.ts`, find `applyLoadedSessionState`:

```ts
applyLoadedSessionState(sess: SessionState): void {
  this.state.lanes = sess.lanes ?? [];
  this.state.scenes = sess.scenes ?? [];
  ...
}
```

Replace with:

```ts
applyLoadedSessionState(sess: SessionState): void {
  const migrated = migrateLoadedSessionState(sess);
  this.state.lanes = migrated.lanes ?? [];
  this.state.scenes = migrated.scenes ?? [];
  this.state.globalQuantize = migrated.globalQuantize ?? '1/1';
  this.laneStates.clear();
  for (const lane of this.state.lanes) {
    this.laneStates.set(lane.id, emptyLanePlayState(lane.id));
  }
  this.renderWithMixer();
}
```

Add to the imports at the top of session-host.ts:

```ts
import { importClassicToSession, migrateLoadedSessionState } from './session-migration';
```

(Remove the existing `expandDrumsLane, collapseDrumsLane` from that import — they were deleted in Step 2.)

- [ ] **Step 5: Fix every site that read the removed lane.kind / clip.bassSteps etc.**

The scheduler still references the old shape. Open `src/session/session-step-scheduler.ts` and **replace the entire `scheduleClipStep` function body** (Phase 5 will refactor this fully — for now just make it compile). Use this minimal version that handles the unified `clip.notes`:

```ts
export function scheduleClipStep(
  deps: StepSchedulerDeps,
  laneId: string,
  clip: SessionClip,
  stepInClip: number,
  stepTime: number,
  stepDur: number,
): void {
  const { state, markTrackActive } = deps;
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane || !clip.notes) return;

  const stepStartTick = stepInClip * TICKS_PER_STEP;
  const stepEndTick   = stepStartTick + TICKS_PER_STEP;
  const tickToSec     = stepDur / TICKS_PER_STEP;

  for (const n of clip.notes) {
    if (n.start < stepStartTick || n.start >= stepEndTick) continue;
    const offsetSec = (n.start - stepStartTick) * tickToSec;
    const durSec    = Math.max(0.01, n.duration * tickToSec);
    const accent    = n.velocity >= 100;
    routeNoteToEngine(deps, lane.engineId, laneId, n.midi, stepTime + offsetSec, durSec, accent, clip.notes, n);
  }
  markTrackActive(lane.id, stepTime);
}

function routeNoteToEngine(
  deps: StepSchedulerDeps,
  engineId: string,
  laneId: string,
  midi: number,
  time: number,
  gate: number,
  accent: boolean,
  allNotes: NoteEvent[],
  thisNote: NoteEvent,
): void {
  const { ctx, bassTriggerDirect, bassTriggerForArp, polyTriggerDirect, drums,
          ensureExtraPoly, extraStrips, getLaneEngineId, ensureLaneEngine } = deps;
  const arpEnabled = arp.enabled && arp.scope.includes(laneId);

  if (engineId === 'tb303') {
    const slidingIn = allNotes.some((m) => m !== thisNote && m.start < thisNote.start &&
                                            (m.start + m.duration) > thisNote.start + 1);
    if (arpEnabled) scheduleArpForNote(bassTriggerForArp, arp, deps.bpm(), midi, time, gate, accent);
    else            bassTriggerDirect(midi, time, gate, accent, slidingIn);
    return;
  }
  if (engineId === 'drums-machine') {
    const { GM_DRUM_MAP } = require('../engines/drum-gm-map') as typeof import('../engines/drum-gm-map');
    const voice = GM_DRUM_MAP[midi];
    if (voice) drums.trigger(voice, time, accent);
    return;
  }
  // Poly engines (subtractive/wavetable/fm/karplus)
  const isMain = laneId === 'main';
  const fire = (n: number, t: number, g: number, a: boolean) => {
    if (isMain) {
      polyTriggerDirect(n, t, g, a);
    } else {
      const engId = getLaneEngineId(laneId);
      if (engId === 'subtractive') ensureExtraPoly(laneId).trigger(n, t, g, a);
      else {
        const inst = ensureLaneEngine(laneId, engId);
        if (inst) {
          const voice = inst.createVoice(ctx, extraStrips[laneId]!.input);
          voice.trigger(n, t, { gateDuration: g, accent: a });
        } else ensureExtraPoly(laneId).trigger(n, t, g, a);
      }
    }
  };
  if (arpEnabled) scheduleArpForNote(fire, arp, deps.bpm(), midi, time, gate, accent);
  else            fire(midi, time, gate, accent);
}
```

Replace the `require()` with a top-level import for cleanliness:

At the top of the file, add:

```ts
import { GM_DRUM_MAP } from '../engines/drum-gm-map';
```

And replace the `require` line with:

```ts
const voice = GM_DRUM_MAP[midi];
```

- [ ] **Step 6: Remove now-dead drumBus expansion calls in session-host**

In `src/session/session-host.ts`, find `onToggleDrumsExpanded` in the callbacks block and replace it with:

```ts
onToggleDrumsExpanded() { /* drum-bus expand removed — drum-grid editor shows all voices */ },
```

Also in `src/session/session-ui.ts`, in `laneHeader`, find the block that adds the expand button (the `if (lane.kind === 'drum-bus')` block) and delete that entire block. Since `lane.kind` no longer exists on `SessionLane`, this will also fix a typecheck error.

In `laneHeader` also replace `lane.id.toUpperCase()` with `lane.id.toUpperCase()` (no change needed) but if there is any other reference to `lane.kind` in this file (e.g. `lane-kind-${lane.kind}`), replace those with `lane-engine-${lane.engineId}`.

- [ ] **Step 7: Update `onCellClick` to create unified clips**

In `src/session/session-host.ts`, find `onCellClick` (around line 174). Replace its body with:

```ts
onCellClick(laneId, clipIdx) {
  const lane = self.state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  const defaultLen = Math.max(1, Math.floor(seq.length / 16));
  const clip: SessionClip = {
    id: `clip-${Date.now().toString(36)}`,
    lengthBars: defaultLen,
    notes: [],
  };
  while (lane.clips.length <= clipIdx) lane.clips.push(null);
  lane.clips[clipIdx] = clip;
  self.inspector.setSelectedClip({ laneId, clipIdx });
  self.inspector.openInspector();
  self.renderWithMixer();
},
```

- [ ] **Step 8: Update `onAddSynthLane` to set `engineId`**

In the same callbacks block, replace the existing `onAddSynthLane` body with:

```ts
onAddSynthLane() {
  const used = new Set(self.state.lanes.map((l) => l.id));
  let newId = '';
  for (let i = 1; i <= 16; i++) {
    const candidate = `poly${i}`;
    if (!used.has(candidate)) { newId = candidate; break; }
  }
  if (!newId) { alert('Max 16 extra poly lanes reached.'); return; }

  const lane = emptyLane(newId, 'subtractive');
  const rowCount = Math.max(self.state.scenes.length, 1);
  for (let r = 0; r < rowCount; r++) {
    lane.clips.push({
      id: `clip-${Date.now().toString(36)}-${r}`,
      lengthBars: Math.max(1, Math.floor(seq.length / 16)),
      notes: [],
    });
  }
  self.state.lanes.push(lane);
  self.laneStates.set(newId, emptyLanePlayState(newId));
  ensureExtraPoly(newId);
  self.renderWithMixer();
},
```

- [ ] **Step 9: Update copy/paste in session-inspector**

In `src/session/session-inspector.ts`, the `pasteReplace` and `pasteLayer` methods reference `clip.bassSteps`, `clip.bassNotes`, `clip.polySteps`, `clip.polyNotes`, `clip.drumSteps`, `lane.kind`. Replace **both methods entirely** with:

```ts
private pasteReplace(): void {
  if (!clipClipboard || !this.selectedClip) return;
  const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
  const clip = lane?.clips[this.selectedClip.clipIdx];
  if (!lane || !clip) return;
  clip.notes = JSON.parse(JSON.stringify(clipClipboard.notes ?? []));
  this.renderEditor();
  this.deps.renderWithMixer();
}

private pasteLayer(): void {
  if (!clipClipboard || !this.selectedClip) return;
  const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
  const clip = lane?.clips[this.selectedClip.clipIdx];
  if (!lane || !clip) return;
  clip.notes = [
    ...(clip.notes ?? []),
    ...JSON.parse(JSON.stringify(clipClipboard.notes ?? [])) as import('../core/notes').NoteEvent[],
  ];
  this.renderEditor();
  this.deps.renderWithMixer();
}
```

Delete the now-unused `DRUM_LANES` import at the top of this file.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. If errors remain, they are likely about a forgotten lane.kind / clip.bassSteps reference — fix each in place.

- [ ] **Step 11: Smoke test**

```bash
npm run dev
```

Open http://localhost:5173. Demo plays normally in Classic. Switch to Session → demo is auto-imported as before, but now lanes have engineIds (`tb303`, `drums-machine`, `subtractive`). Launch Scene 1 — bass, drums, and main poly should all play. Click a drum clip → the new drum-grid editor renders with the same hits as before. Click a bass clip → piano-roll opens with the bass notes (converted from steps). Click + Synth → adds a new poly lane that plays.

- [ ] **Step 12: Commit Tasks 10, 11, 12 together**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts \
        src/session/clip-editors/clip-editor-router.ts \
        src/session/session.ts \
        src/session/session-migration.ts \
        src/session/session-host.ts \
        src/session/session-ui.ts \
        src/session/session-inspector.ts \
        src/session/session-step-scheduler.ts
git commit -m "feat(session): unify clip data to NoteEvent[] + lane.engineId

Drops lane.kind, lane.expanded, all the bassSteps/polySteps/drumSteps
clip shapes. Clips have a single 'notes: NoteEvent[]' field. Lanes
gain 'engineId' (tb303 / drums-machine / subtractive / ...). The
clip-editor router dispatches by engine.editor: drum-grid for
drums-machine, piano-roll for everything else. migrateLoadedSessionState
upgrades old saves on load."
```

---

# Phase 5 — Toolbar + lane add for all engines

Already partly done in Phase 4 Step 8 (+ Synth). Now wire + TB303 and + Drums buttons too.

## Task 13: Add `+ TB303` and `+ Drums` toolbar buttons

**Files:**
- Modify: `session.html`
- Modify: `index.html`
- Modify: `src/session/session-host.ts`
- Modify: `src/session/session-ui.ts`

- [ ] **Step 1: Add buttons to both HTML files**

In `session.html`, find:

```html
<button class="rnd primary" id="session-add-synth">+ Synth</button>
```

Replace that line with:

```html
<button class="rnd primary" id="session-add-tb303">+ TB303</button>
<button class="rnd primary" id="session-add-drums">+ Drums</button>
<button class="rnd primary" id="session-add-synth">+ Synth</button>
```

Make the same change in `index.html`.

- [ ] **Step 2: Add the new callback signature**

In `src/session/session-ui.ts`, replace:

```ts
onAddSynthLane: () => void;
```

with:

```ts
onAddLane: (engineId: string) => void;
```

- [ ] **Step 3: Update session-host callbacks**

In `src/session/session-host.ts`, replace the `onAddSynthLane()` callback (just renamed in Step 2 already) and its old `onAddSynthLane` declaration with this single generalized version:

```ts
onAddLane(engineId: string) {
  const prefix =
    engineId === 'tb303'          ? 'bass'  :
    engineId === 'drums-machine'  ? 'drums' :
                                    'poly';
  const used = new Set(self.state.lanes.map((l) => l.id));
  let newId = '';
  for (let i = 1; i <= 16; i++) {
    const candidate = `${prefix}${i + 1}`;
    if (!used.has(candidate)) { newId = candidate; break; }
  }
  if (!newId) { alert('Max 16 lanes per type reached.'); return; }

  const lane = emptyLane(newId, engineId);
  const rowCount = Math.max(self.state.scenes.length, 1);
  for (let r = 0; r < rowCount; r++) {
    lane.clips.push({
      id: `clip-${Date.now().toString(36)}-${r}`,
      lengthBars: Math.max(1, Math.floor(seq.length / 16)),
      notes: [],
    });
  }
  self.state.lanes.push(lane);
  self.laneStates.set(newId, emptyLanePlayState(newId));

  if (engineId === 'subtractive') ensureExtraPoly(newId);
  // tb303 + drums-machine lazy-create their instances on first trigger via
  // the engine's createVoice path (Phase 6 wires this end-to-end).

  self.renderWithMixer();
},
```

Also in the toolbar wiring (find `session-add-synth`), replace:

```ts
document.getElementById('session-add-synth')?.addEventListener('click',
  () => this.callbacks.onAddSynthLane());
```

with:

```ts
document.getElementById('session-add-tb303')?.addEventListener('click',
  () => this.callbacks.onAddLane('tb303'));
document.getElementById('session-add-drums')?.addEventListener('click',
  () => this.callbacks.onAddLane('drums-machine'));
document.getElementById('session-add-synth')?.addEventListener('click',
  () => this.callbacks.onAddLane('subtractive'));
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Smoke test**

```bash
npm run dev
```

Session view shows three new toolbar buttons. Click `+ Synth` — new poly lane appears with empty clips. Click `+ TB303` — new bass lane appears. Click `+ Drums` — new drum lane appears. The TB303 and Drums lanes don't yet make sound from the new audio path (Phase 6 wires that); but the grid and inspector render correctly and clicking on cells creates clips. Verify the existing `bass`, `drums`, `main` lanes still play sound when launching Scene 1.

- [ ] **Step 6: Commit**

```bash
git add session.html index.html src/session/session-ui.ts src/session/session-host.ts
git commit -m "feat(session): + TB303 / + Drums / + Synth toolbar buttons

Generalizes onAddSynthLane into onAddLane(engineId). Each button
creates a lane bound to a specific engine. TB303 + Drums lanes don't
trigger sound yet via the engine path — Phase 6 wires per-lane
audio."
```

---

# Phase 6 — Engine-driven trigger path for extra lanes

The scheduler in Phase 4 still routes via legacy singletons (`bassTriggerDirect`, `drums`). Phase 6 routes extra TB303/Drums lanes through their engine's `createVoice` so multiple lanes of the same type get independent audio.

## Task 14: Add per-lane ChannelStrip for extra TB303 / Drums lanes

**Files:**
- Modify: `src/main.ts`
- Modify: `src/session/session-host.ts`
- Modify: `src/session/session-step-scheduler.ts`

- [ ] **Step 1: Add `extraSynths` and `extraDrums` strip maps in main.ts**

Find the `extraStrips` and `extraPolys` declarations in `src/main.ts` (search for `const extraStrips`):

```ts
const extraStrips: Partial<Record<ExtraId, ChannelStrip>> = {};
const extraPolys:  Partial<Record<ExtraId, PolySynth>>   = {};
```

Add below them:

```ts
const extraLaneStrips = new Map<string, ChannelStrip>();   // keyed by lane id
```

This is a generic per-lane strip map for non-`main`/`bass`/`drums` lanes regardless of engine.

- [ ] **Step 2: Add a per-lane voice resolver in main.ts**

After the existing engine-related helpers (around the `getLaneEngineId` block), add:

```ts
import { getEngine } from './engines/registry';

// Cache: laneId → engine voice. Mono engines reuse the same voice; poly
// engines get a fresh voice per call but the strip is cached per lane.
const laneVoices = new Map<string, import('./engines/engine-types').Voice>();

function ensureLaneStrip(laneId: string): ChannelStrip {
  // Built-in lanes use their dedicated strips.
  if (laneId === 'bass')  return bassStrip;
  if (laneId === 'drums') return drumBusStrip;
  if (laneId === 'main')  return polyStrip;
  // Existing extra-poly behaviour for poly1..poly16.
  if ((EXTRA_IDS as readonly string[]).includes(laneId)) {
    ensureExtraPoly(laneId as ExtraId);
    return extraStrips[laneId as ExtraId]!;
  }
  // Generic extra lane (e.g. bass2, drums2): create a strip on demand.
  let s = extraLaneStrips.get(laneId);
  if (!s) {
    s = new ChannelStrip(ctx, master, fx);
    extraLaneStrips.set(laneId, s);
  }
  return s;
}

function ensureLaneVoice(laneId: string, engineId: string): import('./engines/engine-types').Voice | null {
  const cached = laneVoices.get(laneId);
  if (cached) return cached;
  const engine = getEngine(engineId);
  if (!engine) return null;
  const strip = ensureLaneStrip(laneId);
  const voice = engine.createVoice(ctx, strip.input);
  laneVoices.set(laneId, voice);
  return voice;
}
```

- [ ] **Step 3: Add `ensureLaneVoice` to `SessionHostDeps`**

In `src/session/session-host.ts`, add to `SessionHostDeps`:

```ts
ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
```

In `src/main.ts`, find the `new SessionHost({...})` call and add `ensureLaneVoice` to the deps object:

```ts
const sessionHost = new SessionHost({
  ctx, seq, bank, playBtn,
  resetAutomationPosition,
  bassTriggerDirect,
  bassTriggerForArp,
  polyTriggerDirect,
  drums,
  drumLanes: DRUM_LANES,
  markTrackActive,
  ensureExtraPoly: ensureExtraPoly as (id: string) => PolySynth,
  extraStrips: extraStrips as Partial<Record<string, ChannelStrip>>,
  ensureLaneVoice,    // NEW
  getLaneEngineId,
  ensureLaneEngine,
  setActivePolyTarget,
  setCurrentSynthLane,
  polysynth,
  mixerDeps,
  getAppMode,
  midiLabel,
});
```

- [ ] **Step 4: Pass `ensureLaneVoice` into the scheduler deps**

In `src/session/session-host.ts`, find the `scheduleClipStep` call inside `this.deps.seq.sessionTick`. Add `ensureLaneVoice` to the deps object:

```ts
{
  ctx: this.deps.ctx,
  state: this.state,
  drums: this.deps.drums,
  drumLanes: this.deps.drumLanes,
  bpm: () => this.deps.seq.bpm,
  bassTriggerDirect: this.deps.bassTriggerDirect,
  bassTriggerForArp: this.deps.bassTriggerForArp,
  polyTriggerDirect: this.deps.polyTriggerDirect,
  markTrackActive: this.deps.markTrackActive,
  ensureExtraPoly: this.deps.ensureExtraPoly,
  extraStrips: this.deps.extraStrips,
  ensureLaneVoice: this.deps.ensureLaneVoice,        // NEW
  getLaneEngineId: this.deps.getLaneEngineId,
  ensureLaneEngine: this.deps.ensureLaneEngine,
}
```

- [ ] **Step 5: Update scheduler to use `ensureLaneVoice` for extra lanes**

In `src/session/session-step-scheduler.ts`, add to `StepSchedulerDeps`:

```ts
ensureLaneVoice: (laneId: string, engineId: string) => import('../engines/engine-types').Voice | null;
```

In the `routeNoteToEngine` function, **before** the `if (engineId === 'tb303')` branch, add:

```ts
// Extra lanes (bass2, drums2, etc.) route through the engine's own voice.
// Built-in singletons (laneId === 'bass' / 'drums' / 'main') keep their
// existing direct triggers because Classic still uses them.
const isBuiltinLane = laneId === 'bass' || laneId === 'drums' || laneId === 'main';
if (!isBuiltinLane) {
  const voice = deps.ensureLaneVoice(laneId, engineId);
  if (!voice) return;
  const slidingIn = engineId === 'tb303' &&
    allNotes.some((m) => m !== thisNote && m.start < thisNote.start &&
                          (m.start + m.duration) > thisNote.start + 1);
  voice.trigger(midi, time, { gateDuration: gate, accent, slide: slidingIn });
  return;
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Smoke test**

```bash
npm run dev
```

In Session, click `+ TB303` to add a `bass2` lane. Click on a cell in scene 1 to create a clip. Open the clip in the inspector, add some notes in the piano roll (e.g. drag to paint a few low-register notes). Launch Scene 1 — the new bass2 lane should play its own monosynth alongside the existing bass lane (both audible simultaneously, no voice stealing between them).

Repeat with `+ Drums` — add `drums2`, draw kicks in the grid, launch scene → drums2 plays its own DrumMachine in parallel with the original drums.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/session/session-host.ts src/session/session-step-scheduler.ts
git commit -m "feat(session): per-lane engine voice routing for extras

Extra lanes (bass2/drums2/poly5/...) each get their own ChannelStrip
and engine voice via ensureLaneVoice. Built-in lanes ('bass'/'drums'/
'main') stay on the legacy singleton path so Classic continues to
work. Multiple TB303 or Drums lanes can now play in parallel."
```

---

# Phase 7 — Classic migration + UI cleanup

Final phase: migrate Classic mode to route through engines too, then delete orphaned files. Classic shrinks dramatically.

## Task 15: Route Classic bass + drums + poly through engines

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace built-in lane triggers with engine voices**

In `src/main.ts`, the existing `bassTriggerDirect` / `polyTriggerDirect` / direct `synth.trigger` / direct `drums.trigger` are used by the Classic sequencer. Replace them with engine-voice calls so Classic and Session run the same code path.

Find the existing `polyTriggerDirect`:

```ts
const polyTriggerDirect = (note, time, gate, accent) => {
  const engineId = getLaneEngineId('main');
  if (engineId === 'subtractive') {
    polysynth.trigger(note, time, gate, accent);
    return;
  }
  ...
};
```

Leave that function as-is (it already dispatches via engines for non-subtractive). It's still called from `seq.onMelodyTrigger`.

Find `bassTriggerDirect`:

```ts
const bassTriggerDirect = (note, time, gate, accent, slidingIn) =>
  synth.trigger({ freq: midiToFreqLocal(note), accent, slide: slidingIn, duration: gate }, time);
```

Replace with:

```ts
const bassTriggerDirect = (note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => {
  const voice = ensureLaneVoice('bass', 'tb303');
  if (!voice) {
    synth.trigger({ freq: midiToFreqLocal(note), accent, slide: slidingIn, duration: gate }, time);
    return;
  }
  voice.trigger(note, time, { gateDuration: gate, accent, slide: slidingIn });
};
```

Find `bassTriggerForArp`:

```ts
const bassTriggerForArp = (note, time, gate, accent) =>
  synth.trigger({ freq: midiToFreqLocal(note), accent, slide: false, duration: gate }, time);
```

Replace with:

```ts
const bassTriggerForArp = (note: number, time: number, gate: number, accent: boolean) => {
  const voice = ensureLaneVoice('bass', 'tb303');
  if (!voice) {
    synth.trigger({ freq: midiToFreqLocal(note), accent, slide: false, duration: gate }, time);
    return;
  }
  voice.trigger(note, time, { gateDuration: gate, accent, slide: false });
};
```

For drums, the Sequencer calls `drums.trigger(voice, time, accent)` directly inside `sequencer.ts`. To go through the engine, we'd need to refactor the sequencer's drum dispatch. The cleanest path is to NOT touch sequencer.ts for drums — Classic drums keep using the singleton DrumMachine via the existing direct call. The DrumsEngine still wraps a separate DrumMachine instance for Session extra-drum lanes. Both coexist.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Open http://localhost:5173 (Classic). Press Play — Classic should sound identical (TB303 sequencer triggers now route through the engine voice, but the engine wraps the same TB303 instance via WeakMap so audio is bit-identical). Verify accent and slide still work on the TB303 step grid. Switch to Session — also works as before.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(classic): route built-in bass through TB303Engine voice

bassTriggerDirect and bassTriggerForArp now go through
ensureLaneVoice('bass', 'tb303'). The engine wraps the same TB303
instance via WeakMap<output, TB303>, so audio is unchanged but the
dispatch path is now unified with Session extras. Drums and poly
keep their existing direct dispatch (sequencer.ts drum dispatch is
out of scope for this refactor)."
```

## Task 16: Remove orphaned drum-bus / drum-lane clip editors

**Files:**
- Delete: `src/session/clip-editors/clip-editor-drum-bus.ts`
- Delete: `src/session/clip-editors/clip-editor-drum-lane.ts`

- [ ] **Step 1: Verify they're unreferenced**

Run: `npx grep -r "clip-editor-drum-bus\|clip-editor-drum-lane\|renderDrumBusEditor\|renderDrumLaneEditor" src/`
Expected: only matches inside the two files themselves.

- [ ] **Step 2: Delete them**

```bash
git rm src/session/clip-editors/clip-editor-drum-bus.ts \
       src/session/clip-editors/clip-editor-drum-lane.ts
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(session): remove orphaned drum-bus/drum-lane editors

Replaced by clip-editor-drum-grid.ts in Phase 4."
```

## Task 17: Add piano-roll toggle to inspector for drum clips

**Files:**
- Modify: `index.html`, `session.html`
- Modify: `src/session/session-inspector.ts`
- Modify: `src/session/clip-editors/clip-editor-router.ts`

- [ ] **Step 1: Add the toggle button to both HTML files**

In `session.html` and `index.html`, find the inspector row:

```html
<button class="rnd" id="insp-delete">Delete</button>
```

Directly before that button, add:

```html
<button class="rnd" id="insp-toggle-editor" title="Toggle drum-grid / piano-roll">↔ Editor</button>
```

- [ ] **Step 2: Track preferred editor per clip in the inspector**

In `src/session/session-inspector.ts`, add a module-level map at the bottom of the file (alongside `clipClipboard`):

```ts
// Drum clips can be edited as grid or piano-roll. This map stores the user's
// per-clip preference. Default is the engine's editor (drum-grid for drums).
const editorOverride = new Map<string, 'piano-roll' | 'drum-grid'>();
```

In `openInspector`, after the existing copy/paste wiring (search for `insp-paste-layer`), add:

```ts
document.getElementById('insp-toggle-editor')!.onclick = () => {
  if (!this.selectedClip) return;
  const current = editorOverride.get(clip.id) ?? null;
  const next: 'piano-roll' | 'drum-grid' =
    current === 'piano-roll' ? 'drum-grid' : 'piano-roll';
  editorOverride.set(clip.id, next);
  this.renderEditor();
};
```

In `renderEditor`, pass the override into the router:

```ts
this.roll = renderClipEditor(host, lane, clip, editorDeps, editorOverride.get(clip.id));
```

- [ ] **Step 3: Honour the override in the router**

In `src/session/clip-editors/clip-editor-router.ts`, change `renderClipEditor` signature:

```ts
export function renderClipEditor(
  host: HTMLElement,
  lane: SessionLane,
  clip: SessionClip,
  deps: ClipEditorDeps,
  override?: 'piano-roll' | 'drum-grid',
): PianoRollHandle | null {
  host.innerHTML = '';
  const engine = getEngine(lane.engineId);
  const editor = override ?? engine?.editor ?? 'piano-roll';

  if (editor === 'drum-grid') {
    renderDrumGridEditor(host, clip);
    return null;
  }
  return buildPianoRoll(host, lane, clip, deps);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Smoke test**

```bash
npm run dev
```

In Session, click on a drum clip → grid renders. Click `↔ Editor` → piano-roll renders showing the same notes as midi (36 for kicks, 38 for snares, etc.). Click `↔ Editor` again → back to grid. Test on a non-drum lane: clicking the toggle still works but the toggle has no visible effect (engine has no drum-grid alternative — falls back to piano-roll either way).

- [ ] **Step 6: Commit**

```bash
git add index.html session.html src/session/session-inspector.ts src/session/clip-editors/clip-editor-router.ts
git commit -m "feat(session): toggle drum-grid ↔ piano-roll per clip

Adds an inspector button that switches the active editor for the
selected drum clip between the named-voice grid (default) and the
piano-roll. Preference is per-clip (keyed by clip.id) and lives in
a module-level Map — no persistence needed."
```

---

## Out of scope (deferred to future plans)

- **Removing `.page[data-page="303"]` and `.page[data-page="drums"]`**: this requires moving the TB303/Drums knobs into each engine's `buildParamUI` and reworking the synth tab routing. A larger UI rework, separate plan.
- **Per-clip engine override** (clip carrying its own engineId): YAGNI for now.
- **Sampler / external sample loading**: separate spec.
- **Migrating `src/classic/synth-tabs.ts`**: tightly coupled to the existing Classic UI; separate plan.

---

## Self-review notes

- Spec sections 1–5 covered by Tasks 1–12.
- Spec section 6 (lane unification) covered by Tasks 12–14.
- Spec section 7 (UI consolidation) partially covered (tasks 16, 17); full 303/Drums tab removal explicitly deferred to a follow-up plan.
- Spec section 9 (migration order): plan follows phases 1→7 in the same order.
- Section 11 (testing): every task has an explicit typecheck step and a smoke-test step where audio behaviour might change.

