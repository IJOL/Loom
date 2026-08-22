# Harmony that moves: a real harmoniser, an editor, and scales that change

**Date:** 2026-08-10
**Status:** approved in conversation.
**Follows:** the chord track (`src/arranger/progression.ts`) and the SOUND fader,
both on this branch.

## Why

The chord track landed and it works, but three things about it are thinner than
they look, and a session spent playing it found all three.

**The catalogue is six entries because someone wrote six.** That is a data
limit, not a capability one — but underneath it there IS a capability limit: a
chord is a scale degree and nothing else, so borrowed chords, secondary
dominants, sevenths and inversions cannot be named at all.

**There is no way to edit a progression.** It was cut deliberately when the
catalogue was the only input, and the cut was recorded — but never revisited.
The data has been the right shape for an editor since the day it was written.

**And the one feature that derives harmony from music is bad.** The `Chords`
button in the clip inspector has existed for a long time; reported plainly:
*"ya lo tenemos pero es estático y no da muy buenos resultados"*. It is worth
being precise about why, because the fix follows from the diagnosis.

## What is wrong with the harmoniser we have

[`melodyToChordRoots`](../../../../src/core/harmony.ts) counts, per bar, how many
notes START on each scale degree and keeps the most frequent.

1. **It counts onsets, unweighted.** A run of passing sixteenths outvotes a bass
   note held through the bar. This is the exact mistake
   [pitch-profile.ts](../../../../src/analysis/pitch-profile.ts) was written to
   avoid — *"counting note-ons would say a sixteenth-note hi-hat line of one
   pitch matters more than a bass note held through the bar, and the ear says
   the opposite"* — and that module is right there, unused by this one.
2. **The most frequent note is not the root.** It is usually the third or the
   fifth. A bar dwelling on E over an A minor chord returns an E chord where the
   ear wants A minor, and that single error mistunes the whole feeling.
3. **Every bar is guessed alone.** There is no notion that a progression is a
   SHAPE, or that a phrase wants to close at home. So it wanders.

## 1 · A harmoniser worth the name

`src/arranger/harmonise.ts`, pure.

```ts
export function harmonise(
  notes: readonly NoteEvent[],
  opts: { key: number; scale: ScaleId; barTicks: number; bars: number },
): ChordTrack
```

**Per bar, score the candidates.** Take that bar's notes through
`profileFromNotes` — duration, velocity, register and metric position already
weighted, for free. For each degree, build its triad with `diatonicTriad` and
score how much of the profile its three pitch classes account for, with the
ROOT weighted above the third and fifth: a triad whose root is what the bar
leans on is likelier to be the chord than one that merely shares notes with it.
Normalise per bar, so a busy bar and a sparse one are compared on shape rather
than on how much happened in them.

**Then choose a PATH, not seven separate answers.** A dynamic program over the
bars, where the cost of landing on a degree is how badly it fits that bar plus
how unlikely the step from the previous chord is. Two things shape it:

- **A transition table**, small and declared rather than learned: V→i and IV→V
  cost nothing, staying put costs nothing, and the odd leaps cost more. It is a
  preference, not a rule — a strong fit still beats a cheap transition.
- **A cadence pull**: the last bar of the lap is biased toward the tonic, and
  the bar before it toward the fifth. That is what makes the result sound like
  it ends rather than merely stopping.

**A bar with no evidence carries the previous chord.** All-zero profile means
nothing to go on, which is different from a bar that argues for a change.

**Merge consecutive equal degrees.** Sixteen bars of the tonic become one slot
of sixteen bars, so harmonic rhythm falls out of the result rather than being a
separate guess — and the printed progression reads like a progression.

**It writes the CHORD TRACK, never notes.** That is what stops it being static:
the derived progression then drives the weave's fold, the bass and the comping,
and it can be edited afterwards. The existing `Chords` button keeps working and
gains a second door: *derive the session's progression from this lane*.

**From ONE nominated lane, not the mix.** Picking the lane is predictable and is
what was asked for; deriving it from everything at once sounds magical and fails
in ways nobody can explain or correct.

## 2 · An editor for the progression

The catalogue stops being the only input.

`WeaveState.chords?: ChordTrack` — present, it wins over `progression`, and the
dropdown reads **Custom**. Choosing a catalogue entry and then editing it copies
it into `chords` and switches to Custom, so the catalogue stays a shelf of
starting points rather than something you can damage.

The strip sits under the flow row in the WEAVE panel, where the progression
already lives: a cell per slot showing its roman numeral, its width proportional
to its bars.

- Click a cell → pick a degree from the seven.
- Drag its right edge → change how many bars it lasts.
- `+` appends a slot, `×` removes one.

The operations are pure and live beside the track
(`setDegree`, `setLength`, `insertAfter`, `removeAt`), so they are testable with
no DOM — the panel only decides what a cell looks like.

**If the chord track outgrows WEAVE it moves.** It is session harmony, not panel
state, and it sits there today only because that is where it was born. Worth
saying out loud so nobody later mistakes the location for a decision.

## 3 · Scales that move, not just chords

```ts
export interface Chord { degree: number; bars: number; scale?: ScaleId; key?: number }
```

A slot may carry its own scale and its own root; absent, the session's are used.
The fold already walks degrees, so the same progression over a changed scale
lands on different notes with no other change.

That buys both real modulations:

- **Modal interchange** — same root, another mode (A minor → A dorian). Mood
  already does this globally; this does it per section.
- **A key change** — another root (A minor → C minor).

One caution for whoever builds it: `transposeByDegrees` converts midi → degree →
midi *within a scale*, so a slot that changes the scale changes that mapping.
That is the point, but the conversion has to read the slot's scale on both
sides of the round trip or notes land somewhere nobody asked for.

The harmoniser **proposing** a scale change — noticing that a bar fits another
mode far better — is deliberately not in this round. Detecting it is the
analysis layer's job and it already can; deciding to modulate on the user's
behalf is a different kind of confidence.

## 4 · Chord quality — named, and deliberately last

Sevenths, borrowed chords, secondary dominants, inversions. Everything that
makes harmony interesting rather than merely correct, and all of it needs
`Chord` to carry something the scale cannot contradict.

It is last because the three above change what you HEAR with the model as it
stands, and this one changes the model. Doing it first would mean designing the
richer vocabulary before knowing which parts of it the rest of the round
actually wants.

## Testing

**Harmoniser** — the important ones are the failures of the old implementation:

- A bass note held through the bar beats a run of passing sixteenths. This is
  test one, and it is the whole reason the module exists.
- A bar dwelling on the fifth over its tonic chord returns the TONIC, not the
  fifth.
- A melody written over a known progression recovers that progression.
- An empty bar carries the previous chord rather than resetting to the tonic.
- The last bar of a lap prefers the tonic; a lap that could end either way ends
  at home.
- Sixteen bars of one chord come back as ONE slot, not sixteen.

**Editor ops** — degree changes in range, length never below one bar, removing
the last slot leaves a valid track, insert lands where it says.

**Scale per slot** — a slot with its own scale folds that bar's notes into that
scale and leaves neighbouring bars alone; a slot with its own key transposes
only its own bars.

Assertions relative throughout.

## Cuts

| Cut | Reason |
| --- | --- |
| Deriving harmony from the whole mix | Predictable beats magical: a wrong answer from one nominated lane can be understood and corrected, one from everything at once cannot |
| The harmoniser proposing scale changes | The analysis layer can detect it; choosing to modulate for the user is a different kind of confidence, and belongs after the manual version exists |
| Chord quality | §4 — it changes the model rather than what you hear, and the round should learn what it needs first |
| Live re-harmonisation while playing | The derive is a button. A progression that changed under the user's hands mid-take is a different feature and a much louder one |
