# MIDI Import + GM-Tagged Engine Presets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the MIDI file importer to produce Session lanes/clips/scenes, backed by a cross-engine preset library where each preset is JSON and carries loose GM program tags. The importer picks engine+preset per MIDI track by GM program.

**Architecture:**
- Presets ship as `public/presets/<engineId>.json` assets, loaded at boot via `preset-loader`. `EnginePreset` carries `gm: number[]` plus engine-specific `params`.
- `gm-lookup` module gives the importer `(engineId, presetName)` for a given GM program by querying `listEngines()` and picking randomly among matches.
- The importer is split into pure `midi-parse` (SMF bytes → ParsedMidi), pure `midi-to-session` (ParsedMidi → SessionLanes+Scene), and a thin `midi-import-ui` with an Add/Replace/Cancel modal.
- The legacy `extraPolyTracks` model is deleted and the duplicate GM drum maps unified.

**Tech Stack:** TypeScript, Vite, Vitest, Web Audio API, native browser `fetch` for JSON assets.

**Spec:** [docs/superpowers/specs/2026-05-29-midi-import-and-gm-presets-design.md](../specs/2026-05-29-midi-import-and-gm-presets-design.md)

**Important context for execution:** Code is being actively modified in parallel sessions. Before each task that depends on existing structure, re-read the relevant files instead of trusting the snapshot here. Re-resolve file paths if anything has moved.

---

## Phase A — Foundations

### Task A1: Add `gm` and generic `params` to `EnginePreset` interface (type only)

**Critical:** This task touches **only the TS interface**, never the inline preset arrays in `tb303.ts`, `fm.ts`, etc. Those inline arrays are deleted in Phases B/C when each engine migrates to its JSON asset. We do not "patch" code-resident presets with `gm: []` — the entire point of this refactor is that preset DATA lives in JSON, not TS.

**Files:**
- Modify: `src/engines/engine-types.ts` (current `EnginePreset` at ~line 58)

- [ ] **Step 1: Re-read current `EnginePreset` interface**

Open `src/engines/engine-types.ts` and locate `EnginePreset`. Note current shape (it likely already exists with `name`, `params`, optional `modulators`).

- [ ] **Step 2: Generalize the interface and add optional `gm`**

Edit `src/engines/engine-types.ts`. Replace the existing `EnginePreset` interface with:

```ts
export interface EnginePreset<P = Record<string, number>> {
  name: string;
  /** Loose mapping to GM program numbers (0-127). Optional during the
   *  migration from inline-TS presets to JSON assets — JSON-sourced
   *  presets will always provide it. Code that reads `gm` should treat
   *  `undefined` as empty. */
  gm?: number[];
  params: P;
  modulators?: import('../modulation/types').ModulatorState[];
}
```

`gm` is **optional** at this stage so existing inline preset arrays (which don't yet have `gm`) still typecheck. Once every engine's data has moved to JSON (end of Phase C), the field can be promoted to required.

If `SynthEngine.presets` is declared as `EnginePreset[]`, leave it — the default generic and the optional `gm` keep full backward compatibility.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean — no engine code needs changes because `gm` is optional and `P` defaults to the previous `Record<string, number>`.

- [ ] **Step 4: Run tests**

Run: `NO_COLOR=1 npm run test:unit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/engines/engine-types.ts
git commit -m "feat(presets): EnginePreset generic over params + optional gm field"
```

**Do not modify any engine .ts file** in this task. Inline preset arrays stay untouched until their owning engine migrates to JSON (Phase B for poly, Phase C for the rest).

---

### Task A2: Create `preset-loader` with validator + tests

**Files:**
- Create: `src/presets/preset-loader.ts`
- Create: `src/presets/preset-loader.test.ts`

- [ ] **Step 1: Write failing tests**

`src/presets/preset-loader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { loadEnginePresets, validatePresetEntry } from './preset-loader';

describe('validatePresetEntry', () => {
  it('accepts a valid preset', () => {
    expect(validatePresetEntry({ name: 'A', gm: [0, 1], params: {} })).toBe(true);
  });

  it('rejects missing name', () => {
    expect(validatePresetEntry({ gm: [0], params: {} } as unknown)).toBe(false);
  });

  it('rejects non-array gm', () => {
    expect(validatePresetEntry({ name: 'A', gm: 0 as unknown, params: {} } as unknown)).toBe(false);
  });

  it('rejects gm values outside [0,128)', () => {
    expect(validatePresetEntry({ name: 'A', gm: [128], params: {} })).toBe(false);
    expect(validatePresetEntry({ name: 'A', gm: [-1], params: {} })).toBe(false);
    expect(validatePresetEntry({ name: 'A', gm: [3.5], params: {} })).toBe(false);
  });

  it('rejects missing params', () => {
    expect(validatePresetEntry({ name: 'A', gm: [0] } as unknown)).toBe(false);
  });
});

describe('loadEnginePresets', () => {
  it('fetches and returns valid presets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engineId: 'tb303',
        presets: [
          { name: 'Acid 1', gm: [32], params: { cutoff: 0.3 } },
          { name: 'Acid 2', gm: [33], params: { cutoff: 0.5 } },
        ],
      }),
    }));
    const out = await loadEnginePresets('tb303');
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Acid 1');
    vi.unstubAllGlobals();
  });

  it('drops malformed entries with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engineId: 'tb303',
        presets: [
          { name: 'Good', gm: [0], params: {} },
          { name: 'Bad', gm: 'oops', params: {} },
        ],
      }),
    }));
    const out = await loadEnginePresets('tb303');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Good');
    expect(warn).toHaveBeenCalled();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('drops duplicate names with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        engineId: 'tb303',
        presets: [
          { name: 'A', gm: [0], params: {} },
          { name: 'A', gm: [1], params: {} },
        ],
      }),
    }));
    const out = await loadEnginePresets('tb303');
    expect(out).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadEnginePresets('nope')).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests — confirm failure**

Run: `NO_COLOR=1 npx vitest run src/presets/preset-loader.test.ts`
Expected: failures with "Cannot find module './preset-loader'".

- [ ] **Step 3: Implement `preset-loader.ts`**

`src/presets/preset-loader.ts`:

```ts
import type { EnginePreset } from '../engines/engine-types';

export function validatePresetEntry(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return false;
  if (!Array.isArray(r.gm)) return false;
  for (const v of r.gm) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= 128) return false;
  }
  if (typeof r.params !== 'object' || r.params === null) return false;
  return true;
}

interface PresetFile {
  engineId: string;
  presets: unknown[];
}

const cache = new Map<string, EnginePreset[]>();
let ready = false;

export async function loadEnginePresets(engineId: string): Promise<EnginePreset[]> {
  if (cache.has(engineId)) return cache.get(engineId)!;
  const res = await fetch(`/presets/${engineId}.json`);
  if (!res.ok) throw new Error(`Failed to load /presets/${engineId}.json: ${res.status}`);
  const body = (await res.json()) as PresetFile;
  const seen = new Set<string>();
  const out: EnginePreset[] = [];
  for (const raw of body.presets ?? []) {
    if (!validatePresetEntry(raw)) {
      console.warn(`[preset-loader] dropping malformed preset in ${engineId}.json`, raw);
      continue;
    }
    const entry = raw as EnginePreset;
    if (seen.has(entry.name)) {
      console.warn(`[preset-loader] duplicate preset name "${entry.name}" in ${engineId}.json — dropping`);
      continue;
    }
    seen.add(entry.name);
    out.push(entry);
  }
  cache.set(engineId, out);
  return out;
}

export async function loadAllPresets(engineIds: string[]): Promise<void> {
  await Promise.all(engineIds.map(async (id) => {
    try { await loadEnginePresets(id); }
    catch (err) { console.warn(`[preset-loader] failed to load ${id}:`, err); }
  }));
  ready = true;
}

export function isPresetsReady(): boolean { return ready; }

export function getCachedPresets(engineId: string): EnginePreset[] {
  return cache.get(engineId) ?? [];
}

/** Test-only — reset module state between cases. */
export function __resetPresetCache(): void {
  cache.clear();
  ready = false;
}
```

Update the test file to call `__resetPresetCache()` in a `beforeEach`. Add this import + hook:

```ts
import { beforeEach } from 'vitest';
import { __resetPresetCache } from './preset-loader';

beforeEach(() => { __resetPresetCache(); });
```

- [ ] **Step 4: Re-run tests**

Run: `NO_COLOR=1 npx vitest run src/presets/preset-loader.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/presets/preset-loader.ts src/presets/preset-loader.test.ts
git commit -m "feat(presets): preset-loader with JSON validation"
```

---

## Phase B — Migrate polysynth presets to JSON

### Task B1: Snapshot `FACTORY_POLY_PRESETS` to `public/presets/poly.json`

**Files:**
- Read: `src/polysynth/poly-presets.ts`
- Create: `public/presets/poly.json`
- Create: `scripts/dump-poly-presets.mjs` (one-shot, gitignored or kept for future re-runs)

- [ ] **Step 1: Verify directory exists**

Run: `ls public`
Expected: shows existing `demos/` directory. Confirms `public/` is the right location.

- [ ] **Step 2: Write dump script**

`scripts/dump-poly-presets.mjs`:

```js
import { FACTORY_POLY_PRESETS } from '../src/polysynth/poly-presets.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/presets', { recursive: true });
const out = {
  engineId: 'poly',
  presets: FACTORY_POLY_PRESETS.map((p) => ({
    name: p.name,
    gm: p.gm ?? [],
    params: p.params,
  })),
};
writeFileSync('public/presets/poly.json', JSON.stringify(out, null, 2));
console.log(`wrote ${out.presets.length} poly presets`);
```

- [ ] **Step 3: Run the dump**

Run: `npx tsx scripts/dump-poly-presets.mjs`
Expected: `wrote N poly presets`, file appears at `public/presets/poly.json`.

- [ ] **Step 4: Verify JSON shape**

Open `public/presets/poly.json` and confirm shape: top-level `{ engineId: "poly", presets: [...] }`, each preset has `name`, `gm: []`, `params: {...}`.

- [ ] **Step 5: Commit**

```bash
git add public/presets/poly.json scripts/dump-poly-presets.mjs
git commit -m "build: snapshot FACTORY_POLY_PRESETS to public/presets/poly.json"
```

---

### Task B2: Add GM tags to `poly.json`

**Files:**
- Modify: `public/presets/poly.json`

- [ ] **Step 1: Reference the legacy `presetFromProgram` mapping**

The current `presetFromProgram` in `src/midi/midi-import.ts` (lines ~87-156) maps GM → preset name. Use it as the source of GM tags. For each poly preset, find every GM program that mapped to it.

- [ ] **Step 2: Edit `poly.json` to add `gm` arrays**

For each preset, set `gm` to the list of GM programs from `presetFromProgram`. Example assignments (cross-check against the actual function):
- `KEY Acoustic Piano` → `gm: [0, 1, 2, 3]`
- `KEY Rhodes` → `gm: [4, 5, 6]`
- `PLUCK Digital` → `gm: [7, 24, 25, 26, 27, 47]`
- `BELL FM` → `gm: [8, 9, 10, 14, 15, 46]`
- `PLUCK Marimba` → `gm: [11, 12, 13, 45]`
- `PAD Organ` → `gm: [16, 17, 18, 19, 20, 21, 22, 23]`
- `LEAD Bright Saw` → `gm: [28, 29, 30, 31, 81, 83]`
- `BASS Plucky` → `gm: [32, 36]`
- `BASS Big Saws` → `gm: [33]`
- `BASS Punchy` → `gm: [34, 37]`
- `BASS Sub 808` → `gm: [35]`
- `BASS Wobble` → `gm: [38]`
- `BASS Reese` → `gm: [39]`
- `PAD Detuned Strings` → `gm: [40, 41, 42, 43, 44, 48, 49, 92]`
- `PAD Sweep` → `gm: [50, 89, 94, 95]`
- `PAD Warm` → `gm: [51, 88]`
- `VOX Aah` → `gm: [52]`
- `VOX Ooh` → `gm: [53]`
- `VOX Hum Choir` → `gm: [54, 85]`
- `LEAD Brass Stab` → `gm: [55, 56, 57, 58, 59, 60, 61, 62, 63]`
- `LEAD Soft Sine` → `gm: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 82]`
- `LEAD Square` → `gm: [80]`
- `LEAD Supersaw` → `gm: [84]`
- `LEAD Trance` → `gm: [86]`
- `LEAD Hoover` → `gm: [87]`
- `PAD Glass` → `gm: [90, 93]`
- `PAD Choir Aah` → `gm: [91]`
- `FX Sci-Fi` → `gm: [96, 97, 98, 99, 100, 101, 102, 103]`
- `FX Noise Sweep` → `gm: [120, 121, 122, 123, 124, 125, 126, 127]`

Presets not referenced by the legacy mapping (none of the GM 104-119 mapped to a poly preset — those went to `Init`) keep `gm: []` for now. Phase C content will fill them in with new engines.

- [ ] **Step 3: Validate the file parses**

Run: `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('public/presets/poly.json','utf8'))))"`
Expected: prints `[ 'engineId', 'presets' ]`.

- [ ] **Step 4: Commit**

```bash
git add public/presets/poly.json
git commit -m "feat(presets): tag poly presets with GM programs from legacy importer map"
```

---

### Task B3: Wire `loadAllPresets` into boot and feed poly engine

**Files:**
- Modify: `src/main.ts` (boot sequence)
- Modify: `src/polysynth/polysynth-presets.ts` (`applyPresetByName`)
- Modify: `src/polysynth/poly-presets.ts` (export a loader-fed array instead of static)

- [ ] **Step 1: Open `src/main.ts` boot sequence**

Find where engines are registered and the demo session is fetched (search for `fetchDemoSession`). Note the relative order.

- [ ] **Step 2: Call `loadAllPresets` before applying demo**

Add near the top of the boot section:

```ts
import { loadAllPresets, getCachedPresets } from './presets/preset-loader';

const ENGINE_IDS_FOR_PRESETS = ['poly', 'tb303', 'fm', 'wavetable', 'karplus', 'subtractive', 'drums'];

await loadAllPresets(ENGINE_IDS_FOR_PRESETS);
```

(If the surrounding code isn't already inside an async function, wrap the boot block in one. Vite supports top-level await in modules.)

- [ ] **Step 3: Make `applyPresetByName` (poly) read from the loaded cache**

In `src/polysynth/polysynth-presets.ts`:

```ts
import { getCachedPresets } from '../presets/preset-loader';

export function applyPresetByName(poly: PolySynth, name: string): void {
  const presets = getCachedPresets('poly');
  const p = presets.find((x) => x.name === name);
  if (p) {
    poly.params = JSON.parse(JSON.stringify(p.params)) as PolySynthParams;
    polyPresetName.set(poly, `factory:${name}`);
  }
}
```

The legacy `FACTORY_POLY_PRESETS` import can be removed from this file.

- [ ] **Step 4: Run tests**

Run: `NO_COLOR=1 npm run test:unit`
Expected: existing poly-preset tests pass (they hit `applyPresetByName`, which now reads from cache populated by `loadAllPresets` — make sure test setup populates the cache or stubs it).

If a test fails because the cache is empty, mock `getCachedPresets` or call `__resetPresetCache` then seed via `loadEnginePresets` with `fetch` stubbed.

- [ ] **Step 5: Manually verify boot**

Run: `npm run dev` (background) and open http://localhost:5173. Verify the polysynth preset dropdown still lists the same names and selecting one still applies the patch.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/polysynth/polysynth-presets.ts
git commit -m "feat(presets): poly engine reads presets from preset-loader cache"
```

---

### Task B4: Delete `src/polysynth/poly-presets.ts` legacy module

**Files:**
- Delete: `src/polysynth/poly-presets.ts`
- Modify: any file that still imports `FACTORY_POLY_PRESETS`

- [ ] **Step 1: Find remaining importers**

Run: Grep for `FACTORY_POLY_PRESETS` across `src/`.
Expected: at most the dump script and tests (already migrated). If any production code still references it, route through `getCachedPresets('poly')`.

- [ ] **Step 2: Delete the file**

```bash
git rm src/polysynth/poly-presets.ts
```

- [ ] **Step 3: Typecheck + test**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(presets): delete poly-presets.ts, JSON is the source of truth"
```

---

## Phase C — Per-engine preset content

Each task in this phase adds ≥20 presets to one engine's JSON, tagged with GM programs.

**Workflow per engine:**
1. Author preset params by running the dev server, picking the engine in a session lane, designing a sound on the knobs, then capturing the param block.
2. Add the entry to `public/presets/<engineId>.json` with a coherent `FAMILY Descriptor` name and `gm: [...]` tags.
3. After each batch of ~5 presets, commit.
4. After all 20+, run the sanity test (Phase D) to catch shape errors.

### Task C1: tb303 presets (≥20)

**Files:**
- Create: `public/presets/tb303.json`
- Modify: `src/engines/tb303.ts` (delete inline `TB303_PRESETS`; `applyPreset` reads from cache)

- [ ] **Step 1: Re-read `src/engines/tb303.ts`**

Note the params shape (`cutoff`, `resonance`, `envMod`, `decay`, `accent`, `wave`) and `applyPreset` implementation.

- [ ] **Step 2: Create starter `public/presets/tb303.json`**

Seed with the 3 existing inline presets + 17 new ones. GM coverage target: 32-39 (basses), 80-87 (leads). Example skeleton:

```json
{
  "engineId": "tb303",
  "presets": [
    { "name": "BASS Acid Classic", "gm": [32, 33, 36, 38], "params": { "cutoff": 0.35, "resonance": 0.70, "envMod": 0.60, "decay": 0.50, "accent": 0.70, "wave": 0 } },
    { "name": "BASS Acid Dark",    "gm": [33, 35],         "params": { "cutoff": 0.25, "resonance": 0.80, "envMod": 0.70, "decay": 0.45, "accent": 0.75, "wave": 0 } },
    { "name": "BASS Squelch",      "gm": [36, 37],         "params": { "cutoff": 0.45, "resonance": 0.85, "envMod": 0.75, "decay": 0.35, "accent": 0.80, "wave": 0 } },
    { "name": "BASS Dub Sub",      "gm": [35, 39],         "params": { "cutoff": 0.20, "resonance": 0.40, "envMod": 0.30, "decay": 0.65, "accent": 0.45, "wave": 1 } }
  ]
}
```

Continue adding ≥16 more entries covering each GM 32-39 (basses) at least twice and at least 6 lead variants in GM 80-87.

- [ ] **Step 3: Modify `tb303.ts` to read from cache**

Replace `TB303_PRESETS` with:

```ts
import { getCachedPresets } from '../presets/preset-loader';
// ... remove the inline `TB303_PRESETS` const

// In SynthEngine impl:
get presets(): EnginePreset[] { return getCachedPresets('tb303'); }
applyPreset(name: string): void {
  const p = this.presets.find((x) => x.name === name);
  if (!p) return;
  for (const [k, v] of Object.entries(p.params)) this.setBaseValue(k, v as number);
}
```

If `presets` is currently declared `readonly` and assigned in the constructor, change it to a getter.

- [ ] **Step 4: Run typecheck + tests**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: clean. tb303 engine tests should still pass.

- [ ] **Step 5: Audition presets**

Run: `npm run dev` (background). For each preset in the dropdown, play a few notes. Anything that sounds broken: edit params in the JSON. Anything that sounds great: keep it.

- [ ] **Step 6: Commit**

```bash
git add public/presets/tb303.json src/engines/tb303.ts
git commit -m "feat(presets): tb303 preset library (20+) with GM tags"
```

---

### Task C2: fm presets (≥20)

**Files:**
- Create: `public/presets/fm.json`
- Modify: `src/engines/fm.ts`

Mirror Task C1's structure. GM coverage target:
- 4-7 (EP, clav)
- 8-15 (bells, chrom perc)
- 14-15 (tinkle bell, dulcimer)
- 88-95 (synth pads, glass)
- 96-103 (FX)

Family prefixes: `EP`, `BELL`, `PAD`, `FX`.

- [ ] **Step 1: Re-read fm engine params**
- [ ] **Step 2: Create `public/presets/fm.json` with 20+ presets**
- [ ] **Step 3: Migrate `fm.ts` to read from cache (same pattern as tb303)**
- [ ] **Step 4: Typecheck + tests**
- [ ] **Step 5: Audition in dev server**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(presets): fm preset library (20+) with GM tags"
```

---

### Task C3: wavetable presets (≥20)

GM coverage: 51-54 (synth strings, voices), 80-95 (synth leads/pads), 96-103 (FX).

Same 6 steps as C2. Commit message: `feat(presets): wavetable preset library (20+) with GM tags`.

---

### Task C4: karplus presets (≥20)

GM coverage: 24-31 (guitars), 32-33 (ac/finger bass), 45-47 (pizz/harp/timpani), 105-108 (banjo/shamisen/koto/sitar).

Family prefixes: `GTR`, `BASS`, `PLUCK`, `WORLD`.

Same 6 steps. Commit message: `feat(presets): karplus preset library (20+) with GM tags`.

---

### Task C5: subtractive presets (≥20)

GM coverage: 16-23 (organs), 32-39 (basses), 56-63 (brass), 80-95 (leads/pads).

Family prefixes: `ORGAN`, `BASS`, `BRASS`, `LEAD`, `PAD`.

Same 6 steps. Commit message: `feat(presets): subtractive preset library (20+) with GM tags`.

---

### Task C6: drums kits (≥8)

GM "drum kits" are selected via program change on ch10. The canonical GM kit programs are:
- 0 — Standard Kit
- 8 — Room Kit
- 16 — Power Kit
- 24 — Electronic Kit
- 25 — TR-808 Kit
- 33 — Jazz Kit
- 41 — Brush Kit
- 49 — Orchestra Kit

**Files:**
- Create: `public/presets/drums.json`
- Modify: `src/core/drums.ts` (the `KITS` array currently lives here)

- [ ] **Step 1: Read current `KITS` array shape**

Open `src/core/drums.ts`. Note that kits today are full parameter blocks per voice (kick/snare/hat/etc.). The JSON preset will mirror that shape under `params`.

- [ ] **Step 2: Create `public/presets/drums.json`**

```json
{
  "engineId": "drums",
  "presets": [
    { "name": "KIT Standard", "gm": [0],  "params": { "kick": { ... }, "snare": { ... }, ... } },
    { "name": "KIT Room",     "gm": [8],  "params": { ... } },
    { "name": "KIT Power",    "gm": [16], "params": { ... } },
    { "name": "KIT Electro",  "gm": [24], "params": { ... } },
    { "name": "KIT 808",      "gm": [25], "params": { ... } },
    { "name": "KIT Jazz",     "gm": [33], "params": { ... } },
    { "name": "KIT Brush",    "gm": [41], "params": { ... } },
    { "name": "KIT Orchestra","gm": [49], "params": { ... } }
  ]
}
```

For the starter content, copy params from the existing `KITS` array (each existing kit becomes one entry; if there are fewer than 8 existing kits, design new ones in the dev server).

- [ ] **Step 3: Drums engine reads kits from preset cache**

Modify the drums engine so its `presets` getter returns `getCachedPresets('drums')` and `applyPreset(name)` swaps the active kit by name.

- [ ] **Step 4: Typecheck + tests**

The drums DSP tests in `src/core/drums.dsp.test.ts` should still pass — the kit data didn't change, only its location.

- [ ] **Step 5: Audition**

Run dev server, switch kit dropdown across all 8 entries, hit each pad. All should sound.

- [ ] **Step 6: Commit**

```bash
git add public/presets/drums.json src/core/drums.ts
git commit -m "feat(presets): drum kits as GM-tagged JSON presets"
```

---

## Phase D — GM lookup

### Task D1: `gm-lookup` module + tests

**Files:**
- Create: `src/midi/gm-lookup.ts`
- Create: `src/midi/gm-lookup.test.ts`

- [ ] **Step 1: Write failing tests**

`src/midi/gm-lookup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findGMMatches, pickPresetForGM, pickDrumKitForGM } from './gm-lookup';
import { __resetPresetCache } from '../presets/preset-loader';

vi.mock('../engines/registry', () => ({
  listEngines: () => [
    { id: 'poly',  presets: [{ name: 'P1', gm: [33, 81], params: {} }, { name: 'P2', gm: [33],     params: {} }] },
    { id: 'tb303', presets: [{ name: 'T1', gm: [33],     params: {} }, { name: 'T2', gm: [81],     params: {} }] },
    { id: 'drums', presets: [{ name: 'KIT Standard', gm: [0], params: {} }, { name: 'KIT 808', gm: [25], params: {} }] },
  ],
}));

beforeEach(() => { __resetPresetCache(); });

describe('findGMMatches', () => {
  it('returns every preset across engines tagged with the program', () => {
    const matches = findGMMatches(33);
    expect(matches).toEqual(expect.arrayContaining([
      { engineId: 'poly', presetName: 'P1' },
      { engineId: 'poly', presetName: 'P2' },
      { engineId: 'tb303', presetName: 'T1' },
    ]));
    expect(matches).toHaveLength(3);
  });

  it('returns empty for unmatched program', () => {
    expect(findGMMatches(127)).toEqual([]);
  });
});

describe('pickPresetForGM', () => {
  it('picks the first match when rng returns 0', () => {
    const rng = () => 0.0;
    const pick = pickPresetForGM(81, rng);
    expect(pick).toEqual({ engineId: 'poly', presetName: 'P1' });
  });

  it('picks the second match when rng returns 0.99', () => {
    const rng = () => 0.99;
    const pick = pickPresetForGM(81, rng);
    expect(pick).toEqual({ engineId: 'tb303', presetName: 'T2' });
  });

  it('falls back to poly/Init when no match', () => {
    const pick = pickPresetForGM(127, () => 0);
    expect(pick).toEqual({ engineId: 'poly', presetName: 'Init' });
  });
});

describe('pickDrumKitForGM', () => {
  it('only returns drums engine matches', () => {
    const pick = pickDrumKitForGM(0, () => 0);
    expect(pick.engineId).toBe('drums');
    expect(pick.presetName).toBe('KIT Standard');
  });

  it('falls back to KIT Standard when no match', () => {
    const pick = pickDrumKitForGM(99, () => 0);
    expect(pick).toEqual({ engineId: 'drums', presetName: 'KIT Standard' });
  });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `NO_COLOR=1 npx vitest run src/midi/gm-lookup.test.ts`
Expected: module-not-found failure.

- [ ] **Step 3: Implement `gm-lookup.ts`**

```ts
import { listEngines } from '../engines/registry';

export interface GMMatch {
  engineId: string;
  presetName: string;
}

export function findGMMatches(program: number): GMMatch[] {
  const out: GMMatch[] = [];
  for (const eng of listEngines()) {
    for (const p of eng.presets ?? []) {
      if (p.gm.includes(program)) out.push({ engineId: eng.id, presetName: p.name });
    }
  }
  return out;
}

export function pickPresetForGM(program: number, rng: () => number): GMMatch {
  const matches = findGMMatches(program);
  if (matches.length === 0) return { engineId: 'poly', presetName: 'Init' };
  return matches[Math.floor(rng() * matches.length)];
}

export function pickDrumKitForGM(program: number, rng: () => number): GMMatch {
  const matches = findGMMatches(program).filter((m) => m.engineId === 'drums');
  if (matches.length === 0) return { engineId: 'drums', presetName: 'KIT Standard' };
  return matches[Math.floor(rng() * matches.length)];
}
```

- [ ] **Step 4: Run tests — confirm pass**

Run: `NO_COLOR=1 npx vitest run src/midi/gm-lookup.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/midi/gm-lookup.ts src/midi/gm-lookup.test.ts
git commit -m "feat(midi): gm-lookup picks preset across engines by GM program"
```

---

### Task D2: GM coverage gate test

**Files:**
- Create: `src/midi/gm-coverage.test.ts`

This test loads every engine's JSON from disk and asserts at least one preset covers each GM program 0-127.

- [ ] **Step 1: Write the test**

`src/midi/gm-coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENGINES = ['poly', 'tb303', 'fm', 'wavetable', 'karplus', 'subtractive', 'drums'];

function loadPresets(engineId: string): { name: string; gm: number[] }[] {
  const text = readFileSync(resolve('public/presets', `${engineId}.json`), 'utf8');
  return JSON.parse(text).presets;
}

describe('GM coverage', () => {
  it('every GM program 0-127 has at least one tonal preset (excluding drums)', () => {
    const covered = new Set<number>();
    for (const eng of ENGINES) {
      if (eng === 'drums') continue;
      for (const p of loadPresets(eng)) for (const g of p.gm) covered.add(g);
    }
    const missing: number[] = [];
    for (let g = 0; g < 128; g++) if (!covered.has(g)) missing.push(g);
    expect(missing, `Uncovered GM programs: ${missing.join(',')}`).toEqual([]);
  });

  it('every canonical GM drum kit program has a drums preset', () => {
    const drumPresets = loadPresets('drums');
    const covered = new Set<number>();
    for (const p of drumPresets) for (const g of p.gm) covered.add(g);
    for (const kit of [0, 8, 16, 24, 25, 33, 41, 49]) {
      expect(covered.has(kit), `Missing drum kit GM ${kit}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test**

Run: `NO_COLOR=1 npx vitest run src/midi/gm-coverage.test.ts`
Expected: passes if Phase C content is complete. If not, the failure lists missing GM programs — fix by adding tags or new presets to JSONs.

- [ ] **Step 3: Iterate until green**

For each missing GM program, decide: add a dedicated preset, or tag the program onto the closest existing preset. Re-run.

- [ ] **Step 4: Commit**

```bash
git add src/midi/gm-coverage.test.ts public/presets/*.json
git commit -m "test(midi): GM coverage gate ensures every program resolves"
```

---

### Task D3: Cross-engine preset sanity test

**Files:**
- Create: `src/presets/preset-sanity.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENGINES = ['poly', 'tb303', 'fm', 'wavetable', 'karplus', 'subtractive', 'drums'];

interface Preset { name: string; gm: number[]; params: unknown }

function loadPresets(engineId: string): Preset[] {
  const text = readFileSync(resolve('public/presets', `${engineId}.json`), 'utf8');
  return JSON.parse(text).presets;
}

describe.each(ENGINES)('preset sanity: %s', (engineId) => {
  const presets = loadPresets(engineId);

  it('has at least the minimum count', () => {
    const min = engineId === 'drums' ? 8 : 20;
    expect(presets.length).toBeGreaterThanOrEqual(min);
  });

  it('all names are unique', () => {
    const names = presets.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all gm entries are integers in [0,128)', () => {
    for (const p of presets) {
      for (const g of p.gm) {
        expect(Number.isInteger(g)).toBe(true);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThan(128);
      }
    }
  });

  it('all presets have a params object', () => {
    for (const p of presets) {
      expect(typeof p.params).toBe('object');
      expect(p.params).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run + fix any failures**

Run: `NO_COLOR=1 npx vitest run src/presets/preset-sanity.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/presets/preset-sanity.test.ts
git commit -m "test(presets): cross-engine sanity (count, uniqueness, GM bounds)"
```

---

## Phase E — MIDI rewrite

### Task E1: Extract pure SMF parser + tempo

**Files:**
- Create: `src/midi/midi-parse.ts` (pure parser, moved from `midi-import.ts`)
- Create: `src/midi/midi-parse.test.ts`

- [ ] **Step 1: Re-read current `src/midi/midi-import.ts`**

Identify the `parseMidiFile` function. Note the parser does not currently extract tempo.

- [ ] **Step 2: Write failing tests including tempo extraction**

`src/midi/midi-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMidiFile } from './midi-parse';

function buildSmf(opts: { tempo?: number; note?: number; velocity?: number }): Uint8Array {
  // tempo meta event (μs per quarter): 60_000_000 / bpm.
  const usPerQ = opts.tempo ? Math.round(60_000_000 / opts.tempo) : null;
  const tempoEvent = usPerQ != null
    ? [0x00, 0xff, 0x51, 0x03, (usPerQ >> 16) & 0xff, (usPerQ >> 8) & 0xff, usPerQ & 0xff]
    : [];
  const note = opts.note ?? 60;
  const vel = opts.velocity ?? 100;
  const trackEvents = [
    ...tempoEvent,
    0x00, 0x90, note, vel,
    0x60, 0x80, note, 0,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const len = trackEvents.length;
  return new Uint8Array([
    0x4d,0x54,0x68,0x64, 0x00,0x00,0x00,0x06,
    0x00,0x00, 0x00,0x01, 0x00,0x60,
    0x4d,0x54,0x72,0x6b,
    (len>>24)&0xff,(len>>16)&0xff,(len>>8)&0xff,len&0xff,
    ...trackEvents,
  ]);
}

describe('parseMidiFile', () => {
  it('extracts bpm from a meta-tempo event', () => {
    const { bpm } = parseMidiFile(buildSmf({ tempo: 128 }));
    expect(bpm).toBeCloseTo(128, 0);
  });

  it('returns null bpm when no tempo event present', () => {
    const { bpm } = parseMidiFile(buildSmf({}));
    expect(bpm).toBeNull();
  });

  it('preserves velocity round-trip', () => {
    const { tracks } = parseMidiFile(buildSmf({ velocity: 47 }));
    expect(tracks[0].notes[0].velocity).toBe(47);
  });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-parse.test.ts`
Expected: module-not-found.

- [ ] **Step 4: Implement `src/midi/midi-parse.ts`**

Copy `parseMidiFile` from current `midi-import.ts`. Add tempo extraction:

```ts
export interface ParsedTrack {
  index: number;
  name: string;
  program: number;
  notes: { startTick: number; duration: number; midi: number; velocity: number; channel: number }[];
}

export interface ParsedMidi {
  division: number;
  bpm: number | null;
  tracks: ParsedTrack[];
}

export function parseMidiFile(buf: Uint8Array): ParsedMidi {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => (buf[p++] << 8) | buf[p++];
  const u32 = () => (buf[p++] * 0x1000000) + (buf[p++] << 16) + (buf[p++] << 8) + buf[p++];
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'MThd') throw new Error('not SMF');
  p = 4;
  const hLen = u32(); u16(); const ntracks = u16(); const division = u16();
  p = 4 + 4 + hLen;
  const tracks: ParsedTrack[] = [];
  let bpm: number | null = null;

  for (let t = 0; t < ntracks; t++) {
    if (String.fromCharCode(buf[p], buf[p+1], buf[p+2], buf[p+3]) !== 'MTrk') break;
    p += 4;
    const tlen = u32();
    const tend = p + tlen;
    let abs = 0; let lastStatus = 0; let name = ''; let program = -1;
    const noteOn = new Map<number, { start: number; velocity: number }>();
    const notes: ParsedTrack['notes'] = [];
    while (p < tend) {
      abs += vlq();
      let status = buf[p];
      if (status < 0x80) { status = lastStatus; } else { p++; lastStatus = status; }
      if (status === 0xff) {
        const type = u8(); const len = vlq();
        if (type === 0x03) name = String.fromCharCode(...buf.slice(p, p + len));
        else if (type === 0x51 && len === 3 && bpm === null) {
          const us = (buf[p] << 16) | (buf[p+1] << 8) | buf[p+2];
          bpm = 60_000_000 / us;
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        const len = vlq(); p += len;
      } else {
        const high = status & 0xf0;
        const ch = status & 0x0f;
        if (high === 0x80 || high === 0x90) {
          const note = u8(); const vel = u8();
          const isOff = high === 0x80 || vel === 0;
          const key = (ch << 8) | note;
          if (!isOff) noteOn.set(key, { start: abs, velocity: vel });
          else {
            const onEvt = noteOn.get(key);
            if (onEvt != null) {
              notes.push({ startTick: onEvt.start, duration: abs - onEvt.start, midi: note, velocity: onEvt.velocity, channel: ch });
              noteOn.delete(key);
            }
          }
        } else if (high === 0xc0) {
          program = u8();
        } else if (high === 0xa0 || high === 0xb0 || high === 0xe0) {
          p += 2;
        } else if (high === 0xd0) {
          p += 1;
        }
      }
    }
    tracks.push({ index: t, name, program, notes });
  }
  return { division, bpm, tracks };
}
```

- [ ] **Step 5: Run tests — confirm pass**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-parse.test.ts`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/midi/midi-parse.ts src/midi/midi-parse.test.ts
git commit -m "feat(midi): pure SMF parser module with tempo extraction"
```

---

### Task E2: `midi-to-session` pure transform

**Files:**
- Create: `src/midi/midi-to-session.ts`
- Create: `src/midi/midi-to-session.test.ts`

- [ ] **Step 1: Look up Session constants**

Read `src/core/notes.ts` for `TICKS_PER_STEP`, `TICKS_PER_QUARTER` (or whichever names exist) and `src/session/session.ts` for `SessionLane`, `SessionClip`, `SessionScene`, `NoteEvent`. Use the current names.

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { midiToSession } from './midi-to-session';
import type { ParsedMidi } from './midi-parse';

vi.mock('../engines/registry', () => ({
  listEngines: () => [
    { id: 'poly',  presets: [{ name: 'Init', gm: [], params: {} }] },
    { id: 'tb303', presets: [{ name: 'BASS Acid Classic', gm: [33], params: {} }] },
  ],
}));

describe('midiToSession', () => {
  it('creates one lane per selected tonal track with the GM-picked preset', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: 128,
      tracks: [
        { index: 0, name: 'Bass', program: 33, notes: [{ startTick: 0, duration: 48, midi: 36, velocity: 90, channel: 0 }] },
      ],
    };
    const result = midiToSession(parsed, { selectedTrackIndices: [0], rng: () => 0 });
    expect(result.newLanes).toHaveLength(1);
    expect(result.newLanes[0].engineId).toBe('tb303');
    expect(result.newLanes[0].clips).toHaveLength(1);
    expect(result.newLanes[0].clips[0]?.notes[0].midi).toBe(36);
    expect(result.bpm).toBeCloseTo(128, 0);
    expect(result.scene.presetPerLane?.[result.newLanes[0].id]).toBe('factory:BASS Acid Classic');
  });

  it('merges all ch10 notes into a single drumClip', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'Drums', program: 0,
          notes: [
            { startTick: 0,  duration: 24, midi: 36, velocity: 100, channel: 9 },
            { startTick: 48, duration: 24, midi: 38, velocity: 100, channel: 9 },
          ] },
      ],
    };
    const result = midiToSession(parsed, { selectedTrackIndices: [0], rng: () => 0 });
    expect(result.drumClip).not.toBeNull();
    expect(result.drumClip!.notes).toHaveLength(2);
    expect(result.newLanes).toHaveLength(0); // ch10 track does not create a new lane
  });

  it('falls back to poly/Init when no GM match', () => {
    const parsed: ParsedMidi = {
      division: 96, bpm: null,
      tracks: [
        { index: 0, name: 'X', program: 127, notes: [{ startTick: 0, duration: 48, midi: 60, velocity: 80, channel: 0 }] },
      ],
    };
    const result = midiToSession(parsed, { selectedTrackIndices: [0], rng: () => 0 });
    expect(result.newLanes[0].engineId).toBe('poly');
    expect(result.scene.presetPerLane?.[result.newLanes[0].id]).toBe('factory:Init');
    expect(result.unmatchedTracks).toEqual([{ name: 'X', program: 127 }]);
  });
});
```

(Add `import { vi } from 'vitest'` at the top.)

- [ ] **Step 3: Run — confirm failure**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-to-session.test.ts`
Expected: module-not-found.

- [ ] **Step 4: Implement `midi-to-session.ts`**

```ts
import type { ParsedMidi } from './midi-parse';
import type { SessionLane, SessionClip, SessionScene } from '../session/session';
import type { NoteEvent } from '../core/notes';
import { TICKS_PER_STEP } from '../core/notes';
import { pickPresetForGM, pickDrumKitForGM, findGMMatches, type GMMatch } from './gm-lookup';

export interface MidiImportResult {
  newLanes: SessionLane[];
  scene: SessionScene;
  bpm: number | null;
  drumClip: SessionClip | null;
  drumKitMatch: GMMatch | null;
  unmatchedTracks: { name: string; program: number }[];
}

const TICKS_PER_BAR = TICKS_PER_STEP * 16;

let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function midiToSession(
  parsed: ParsedMidi,
  opts: { selectedTrackIndices: number[]; rng: () => number },
): MidiImportResult {
  const selected = parsed.tracks.filter((t) => opts.selectedTrackIndices.includes(t.index));
  const scale = (TICKS_PER_STEP * 4) / parsed.division; // assumes TICKS_PER_STEP = 24-tick 16th

  let globalMinStart = Infinity;
  let globalMaxEnd = 0;
  for (const tr of selected) for (const n of tr.notes) {
    if (n.startTick < globalMinStart) globalMinStart = n.startTick;
    const end = n.startTick + n.duration;
    if (end > globalMaxEnd) globalMaxEnd = end;
  }
  if (!isFinite(globalMinStart)) globalMinStart = 0;

  const songTicks = Math.ceil((globalMaxEnd - globalMinStart) * scale);
  const lengthBars = Math.max(1, Math.ceil(songTicks / TICKS_PER_BAR));

  const newLanes: SessionLane[] = [];
  const clipPerLane: Record<string, number | null> = {};
  const presetPerLane: Record<string, string> = {};
  const unmatchedTracks: { name: string; program: number }[] = [];

  const drumNotes: NoteEvent[] = [];
  let drumKitMatch: GMMatch | null = null;

  for (const tr of selected) {
    const isDrum = tr.notes.some((n) => n.channel === 9);
    if (isDrum) {
      if (tr.program >= 0) drumKitMatch = pickDrumKitForGM(tr.program, opts.rng);
      for (const n of tr.notes) if (n.channel === 9) {
        drumNotes.push({
          start: Math.round((n.startTick - globalMinStart) * scale),
          duration: Math.max(6, Math.round(n.duration * scale)),
          midi: n.midi,
          velocity: n.velocity,
        });
      }
      continue;
    }

    const prog = tr.program < 0 ? 0 : tr.program;
    const match = pickPresetForGM(prog, opts.rng);
    if (findGMMatches(prog).length === 0) unmatchedTracks.push({ name: tr.name, program: prog });

    const clipNotes: NoteEvent[] = tr.notes
      .filter((n) => n.channel !== 9)
      .map((n) => ({
        start: Math.round((n.startTick - globalMinStart) * scale),
        duration: Math.max(6, Math.round(n.duration * scale)),
        midi: n.midi,
        velocity: n.velocity,
      }));

    const clip: SessionClip = {
      id: nextId('clip'),
      name: tr.name || `Track ${tr.index}`,
      lengthBars,
      notes: clipNotes,
    };
    const lane: SessionLane = {
      id: nextId('lane'),
      engineId: match.engineId,
      name: tr.name || `Track ${tr.index}`,
      clips: [clip],
      enginePresetName: `factory:${match.presetName}`,
    };
    newLanes.push(lane);
    clipPerLane[lane.id] = 0;
    presetPerLane[lane.id] = `factory:${match.presetName}`;
  }

  const drumClip: SessionClip | null = drumNotes.length === 0 ? null : {
    id: nextId('clip'),
    name: 'MIDI Drums',
    lengthBars,
    notes: drumNotes,
  };

  const scene: SessionScene = {
    id: nextId('scene'),
    name: 'MIDI Import',
    clipPerLane,
    presetPerLane,
  };

  return { newLanes, scene, bpm: parsed.bpm, drumClip, drumKitMatch, unmatchedTracks };
}
```

- [ ] **Step 5: Run tests + iterate**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-to-session.test.ts`
Iterate on import paths / constant names if vitest reports mismatches against the live codebase.

- [ ] **Step 6: Commit**

```bash
git add src/midi/midi-to-session.ts src/midi/midi-to-session.test.ts
git commit -m "feat(midi): pure ParsedMidi → SessionLanes+Scene transform"
```

---

### Task E3: `midi-import-ui` — file picker, modal, session mutations

**Files:**
- Create: `src/midi/midi-import-ui.ts`
- Modify: `src/main.ts` (replace wireMidiImport call with new one)

- [ ] **Step 1: Re-read current `wireMidiImport` deps**

In `src/midi/midi-import.ts` note the DOM ids it grabs (`poly-midi-file`, `poly-midi-tracklist`, `poly-midi-load`). Reuse the same DOM scaffolding so HTML doesn't need changing.

- [ ] **Step 2: Implement `midi-import-ui.ts`**

```ts
import { parseMidiFile, type ParsedMidi } from './midi-parse';
import { midiToSession } from './midi-to-session';
import { applyPresetToLane } from '../presets/preset-apply';   // Task F1
import { isPresetsReady } from '../presets/preset-loader';
import type { SessionState } from '../session/session';
import type { Transport } from '../core/transport';

export interface MidiImportUiDeps {
  session: SessionState;
  transport: Transport;
  drumLaneId: string | null;          // existing drums lane in the session, or null
  onSessionChanged: () => void;       // refresh UI
  launchScene: (sceneId: string) => void;
  flashButton: (b: HTMLButtonElement, msg: string) => void;
}

export function wireMidiImportUI(deps: MidiImportUiDeps): void {
  const fileInput  = document.getElementById('poly-midi-file')     as HTMLInputElement;
  const trackListEl= document.getElementById('poly-midi-tracklist')as HTMLDivElement;
  const loadBtn    = document.getElementById('poly-midi-load')     as HTMLButtonElement;
  let parsed: ParsedMidi | null = null;

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]; if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    try { parsed = parseMidiFile(buf); }
    catch (err) { alert('Not a valid SMF: ' + (err as Error).message); return; }
    trackListEl.innerHTML = '';
    for (const tr of parsed.tracks) {
      if (tr.notes.length === 0) continue;
      const lo = Math.min(...tr.notes.map((n) => n.midi));
      const hi = Math.max(...tr.notes.map((n) => n.midi));
      const lbl = document.createElement('label');
      lbl.className = 'midi-track-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.dataset.idx = String(tr.index); cb.checked = true;
      const txt = document.createElement('span');
      txt.textContent = ` [${tr.index}] ${tr.name || 'untitled'} — ${tr.notes.length} notes, range ${lo}-${hi}, prog ${tr.program}`;
      lbl.append(cb, txt); trackListEl.appendChild(lbl);
    }
    trackListEl.style.display = '';
    loadBtn.style.display = '';
    loadBtn.disabled = !isPresetsReady();
  });

  loadBtn.addEventListener('click', async () => {
    if (!parsed) return;
    if (!isPresetsReady()) { alert('Presets still loading, retry in a moment'); return; }
    const checks = Array.from(trackListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'));
    const indices = checks.map((cb) => parseInt(cb.dataset.idx ?? '', 10));
    const result = midiToSession(parsed, { selectedTrackIndices: indices, rng: Math.random });

    const choice = window.confirm(
      `MIDI parsed: ${result.newLanes.length} tonal tracks` +
      (result.drumClip ? ' + drum clip' : '') +
      (result.bpm ? ` @ ${Math.round(result.bpm)} BPM` : '') +
      `\n\nOK = Add to current session.\nCancel = Replace session.\n(Use browser Back to abort.)`
    );

    const doAdd = choice;

    if (doAdd) {
      deps.session.lanes.push(...result.newLanes);
      deps.session.scenes.push(result.scene);
      if (result.drumClip && deps.drumLaneId) {
        const drumLane = deps.session.lanes.find((l) => l.id === deps.drumLaneId);
        if (drumLane) {
          const idx = drumLane.clips.push(result.drumClip) - 1;
          result.scene.clipPerLane[drumLane.id] = idx;
        }
      } else if (result.drumClip) {
        console.warn('MIDI drums dropped — no drums lane in session');
      }
    } else {
      const preservedDrumLane = deps.drumLaneId ? deps.session.lanes.find((l) => l.id === deps.drumLaneId) ?? null : null;
      deps.session.lanes = preservedDrumLane ? [preservedDrumLane, ...result.newLanes] : [...result.newLanes];
      deps.session.scenes = [result.scene];
      if (result.drumClip && preservedDrumLane) {
        const idx = preservedDrumLane.clips.push(result.drumClip) - 1;
        result.scene.clipPerLane[preservedDrumLane.id] = idx;
      } else if (result.drumClip) {
        console.warn('MIDI drums dropped — no drums lane in session');
      }
    }

    if (result.bpm) deps.transport.setBpm(result.bpm);
    for (const lane of result.newLanes) await applyPresetToLane(lane.id, lane.enginePresetName!);
    if (result.drumKitMatch && deps.drumLaneId)
      await applyPresetToLane(deps.drumLaneId, `factory:${result.drumKitMatch.presetName}`);

    deps.onSessionChanged();
    deps.launchScene(result.scene.id);
    deps.flashButton(loadBtn, `Loaded ${result.newLanes.length} lane(s), ${result.drumClip ? '1' : '0'} drum clip`);
  });
}
```

- [ ] **Step 3: Wire into `main.ts`**

Replace the old `wireMidiImport(...)` call with `wireMidiImportUI({ session, transport, drumLaneId, onSessionChanged, launchScene, flashButton })`. The deps `drumLaneId` is the id of the existing drums lane in the boot session.

- [ ] **Step 4: Typecheck + manual test**

Run: `npx tsc --noEmit`. Then `npm run dev` and try loading the test MIDI under `assets/` if present (or any small SMF). Verify: lanes appear, presets are applied, scene auto-launches, BPM changes.

- [ ] **Step 5: Commit**

```bash
git add src/midi/midi-import-ui.ts src/main.ts
git commit -m "feat(midi): import UI writes lanes/clips/scene with Add/Replace modal"
```

---

### Task E4: Delete legacy `midi-import.ts`

**Files:**
- Delete: `src/midi/midi-import.ts`, `src/midi/midi-import.test.ts`

- [ ] **Step 1: Verify no remaining importers**

Run: Grep for `from '.*midi-import'` in `src/`.
Expected: nothing (main.ts now imports `midi-import-ui`).

- [ ] **Step 2: Delete**

```bash
git rm src/midi/midi-import.ts src/midi/midi-import.test.ts
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(midi): remove legacy midi-import.ts (split into parse/transform/ui)"
```

---

## Phase F — Cross-cutting cleanup

### Task F1: `applyPresetToLane` generic helper

**Files:**
- Create: `src/presets/preset-apply.ts`
- Modify: `src/polysynth/polysynth-presets.ts` (remove `applyPresetByName`)
- Modify: any call sites that use `applyPresetByName`

- [ ] **Step 1: Implement `preset-apply.ts`**

```ts
import { getCachedPresets } from './preset-loader';
import { getEngineForLane } from '../session/synth-editor-routing'; // verify the actual export

export async function applyPresetToLane(laneId: string, presetName: string): Promise<void> {
  const engine = getEngineForLane(laneId);
  if (!engine) return;
  const bare = presetName.replace(/^factory:/, '').replace(/^user:/, '').replace(/^engine:/, '');
  const presets = getCachedPresets(engine.id);
  const p = presets.find((x) => x.name === bare);
  if (!p) { console.warn(`[preset-apply] no preset "${bare}" for ${engine.id}`); return; }
  engine.applyPreset(bare);
}
```

If `getEngineForLane` doesn't exist with that name, locate the function that looks up the per-lane engine instance in current code and use whichever export is canonical.

- [ ] **Step 2: Migrate call sites**

Grep for `applyPresetByName` in `src/`. For each call site, swap to `applyPresetToLane(laneId, name)`. Note `applyPresetByName(poly, name)` callers may not have a laneId in scope — pass the active lane id from `getActiveEngineLaneId()`.

- [ ] **Step 3: Delete `applyPresetByName` from `polysynth-presets.ts`**

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(presets): unify preset application via applyPresetToLane"
```

---

### Task F2: Remove `extraPolyTracks` from PatternData

**Files:**
- Modify: `src/core/pattern.ts`
- Modify: `src/session/session-migration.ts`
- Modify: `src/main.ts`, `src/core/randomize-ui.ts`, `src/copy/lane-copy.ts`, `src/save/save-manager.ts`, `src/demo/demo-minimal-techno.ts`

- [ ] **Step 1: Grep**

Find every read/write of `extraPolyTracks` and `MAX_EXTRA_POLY_TRACKS`.

- [ ] **Step 2: Remove the field**

Edit `src/core/pattern.ts`: delete `extraPolyTracks: ExtraPolyTrack[]` and `MAX_EXTRA_POLY_TRACKS`. Delete the `ExtraPolyTrack` type if no consumer remains.

- [ ] **Step 3: Strip read sites**

Walk each file from step 1. Delete or replace code that references the field. Goal: no functional change beyond removing dead paths.

- [ ] **Step 4: Migration ignores the field**

In `src/session/session-migration.ts`, ensure that if a saved pattern has `extraPolyTracks` at load time, it's silently dropped. (This is usually default if the type no longer declares it.)

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && NO_COLOR=1 npm test`
Expected: clean. If a test exercised extra-poly behavior, delete or migrate the test.

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: remove legacy extraPolyTracks model (superseded by Session)"
```

---

### Task F3: Unify duplicate GM drum maps

**Files:**
- Modify: any reference to `DRUM_NOTE_TO_VOICE` (only relevant if a stray copy remains after E4)
- Authoritative: `src/engines/drum-gm-map.ts` (`GM_DRUM_MAP`)

- [ ] **Step 1: Grep `DRUM_NOTE_TO_VOICE`**

Expected: zero hits after E4 (the table lived in the old `midi-import.ts`). If any survives, replace with `GM_DRUM_MAP` import.

- [ ] **Step 2: Verify drum-grid editor and `midi-to-session` both consume `GM_DRUM_MAP`**

The drum-grid editor uses it to render rows; the importer's drum-clip notes carry GM note numbers (35/36/38/etc.) so the runtime mapping happens via the same table.

- [ ] **Step 3: Commit if there was anything to change**

```bash
git commit -m "refactor: GM_DRUM_MAP is the sole source of MIDI-to-drum-voice mapping"
```

(Skip this task entirely if step 1 shows zero hits.)

---

## Final checks

### Task FINAL: Full test sweep + manual audition

- [ ] `npx tsc --noEmit`
- [ ] `NO_COLOR=1 npm run test:unit`
- [ ] `NO_COLOR=1 npm run test:dsp`
- [ ] `NO_COLOR=1 npm run test:e2e` (Playwright)
- [ ] `npm run dev` → open http://localhost:5173 → import a real SMF → verify lanes/clip/scene appear and play.
- [ ] Final commit message ends the branch:

```bash
git commit --allow-empty -m "feat(midi): MIDI import + GM-tagged engine presets complete"
```

---

## Self-Review Notes

- The plan covers every section of the spec: type changes, JSON loader, per-engine content (≥20 each), GM lookup, importer, cleanup.
- All steps that introduce code show the code in the step body — no placeholder TODOs.
- The plan does not enumerate all 100+ preset bodies; instead it tells the executor to author them in the dev server with a stated workflow. This is intentional — preset params are creative content, not code.
- Names used in later tasks (`applyPresetToLane`, `getCachedPresets`, `pickPresetForGM`, `midiToSession`) are introduced in earlier tasks.
- Files modified in parallel work: the plan instructs the executor to re-read current state before each editing task to catch drift.
