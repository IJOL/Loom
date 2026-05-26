# Unified Engines Design

> **Goal:** Make TB-303 and Drums first-class synthesis engines alongside subtractive/wavetable/FM/karplus, so every lane is just `{ id, engineId, clips[] }` with no special-case `kind`.
>
> **Status:** Spec — ready for implementation planning.
>
> **Date:** 2026-05-26

---

## 1. Motivation

The current codebase has three parallel models for sound generation:

- `TB303` class — monophonic acid bass with slide, used by Classic + Session for `kind === 'bass'` lanes.
- `DrumMachine` class — multi-voice drum kit, used for `kind === 'drum-bus'` and `kind === 'drum-lane'` lanes.
- `SynthEngine` interface — polyphonic engines (subtractive, wavetable, FM, karplus), used for `kind === 'poly'` lanes.

Each model has its own UI, its own trigger code path, its own clip data shape, and its own preset library. Adding a new lane type, a new sound, or a new editor requires touching all three. The user wants:

- Multiple 303 lanes, multiple drum lanes (not just one of each).
- A single `+ Lane` UX where you pick what engine drives it.
- Everything reducible to *presets* — kits become preset rows of DrumsEngine, acid sounds become preset rows of TB303Engine, etc.

This spec unifies the three models into the `SynthEngine` interface.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────────┐
│ SessionLane { id, engineId, clips[] }        │
│   └─ resolves to ─────────────────────────┐  │
│                                            ▼  │
│                              ┌──────────────────────────┐
│                              │ SynthEngine              │
│                              │   editor: 'piano-roll'   │
│                              │           | 'drum-grid'  │
│                              │   polyphony: 'mono'|'poly│
│                              │   presets: [...]         │
│                              │   createVoice(ctx, out)  │
│                              └──────────────────────────┘
│                                            │
│                                            ▼
│                              ┌──────────────────────────┐
│                              │ Voice                    │
│                              │   trigger(midi, t, opts) │
│                              │     opts: { accent,      │
│                              │             slide,       │
│                              │             gateDuration }│
│                              └──────────────────────────┘
└──────────────────────────────────────────────┘
```

- `lane.kind` is removed. `lane.engineId` replaces it.
- All clips share one data shape: `clip.notes: NoteEvent[]` (midi-based).
- For drum engines, MIDI numbers map to drum voices via General MIDI drum map.
- The clip editor is chosen by `engine.editor` — `'piano-roll'` for melodic/mono, `'drum-grid'` for drum kits.

---

## 3. SynthEngine interface extensions

`src/engines/engine-types.ts`:

```ts
export interface SynthEngine {
  // existing fields
  readonly id: string;
  readonly name: string;
  readonly type: 'polyhost' | 'tab';
  readonly params: ParamDef[];
  createVoice(ctx: AudioContext, output: AudioNode): Voice;
  buildSequencer(container: HTMLElement, stepCount: number): EngineSequencer;
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void;
  randomize?(): void;
  dispose(): void;

  // NEW
  readonly polyphony: 'mono' | 'poly';     // was number | 'mono'; tighter discriminator
  readonly editor: 'piano-roll' | 'drum-grid';
  readonly presets: EnginePreset[];
  applyPreset(name: string): void;
}

export interface EnginePreset {
  name: string;
  params: Record<string, number>;
  // Drum kits may carry richer per-voice params; the engine interprets
  // these freely. The shape above is just the canonical scalar params map.
}

export interface VoiceTriggerOptions {
  accent?: boolean;
  slide?: boolean;     // already exists — TB303Engine reads it
  velocity?: number;
  gateDuration: number;
}
```

**Mono semantics**: when `polyphony === 'mono'`, the lane host caches the voice returned by `createVoice` and reuses it for every trigger. The engine handles voice stealing and (if `slide: true`) pitch ramp + amp re-attack skip internally. This matches TB303's existing behaviour.

**Poly semantics** unchanged: host creates a fresh voice per note (or pulls from a pool).

---

## 4. TB303Engine

`src/engines/tb303.ts` (new):

```ts
class TB303Engine implements SynthEngine {
  readonly id = 'tb303';
  readonly name = 'TB-303';
  readonly type = 'polyhost';
  readonly polyphony = 'mono';
  readonly editor = 'piano-roll';
  readonly params = [
    { id: 'cutoff',    label: 'CUTOFF', min: 0, max: 1, default: 0.42 },
    { id: 'resonance', label: 'RES',    min: 0, max: 1, default: 0.55 },
    { id: 'envMod',    label: 'ENV',    min: 0, max: 1, default: 0.5  },
    { id: 'decay',     label: 'DECAY',  min: 0, max: 1, default: 0.4  },
    { id: 'accent',    label: 'ACCENT', min: 0, max: 1, default: 0.6  },
    { id: 'wave',      label: 'WAVE',   min: 0, max: 1, default: 0    },
  ];
  readonly presets: EnginePreset[] = [
    { name: 'Acid 1',  params: { cutoff: 0.35, resonance: 0.7,  envMod: 0.6, decay: 0.5, accent: 0.7, wave: 0 } },
    { name: 'Acid Dub', params: { cutoff: 0.20, resonance: 0.85, envMod: 0.4, decay: 0.6, accent: 0.5, wave: 1 } },
    // ...migrated from existing src/presets/presets.ts bass section
  ];

  private instances = new WeakMap<AudioNode, TB303>();

  createVoice(ctx, output): Voice {
    let tb303 = this.instances.get(output);
    if (!tb303) {
      tb303 = new TB303(ctx, output);
      this.instances.set(output, tb303);
    }
    return {
      trigger: (midi, time, { gateDuration, accent, slide }) => {
        tb303!.trigger({
          freq: midiToFreq(midi),
          accent: !!accent,
          slide: !!slide,
          duration: gateDuration,
        }, time);
      },
      release: () => {},          // TB303 envelope auto-releases
      connect: () => {},           // already connected to output
      dispose: () => {},
    };
  }

  buildParamUI(container, ctx) {
    // Renders the same cutoff/res/env/decay/accent knobs + wave select that
    // currently live on .page[data-page="303"] — moved here so it works for
    // any lane that picks 'tb303' as its engine.
  }

  applyPreset(name) {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    // Apply params to the engine's most-recently-created instance.
    // For multi-instance setups (multiple TB303 lanes), the engine UI is
    // bound to the active lane's instance via EngineUIContext.
  }
}
```

The existing `src/core/synth.ts` (`TB303` class) is **untouched** in this refactor. The engine wraps it.

---

## 5. DrumsEngine

`src/engines/drums-engine.ts` (new):

```ts
const GM_DRUM_MAP: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  38: 'snare', 40: 'snare',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  39: 'clap',
  56: 'cowbell',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom',
  51: 'ride', 53: 'ride', 59: 'ride',
};

// Canonical MIDI for each voice (used by the drum-grid editor when adding
// a hit to a row).
const VOICE_MIDI: Record<DrumVoice, number> = {
  kick: 36, snare: 38, closedHat: 42, openHat: 46,
  clap: 39, cowbell: 56, tom: 45, ride: 51,
};

class DrumsEngine implements SynthEngine {
  readonly id = 'drums-machine';
  readonly name = 'Drums';
  readonly type = 'polyhost';
  readonly polyphony = 'poly';
  readonly editor = 'drum-grid';
  readonly params = [
    { id: 'master-gain', label: 'LEVEL', min: 0,   max: 1.5, default: 1 },
    { id: 'master-tune', label: 'TUNE',  min: -12, max: 12,  default: 0 },
    // Master EQ/comp params, ported from drum-master-ui.ts.
  ];
  readonly presets = DRUM_KITS_AS_PRESETS;   // converted from existing KITS array

  private instances = new WeakMap<AudioNode, DrumMachine>();

  createVoice(ctx, output): Voice {
    let dm = this.instances.get(output);
    if (!dm) {
      dm = new DrumMachine(ctx, /* fx ref */, output);
      this.instances.set(output, dm);
    }
    return {
      trigger: (midi, time, { accent }) => {
        const voice = GM_DRUM_MAP[midi];
        if (!voice) return;             // unmapped midi = silence (intentional)
        dm!.trigger(voice, time, !!accent);
      },
      release: () => {},
      connect: () => {},
      dispose: () => {},
    };
  }

  buildParamUI(container, ctx) {
    // Preset selector (kit) + master knobs. Replaces .page[data-page="drums"].
  }

  applyPreset(name) {
    // dm.setKit(name) on the active lane's DrumMachine instance.
  }
}
```

The existing `src/core/drums.ts` (`DrumMachine` class) is **untouched**. The engine wraps it.

### Drum-grid editor

`src/session/clip-editors/clip-editor-drum-grid.ts` (new, replaces both `clip-editor-drum-bus.ts` and `clip-editor-drum-lane.ts`):

- Reads `clip.notes`, groups by `GM_DRUM_MAP[note.midi]` into 8 voice rows.
- Renders one row per `DrumVoice` (kick/snare/...), one cell per 16th step.
- Click toggles a `NoteEvent` at `(midi: VOICE_MIDI[voice], start: stepIdx * TICKS_PER_STEP, duration: TICKS_PER_STEP, velocity: 80)`.
- Shift+click cycles roll factor (encoded as extra closely-spaced notes).
- Inspector also offers a "Piano-roll" toggle that hands the same `clip.notes` to the piano-roll editor for free-form editing (per user request: "como en Ableton tiene 2 editores").

---

## 6. Unified clip data model

`src/session/session.ts`:

```ts
export interface SessionClip {
  id: string;
  name?: string;
  color?: string;
  lengthBars: number;
  launchQuantize?: LaunchQuantize;
  notes: NoteEvent[];           // single canonical container
  envelopes?: ClipEnvelope[];   // automation, unchanged
}
```

Removed fields: `bassSteps`, `bassNotes`, `bassMode`, `polySteps`, `polyNotes`, `polyMode`, `drumSteps`, `drumLane`, `drumLaneSteps`.

### Legacy migration

Applied once when a save / classic-import lands. After migration the legacy fields are deleted.

```ts
function migrateClip(c: SessionClip): SessionClip {
  if (c.notes && c.notes.length >= 0 && !c.bassSteps && !c.polySteps && !c.drumSteps) return c;
  let notes: NoteEvent[] = [];
  if      (c.bassNotes?.length)   notes = c.bassNotes;
  else if (c.polyNotes?.length)   notes = c.polyNotes;
  else if (c.bassSteps)           notes = bassStepsToNotes(c.bassSteps);
  else if (c.polySteps)           notes = stepsToNotes(c.polySteps);
  else if (c.drumSteps)           notes = drumStepsToNotes(c.drumSteps);
  else if (c.drumLaneSteps && c.drumLane)
                                  notes = drumLaneToNotes(c.drumLane, c.drumLaneSteps);
  return { id: c.id, name: c.name, color: c.color, lengthBars: c.lengthBars,
           launchQuantize: c.launchQuantize, envelopes: c.envelopes, notes };
}
```

New helpers in `src/core/notes.ts`:

```ts
export function drumStepsToNotes(steps: Record<DrumVoice, DrumStep[]>): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const [voice, arr] of Object.entries(steps)) {
    const midi = VOICE_MIDI[voice as DrumVoice];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!s.on) continue;
      const div = s.roll && s.roll > 1 ? s.roll : 1;
      const subDur = TICKS_PER_STEP / div;
      for (let r = 0; r < div; r++) {
        out.push({
          midi,
          start: i * TICKS_PER_STEP + r * subDur,
          duration: Math.floor(subDur * 0.9),
          velocity: s.accent ? 115 : 80,
        });
      }
    }
  }
  return out;
}

export function drumLaneToNotes(voice: DrumVoice, steps: DrumStep[]): NoteEvent[] {
  return drumStepsToNotes({ [voice]: steps } as Record<DrumVoice, DrumStep[]>);
}
```

---

## 7. Unified lane model

`src/session/session.ts`:

```ts
export interface SessionLane {
  id: string;
  engineId: string;            // 'tb303' | 'drums-machine' | 'subtractive' | ...
  clips: (SessionClip | null)[];
  launchQuantize?: LaunchQuantize;
}
```

Removed: `kind`, `expanded`. (The drum-bus expand/collapse UX disappears — the grid editor already shows all voices as rows.)

### Toolbar buttons

`session.html` / `index.html` toolbar:

```html
<button id="session-add-tb303"   class="rnd primary">+ TB303</button>
<button id="session-add-drums"   class="rnd primary">+ Drums</button>
<button id="session-add-synth"   class="rnd primary">+ Synth</button>   <!-- = subtractive -->
```

Each button calls `onAddLane(engineId)`. The handler:
1. Finds the next free lane id for that engine (e.g. `tb303-2`, `drums-2`, `poly5`).
2. Pushes a new `SessionLane` with empty clips for every scene row.
3. Lazy-creates the audio strip (`ChannelStrip`) + engine voice via `ensureLaneVoice(laneId, engineId)`.
4. Re-renders the grid.

### Step scheduler simplification

`src/session/session-step-scheduler.ts` collapses from four `if (lane.kind === ...)` branches to one engine-driven path:

```ts
export function scheduleClipStep(deps, laneId, clip, stepInClip, stepTime, stepDur) {
  const lane = deps.state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  const engine = deps.engineFor(lane.engineId);
  const voice = deps.ensureLaneVoice(lane.id, engine);  // mono → cached, poly → per-note
  const arpEnabled = arp.enabled && arp.scope.includes(laneId);

  const stepStartTick = stepInClip * TICKS_PER_STEP;
  const stepEndTick   = stepStartTick + TICKS_PER_STEP;
  const tickToSec     = stepDur / TICKS_PER_STEP;

  for (const n of clip.notes) {
    if (n.start < stepStartTick || n.start >= stepEndTick) continue;
    const offsetSec = (n.start - stepStartTick) * tickToSec;
    const durSec    = Math.max(0.01, n.duration * tickToSec);
    const accent    = n.velocity >= 100;
    const slide     = engine.polyphony === 'mono' &&
                      clip.notes.some((m) => m !== n && m.start < n.start &&
                                              (m.start + m.duration) > n.start + 1);
    const fire = (midi: number, time: number, gate: number, acc: boolean) =>
      voice.trigger(midi, time, { gateDuration: gate, accent: acc, slide });

    if (arpEnabled) scheduleArpForNote(fire, arp, deps.bpm(), n.midi, stepTime + offsetSec, durSec, accent);
    else            fire(n.midi, stepTime + offsetSec, durSec, accent);
  }
  deps.markTrackActive(lane.id, stepTime);
}
```

No more lane-kind branching. The `slide` computation runs only for mono engines (where it's meaningful).

---

## 8. UI consolidation

Removed:
- `.page[data-page="303"]` (TB-303 tab)
- `.page[data-page="drums"]` (Drums tab)
- `src/classic/bass-grid.ts`
- `src/classic/drum-cells.ts`
- `src/classic/synth-tabs.ts` (replaced by per-lane engine UI)
- `src/session/clip-editors/clip-editor-drum-bus.ts`
- `src/session/clip-editors/clip-editor-drum-lane.ts`

Renamed:
- `.page[data-page="poly"]` → `.page[data-page="synth"]` (one tab for any engine UI)

The remaining tabs are: **Synth** (engine params for the active lane), **Master FX**, **Automation**. Plus the Session grid as the home view.

The `⚙` button on each lane in Session activates the Synth tab and binds its UI to that lane's engine instance.

---

## 9. Migration order (the 7 phases)

Each phase is independently shippable: typecheck passes, all existing flows keep working until the phase explicitly replaces them.

### Phase 1 — Foundation
Extend `SynthEngine` interface with `editor`, `presets`, `applyPreset`. Narrow `polyphony` to `'mono' | 'poly'`. Adjust the four existing engines (subtractive/wavetable/fm/karplus) to satisfy the new fields with default values (`editor: 'piano-roll'`, `presets: []`).

### Phase 2 — TB303Engine
Add `src/engines/tb303.ts`. Register with engine registry. Engine appears in the dropdown but no lane uses it yet. Mono voice caching via `WeakMap<AudioNode, TB303>`.

### Phase 3 — DrumsEngine
Add `src/engines/drums-engine.ts`. Register. Convert existing `KITS` array into the engine's preset list. Add `GM_DRUM_MAP` + `VOICE_MIDI` to `src/core/drums.ts` or to the engine file.

### Phase 4 — Drum-grid editor + clip data unification
- Add `clip-editor-drum-grid.ts`, render via GM map from `clip.notes`.
- Add `migrateClip` + `drumStepsToNotes` + `drumLaneToNotes` helpers in `core/notes.ts`.
- Drop legacy clip fields from the `SessionClip` type; apply `migrateClip` at load/import time. Existing piano-roll editor already takes `clip.notes` (well, `bassNotes`/`polyNotes`) — switch it to `clip.notes`.

### Phase 5 — Session lane unification
- Drop `lane.kind`, `lane.expanded`.
- Add `lane.engineId`.
- Refactor `session-step-scheduler.ts` to the single engine-driven path shown in §7.
- Generalize `onAddSynthLane` to `onAddLane(engineId)`. Wire `+ TB303` / `+ Drums` / `+ Synth` toolbar buttons.
- Session save format: bump schema version, migrate on load.

### Phase 6 — Classic migration
- Sequencer (Classic mode) routes triggers through engines instead of the singletons `synth`, `polysynth`, `drums`.
- `seq.onBassTrigger` / `onMelodyTrigger` / drum trigger collapse into a single per-lane voice call (`voiceFor(laneId).trigger(midi, time, opts)`).
- The Classic pattern bank still uses step-based data internally (because the Classic UI is step-grid driven), but the trigger path is unified.

### Phase 7 — UI cleanup
- Remove `.page[data-page="303"]` and `.page[data-page="drums"]` from `index.html` and `session.html`.
- Remove `src/classic/bass-grid.ts`, `src/classic/drum-cells.ts`, `src/classic/synth-tabs.ts` (or whatever subsets become orphaned).
- Rename `data-page="poly"` to `data-page="synth"`.
- Update `setActivePolyTarget` / `setCurrentSynthLane` to work generically with any engine, not just subtractive.

---

## 10. Out of scope

- Per-clip engine override (clips inheriting from lane's engine is enough for now).
- Drum sample loading (drum engine continues to use the synthesized DrumMachine).
- New engine types (this spec only unifies existing ones; adding sampler/granular/etc. is its own future spec).
- Mixer / FX / Save Manager — untouched.

---

## 11. Testing

This codebase has no test harness. Verification is manual:

- After Phase 2: Engine selector shows "TB-303" in the dropdown.
- After Phase 3: Engine selector shows "Drums".
- After Phase 4: Importing a Classic save into Session produces clips with `notes[]` only, and drum clips render in the new drum-grid editor with the same hits as before.
- After Phase 5: `+ TB303` / `+ Drums` / `+ Synth` create lanes that play sound correctly. Multiple TB303 lanes coexist (each on its own strip) without stealing each other's voices.
- After Phase 6: Classic mode still plays existing patterns identically.
- After Phase 7: No visual regressions; `npx tsc --noEmit` clean.

Smoke test sequence after each phase: load the bundled Minimal Techno demo, press play, hit each scene, verify mute/solo on every lane, save and reload from the save manager.
