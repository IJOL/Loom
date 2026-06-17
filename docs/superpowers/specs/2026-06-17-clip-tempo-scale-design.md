# Clip tempo `*2` / `/2` buttons — design

**Date:** 2026-06-17
**Status:** Approved (brainstorming), pending implementation plan.

## Goal

Add two direct buttons to the clip inspector — `*2` and `/2` — that double or
halve the **perceived tempo** of a note/drum clip by time-scaling its content,
the way Ableton's clip-view buttons re-time a MIDI clip.

## Semantics (confirmed with the user)

Mapped to **BPM**, not to Ableton's literal "multiply the loop length" labels:

- **`*2` — double tempo (faster).** Notes are *compressed*: every time value is
  multiplied by `timeFactor = 0.5`. The clip length halves.
- **`/2` — halve tempo (slower).** Notes are *stretched*: every time value is
  multiplied by `timeFactor = 2`. The clip length doubles.

> ⚠️ This is the *opposite* of Ableton's literal `*2`/`:2` button labels (where
> `*2` multiplies the loop length → slower). We use the BPM convention because
> that is what the user asked for ("doblar/dividir los bpm"). Tooltips spell out
> the exact effect so the UI is unambiguous.

A button press scales, in one undoable gesture: **notes + clip length + loop
sub-region + clip automation envelopes**.

## What gets scaled

Let `tempoMult ∈ {2, 0.5}` and `timeFactor = 1 / tempoMult`.

1. **Notes** (`clip.notes[]`, ticks at `TICKS_PER_QUARTER = 96`):
   - `start = round(start * timeFactor)`
   - `duration = max(1, round(duration * timeFactor))` (never below 1 tick)
   - Lossless: no note is dropped or clipped (see length invariant below).

2. **Loop sub-region** (`clip.loopStartTick` / `clip.loopEndTick`, when present):
   - `= round(value * timeFactor)`. `loopEnabled` is untouched.

3. **Clip length** (`clip.lengthBars`, integer ≥ 1):
   - `lengthBars = max(1, round(lengthBars * timeFactor))`.
   - **Indivisible boundary (user rule):** a 1-bar clip pressed `*2` →
     `round(0.5) = 1`, so the length **stays at 1 bar**, but the notes and loop
     are still compressed into the first half. (You cannot shorten a 1-bar clip.)
   - **No-clip invariant:** because the only fractional result of
     `lengthBars * timeFactor` is `x.5` (integer `lengthBars`), and `Math.round`
     is half-up, the new length is always ≥ the scaled note span. Notes never
     overflow the new length, so nothing is ever clipped.

4. **Automation envelopes** (`clip.envelopes[]`, `{ paramId, values: number[], … }`):
   - Envelope `values` are indexed by **absolute sub-step**, with the consumer
     ([collect-scene-automation.ts](../../../src/export/collect-scene-automation.ts)
     and `tickSessionEnvelopes`) expecting
     `totalSubs = lengthBars * 16 * AUTOMATION_SUB_RES` (`AUTOMATION_SUB_RES = 16`,
     i.e. `lengthBars * 256` samples). They are **not** phase-indexed, so changing
     `lengthBars` without resizing `values` desyncs the automation.
   - Therefore each envelope is **resampled** to the new expected length
     `newLengthBars * 16 * AUTOMATION_SUB_RES` by phase (nearest-neighbor):
     `new[j] = old[ clamp(floor(j * oldLen / newLen), 0, oldLen-1) ] ?? 0.5`.
     - Stretch (`/2`): array grows, samples repeat → curve plays at half speed.
     - Compress (`*2`): array shrinks, samples decimate → curve plays double speed.
     - Resampling by phase from *whatever* the old length is also normalises any
       legacy/odd-length array to the length the consumer expects.
   - **Known corner (accepted):** at the 1-bar `*2` floor the length does not
     change, so the envelope keeps its full-bar shape while the notes compress
     into the first half — a minor, documented mismatch that only occurs because
     a 1-bar clip cannot be shortened.

## Architecture

### Pure core: `src/core/clip-time-scale.ts`

```
export function scaleClipTempo(clip: SessionClip, tempoMult: number): void
```

- DOM-free, deterministic, unit-testable. Mutates the clip in place (the caller
  snapshots for undo before calling).
- Internally: `timeFactor = 1 / tempoMult`; applies the four transforms above.
- A small exported helper `resampleEnvelope(values, newLen)` keeps the envelope
  math testable on its own.
- No `meter` argument needed: tick scaling is meter-independent; the envelope
  array uses the same hardcoded `16` steps/bar convention as its consumer (clip
  automation is 4/4-only by existing design).

### UI: inspector header

Two buttons in `index.html` placed **next to the Length field** inside
`#insp-transport-row`:

- `*2` (id e.g. `insp-tempo-double`) — tooltip *"Double tempo — compress notes &
  halve clip length"*.
- `/2` (id e.g. `insp-tempo-halve`) — tooltip *"Halve tempo — stretch notes &
  double clip length"*.

UI text in English (app consistency). Reuse the existing `.rnd` button styling.

### Wiring: `src/session/session-inspector.ts`

In `openInspector()`:

- Resolve the two buttons; **hide them for audio clips** (`kind === 'audio'`,
  no notes); visible for `notes` **and** `drums` clips.
- `insp-tempo-double.onclick = () => this.scaleClipTempo(2)`
  `insp-tempo-halve.onclick  = () => this.scaleClipTempo(0.5)`

New private method:

```
private scaleClipTempo(tempoMult: number): void
```

- No-op if no selected clip.
- Run inside `withUndo(this.deps.historyDeps, run)` (or bare `run` if no history),
  where `run`:
  1. `scaleClipTempo(clip, tempoMult)` (pure mutator).
  2. `this.deps.renderWithMixer()` — clip-grid cell widths depend on `lengthBars`.
  3. Re-mount the editor so the new `patternTicks` takes effect and the Length
     field reflects the new value (the piano-roll fixes its width at construction,
     so it must be rebuilt — reuse the existing re-render path, e.g. `openInspector()`).
- One undo entry reverts notes + length + loop + automation together.

## Testing

**Pure unit tests** (`src/core/clip-time-scale.test.ts`):

- `*2` halves note `start`/`duration`; `/2` doubles them.
- `duration` floored at 1 tick.
- Loop region scales when present; absent loop fields untouched.
- `lengthBars`: `/2` doubles; `*2` halves; 1-bar `*2` stays 1 while notes compress.
- No-clip invariant: a note ending exactly at the old clip end stays within the
  new length for odd bar counts (e.g. 3-bar `*2`).
- Envelope resample: output length == `newLengthBars * 256`; stretch repeats
  samples; compress decimates; shape preserved by phase.
- Round trip: `*2` then `/2` restores grid-aligned notes (and vice versa where
  length permits).

**Live verification (mandatory for a UI feature):** load a clip with notes (and
one with automation), press `*2` / `/2`, and *look*: notes re-time, clip length
changes in the grid, playback tempo audibly doubles/halves, undo reverts in one
step. A drum clip behaves the same.

## Out of scope (YAGNI)

- Audio-channel clips (their tempo is already handled by warp).
- Factors other than ×2 / ÷2 (no ×3, no free numeric field).
- Making clip automation meter-aware (already 4/4-only by existing design).
