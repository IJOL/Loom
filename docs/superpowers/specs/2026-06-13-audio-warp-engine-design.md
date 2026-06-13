# Phase 2b-1 — Warp-marker engine (auto-sync audio to the grid)

Status: design approved (awaiting spec review). Date: 2026-06-13.

## Problem

After Phase 1 the session BPM is conformed to the imported audio's detected (float)
tempo and the downbeat is anchored, but recorded tracks don't hold a perfectly constant
tempo, so native playback **drifts off the grid within a few bars** (the user hears it
go off a 4/4 kick by bar 3–4). A single global tempo — even fractional — can't follow
tempo variation. The fix is Ableton-style **warping**: detect the beats throughout the
audio and time-stretch it **piecewise** so every beat lands on the grid.

This spec is **2b-1**: the warp **engine** (data model + auto beat-seed + piecewise
stretch + playback + import wiring). The draggable marker **UI** is **2b-2**.

## Decisions (user-approved)

- **Auto-warp ON by default** for imported stems (sync out of the box; the clip's Warp
  toggle still turns it off for native audio).
- **Beat-level** marker granularity (one marker per beat, latched to the nearest onset)
  — every beat locks, even when the tempo varies within a bar.
- Markers are **auto-seeded** now; manual drag/add/remove is 2b-2.

## Design

### 1. Data model — `WarpMarker`

Add to `ClipSample` (`src/session/session.ts`): `warpMarkers?: WarpMarker[]`, where

```ts
export interface WarpMarker {
  srcSec: number;  // position in the SOURCE buffer (seconds)
  beat: number;    // musical beat it is pinned to (0-based; beat 0 = the clip downbeat)
}
```

Markers are sorted by `beat`. The session tempo maps `beat → time = beat * 60 / bpm`, so
the model is **tempo-independent**: a BPM change only recomputes beat→time, not the
markers. Between consecutive markers playback is **linearly time-stretched**. Additive,
optional field → no schema bump (absent ⇒ today's uniform behavior).

### 2. Auto-seed — `seedWarpMarkers` (pure)

New pure module `src/samples/warp-seed.ts`:

```ts
seedWarpMarkers(onsets: number[], downbeatSec: number, bpm: number, durationSec: number, meter: TimeSignature): WarpMarker[]
```

Build the regular beat grid from the detected `bpm` + `downbeatSec` (expected beat k at
`downbeatSec + k*60/bpm`). For each expected beat, **snap to the nearest onset** within a
tolerance (≈ ±0.5 beat); if an onset is close, the marker takes the onset's `srcSec`
(latches to the real beat) else the regular-grid time. Markers run from the downbeat to
the last beat inside `durationSec`. Onsets come from `detectLoop().slicePointsSec`. Pure
→ unit-tested with synthetic onsets.

**Seeded once from the drums stem** (clearest beats) and applied to all four stem clips —
the stems are time-aligned, so a shared marker set keeps them locked to each other *and*
to the grid.

### 3. Piecewise stretch — extend `timestretch.ts`

New `src/samples/warp-stretch.ts` building on the existing OLA `stretchBuffer`: given the
source buffer + `warpMarkers` + target `bpm` + `meter`, stretch each segment
`[marker[i].srcSec, marker[i+1].srcSec]` by its own ratio to fit
`[beatToSec(marker[i].beat), beatToSec(marker[i+1].beat)]`, and concatenate the segments
with a short equal-power **crossfade** at the seams (anti-click). Pitch is preserved
(OLA, no resample). The pre-/post-marker tails (before beat 0, after the last marker) play
at the unit ratio.

### 4. Cache + tempo resync

Cache the warped buffer in `stretchCache` keyed by `sampleId` + a hash of `(markers,
bpm)` so it renders once and replays instantly. Extend `collectStretchJobs`
(`src/app/stretch-resync.ts`) + the `bpm-broadcast` resync so a tempo change re-renders
marker-based clips (debounced, as today).

### 5. Import + playback

- **Import:** stems are created `warp: true` with `warpMarkers` seeded from the
  tempo/drums stem (replaces Phase 1's native `warp:false`). `buildStemAudioLane` /
  `audioChannelClip` accept the seeded markers; `importStems` already runs `detectLoop`
  on the drums stem, so it passes the onsets to `seedWarpMarkers`.
- **Playback:** `playAudioClip` (`src/engines/audio-clip-voice.ts`) — when the clip has
  `warpMarkers` and `warp` is on, play the **warp-stretched** buffer (from the cache) at
  `playbackRate 1`; with no markers, fall back to today's uniform stretch (back-compat).
  The clip's Warp toggle off ⇒ native playback.

## Components / seams

- `src/session/session.ts` — `WarpMarker` type + `ClipSample.warpMarkers`.
- `src/samples/warp-seed.ts` (new) — `seedWarpMarkers` (pure).
- `src/samples/warp-stretch.ts` (new) — piecewise OLA stretch (reuses `timestretch.ts`).
- `src/samples/stretch-cache.ts` + `src/app/stretch-resync.ts` + `src/app/bpm-broadcast.ts`
  — cache key + resync for marker-based clips.
- `src/engines/audio-clip-voice.ts` — `playAudioClip` uses the warped buffer when markers present.
- `src/stems/stem-import.ts` + `src/session/stem-lane-builder.ts` (+ `audioChannelClip`)
  — seed markers + `warp:true` on import.

## Reuse vs new

- Reuse: `detectLoop` onsets; the OLA `stretchBuffer`; `stretchCache`; the bpm-broadcast
  resync path; the audio engine playback path.
- New: `WarpMarker` model, `seedWarpMarkers` (pure), `warp-stretch` (piecewise + crossfade),
  the cache key + resync extension, the import seeding.

## Testing / acceptance

- **Unit (pure):** `seedWarpMarkers` — synthetic onsets with a known drift → markers latch
  to the onsets (beat k's `srcSec` ≈ the drifted onset, not the regular-grid time); a clean
  steady grid → markers on the regular grid. Relative assertions.
- **DSP (OfflineAudioContext):** a synthetic buffer whose beats DRIFT off a constant grid →
  after `warp-stretch` to the session grid, the output's onset times fall on the grid beats
  (within a small relative tolerance) — i.e. the drift is gone. Reuse the dsp-battery
  harness; write a WAV for audible inspection.
- **Live (acceptance):** import the variable-tempo track (auto-warp ON) → the audio stays
  locked to a 4/4 kick well past bar 3–4 (the drift the user reported is gone). Toggling
  Warp off returns native (drifting) playback.

## Out of scope (Phase 2b-2)

Draggable warp-marker UI on the waveform editor: render markers, drag to move a marker's
`srcSec`, add/remove markers, re-warp on edit. The engine here already stores markers in the
model and re-renders on demand, so 2b-2 is UI + an edit→re-warp hook.

## Risks / notes

- **OLA smearing at seams** on percussive transients; mitigated by short equal-power
  crossfades and beat-aligned segment boundaries (seams fall on beats, where a transient
  onset typically sits — the crossfade straddles the hit). Acceptable for a remix tool;
  2b-2 lets the user nudge a bad marker.
- **Render cost:** a 4-min stem × 4, segmented per beat, is a non-trivial offline render;
  done once, cached, async (debounced like today's resync). If it proves heavy, a coarser
  internal segmentation (merge adjacent same-ratio segments) is a safe optimization.
- The auto-seed assumes the first detected onset is the downbeat (same assumption as Phase
  1's anchor); 2b-2's draggable downbeat marker is the correction path.
