# Multi-strip Destination Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In every automation/modulation destination dropdown, group a multi-strip engine's params under a per-strip heading (a drum voice, a sampler pad's note) so you can tell whether a `TUNE` belongs to the kick or the clap.

**Architecture:** `AutomationTarget` gains an optional `subGroup`. Each engine that has strips exposes an optional `subGroupFor(paramId)` hook (drums → voice name; sampler → pad note) and, for the sampler only, a `dynamicParamsFor(lane)` hook that emits per-pad params derived from the session keymap (they were never in the catalogue before). The single grouping helper `groupTargetsByLane` splits by lane **+ subGroup**, so all four pickers inherit the sub-headings with no per-caller edits.

**Tech Stack:** TypeScript, Vite, Vitest (`node` env + `test/setup.ts` globalises `node-web-audio-api`, so any test may import an engine). No new deps.

## Global Constraints

- **UI text in English.** Labels, headings, catalogue strings — all English. Spanish is for conversation only.
- **No migrations, ever.** Nothing here reads or translates an old saved format. Per-pad sampler params are derived fresh from `lane.engineState.sampler.keymap`.
- **Presentation only.** No paramId, no saved data, no engine binding changes. `subGroup` is computed at list time, never persisted.
- **Source files ≤300 lines (target), 500 hard.** New helpers are small, focused modules.
- **Tests colour-free.** Single file: `NO_COLOR=1 npx vitest run <path>`. Never add `--reporter=…`.
- **Boundary rule (from the spec):** strip-naming logic lives on the ENGINE (`subGroupFor` / `dynamicParamsFor`), never in the catalogue. `listAutomationTargets` only asks the engine; it must not learn what a drum voice or a sampler pad is.

## Known limitation (in scope to state, out of scope to fix)

Per-pad sampler params (and per-voice drum params, which already ship on `main`) resolve on the **write** path — clip envelopes, performance automation, the XY pad — via `engine.setBaseValue`, applied at the next note trigger. They are **not** LFO/ADSR-bindable (the sampler exposes no `AudioParam` for them; `getSharedAudioParams()` is empty). So they appear in the modulation dropdown but an LFO routed to one is inert — exactly the pre-existing behaviour of drum per-voice params today. This plan brings the sampler to parity with drums; making per-strip params LFO-bindable is a separate, larger task and is NOT done here.

## File structure

- `src/automation/automation-targets.ts` — `AutomationTarget.subGroup`; `listAutomationTargets` merges `dynamicParamsFor` + attaches `subGroup`; `groupTargetsByLane` splits by lane+subGroup; new `automationTargetLabel()` helper.
- `src/engines/engine-types.ts` — `SynthEngine.subGroupFor?` + `dynamicParamsFor?`.
- `src/engines/descriptor-engine.ts` — forward the two optional hooks from config to the built descriptor.
- `src/engines/note-name.ts` — **new**, pure `noteName(midi)` (extracted from `sampler-keyboard-map.ts`).
- `src/engines/drum-subgroups.ts` — **new**, `VOICE_DISPLAY_NAMES` + `drumSubGroupFor`.
- `src/engines/sampler-subgroups.ts` — **new**, `samplerDynamicParamsFor` + `samplerSubGroupFor`.
- `src/engines/drums-engine.ts` — wire `subGroupFor`.
- `src/engines/sampler.ts` — wire `subGroupFor` + `dynamicParamsFor`.
- `src/session/clip-automation-lanes.ts` — use `automationTargetLabel()` for the existing-lane header.
- The other three pickers (`mod-routing-templates.ts`, `performance-automation-ui.ts`, `xy-pad-ui.ts`) need **no edits** — they already iterate `groupTargetsByLane`'s `[header, group]`.

---

### Task 1: Data model + engine hooks + descriptor passthrough

**Files:**
- Modify: `src/automation/automation-targets.ts` (add `subGroup` to the interface)
- Modify: `src/engines/engine-types.ts` (add the two optional methods to `SynthEngine`)
- Modify: `src/engines/descriptor-engine.ts` (accept + forward them)
- Test: `src/engines/descriptor-engine.test.ts` (create)

**Interfaces:**
- Produces:
  - `AutomationTarget.subGroup?: { key: string; label: string }`
  - `SynthEngine.subGroupFor?(paramId: string): { key: string; label: string } | undefined`
  - `SynthEngine.dynamicParamsFor?(lane: SessionLane): EngineParamSpec[]`
  - `DescriptorEngineConfig.subGroupFor?` / `.dynamicParamsFor?` (same signatures)

- [ ] **Step 1: Write the failing test**

Create `src/engines/descriptor-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDescriptorEngine } from './descriptor-engine';
import type { EngineParamSpec } from './engine-params';
import type { SessionLane } from '../session/session';

const dyn: EngineParamSpec[] = [
  { id: 'zone60.tune', label: 'TUNE', kind: 'continuous', min: -24, max: 24, default: 0 },
];

describe('createDescriptorEngine hook passthrough', () => {
  it('forwards subGroupFor and dynamicParamsFor to the built descriptor', () => {
    const eng = createDescriptorEngine({
      id: 'x', name: 'X', polyphony: 'poly', params: [], presets: () => [],
      subGroupFor: (id) => (id.startsWith('zone') ? { key: 'zone60', label: 'C4' } : undefined),
      dynamicParamsFor: () => dyn,
    });
    expect(eng.subGroupFor?.('zone60.tune')).toEqual({ key: 'zone60', label: 'C4' });
    expect(eng.subGroupFor?.('gain')).toBeUndefined();
    expect(eng.dynamicParamsFor?.({} as SessionLane)).toBe(dyn);
  });

  it('leaves both hooks undefined when config omits them', () => {
    const eng = createDescriptorEngine({ id: 'y', name: 'Y', polyphony: 'poly', params: [], presets: () => [] });
    expect(eng.subGroupFor).toBeUndefined();
    expect(eng.dynamicParamsFor).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/descriptor-engine.test.ts`
Expected: FAIL — `createDescriptorEngine` config type rejects `subGroupFor`/`dynamicParamsFor` (compile error) or `eng.subGroupFor` is undefined.

- [ ] **Step 3: Add `subGroup` to `AutomationTarget`**

In `src/automation/automation-targets.ts`, extend the interface (after the `max: number;` line):

```ts
export interface AutomationTarget {
  /** Canonical param id: `<laneId>.<engineParam>` or `<laneId>.fx:<slotId>.<param>`. */
  id: string;
  label: string;
  laneId: string;
  laneName: string;
  min: number;
  max: number;
  /** Optional sub-heading within a lane: a drum voice, a sampler pad. Absent for
   *  single-strip engines, which group by lane alone as before. Presentation
   *  only — computed at list time, never persisted. */
  subGroup?: { key: string; label: string };
}
```

- [ ] **Step 4: Add the hooks to `SynthEngine`**

In `src/engines/engine-types.ts`, inside the `SynthEngine` interface (after `getSharedAudioParams?`), add:

```ts
  /** Optional: a presentable sub-heading for one of this engine's params, used
   *  to group destination dropdowns by strip (a drum voice, a sampler pad).
   *  Returns undefined for params that belong to no strip (e.g. the lane bus).
   *  Single-strip engines don't implement it. Presentation only. */
  subGroupFor?(paramId: string): { key: string; label: string } | undefined;
  /** Optional: per-lane params that aren't in the static `params` list because
   *  they depend on session state (the sampler's per-pad params, derived from
   *  the lane keymap). The catalogue merges these with `params` when listing
   *  destinations. */
  dynamicParamsFor?(lane: import('../session/session').SessionLane): import('./engine-params').EngineParamSpec[];
```

- [ ] **Step 5: Forward them in `createDescriptorEngine`**

In `src/engines/descriptor-engine.ts`:

Add to `DescriptorEngineConfig` (after `modulators?`):

```ts
  /** See SynthEngine.subGroupFor. */
  subGroupFor?: (paramId: string) => { key: string; label: string } | undefined;
  /** See SynthEngine.dynamicParamsFor. */
  dynamicParamsFor?: (lane: import('../session/session').SessionLane) => EngineParamSpec[];
```

Add to the returned object (after `dispose() {...}` or anywhere in the literal):

```ts
    subGroupFor: cfg.subGroupFor,
    dynamicParamsFor: cfg.dynamicParamsFor,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/descriptor-engine.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add src/automation/automation-targets.ts src/engines/engine-types.ts src/engines/descriptor-engine.ts src/engines/descriptor-engine.test.ts
git commit -m "feat(automation): AutomationTarget.subGroup + engine subGroupFor/dynamicParamsFor hooks"
```

---

### Task 2: Drum voice sub-groups (pure module)

**Files:**
- Create: `src/engines/drum-subgroups.ts`
- Test: `src/engines/drum-subgroups.test.ts`

**Interfaces:**
- Consumes: `DRUM_LANES` from `../core/drums`.
- Produces: `VOICE_DISPLAY_NAMES: Record<DrumVoice, string>`, `drumSubGroupFor(paramId: string): { key: string; label: string } | undefined`.

- [ ] **Step 1: Write the failing test**

Create `src/engines/drum-subgroups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { drumSubGroupFor, VOICE_DISPLAY_NAMES } from './drum-subgroups';
import { DRUM_LANES } from '../core/drums';

describe('drumSubGroupFor', () => {
  it('maps a per-voice param to its presentable voice name', () => {
    expect(drumSubGroupFor('kick.tune')).toEqual({ key: 'kick', label: 'Kick' });
    expect(drumSubGroupFor('closedHat.decay')).toEqual({ key: 'closedHat', label: 'Closed Hat' });
    expect(drumSubGroupFor('kick.eq.low')).toEqual({ key: 'kick', label: 'Kick' });
  });

  it('returns undefined for the lane bus (not a voice)', () => {
    expect(drumSubGroupFor('bus.level')).toBeUndefined();
    expect(drumSubGroupFor('bus.eq.high')).toBeUndefined();
  });

  it('has a display name for every drum voice', () => {
    for (const v of DRUM_LANES) expect(typeof VOICE_DISPLAY_NAMES[v]).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-subgroups.test.ts`
Expected: FAIL — module `./drum-subgroups` not found.

- [ ] **Step 3: Write the module**

Create `src/engines/drum-subgroups.ts`:

```ts
// src/engines/drum-subgroups.ts
// Presentation-only: names a drum voice for automation destination sub-headings.
// A per-voice param id is `<voice>.<leaf>` (e.g. `kick.tune`, `closedHat.eq.low`);
// the lane bus params (`bus.*`) belong to no voice and get no sub-group.
import { DRUM_LANES, type DrumVoice } from '../core/drums';

/** Title-case display names for the destination dropdown headings (NOT the
 *  terse rack labels in drum-voice-rack.ts's VOICE_LABELS — "CH" reads wrong as
 *  a heading; "Closed Hat" is what the approved mockup shows). */
export const VOICE_DISPLAY_NAMES: Record<DrumVoice, string> = {
  kick: 'Kick', snare: 'Snare', rimshot: 'Rimshot', closedHat: 'Closed Hat',
  openHat: 'Open Hat', clap: 'Clap', cowbell: 'Cowbell', tom: 'Tom',
  ride: 'Ride', crash: 'Crash',
};

const VOICES = new Set<string>(DRUM_LANES);

export function drumSubGroupFor(paramId: string): { key: string; label: string } | undefined {
  const dot = paramId.indexOf('.');
  const seg = dot < 0 ? paramId : paramId.slice(0, dot);
  if (!VOICES.has(seg)) return undefined;
  return { key: seg, label: VOICE_DISPLAY_NAMES[seg as DrumVoice] };
}
```

> If TypeScript reports a missing key in `VOICE_DISPLAY_NAMES`, `DrumVoice` gained/renamed a voice — add the matching entry; the `Record<DrumVoice, string>` type makes this a compile error, not a silent gap.

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-subgroups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/drum-subgroups.ts src/engines/drum-subgroups.test.ts
git commit -m "feat(automation): drum voice display names for destination sub-groups"
```

---

### Task 3: Extract `noteName` into a pure module

**Files:**
- Create: `src/engines/note-name.ts`
- Modify: `src/engines/sampler-keyboard-map.ts` (import + re-export `noteName`, drop the local copy)
- Test: `src/engines/note-name.test.ts`

**Interfaces:**
- Produces: `noteName(midi: number): string` (e.g. `60 → "C4"`), also `NOTE_NAMES: string[]`, `pc(m: number): number`.

- [ ] **Step 1: Write the failing test**

Create `src/engines/note-name.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { noteName } from './note-name';
import { noteName as reExported } from './sampler-keyboard-map';

describe('noteName', () => {
  it('names a MIDI note in Loom\'s octave convention', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(57)).toBe('A3');
  });
  it('is the same function sampler-keyboard-map re-exports (no drift)', () => {
    expect(reExported).toBe(noteName);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/note-name.test.ts`
Expected: FAIL — `./note-name` not found.

- [ ] **Step 3: Create the pure module**

Create `src/engines/note-name.ts`:

```ts
// src/engines/note-name.ts
// Pure MIDI-note → name helper (e.g. 60 → "C4"). Extracted from
// sampler-keyboard-map so lightweight modules (the sampler metadata descriptor,
// automation sub-group labels) can name a note without importing the keymap
// renderer's DOM code.
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const pc = (m: number): number => ((m % 12) + 12) % 12;
/** e.g. 60 → "C4" (the octave convention Loom's sampler UI already shows). */
export const noteName = (m: number): string => `${NOTE_NAMES[pc(m)]}${Math.floor(m / 12) - 1}`;
```

- [ ] **Step 4: Point `sampler-keyboard-map.ts` at it**

In `src/engines/sampler-keyboard-map.ts`, replace the three local lines:

```ts
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const pc = (m: number): number => ((m % 12) + 12) % 12;
const isBlack = (m: number): boolean => BLACK.has(pc(m));
/** e.g. 38 → "D1" (MIDI octave −1 convention used across Loom). */
export const noteName = (m: number): string => `${NOTE_NAMES[pc(m)]}${Math.floor(m / 12) - 1}`;
```

with:

```ts
import { pc, noteName } from './note-name';
export { noteName } from './note-name';
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (m: number): boolean => BLACK.has(pc(m));
```

Put the `import` line up with the other imports at the top of the file (not mid-body); keep the `export { noteName }` and the `BLACK`/`isBlack` lines where the old definitions were. Leave every other use of `noteName` / `isBlack` in the file untouched — they now resolve to the imported versions.

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/note-name.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck (the re-export must not break `sampler-keyboard-map`'s importers)**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/engines/note-name.ts src/engines/note-name.test.ts src/engines/sampler-keyboard-map.ts
git commit -m "refactor(engines): extract pure noteName into note-name.ts"
```

---

### Task 4: Sampler pad sub-groups + dynamic params (pure module)

**Files:**
- Create: `src/engines/sampler-subgroups.ts`
- Test: `src/engines/sampler-subgroups.test.ts`

**Interfaces:**
- Consumes: `PAD_LEAF_SPECS`, `padKeyForNote`, `noteForPadKey` from `./sampler-pad-params`; `noteName` from `./note-name`; `SessionLane` from `../session/session`.
- Produces:
  - `samplerDynamicParamsFor(lane: SessionLane): EngineParamSpec[]` — one `<zone{note}>.<leaf>` spec per keymap entry × pad leaf.
  - `samplerSubGroupFor(paramId: string): { key: string; label: string } | undefined` — pad key → note name.

- [ ] **Step 1: Write the failing test**

Create `src/engines/sampler-subgroups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { samplerDynamicParamsFor, samplerSubGroupFor } from './sampler-subgroups';
import type { SessionLane } from '../session/session';

function samplerLane(rootNotes: number[]): SessionLane {
  return {
    id: 'S', name: 'Sampler', engineId: 'sampler', clips: [], inserts: [],
    engineState: { sampler: { keymap: rootNotes.map((n) => ({ sampleId: 'x', rootNote: n, loNote: n, hiNote: n })) } },
  } as SessionLane;
}

describe('samplerDynamicParamsFor', () => {
  it('emits a <zone{note}>.<leaf> spec per keymap entry', () => {
    const specs = samplerDynamicParamsFor(samplerLane([60, 62]));
    const ids = specs.map((s) => s.id);
    expect(ids).toContain('zone60.tune');
    expect(ids).toContain('zone62.tune');
    expect(ids).toContain('zone60.cutoff');
  });
  it('is empty when the lane has no keymap', () => {
    expect(samplerDynamicParamsFor({ id: 'S', name: 'S', engineId: 'sampler', clips: [], inserts: [] } as SessionLane)).toEqual([]);
  });
});

describe('samplerSubGroupFor', () => {
  it('maps a pad param to its note name', () => {
    expect(samplerSubGroupFor('zone60.tune')).toEqual({ key: 'zone60', label: 'C4' });
  });
  it('returns undefined for the sampler globals', () => {
    expect(samplerSubGroupFor('gain')).toBeUndefined();
    expect(samplerSubGroupFor('poly.voices')).toBeUndefined();
  });
});
```

> The fixture uses `as SessionLane` on an object carrying exactly the fields the hooks read (`id/name/engineId/clips/inserts` + optional `engineState.sampler.keymap`) — the same lane shape `automation-targets.test.ts` already builds. If `SessionLane` requires a field the literal omits, `tsc` flags it; add the real field rather than widening the cast.

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-subgroups.test.ts`
Expected: FAIL — `./sampler-subgroups` not found.

- [ ] **Step 3: Write the module**

Create `src/engines/sampler-subgroups.ts`:

```ts
// src/engines/sampler-subgroups.ts
// Presentation + dynamic-catalogue support for the Sampler's per-pad params.
//
// The Sampler's per-pad params (`zone<note>.tune`, …) are NOT in the static
// param spec — they depend on the lane's keymap, which lives in the session
// (`lane.engineState.sampler.keymap`). listAutomationTargets calls
// samplerDynamicParamsFor to fold them into the destination catalogue, and
// samplerSubGroupFor names each pad by its note for the dropdown heading.
//
// The label is the NOTE, deliberately: the sample's *name* is not in the session
// (only an opaque sampleId + the note), so naming a pad by its sample would
// reintroduce the load-order staleness the destination registry exists to kill.
import type { EngineParamSpec } from './engine-params';
import type { SessionLane } from '../session/session';
import { PAD_LEAF_SPECS, padKeyForNote, noteForPadKey } from './sampler-pad-params';
import { noteName } from './note-name';

export function samplerDynamicParamsFor(lane: SessionLane): EngineParamSpec[] {
  const keymap = lane.engineState?.sampler?.keymap ?? [];
  const out: EngineParamSpec[] = [];
  for (const entry of keymap) {
    const key = padKeyForNote(entry.rootNote);
    for (const s of PAD_LEAF_SPECS) {
      const { leaf, ...rest } = s;
      out.push({ ...rest, id: `${key}.${leaf}` });
    }
  }
  return out;
}

const PAD_KEY_RE = /^zone-?\d+$/;

export function samplerSubGroupFor(paramId: string): { key: string; label: string } | undefined {
  const dot = paramId.indexOf('.');
  const seg = dot < 0 ? paramId : paramId.slice(0, dot);
  if (!PAD_KEY_RE.test(seg)) return undefined;
  return { key: seg, label: noteName(noteForPadKey(seg)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-subgroups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler-subgroups.ts src/engines/sampler-subgroups.test.ts
git commit -m "feat(automation): sampler per-pad dynamic params + note sub-groups"
```

---

### Task 5: Wire the hooks into the drums + sampler descriptors

**Files:**
- Modify: `src/engines/drums-engine.ts`
- Modify: `src/engines/sampler.ts`
- Test: `src/engines/multistrip-descriptor-hooks.test.ts` (create)

**Interfaces:**
- Consumes: `drumSubGroupFor` (Task 2), `samplerSubGroupFor` + `samplerDynamicParamsFor` (Task 4), the config fields (Task 1).

- [ ] **Step 1: Write the failing test**

Create `src/engines/multistrip-descriptor-hooks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// Side-effect imports register the real metadata descriptors. test/setup.ts
// globalises node-web-audio-api, so pulling drums-engine (which transitively
// imports the worklet engine) is safe here.
import './drums-engine';
import './sampler';
import { getEngine } from './registry';
import type { SessionLane } from '../session/session';

describe('drums descriptor', () => {
  it('exposes subGroupFor mapping a voice param to its name', () => {
    expect(getEngine('drums-machine')!.subGroupFor!('snare.tone')).toEqual({ key: 'snare', label: 'Snare' });
    expect(getEngine('drums-machine')!.subGroupFor!('bus.level')).toBeUndefined();
  });
  it('has no dynamicParamsFor (its per-voice params are static)', () => {
    expect(getEngine('drums-machine')!.dynamicParamsFor).toBeUndefined();
  });
});

describe('sampler descriptor', () => {
  const lane = {
    id: 'S', name: 'Sampler', engineId: 'sampler', clips: [], inserts: [],
    engineState: { sampler: { keymap: [{ sampleId: 'x', rootNote: 60, loNote: 60, hiNote: 60 }] } },
  } as SessionLane;

  it('emits per-pad params via dynamicParamsFor', () => {
    const ids = getEngine('sampler')!.dynamicParamsFor!(lane).map((s) => s.id);
    expect(ids).toContain('zone60.tune');
  });
  it('names a pad param by its note via subGroupFor', () => {
    expect(getEngine('sampler')!.subGroupFor!('zone60.cutoff')).toEqual({ key: 'zone60', label: 'C4' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/multistrip-descriptor-hooks.test.ts`
Expected: FAIL — `subGroupFor` / `dynamicParamsFor` are undefined on the descriptors.

- [ ] **Step 3: Wire the drums descriptor**

In `src/engines/drums-engine.ts`, add the import near the top:

```ts
import { drumSubGroupFor } from './drum-subgroups';
```

and add one line to the `createDescriptorEngine({...})` config inside `makeDrumsDescriptor`:

```ts
    modulators: DRUMS_DEFAULT_MODULATORS,
    subGroupFor: drumSubGroupFor,
```

- [ ] **Step 4: Wire the sampler descriptor**

In `src/engines/sampler.ts`, add the import near the top:

```ts
import { samplerDynamicParamsFor, samplerSubGroupFor } from './sampler-subgroups';
```

and add two lines to the `createDescriptorEngine({...})` config inside `makeSamplerDescriptor`:

```ts
    presets: () => [],
    subGroupFor: samplerSubGroupFor,
    dynamicParamsFor: samplerDynamicParamsFor,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/multistrip-descriptor-hooks.test.ts`
Expected: PASS (all four).

- [ ] **Step 6: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/sampler.ts src/engines/multistrip-descriptor-hooks.test.ts
git commit -m "feat(automation): wire drums/sampler descriptors to sub-group + dynamic-param hooks"
```

---

### Task 6: `listAutomationTargets` merges dynamic params + attaches `subGroup`

**Files:**
- Modify: `src/automation/automation-targets.ts` (`listAutomationTargets` + its `push` closure)
- Test: `src/automation/automation-targets-multistrip.test.ts` (create)

**Interfaces:**
- Consumes: `SynthEngine.subGroupFor` / `dynamicParamsFor` (Task 1), the wired descriptors (Task 5).
- Produces: `AutomationTarget[]` where per-voice/per-pad targets carry `subGroup`.

- [ ] **Step 1: Write the failing test**

Create `src/automation/automation-targets-multistrip.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { listAutomationTargets } from './automation-targets';
// Register the real descriptors so getEngine() finds their params + hooks.
import '../engines/drums-engine';
import '../engines/sampler';
import '../engines/subtractive';
import { emptySessionState, type SessionState } from '../session/session';

function stateWith(lane: unknown): SessionState {
  return { ...emptySessionState(), lanes: [lane] } as SessionState;
}

describe('listAutomationTargets — multi-strip sub-groups', () => {
  it('tags a drum voice param with its voice sub-group; the bus has none', () => {
    const targets = listAutomationTargets(
      stateWith({ id: 'D', name: 'Drums', engineId: 'drums-machine', clips: [], inserts: [] }),
      new Map(),
    );
    const kick = targets.find((t) => t.id === 'D.kick.tune');
    expect(kick?.subGroup).toEqual({ key: 'kick', label: 'Kick' });
    const bus = targets.find((t) => t.id === 'D.bus.level');
    expect(bus?.subGroup).toBeUndefined();
  });

  it('folds sampler per-pad params in from the keymap, tagged by note', () => {
    const targets = listAutomationTargets(
      stateWith({
        id: 'S', name: 'Sampler', engineId: 'sampler', clips: [], inserts: [],
        engineState: { sampler: { keymap: [{ sampleId: 'x', rootNote: 60, loNote: 60, hiNote: 60 }] } },
      }),
      new Map(),
    );
    const tune = targets.find((t) => t.id === 'S.zone60.tune');
    expect(tune?.subGroup).toEqual({ key: 'zone60', label: 'C4' });
    // The continuous filter still applies to dynamic params: discrete pad
    // leaves (loop/retrig/chokeGroup) are not automation destinations.
    expect(targets.some((t) => t.id === 'S.zone60.loop')).toBe(false);
  });

  it('leaves single-strip engine params without a sub-group', () => {
    const targets = listAutomationTargets(
      stateWith({ id: 'P', name: 'Sub', engineId: 'subtractive', clips: [], inserts: [] }),
      new Map(),
    );
    const anyP = targets.find((t) => t.laneId === 'P');
    expect(anyP).toBeDefined();
    expect(anyP!.subGroup).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-targets-multistrip.test.ts`
Expected: FAIL — targets have no `subGroup`, and `S.zone60.tune` is absent (dynamic params not merged yet).

- [ ] **Step 3: Update `push` + the engine-param loop**

In `src/automation/automation-targets.ts`, inside `listAutomationTargets`, change the `push` closure to accept a `subGroup` and the engine loop to merge dynamic params + pass the sub-group. Replace this block:

```ts
    // A live knob, when mounted, is the authority on how the param reads.
    const push = (id: string, label: string, min: number, max: number) => {
      const live = registry.get(id);
      targets.push({
        id,
        laneId: lane.id,
        laneName,
        label: live?.meta.label ?? label,
        min: live?.meta.min ?? min,
        max: live?.meta.max ?? max,
      });
    };

    const engine = getEngine(lane.engineId);
    for (const spec of engine?.params ?? []) {
      if (spec.kind !== 'continuous') continue;
      push(`${lane.id}.${spec.id}`, spec.label, spec.min, spec.max);
    }
```

with:

```ts
    // A live knob, when mounted, is the authority on how the param reads.
    const push = (
      id: string, label: string, min: number, max: number,
      subGroup?: { key: string; label: string },
    ) => {
      const live = registry.get(id);
      targets.push({
        id,
        laneId: lane.id,
        laneName,
        label: live?.meta.label ?? label,
        min: live?.meta.min ?? min,
        max: live?.meta.max ?? max,
        ...(subGroup ? { subGroup } : {}),
      });
    };

    const engine = getEngine(lane.engineId);
    // Static params + any per-lane dynamic params the engine derives from the
    // session (the sampler's per-pad params, from the lane keymap). The engine
    // owns both the sub-group naming and the dynamic list — the catalogue never
    // learns what a voice or a pad is.
    const engineSpecs = [...(engine?.params ?? []), ...(engine?.dynamicParamsFor?.(lane) ?? [])];
    for (const spec of engineSpecs) {
      if (spec.kind !== 'continuous') continue;
      push(`${lane.id}.${spec.id}`, spec.label, spec.min, spec.max, engine?.subGroupFor?.(spec.id));
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-targets-multistrip.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Re-run the existing catalogue test (no regression)**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-targets.test.ts`
Expected: PASS (3 tests) — the `push` change is backward-compatible (5th arg optional).

- [ ] **Step 6: Commit**

```bash
git add src/automation/automation-targets.ts src/automation/automation-targets-multistrip.test.ts
git commit -m "feat(automation): fold dynamic params + sub-groups into the destination catalogue"
```

---

### Task 7: `groupTargetsByLane` splits by lane + sub-group

**Files:**
- Modify: `src/automation/automation-targets.ts` (`groupTargetsByLane`)
- Test: `src/automation/group-targets-subgroup.test.ts` (create)

**Interfaces:**
- Consumes: `AutomationTarget.subGroup`.
- Produces: header keys `"<laneName>"` (no sub-group) or `"<laneName> · <subGroup.label>"`.

- [ ] **Step 1: Write the failing test**

Create `src/automation/group-targets-subgroup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupTargetsByLane, type AutomationTarget } from './automation-targets';

const t = (id: string, laneName: string, label: string, sub?: { key: string; label: string }): AutomationTarget => ({
  id, laneId: 'x', laneName, label, min: 0, max: 1, ...(sub ? { subGroup: sub } : {}),
});

describe('groupTargetsByLane with sub-groups', () => {
  it('splits a multi-strip lane into one header per sub-group', () => {
    const groups = groupTargetsByLane([
      t('D.bus.level', 'Drums', 'Vol'),
      t('D.kick.tune', 'Drums', 'TUNE', { key: 'kick', label: 'Kick' }),
      t('D.clap.tone', 'Drums', 'TONE', { key: 'clap', label: 'Clap' }),
    ]);
    expect([...groups.keys()]).toEqual(['Drums', 'Drums · Kick', 'Drums · Clap']);
    expect(groups.get('Drums · Kick')!.map((x) => x.label)).toEqual(['TUNE']);
  });

  it('does not merge same-named sub-groups across two lanes', () => {
    const groups = groupTargetsByLane([
      t('D1.kick.tune', 'Drums 1', 'TUNE', { key: 'kick', label: 'Kick' }),
      t('D2.kick.tune', 'Drums 2', 'TUNE', { key: 'kick', label: 'Kick' }),
    ]);
    expect([...groups.keys()]).toEqual(['Drums 1 · Kick', 'Drums 2 · Kick']);
  });

  it('leaves single-strip targets grouped by lane name alone', () => {
    const groups = groupTargetsByLane([t('P.cutoff', 'Sub 1', 'Cutoff')]);
    expect([...groups.keys()]).toEqual(['Sub 1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/automation/group-targets-subgroup.test.ts`
Expected: FAIL — all targets currently group under the bare lane name.

- [ ] **Step 3: Update `groupTargetsByLane`**

In `src/automation/automation-targets.ts`, replace the loop body:

```ts
export function groupTargetsByLane(targets: AutomationTarget[]): Map<string, AutomationTarget[]> {
  const groups = new Map<string, AutomationTarget[]>();
  for (const t of targets) {
    const key = t.subGroup ? `${t.laneName} · ${t.subGroup.label}` : t.laneName;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(t);
  }
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/automation/group-targets-subgroup.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/automation/automation-targets.ts src/automation/group-targets-subgroup.test.ts
git commit -m "feat(automation): group destination pickers by lane + strip sub-group"
```

---

### Task 8: Show the strip in an existing automation lane's header

**Files:**
- Modify: `src/automation/automation-targets.ts` (add `automationTargetLabel` helper)
- Modify: `src/session/clip-automation-lanes.ts` (use it)
- Test: `src/automation/automation-target-label.test.ts` (create)

**Interfaces:**
- Produces: `automationTargetLabel(target: AutomationTarget | undefined, paramId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/automation/automation-target-label.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { automationTargetLabel, type AutomationTarget } from './automation-targets';

const base: AutomationTarget = { id: 'D.kick.tune', laneId: 'D', laneName: 'Drums', label: 'TUNE', min: 0, max: 1 };

describe('automationTargetLabel', () => {
  it('includes the strip when the target has a sub-group', () => {
    expect(automationTargetLabel({ ...base, subGroup: { key: 'kick', label: 'Kick' } }, 'D.kick.tune'))
      .toBe('Drums · Kick · TUNE');
  });
  it('is lane · param for a single-strip target', () => {
    expect(automationTargetLabel({ id: 'P.cutoff', laneId: 'P', laneName: 'Sub', label: 'Cutoff', min: 0, max: 1 }, 'P.cutoff'))
      .toBe('Sub · Cutoff');
  });
  it('falls back to the raw id when the target is gone', () => {
    expect(automationTargetLabel(undefined, 'D.kick.tune')).toBe('D.kick.tune (unavailable)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-target-label.test.ts`
Expected: FAIL — `automationTargetLabel` not exported.

- [ ] **Step 3: Add the helper**

In `src/automation/automation-targets.ts`, append:

```ts
/** The header text for an automation lane bound to `paramId`. Includes the
 *  strip (drum voice / sampler pad) when the target has a sub-group, so a
 *  created lane shows WHICH strip it edits — not just "Drums · TUNE". Falls
 *  back to the raw id, flagged, when the session no longer declares the param. */
export function automationTargetLabel(target: AutomationTarget | undefined, paramId: string): string {
  if (!target) return `${paramId} (unavailable)`;
  const head = target.subGroup ? `${target.laneName} · ${target.subGroup.label}` : target.laneName;
  return `${head} · ${target.label}`;
}
```

- [ ] **Step 4: Use it in `clip-automation-lanes.ts`**

In `src/session/clip-automation-lanes.ts`, add to the import from `../automation/automation-targets`:

```ts
import { groupTargetsByLane, automationTargetLabel, type AutomationTarget } from '../automation/automation-targets';
```

and replace the label assignment (currently `label.textContent = target ? \`${target.laneName} · ${target.label}\` : \`${env.paramId} (unavailable)\`;`) with:

```ts
    label.textContent = automationTargetLabel(target, env.paramId);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-target-label.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add src/automation/automation-targets.ts src/session/clip-automation-lanes.ts src/automation/automation-target-label.test.ts
git commit -m "feat(automation): show the strip in a created automation lane's header"
```

---

### Task 9: Whole-branch verification + manual look

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit`
Expected: all green. (If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` in teardown but every test passed, that's the known flaky teardown — re-run to confirm.)

- [ ] **Step 3: Production build (required before any browser check)**

Run: `npm run build`
Expected: `tsc` clean + Vite bundle written.

- [ ] **Step 4: Manual look — drums (approved-mockup parity)**

Start the worktree dev server (`npm run dev`), open in **real Chrome** (not the VS Code browser). On a **Drums** lane: open the modulators panel → the LFO/ADSR "+ Destination" dropdown. Confirm the `TUNE`/`DECAY`/… options sit under per-voice headings (`Drums · Kick`, `Drums · Snare`, `Closed Hat`, …), not eight bare `TUNE`s. Also check the clip **Automation** picker and, if reachable, the XY-pad axis dropdowns. Screenshot and compare against the spec's sketch (`docs/superpowers/specs/2026-07-21-destinos-multi-strip-labels-design.md`).

- [ ] **Step 5: Manual look — sampler**

On a **Sampler** lane with a loaded kit/keymap: open the same dropdowns. Confirm per-pad params now appear (they didn't before this work) under per-note headings (`Sampler · C4`, …). Create a clip automation lane on one pad param and confirm its header reads `Sampler · <Note> · <PARAM>`.

- [ ] **Step 6: Report**

Report the manual result (with screenshots) to the user. State plainly the known limitation: per-strip params are automatable via clip/performance/XY envelopes (write at next trigger) but are **not** LFO-bindable — parity with the drum per-voice params already on `main`.

---

## Self-review notes

- **Spec coverage:** sub-group data model (Task 1) ✓; drums voice headers (Tasks 2, 5, 6, 7) ✓; sampler note headers + getting per-pad params INTO the catalogue — the extra scope the user approved — (Tasks 3, 4, 5, 6) ✓; single-strip engines unchanged (Task 6/7 controls) ✓; two same-named sub-groups don't merge cross-lane (Task 7) ✓; existing-lane header shows the strip (Task 8) ✓; the four pickers inherit headers with no per-caller edits (grouping centralised in Task 7) ✓; note-not-sample-name rationale honoured (Task 4 comment) ✓.
- **Boundary rule:** every bit of "what is a voice/pad" lives in `drum-subgroups.ts` / `sampler-subgroups.ts` (on the engine side); the catalogue only calls hooks (Task 6). ✓
- **Out of scope, untouched:** knob right-click menu; any paramId or saved data; LFO bindability of per-strip params (stated as a known limitation, Task 9 Step 6).
