# Loop tempo-sync + slicer — design

- **Date:** 2026-06-04
- **Status:** Approved (brainstorming). Next: implementation plan (writing-plans).
- **Branch:** `feat/loop-tempo-sync-slicer`

## Goal

Make the Sampler treat **loops** as first-class, tempo-locked, editable material. Drop a loop and it
auto-locks to the project tempo **without changing pitch**, fits the bar grid, plays cleanly in a scene,
and is edited through one focused interface. Two playback realizations of "warp" share a single data model.

This is one cohesive feature (the user chose "all as one feature").

## Decisions (from brainstorming)

| Topic | Decision |
|-------|----------|
| Warp engine | **Hybrid.** Slice-and-retrigger (REX-style) is the default spine; an opt-in per-clip **continuous stretch** (offline WSOLA) covers sustained/tonal loops and large tempo changes. |
| Tempo source | **Automatic beat detection** as the headline, **refined by whole-bar snapping** (loops are integer bars → exact BPM), with ×2/÷2 disambiguation and a **manual BPM/bars override** as the safety net. |
| One-shot mode | **Auto-slice + manual racks (both).** A dropped loop is chopped into slices laid on the grid; manual multi-sample racks/drumkits also supported. The note editor shows **one row per available slice/sample**. |
| Tempo follow | **Live-follow + per-clip warp on/off.** Loops re-time to the project BPM live; each clip can opt out via the existing `ClipSample.warp` flag. |
| Import formats | **Acidized WAV** (`acid` + slice chunk), **WAV `cue `/`smpl`**, **AIFF/Apple Loops** metadata; **detection fallback** for plain WAV/MP3. **No REX/REX2** (proprietary audio codec — not even parsed; `.rx2` just falls through the normal decode-failure path). |
| Per-slice params | **Reuse the existing per-pad rack** (Plan A1) keyed by slice note. No new per-slice data model. |
| Editor layout | **Unified panel (layout A):** toolbar + waveform-with-slice-markers + slice step-grid in one view. |

## Core architecture: the unifying model

A tempo-locked loop is realized as **ordinary notes triggering slices of one buffer**. This collapses all
four asks (auto-slice, adaptive one-shot editor, tempo-lock, simpler UI) onto infrastructure that already
exists (keymap-free note clips, the lane scheduler, the drum-grid editor, scenes, undo).

A dropped loop produces:
- **one buffer** — the loop audio, stored as today via `importFile` → IndexedDB → `sampleCache`;
- a **slice map** — `{ start, end, note }[]` carving the buffer into hits, each assigned a contiguous MIDI row;
- a detected/embedded **tempo** + **bar length**.

From that we generate a normal `NoteEvent[]` (one note per slice on the grid). The existing scheduler plays
those notes; each note triggers its slice **region at natural pitch**. Because notes already follow the
project BPM, the loop is tempo-locked and pitch-perfect with **no time-stretch in the hot path**.

Two realizations of "warp", chosen per clip via `warpMode`:

| Mode | How it plays | Best for |
|------|--------------|----------|
| `slice` (default) | Notes → slice regions (REX-style retrigger). Editable, zero spectral artifacts; tempo-follow is free. | Drums / rhythmic / percussive |
| `stretch` (opt-in) | One **WSOLA-stretched buffer** rendered offline to fit the bars at the current BPM, cached, played flat at rate 1.0. | Sustained / tonal loops, big tempo changes |

The continuous time-stretch is the only genuinely new DSP; it runs **offline and cached**, never in the
audio callback.

## Data model & schema

Additive and optional on the existing `schemaVersion: 3`. A sliced loop is "a normal note clip + a slice
map," so old sessions and other engines are untouched. **The discriminator between the two playback paths is
the presence of `slices`, not `warpMode` alone** — migration therefore leaves existing `loop`/`song` buffer
clips untouched (no `slices` ⇒ they keep the buffer path) and never blanket-sets `warpMode`.

`ClipSample` evolves ([src/session/session.ts:19](../../../src/session/session.ts)) — `warp` finally gets
meaning, plus two new optional fields:

```ts
interface ClipSample {
  sampleId: string;
  mode: 'loop' | 'song';
  originalBpm?: number;              // existing — now authoritative (detected/embedded/edited)
  warp?: boolean;                   // existing — per-clip sync ON/OFF
  warpMode?: 'slice' | 'stretch';   // NEW — default 'slice'
  slices?: LoopSlice[];             // NEW — present in slice mode; the carve map
  trimStart: number;
  trimEnd: number;
  gain?: number;
}

interface LoopSlice {
  start: number;   // seconds into the buffer
  end: number;     // seconds
  note: number;    // MIDI row this slice maps to (editor row + the note that fires it)
}
```

- **Slices live on the clip** (`clip.sample.slices`), not the lane keymap. Two clips on one sampler lane can
  hold different loops without colliding, and the lane keymap stays clean.
- New trigger option in `VoiceTriggerOptions` (engine-types): `slice?: { sampleId: string; start: number; end: number }`.
- **Slice notes use a contiguous range** (e.g. from C1, like the drum rack) so per-pad params key cleanly by
  note. **Caveat:** pad params are lane-scoped, so two different loops on the *same* lane share params on
  overlapping notes. The norm is one loop per lane — accepted, not engineered around.
- **Scheduler branch** (the one behavior flip): `warpMode === 'slice'` ⇒ treat as a **note clip** (sequence
  `clip.notes`, each carrying a slice region); `warpMode === 'stretch'` (or legacy `loop`/`song` without
  slices) ⇒ the existing **buffer-per-iteration path**, with stretch mode swapping in the cached WSOLA buffer
  at rate 1.0.
- **Stretch cache:** keyed by `(sampleId, ratio)` in a small in-memory map next to `sampleCache`; not
  persisted (re-derived on load). `originalBpm` + `lengthBars` + project BPM determine the ratio.

## Import & analysis pipeline

Two new pure/testable modules feed one pure builder.

- **`src/samples/loop-metadata.ts`** — RIFF/AIFF chunk reader over the raw `ArrayBuffer` (already available
  from `importFile`). Extracts when present: `acid` (tempo/beats), `cue ` (cue points = slice offsets),
  `smpl` (loop points + root note), AIFF `MARK`/`INST`/Apple-Loop tempo. Returns
  `{ originalBpm?, beats?, slicePointsSec?, rootNote?, loopStartSec?, loopEndSec? } | null`.
- **`src/samples/loop-analysis.ts`** — detection fallback (pure DSP on the decoded `Float32Array`):
  - **Onset envelope** (spectral-flux / rectified-energy difference) → onset times = candidate slice points.
  - **Tempo:** autocorrelation of the onset envelope → rough BPM (musical range 70–180), then **snap to a
    whole-bar interpretation** of the buffer length for an exact BPM, with ×2/÷2 octave-error
    disambiguation.
  - Returns `{ originalBpm, slicePointsSec, confidence }`.
- **`src/core/slice-clip.ts`** — pure glue: given `slicePointsSec + originalBpm + projectBpm + meter +
  gridResolution`, produce `{ slices: LoopSlice[], notes: NoteEvent[], lengthBars }`, quantizing onsets to
  the grid and laying one note per slice.

**Flow on drop:** `importFile` (store + decode, existing) → `loop-metadata.parse(bytes)` → if `null`,
`loop-analysis.detect(buffer)` → `slice-clip.build(...)` → create the `SessionClip` (slice map + generated
notes) and route to the loop editor. Unsupported files (incl. `.rx2`) hit the existing import
decode-failure path — no special-casing.

## Playback & tempo-follow

**Slice playback (default).** Scheduler sees `warpMode === 'slice'`, sequences `clip.notes`. For each note,
`trigger-dispatch` resolves the slice region from `clip.sample.slices` (by `note.midi`) and triggers the
sampler voice with `opts.slice` + the note's gate. The voice plays that region applying `getPad(note.midi)`
exactly like the one-shot keymap path at [src/engines/sampler.ts:90](../../../src/engines/sampler.ts) —
same envelope/filter/pan/sends, so **per-slice params come for free**. A slice rings its natural length and
is cut when the next slice fires (authentic REX behavior).

- **Tempo change → automatic, zero re-render.** Notes are grid-relative; changing BPM re-times everything
  with perfect pitch. This is the payoff of the slice spine.
- Slow-down gaps / speed-up overlaps are the honest slice trade-off; `stretch` mode is the escape hatch.

**Stretch playback (opt-in).** `warpMode === 'stretch'` keeps the single-buffer-per-iteration path but swaps
in a **WSOLA-stretched buffer** sized to `lengthBars` at the current BPM, played at rate 1.0 (pitch
preserved) instead of today's `region/gate` varispeed at
[src/engines/sampler.ts:163](../../../src/engines/sampler.ts).

- **`src/samples/timestretch.ts`** — custom WSOLA, run **offline**, result cached by `(sampleId, ratio)`.
  Stereo processed per channel; channel count preserved.
- **Tempo change → debounced re-render.** Hook the existing **bpm-broadcast** ([src/app/](../../../src/app)):
  on BPM change, for each `stretch` clip with `warp` on, recompute ratio and render+cache (debounced). The
  previous cached buffer keeps playing until the new one is ready — no dropout.

**Warp OFF** (`warp === false`): the loop free-runs — slice mode plays notes at the loop's own implied
timing without re-quantizing; stretch mode plays the raw buffer at natural rate.

**No trigger-time BPM threading.** Slice mode rides note timing; stretch mode is pre-rendered. The only new
hot-path option is `opts.slice`.

## UI (unified loop editor — layout A)

**New clip editor `src/session/clip-editors/clip-editor-loop.ts`**, selected by the router
([src/session/clip-editors/clip-editor-router.ts:36](../../../src/session/clip-editors/clip-editor-router.ts))
when `clip.sample?.warpMode === 'slice'`. One scrolling panel:

1. **Toolbar** — sample name; detected **BPM** (click to edit → manual override); **bars** selector
   (1/2/4/8…); **Warp ON/OFF**; **mode** `slice / stretch`; **sensitivity** slider + **↻ re-detect**; slice
   count.
2. **Waveform canvas** — buffer with draggable **slice markers** (drag to move a boundary, double-click to
   add/remove), moving playhead via the existing `{redraw}` handle pattern (as the drum-grid canvas uses).
3. **Slice grid** — the **existing drum-grid editor**, rows driven by the slice map (one row per slice). All
   its machinery (variable resolution, free placement, marquee select, clipboard, group move) works
   unchanged because slices are just notes.

**Manual rack reuse.** A non-drumkit sampler with a small set of one-shot keymap zones routes to the **same
rack grid**, rows driven by loaded zones — "note editor adapts to available notes" is one code path for both
slices and manual one-shots. Drumkits keep their current drum-grid route.

**Per-slice knobs.** The existing per-pad rack (`renderDrumVoiceRack` / `getRackLayout`,
[src/engines/sampler.ts:25](../../../src/engines/sampler.ts)) surfaces under/beside the grid, keyed by slice
note (Plan A1 reused).

**Import affordance.** Dropping an audio file on a Sampler lane detects-or-parses and lands directly in this
loop editor — you never touch the keymap/zone/pad-allocation machinery for a loop. That is the "simplify"
payoff. The inspector keeps the global sampler controls (gain, voices) and manual keymap tools; loop-specific
settings live in the loop editor.

## Testing (four-layer convention)

1. **Pure unit** (`*.test.ts`):
   - `loop-metadata` — hand-crafted RIFF/AIFF byte fixtures (`acid`/`cue `/`smpl`/AIFF) → parsed
     `{bpm, slicePoints, rootNote}`; malformed/absent → `null`.
   - `slice-clip` — slices + tempos + grid → expected `NoteEvent[]`, `lengthBars`, note↔slice mapping
     (relative assertions: counts, ordering, ratios).
   - `session-migration` — clip with new fields absent → defaults (`warpMode:'slice'`, `warp` preserved);
     round-trips.
2. **DSP real** (`*.dsp.test.ts`, `OfflineAudioContext` + dsp-battery):
   - `loop-analysis` — synthetic click-trains at a known BPM → detected within a ratio band; onset count
     matches; ×2/÷2 resolved.
   - `timestretch` — stretch ratio r → output duration ≈ r× (relative); pitch preserved (autocorrelation
     pitch ratio ≈ 1); energy roughly conserved. WAVs to `test/output/` for audible inspection.
   - sampler **slice trigger** — region playback produces audio in the expected window with pad params
     applied.
3. **Scheduling** (fake clock) — a `slice` clip emits N triggers/bar at expected times; BPM change re-times
   with no re-render; `stretch` clip fires one buffer/iteration.
4. **Wiring** — bpm-broadcast → debounced stretch re-render fires once per settled change; cache hit on
   repeated ratio.

All assertions **relative** (ratios/ordering), per the project convention.

## Error handling / edge cases

- Detection low-confidence / ambiguous → fall back to "whole loop = 1 bar," surface the manual BPM/bars
  override prominently, offer ×2/÷2.
- No transients / very short loop → single slice (whole buffer); still tempo-locks as one hit or via stretch.
- Odd slice counts (6, 12…) → triplet/free grid resolution chosen from slice spacing.
- Stereo buffers → WSOLA per channel; preserve channel count.
- Unsupported file (incl. `.rx2`) → existing import decode-failure path; no special-casing.
- Stretch re-render in flight → keep playing the previous cached buffer; never drop audio.
- Load: slice maps reference the buffer by `sampleId` (already in IndexedDB); stretch cache re-derived lazily.

## Out of scope / future

- REX/REX2 import (proprietary audio codec).
- Chromatic repitching of an individual slice across the keyboard (slices map 1:1 to rows; use per-slice
  `tune` for pitch).
- Clip-scoped per-pad params (multiple distinct loops on one lane sharing pad params is accepted).
- Persisting the stretch buffer cache (re-derived lazily on load).

## Changed/new files (summary)

**New:** `src/samples/loop-metadata.ts`, `src/samples/loop-analysis.ts`, `src/samples/timestretch.ts`,
`src/core/slice-clip.ts`, `src/session/clip-editors/clip-editor-loop.ts` (+ their tests).

**Changed:** `src/session/session.ts` (`ClipSample`, `LoopSlice`), `src/engines/engine-types.ts`
(`VoiceTriggerOptions.slice`), `src/engines/sampler.ts` (slice trigger path; stretch buffer swap),
the lane scheduler / `trigger-dispatch` (slice-region resolution + `warpMode` branch),
`src/session/clip-editors/clip-editor-router.ts` (route slice loops), the import / file-drop flow,
`src/app` bpm-broadcast (debounced stretch re-render), `src/session/session-migration.ts` (defaults),
`src/save/saved-state-v3.ts` (persist new optional fields).
