# Phase 2b-2 — Editable sparse warp-marker editor

Status: **design approved (mockup approved) — awaiting spec review**. Date: 2026-06-13.
Branch: `feat/audio-warp` (worktree). Builds on the dormant **2b-1 warp engine** (see
[2026-06-13-audio-warp-engine-design.md](2026-06-13-audio-warp-engine-design.md)).

**Approved mockup (committed artifact):**
[2026-06-13-audio-warp-marker-editor-mockup.html](2026-06-13-audio-warp-marker-editor-mockup.html)
· [PNG](2026-06-13-audio-warp-marker-editor-mockup.png)

---

## Problem & goal

An imported track's tempo wanders, so even with the conformed float BPM (Phase 1) a
4/4 kick drifts off the audio within a few bars. The 2b-1 engine can warp audio to the
grid **piecewise between markers**, but its auto-seed put **one marker per beat**, which on
a real song produced degenerate markers → wild per-segment stretch ratios → the audio
"speeds up and freezes" ("va fatal"). That auto-warp was reverted to native (`fda6534`);
the engine is dormant but correct.

**Goal:** make the warp markers **few, visible and editable**. Detect a sparse set of
beats on the **drums** stem, show them as draggable markers on the clip's waveform, let
the user move/add/delete them, and warp between them. **Acceptance (the user's test): a
4/4 kick (or notes) stays in sync with the imported track across the whole clip despite
tempo drift.** Marker count is a means, not an end — sparse is fine ("si eso lo consigo
con 20 marcas, cojonudo"). The default seed density is **one marker every 4 bars**,
regulable in the editor.

This is purely the **editor + sparse seeding + propagation**. The warp *mechanism*
(`warpStretch`/`warpCache`/resync) is reused unchanged.

## What already exists (reused verbatim)

- `WarpMarker { srcSec, beat }` and `ClipSample.warpMarkers? / warp?`
  ([session.ts:23](../../../src/session/session.ts#L23)).
- `warpStretch(ctx, buffer, markers, gateSec)` — piecewise OLA, places each marker at
  `targetSec(beat) = (beat / lastBeat) * gateSec`; output is `gateSec` long, grid-aligned,
  plays at rate 1 ([warp-stretch.ts](../../../src/samples/warp-stretch.ts)). Plus `warpKey`.
- `warpCache` (string-keyed buffer cache) ([warp-cache.ts](../../../src/samples/warp-cache.ts)).
- `playAudioClip` uses the warped buffer when `warp && markers.length >= 2`, else native
  ([audio-clip-voice.ts:39](../../../src/engines/audio-clip-voice.ts#L39)).
- `collectWarpJobs(state, bpm, meter)` + the `bpm-broadcast` resync render/cache warped
  buffers; `gate = lengthBars * quartersPerBar(meter) * 60/bpm`
  ([warp-resync.ts](../../../src/app/warp-resync.ts)).
- `renderAudioClipEditor(host, clip, meter, deps)` — the audio-clip editor: a toolbar
  (Warp toggle + Gain knob) above the waveform header canvas
  ([clip-waveform-header.ts:115](../../../src/session/clip-editors/clip-waveform-header.ts#L115)).
- `detectLoop(buffer, meter)` → `{ originalBpm, slicePointsSec, confidence }` — onset/slice
  times used as the beat candidates.

## Correctness invariant (the load-bearing fact)

`warpStretch` maps beats **proportionally**: `target(beat) = beat/lastBeat * gateSec`.
For a marked beat `b` to land on its TRUE grid time `b * 60/bpm`, we need
`gateSec == lastBeat * 60/bpm`, i.e. **the last marker's `beat` must equal the clip's
total beats** (`lengthBars * beatsPerBar`). Then `target(b) = b * 60/bpm` exactly for
every marker. So:

- The seed and every edit MUST keep an **endpoint marker at `beat = lengthBars*beatsPerBar`**
  (the clip end) and one at **`beat = 0`** (the downbeat). Intermediate markers may move
  freely; their `beat` value is their grid position and does not change when dragged
  (dragging changes only `srcSec` — which point of the source audio sits on that beat).
- This is why dragging a marker re-warps only the **two adjacent segments**: each segment's
  ratio = `(target(b_{i+1}) - target(b_i)) / (srcSec_{i+1} - srcSec_i)`.

A unit test pins this invariant (`lastBeat == totalBeats ⇒ each marker lands on grid`).

## Design

### 1 · Reference track + import grouping (data model)

All stems of one import share the **same source timeline**, so the **same** `srcSec→beat`
marker set warps every stem identically. Markers are edited on ONE clip — the **drums**
stem (clearest beats; the user's "solo en la de drums") — and propagated to the rest.

Add two optional fields to `ClipSample` (additive, no schema bump — saved with the clip,
absent ⇒ today's behavior):

```ts
warpGroupId?: string;   // stems of one import share this id; edits propagate within it
warpRef?: boolean;      // this clip is the editable reference (the drums stem); only it shows the marker editor
```

At import: mint one `warpGroupId` for the batch; set `warpRef: true` on the **drums** stem
(fallback: the tempo stem `pickTempoBuffer` chose); all stems get the same `warpGroupId`.

### 2 · Sparse, drift-following seed — `seedSparseWarpMarkers` (pure, new)

`src/samples/warp-seed-sparse.ts`:

```ts
seedSparseWarpMarkers(
  onsets: number[], downbeatSec: number, bpm: number,
  durationSec: number, meter: TimeSignature, barsPerMarker: number,
): WarpMarker[]
```

Two stages:

1. **Track every beat (adaptive).** Walk from `downbeatSec` with period `60/bpm`. For each
   beat predict `prev + period`, snap to the nearest onset within `±0.5*period`; if snapped,
   nudge the running `period` toward the observed spacing (e.g. 50% blend) so the tracker
   **follows tempo drift**; record the actual beat time. Continue while `≤ durationSec`.
2. **Thin to sparse.** Keep markers only at beats `0, N*bpb, 2N*bpb, …` (`N = barsPerMarker`,
   `bpb = beatsPerBar`), each `{ srcSec: trackedTime[beat], beat }`. **Force an endpoint** at
   `beat = floor(totalTrackedBeats / bpb) * bpb` (the last whole-bar boundary) so the invariant
   holds. Guarantee `≥2` markers and strictly increasing `srcSec`.

Pure → unit-tested with synthetic drifting onsets (markers latch to the drift; endpoints
pinned; count ≈ bars/N). Replaces the per-beat `seedWarpMarkers` as the production seeder;
the old one is removed (nothing else calls it).

### 3 · Marker editor on the waveform — `warp-marker-editor.ts` (new)

A marker interaction layer mounted by `renderAudioClipEditor` **only when
`clip.sample.warpRef`**. It draws on / over the existing waveform-header canvas and adds:

- **Markers**: amber vertical line + top triangle handle + bar-number label, at
  `x = srcSec/duration * width` (source-time view, matching the mockup).
- **Grid**: faint per-bar lines at the even target positions (already drawn by the ruler;
  extend full height faintly) + alternate segment shading between markers.
- **Drift hint**: a short dashed connector from a marker to its target grid line with a
  `±Nms` label (kept per the approved mockup; cheap, source-time vs grid-time delta).
- **Toolbar additions** (next to the Warp toggle + Gain): a **density select**
  (`cada 1 / 2 / 4 / 8 compases`, default **4**) and a **↻ Re-detectar** button.
- **Warp toggle** is restyled to the mockup's **amber `ON` / dim `OFF` pill** (replacing the
  current `♺ Warp ON/OFF` text button), per the resolved CONFIRMAR below.

Interactions (pointer on the layer):

- **Drag** a handle → updates that marker's `srcSec` (clamped between neighbors); endpoints
  (beat 0, last) drag their `srcSec` too but keep their `beat`. Live re-warp is **debounced**.
- **Click** empty waveform → add a marker at that `srcSec`, snapped to the nearest onset if
  one is within tolerance; its `beat` = nearest grid beat. Re-sort.
- **Right-click** a marker → delete (endpoints are not deletable).
- **Density select** / **Re-detectar** → run `detectLoop` on the sample buffer
  (`sampleCache.get(sampleId)`) for onsets, then `seedSparseWarpMarkers(...)`, replacing the
  marker set.

The layer takes deps from the host: `{ meter, bpm, getBuffer, onMarkersChange(markers, warp) }`.
All rendering math reuses the header's existing canvas sizing.

### 4 · Propagation + live re-warp — `warp-marker-edit.ts` (pure ops) + host wiring

Pure ops module `src/session/warp-marker-edit.ts`:

```ts
moveMarker(markers, index, srcSec): WarpMarker[]      // clamp between neighbors, keep sorted
addMarker(markers, srcSec, beat): WarpMarker[]         // insert sorted, dedupe
deleteMarker(markers, index): WarpMarker[]             // refuse to drop endpoints
propagateWarp(state, groupId, markers, warp): string[] // write markers+warp to every clip whose sample.warpGroupId===groupId; return affected sampleIds
```

Host wiring (session-host / a small `warp-edit-wiring` in `src/app`): `onMarkersChange` →
apply the pure op to the reference clip's sample → `propagateWarp(...)` to the group →
**invalidate `warpCache`** for each affected sampleId (clear keys for that sampleId) →
trigger the existing **resync** (`collectWarpJobs` + render/cache, debounced) → redraw the
header. Wrapped with the existing **undo** seam (`withUndo`) so marker edits are undoable.
Tempo changes already re-render via `bpm-broadcast`; nothing new needed there.

### 5 · Import default

Stems import **warp ON with sparse markers** (one every 4 bars) seeded from the drums/tempo
stem — sync out of the box, the difference from the reverted attempt being *sparse +
editable* (gentle ratios, no wobble; the user nudges a bad marker instead of suffering it).
The clip's **Warp toggle** still returns native playback, and **Re-detectar** re-seeds.
`buildStemAudioLane` / `audioChannelClip` already accept `warpMarkers`; import now passes the
sparse set + `warpGroupId` + `warpRef`.

## Components / seams

| File | Change |
|---|---|
| `src/session/session.ts` | `ClipSample.warpGroupId?`, `warpRef?` (additive). |
| `src/samples/warp-seed-sparse.ts` | **new** — `seedSparseWarpMarkers` (pure). Removes old `warp-seed.ts` per-beat seeder. |
| `src/session/warp-marker-edit.ts` | **new** — pure `moveMarker`/`addMarker`/`deleteMarker`/`propagateWarp`. |
| `src/session/clip-editors/warp-marker-editor.ts` | **new** — interactive marker layer + density/re-detect toolbar. |
| `src/session/clip-editors/clip-waveform-header.ts` | `renderAudioClipEditor` mounts the marker editor when `sample.warpRef`; passes deps. |
| `src/stems/stem-import.ts` + `src/session/stem-lane-builder.ts` | import seeds sparse markers, sets `warp:true` + `warpGroupId` + `warpRef`. |
| `src/app/` (new `warp-edit-wiring.ts` or session-host hook) | edit→propagate→invalidate cache→resync→redraw, under undo. |

## Reuse vs new

- **Reuse:** `warpStretch` / `warpKey` / `warpCache`, `collectWarpJobs` + `bpm-broadcast`
  resync, `playAudioClip` warp path, `detectLoop` onsets, the waveform-header canvas, the
  Warp toggle + Gain knob, `withUndo`.
- **New:** sparse drift-following seed, the marker editor layer + density/re-detect, the
  pure edit/propagate ops, two `ClipSample` fields, the edit→re-render wiring.

## Out of scope / ⛔ CONFIRMAR (deviations from the approved look)

The approved mockup is the target. Resolved look decisions:

1. **Warp toggle style** — ✅ RESOLVED (user, 2026-06-13): restyle to the mockup's **amber
   `ON` / dim `OFF` pill**, replacing the current `♺ Warp ON/OFF` text button. Match the
   mockup colors (amber fill + black text when ON; bordered dim when OFF).
2. **Active-marker tooltip** ("Compás 5 · arrastra para ajustar") shows only **while
   dragging**, not statically (assumed fine).

Genuinely out of scope (later): automatic tempo-following beyond the markers; multi-track
beat fusion; quantizing transcribed notes to the markers; per-segment manual ratio.

## Testing / acceptance

- **Unit (pure):**
  - `seedSparseWarpMarkers` — synthetic drifting onsets → ~`bars/N` markers, each latched to
    the drifted onset (not the regular grid), endpoints at beat 0 and the last bar boundary,
    strictly increasing `srcSec`. Relative assertions.
  - `warp-marker-edit` — `moveMarker` clamps between neighbors; `addMarker` inserts sorted;
    `deleteMarker` refuses endpoints; `propagateWarp` writes to every group member and returns
    their sampleIds.
  - **Invariant test:** with `lastBeat == lengthBars*beatsPerBar`, `warpStretch`'s
    `target(beat)` equals `beat*60/bpm` for each marker (grid-exact).
- **DSP (OfflineAudioContext):** a synthetic buffer whose beats drift off a constant grid,
  seed sparse markers, warp to the session grid → output onsets fall on the grid beats within
  a small **relative** tolerance (drift gone). Reuse the dsp-battery harness; write a WAV.
- **Live (mandatory visual + audible):** import the variable-tempo track → markers appear on
  the **drums** clip only, ~1 every 4 bars; with Warp ON a 4/4 kick lane stays locked across
  the whole clip; drag a marker → the two adjacent segments re-warp and the kick re-locks;
  Re-detectar re-seeds; Warp OFF returns native drift. **A human looks at the screen and
  compares against the mockup** before "done".

## Risks / notes

- **OLA seam smearing** on transients — sparse segments are long, so ratios stay near 1 and
  smearing is minimal; beat-aligned seams + the existing equal-power crossfade mask joins.
- **Re-detect cost** — `detectLoop` on a multi-minute stem is non-trivial; run it off the
  click (already async) and debounce; markers/render cache once.
- **Endpoint discipline** — the whole correctness rests on the last marker's beat ==
  total clip beats; the edit ops must never drop/break the endpoints (covered by tests).
- **Drift connector clutter** — kept per the approved mockup; if it reads noisy on the real
  waveform we make it toggle off (cheap), but ship it on by default.
