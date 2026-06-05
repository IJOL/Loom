# Note velocity (Ableton-style) — design

- **Date:** 2026-06-05
- **Status:** Spec, awaiting plan
- **Topic:** Make per-note velocity capturable, editable, audible and visible — a velocity lane + velocity-driven note colour in both the piano-roll and the drum-grid editors.

## Goal

Notes carry a real velocity from MIDI import and note creation, the velocity is **audible** (it scales loudness continuously), and it is **visible** two ways, Ableton-style:

1. An **Ableton-style velocity lane** under the grid — a strip ~20% of the note-area height, one vertical bar per note, anchored at the note's start, bar height ∝ velocity, editable by dragging.
2. The **note colour** shifts with velocity along a 2-colour **blue→yellow** ramp.

## Current state (what already exists)

- `NoteEvent.velocity: number` already exists (`src/core/notes.ts:22`, 0–127, `>=100` = accent) and is already persisted (save schema v3) — **no schema change needed.**
- **MIDI import already captures real velocity** (`src/midi/midi-to-session.ts:63` copies `n.velocity`). No import change needed.
- **Note creation hard-codes velocity 80** everywhere: piano-roll (`pianoroll.ts:433`, `:587`, `:640`) and drum-grid (`clip-editor-drum-grid.ts:165`, accent bumps to 115).
- **Colour is binary today:** `velocity >= 100 ? '#ffaa44' (orange) : '#3498db' (blue)`, selection `#7fd4ff` — in both `pianoroll.ts:225` and `clip-editor-drum-grid.ts:137`.
- **Sound is binary today:** velocity only matters as the `accent = velocity >= 100` boolean, computed in `lane-scheduler.ts:176` (`noteTrigger`) and passed as a boolean through `session-runtime` → `trigger-dispatch` → `Voice.trigger({accent})`. Velocities of 60 vs 95 sound identical.
- There is **no velocity-editing UI** at all (besides the drum pencil's off→80→115→off cycle).

## Locked decisions (from brainstorming)

1. **Sound:** velocity scales loudness **continuously**; accent (`>=100`) stays as a **character** (filter env + Q on bass; brightness on drums) layered on top. The separate accent *gain* bump is reconciled into the velocity curve so loudness is not double-counted.
2. **Scope:** both editors — **piano-roll and drum-grid**.
3. **Colour:** 2 colours only, **blue→yellow**, blue-weighted (pivot 0.5). No orange in the ramp.
4. **Accent cue:** shown by a **white border** on the note + a **dashed threshold line** in the velocity lane — *not* by colour.
5. **Lane interaction:** full Ableton — drag a bar to set; with a selection active, drag adjusts all selected by the same delta; horizontal "paint" drag writes a velocity ramp.
6. **Default velocity on note creation:** **90** (accent stays `>=100`).

## Detailed design

### 1 · Data model

No change to `NoteEvent` or the save schema. The work is making velocity *editable*, *audible* and *visible*. Only the **creation default changes from 80 → 90** (one constant, used at every note-creation site).

### 2 · Colour — `velToColor(velocity)`

New pure helper `src/core/velocity-color.ts`, the single source of truth for both editors:

```ts
// Blue holds (slight lift) up to the pivot, then ramps to yellow. 2 colours only.
const BLUE = [48, 134, 212], LITE_BLUE = [80, 170, 234], YELLOW = [244, 222, 74];
const PIVOT = 0.5;
export function velToColor(velocity: number): string {
  const t = clamp(velocity, 0, 127) / 127;
  if (t <= PIVOT) return rgbLerp(BLUE, LITE_BLUE, t / PIVOT);
  return rgbLerp(LITE_BLUE, YELLOW, (t - PIVOT) / (1 - PIVOT));
}
```

Both `pianoroll.ts` and `clip-editor-drum-grid.ts` replace their binary `velocity >= 100 ? orange : blue` with `velToColor(n.velocity)`. **Selection** still overrides to cyan `#7fd4ff`. **Accent** (`velocity >= 100`) is drawn with a **white 1.5px border** instead of the cyan/black stroke (selection border wins when both apply).

### 3 · Velocity lane — UI

A strip under the grid, **~20% of the note-area height**, one vertical bar per note anchored at the note's `start` x, bar height ∝ `velocity/127`, bar fill = `velToColor`. A **dashed horizontal line** marks the accent threshold (velocity 100). The lane scrolls **horizontally in sync** with the grid (it shares the same `pxPerTick`/`scrollLeft`) and is fixed vertically.

- **Piano-roll** (`pianoroll.ts`): the editor frame today is a 2×2 CSS grid (corner / ruler / keys / grid-viewport). Add a **third row**: a left spacer under the keyboard + a velocity-lane canvas under the grid viewport. The lane canvas re-pins horizontally on scroll exactly like `rulerCanvas` (`syncStrips` `translateX(-scrollLeft)`). Lane height ≈ `0.2 × (FRAME_H − RULER_H)` (~60px); total editor height grows by the lane height so the note area keeps its size.
- **Drum-grid** (`clip-editor-drum-grid.ts`): a single canvas today — extend `FRAME_H` by a lane band (~42px) drawn at the bottom of the same canvas, below the 8 voice rows, in the same `xForTick` space.

### 4 · Interaction (full Ableton)

Pure logic in a new `src/core/velocity-lane-editing.ts` (mirroring `piano-roll-editing.ts` / `drum-grid-editing.ts`), unit-tested; the editors own only pointer wiring + canvas drawing + undo gestures.

- **Set:** pointer-down on a bar → drag vertically → `velocity = round(lerp(1, 127, 1 − yNorm))`, clamped 1–127.
- **Group:** if a selection is active and the grabbed note is in it, the drag applies the **same delta** to every selected note (each clamped 1–127). Selection is the editor's existing `Set<NoteEvent>`.
- **Paint ramp:** dragging horizontally across bars writes each crossed bar's velocity to the cursor height — Ableton-style ramps. (A pointermove that spans multiple bars sets each.)
- **Chords / overlap:** notes sharing a `start` are **fanned** a few px horizontally in the lane so each bar is individually grabbable; hit-testing picks the nearest fanned bar.
- All edits run inside an undo gesture (`onGestureStart`/`onGestureEnd` in the piano-roll; `beginGesture`/`commitGesture` in drums).

### 5 · Sound — velocity → loudness

Thread continuous velocity to the voices and scale per-note loudness with a shared curve `velToGain(velocity)` (amplitude-linear from a floor to 1.0). Accent keeps its filter/Q character; its redundant per-engine *gain* bump is removed/neutralised so loudness comes from velocity alone.

**Integration seam (additive, hot path):**

- `lane-scheduler.ts` `NoteTrigger` gains a `velocity: number` field; `noteTrigger()` returns `velocity: note.velocity` (keeps `accent` for character).
- `session-runtime.ts` passes `t.velocity` into the trigger callback; `trigger-dispatch.ts` (`onLaneTrigger`) forwards it into `Voice.trigger(..., { velocity })`.
- Each engine's voice scales its amp-envelope peak by `velToGain(velocity)`. The **note-FX `InsertChain.process`** path (`trigger-dispatch.ts:38`) must carry velocity through generated events too.
- **Offline export** duplicates `noteTrigger` (`docs/superpowers/plans/2026-06-05-scene-audio-export-phase2.md`); that collector must thread velocity identically so exported WAVs reflect dynamics. (If export lands first/second, whichever merges second rebases onto the other — see note below.)

**Calibration:** `velToGain`'s floor is tuned by ear + `npm run test:wav-diff` so existing demos stay musical (not perceptibly quieter); golden WAVs are re-blessed deliberately (`npm run test:wav-bless`) once the dynamics are intentional, and the user confirms the demos still sound good.

### 6 · Architecture & files

| File | Change |
|------|--------|
| `src/core/velocity-color.ts` | **new** — `velToColor` (pure) + tests |
| `src/core/velocity-lane-editing.ts` | **new** — lane geometry, hit-test, set/group/paint (pure) + tests |
| `src/core/velocity-gain.ts` | **new** — `velToGain` (pure) + tests |
| `src/core/pianoroll.ts` | velocity lane (3rd frame row) + `velToColor` + creation default 90 |
| `src/session/clip-editors/clip-editor-drum-grid.ts` | velocity lane band + `velToColor` + creation default 90 |
| `src/core/lane-scheduler.ts` | `NoteTrigger.velocity`; return it from `noteTrigger` |
| `src/session/session-runtime.ts` | forward `t.velocity` to the trigger callback |
| `src/app/trigger-dispatch.ts` | forward velocity into `Voice.trigger`; carry through note-FX events |
| `src/engines/*` + `src/core/synth.ts` + `src/core/drums.ts` | apply `velToGain` to per-note amp peak in each engine's voice (incl. the TB-303 `synth.ts` voice and the `DrumMachine` `play*` methods); drop the redundant accent gain bump where present |
| `src/polysynth/` (`PolySynth`) | thread velocity per voice for the poly engines (subtractive et al.) |

### 7 · Testing

- **Pure:** `velToColor` (endpoints + pivot monotonic), `velToGain` (monotonic, clamped), `velocity-lane-editing` (set/clamp, group delta, paint ramp, chord fan hit-test).
- **DSP (relative):** a higher-velocity render is louder than a lower-velocity render of the same note; accent still adds brightness at equal velocity. Relative asserts only (per repo rule).
- **wav-diff:** inspect demo deltas; re-bless goldens when the new dynamics are intentional.

## Risks & impact

- **`noteTrigger` is a hot path** shared by the live tick and the offline export collector → MEDIUM/HIGH blast radius. Changes are **additive** (new field, no removed params). Run `gitnexus_impact` on `noteTrigger` / `Voice.trigger` before editing.
- **Touching all 7 engines** for the gain curve is the main effort + regression surface; reconciling each engine's existing accent gain to avoid double-loudness is the subtle part. Calibrate against golden WAVs.
- **Overlap with the in-flight scene-export Phase 2** (its own `noteTrigger` copy) — coordinate so the second branch to merge threads velocity through the export collector too.

## Out of scope

- Velocity as a modulatable/automatable `AudioParam`.
- Humanize / randomize velocity, per-engine velocity curves, velocity→filter or velocity→anything-but-gain mappings.
- Changing the accent threshold or the slide/accent model.
