# Phase 1 — Stems import as audio lanes (sync + optional transcription)

Status: design approved (awaiting spec review). Author: user + Claude. Date: 2026-06-12.

## Problem / motivation

When you separate a song into stems, Loom imports each stem as a **Sampler lane**
playing a `mode: 'song'` audio clip. Three problems follow, all observed by the user:

1. **Wrong editor.** Opening a stem clip shows the Sampler's normal editor — a
   waveform header **plus a piano-roll note grid with computer-keyboard input** below
   it. For an audio stem there are no notes to edit; the note editor/keyboard is
   useless (and the keyboard "doesn't work" for this content).
2. **Desync from bar 1.** A `song`-mode sampler clip plays at **native speed, not
   anchored to the grid**. The sequencer (and e.g. a 4/4 kick you add) runs on the
   bar grid at the detected BPM; the stem audio does not line up with it from the
   start.
3. **Mid-song "bar jumps."** The clip is gated/looped to a computed `lengthBars`; when
   that doesn't match the buffer (rounding, or stems of slightly different lengths)
   the audio jumps/restarts mid-song.

Separately, every stems import **forces** an audio→notes transcription (local
`/transcribe`, librosa pYIN pitch + onset detection; drums→drum-machine). Its quality
on real stems is poor, and it always creates extra "Notas:" lanes the user didn't ask
for.

## Decisions (user-approved)

- **Transcription is optional, default OFF**, via a checkbox in the Stems dialog.
- **Sync strategy: native + downbeat anchor + per-lane Warp toggle.** No full-song
  time-stretch by default (fidelity, no WSOLA artefacts on drums, no heavy 4-min×4
  render). The existing per-lane Warp toggle stays available for when the user changes
  the project tempo. Full per-marker (Ableton) warping is **Phase 2**.

## Design

### 1. Import → `audio` engine lanes (not `sampler`)

Where stem lanes are built (`buildStemLane`, `src/session/session-host-callbacks.ts`),
create an **`audio`-engine** lane instead of a `sampler` lane:

- `emptyLane(id, 'audio')` (was `'sampler'`); **no** `engineState.sampler.keymap`.
- The stem buffer is carried on the clip's `ClipSample` (`audioClip({...})`), which the
  `audio` engine already plays directly (`AudioVoice` → `playAudioClip`).
- Because the lane's engine is `'audio'`, `isAudioClip()` is true and the clip routes
  to **`renderAudioClipEditor`** (waveform-only). The piano-roll/keyboard never mounts.

This single change fixes problem #1 for free and is the precondition for #2/#3.

### 2. Sync: detected BPM + downbeat anchor + warp toggle

- **Tempo.** On a *Replace* import the session BPM is already conformed to the detected
  tempo (whole-bar snapped) — keep that (it landed correctly in live testing: a
  4:21 track → 128 BPM). Add mode leaves the project tempo untouched (existing rule).
- **Downbeat anchor.** Compute one anchor offset from the **drums stem** (clearest
  downbeat): the first detected onset (`detectLoop().slicePointsSec[0]`; fallback: the
  first energetic stem). Apply the **same** `trimStart` to **all** stem clips so they
  stay mutually phase-locked **and** their downbeat lands on bar 1. (Pre-roll/count-in
  before the first onset is trimmed; Phase 2's draggable marker lets the user reclaim
  or nudge it.)
- **Clean loop.** Size the stem clip so its playable region spans whole bars at the
  detected BPM, so it loops/gates on a bar boundary with no mid-song jump (#3).
- **Warp toggle.** `clip.sample.warp = false` by default → native playback, full
  fidelity. The `audio` engine's existing per-lane **Warp ON/OFF** lets the user switch
  to WSOLA grid-lock when they re-tempo the project. Non-uniform (per-marker) warp is
  Phase 2.

### 3. Transcription optional (default OFF)

- Add a checkbox to the Stems dialog (`index.html` `#stems-modal`), e.g.
  `#stems-transcribe`, **unchecked** by default, label "Transcribe to notes
  (experimental)".
- Thread the flag through `wireStemDialog` → `importStems` (`StemImportCallbacks`).
  `importStems` runs the transcription block **only when the flag is set**. Off → the
  import creates only the audio lanes; no "Notas:" lanes.

## Reuse vs new

- **Reuse:** the `audio` engine + `renderAudioClipEditor`; `detectLoop` (onsets +
  tempo); the existing warp/stretch + `bpm-broadcast` infra; the dialog/import plumbing
  and the replace-only BPM conform from the just-merged stop/BPM work.
- **New (small):** build an `audio` lane in the import path; the downbeat-anchor
  computation (drums-stem first onset, applied uniformly); the dialog checkbox + flag
  threading.

## Data model

No schema bump. Anchor = `ClipSample.trimStart` (already exists). Warp default = existing
`ClipSample.warp`. The transcription flag is a **transient import option** (on
`StemImportCallbacks`), not persisted in the session.

## Testing / acceptance

**Unit (Vitest):**
- `importStems` builds lanes with `engineId === 'audio'` (not `'sampler'`).
- Transcription is gated on the flag: default (flag off) → `transcribeStem` is **not**
  called; flag on → it is.
- The **same** `trimStart` anchor (derived from the drums stem onset) is applied to all
  stem clips.
- BPM is still conformed only on Replace (regression guard on the merged behavior).

**Live / manual (acceptance):**
- Opening a stem clip shows the **waveform editor only** — no piano-roll, no keyboard.
- Stems + a 4/4 kick **sync from bar 1**.
- **No mid-song bar jumps** through a full loop.
- Transcription **off by default** → no "Notas:" lanes; checking it restores them.

## Out of scope (Phase 2)

- Draggable Ableton-style **warp markers** + **piecewise (non-uniform) time-stretch** +
  a downbeat handle UI on the audio waveform editor.
- Improving transcription **quality**.

## Risks / notes

- *First-onset ≈ downbeat* is an assumption (true for 4/4 dance material; Phase 2 makes
  the anchor draggable for the rest).
- Native playback assumes the detected (whole-bar-snapped) tempo is accurate and steady.
  Residual drift on non-constant-tempo material is a Phase-2 (warp-marker) concern; the
  Warp toggle is the interim escape hatch.
- All four stems must share one anchor offset, or they desync from each other — the
  anchor is computed once and applied uniformly.
