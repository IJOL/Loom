# Lane roles: one vocabulary, one answer, and chords that are generated

**Date:** 2026-08-10 (rewritten after audit)
**Status:** approved in conversation, not started.
**Branch:** `worktree-arranger-auto-accompaniment`.

> Two earlier drafts of this spec are deleted rather than kept. The first
> invented a "recipe" format for pads. The second replaced it with authored
> semitone stacks and a rule to write them inside the scale. **Both were wrong
> for the same reason**: neither author had read `src/core/harmony.ts`, which
> already generates diatonic chords per style, or `midiToScaleDegree`, which
> snaps before it transposes. What survives from them is the part the user
> actually asked for — the mark and the filter.

## Why

A lane can be told which STYLE to draw loops from, and nothing else. Ask WEAVE
which shelves a melodic lane reads and it answers both, with a comment that is
already an apology (`src/app/weave-loops.ts:119`):

> *"A drum lane has one; a melodic lane gets both bass and lead patterns,
> because nothing in the session says which of the two a given lane is meant to
> be and guessing would hide half the library."*

So a bass lane is offered lead patterns and a lead lane is offered basses. And
there is no way to ask for a pad at all.

## What already exists, so this round does not rebuild it

Established by audit, with the numbers executed rather than reasoned:

- **`src/core/harmony.ts` generates chord parts.** `diatonicTriad` builds the
  chord of a degree **in the session's scale, by construction**;
  `CHORD_RHYTHMS` is a per-style table of named shapes — offbeat stabs, pulsing
  eighths, sparse stabs, syncopated, and `SUSTAINED`, which is one whole-bar
  hit and is exactly what a pad is; `renderChordComp` puts the two together. It
  is wired to the clip inspector's **Chords** button today.
- **`src/core/generators.ts` generates bass and melody** from per-style degree
  pools, exhaustive over every `StyleId`.
- **Transposition by degree snaps to the scale first**
  (`progression.ts:134` → `musicality.ts:117` → `snapToScale`). It preserves
  degree spacing, never semitone spacing. An authored stack of semitones cannot
  survive it: `[0,4,7]` in A minor comes back as F–B–C, a tritone and a
  semitone. Anything chordal must therefore be **generated in degrees**, not
  written in semitones — in every scale, not just the seven-note ones
  (`pentMinor` and `chromatic` are both in the shipped catalogue and break any
  semitone stack outright).

## 1 · One role vocabulary, and it lives on the lane

    export type LaneRole = 'bass' | 'melody' | 'comp' | 'pad' | 'arp'

On the LANE (`SessionLane.role`), saved, **optional**. Absent = today's
behaviour exactly, so no session migrates and nothing existing changes.

Save carries it for free and this was verified, not assumed: the save is a
whole-object deep clone (`session-core.ts:11` ← `session-host.ts:691`), the
load-time normaliser mutates in place with no field whitelist
(`session-migration.ts:16-32`), and `duplicateLane` deep-clones
(`session-ops.ts:117`). There is no explicit field list anywhere on the path.

**Drums is deliberately not a role.** Whether a lane is percussion is already
answered by `isHarmonic` at the capability door, and a second answer to a
question that has one is the fault this round exists to reduce, not to add to.

### This type replaces, it does not join

The tree already holds three vocabularies for "what part is this", and the
arranger spec proposes a fourth that disagrees with the one this spec first
proposed. Adding a fifth is not acceptable. So:

| Today | After |
| --- | --- |
| `PartRole` — `2026-08-10-auto-accompaniment-design.md:126` | **deleted**, `PartSpec.role: LaneRole`; its `drums` entry goes, since a drum part is known by its engine |
| `PartSpec.patternKind` — same spec, line 130 | **deleted**, derived from the role |
| `patternKindFor(engineId)` — `pattern-picker-ui.ts:16` | **retired** into the one answer; it is also an `engineId === '…'` in the core, which the project forbids |
| `genKindFor(engineId)` — `session-inspector.ts:39` | **retired** the same way |
| `GenKind` — `generators.ts:7` | kept as the generator's own internal name, reached only through the one mapping |

The single door is `sourcesFor(role)`, beside `kindsFor` in `weave-loops.ts`,
and every caller that wants to know what a lane may play asks it.

## 2 · What each role is offered

| Role | Offered |
| --- | --- |
| *(unmarked)* | bass + synth shelves — unchanged from today |
| Bass | bass shelf |
| Melody | synth shelf |
| Comp | generated chord parts — the style's rhythm shape, and the named alternatives |
| Pad | generated chord parts, `SUSTAINED` first |
| Arp | generated chord parts, arpeggiated |

- **A lane's OWN clips are always offered**, whatever its role. The role limits
  what is offered from the LIBRARY and the generators, never the user's own
  material.
- **A drum lane has no role picker.** `kindsFor` keeps answering `['drums']`.

### The generated choices are the RHYTHM SHAPES

A pad lane is not offered "pad loops"; there are none to author and there never
will be. It is offered the shapes `CHORD_RHYTHMS` already names, and the notes
come from `diatonicTriad` against whatever chord the bar is under. Five named
choices, in every style, in every scale, with no new content and no new format.

**They are a new loop SOURCE, not a new `PatternKind`.** This matters more than
it looks: `loop-ids.ts:19` holds a hand-maintained `PATTERN_KINDS` array, and
because `PatternKind[]` accepts a subset, adding a kind to the union
**typechecks silently** and then `parseLoopId` returns null for every id of it —
the loop appears in the dropdown and plays silence, which is the failure that
module's own header warns about. So the ids are `chord:<shape>`, parsed
explicitly, and a test asserts every offered id round-trips through
`parseLoopId` and resolves to notes.

## 3 · Inversions, so a chord part stops jumping

`diatonicTriad` (`harmony.ts:49`) builds `[degree, +2, +4]` from the same
`octaveBase` every time, so every bar's chord is assembled from scratch in root
position. Two measured consequences: a part moves by as much as eleven
semitones between bars, and `avoidClash` then bends one voice of the stack
after the fact (`harmony-guard.ts:27`), which is likelier the further the chord
has jumped from where the ear left it.

The standard answer is inversion — the same chord with its notes in a different
order — and it is what makes generated chords sound played rather than
computed. Two functions beside the triad:

    /** The same triad in each of its positions: root, 1st, 2nd. */
    export function inversions(triad: number[]): number[][]

    /** The voicing of `triad` closest to `prev`, by total semitone movement.
     *  `prev === null` (the first bar) gives root position. */
    export function nearestVoicing(triad: number[], prev: number[] | null): number[]

`renderChordComp` keeps the previous bar's voicing and asks for the nearest one.
Nothing else changes: same degrees, same rhythm, same notes of the scale — only
which octave each voice sits in.

Three things to be exact about, because the video that prompted this says
"1st, 2nd and 3rd":

- **A triad has three positions, not four.** A third inversion needs a seventh
  chord, and `diatonicTriad` builds three notes. Sevenths are the harmoniser
  spec's business, and when they arrive `inversions` grows a position rather
  than changing shape.
- **Mirror inversion is a different operation** — reflecting the intervals
  around an axis rather than rotating a voice up an octave. Deliberately out.
- **No control this round.** The voicing is automatic, and the row has no width
  left for a picker — the argument the role dropdown already had to win. A
  fixed inversion is one argument on the same function whenever a UI wants it.

And one bound the plan must carry: the nearest voicing is chosen **within an
octave of `octaveBase`**, or a long progression walks the chord part away from
the register its role put it in, one small nearest step at a time.

**This changes the output of a shipped feature.** The clip inspector's Chords
button (`session-inspector.ts:586`) renders through `renderChordComp`, so its
chords will be voiced differently from the next build. That is the improvement,
not a side effect, and acceptance 9 pins what must NOT change with it.

## 4 · Register

`rootFor` (`weave-loops.ts:140`) decides where material sits from the PATTERN's
kind: 36 for bass, 48 for everything else, each ±6 semitones by key. It becomes
role-keyed, with the parts kept apart:

| Role | Base |
| --- | --- |
| bass | 36 |
| pad | 48 |
| comp | 52 |
| melody | 60 |
| arp | 60 |

These are a starting point to be adjusted **by ear**, not a result. What the
plan must pin is the ORDER — bass below pad below comp below melody — measured
as MIDI numbers over a real progression, because diatonic transposition here is
always upward and moves a part by as much as eleven semitones on some bars.

Two things the plan has to carry that are easy to miss: a lane's own clips
never pass through `rootFor` at all (`weave-loops.ts:189`), so the role cannot
move them and must not pretend to; and `rootFor` has a twin,
`patternRootFor` (`pattern-picker-ui.ts:33`), which still uses the naive
`octaveBase + key` that `weave-loops.ts:129-139` documents as the bug reported
as *"nunca pones bajos que suenen a bajos"*. It is retired here too.

## 5 · The control

A dropdown — `— / Bass / Melody / Comp / Pad / Arp` — **sharing the STYLE
cell**, one above the other. The row's twelve columns plus gaps already need
1022px before the elastic loops column gets a pixel (`_weave.scss:399`, measured
including its 8px gap); a thirteenth column would leave about 140px to pick
loops in on a 1280px laptop. The cell's heading reads **Role · Style**, because
both controls answer the same question — which shelf do I draw from.

**The WEAVE panel is an external plugin, so this is not a CSS change.** It needs
a `role` field on `PanelLane` (`panel-context.ts:229`), `laneRole` /
`setLaneRole` on `PanelContext` beside the existing `laneStyle`/`setLaneStyle`
(`packages/loom-plugin-sdk/src/manifest.ts:351`), the host implementations, and
`npm run build:plugins` — without which nothing is visible at all.

Two behaviours the control must have, both learned from its neighbour:

- **Changing the role reseeds the lane's selection**, the way `setLaneStyle`
  already calls `reseedLaneIfLoopsMoved` (`panel-context.ts:396`). A loop id
  carries its own kind and still resolves whatever the role says, so without a
  reseed a lane marked Bass keeps playing the synth loop it had.
- **A role whose pool is empty must not silently kill the weave.**
  `defaultSelection` returns null on an empty pool (`weave-selection.ts:36`).
  Generated chord shapes exist in every style, so Comp/Pad/Arp are always
  populated; the bass and synth shelves are not guaranteed per style, and the
  plan states what happens when they are empty rather than discovering it.

**Undo is asymmetric and this is deliberate.** The role is a session mutation
and goes through `withUndo`; the style beside it lives in `WeaveState` and is
written with no undo (`panel-context.ts:389`). Two controls in one cell with
different undo behaviour is odd, and the alternative — making the role
un-undoable to match — is worse.

## Acceptance

Real progressions from the shipped catalogue (`progression.ts:61`), real MIDI
numbers, no adjectives.

1. **A pad follows the chords.** A Pad lane under `i-VI-III-VII` in A minor
   produces four different triads across the four bars, each one diatonic — no
   pitch outside A minor on any bar.
2. **It works outside the seven-note modes.** The same lane in `pentMinor`
   produces only pitches of that scale. (The audit showed a semitone stack
   cannot do this; a generated one must.)
3. **Every generated choice actually sounds.** Each id offered to a Comp / Pad /
   Arp lane round-trips through `parseLoopId` and resolves to a non-empty note
   list. This is the silent-dropdown trap, tested directly.
4. **The filter filters.** A lane marked Bass is offered bass-shelf loops and
   its own clips, and nothing else; a lane marked Pad is offered chord shapes
   and its own clips.
5. **Unmarked changes nothing.** The offered list for a lane with no role is
   identical to today's, asserted against the current output.
6. **The parts stay apart.** Over `i-VI-III-VII`, bass < pad < comp < melody on
   every bar, as MIDI numbers.
7. **One answer, not four.** `patternKindFor`, `genKindFor` and
   `PartSpec.patternKind` no longer exist; grep is the test.
8. **The row survives**, looked at in a browser: twelve columns, nothing wrapped
   to a second line, and the shared cell headed `Role · Style`.
9. **Inversions move less, and change nothing else.** Over `i-VI-III-VII`, the
   total semitone movement between consecutive chords is strictly smaller than
   the same progression in root position — the number is compared, not
   eyeballed. And with it: the same degrees, the same rhythm, every pitch still
   in the scale, and no voice further than an octave from `octaveBase`.

## What this does not do

- **It does not generate an arrangement.** The arranger is its own spec and now
  reads this vocabulary instead of inventing one.
- **It does not touch `avoidClash`.** It moves single voices ±1–2 semitones off
  forbidden intervals (`harmony-guard.ts:27`), which can bend a generated triad
  after the fact. It stays in scale, so acceptance 1 and 2 hold; whether a
  chord's identity should be protected from it is a real question and belongs
  with the harmoniser spec, not here.
- **It does not infer a role.** The user marks it.
