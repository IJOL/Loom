# MIDI Import + GM-Tagged Engine Presets — Design

**Date:** 2026-05-29
**Branch context:** feat/modulator-scope-polyphony
**Status:** Draft awaiting user review

## Goal

Rewrite the MIDI file importer to produce Session lanes/clips/scene (not the legacy `extraPolyTracks` model), and back it with a curated cross-engine preset library where every preset carries a loose mapping to General-MIDI program numbers. When a MIDI track is imported, the GM program of that track determines both the engine and the preset of the new lane.

The legacy importer ([src/midi/midi-import.ts](../../../src/midi/midi-import.ts)) does work but writes into a model that is orthogonal to Session (lanes, clips, scenes), so imported MIDIs can't be saved, can't have clips re-launched, and can't participate in scene workflows. After this work an imported MIDI behaves like any other Session content.

## Non-goals

- Per-tempo-event tracking (multi-tempo songs use the *first* tempo event; later changes are ignored).
- Control-change → automation lane mapping.
- Pitch bend extraction.
- MIDI export (write-side).
- General preset-management UI improvements beyond what the import surfaces require.

## Scope summary

1. New type `EnginePreset<P>` with `name`, `gm: number[]`, `params: P`.
2. Each engine exposes `presets: EnginePreset[]` (≥20 per tonal engine, ≥8 for `drums`). Total ~116 new presets plus GM tags retrofitted onto existing poly presets.
3. Cross-engine lookup `findGMMatches(program)` + random tiebreak `pickPresetForGM(program, rng)`.
4. MIDI importer rewritten on top of Session: lanes (one per tonal track), one clip per lane, a containing scene with `clipPerLane` + `presetPerLane`. Drum tracks (ch10) merge into a single clip on the existing `drums` lane.
5. Modal: "Add to current session" / "Replace session" / Cancel.
6. Tempo: first MIDI meta-tempo → `transport.setBpm`.
7. Cleanup: delete `extraPolyTracks` legacy path; unify the two duplicate GM drum maps; generalize `applyPresetByName` to a lane-aware version.

## Architecture

### Data shape

New in [src/engines/engine-types.ts](../../../src/engines/engine-types.ts):

```ts
export interface EnginePreset<P = unknown> {
  /** Unique within its engine. Convention: 'FAMILY Descriptor', e.g. 'BASS Sub 808'. */
  name: string;
  /** Loose mapping to GM program numbers (0-127). Can be empty for non-GM-targeted presets,
   *  but presets intended for MIDI import should always carry at least one tag. */
  gm: number[];
  /** Engine-specific param block. */
  params: P;
}

export interface SynthEngine {
  // ... existing fields
  presets?: EnginePreset[];
}
```

### Engine preset assets (JSON)

Presets ship as JSON assets under `public/presets/`, mirroring the pattern set by `public/demos/minimal-techno.json` (loaded via `fetch` at boot, parsed and validated). Rationale: editing/auditioning a preset does not require a TS rebuild; user presets in localStorage already share the POJO shape; future "preset packs" can be served by URL or drag-drop.

| Asset | Engine | Min presets | Primary GM coverage |
|---|---|---|---|
| `public/presets/poly.json` (migrated) | `poly` | existing ~30 | 0-7 keys, 16-23 organs, 48-54 strings, 56-63 brass, 80-95 leads/pads |
| `public/presets/tb303.json` (new) | `tb303` | 20 | 32-39 basses, 80-87 leads |
| `public/presets/fm.json` (new) | `fm` | 20 | 4-7 EP/clav, 8-15 bells/chrom-perc, 88-95 pads, 96-103 FX |
| `public/presets/wavetable.json` (new) | `wavetable` | 20 | 80-95 leads/pads, 96-103 FX, 51-54 synth strings |
| `public/presets/karplus.json` (new) | `karplus` | 20 | 24-31 guitars, 32-33 ac/finger bass, 45-47 pizz/harp, 105-108 banjo/sitar |
| `public/presets/subtractive.json` (new) | `subtractive` | 20 | 16-23 organs, 32-39 basses, 56-63 brass, 80-95 |
| `public/presets/drums.json` (new) | `drums` | 8 | GM Drum Kits 0/8/16/24/25/33/41/49 |

#### JSON shape

```json
{
  "engineId": "tb303",
  "presets": [
    { "name": "Acid 1", "gm": [32, 33, 38], "params": { "...": "..." } },
    { "name": "Acid 2", "gm": [32, 39], "params": { "...": "..." } }
  ]
}
```

The top-level `engineId` is informational/self-describing; the runtime trusts the file path (`/presets/<engineId>.json`).

#### Loading

New module `src/presets/preset-loader.ts`:

```ts
export async function loadEnginePresets(engineId: string): Promise<EnginePreset[]>;
export async function loadAllPresets(): Promise<void>; // Promise.all over all engines
export function isPresetsReady(): boolean;            // sync gate for UI
```

On boot, [src/main.ts](../../../src/main.ts) calls `await loadAllPresets()` before wiring the MIDI import UI. Each engine's `presets` field is populated by the loader (writes into the engine instance after fetch). The MIDI import "Load" button is disabled until `isPresetsReady()` returns true.

#### Validation

Hand-rolled type guard in `preset-loader.ts`:

- `name`: non-empty string, unique within file.
- `gm`: array of integers in `[0, 128)`.
- `params`: presence checked, contents trusted (each engine's preset-apply will fail loudly if a key is missing).

Invalid presets are dropped with a `console.warn` (do not crash boot).

#### TS types stay

`EnginePreset<P>` remains as a TS interface (data lives in JSON, the type describes the in-memory shape after parse). Engine-specific param types (`PolySynthParams`, `TB303Params`, etc.) stay in TS and the loader returns `EnginePreset<EngineParamsFor<engineId>>`.

**Coverage rule.** Every GM program 0-127 must resolve to at least one preset (no `poly/Init` fallback for common programs). Holes are closed either by a dedicated preset or by adding the program to the nearest existing preset's `gm` array. A test enforces this.

**Distribution rule.** A program can be tagged in presets of multiple engines on purpose — the random tiebreak gives diversity between imports. Example: GM 33 tagged in `BASS Plucky` (poly) + `Acid 1` (tb303) + `Wobble Bass` (subtractive).

### Lookup module

New `src/midi/gm-lookup.ts`:

```ts
export interface GMMatch { engineId: string; presetName: string; }

export function findGMMatches(program: number): GMMatch[];
export function pickPresetForGM(program: number, rng: () => number): GMMatch;
export function pickDrumKitForGM(program: number, rng: () => number): GMMatch;
```

- `findGMMatches` iterates `listEngines()` and returns every `(engineId, presetName)` whose preset has `program` in its `gm` array.
- `pickPresetForGM` picks one uniformly via `rng()`. Empty match list → `{ engineId: 'poly', presetName: 'Init' }` fallback (never reachable in practice once the coverage test passes; kept as defense-in-depth).
- `pickDrumKitForGM` is the same shape but restricted to `engineId === 'drums'`.

`rng` is injected so tests are deterministic. Production code calls `pickPresetForGM(p, Math.random)`.

### Generalised preset application

`applyPresetByName(poly, name)` (today in [src/polysynth/polysynth-presets.ts](../../../src/polysynth/polysynth-presets.ts)) is replaced by `applyPresetToLane(laneId, presetName)` in a new `src/presets/preset-apply.ts`. It:

1. Reads the lane's `engineId` from session state.
2. Looks up the engine instance via `createEngineInstance` / per-lane registry.
3. Finds the preset by `name` in `engine.presets`.
4. Writes `params` into the engine instance and mirrors into `SessionLane.engineState.params`.
5. Sets `SessionLane.enginePresetName = 'factory:' + name`.

All current call sites of `applyPresetByName` (main.ts, session-tab-bar.ts, midi-import.ts, session-engine-state.ts) migrate to `applyPresetToLane`.

### MIDI importer

Three modules, separated by responsibility:

**`src/midi/midi-parse.ts`** — pure SMF parser. Extracted from current [src/midi/midi-import.ts](../../../src/midi/midi-import.ts). Adds extraction of the first `0xFF 0x51 0x03` meta-tempo event (microseconds-per-quarter → BPM). Output:

```ts
interface ParsedMidi {
  division: number;
  bpm: number | null;        // null if no tempo meta found
  tracks: ParsedTrack[];     // same shape as today
}
```

**`src/midi/midi-to-session.ts`** — pure transformation, fully testable without DOM or audio:

```ts
interface MidiImportResult {
  newLanes: SessionLane[];          // one per tonal track
  scene: SessionScene;              // clipPerLane + presetPerLane wired
  bpm: number | null;
  drumClip: SessionClip | null;     // null if MIDI has no ch10 notes
  drumKitMatch: GMMatch | null;     // from program change on ch10, or null
  unmatchedTracks: { name: string; program: number }[];  // for logging
}

export function midiToSession(
  parsed: ParsedMidi,
  opts: {
    selectedTrackIndices: number[];
    rng: () => number;
  }
): MidiImportResult;
```

Internal logic:
- Compute `globalMinStart` across all selected tracks; subtract so tick 0 = song start.
- Convert MIDI ticks to Session ticks via `TICKS_PER_QUARTER / parsed.division` (Session's `TICKS_PER_QUARTER` constant from [src/core/notes.ts](../../../src/core/notes.ts)).
- Compute `lengthBars = ceil(songEndSessionTicks / TICKS_PER_BAR)`.
- For each tonal track: pick `(engineId, presetName)` via `pickPresetForGM(track.program, rng)`. Build `SessionLane` with that engineId; build one `SessionClip` of `lengthBars` containing all the track's notes as `NoteEvent[]`.
- Drum track(s): merge all ch10 notes from all selected tracks into one `SessionClip` of `lengthBars`. If any selected track has a program-change on ch10, call `pickDrumKitForGM` for it.
- Build `SessionScene { clipPerLane, presetPerLane, name: 'MIDI: <filename>' }`. `presetPerLane` keyed by lane id, values `'factory:<presetName>'`.

**`src/midi/midi-import-ui.ts`** — DOM glue:
1. Wire file input: read file → `parseMidiFile` → render track checklist (current UX preserved).
2. "Load" button → run `midiToSession` with selected indices and `Math.random` as rng.
3. Show **Add / Replace / Cancel** modal.
4. On Add:
   - Append `newLanes` to `session.lanes`.
   - Append `scene` to `session.scenes`.
   - If `drumClip`: find existing drums lane → append `drumClip` to its `clips` array (do not overwrite existing drum clips); set `scene.clipPerLane[drumLaneId] = newClipIndex`. If no drums lane exists, skip drum content (warn in console).
   - If `drumKitMatch`: apply that kit preset to the drums lane.
5. On Replace:
   - Preserve the existing drums lane reference, then set `session.lanes = [drumsLane, ...newLanes]` and `session.scenes = [scene]`. Existing drum clips on the preserved lane are kept; the new `drumClip` is appended as in Add.
6. Apply BPM: `if (bpm) transport.setBpm(bpm)`.
7. Apply preset on each new lane via `applyPresetToLane`.
8. Auto-launch the new scene.

### Cleanup of legacy code

- Remove `PatternData.extraPolyTracks` and `MAX_EXTRA_POLY_TRACKS` from [src/core/pattern.ts](../../../src/core/pattern.ts).
- Remove all read/write sites: [src/main.ts](../../../src/main.ts), [src/core/randomize-ui.ts](../../../src/core/randomize-ui.ts), [src/copy/lane-copy.ts](../../../src/copy/lane-copy.ts), [src/save/save-manager.ts](../../../src/save/save-manager.ts), [src/demo/demo-minimal-techno.ts](../../../src/demo/demo-minimal-techno.ts).
- Update [src/session/session-migration.ts](../../../src/session/session-migration.ts) to ignore the field on load (no migration mapping needed; extra-poly tracks were parallel to Session, not part of it).
- Delete the duplicate `DRUM_NOTE_TO_VOICE` table inside the old midi-import.ts; consumers use `GM_DRUM_MAP` from [src/engines/drum-gm-map.ts](../../../src/engines/drum-gm-map.ts).
- Delete `applyPresetByName(poly, name)`; all call sites use `applyPresetToLane(laneId, name)`.

## Data flow

```
file picker
    ↓
midi-parse.ts:parseMidiFile  ───── ParsedMidi (division, bpm, tracks[])
    ↓
UI track-checklist render
    ↓
[user clicks Load]
    ↓
midi-to-session.ts:midiToSession(parsed, {selectedTrackIndices, rng})
    │   for each tonal track:
    │       gm-lookup.ts:pickPresetForGM(track.program, rng) ───→ (engineId, presetName)
    │       build SessionLane + SessionClip
    │   for ch10 notes:
    │       merge into one SessionClip on drums lane
    │       gm-lookup.ts:pickDrumKitForGM(program, rng)
    │   build SessionScene{clipPerLane, presetPerLane}
    ↓
MidiImportResult
    ↓
[user picks Add / Replace / Cancel]
    ↓
midi-import-ui.ts mutates SessionState
    │   transport.setBpm(bpm)
    │   for each new lane: applyPresetToLane(laneId, presetName)
    │   launch scene
    ↓
sound
```

## Error handling

- **Invalid SMF:** parser throws; UI shows `alert('Not a valid SMF: ' + message)`. Same as today.
- **No tonal + no drum tracks selected:** UI disables "Load" until ≥1 box is checked.
- **No drums lane exists at import time and MIDI has ch10 notes:** drum clip is dropped; `console.warn('MIDI drums dropped — no drums lane in session')`. Document this; it's expected if the user removed the drums lane intentionally.
- **GM program → no preset match (should be impossible if coverage test passes):** fallback to `poly/Init`. Lane is created and the user can fix manually.
- **Multiple tempo events:** first one wins, rest ignored. Documented limitation.

## Testing

All tests live next to their module per existing convention.

### Unit / pure

- `src/midi/midi-parse.test.ts` — extends current `midi-import.test.ts` velocity tests with: tempo extraction (with and without 0xFF 0x51 event), program-change on ch10, division ≠ 96.
- `src/midi/midi-to-session.test.ts` — builds synthetic `ParsedMidi` fixtures (no SMF bytes), asserts: one lane per selected tonal track, correct `engineId`+`presetName` chosen via mocked rng, drum-track merging, `lengthBars` calculation, scene wiring (`clipPerLane`, `presetPerLane`), bpm passthrough, unmatched-tracks list.
- `src/midi/gm-lookup.test.ts`:
  - `findGMMatches(g)` is non-empty for every `g ∈ [0,128)` — **the GM coverage gate**.
  - With a 2-match scenario and a mocked rng returning `0.0` / `0.5` / `0.99`, the picked preset is the expected one.
  - `pickDrumKitForGM` only returns matches with `engineId === 'drums'`.
- `src/presets/preset-loader.test.ts` — validator drops malformed entries with warn (negative gm, missing name, duplicate name); valid file returns expected `EnginePreset[]`. Mocks `fetch` per existing demo-loader pattern.

### Sanity

- `src/presets/preset-sanity.test.ts` — loads each engine's JSON via `fs.readFileSync('public/presets/<engineId>.json')` (node side, no fetch), and for every preset asserts:
  - `name` is unique within file.
  - `gm` is `number[]` with all entries integers in `[0,128)`.
  - `params` round-trips through `applyPresetToLane` without throwing.

### DSP / wiring / e2e

- No new DSP-render tests required. Existing `*.dsp.test.ts` continue to pass because preset shapes are wrappers, not param changes.
- E2E is **optional**: a Playwright that imports a fixture SMF and asserts the resulting `SessionState` has expected lane count and a scene. Not bound to spec acceptance.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| 100+ curated presets is a lot of content work | Plan decomposes per engine (independent tasks). Each preset is auditioned in the dev server before commit — instruction lives in the plan. Loose GM tags can close coverage holes without dedicated presets. |
| User saves session with `extraPolyTracks` between branches | Migration silently drops the field; no save-file breakage. |
| JSON preset has typo or missing `gm` | `preset-loader` validator drops malformed entries with `console.warn`; sanity test fails CI before merge. |
| Boot order: importer fires before presets loaded | `loadAllPresets()` is awaited in `main.ts` before wiring import UI; the Load button is also gated by `isPresetsReady()`. |
| LocalStorage user presets predate `gm` | Loader injects `gm: []` on read. They never appear in importer lookup (intentional — user presets are not GM content). |
| Drums lane absent at import time | Documented warning behaviour. User can re-add a drums lane and re-import. |

## File inventory

### New files

#### JSON assets

- `public/presets/poly.json` (migrated from current `FACTORY_POLY_PRESETS` array, with `gm` tags added)
- `public/presets/tb303.json`
- `public/presets/fm.json`
- `public/presets/wavetable.json`
- `public/presets/karplus.json`
- `public/presets/subtractive.json`
- `public/presets/drums.json`

#### TS modules

- `src/midi/midi-parse.ts`
- `src/midi/midi-parse.test.ts`
- `src/midi/midi-to-session.ts`
- `src/midi/midi-to-session.test.ts`
- `src/midi/gm-lookup.ts`
- `src/midi/gm-lookup.test.ts`
- `src/midi/midi-import-ui.ts`
- `src/presets/preset-apply.ts`
- `src/presets/preset-loader.ts`
- `src/presets/preset-loader.test.ts`
- `src/presets/preset-sanity.test.ts`

### Modified

- `src/engines/engine-types.ts` — add `EnginePreset<P>` interface and `SynthEngine.presets?: EnginePreset[]`
- `src/polysynth/polysynth-presets.ts` — strip `applyPresetByName`, keep user-preset persistence
- `src/engines/<each-engine>.ts` (tb303/fm/wavetable/karplus/subtractive/drums + polysynth host) — accept loader-populated `presets` array
- `src/main.ts` — await `loadAllPresets()` at boot; call `applyPresetToLane`; drop `extraPolyTracks` references
- `src/session/session-migration.ts` — ignore `extraPolyTracks`
- `src/core/pattern.ts` — remove `extraPolyTracks`, `MAX_EXTRA_POLY_TRACKS`
- `src/core/randomize-ui.ts`, `src/copy/lane-copy.ts`, `src/save/save-manager.ts`, `src/demo/demo-minimal-techno.ts` — drop legacy refs

### Deleted

- `src/polysynth/poly-presets.ts` (data moves to `public/presets/poly.json`; the file is removed)
- `src/midi/midi-import.ts` (split into three new modules)
- `src/midi/midi-import.test.ts` (replaced by midi-parse.test.ts + midi-to-session.test.ts)
