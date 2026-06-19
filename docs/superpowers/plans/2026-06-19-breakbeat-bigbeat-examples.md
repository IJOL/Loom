# Breakbeat / Big Beat Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a combined "Breakbeat / Big Beat" genre — style picker entry, genre generators (with a broken-beat extension), and a full curated example gallery (bass + melody + beat).

**Architecture:** The musicality system is keyed on `StyleId` + `STYLE_CATALOG`. Adding a style cascades automatically into the style `<select>` and the inspector example picker. The generator config maps are `Record<StyleId, …>` (TS-exhaustive), so the new style must carry bass/melody/beat configs. A minimal optional `breakbeat?` flag on `BeatCfg` gives `genBeat` real syncopation. Curated patterns live in a new `public/examples/breakbeat.json`.

**Tech Stack:** TypeScript, Vite, Vitest. Pure-logic modules (`src/core/`), JSON assets (`public/examples/`).

## Global Constraints

- All user-facing strings in **English** (style label, example names). Spanish is only for chat.
- Style label is exactly `Breakbeat / Big Beat`; `StyleId` is `breakbeat`.
- Melodic examples (bass/melody) stored as **scale degrees** (`degrees[]`); beats stored as raw **GM notes** (`notes[]`): kick 36, snare 38, closed hat 42, open hat 46, clap 39.
- Tick grid: 1 bar 4/4 = 384 ticks = 16 steps × 24 ticks (`TICKS_PER_STEP = 24`).
- Test assertions are **relative/structural**, never absolute magnitudes.
- One test per user path; UI/content "done" requires a live ear-check, not just green tests.
- Tests run colour-free: `NO_COLOR=1 npx vitest run <file>`.

---

### Task 1: Register the style + generator configs + broken-beat extension

This must land as one unit: adding `breakbeat` to `StyleId` makes the `Record<StyleId>` config maps in `generators.ts` fail `tsc` until all three configs exist, so type + catalog + configs + the `genBeat` extension commit together.

**Files:**
- Modify: `src/core/musicality.ts` (`StyleId` type ~line 7; `STYLE_CATALOG` ~line 29-34)
- Modify: `src/core/generators.ts` (`BASS` ~19-24, `MEL` ~26-31, `BeatCfg`/`BEAT` ~32-38, `genBeat` ~89-107)
- Test: `src/core/generators.test.ts`

**Interfaces:**
- Consumes: existing `generate(kind, style, ctx)`, `inScale`, `GenContext`, `BeatCfg`, `GM`, `ACCENT`, `NORM`, `TICKS_PER_STEP`.
- Produces: `StyleId` now includes `'breakbeat'`; `BeatCfg` gains optional `breakbeat?: boolean`; `generate('beat', 'breakbeat', ctx)` returns a broken beat (a kick off the beat grid) but still kicks on the first downbeat; `generate('bass'|'melody', 'breakbeat', ctx)` returns in-scale notes.

- [ ] **Step 1: Write the failing tests**

Add to `src/core/generators.test.ts`. First add the import at the top (after the existing imports):

```ts
import { TICKS_PER_STEP } from './notes';
```

Then add these tests inside the `describe('genre generators', …)` block:

```ts
  it('breakbeat bass and melody notes are all in scale', () => {
    for (const kind of ['bass', 'melody'] as const) {
      const notes = generate(kind, 'breakbeat', ctx());
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
    }
  });

  it('breakbeat beat is broken: a kick lands off the beat grid', () => {
    const notes = generate('beat', 'breakbeat', ctx({ stepsPerBar: 16 }));
    const beatTicks = (16 / 4) * TICKS_PER_STEP; // 4 steps/beat × 24 = 96
    const offGridKick = notes.some((n) => n.midi === 36 && n.start % beatTicks !== 0);
    expect(offGridKick).toBe(true);
  });

  it('breakbeat beat still kicks on the first downbeat', () => {
    const notes = generate('beat', 'breakbeat', ctx());
    expect(notes.some((n) => n.midi === 36 && n.start === 0)).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/core/generators.test.ts`
Expected: FAIL — TypeScript rejects `'breakbeat'` as not assignable to `StyleId` (compile error), and/or the new assertions fail.

- [ ] **Step 3: Add `breakbeat` to the type and catalog**

In `src/core/musicality.ts`, change the `StyleId` union:

```ts
export type StyleId = 'acid' | 'house' | 'synthwave' | 'lofi' | 'breakbeat';
```

And append to `STYLE_CATALOG` (after the `lofi` entry):

```ts
  { id: 'breakbeat', label: 'Breakbeat / Big Beat' },
```

- [ ] **Step 4: Add the three generator configs**

In `src/core/generators.ts`, add a `breakbeat` entry to each map.

To `BASS` (after `lofi`):

```ts
  breakbeat: { density: 0.5,  octaves: [0, 1],     slideChance: 0.15, accentChance: 0.3,  degreePool: [0, 0, 4, 3, 6, 2] },
```

To `MEL` (after `lofi`):

```ts
  breakbeat: { density: 0.32, longChance: 0.15, spanDegrees: 7 },
```

Extend the `BeatCfg` interface with the optional flag:

```ts
interface BeatCfg { kickEveryBeat: boolean; snareBackbeat: boolean; hatChance: number; hatStep: number; openHatChance: number; breakbeat?: boolean; }
```

And add to `BEAT` (after `lofi`):

```ts
  breakbeat: { kickEveryBeat: false, snareBackbeat: true,  hatChance: 0.85, hatStep: 1, openHatChance: 0.12, breakbeat: true },
```

- [ ] **Step 5: Add the broken-beat block to `genBeat`**

In `src/core/generators.ts`, inside `genBeat`, insert this block **after** the main `for` loop and **before** the `// guarantee: kick on the first downbeat` line:

```ts
  // breakbeat character: syncopated kicks off the beat grid + sparse ghost snares.
  if (cfg.breakbeat) {
    for (let b = 0; b < c.bars; b++) {
      const base = b * c.stepsPerBar;
      at(base + Math.round(stepsPerBeat * 1.5), GM.kick, NORM);              // "and of beat 2"
      if (c.rng() < 0.5) at(base + Math.round(stepsPerBeat * 2.5), GM.kick, NORM); // "and of beat 3"
      for (const off of [Math.round(stepsPerBeat * 0.5), Math.round(stepsPerBeat * 3.5)]) {
        if (c.rng() < 0.35) at(base + off, GM.snare, 45);                    // ghost snares
      }
    }
  }
```

(`stepsPerBeat * 1.5` = step 6 for a 16-step bar → tick 144, which is off the 96-tick beat grid, so the "broken" assertion fires unconditionally and deterministically.)

- [ ] **Step 6: Run the tests to verify they pass + typecheck**

Run: `NO_COLOR=1 npx vitest run src/core/generators.test.ts && npx tsc --noEmit`
Expected: PASS (all generator tests, including the three new ones) and clean typecheck (the `Record<StyleId>` exhaustiveness confirms all configs present).

- [ ] **Step 7: Commit**

```bash
git add src/core/musicality.ts src/core/generators.ts src/core/generators.test.ts
git commit -m "feat(musicality): add Breakbeat / Big Beat genre + broken-beat generator"
```

---

### Task 2: Curated example gallery JSON + loader validation

**Files:**
- Create: `public/examples/breakbeat.json`
- Test: `src/session/example-loader.test.ts`

**Interfaces:**
- Consumes: `validateExample`, `Example` type, `StyleId` (`'breakbeat'` from Task 1).
- Produces: a loadable `breakbeat` example file (6 beats, 5 basses, 5 melodies) surfaced automatically by the inspector example picker.

- [ ] **Step 1: Write the failing test**

Add to `src/session/example-loader.test.ts`, inside the top-level `describe('example loader', …)` block:

```ts
  it('validates breakbeat beat and bass examples', () => {
    const bbBeat: Example = {
      id: 'breakbeat-beat-1', name: 'Classic Breakbeat', style: 'breakbeat', kind: 'beat', bars: 1,
      notes: [{ start: 0, duration: 24, midi: 36, velocity: 115 }],
    };
    const bbBass: Example = {
      id: 'breakbeat-bass-1', name: 'Funk Octave Riff', style: 'breakbeat', kind: 'bass', bars: 1,
      degrees: [{ start: 0, duration: 22, degree: 0, octave: 0, velocity: 110 }],
    };
    expect(validateExample(bbBeat)).toBe(true);
    expect(validateExample(bbBass)).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/example-loader.test.ts`
Expected: FAIL — `style: 'breakbeat'` is rejected by TypeScript unless Task 1 landed; if Task 1 landed, this compiles but the file under test is still absent (the test itself passes once the type exists — so if it already passes, that's fine; the real deliverable is the JSON below). If it fails to compile, Task 1 is incomplete.

- [ ] **Step 3: Create the curated JSON**

Create `public/examples/breakbeat.json` with this exact content:

```json
{
  "style": "breakbeat",
  "examples": [
    {
      "id": "breakbeat-beat-1",
      "name": "Classic Breakbeat",
      "style": "breakbeat",
      "kind": "beat",
      "bars": 1,
      "notes": [
        { "start":   0, "duration": 24, "midi": 36, "velocity": 115 },
        { "start": 240, "duration": 24, "midi": 36, "velocity": 100 },
        { "start":  96, "duration": 24, "midi": 38, "velocity": 110 },
        { "start": 288, "duration": 24, "midi": 38, "velocity": 110 },
        { "start": 168, "duration": 24, "midi": 38, "velocity": 45  },
        { "start": 264, "duration": 24, "midi": 38, "velocity": 40  },
        { "start":   0, "duration": 12, "midi": 42, "velocity": 70  },
        { "start":  48, "duration": 12, "midi": 42, "velocity": 70  },
        { "start":  96, "duration": 12, "midi": 42, "velocity": 70  },
        { "start": 144, "duration": 12, "midi": 42, "velocity": 70  },
        { "start": 192, "duration": 12, "midi": 42, "velocity": 70  },
        { "start": 240, "duration": 12, "midi": 42, "velocity": 70  },
        { "start": 288, "duration": 12, "midi": 42, "velocity": 70  },
        { "start": 336, "duration": 18, "midi": 46, "velocity": 82  }
      ]
    },
    {
      "id": "breakbeat-beat-2",
      "name": "Funky Break",
      "style": "breakbeat",
      "kind": "beat",
      "bars": 1,
      "notes": [
        { "start":   0, "duration": 24, "midi": 36, "velocity": 115 },
        { "start": 120, "duration": 24, "midi": 36, "velocity": 85  },
        { "start": 240, "duration": 24, "midi": 36, "velocity": 100 },
        { "start":  96, "duration": 24, "midi": 38, "velocity": 110 },
        { "start": 288, "duration": 24, "midi": 38, "velocity": 110 },
        { "start": 360, "duration": 24, "midi": 38, "velocity": 45  },
        { "start":   0, "duration": 12, "midi": 42, "velocity": 68  },
        { "start":  48, "duration": 12, "midi": 42, "velocity": 68  },
        { "start":  96, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 192, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 240, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 288, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 144, "duration": 18, "midi": 46, "velocity": 76  },
        { "start": 336, "duration": 18, "midi": 46, "velocity": 78  }
      ]
    },
    {
      "id": "breakbeat-beat-3",
      "name": "Amen 2-Bar",
      "style": "breakbeat",
      "kind": "beat",
      "bars": 2,
      "notes": [
        { "start":   0, "duration": 24, "midi": 36, "velocity": 115 },
        { "start": 240, "duration": 24, "midi": 36, "velocity": 100 },
        { "start":  96, "duration": 24, "midi": 38, "velocity": 110 },
        { "start": 288, "duration": 24, "midi": 38, "velocity": 110 },
        { "start": 168, "duration": 24, "midi": 38, "velocity": 45  },
        { "start":   0, "duration": 12, "midi": 42, "velocity": 68  },
        { "start":  48, "duration": 12, "midi": 42, "velocity": 68  },
        { "start":  96, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 144, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 192, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 240, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 288, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 336, "duration": 12, "midi": 42, "velocity": 68  },
        { "start": 384, "duration": 24, "midi": 36, "velocity": 112 },
        { "start": 648, "duration": 24, "midi": 36, "velocity": 100 },
        { "start": 480, "duration": 24, "midi": 38, "velocity": 110 },
        { "start": 720, "duration": 24, "midi": 38, "velocity": 108 },
        { "start": 552, "duration": 24, "midi": 38, "velocity": 45  },
        { "start": 600, "duration": 24, "midi": 38, "velocity": 42  },
        { "start": 696, "duration": 24, "midi": 38, "velocity": 48  },
        { "start": 384, "duration": 12, "midi": 42, "velocity": 66  },
        { "start": 432, "duration": 12, "midi": 42, "velocity": 66  },
        { "start": 480, "duration": 12, "midi": 42, "velocity": 66  },
        { "start": 528, "duration": 12, "midi": 42, "velocity": 66  },
        { "start": 576, "duration": 12, "midi": 42, "velocity": 66  },
        { "start": 624, "duration": 12, "midi": 42, "velocity": 66  },
        { "start": 672, "duration": 12, "midi": 42, "velocity": 66  },
        { "start": 744, "duration": 18, "midi": 46, "velocity": 80  }
      ]
    },
    {
      "id": "breakbeat-beat-4",
      "name": "Big Beat Stomp",
      "style": "breakbeat",
      "kind": "beat",
      "bars": 1,
      "notes": [
        { "start":   0, "duration": 24, "midi": 36, "velocity": 120 },
        { "start":  48, "duration": 24, "midi": 36, "velocity": 95  },
        { "start": 192, "duration": 24, "midi": 36, "velocity": 110 },
        { "start":  96, "duration": 24, "midi": 38, "velocity": 118 },
        { "start":  96, "duration": 24, "midi": 39, "velocity": 100 },
        { "start": 288, "duration": 24, "midi": 38, "velocity": 118 },
        { "start": 288, "duration": 24, "midi": 39, "velocity": 100 },
        { "start":   0, "duration": 12, "midi": 42, "velocity": 60  },
        { "start":  96, "duration": 12, "midi": 42, "velocity": 60  },
        { "start": 192, "duration": 12, "midi": 42, "velocity": 60  },
        { "start": 288, "duration": 12, "midi": 42, "velocity": 60  },
        { "start": 144, "duration": 18, "midi": 46, "velocity": 85  },
        { "start": 336, "duration": 18, "midi": 46, "velocity": 88  }
      ]
    },
    {
      "id": "breakbeat-beat-5",
      "name": "Prodigy Punch",
      "style": "breakbeat",
      "kind": "beat",
      "bars": 1,
      "notes": [
        { "start":   0, "duration": 24, "midi": 36, "velocity": 120 },
        { "start":  24, "duration": 24, "midi": 36, "velocity": 90  },
        { "start": 144, "duration": 24, "midi": 36, "velocity": 100 },
        { "start": 168, "duration": 24, "midi": 36, "velocity": 95  },
        { "start": 192, "duration": 24, "midi": 38, "velocity": 120 },
        { "start": 192, "duration": 24, "midi": 39, "velocity": 105 },
        { "start":   0, "duration": 12, "midi": 42, "velocity": 58  },
        { "start":  48, "duration": 12, "midi": 42, "velocity": 58  },
        { "start":  96, "duration": 12, "midi": 42, "velocity": 58  },
        { "start": 144, "duration": 12, "midi": 42, "velocity": 58  },
        { "start": 240, "duration": 12, "midi": 42, "velocity": 58  },
        { "start": 336, "duration": 12, "midi": 42, "velocity": 58  },
        { "start": 288, "duration": 18, "midi": 46, "velocity": 85  }
      ]
    },
    {
      "id": "breakbeat-beat-6",
      "name": "Big Beat Roll",
      "style": "breakbeat",
      "kind": "beat",
      "bars": 2,
      "notes": [
        { "start":   0, "duration": 24, "midi": 36, "velocity": 120 },
        { "start":  48, "duration": 24, "midi": 36, "velocity": 95  },
        { "start": 192, "duration": 24, "midi": 36, "velocity": 110 },
        { "start":  96, "duration": 24, "midi": 38, "velocity": 118 },
        { "start":  96, "duration": 24, "midi": 39, "velocity": 100 },
        { "start": 288, "duration": 24, "midi": 38, "velocity": 118 },
        { "start": 288, "duration": 24, "midi": 39, "velocity": 100 },
        { "start":   0, "duration": 12, "midi": 42, "velocity": 60  },
        { "start":  96, "duration": 12, "midi": 42, "velocity": 60  },
        { "start": 192, "duration": 12, "midi": 42, "velocity": 60  },
        { "start": 144, "duration": 18, "midi": 46, "velocity": 85  },
        { "start": 384, "duration": 24, "midi": 36, "velocity": 120 },
        { "start": 432, "duration": 24, "midi": 36, "velocity": 95  },
        { "start": 576, "duration": 24, "midi": 36, "velocity": 110 },
        { "start": 480, "duration": 24, "midi": 38, "velocity": 118 },
        { "start": 384, "duration": 12, "midi": 42, "velocity": 60  },
        { "start": 480, "duration": 12, "midi": 42, "velocity": 60  },
        { "start": 672, "duration": 24, "midi": 38, "velocity": 90  },
        { "start": 696, "duration": 24, "midi": 38, "velocity": 98  },
        { "start": 720, "duration": 24, "midi": 38, "velocity": 106 },
        { "start": 744, "duration": 24, "midi": 38, "velocity": 115 }
      ]
    },
    {
      "id": "breakbeat-bass-1",
      "name": "Funk Octave Riff",
      "style": "breakbeat",
      "kind": "bass",
      "bars": 1,
      "degrees": [
        { "start":   0, "duration": 22, "degree": 0, "octave": 0, "velocity": 110 },
        { "start":  72, "duration": 22, "degree": 0, "octave": 1, "velocity": 85  },
        { "start": 144, "duration": 22, "degree": 0, "octave": 0, "velocity": 90  },
        { "start": 192, "duration": 22, "degree": 2, "octave": 0, "velocity": 95  },
        { "start": 264, "duration": 22, "degree": 0, "octave": 1, "velocity": 85  },
        { "start": 336, "duration": 22, "degree": 4, "octave": 0, "velocity": 90  }
      ]
    },
    {
      "id": "breakbeat-bass-2",
      "name": "Syncopated Stab",
      "style": "breakbeat",
      "kind": "bass",
      "bars": 1,
      "degrees": [
        { "start":   0, "duration": 22, "degree": 0, "octave": 0, "velocity": 115 },
        { "start":  48, "duration": 22, "degree": 0, "octave": 0, "velocity": 80  },
        { "start": 120, "duration": 22, "degree": 3, "octave": 0, "velocity": 90  },
        { "start": 192, "duration": 22, "degree": 0, "octave": 0, "velocity": 100 },
        { "start": 240, "duration": 22, "degree": 4, "octave": 0, "velocity": 85  },
        { "start": 312, "duration": 22, "degree": 6, "octave": 0, "velocity": 90  }
      ]
    },
    {
      "id": "breakbeat-bass-3",
      "name": "Big Beat Driver",
      "style": "breakbeat",
      "kind": "bass",
      "bars": 1,
      "degrees": [
        { "start":   0, "duration": 72, "degree": 0, "octave": 0, "velocity": 115 },
        { "start":  96, "duration": 48, "degree": 0, "octave": 0, "velocity": 95  },
        { "start": 192, "duration": 72, "degree": 5, "octave": 0, "velocity": 100 },
        { "start": 288, "duration": 48, "degree": 4, "octave": 0, "velocity": 95  }
      ]
    },
    {
      "id": "breakbeat-bass-4",
      "name": "Walking Break",
      "style": "breakbeat",
      "kind": "bass",
      "bars": 1,
      "degrees": [
        { "start":   0, "duration": 22, "degree": 0, "octave": 0, "velocity": 105 },
        { "start":  48, "duration": 22, "degree": 2, "octave": 0, "velocity": 80  },
        { "start":  96, "duration": 22, "degree": 3, "octave": 0, "velocity": 90  },
        { "start": 144, "duration": 22, "degree": 4, "octave": 0, "velocity": 85  },
        { "start": 192, "duration": 22, "degree": 4, "octave": 0, "velocity": 95  },
        { "start": 240, "duration": 22, "degree": 3, "octave": 0, "velocity": 80  },
        { "start": 288, "duration": 22, "degree": 2, "octave": 0, "velocity": 85  },
        { "start": 336, "duration": 22, "degree": 0, "octave": 0, "velocity": 90  }
      ]
    },
    {
      "id": "breakbeat-bass-5",
      "name": "Two-Bar Funk",
      "style": "breakbeat",
      "kind": "bass",
      "bars": 2,
      "degrees": [
        { "start":   0, "duration": 22, "degree": 0, "octave": 0, "velocity": 110 },
        { "start":  72, "duration": 22, "degree": 0, "octave": 1, "velocity": 85  },
        { "start": 144, "duration": 22, "degree": 4, "octave": 0, "velocity": 90  },
        { "start": 216, "duration": 22, "degree": 3, "octave": 0, "velocity": 85  },
        { "start": 288, "duration": 22, "degree": 0, "octave": 0, "velocity": 100 },
        { "start": 336, "duration": 22, "degree": 6, "octave": 0, "velocity": 85  },
        { "start": 384, "duration": 22, "degree": 0, "octave": 0, "velocity": 110 },
        { "start": 456, "duration": 22, "degree": 0, "octave": 1, "velocity": 85  },
        { "start": 528, "duration": 22, "degree": 5, "octave": 0, "velocity": 90  },
        { "start": 600, "duration": 22, "degree": 4, "octave": 0, "velocity": 85  },
        { "start": 672, "duration": 48, "degree": 2, "octave": 0, "velocity": 95  },
        { "start": 744, "duration": 22, "degree": 0, "octave": 0, "velocity": 90  }
      ]
    },
    {
      "id": "breakbeat-melody-1",
      "name": "Stab Hook",
      "style": "breakbeat",
      "kind": "melody",
      "bars": 1,
      "degrees": [
        { "start":   0, "duration": 24, "degree": 4, "octave": 1, "velocity": 100 },
        { "start":  48, "duration": 24, "degree": 2, "octave": 1, "velocity": 85  },
        { "start":  96, "duration": 48, "degree": 0, "octave": 1, "velocity": 105 },
        { "start": 192, "duration": 24, "degree": 4, "octave": 1, "velocity": 90  },
        { "start": 240, "duration": 24, "degree": 6, "octave": 1, "velocity": 85  },
        { "start": 288, "duration": 48, "degree": 0, "octave": 1, "velocity": 100 }
      ]
    },
    {
      "id": "breakbeat-melody-2",
      "name": "Descending Big Beat",
      "style": "breakbeat",
      "kind": "melody",
      "bars": 1,
      "degrees": [
        { "start":   0, "duration": 48, "degree": 6, "octave": 1, "velocity": 100 },
        { "start":  96, "duration": 48, "degree": 4, "octave": 1, "velocity": 95  },
        { "start": 192, "duration": 48, "degree": 2, "octave": 1, "velocity": 90  },
        { "start": 288, "duration": 48, "degree": 0, "octave": 1, "velocity": 105 }
      ]
    },
    {
      "id": "breakbeat-melody-3",
      "name": "Funk Riff",
      "style": "breakbeat",
      "kind": "melody",
      "bars": 1,
      "degrees": [
        { "start":   0, "duration": 24, "degree": 0, "octave": 1, "velocity": 95  },
        { "start":  24, "duration": 24, "degree": 2, "octave": 1, "velocity": 80  },
        { "start":  96, "duration": 24, "degree": 4, "octave": 1, "velocity": 100 },
        { "start": 144, "duration": 24, "degree": 2, "octave": 1, "velocity": 85  },
        { "start": 192, "duration": 24, "degree": 0, "octave": 1, "velocity": 90  },
        { "start": 288, "duration": 48, "degree": 4, "octave": 1, "velocity": 95  }
      ]
    },
    {
      "id": "breakbeat-melody-4",
      "name": "Acid Lick",
      "style": "breakbeat",
      "kind": "melody",
      "bars": 1,
      "degrees": [
        { "start":  48, "duration": 24, "degree": 0, "octave": 1, "velocity": 100 },
        { "start":  72, "duration": 24, "degree": 3, "octave": 1, "velocity": 85  },
        { "start": 120, "duration": 24, "degree": 4, "octave": 1, "velocity": 90  },
        { "start": 192, "duration": 24, "degree": 6, "octave": 1, "velocity": 95  },
        { "start": 240, "duration": 24, "degree": 4, "octave": 1, "velocity": 85  },
        { "start": 336, "duration": 24, "degree": 0, "octave": 1, "velocity": 90  }
      ]
    },
    {
      "id": "breakbeat-melody-5",
      "name": "Two-Bar Theme",
      "style": "breakbeat",
      "kind": "melody",
      "bars": 2,
      "degrees": [
        { "start":   0, "duration": 48, "degree": 0, "octave": 1, "velocity": 100 },
        { "start":  96, "duration": 48, "degree": 2, "octave": 1, "velocity": 90  },
        { "start": 192, "duration": 48, "degree": 4, "octave": 1, "velocity": 100 },
        { "start": 288, "duration": 48, "degree": 5, "octave": 1, "velocity": 95  },
        { "start": 384, "duration": 48, "degree": 4, "octave": 1, "velocity": 100 },
        { "start": 480, "duration": 48, "degree": 2, "octave": 1, "velocity": 90  },
        { "start": 576, "duration": 96, "degree": 0, "octave": 1, "velocity": 110 }
      ]
    }
  ]
}
```

- [ ] **Step 4: Run the test + validate the JSON parses**

Run: `NO_COLOR=1 npx vitest run src/session/example-loader.test.ts && node -e "JSON.parse(require('fs').readFileSync('public/examples/breakbeat.json','utf8')); console.log('json ok')"`
Expected: PASS and `json ok` (no JSON syntax error).

- [ ] **Step 5: Commit**

```bash
git add public/examples/breakbeat.json src/session/example-loader.test.ts
git commit -m "feat(examples): curated Breakbeat / Big Beat gallery (6 beats, 5 bass, 5 melody)"
```

---

### Task 3: Build + live ear-check verification

Content/UI features are not "done" on green tests alone (project rule). This task is the human gate; it produces no new code unless a defect surfaces.

**Files:** none (verification only). If a pattern sounds wrong, fix the velocities/positions in `public/examples/breakbeat.json` and re-commit.

- [ ] **Step 1: Full typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean typecheck, successful bundle to `dist/`.

- [ ] **Step 2: Run the unit suite**

Run: `npm run test:unit`
Expected: green (the `ERR_IPC_CHANNEL_CLOSED` teardown error after all tests pass is a known flake — re-run to confirm if seen).

- [ ] **Step 3: Live ear-check (one per user path — no "(or …)" alternatives)**

Start the dev server (`npm run dev`) and open http://localhost:5173. Then:

1. Open the musicality popover (top bar) → **Style** select shows **"Breakbeat / Big Beat"**; select it.
2. In a **drum lane** clip editor, open the example picker; confirm a **"Breakbeat / Big Beat"** optgroup lists all 6 beats. Load **each** beat and listen:
   - beats 1-3 (breakbeat) sound syncopated with ghost snares;
   - beats 4-6 (big beat) sound heavy / half-time.
3. In a **piano-roll lane** clip editor, open the example picker; confirm the same optgroup lists the 5 basses + 5 melodies. Load at least one bass and one melody and listen — in key, musical.
4. With Style = Breakbeat / Big Beat, press **Generate beat** on a drum clip and listen — the result is audibly broken (kicks off the grid), not a plain four-on-the-floor/backbeat.

- [ ] **Step 4: (only if a pattern sounds wrong) tune + commit**

Adjust the offending notes in `public/examples/breakbeat.json`, rebuild, re-listen, then:

```bash
git add public/examples/breakbeat.json
git commit -m "fix(examples): tune Breakbeat / Big Beat patterns by ear"
```

---

## Self-Review

**Spec coverage:**
- Combined `breakbeat` style + label → Task 1, Steps 3.
- Generator configs (bass/melody/beat) → Task 1, Step 4.
- Broken-beat generator extension (Option A) → Task 1, Step 5 + tests Step 1.
- Curated gallery (6 beats / 5 bass / 5 melody) → Task 2, Step 3.
- Auto-surfacing in picker/selector → no code needed (confirmed by Task 3 ear-check).
- Tests (generators + loader) → Task 1 / Task 2.
- Live ear-check, one per path → Task 3, Step 3.
- English strings → label + names are English throughout.

**Placeholder scan:** No TBD/TODO; all code blocks and JSON are concrete. The only "tune by ear" step is an explicit, conditional refinement gate, not a deferred requirement.

**Type consistency:** `StyleId` gains `'breakbeat'` (Task 1) before any `style: 'breakbeat'` literal is used (Task 2 tests, JSON). `BeatCfg.breakbeat?` defined in Task 1 Step 4, consumed in Task 1 Step 5. `TICKS_PER_STEP` imported from `./notes` in the test (Task 1 Step 1). GM note numbers (36/38/42/46/39) consistent with `generators.ts` `GM` map and the existing example files.
