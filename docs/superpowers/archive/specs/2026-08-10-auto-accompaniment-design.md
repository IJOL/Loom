# Auto-accompaniment + key detection — second pass

**Date:** 2026-08-10
**Status:** rewritten against the tree with WEAVE merged. Replaces the first pass
(`2026-08-07-auto-accompaniment-design.md`, deleted in the same commit), which was written
before WEAVE landed and is now wrong about where two of its five parts belong.
**Branch:** `worktree-arranger-auto-accompaniment`, on top of `worktree-weave-dynamic-panel`.

## Why a second pass

The first pass described five parts. Two of them were built while it sat unreviewed — and one
was built better than it was specified. Re-reading it against the code, most of what is left is
not "unimplemented spec" but "spec aimed at a tree that no longer exists": it routed the chord
progression into `SessionState.chords` and a Tools dialog, and the progression now lives in
WEAVE's header and its own state.

This pass keeps only what is still missing, and re-aims it.

## What landed, and where the first pass was wrong

### The analysis layer — built, and better

[src/analysis/pitch-profile.ts](../../../../src/analysis/pitch-profile.ts) and
[src/analysis/key-detect.ts](../../../../src/analysis/key-detect.ts) exist. Three corrections to
the first pass, each of which came from measuring rather than from arguing:

1. **Two scales are excluded, not one.** The first pass excluded `chromatic` because it matches
   everything. `pentMinor` has to go for the mirror reason: it is five of minor's seven, so
   anything that fits minor fits it too *and it scores higher for asking less*. Measured, a full
   minor scale over its own tonic came back "pentatonic minor" every time.
2. **Confidence is two numbers.** The first pass specified one. On a plain minor scale the top
   six candidates were the same root wearing six different modes, all within 5% — the root was
   beyond doubt and the mode was a coin toss, and a single figure reported the coin toss.
   `confidence` measures the root against the best rival on a *different* root; `modeConfidence`
   measures the mode against its best sibling on the same root.
3. **Cosine, not raw correlation**, so a loud passage and a quiet one in the same key score
   alike and a template cannot win by leaving energy unaccounted for.

Incidentally the candidate count is back to 72 — 12 roots × 6 modes — but for a different reason
than the first pass gave: `ScaleId` has since gained `lydian` and `mixolydian`, so the six
seven-note modes are exactly the templates of equal size that make the comparison fair.

### The chord progression — built, in degrees, and wired into WEAVE

[src/arranger/progression.ts](../../../../src/arranger/progression.ts) is the chord track the first
pass designed: scale degrees, no chord quality, diatonic transposition. Two decisions it made
that the first pass had not:

- **No chord quality is stored** — the scale already decides whether the third above a degree is
  major or minor, so recording "minor sixth" would store something the key can contradict.
- **`transposeByDegrees` pins `octaveBase` to 0**, a real multiple of twelve, because any other
  value puts the scale root between the scale's own intervals and the degree round-trip stops
  being reversible. That is a fault this codebase has shipped once already.

It is wired: the picker sits in WEAVE's header beside Key and Style, the id lives in
`WeaveState.progression`, and [weave-wiring.ts](../../../../src/app/weave-wiring.ts) applies it per
bar — **before** the harmony-leader guard, and walking the *session's* bars rather than each
clip's, so a two-bar clip under a four-bar progression hears all four chords instead of the
first two twice.

So `SessionState.chords` from the first pass is dead. There is one owner and it is WEAVE's state.

### `printScene` — the scene stamper, smaller than proposed

[`printScene(state, notesByLane, name, lengthBars)`](../../../../src/session/session-runtime.ts#L108)
takes computed notes and writes **one** scene row, one clip per lane that has notes, copying the
arrays. It does **not** create lanes.

The first pass's `buildArrangement(plan)` — lanes plus N section scenes — should not be built as
specified. `printScene` is the right size for what it does, and what is genuinely missing beside
it is lane *creation*, not a second scene stamper (§3).

## What is still missing

Three things, in the order they are worth doing.

### 1 · The analysis layer has no way in

`detectKey` has exactly one caller in the tree, and it is
[tools/loop-fingerprints.ts](../../../../tools/loop-fingerprints.ts) — an offline script. **Nothing
a user can press reaches it.** Four pieces close that:

- **`src/analysis/chroma.ts`** — `profileFromAudio(mono, sampleRate)`, unchanged from the first
  pass: a **semitone filterbank (Goertzel)**, one filter per semitone from C1 to C7, over ~100 ms
  frames, on a mono mixdown decimated to 11 kHz. Not an FFT: linear-width bins have to be mapped
  onto a logarithmic pitch axis and the mapping is where the error lives. Per frame, normalise
  before folding to 12 bins so a loud frame does not dominate the file.
- **`src/analysis/analysis-scope.ts`** — gather a profile for a clip, a lane (summing its clips,
  or `profileFromAudio` on its buffer) or the whole mix (skipping lanes where `isHarmonic` is
  false, and normalising each lane before summing so a busy lane does not outvote a sparse one).
- **`src/analysis/transpose.ts`** — `transposeSemitones(notes, n)`, clamped to 0..127, dropping
  rather than folding notes that fall outside. **This is not a duplicate of
  `transposeByDegrees`** and the two must not be merged: moving material to a different *key* is
  chromatic, and moving it onto a different *chord of the same key* is diatonic. Each is wrong
  in the other's job.
- **`Tools → Detect key…`** — a dialog with a scope select, the result as
  `F# minor · root 84% · mode 31%` with the runners-up beneath, and two actions: **Adopt** (write
  the session's key and scale) and **Transpose** (rewrite the analysed scope's notes; disabled
  with a reason when the scope contains audio).

**And one consumer the first pass did not know it needed, which is now the most valuable of
all.** `loop-fingerprints.ts` was written to answer a question its own header states: *"WEAVE's
automatic mode draws loops at random and nothing measures whether the one it picks agrees with
the one already playing."* A profile per library loop turns that random draw into an **informed**
one — when EVOLVE hands over, prefer a loop whose profile agrees with what is sounding. That is
detection earning its keep inside the feature that is already shipping, rather than in a dialog
the user has to think to open.

Fingerprints are computed **once, at library load**, and cached by loop id. Measuring on every
handover would put a 12-bin correlation in the scheduler's path for no gain — a loop's notes do
not change.

### 2 · Nobody knows what a style's band is

`PanelContext.addLane(engineId)` takes the engine **from the user**, and `styleForLane` decides
only which style's *loops* a lane draws from. Nothing anywhere maps "Deep House" to "you want a
kick, a sub, a chord stab and a pad, on these engines with these presets".

So the promise the first pass opened with — one button, a whole band — is still not kept, and it
is the single largest missing piece.

**`src/arranger/style-kits.ts`**, as designed, with one change of aim: it seeds **WEAVE tracks**
rather than stamping section scenes.

```ts
import type { LaneRole } from '../session/session-types';
export interface PartSpec {
  role?: LaneRole; engineId: string; presetId?: string; name: string;
  noteFx?: NoteFxState[];        // the arp part ships an 'arp' note-FX
}
export interface StyleKit { parts: PartSpec[] }
export const STYLE_KITS: Record<StyleId, StyleKit>   // exhaustive
```

`Record<StyleId, …>` is deliberate: a new style must fail to compile until its kit exists.

**`PartRole` and `PartSpec.patternKind` are gone**, and this is not a rename. Both were a
fourth and fifth answer to "what part is this", and the lane-roles round retired the other
three into one: a part's role is a `LaneRole`, written onto the lane it seeds, and which
shelf it draws from is `sourcesFor(role)` — the same door WEAVE's loop list and the
inspector's pattern dropdown ask. `drums` is not a role: whether a lane is a drum lane is
answered by its engine's `harmonic` capability, and a role on such a lane is ignored.
`role` is optional because it can be: an engine that IS a part declares `defaultRole` in its
own manifest (the 303 says `bass`), so a kit that names `tb303` need not repeat it.

**`seedBand(styleId)`** then creates one lane per part through the existing
`onAddLane`/`swapLaneEngine` path, applies the preset, and gives each lane a `LaneSelection`
whose A and B are two library loops of that part's pool in that style. One button in WEAVE's
header — **Band** — beside the progression picker.

Note what this deliberately does **not** do: it does not generate notes. WEAVE's crossfade over
library loops is already better material than anything `renderPart` would have written, so the
first pass's `part-generators.ts` is dropped entirely. The kit chooses instruments and pools; the
weave plays.

### 3 · Sections, and the Fill the MC report already answered

The first pass proposed five section scenes (intro/A/B/fill/end) and `buildArrangement`. Most of
that is now redundant: WEAVE with EVOLVE on is a better answer to "A versus B" than two frozen
scenes, and `printScene` already captures a moment worth keeping.

What survives is the **Fill**, and the answer is the one the research report reached, not the one
the first pass cut:
[docs/research/2026-08-07-roland-mc-performance-modes.md](../../../research/2026-08-07-roland-mc-performance-modes.md) §9 and §11.
A fill is **held**, not launched. There is no return-to-previous state machine because nothing
ever left.

And there is a loose end to tidy first. **The momentary primitive exists twice.**
[src/weave/momentary.ts](../../../../src/weave/momentary.ts) is written, tested and has **no
caller**; the panel's SURGE button implements the same snapshot-press-restore inline in
[plugins/weave/main.ts](../../../../plugins/weave/main.ts). That is not carelessness — a plugin
cannot import this repo's source, so the panel *had* to write its own. The fix is to decide the
primitive's home:

- if held gestures belong to panels, `createMomentary` moves to `@loom/plugin-sdk` and the panel
  imports it;
- if it stays host-side, `src/weave/momentary.ts` needs a host caller or it should be deleted.

Either is fine; two copies is not. **FILL** then becomes a second held button beside SURGE,
whose targets are a drums-lane density push rather than the three macros SURGE moves.

## Testing

Only for what this spec adds; what landed already carries its own tests.

**Pure**

- `chroma` (`.dsp.test.ts`, no `AudioContext` — the input is a generated `Float32Array`): a
  440 Hz sine lands overwhelmingly in bin 9; a C major triad lifts bins 0, 4, 7 above the rest;
  white noise is near-flat.
- `transposeSemitones` — offsets, clamping, out-of-range notes dropped.
- `analysis-scope` — a drum lane contributes nothing; a busy lane does not outvote a sparse one;
  a muted lane is skipped.
- `style-kits` — the record is exhaustive at runtime too (iterate `STYLE_CATALOG`); every
  `engineId` is registered; every part's resolved role (`laneRoleOf`) has material to draw
  from in at least one style — patterns for a pattern role, shapes for a chordal one.
- `seedBand` — creates one lane per part; each lane ends with a `LaneSelection` whose two loops
  both resolve (an id that lists but does not resolve is a loop that shows in the dropdown and
  plays silence).
- Informed draw — given a sounding profile, the chosen loop's profile correlates better than the
  worst candidate's, and the loop just left is never redrawn.

**E2E**

- `Tools → Detect key…` on a generated clip in a known key reports that key.
- WEAVE → **Band** on an empty session creates the kit's lanes and the scene is audible
  (`waitForAudible`, never `waitForTimeout` after a quantised launch).

Assertions relative throughout — ratios and orderings, never absolute magnitudes.

## Cuts, still standing

| Cut | Reason |
| --- | --- |
| **Audio pitch-shift** | WSOLA artefacts past ±3 semitones, and a full pre-render. Detection on audio ships; the transpose action stays note-only |
| **Per-bar chord detection** | The progression comes from the catalogue and is now wired. The profile layer makes this a per-bar loop later, not a rewrite |
| **Manual chord editor** | The catalogue is the input. The data model is already the right shape for an editor |
| **Detection inside the import/stems dialogs** | The imported material is a lane a second later, and `Detect key…` with scope "this lane" reaches it |
| **`part-generators.ts`** | New in this pass. WEAVE's crossfade over library loops beats generated parts; the kit picks instruments, the weave plays |
| **`buildArrangement` / five section scenes** | New in this pass. `printScene` covers capturing a moment; EVOLVE covers the variation the sections were for |

## Conventions this must respect

- No `engineId === '…'`; ask [capabilities.ts](../../../../src/plugins/capabilities.ts).
- Files ≤ 300 code lines (hard cap 500). `style-kits.ts` is the one at risk; split by style
  family if it grows, never by splitting the types away from the table.
- All UI text in English.
- A plugin never imports this repo's source — which is exactly why §3's duplicate exists, and
  the fix must respect it rather than route around it.
