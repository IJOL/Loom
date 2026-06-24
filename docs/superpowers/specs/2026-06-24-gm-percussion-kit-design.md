# GM Percussion kit (VCSL) + scalable drum grid + MIDI auto-assign

- **Date:** 2026-06-24
- **Status:** Design approved (verbal) — pending written-spec review
- **Branch:** `worktree-gm-percussion-kit`

## Problem

Imported MIDI drum tracks (channel 10) routinely use percussion sounds Loom does
not have. A scan of `midi-library/` (69 files, 28 with channel-10 drums) found
**53 distinct percussion notes, of which 37 are not covered** by the current
8-voice `GM_DRUM_MAP`. The most-used uncovered sounds:

| note | GM name        | files | hits |
|------|----------------|-------|------|
| 54   | Tambourine     | 11    | 4102 |
| 69   | Cabasa         | 5     | 1911 |
| 70   | Maracas        | 4     | 1718 |
| 82   | Shaker         | 2     | 768  |
| 87   | Open Surdo     | 2     | 578  |
| 49/57| Crash 1 / 2    | 13/13 | —    |
| 60-64| Bongos/Congas  | 2-3   | —    |
| 37   | Side Stick     | 5     | 307  |

Today these notes fall outside `GM_DRUM_MAP` and are **silently dropped** on
import (the synth `drums` engine only has kick/snare/hats/clap/cowbell/tom/ride).

Two gaps:
1. **No GM-complete kit exists.** The tidal generator only harvests 8 Loom voices.
2. **The drum grid is not usable past ~8 rows.** The data model already supports
   N rows (`noteDrumRows`), but the canvas grows in height with no vertical
   scroll — 50 rows ≈ 1366px, unusable.

## Goals

- A single committed sample drumkit (**"GM Percussion"**) covering the full GM
  percussion map (notes 35–87, ~52 pads) with authentic acoustic / tropical
  sounds: congas (multiple tones), bongos, cabasa, tambourine, agogo, guiro,
  claves, woodblock, maracas/shaker, timbales, surdo, etc.
- A drum grid that stays **compact while editing**: it shows only the sounds the
  clip actually uses, with a **"show full kit" toggle** that reveals all ~52 kit
  rows (vertically scrollable, fixed-left labels, GM percussion names) for adding
  or inspecting sounds. The full set of pitches exists for *playback*; editing
  does not force you to scan 50 rows.
- **MIDI import auto-assigns** this kit to channel-10 tracks, so those notes
  actually sound on import.

## Non-goals (deferred)

- Round-robin / multi-velocity samples per pad (v1 = one sample per pad).
- Sticky ruler / sticky velocity-lane while vertically scrolling (v1 scrolls the
  whole block; sticky is a later refinement).
- Explicit "+ add sound" picker dropdown in the toolbar (v1 adds sounds via the
  "show full kit" toggle + draw; an explicit picker is a later refinement).
- Expanding the synth `drums` engine's voice union — the GM kit is sample-based,
  played through the existing sampler path. The synth drums stay 8 voices.

## Approved decisions

- **Source:** VCSL (Versilian Community Sample Library, `github:sgossner/VCSL`,
  **CC0 / public domain** — cleaner than tidal's no-explicit-license). Download
  verified (HTTP 200). WAVs are committed (consistent with the 523 existing
  drumkit files; ~52 files ≈ 3–5 MB).
- **Scope:** full GM percussion range 35–81 **plus** the GM2 extras that appear
  in the corpus (31 sticks, 37 side stick, 82 shaker, 85 castanets, 86/87 surdo)
  ≈ 52 pads.
- **Import:** auto-assign the kit to percussion tracks (detected by channel 9 =
  MIDI channel 10), reusing the existing drumkit-preset → `loadDrumkit` path.
- **(a)** Preset group name: **"General MIDI"**.
- **(b)** One sample per pad in v1.
- **(c)** Accept the v1 editor limitation (ruler + velocity-lane scroll with the
  block); sticky is a future refinement.
- **(d)** Editor shows a **compact view** (only the clip's used sounds) by
  default, with a **"show full kit" toggle** revealing all ~52 rows. The 50
  pitches are for *playback*; editing stays compact.

## Components

### C1 — Generator `tools/build-gm-percussion-kit.mjs` (new, pure data)

Mirrors `tools/build-drumkits-from-tidal.mjs` in spirit. Re-runnable; never
touches hand-made kits.

- Holds the curated **GM note → VCSL** table (see Data below).
- Reads the VCSL catalog. The catalog is vendored next to the script as
  `tools/vcsl.json` (copied from `strudel/website/public/vcsl.json`) so the
  build is offline-stable and licence-traceable.
- Picks one file per pad by **sub-name match** within the VCSL key's array
  (e.g. the `bongo` key holds both `BongoH*` and `BongoL*`; note 60 picks a
  `BongoH` file, 61 a `BongoL`). Prefer `_Mid`/`rr1`/`v2` representative hits;
  avoid rolls/shakes/mutes unless the pad *is* the muted/roll variant.
- Downloads to `public/drumkits/gm-percussion/<note>.wav`
  (`BASE = https://raw.githubusercontent.com/sgossner/VCSL/master/`,
  path segments URL-encoded).
- Writes `public/drumkits/gm-percussion.json` (manifest), updates
  `public/drumkits/index.json`, and adds one preset to
  `public/presets/drum-kits.json`:
  `{ name: "GM Percussion", group: "General MIDI", kind: "sample", drumkitId: "gm-percussion" }`.
- Prints a coverage report (which notes got a real sample vs a substitute).

### C2 — Manifest: optional per-pad repitch

Extend `DrumkitSample` (`src/samples/drumkit-loader.ts`) with an optional
`root?: number`. When present, the keymap entry uses `rootNote: root` while
`loNote === hiNote === note`, so the sampler repitches by `(note - root)`
semitones. When absent, behaviour is unchanged (`root === note`, native pitch).

```ts
export interface DrumkitSample {
  voice: string;          // display/debug only
  note: number;           // GM note this pad triggers on AND its grid row
  file: string;
  gain?: number;
  root?: number;          // NEW: sample's nominal pitch; repitch = note - root
}
```

`buildDrumkitKeymap` maps `rootNote: s.root ?? s.note`. This lets tom/woodblock/
timbale families span several GM notes from one or two samples with a coherent
pitch ramp. Families with enough real samples (congas, bongos, agogos) use
native pitch (no `root`).

### C3 — GM percussion names for grid rows

Add `GM_PERCUSSION_NAMES: Record<number, string>` to
`src/engines/drum-gm-map.ts` — short English labels for notes 27–87 (e.g.
35 "Kick", 54 "Tamb", 69 "Cabasa", 60 "Hi Bongo"). `samplerDrumModel`
(`src/session/clip-editors/clip-editor-router.ts`) labels each pad as:
`GM_PERCUSSION_NAMES[n] ?? (GM_DRUM_MAP[n] ? LANE_LABELS[...] : midiLabel(n))`.
Result: the grid shows real percussion names instead of note names.

### C4 — Compact drum grid + "show full kit" toggle

The grid must not force the user to scan ~52 rows while editing. Default to a
**compact view** (only the sounds the clip uses); a toggle reveals the full kit.

The row model becomes a function of a per-clip `showFullKit` flag built in
`samplerDrumModel` (`src/session/clip-editors/clip-editor-router.ts`):

- **Compact (default):** rows = the kit pads whose note appears in `clip.notes`,
  in keymap order. If the clip uses none yet (fresh clip), seed a small default
  set from the kit (kick/snare/closed-hat/open-hat/clap when present) so there is
  something to draw on.
- **Full (toggle on):** rows = every kit pad (all ~52), in keymap order.

A pad's pitches always *play* (the sampler keymap maps all notes); the toggle
only governs which rows are *drawn/edited*.

In `src/session/clip-editors/clip-editor-drum-grid.ts`:

- Add a **"show full kit" toggle** to the toolbar (next to the tool/resolution
  controls), visible only for sampler-drumkit lanes. Its state persists per
  session (like the follow/tool toggles); flipping it rebuilds the row model and
  redraws. The editor exposes a `deps.fullKit?: { get(): boolean; set(v): void }`
  seam so the router owns the flag and recomputes the model.
- **Vertical scroll for the full view:** wrap the `row` (labels canvas +
  horizontal viewport) so the block has `max-height: min(FRAME_H, ~60vh)` and
  `overflow-y: auto`. Labels canvas and grid canvas share `FRAME_H` in a flex
  row, so a vertical scroll on the wrapper scrolls **both together**; the labels
  canvas (flex `0 0 LABEL_W`) stays fixed horizontally. The inner viewport keeps
  its own `overflow-x: auto`. In compact view there are few rows, so no scroll
  appears.
- Reduce `ROW_H` 26 → 22 so more rows fit before scrolling.
- Pointer→row math is canvas-relative (`offsetY`), so it stays correct under
  scroll — no change to hit-testing.
- v1 limitation (accepted): in the full view the ruler and velocity-lane are part
  of the canvas and scroll with it (sticky = future refinement).

**Adding a sound while editing:** with the toggle ON the user draws on any kit
row; that note now exists in `clip.notes`, so it remains visible when they switch
back to compact. (A future refinement could add an explicit "+ add sound" picker;
v1 relies on the toggle + draw.)

### C5 — MIDI import auto-assign

- **Detect percussion track:** in `src/midi/midi-import-ui.ts`, a track is
  percussion when the majority of its notes are on channel 9 (`ParsedTrack`
  notes already carry `channel`). Add a small pure helper
  (`isPercussionTrack(track)`) with a unit test.
- **Default preset:** percussion tracks default `presetPerTrack[i]` to
  `{ engineId: 'sampler', presetName: 'GM Percussion' }` instead of the melodic
  default. The dropdown still lets the user override.
- **Keep notes:** `midiToSession` already copies `midi` verbatim — percussion
  notes keep their GM numbers (no remap), so the sampler kit plays them by note.
- The sampler lane loads the kit through the existing drumkit-preset path
  (`session-host-presets` / `loadDrumkit`). Confirm async kit-load fits the
  import apply flow during planning.

## Data — GM note → VCSL mapping (curated)

Selection criterion in parentheses; `→repitch` marks pads that use C2's `root`.
Substitutes (no exact VCSL instrument) flagged ⚑.

| note | GM name           | VCSL key (file criterion)            | notes |
|------|-------------------|--------------------------------------|-------|
| 35   | Acoustic Bass Drum| `bassdrum2`                          | |
| 36   | Bass Drum 1       | `bassdrum1`                          | |
| 37   | Side Stick        | `snare_rim`                          | |
| 38   | Acoustic Snare    | `snare_modern` (hit)                 | |
| 39   | Hand Clap         | `clap`                               | |
| 40   | Electric Snare    | `snare_hi`                           | |
| 41   | Low Floor Tom     | `tom2_mallet` →repitch (root 43)     | |
| 43   | High Floor Tom    | `tom2_mallet` (native)               | |
| 45   | Low Tom           | `tom2_mallet` →repitch up            | |
| 47   | Low-Mid Tom       | `tom_mallet` (native, root 47)       | |
| 48   | Hi-Mid Tom        | `tom_mallet` →repitch up             | |
| 50   | High Tom          | `tom_mallet` →repitch up             | |
| 42   | Closed Hi-Hat     | `hihat` (closed file)                | |
| 44   | Pedal Hi-Hat      | `hihat` (closed/pedal file)          | |
| 46   | Open Hi-Hat       | `hihat` (open file)                  | |
| 49   | Crash Cymbal 1    | `clash`                              | |
| 51   | Ride Cymbal 1     | `sus_cymbal`                         | ⚑ no dedicated ride |
| 52   | Chinese Cymbal    | `gong2`                              | ⚑ |
| 53   | Ride Bell         | `fingercymbal`                       | ⚑ |
| 55   | Splash Cymbal     | `clash2` (short)                     | ⚑ |
| 57   | Crash Cymbal 2    | `clash2`                             | |
| 59   | Ride Cymbal 2     | `sus_cymbal2`                        | ⚑ |
| 54   | Tambourine        | `tambourine` (hit)                   | |
| 56   | Cowbell           | `cowbell` (normal hit)               | |
| 58   | Vibraslap         | `vibraslap`                          | |
| 60   | Hi Bongo          | `bongo` (BongoH hit)                 | |
| 61   | Low Bongo         | `bongo` (BongoL hit)                 | |
| 62   | Mute Hi Conga     | `conga` (Quinto/Conga muted)         | |
| 63   | Open Hi Conga     | `conga` (Quinto/Conga open)          | |
| 64   | Low Conga         | `conga` (Tumba)                      | |
| 65   | High Timbale      | `tom2_rim` →repitch up               | ⚑ |
| 66   | Low Timbale       | `tom2_rim`                           | ⚑ |
| 67   | High Agogo        | `agogo` (High)                       | |
| 68   | Low Agogo         | `agogo` (Low)                        | |
| 69   | Cabasa            | `cabasa` (hit)                       | |
| 70   | Maracas           | `shaker_small`                       | ⚑ |
| 71   | Short Whistle     | `ballwhistle` (short)                | ⚑ |
| 72   | Long Whistle      | `ballwhistle` (long)                 | ⚑ |
| 73   | Short Guiro       | `guiro` (hit/fast)                   | |
| 74   | Long Guiro        | `guiro` (slow)                       | |
| 75   | Claves            | `clave`                              | |
| 76   | Hi Wood Block     | `woodblock` →repitch up              | |
| 77   | Low Wood Block    | `woodblock` (native)                 | |
| 78   | Mute Cuica        | `darbuka` (muted/dum)                | ⚑ |
| 79   | Open Cuica        | `darbuka` (open/tek)                 | ⚑ |
| 80   | Mute Triangle     | `triangles` (muted)                  | |
| 81   | Open Triangle     | `triangles` (open/ring)              | |
| 82   | Shaker            | `shaker_large`                       | |
| 83   | Jingle Bell       | `sleighbells`                        | |
| 84   | Belltree          | `marktrees`                          | |
| 85   | Castanets         | `slapstick`                          | ⚑ |
| 86   | Mute Surdo        | `framedrum` (muted) or `cajon`       | ⚑ |
| 87   | Open Surdo        | `framedrum` (open) or `cajon`        | ⚑ |

(31 Sticks → `woodblock`/`slapstick` optional; finalised in the generator.)
Exact file indices are resolved by the generator's sub-name matcher and printed
in its coverage report; the planning step locks the final per-pad choices.

## Testing

- **Generator/mapping (pure):** every pad in the table resolves to a VCSL key
  that exists in `tools/vcsl.json`; manifest is well-formed (unique notes,
  files present). No network in the test (assert against the table + catalog).
- **`buildDrumkitKeymap` (C2):** `root` produces `rootNote=root`, `loNote=hiNote=note`;
  omitted `root` keeps prior behaviour.
- **`samplerDrumModel` (C3):** a >8-pad kit yields N rows; labels come from
  `GM_PERCUSSION_NAMES` (e.g. note 54 → "Tamb", 69 → "Cabasa").
- **`samplerDrumModel` compact/full (C4):** compact mode returns only rows whose
  note is used in the clip (plus the seed set for an empty clip), in keymap
  order; full mode returns all pads. Switching the flag changes `rows.count`.
- **Grid (C4):** with the full (50-row) model the wrapper has bounded height +
  `overflow-y:auto`; the compact model produces few rows and no scroll;
  hit-testing still maps `offsetY`→row correctly in both.
- **Import (C5):** `isPercussionTrack` true for a channel-9-majority track;
  `midiToSession` gives such a track `engineId:'sampler'` + "GM Percussion" and
  preserves note midis.
- **DSP (optional):** render the kit through the sampler battery (smoke).

## Verification (honest "done")

- Unit/wiring tests green (`npm run test:fast`).
- `npm run build` before any e2e.
- **Visual look (mandatory for C4):** open a clip on a GM Percussion lane;
  confirm the grid is **compact** (only the used sounds) by default; flip
  "show full kit" and confirm all ~52 rows appear, scroll vertically, with fixed
  labels and GM names; draw on a new row and confirm it persists in compact view.
  Screenshot both states. Tests do not prove the grid is usable.
- **Audible check:** trigger several pads (cabasa, tambourine, congas of
  different tones, bongos) and confirm distinct, correct sounds; import one
  corpus MIDI with rich percussion and confirm those notes now sound.

## Risks

- VCSL file naming is irregular per instrument; the sub-name matcher needs
  per-key care (verified case-by-case in the generator + coverage report).
- Repitch ramps (toms/timbales) may sound artificial at the extremes — keep
  ranges modest; prefer real samples where available.
- ~52 committed WAVs grow the repo by a few MB (accepted; CC0).
- Async kit-load on import must not race the scene build — validate in planning.
