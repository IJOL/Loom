# Lane roles, and pads as ordinary patterns

**Date:** 2026-08-10
**Status:** approved in conversation, not started.
**Branch:** `worktree-arranger-auto-accompaniment`.

## The problem, in the code's own words

A lane can be told which STYLE to draw loops from, and nothing else. Ask WEAVE
which shelves a melodic lane reads and it answers both of them, with a comment
that is already an apology (`src/app/weave-loops.ts`):

> *"A drum lane has one; a melodic lane gets both bass and lead patterns,
> because nothing in the session says which of the two a given lane is meant to
> be and guessing would hide half the library."*

So a bass lane is offered lead patterns and a lead lane is offered basses. And
the library has three shelves — `PatternKind = 'drums' | 'bass' | 'synth'` —
with nothing chordal on any of them: no pads, no comping.

## The role

A lane may carry one:

    'bass' | 'melody' | 'pad' | 'comp'

It lives on the LANE (`SessionLane.role`), is saved with the project, and is
**optional**. Absent means today's behaviour exactly, which is what makes this
shippable without migrating a single existing session: an unmarked lane is
offered bass and lead, as it always was.

It lives on the lane rather than inside WEAVE's own state because more than one
feature wants it. The arranger design of 2026-08-10 needs to know which lane is
the bass; a MIDI import could fill it in from the track it came from. One datum,
one owner — the alternative is how "which preset is this lane on" ended up with
three answers and no owner.

### What the role governs

- **Which library shelves the lane is offered.** The point of the round.
- **Which register its material lands in.** Half of this exists already and is
  keyed off the wrong thing: `rootFor` in `weave-loops.ts` puts a bass at MIDI
  36 and everything else at 48, decided by the PATTERN's kind. With four roles
  the split becomes deliberate — bass low, comp mid, pad mid and wide, melody
  above — so a pad does not sit on top of the melody.

### What it must NOT govern

**The instrument and the preset.** Marking a lane "bass" must not change what it
sounds like. The role says what part it plays, not what voice plays it — and a
mark that silently swapped an engine would be the same class of surprise as a
convert that reset your patch.

## What each role is offered

| Role | Library shelves |
| --- | --- |
| *(unmarked)* | bass + synth — unchanged from today |
| Bass | bass |
| Melody | synth |
| Pad | pad |
| Comp | comp |

Two rules around the table:

- **A lane's OWN clips are always offered**, whatever its role. The role limits
  the LIBRARY, not the user's material: a clip the user wrote in that lane is
  theirs, and hiding it would be the feature deciding it knows better.
- **A drum lane has no role picker at all.** It is not a decision that exists
  there; `kindsFor` keeps answering `['drums']` for a non-harmonic lane.

## Pads are patterns, not a second format

A melodic pattern is already stored as offsets from a root — one step at a time,
`{ semi, vel, slide } | null`, `null` for a rest. Relative, not absolute, which
is why the same loop plays in any key.

The only thing stopping a pad being written that way is that a melodic step
holds ONE note and lasts ONE step. The shape needed already exists in the same
file: a DRUM step is a list of hits.

So the step is widened, with two optional fields the existing data simply does
not carry:

    { semis: [0, 3, 7], hold: 16, vel: 0.6 }

`semis` replaces `semi` for a stack; `hold` is how many steps it sustains.
Three lines in `melodicPatternToNotes` — read `semis ?? [semi]`, emit one note
per entry, take the duration from `hold` when present. Existing patterns are
untouched and unmigrated: they have neither field and behave exactly as before.

`PatternKind` gains `'pad'` and `'comp'`, and their shelves are ordinary pattern
data written for this round.

### Why nothing more is needed

Because the chords are already handled. `applyProgression`
(`src/arranger/progression.ts`), applied to every melodic lane's folded notes at
`app/weave-wiring.ts:333`:

> *"Each note moves by the degree of whichever chord its bar is under, so a loop
> keeps its rhythm and its shape and changes what it is sitting on."*

A pad written as a pattern therefore travels the same road as the bass and the
lead, and changes chord by chord without knowing that chords exist. And because
the move is **by scale degree**, a stack becomes the diatonic chord of each bar
for free: a triad on the I lands as the triad on the VI when the bar is a VI.

An earlier draft of this spec invented a "recipe" format — a rhythm plus which
chord tones — to solve a problem that is already solved. It was wrong, and the
wrongness came from reading `patternNotes` alone (which transposes to the KEY)
without following the path to the end.

### The one rule for authoring the content

**Write the stacks inside the scale.** A minor triad is `[0, 3, 7]`, not
`[0, 4, 7]`. Transposition by degree preserves whatever it is given, so a stack
written outside the scale is walked outside the scale through every chord of the
progression. This gets a test rather than a comment.

## The control, and why it costs no width

The WEAVE row is already at its limit. Its twelve columns plus their gaps need
about **1020px** before the loops column — the only elastic one — gets a single
pixel. A thirteenth column pushes that to roughly 1140, which on a 1280px laptop
leaves about 140px to pick loops in. That is not a control.

So the role picker does not get a column: it **shares the STYLE cell**, one
above the other. Zero new width, the row keeps twelve columns, and the grouping
is the honest one — both controls answer the same question, which shelf do I
draw from. The row grows slightly in height, which is the axis with room.

The lane list already had a width problem and this does not fix it. Horizontal
scrolling with the name column frozen is worth doing; it is not this round.

## Acceptance

1. **A stack sounds as a chord and moves with the progression**: a pad pattern
   under a I–VI–IV–V reads as four different diatonic chords, not one repeated.
2. **The stacks are in the scale**: every pitch a pad shelf produces is in the
   session's scale, on every chord of the progression.
3. **Each role lands in its own register**: a pad's notes sit above the bass's
   and below the melody's.
4. **The filter filters**: a lane marked Bass is offered bass-shelf loops and
   its own clips, and nothing else.
5. **Unmarked changes nothing**: the offered list is exactly today's.
6. **Existing patterns are untouched**: the widened step changes no note of any
   pattern already in the library.
7. **The row survives**, checked in a browser: twelve columns, nothing wrapped
   to a second line, every heading still over its own control. This one is
   looked at rather than asserted — the last change to that grid collapsed it.

## What this deliberately does not do

- **It does not generate an arrangement.** Roles make the material sane; the
  arranger that decides what each role PLAYS is its own spec
  (`2026-08-10-auto-accompaniment-design.md`) and reads this one's marks.
- **It does not touch the bass and synth shelves.** They stay as they are; only
  who is offered them changes.
- **It does not infer a role.** The user marks it. A guess that is right most of
  the time is a guess you cannot correct without understanding it.
