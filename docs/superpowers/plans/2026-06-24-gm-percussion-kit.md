# GM Percussion kit (VCSL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GM-complete sample percussion kit (VCSL/CC0, ~52 pads) playable through the existing sampler-drumkit path, a drum grid that edits compactly (used sounds only, with a "show full kit" toggle), and MIDI import that auto-assigns the kit to channel-10 tracks so their notes sound.

**Architecture:** The kit is pure data: a generator downloads curated VCSL samples into `public/drumkits/gm-percussion/`, writes a manifest + index + preset entry. At runtime a sample drumkit is a sampler keymap (one single-note pad per GM note); the editor already draws N rows via an injected `DrumGridModel`. We extend three seams: per-pad repitch in the manifest, GM percussion row labels, a compact/full row model + toggle, and import wiring that loads the kit for percussion tracks.

**Tech Stack:** TypeScript + Vite, AudioWorklet (synthesis + sampling in-worklet), vitest (node, no browser for pure logic), Node ESM scripts (`tools/*.mjs`).

> **ON THE AUDIOWORKLET REWRITE (2026-06-24).** The legacy node-per-note
> `SamplerVoice`/`DrumsEngine` were deleted; sampling runs through
> `SamplerWorkletEngine`. The rewrite has **landed on `main`** (`6474344`), so this
> branch is rebased onto `main`, which already contains the worklet. A full seam
> re-map confirmed the GM kit survives almost unchanged. Net deltas vs. the
> original plan:
> - **Tasks 1, 2, 4, 5, 6 unchanged** — `buildDrumkitKeymap`/`repitchRate` honor `rootNote`; the drum-grid editor, `samplerDrumModel`, `chooseClipEditor` are intact.
> - **Task 3:** register the kit in `public/drumkits/index.json` ONLY (Sampler selector). Do **not** write to `drum-kits.json`.
> - **Task 7/8:** the percussion lane is `engineId: 'sampler'` with `engineState.sampler.drumkitId` (no `kitMode`, no `enginePresetName`). `'sampler'` is mandatory so `samplerDrumModel` produces the ~52 rows (a `drums` lane shows only 8).
> - **Task 9 (rewritten):** drop the `loadDrumkitById` helper; instead fire the existing `reloadDrumkit(self, laneId, kitId, engine)` in `launchSceneById` for imported sampler-drumkit lanes (it does fetch+decode+`setKeymap`→worklet `loadSample`+mirror). `main.ts` is not unit-tested → manual verification.

## Global Constraints

- **All UI text in English** (labels, toggle text, preset/group names). Spanish is only for chat.
- **Relative assertions only** in tests (ratios/lengths/shapes), never absolute magnitudes.
- **TDD**: failing test → minimal impl → green → commit. One behavior per test; one test per user path.
- **Sample source = VCSL** (`github:sgossner/VCSL`, master), **CC0**. Base URL `https://raw.githubusercontent.com/sgossner/VCSL/master/`. Catalog paths are already `%20`-encoded — do NOT re-encode.
- **Generated WAVs are committed** (like the 523 existing drumkit files). Credit VCSL in README.
- **Never touch hand-made kits** (`tr808`, `acoustic`, `dirt`) or the tidal generator.
- **Registration:** the kit is a Sampler drumkit. Register it in `public/drumkits/index.json` (`{ id, name }`) — that is what surfaces it in the Sampler preset selector (`polysynth-presets.ts` → `listDrumkits()` → `loadFamilyRef('drumkit:<id>')`). Do NOT add it to `drum-kits.json` (the Drums-page list).
- **Drumkit manifest shape:** `{ id, name, samples: DrumkitSample[] }` at `public/drumkits/<id>.json` (each sample `{ voice, note, file, root?, gain? }`).
- **Drum lane engine id:** a sample drumkit lane MUST use `engineId: 'sampler'` (SamplerWorkletEngine) so `samplerDrumModel` renders one grid row per pad; a `drums` lane would show the fixed 8 rows.
- **Worktree:** all work happens in `.claude/worktrees/gm-percussion-kit`. Run `npm install` there once before building/testing.

## Key existing symbols (re-mapped on the worklet base — use these exact names)

Data / keymap (UNCHANGED by the rewrite):
- `buildDrumkitKeymap(samples: DrumkitSample[], sampleIds: string[]): KeymapEntry[]` — `src/samples/drumkit-loader.ts:50`. Pure; currently `rootNote = loNote = hiNote = sample.note`.
- `DrumkitSample` interface — `src/samples/drumkit-loader.ts:18` (`{ voice; note; file; gain? }`).
- `loadDrumkit(manifest, ctx, deps)` — `:88`; `fetchDrumkitManifest(id, fetchFn)` — `:80`; `listDrumkits(fetchFn)` — `:64`.
- `KeymapEntry` — `src/samples/types.ts:22` (`{ sampleId; rootNote; loNote; hiNote; gain? }`).
- `keymapEntryFor(keymap, midi)` — `src/samples/keymap.ts:9`; `repitchRate(midi, rootNote, pitchSemitones=0) = 2^((midi-rootNote+pitchSemitones)/12)` — `:19`. Confirmed: `resolveSpawn` calls `repitchRate(midi, entry.rootNote, pad.tune)`, so a pad with `rootNote !== note` repitches; the worklet only applies the resolved `rate`.
- `GM_DRUM_MAP`, `VOICE_MIDI` — `src/engines/drum-gm-map.ts`.

Editor / router (UNCHANGED by the rewrite):
- `samplerDrumModel(lane, midiLabel): DrumGridModel | undefined` — `src/session/clip-editors/clip-editor-router.ts:94`. Reads `lane.engineState.sampler.keymap`, dedups by `rootNote`, labels via `GM_DRUM_MAP`→`LANE_LABELS` else `midiLabel`. Called only when `lane.engineId === 'sampler'`, at `clip-editor-router.ts:234`.
- `chooseClipEditor` — `clip-editor-router.ts:66`; routes to `drum-grid` when `engineId === 'sampler' && (drumkitId || all-single-note)` (`:85`).
- `DrumGridModel { rows: DrumRows; labels: string[] }` — `clip-editor-drum-grid.ts:37`. `noteDrumRows(notes)` — `src/core/drum-grid-editing.ts:60`.
- `renderDrumGridEditor(host, clip, historyDeps?, meter?, deps?, model?)` — `clip-editor-drum-grid.ts:68`. `DrumEditorDeps` — `:56`. `ROW_H=26` `:42`, `ROWS_N`/`FRAME_H` consts `:82-83`, `resize()` `:157`, `drawLabels()` `:170`, `draw()` `:182`, toolbar assembled `:104-116`.
- `createFollowToggle(onChange?): HTMLButtonElement` — `src/core/clip-editor-toolbar.ts:67` (single-button pill; the pattern to copy).

Worklet sampler / load path (NEW — the rewrite):
- `SamplerWorkletEngine` — `src/engines/sampler-worklet-engine.ts:80`. `setKeymap(entries)` `:233` → `pushAllKeymapBuffers()` `:148` → `pushBuffer(id)` `:141` → `SamplerWorkletNode.loadSample(id, buf)` (`src/audio-worklet/sampler-node.ts:88`). `loadFamilyRef('drumkit:<id>')` `:249`. `resolveSpawn(midi,…)` `:320`.
- `reloadDrumkit(self: SessionHost, laneId, kitId, engine: { setKeymap })` — `src/session/session-host-presets.ts:19`. Fetch manifest → `loadDrumkit` → `engine.setKeymap()` → mirror keymap+drumkitId. Use this for import load (Task 9).
- `mirrorKeymapChange(state, laneId, keymap)` — `src/session/session-engine-state.ts:57`; `mirrorDrumkitId(state, laneId, id)` — `:78`.
- `createLaneEngine(laneId, engineId, inserts)` — `src/app/lane-allocator.ts:67` (routes `sampler`→`SamplerWorkletEngine`); `ensureLaneResource(laneId, engineId)` — `:230` (sole allocation path).
- Manual load already lists the kit: `polysynth-presets.ts:182` calls `listDrumkits()`, `:197` builds `sampler:drumkit:<id>` options, `:591` calls `engine.loadFamilyRef`.

Import:
- `suggestDefaultMapping(parsed, indices)` — `src/midi/gm-lookup.ts:85`; `GMMatch { engineId; presetName }` — `:4`; `firstMatchForGM`/`engineHintFromName` (`drum`/`perc` → `drums-machine`).
- `midiToSession(parsed, opts)` — `src/midi/midi-to-session.ts:21`; lane built `:80-88` (`enginePresetName = 'factory:'+presetName` at `:87`).
- `launchSceneById` — `src/main.ts:951`; loop ensuring resources + applying preset on first allocation `:964-968`; `applyPresetToEngine` — `src/presets/preset-apply.ts:28` (SYNC; does not load sample kits).
- `ParsedTrack.notes[].channel` exists — `src/midi/midi-parse.ts:6`.
- `SessionLane.engineState` — `src/session/session.ts:100-116` (`sampler.{keymap, drumkitId, instrumentId, padParams}`, `kitMode: 'synth'|'sample'`).

## File Structure

- **Create** `tools/vcsl.json` — vendored VCSL catalog (copy of `strudel/website/public/vcsl.json`).
- **Create** `tools/build-gm-percussion-kit.mjs` — generator (pure data output).
- **Create** `tools/build-gm-percussion-kit.test.mjs` — pure test of the mapping table vs the catalog. (Or a `.test.ts` under `src/`; see Task 3.)
- **Create** (generated, committed) `public/drumkits/gm-percussion.json` + `public/drumkits/gm-percussion/*.wav`.
- **Modify** `public/drumkits/index.json` (generated entry). NOT `drum-kits.json`.
- **Modify** `src/samples/drumkit-loader.ts` (+`root?`, repitch in `buildDrumkitKeymap`).
- **Modify** `src/engines/drum-gm-map.ts` (+`GM_PERCUSSION_NAMES`).
- **Create** `src/core/clip-drum-fullkit.ts` (session-global "show full kit" flag).
- **Modify** `src/core/clip-editor-toolbar.ts` (+`createFullKitToggle`).
- **Modify** `src/session/clip-editors/clip-editor-router.ts` (`samplerDrumModel` gains `clip`+`fullKit`; build labels via `GM_PERCUSSION_NAMES`; pass `deps.fullKit`).
- **Modify** `src/session/clip-editors/clip-editor-drum-grid.ts` (reassignable model, toggle, vertical scroll, `ROW_H`).
- **Modify** `src/midi/gm-lookup.ts` (+`isPercussionTrack`, `GMMatch.drumkitId?`, percussion default).
- **Modify** `src/midi/midi-to-session.ts` (drumkit lane `engineState.sampler.drumkitId`).
- **Modify** `src/main.ts` (`launchSceneById` fires `reloadDrumkit` for imported percussion lanes).
- **Modify** `README.md` (credit VCSL; one line).

---

### Task 1: Per-pad repitch in the drumkit manifest

**Files:**
- Modify: `src/samples/drumkit-loader.ts:18` (interface) and `:50` (`buildDrumkitKeymap`)
- Test: `src/samples/drumkit-loader.test.ts`

**Interfaces:**
- Produces: `DrumkitSample` gains `root?: number`; `buildDrumkitKeymap` maps `rootNote: s.root ?? s.note`, keeping `loNote === hiNote === s.note`.

- [ ] **Step 1: Write the failing test** (append to `src/samples/drumkit-loader.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { buildDrumkitKeymap, type DrumkitSample } from './drumkit-loader';

describe('buildDrumkitKeymap repitch (root)', () => {
  it('uses root as rootNote while pinning loNote/hiNote to note', () => {
    const samples: DrumkitSample[] = [
      { voice: 'tomHi', note: 50, file: 'k/50.wav', root: 47 }, // repitched +3
      { voice: 'cabasa', note: 69, file: 'k/69.wav' },          // native
    ];
    const km = buildDrumkitKeymap(samples, ['s0', 's1']);
    expect(km[0]).toMatchObject({ sampleId: 's0', rootNote: 47, loNote: 50, hiNote: 50 });
    expect(km[1]).toMatchObject({ sampleId: 's1', rootNote: 69, loNote: 69, hiNote: 69 });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NO_COLOR=1 npx vitest run src/samples/drumkit-loader.test.ts -t "repitch"`
Expected: FAIL (`rootNote` is 50, not 47 — `root` not yet honored).

- [ ] **Step 3: Implement**

In `src/samples/drumkit-loader.ts`, add `root?: number;` to `DrumkitSample` (after `gain?`), with a comment: `// sample's nominal pitch; repitch = note - root. Absent ⇒ native pitch.` Then change `buildDrumkitKeymap`'s map body:

```ts
  return samples.map((s, i) => ({
    sampleId: sampleIds[i],
    rootNote: s.root ?? s.note,
    loNote: s.note,
    hiNote: s.note,
    ...(s.gain != null ? { gain: s.gain } : {}),
  }));
```

- [ ] **Step 4: Run it, verify it passes**

Run: `NO_COLOR=1 npx vitest run src/samples/drumkit-loader.test.ts`
Expected: PASS (all existing drumkit-loader tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/samples/drumkit-loader.ts src/samples/drumkit-loader.test.ts
git commit -m "feat(drumkit): optional per-pad repitch (root) in buildDrumkitKeymap"
```

---

### Task 2: GM percussion row-label table

**Files:**
- Modify: `src/engines/drum-gm-map.ts`
- Test: `src/engines/drum-gm-map.test.ts` (create if absent)

**Interfaces:**
- Produces: `export const GM_PERCUSSION_NAMES: Record<number, string>` — short English label per GM note 27–87.

- [ ] **Step 1: Write the failing test** (`src/engines/drum-gm-map.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { GM_PERCUSSION_NAMES } from './drum-gm-map';

describe('GM_PERCUSSION_NAMES', () => {
  it('labels the tropical/uncovered notes', () => {
    expect(GM_PERCUSSION_NAMES[54]).toBe('Tamb');
    expect(GM_PERCUSSION_NAMES[69]).toBe('Cabasa');
    expect(GM_PERCUSSION_NAMES[60]).toBe('Hi Bongo');
    expect(GM_PERCUSSION_NAMES[64]).toBe('Lo Conga');
    expect(GM_PERCUSSION_NAMES[36]).toBe('Kick');
  });
  it('covers the full standard GM range 35..81', () => {
    for (let n = 35; n <= 81; n++) expect(GM_PERCUSSION_NAMES[n], `note ${n}`).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-gm-map.test.ts`
Expected: FAIL (`GM_PERCUSSION_NAMES` undefined).

- [ ] **Step 3: Implement** — append to `src/engines/drum-gm-map.ts`:

```ts
// Short English labels for the GM percussion map (channel 10), notes 27..87.
// Used by the drum grid to label sample-drumkit rows (sampler pads) by their
// percussion name instead of a bare note name. Kept terse to fit the 54px label column.
export const GM_PERCUSSION_NAMES: Record<number, string> = {
  27: 'High Q', 28: 'Slap', 29: 'Scratch+', 30: 'Scratch-', 31: 'Sticks',
  32: 'Sq Click', 33: 'Metro', 34: 'Metro Bell',
  35: 'Kick A', 36: 'Kick', 37: 'Side Stk', 38: 'Snare', 39: 'Clap', 40: 'Snare E',
  41: 'Lo Floor', 42: 'CH', 43: 'Hi Floor', 44: 'Pedal HH', 45: 'Lo Tom', 46: 'OH',
  47: 'LoMid Tom', 48: 'HiMid Tom', 49: 'Crash 1', 50: 'Hi Tom', 51: 'Ride 1',
  52: 'China', 53: 'Ride Bell', 54: 'Tamb', 55: 'Splash', 56: 'Cowbell',
  57: 'Crash 2', 58: 'Vibrslap', 59: 'Ride 2',
  60: 'Hi Bongo', 61: 'Lo Bongo', 62: 'Mute Cga', 63: 'Open Cga', 64: 'Lo Conga',
  65: 'Hi Timb', 66: 'Lo Timb', 67: 'Hi Agogo', 68: 'Lo Agogo', 69: 'Cabasa', 70: 'Maracas',
  71: 'S Whistle', 72: 'L Whistle', 73: 'S Guiro', 74: 'L Guiro', 75: 'Claves',
  76: 'Hi Wood', 77: 'Lo Wood', 78: 'Mute Cuica', 79: 'Open Cuica',
  80: 'Mute Tri', 81: 'Open Tri', 82: 'Shaker', 83: 'Jingle', 84: 'Belltree',
  85: 'Castanet', 86: 'Mute Surdo', 87: 'Open Surdo',
};
```

- [ ] **Step 4: Run it, verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-gm-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/drum-gm-map.ts src/engines/drum-gm-map.test.ts
git commit -m "feat(drums): GM percussion row-label table (GM_PERCUSSION_NAMES)"
```

---

### Task 3: The GM Percussion kit generator + generated assets

**Files:**
- Create: `tools/vcsl.json` (copy of `c:/Users/nacho/git/strudel/website/public/vcsl.json`)
- Create: `tools/build-gm-percussion-kit.mjs`
- Create: `tools/build-gm-percussion-kit.test.mjs`
- Generated (commit): `public/drumkits/gm-percussion.json`, `public/drumkits/gm-percussion/*.wav`
- Modify (generated): `public/drumkits/index.json` (NOT `drum-kits.json`)

**Interfaces:**
- Produces: a kit `gm-percussion` whose manifest `samples[]` are `{voice, note, file, root?}`; an `index.json` entry `{ id:'gm-percussion', name:'GM Percussion' }` (surfaces it in the Sampler preset selector). NO `drum-kits.json` change.

- [ ] **Step 1: Vendor the catalog**

```bash
cp "c:/Users/nacho/git/strudel/website/public/vcsl.json" tools/vcsl.json
```

- [ ] **Step 2: Write the generator** `tools/build-gm-percussion-kit.mjs`

```js
// tools/build-gm-percussion-kit.mjs
// Builds the "GM Percussion" sample drumkit from VCSL (github:sgossner/VCSL,
// CC0). Maps each GM percussion note (35..87 + a few GM2 extras) to one VCSL
// sample, downloads it into public/drumkits/gm-percussion/<note>.wav, and writes
// the manifest + index entry + drum-kits preset. Pure data output; re-runnable.
//
//   node tools/build-gm-percussion-kit.mjs            # download + write
//   node tools/build-gm-percussion-kit.mjs --dry      # resolve + report, no download
//   node tools/build-gm-percussion-kit.mjs --list KEY # print a VCSL key's files
//
// Source: https://github.com/sgossner/VCSL (CC0). Catalog vendored at tools/vcsl.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public', 'drumkits');
const KIT_ID = 'gm-percussion';
const KIT_NAME = 'GM Percussion';
const BASE = 'https://raw.githubusercontent.com/sgossner/VCSL/master/';

// note → { voice, key (VCSL catalog key), pick (ordered filename substrings;
// first hit wins, else falls back to the key's first file), root (optional
// repitch home; absent = native pitch) }. Substitutes are intentional where VCSL
// has no exact instrument (see spec). pick[] is best-effort; the report prints
// the actual chosen file so picks can be refined with --list.
const PADS = [
  { note: 35, voice: 'kickA',     key: 'bassdrum2',   pick: [] },
  { note: 36, voice: 'kick',      key: 'bassdrum1',   pick: [] },
  { note: 37, voice: 'sideStick', key: 'snare_rim',   pick: [] },
  { note: 38, voice: 'snare',     key: 'snare_modern',pick: ['Hit', 'hit'] },
  { note: 39, voice: 'clap',      key: 'clap',        pick: [] },
  { note: 40, voice: 'snareE',    key: 'snare_hi',    pick: [] },
  { note: 41, voice: 'tomLoFloor',key: 'tom2_mallet', pick: [], root: 43 },
  { note: 43, voice: 'tomHiFloor',key: 'tom2_mallet', pick: [] },
  { note: 45, voice: 'tomLo',     key: 'tom2_mallet', pick: [], root: 43 },
  { note: 47, voice: 'tomLoMid',  key: 'tom_mallet',  pick: [] },
  { note: 48, voice: 'tomHiMid',  key: 'tom_mallet',  pick: [], root: 47 },
  { note: 50, voice: 'tomHi',     key: 'tom_mallet',  pick: [], root: 47 },
  { note: 42, voice: 'closedHat', key: 'hihat',       pick: ['closed', 'Closed', 'shut', 'tight'] },
  { note: 44, voice: 'pedalHat',  key: 'hihat',       pick: ['pedal', 'Pedal', 'foot', 'closed'] },
  { note: 46, voice: 'openHat',   key: 'hihat',       pick: ['open', 'Open'] },
  { note: 49, voice: 'crash1',    key: 'clash',       pick: [] },
  { note: 51, voice: 'ride1',     key: 'sus_cymbal',  pick: [] },
  { note: 52, voice: 'china',     key: 'gong2',       pick: [] },
  { note: 53, voice: 'rideBell',  key: 'fingercymbal',pick: [] },
  { note: 55, voice: 'splash',    key: 'clash2',      pick: [] },
  { note: 57, voice: 'crash2',    key: 'clash2',      pick: [] },
  { note: 59, voice: 'ride2',     key: 'sus_cymbal2', pick: [] },
  { note: 54, voice: 'tamb',      key: 'tambourine',  pick: ['Hit', 'hit'] },
  { note: 56, voice: 'cowbell',   key: 'cowbell',     pick: ['Cowbell1_Hit', 'Hit'] },
  { note: 58, voice: 'vibraslap', key: 'vibraslap',   pick: [] },
  { note: 60, voice: 'bongoHi',   key: 'bongo',       pick: ['BongoH_Hit', 'BongoH'] },
  { note: 61, voice: 'bongoLo',   key: 'bongo',       pick: ['BongoL_Hit', 'BongoL'] },
  { note: 62, voice: 'congaMute', key: 'conga',       pick: ['Quinto_HitFM', 'HitFM'] },
  { note: 63, voice: 'congaOpen', key: 'conga',       pick: ['Quinto_HitN', 'Conga_HitN'] },
  { note: 64, voice: 'congaLo',   key: 'conga',       pick: ['Tumba_HitN', 'Tumba'] },
  { note: 65, voice: 'timbaleHi', key: 'tom2_rim',    pick: [], root: 60 },
  { note: 66, voice: 'timbaleLo', key: 'tom2_rim',    pick: [], root: 64 },
  { note: 67, voice: 'agogoHi',   key: 'agogo',       pick: ['Agogo_High', 'High'] },
  { note: 68, voice: 'agogoLo',   key: 'agogo',       pick: ['Agogo_Low', 'Low'] },
  { note: 69, voice: 'cabasa',    key: 'cabasa',      pick: ['Cabasa1_Hit', 'Hit'] },
  { note: 70, voice: 'maracas',   key: 'shaker_small',pick: ['Slap', 'Hit'] },
  { note: 71, voice: 'whistleS',  key: 'ballwhistle', pick: ['Short'] },
  { note: 72, voice: 'whistleL',  key: 'ballwhistle', pick: ['Long'] },
  { note: 73, voice: 'guiroS',    key: 'guiro',       pick: ['Guiro_Hit', 'Fast'] },
  { note: 74, voice: 'guiroL',    key: 'guiro',       pick: ['Slow', 'Med'] },
  { note: 75, voice: 'claves',    key: 'clave',       pick: ['Claves1_Hit', 'Hit'] },
  { note: 76, voice: 'woodHi',    key: 'woodblock',   pick: ['wood_click_mp', 'click'], root: 72 },
  { note: 77, voice: 'woodLo',    key: 'woodblock',   pick: ['wood_click_mp', 'click'] },
  { note: 78, voice: 'cuicaMute', key: 'darbuka',     pick: ['mute', 'dum', 'Dum'], root: 64 },
  { note: 79, voice: 'cuicaOpen', key: 'darbuka',     pick: ['open', 'tek', 'Tek'], root: 60 },
  { note: 80, voice: 'triMute',   key: 'triangles',   pick: ['HitM', 'Hit_'] },
  { note: 81, voice: 'triOpen',   key: 'triangles',   pick: ['Triangle1_Hit_v1', 'Hit_'] },
  { note: 82, voice: 'shaker',    key: 'shaker_large',pick: ['LShaker_Hit', 'Hit'] },
  { note: 83, voice: 'jingle',    key: 'sleighbells', pick: [] },
  { note: 84, voice: 'belltree',  key: 'marktrees',   pick: [] },
  { note: 85, voice: 'castanet',  key: 'slapstick',   pick: [] },
  { note: 86, voice: 'surdoMute', key: 'framedrum',   pick: ['mute', 'Mute'], root: 43 },
  { note: 87, voice: 'surdoOpen', key: 'framedrum',   pick: ['open', 'Open', 'Hit'], root: 41 },
];

function pickFile(catalog, pad) {
  const arr = catalog[pad.key];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  for (const sub of pad.pick) {
    const hit = arr.find((p) => p.toLowerCase().includes(sub.toLowerCase()));
    if (hit) return hit;
  }
  return arr[0]; // fallback: first file for the key
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

const catalog = JSON.parse(await readFile(path.join(__dirname, 'vcsl.json'), 'utf8'));

// --list KEY
const listIdx = process.argv.indexOf('--list');
if (listIdx >= 0) {
  const key = process.argv[listIdx + 1];
  console.log((catalog[key] ?? [`(no key '${key}')`]).join('\n'));
  process.exit(0);
}
const DRY = process.argv.includes('--dry');

// resolve every pad
const resolved = [];
const missing = [];
for (const pad of PADS) {
  const src = pickFile(catalog, pad);
  if (!src) { missing.push(pad); continue; }
  resolved.push({ ...pad, src, file: `${KIT_ID}/${pad.note}.wav` });
}

console.log(`Pads: ${PADS.length} | resolved: ${resolved.length} | missing key: ${missing.length}`);
for (const r of resolved) console.log(`  ${String(r.note).padStart(3)} ${r.voice.padEnd(11)} ${r.key.padEnd(14)} -> ${decodeURIComponent(r.src.split('/').pop())}`);
if (missing.length) { console.log('MISSING KEYS:'); missing.forEach((m) => console.log(`  ${m.note} ${m.voice} (${m.key})`)); }

if (DRY) process.exit(missing.length ? 1 : 0);
if (missing.length) { console.error('Refusing to build with missing keys — fix PADS.'); process.exit(1); }

// download
const destDir = path.join(PUB, KIT_ID);
await mkdir(destDir, { recursive: true });
let bytes = 0; const failures = [];
await pool(resolved, 12, async (r) => {
  const url = BASE + r.src; // already %20-encoded
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(path.join(PUB, r.file), buf);
    bytes += buf.length;
  } catch (e) { r.failed = true; failures.push(`${String(e)}  ${url}`); }
});

const ok = resolved.filter((r) => !r.failed);
if (ok.length < resolved.length) { console.log(`Download failures: ${failures.length}`); failures.forEach((f) => console.log('  ' + f)); }

// manifest
const manifest = {
  id: KIT_ID, name: KIT_NAME,
  samples: ok.map((r) => ({ voice: r.voice, note: r.note, file: r.file, ...(r.root != null ? { root: r.root } : {}) })),
};
await writeFile(path.join(PUB, `${KIT_ID}.json`), JSON.stringify(manifest, null, 2) + '\n');

// index.json — replace our entry
const indexPath = path.join(PUB, 'index.json');
let index = JSON.parse(await readFile(indexPath, 'utf8'));
index = index.filter((e) => e.id !== KIT_ID);
index.push({ id: KIT_ID, name: KIT_NAME });
await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');

// NOTE: we deliberately do NOT touch public/presets/drum-kits.json. That file is
// the Drums-page kit list (engineId 'drums'); the GM kit is a Sampler drumkit
// (engineId 'sampler') and surfaces via index.json in the Sampler selector,
// where the drum grid renders all ~52 pads (a Drums lane would show only 8).

console.log(`DONE: ${ok.length} pads, ${(bytes / 1e6).toFixed(1)} MB`);
```

- [ ] **Step 3: Write the mapping test** `tools/build-gm-percussion-kit.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-derive PADS by importing nothing executable: read the script text and the
// catalog, and assert every pad's VCSL key exists. (The generator is a top-level
// script; we validate its contract against the vendored catalog without network.)
const dir = path.dirname(fileURLToPath(import.meta.url));

describe('gm-percussion generator mapping', () => {
  it('every PADS key exists in the vendored VCSL catalog', async () => {
    const catalog = JSON.parse(await readFile(path.join(dir, 'vcsl.json'), 'utf8'));
    const src = await readFile(path.join(dir, 'build-gm-percussion-kit.mjs'), 'utf8');
    const keys = [...src.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) expect(catalog[k], `VCSL key '${k}'`).toBeTruthy();
  });
  it('notes are unique and within 27..87', async () => {
    const src = await readFile(path.join(dir, 'build-gm-percussion-kit.mjs'), 'utf8');
    const notes = [...src.matchAll(/note:\s*(\d+)/g)].map((m) => Number(m[1]));
    const uniq = new Set(notes);
    expect(uniq.size).toBe(notes.length);
    for (const n of notes) { expect(n).toBeGreaterThanOrEqual(27); expect(n).toBeLessThanOrEqual(87); }
  });
});
```

- [ ] **Step 4: Run the mapping test, verify it passes**

Run: `NO_COLOR=1 npx vitest run tools/build-gm-percussion-kit.test.mjs`
Expected: PASS. If a key fails, fix that pad's `key` in `PADS` to a key that exists (use `node tools/build-gm-percussion-kit.mjs --list <guess>` to explore).

- [ ] **Step 5: Refine ambiguous picks, then dry-run**

Run: `node tools/build-gm-percussion-kit.mjs --list hihat` (and `darbuka`, `framedrum`, `triangles`) and confirm the `pick[]` substrings select the intended file; adjust `PADS` if the fallback (first file) is wrong.
Then: `node tools/build-gm-percussion-kit.mjs --dry`
Expected: `resolved: 52 | missing key: 0`; inspect the printed note→file list for obvious mismatches.

- [ ] **Step 6: Generate for real**

Run: `node tools/build-gm-percussion-kit.mjs`
Expected: `DONE: 52 pads, ~3-5 MB`. Files appear under `public/drumkits/gm-percussion/`, `gm-percussion.json` written, `index.json` updated (NO `drum-kits.json` change).

- [ ] **Step 7: Credit VCSL in README** — add one line near the drumkit-sources note:

```md
- **GM Percussion** drum kit samples: [VCSL](https://github.com/sgossner/VCSL) (CC0).
```

- [ ] **Step 8: Commit**

```bash
git add tools/vcsl.json tools/build-gm-percussion-kit.mjs tools/build-gm-percussion-kit.test.mjs \
        public/drumkits/gm-percussion.json public/drumkits/gm-percussion public/drumkits/index.json \
        README.md
git commit -m "feat(drums): GM Percussion kit (VCSL/CC0) generator + generated assets"
```

---

### Task 4: Compact/full sampler drum model with GM labels

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts:94` (`samplerDrumModel`) and its call site `:234`
- Test: `src/session/clip-editors/clip-editor-router.test.ts`

**Interfaces:**
- Consumes: `GM_PERCUSSION_NAMES` (Task 2), `noteDrumRows` (existing).
- Produces: `samplerDrumModel(lane, clip, midiLabel, fullKit): DrumGridModel | undefined`.
  - `fullKit === true` ⇒ rows = all keymap pads (dedup by `rootNote`, keymap order).
  - `fullKit === false` ⇒ rows = pads whose note appears in `clip.notes`; if none, a seed subset of the kit's pads whose note ∈ {36,38,42,46,39} (kick/snare/CH/OH/clap), in keymap order.
  - Labels: `GM_PERCUSSION_NAMES[n] ?? (GM_DRUM_MAP[n] ? LANE_LABELS[GM_DRUM_MAP[n]] : midiLabel(n))`.

- [ ] **Step 1: Write the failing test** (append to `clip-editor-router.test.ts`)

```ts
import { samplerDrumModel } from './clip-editor-router'; // export it (see Step 3)

const km = (notes: number[]) => notes.map((n) => ({ sampleId: `s${n}`, rootNote: n, loNote: n, hiNote: n }));
const laneWith = (notes: number[]) => ({ id: 'l1', engineId: 'sampler', clips: [], engineState: { sampler: { keymap: km(notes) } } } as any);
const clipWith = (used: number[]) => ({ id: 'c1', lengthBars: 1, notes: used.map((m) => ({ start: 0, duration: 6, midi: m, velocity: 80 })) } as any);
const lbl = (m: number) => `n${m}`;

describe('samplerDrumModel compact/full', () => {
  it('full mode lists every pad with GM percussion labels', () => {
    const m = samplerDrumModel(laneWith([36, 54, 69]), clipWith([]), lbl, true)!;
    expect(m.rows.count).toBe(3);
    expect(m.labels).toEqual(['Kick', 'Tamb', 'Cabasa']);
  });
  it('compact mode lists only the pads the clip uses', () => {
    const m = samplerDrumModel(laneWith([36, 54, 69, 42]), clipWith([54, 69]), lbl, false)!;
    expect(m.rows.count).toBe(2);
    expect(m.labels).toEqual(['Tamb', 'Cabasa']);
  });
  it('compact mode on an empty clip seeds the basic voices present in the kit', () => {
    const m = samplerDrumModel(laneWith([36, 38, 42, 46, 39, 69]), clipWith([]), lbl, false)!;
    expect(m.labels).toEqual(['Kick', 'Snare', 'CH', 'OH', 'Clap']);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-router.test.ts -t "compact/full"`
Expected: FAIL (`samplerDrumModel` not exported / wrong arity).

- [ ] **Step 3: Implement** — in `clip-editor-router.ts`:

1. `import { GM_DRUM_MAP, GM_PERCUSSION_NAMES } from '../../engines/drum-gm-map';` (extend the existing import).
2. Export `samplerDrumModel` and rewrite it:

```ts
const SEED_NOTES = [36, 38, 42, 46, 39]; // kick/snare/CH/OH/clap

export function samplerDrumModel(
  lane: SessionLane,
  clip: SessionClip,
  midiLabel: (m: number) => string,
  fullKit: boolean,
): DrumGridModel | undefined {
  const km = lane.engineState?.sampler?.keymap ?? [];
  const allNotes: number[] = [];
  const seen = new Set<number>();
  for (const e of km) { if (!seen.has(e.rootNote)) { seen.add(e.rootNote); allNotes.push(e.rootNote); } }
  if (allNotes.length === 0) return undefined;

  let notes: number[];
  if (fullKit) {
    notes = allNotes;
  } else {
    const used = new Set((clip.notes ?? []).map((n) => n.midi));
    notes = allNotes.filter((n) => used.has(n));
    if (notes.length === 0) notes = allNotes.filter((n) => SEED_NOTES.includes(n));
    if (notes.length === 0) notes = allNotes.slice(0, Math.min(5, allNotes.length));
  }
  const labels = notes.map((n) =>
    GM_PERCUSSION_NAMES[n] ?? (GM_DRUM_MAP[n] ? LANE_LABELS[GM_DRUM_MAP[n]] : midiLabel(n)));
  return { rows: noteDrumRows(notes), labels };
}
```

3. Update the call site (`:234`) — pass `clip` + the fullKit flag (Task 6 supplies it via `clip-drum-fullkit`):

```ts
import { isDrumFullKit } from '../../core/clip-drum-fullkit';
// ...
const model = lane.engineId === 'sampler'
  ? samplerDrumModel(lane, clip, deps.midiLabel, isDrumFullKit())
  : undefined;
```

(Task 5 creates `clip-drum-fullkit`; if executing strictly in order, temporarily inline `false` and fix in Task 6. Prefer doing Task 5 before this call-site edit.)

- [ ] **Step 4: Run it, verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-router.test.ts`
Expected: PASS (all router tests green).

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-editor-router.ts src/session/clip-editors/clip-editor-router.test.ts
git commit -m "feat(drum-grid): compact/full sampler drum model with GM labels"
```

---

### Task 5: Session-global "show full kit" flag + toggle factory

**Files:**
- Create: `src/core/clip-drum-fullkit.ts`
- Modify: `src/core/clip-editor-toolbar.ts`
- Test: `src/core/clip-drum-fullkit.test.ts`

**Interfaces:**
- Produces: `isDrumFullKit(): boolean`, `setDrumFullKit(v: boolean): void` (module-level state, default `false`, mirrors `clip-follow.ts`); `createFullKitToggle(onChange?: (on: boolean) => void): HTMLButtonElement`.

- [ ] **Step 1: Write the failing test** (`src/core/clip-drum-fullkit.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isDrumFullKit, setDrumFullKit } from './clip-drum-fullkit';

describe('clip-drum-fullkit', () => {
  beforeEach(() => setDrumFullKit(false));
  it('defaults to false (compact)', () => { expect(isDrumFullKit()).toBe(false); });
  it('round-trips', () => { setDrumFullKit(true); expect(isDrumFullKit()).toBe(true); });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/clip-drum-fullkit.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/core/clip-drum-fullkit.ts`:

```ts
// Session-global "show full kit" flag for the drum grid. Compact (false) shows
// only the sounds a clip uses; full (true) shows every kit pad. Mirrors
// clip-follow.ts: a simple module-level toggle, not persisted to saved state.
let fullKit = false;
export function isDrumFullKit(): boolean { return fullKit; }
export function setDrumFullKit(v: boolean): void { fullKit = v; }
```

- [ ] **Step 4: Add the toggle factory** to `src/core/clip-editor-toolbar.ts` (copy the `createFollowToggle` shape at `:67`):

```ts
import { isDrumFullKit, setDrumFullKit } from './clip-drum-fullkit';

/** A "Full kit" pill toggle for sampler drum grids: reflects the session-global
 *  fullKit flag; onChange fires after the flag flips so the editor can rebuild. */
export function createFullKitToggle(onChange?: (on: boolean) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'clip-loop-toggle';
  const paint = () => { btn.textContent = isDrumFullKit() ? 'Full kit ✓' : 'Full kit'; btn.classList.toggle('on', isDrumFullKit()); };
  paint();
  btn.addEventListener('click', () => { setDrumFullKit(!isDrumFullKit()); paint(); onChange?.(isDrumFullKit()); });
  return btn;
}
```

(If `createFollowToggle` uses a different class/pattern, match it exactly — read `:67` and mirror its CSS class and structure.)

- [ ] **Step 5: Run tests, verify green**

Run: `NO_COLOR=1 npx vitest run src/core/clip-drum-fullkit.test.ts`
Expected: PASS. (`createFullKitToggle` is DOM glue; covered by the visual check in Task 10.)

- [ ] **Step 6: Commit**

```bash
git add src/core/clip-drum-fullkit.ts src/core/clip-drum-fullkit.test.ts src/core/clip-editor-toolbar.ts
git commit -m "feat(drum-grid): session-global full-kit flag + toggle factory"
```

---

### Task 6: Drum-grid editor — reassignable model, toggle, vertical scroll

**Files:**
- Modify: `src/session/clip-editors/clip-editor-drum-grid.ts`
- Modify: `src/session/clip-editors/clip-editor-router.ts` (pass `deps.fullKit`)
- Test: `src/session/clip-editors/clip-editor-drum-grid.test.ts`

**Interfaces:**
- Consumes: `createFullKitToggle` (Task 5), `samplerDrumModel` (Task 4).
- Produces: `DrumEditorDeps.fullKit?: { build: (full: boolean) => DrumGridModel; onToggle?: () => void }`. When present, the editor renders the toggle and rebuilds the model in place on toggle.

- [ ] **Step 1: Write the failing test** (`clip-editor-drum-grid.test.ts`) — assert the toggle appears and rebuilding changes row count. Use jsdom (the file already runs in the vitest DOM environment if other DOM tests exist; otherwise add `// @vitest-environment jsdom` at top).

```ts
import { describe, it, expect } from 'vitest';
import { renderDrumGridEditor, type DrumGridModel } from './clip-editor-drum-grid';
import { noteDrumRows } from '../../core/drum-grid-editing';

const model = (notes: number[]): DrumGridModel => ({ rows: noteDrumRows(notes), labels: notes.map(String) });

describe('drum grid full-kit toggle', () => {
  it('renders a Full kit toggle when deps.fullKit is provided', () => {
    const host = document.createElement('div');
    const clip = { id: 'c', lengthBars: 1, notes: [] } as any;
    renderDrumGridEditor(host, clip, undefined, undefined, {
      fullKit: { build: (full) => model(full ? [36, 38, 42] : [36]) },
    }, model([36]));
    const btn = [...host.querySelectorAll('button')].find((b) => /full kit/i.test(b.textContent ?? ''));
    expect(btn).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-drum-grid.test.ts -t "full-kit"`
Expected: FAIL (no such button).

- [ ] **Step 3: Implement editor changes** in `clip-editor-drum-grid.ts`:

1. `const ROW_H = 22;` (was 26).
2. Extend `DrumEditorDeps` (`:56`):

```ts
  /** Sampler drumkit lanes only: lets the editor show a "Full kit" toggle and
   *  rebuild its row model in place. build(full) returns the model for the
   *  requested view; the global flag is owned by clip-drum-fullkit. */
  fullKit?: { build: (full: boolean) => DrumGridModel; onToggle?: () => void };
```

3. Make the model reassignable: replace the `const rows`/`const labels`/`const ROWS_N`/`const FRAME_H` (`:80-83`) with `let`, and add a `setModel` helper after `resize` is defined:

```ts
  let activeModel = model;
  let rows = activeModel.rows;
  let labels = activeModel.labels;
  let ROWS_N = Math.max(1, rows.count);
  let FRAME_H = RULER_H + ROW_H * ROWS_N + VEL_LANE_H;
```

   Anywhere `FRAME_H`/`ROWS_N`/`rows`/`labels` are read stays the same (they now read the `let`s). Add:

```ts
  function setModel(m: DrumGridModel): void {
    activeModel = m; rows = m.rows; labels = m.labels;
    ROWS_N = Math.max(1, rows.count);
    FRAME_H = RULER_H + ROW_H * ROWS_N + VEL_LANE_H;
    selection.clear();
    resize(); // recomputes canvas heights + redraws both layers
  }
```

4. Add the toggle to the toolbar (`:116`), only when `deps.fullKit` is set, and import the factory:

```ts
import { createToolToggle, createHelpButton, createResolutionSelect, createFollowToggle, createFullKitToggle } from '../../core/clip-editor-toolbar';
import { isDrumFullKit } from '../../core/clip-drum-fullkit';
// ...
const toolbarKids: HTMLElement[] = [drawBtn, selBtn, createFollowToggle(), resCtl];
if (deps.fullKit) {
  toolbarKids.push(createFullKitToggle(() => { setModel(deps.fullKit!.build(isDrumFullKit())); deps.fullKit!.onToggle?.(); }));
}
toolbarKids.push(help.btn);
toolbar.append(...toolbarKids);
```

5. Vertical scroll: bound the labels+grid block. Where `row` is created (`:128-130`), add:

```ts
  Object.assign(row.style, { maxHeight: '60vh', overflowY: 'auto' } as Partial<CSSStyleDeclaration>);
```

   (`viewport` keeps its own `overflowX:'auto'`; the labels canvas `flex:0 0 LABEL_W` stays fixed horizontally while both scroll vertically together. In compact view ROWS_N is small ⇒ no scrollbar.)

6. On init, if `deps.fullKit`, set the initial model to the current flag's view so reopening respects the toggle:

```ts
  if (deps.fullKit) activeModel = deps.fullKit.build(isDrumFullKit());
```

   (Place this BEFORE deriving `rows/labels/ROWS_N/FRAME_H`, i.e. fold into their initializers: `let activeModel = deps.fullKit ? deps.fullKit.build(isDrumFullKit()) : model;`)

- [ ] **Step 4: Wire the router** — in `clip-editor-router.ts` where `renderDrumGridEditor` is called (`:235`), pass `fullKit`:

```ts
    const fullKit = lane.engineId === 'sampler'
      ? { build: (full: boolean) => samplerDrumModel(lane, clip, deps.midiLabel, full) ?? { rows: noteDrumRows([]), labels: [] } }
      : undefined;
    bodyHandle = renderDrumGridEditor(bodyBox, clip, deps.historyDeps, deps.seq.meter, {
      auditionNote: audition, getPlayheadTick, fullKit,
      loop: { toolbarHost: loopBar, historyDeps: deps.historyDeps, onChange: () => {} },
    }, model);
```

- [ ] **Step 5: Run tests, verify green**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/`
Expected: PASS. Then `NO_COLOR=1 npx tsc --noEmit` for type safety.

- [ ] **Step 6: Commit**

```bash
git add src/session/clip-editors/clip-editor-drum-grid.ts src/session/clip-editors/clip-editor-router.ts src/session/clip-editors/clip-editor-drum-grid.test.ts
git commit -m "feat(drum-grid): full-kit toggle, reassignable model, vertical scroll, ROW_H 22"
```

---

### Task 7: Detect percussion tracks on import

**Files:**
- Modify: `src/midi/gm-lookup.ts`
- Test: `src/midi/gm-lookup.test.ts`

**Interfaces:**
- Produces: `isPercussionTrack(track: ParsedTrack): boolean` (≥50% of note-ons on channel 9). `GMMatch` gains `drumkitId?: string`. `suggestDefaultMapping` returns `{ engineId:'sampler', presetName:'GM Percussion', drumkitId:'gm-percussion' }` for percussion tracks.

- [ ] **Step 1: Write the failing test** (`gm-lookup.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { isPercussionTrack, suggestDefaultMapping } from './gm-lookup';

const note = (midi: number, channel: number) => ({ startTick: 0, duration: 1, midi, velocity: 80, channel });
const track = (index: number, name: string, notes: any[]) => ({ index, name, program: 0, notes });

describe('isPercussionTrack', () => {
  it('true when the majority of notes are on channel 9', () => {
    expect(isPercussionTrack(track(0, 'Drums', [note(36, 9), note(38, 9), note(60, 9)]))).toBe(true);
  });
  it('false for a melodic track', () => {
    expect(isPercussionTrack(track(1, 'Bass', [note(40, 0), note(43, 0)]))).toBe(false);
  });
});

describe('suggestDefaultMapping percussion default', () => {
  it('assigns the GM Percussion drumkit to a channel-9 track', () => {
    const parsed = { division: 96, bpm: 120, tracks: [track(0, 'Drums', [note(36, 9), note(42, 9)])] } as any;
    const { presetPerTrack } = suggestDefaultMapping(parsed, [0]);
    expect(presetPerTrack[0]).toMatchObject({ engineId: 'sampler', presetName: 'GM Percussion', drumkitId: 'gm-percussion' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NO_COLOR=1 npx vitest run src/midi/gm-lookup.test.ts -t "ercussion"`
Expected: FAIL.

- [ ] **Step 3: Implement** in `gm-lookup.ts`:

1. Add `drumkitId?: string;` to `GMMatch` (`:4`).
2. Add helper + percussion constant:

```ts
import type { ParsedMidi, ParsedTrack } from './midi-parse'; // extend existing import

export const GM_PERCUSSION_MATCH: GMMatch = { engineId: 'sampler', presetName: 'GM Percussion', drumkitId: 'gm-percussion' };

/** True when most of a track's notes are on MIDI channel 10 (0-based 9) — the
 *  GM percussion channel. Such tracks import onto the GM Percussion sample kit. */
export function isPercussionTrack(track: ParsedTrack): boolean {
  const notes = track.notes;
  if (notes.length === 0) return false;
  const drum = notes.filter((n) => n.channel === 9).length;
  return drum / notes.length >= 0.5;
}
```

3. In `suggestDefaultMapping`, check percussion FIRST (overrides the name hint):

```ts
  for (const idx of selectedTrackIndices) {
    const tr = parsed.tracks.find((t) => t.index === idx);
    if (!tr) continue;
    if (isPercussionTrack(tr)) { presetPerTrack[idx] = { ...GM_PERCUSSION_MATCH }; continue; }
    const prog = tr.program < 0 ? 0 : tr.program;
    const hint = engineHintFromName(tr.name);
    presetPerTrack[idx] = hint ? presetForEngine(hint, prog, tr.name) : firstMatchForGM(prog);
  }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `NO_COLOR=1 npx vitest run src/midi/gm-lookup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/midi/gm-lookup.ts src/midi/gm-lookup.test.ts
git commit -m "feat(midi): detect channel-10 tracks → GM Percussion kit default"
```

---

### Task 8: midiToSession wires the drumkit lane

**Files:**
- Modify: `src/midi/midi-to-session.ts:80-88`
- Test: `src/midi/midi-to-session.test.ts`

**Interfaces:**
- Consumes: `GMMatch.drumkitId` (Task 7).
- Produces: a lane whose `match.drumkitId` is set has `engineId: 'sampler'`, `engineState = { sampler: { keymap: [], drumkitId } }`, and **no** `enginePresetName` (so `launchSceneById`'s synchronous `applyPresetToEngine` step skips it; Task 9 loads the kit). No `kitMode` (that is a Drums-engine concept). Notes keep their GM midi.

- [ ] **Step 1: Write the failing test** (`midi-to-session.test.ts`) — note the existing file `vi.mock`s the registry (`:3`); follow its pattern. Add:

```ts
it('a drumkit match yields a sampler lane with engineState.sampler.drumkitId', () => {
  const parsed = { division: 96, bpm: 120, tracks: [
    { index: 0, name: 'Drums', program: 0, notes: [
      { startTick: 0, duration: 12, midi: 54, velocity: 90, channel: 9 },
      { startTick: 24, duration: 12, midi: 69, velocity: 90, channel: 9 },
    ] },
  ] } as any;
  const res = midiToSession(parsed, {
    selectedTrackIndices: [0],
    presetPerTrack: { 0: { engineId: 'sampler', presetName: 'GM Percussion', drumkitId: 'gm-percussion' } },
  });
  const lane = res.newLanes[0];
  expect(lane.engineId).toBe('sampler');
  expect(lane.engineState?.sampler?.drumkitId).toBe('gm-percussion');
  expect(lane.engineState?.sampler?.keymap).toEqual([]);
  expect(lane.enginePresetName).toBeUndefined();
  // notes keep their GM midi (no remap)
  expect(lane.clips.find(Boolean)!.notes.map((n) => n.midi)).toEqual([54, 69]);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-to-session.test.ts -t "drumkit match"`
Expected: FAIL (`engineState`/`drumkitId` undefined; `enginePresetName` is `factory:GM Percussion`).

- [ ] **Step 3: Implement** — in `midi-to-session.ts`, replace the `lane` construction (`:80-88`):

```ts
    const isKit = !!match.drumkitId;
    const lane: SessionLane = {
      id: nextId('lane'),
      engineId: match.engineId,
      name: match.presetName,
      clips,
      // Drumkit lanes load via engineState.sampler.drumkitId (Task 9), not a preset;
      // leaving enginePresetName unset makes launchSceneById's sync preset step skip them.
      ...(isKit
        ? { engineState: { sampler: { keymap: [], drumkitId: match.drumkitId } } }
        : { enginePresetName: `factory:${match.presetName}` }),
    };
```

(Import nothing new — `SessionLane` is already imported.)

- [ ] **Step 4: Run it, verify it passes**

Run: `NO_COLOR=1 npx vitest run src/midi/midi-to-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/midi/midi-to-session.ts src/midi/midi-to-session.test.ts
git commit -m "feat(midi): drumkit import builds a sampler lane with engineState.sampler.drumkitId"
```

---

### Task 9: Load the kit for imported percussion lanes (wiring)

> **Rewritten for the worklet base.** On `main` (pre-rewrite) this added a
> `loadDrumkitById` helper. On the worklet base the right move is to reuse the
> existing async `reloadDrumkit` (it already does fetch → `loadDrumkit` →
> `engine.setKeymap()` [which pushes buffers to the worklet via `loadSample`] →
> mirror keymap + drumkitId). No new helper. `main.ts` is not unit-tested, so this
> task is wiring + manual verification (covered by Task 10's import check).

**Files:**
- Modify: `src/main.ts` (`launchSceneById`, the lane loop around `:964-968`)

**Interfaces:**
- Consumes: `reloadDrumkit(self: SessionHost, laneId: string, kitId: string, engine: { setKeymap(k: KeymapEntry[]): void }): Promise<void>` — `src/session/session-host-presets.ts:19` (existing; already exercised by `session-host-drumpreset.test.ts`).

- [ ] **Step 1: Confirm the seam before editing**

Read `src/session/session-host-presets.ts:19` (the `reloadDrumkit` signature) and `src/main.ts` `launchSceneById` (`:951`) + how it gets a lane's engine instance (`getLaneEngineInstance`). Confirm `getLaneEngineInstance(laneId)` returns the live `SamplerWorkletEngine` (which has `setKeymap`). If the import path is named differently, adapt the call below to the real names.

- [ ] **Step 2: Add the import** near the other session imports in `src/main.ts`:

```ts
import { reloadDrumkit } from './session/session-host-presets';
```

- [ ] **Step 3: Add the drumkit-load branch** to the `launchSceneById` lane loop, right after the existing `applyPresetToEngine` block (which is skipped for these lanes because they have no `enginePresetName`):

```ts
    if (isNew) {
      const kitId = lane.engineState?.sampler?.drumkitId;
      if (kitId) {
        const inst = getLaneEngineInstance(lane.id);
        if (inst && 'setKeymap' in inst) {
          // Fire-and-forget (live path): reloadDrumkit fetches+decodes the kit,
          // calls inst.setKeymap() (→ pushes buffers to the worklet via loadSample),
          // and mirrors keymap+drumkitId into engineState.sampler so the drum grid
          // shows the pads. Audio is silent for the brief decode, then plays.
          void reloadDrumkit(sessionHost, lane.id, kitId, inst as Parameters<typeof reloadDrumkit>[3]);
        }
      }
    }
```

(The `Parameters<typeof reloadDrumkit>[3]` cast avoids importing `KeymapEntry` just for the type; the `'setKeymap' in inst` guard makes it safe at runtime.)

- [ ] **Step 4: Build + typecheck**

Run: `NO_COLOR=1 npx tsc --noEmit`
Expected: no errors. (If `reloadDrumkit` is not exported, export it; verify it does not pull DOM-only deps into a bad import cycle — it already runs in the live host.)

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(midi): load the GM Percussion kit for imported channel-10 lanes (reloadDrumkit)"
```

---

### Task 10: Full verification (tests, build, visual, audible)

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm run test:unit`
Expected: green (re-run once if it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` after all tests pass — known flaky teardown).

- [ ] **Step 2: Build (required before any e2e / live look)**

Run: `npm run build`
Expected: `tsc` clean + bundle written.

- [ ] **Step 3: Visual look — drum grid (MANDATORY)**

Start `npm run dev`. Add a **Sampler** lane, then load **GM Percussion** from the Sampler preset selector (group "Drumkit" — fed by `index.json` via `loadFamilyRef`). Open a clip. Confirm:
- Compact by default: only a few rows (the seed kick/snare/CH/OH/clap or the clip's used sounds), labels show GM names.
- Click **Full kit**: all ~52 rows appear and the block scrolls vertically with the label column fixed at left and ruler/notes aligned.
- Draw a note on a new row in full view, switch back to compact: the new sound's row persists.
Screenshot compact + full.

- [ ] **Step 4: Audible check**

Trigger pads by ear: cabasa (69), tambourine (54), the three congas (62/63/64) sound at different pitches, the two bongos (60/61), maracas/shaker. Confirm distinct, correct-ish sounds (repitched toms ramp in pitch).

- [ ] **Step 5: Import check (the original motivation)**

Import a percussion-rich MIDI from `midi-library/` (e.g. one using tambourine/cabasa — `Fatboy_Slim_Praise_You_d15.mid` or any from the scan). Confirm the drum track auto-selects **GM Percussion** in the import dialog, and after import those notes (tambourine/cabasa/etc.) actually sound — not silently dropped.

- [ ] **Step 6: Commit any verification fixups, then finish**

If the visual/audible pass surfaced pick/label tweaks, fix and commit. Then follow `superpowers:finishing-a-development-branch`. **Integration target is `worktree-audioworklet-foundation`, NOT `main`** — this work depends on the AudioWorklet rewrite, which is not on `main` yet. Rebase onto that branch and `merge --ff-only` into it (or keep stacked until the worklet rewrite itself lands on `main`). Do NOT merge anything to `main` without explicit user permission.

---

## Self-Review

**Spec coverage:**
- C1 generator + VCSL source + CC0 + committed WAVs → Task 3. ✓
- C2 per-pad repitch (`root`) → Task 1. ✓
- C3 GM percussion labels → Task 2 + Task 4. ✓
- C4 compact/full editor + toggle + vertical scroll + ROW_H → Task 4 (model) + Task 5 (flag/factory) + Task 6 (editor). ✓
- C5 import: detect channel 10 → Task 7; build drumkit lane → Task 8; load kit on import → Task 9. ✓
- Scope ~52 pads (35–87 + GM2 extras) → PADS table covers 35–87 (52 entries; 27–34 omitted as the corpus only used 31, which can be added later — note: spec listed 31 sticks; the corpus hits 31 in 2 files. If desired, add `{note:31,...}` to PADS, but it is low value). **Gap flagged:** spec mentions note 31 (Sticks) in GM2 extras; PADS starts at 35. Acceptable per YAGNI (2 files, 172 hits via slapstick/woodblock substitute) — add only if the audible check wants it.
- Verification (tests + build + visual + audible + import) → Task 10. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `samplerDrumModel(lane, clip, midiLabel, fullKit)` arity is consistent in Task 4 (definition), Task 6 (router call). `DrumEditorDeps.fullKit.build` matches between Task 6 editor + router. `GMMatch.drumkitId` defined Task 7, consumed Task 8. Task 9 reuses the existing `reloadDrumkit` (no new symbol). `root?` on `DrumkitSample` defined Task 1, produced by the generator Task 3, consumed by `buildDrumkitKeymap` Task 1.

**AudioWorklet rebase coverage (re-verified 2026-06-24):** all plan-touched files survive the rewrite. Tasks 1/2/4/5/6 unchanged (keymap/repitch main-thread; editor + router intact). Task 3 drops the `drum-kits.json` write (index.json only). Task 7/8 fix the lane to `engineId:'sampler'` (mandatory for the ~52-row grid) with `engineState.sampler.drumkitId`, no `kitMode`/`enginePresetName`. Task 9 rewritten to reuse `reloadDrumkit` (the kit reaches the worklet via `setKeymap`→`loadSample`). Manual load already works via the Sampler selector (`listDrumkits`→`loadFamilyRef`), so `index.json` registration suffices.

**Note (sequencing):** Task 4's call-site edit references `isDrumFullKit` (created in Task 5). Execute Task 5 before Task 4's Step 3.3, or temporarily inline `false`. Task 6 supersedes that call site with the `fullKit.build` wiring.
