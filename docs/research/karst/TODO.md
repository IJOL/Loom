# Karst port — where we are

> **RECONCILED 2026-08-29: everything below LANDED on `main`.** The two branches
> (`feat/karst-port` stacked on `feat/kick-like-karst`) were rebased and
> fast-forwarded, then deleted — which left this file describing a branch
> topology that no longer existed. All THIRTEEN commits are on `main` under the
> same subjects: `ac3668c7`, `912a7f10`, `882d42ff`, `c98c94bb`, `4a494f54`,
> `0785f69a`, `92faa073`, `f2d6276d`, `b2a4f3b2`, `a1c565a5`, `f4dc47e1`
> (karst-port) and `70b6cf0c`, `ede76a62` (kick). Read the rest as the work log
> it was, in the past tense.

Companion to [README.md](README.md), which is the research; this is the work.

```
feat/karst-port       refactor: the contract had three producers and one of their names
                      docs: the note generator spec
                      refactor: the progression was session harmony parked in a panel
                      notefx: key vs chord — the second conform tap
                      test: the modulator a preset carries, watched arrive
                      notefx: the tonality three FX ignored
                      notefx: live keys answered in A minor
                      notefx: a chord could be named, never voiced
                      presets: the chord machine's sound was already here
                      test: per-note variation in real audio
                      modulation: which note is this
feat/kick-like-karst  drums: the kick's low end
                      drums: the kick had one envelope
main                  42268d9e
```

Full suite green at the time: 570 files, 5786 tests.

---

## What the plan got wrong

Worth recording, because two of the five pieces were not what they looked like.

- **Piece 1 dissolved.** A chord engine was going to be built from the research
  doc — and Subtractive already was one, down to a preset (`PAD PWM Breather`)
  that is Karst's chord oscillator note for note. The doc described Karst
  precisely and had not looked at Loom with the same care.
- **Piece 5 was never in the plan.** It came from an observation, and it
  contained a real bug.
- **Piece 2 uncovered a distinction the research had already recorded and the
  plan had not read as work**: Karst's `pitch_conform` exposes `scale` and
  `chord` as separate taps. Ours only does scale. See 2b.

---

## 1. The sound — an engine ✅ DONE (no engine needed)

Subtractive already has `osc1.pw`/`osc2.pw`, ladder filter models, both
envelopes and unison; `PAD PWM Breather` already ships the LFO→PW patch. A ninth
engine would have duplicated the eighth. Delivered instead as `PLUCK Per-Note
Pulse`, which pairs that sound with the modulator that did not exist.

Committed. 5 tests.

## 2. Free intervals + IN KEY — the note-FX ✅ DONE

`chordType: 'free'` with `i1`/`i2`/`i3` in semitones (0 = voice off), and
`conformOn` snapping every produced note to the session key. Conformed intervals
that collide are de-duplicated. Named voicings and their defaults are untouched.

Committed. 12 tests, including the two behaviours that surprised me.

## 2b. Chord-aware conform ✅ DONE

IN KEY is now **off / scale / chord**. Scale keeps you in the key and still
lets you play a passing note the chord does not contain; chord locks you to
three pitch classes and cannot sound wrong against the harmony, nor can it
sound like a melody. A choice, not a better setting — which you want depends
on whether the lane is stating the harmony or moving over it.

A progression's `Chord` is a DEGREE and nothing else, so the tones derive:
stacked thirds are every other degree, wrapping over the scale's OWN length
(a pentatonic wraps at five, not seven). `chordTonesOf` + `snapToPitchClasses`
in `core/musicality.ts`.

`snapToPitchClasses` is a SIBLING of `snapToScale`, not a generalisation:
`random-processor`, `pattern-library` and `example-loader` depend on the
latter's exact upward tie-break for music that already exists. It repeats the
tie-break rather than sharing an implementation — a listener would notice at
once if one leaned up and the other down.

Committed. 19 tests.

### 2c. Where the chord comes from ✅ DONE

`ctx.chordDegree` is read but nobody fills it yet, so chord mode behaves as
scale. That is safe and honest, and it was left open because the answer moves
a concept:

- The progression lives on the **WEAVE state** (`weave-state.ts` — `progression`
  by catalogue id, `chords` written by hand), with the weave's own bar cursor.
- A follower lane has its own `follow.chords`, derived from its leader.

Two authorities, neither global.

**DECIDED 2026-08-24: promote the progression to `SessionState`.** It becomes a
property of the SONG, so the note-FX, the arp, the piece-4 generator and the
weave itself all ask the same place. The answer that will not need redoing.

- [x] The progression lives on `MusicalityState` (`progression`, `chords`)
- [x] `activeProgression` already took `{ progression?, chords? }` — it can
      read the session shape unchanged
- [x] The weave reads from the session rather than from its own state
      (four call sites in `app/panel-context.ts`, one in `arranger/chord-track.ts`)
- [x] `trigger-dispatch` gained `getChordDegree`, wired in `main.ts` beside
      `getMusicality` — the bar from the transport, not from the weave's lap
- [x] No migration: still being built

**Care required**: the weave works today and this moves ground under it.

## 3. Per-note modulation ✅ DONE

`driver` opens to `'time' | 'gate' | 'trigger'` in five places (SDK type, load
validator, registry, `ModLite`, and the plugin CLI's build validator, which
bites first). The ordinal is counted in `VoiceManager` — the layer allowed to
remember — and captured on the slot at spawn, so a held pad keeps the value it
was born with. The kernel's fourth argument is optional, because required broke
nine call sites in `plugins/sh`, i.e. every third-party kernel.

`plugins/pernote`: `value = frac(n × Pattern + Skew)`.

Committed. 8 + 5 + 4 + 3 tests across kernel, plumbing, counter and real audio.

## 4. The note generator — a LaneNoteSource ✅ DONE, all seven stages

Karst's `event_core` is system-managed — not editable in their UI — and it is
what makes the "GEN:" machines generative. It is NOT opaque: see 4a. We have
its control surface, its internal structure, and every connection.

`METER`, `REPEATS`, `^2`, `Bar Mod`/`Loop Mod`, `MULTIPLE`, `CYCLE`, `%`,
`CADENCE`, `OFFSET`, `CHORD`, `LENGTH`, `DIV`, `PHRASE` — each wrapped in its own
per-trigger modulation. Musical vocabulary, not statistical: no "density", no
"probability".

Shape: a third producer of `LaneNoteSource`, beside weave and follow, mutually
exclusive with both. NOT an engine — an engine would have to invent notes inside
the worklet, the second "what does this lane play" hook that shape exists to
prevent.

- [x] **4a. Find out what is in the box.** Done — and it is not a box.
- [x] **4b. Agree the scope.** Settled 2026-08-24: the FULL control surface,
      not a subset. Written up as
      [the spec](../../superpowers/specs/2026-08-25-note-generator.md), which
      also records the three decisions taken on 2026-08-25 — where the material
      comes from, what CADENCE means, and what is per lane versus shared.
- [x] **Stage 1: the grid and the read head.** `src/generator/` — grid, pool,
      generate, source — plus `app/generator-wiring.ts`, the third branch of
      `build`. A generating lane fires once per beat and takes its pitch from
      the loops it selected. 37 tests.
      - The head is ABSOLUTE (lap × steps), not counted from the launch, or an
        offline render of bar 5 would not match the bar you heard.
      - The pattern governs the repeat and nothing else does yet: a pool longer
        than the pattern has a tail nobody hears. That gap is what stage 6
        fills, and it is pinned by a test so nobody reads it as a bug.
      - Where the state lives was a decision, not a default: `lane.generator`,
        beside `follow`, NOT inside `WeaveState`. Sharing the weave's selection
        would have had `resetWeave` clear the generator and `s.weave` carry it.
- [x] **Stage 2: the shared per-trigger formula.** `frac(n × pattern + skew)`
      now lives in `@loom/plugin-sdk` as `dsp/pattern`, with `plugins/pernote`
      reduced to its own identity (which ordinal it reads, and its polarity).
      The spec said `src/generator/` and was wrong by construction: an external
      plugin compiles against the SDK and cannot reach the host at all, so the
      SDK is the only room the two stand in. 8 tests.
- [x] **Stage 3: CADENCE + PHRASE.** `src/generator/cadence.ts`. Three floors
      on one metric weight, combined with `max` — a hit clears all of them or
      none, so there is no weighting to tune. 24 tests.
      - **DIV came forward from stage 5, and had to.** On the meter's beat every
        position weighs ≥ 0.72 and `phraseFloor`'s middle is 0.6, so PHRASE
        could not have removed a single hit: a knob that does nothing. Pinned by
        a tripwire test rather than just fixed.
      - The two ends are the spec's musical claims and fall out of the
        comparison being STRICT: `> 1` at amount 0 is silence, `> 0` at amount 1
        is the whole division. No special case.
      - CADENCE reads the folded HEAD, not the absolute step. Absolute would
        mean the rhythm never repeats — not a groove — and would make the grid
        decorative. Displacement (stage 6) moves that same number, so every
        stream evolves together.
      - The pool is read at the head whether or not the step fired, so thinning
        the rhythm does not transpose the melody.
      - The turnaround HOLE (`phrase.inHole`) was available and not taken: the
        spec asks for a floor, and silencing half the last bar is a strong
        arrangement statement to impose unasked.
- [x] **Stage 4: CHORD.** `src/generator/chord.ts`. 2b's vocabulary unchanged
      — `chordTonesOf`, `snapToPitchClasses`, `degreesOf` — and 2c's promoted
      progression is finally read by a third party, which is what it was
      promoted for. 25 tests.
      - **The harmony walks the SONG's bars; the rhythm repeats with the
        pattern.** CADENCE reads the folded head, CHORD reads the absolute bar.
        That is what lets every lane agree on where the music is while
        disagreeing about what to play there.
      - `pitch` walks the SET, not semitones: chord tones on 'chord', scale
        degrees on 'scale'. A step in semitones would be a transposition, which
        is the weave's octave fold — a different control for a different job.
        Three tones is an octave for a triad, which is what makes it the
        maximum a full-depth mod spans.
      - Default is **off**, and honestly so: the blend walks scale DEGREES, so
        the pool is already in key and scale-conform at the default would be a
        no-op with a cost. Chord-conform is a choice, not a better setting.
      - Off means off in BOTH halves. A voicing offset that still moved while
        the conform was inert is half a control working.
      - The conform reads the LANE's tonality, not the session's raw one: if
        Darkness moved this lane's scale, the session's would snap the line out
        of the key its own notes are in.
- [x] **Stage 5: LENGTH and OFFSET.** `src/generator/note-timing.ts` — one file
      for both, because between them they answer one question: a note's shape in
      TIME. 14 tests. (DIV landed early, in stage 3 — it had to, or PHRASE was a
      dead knob.)
      - **HOLD above 1 is the generator's SLIDE control**, on every engine that
        has one, without knowing any of them exist. The 303's portamento has no
        flag: it is inferred from one note still holding when the next starts.
        So a note is deliberately allowed to run PAST the iteration — trimming
        it to the loop would have quietly removed the portamento.
      - NUDGE is in FRACTIONS of a step, not ticks, so moving DIV does not
        silently rescale the groove.
      - The nudge is clamped INSIDE the iteration. Early off step 0 starts
        before the loop, late off the last step starts after its end, and the
        scheduler drops both — the groove would lose its first and last note
        rather than swing them.
      - Capped at one step however amount and mod stack: further and a hit
        changes which BEAT it is on, which is CADENCE's job done badly.
- [x] **Stage 6: Bar Mod and Loop Mod.** `src/generator/displace.ts`. 13 tests.
      The gap stage 1 pinned is CLOSED: a seven-note pool under a four-step
      pattern now reaches all seven, and still reaches only four with the wheels
      off — so the control is what makes the difference, not the laps.
      - **`harmony/cycle` was NOT reused, against the spec's advice.** Read
        closely the two answer different questions: `cycle` is four NAMED wheels
        on periods fixed in its source, turned on a few at a time by one `level`
        knob, deciding which of a follower's choices differ. These are moduli
        the USER sets, moving a position on a pattern. Mapping MULTIPLE, CYCLE
        and % onto a level knob means deleting them, and the full surface is the
        agreed scope. What IS shared — co-primality — is named in the file so
        nobody reads it as a second implementation.
      - **Displacement moves WHAT IS PLAYED, not WHEN.** Karst puts it before
        all four streams, which would move the rhythm and the phrase with the
        material and stop the opening bar being the opening. CADENCE reads the
        undisplaced head; the pool and the voicing read the displaced one.
      - It is ADDED to the head, not folded back into the pattern. Re-folding
        caps the read at `patternSteps`, which is exactly what made a long pool
        unreachable.
      - **BAR MOD has nothing to turn on a one-bar pattern**, and the default
        grid IS one bar — so its three controls do nothing until BARS is raised.
        Coherent rather than broken, invisible unless said: pinned by test and
        written in the file.
      - CYCLE 1 means "not turning", the same convention `harmony/cycle` uses
        for a period of 1.
- [x] **Stage 7: the panel.** Done ahead of schedule — see below. Stage 6's six
      controls cost six lines in `PARAMS`.

### The panel, brought forward ✅ DONE (2026-08-25)

Stage 7 was last in the spec, which would have meant six stages before a single
note could be heard. Brought forward on the day, at Nacho's request, once it
became clear the feature was real and unreachable.

`plugins/weave/generator-cell.ts` + `src/app/panel-context-generator.ts` + four
new `PanelContext` members. A **GEN** switch per lane in the WEAVE row, and its
controls on a LINE of their own under the lane.

- The surface is declared as **data** (`PanelGeneratorParam[]`), so a new
  control is one line in `PARAMS` rather than an edit in the SDK, the host and
  the panel. Stage 5's four controls cost exactly that one line each.
- Switching ON seeds the material from the lane's own clips, so the button makes
  a sound where it is pressed. Switching OFF keeps the selection.
- A LINE, not a grid cell: `weave-lane-setup` declares a column per control and
  has been broken once by one added without.
- The param setter does NOT `refresh()` — that remounts the panel and destroys
  the element a dragging pointer is holding. The switch does, because a whole
  line appears.

### 4a. Reading the black box ✅ DONE — there is no black box

It is a patch. `event_core` has an `interior` like any Structure: seven
modules, one of which is a structure called **Pattern Gen 1** — a `piano_roll`
(26 modules), a `Tick Wrap Hanh` (10), and a `Pattern Modulation` (13) holding
**Bar Mod** (20 modules, knobs Multiple/Cycle/%) and **Loop Mod** (19). All of
it built from the same fifteen primitives: order, modulo, add, multiply, value,
merge, separator, constant, knob.

"System-managed" means the UI will not let you edit it. Its content is data,
and the data ships **publicly and without authentication**:
`app.karst.systems/factory/systems/get-started.karst`, 14.9 MB of JSON, path
taken from their own bundle. A full recursive dump — 466 lines, 38 named knobs,
every connection with its source and destination — was taken and read.

**And that changes what we must be careful about, not what we should do.**
Public and legible does not make it ours. Reading it to learn the VOCABULARY
and the shape of the problem — that there is a bar modulus and a loop modulus,
that cadence is separate from phrase, that everything hangs off the tick
through moduli — is study. Transcribing the graph node by node into Loom is
derivative work from a paid product, and gives the repo the same provenance
problem as a disassembly, only easier to fall into.

**Use the structure of the problem, not their solution.** They have told us
for free which questions are the right ones, and that was the valuable part;
it reads without copying a single connection.

## 5. One tonality, followed everywhere ✅ DONE

- [x] **The bug.** `live-notefx.ts` hardcoded `key: 9, scale: 'minor'`, so a
      chord note-FX answered live keys in A minor whatever the session said —
      the same lane in two tonalities depending on where the note came from. Now
      a required argument, read by `loom-facade` through one reader shared by
      both call sites (two readers would strand voices on release).
- [x] **The lie.** `random` follows the session via sentinels but its card
      painted root "A" for "follow". `Global` is now a first-class option in both
      dropdowns, and the default.
- [x] **The gap.** `arp` ignored `ctx.scale` entirely and carried a duplicate
      interval table. `scale: 'global'` is now the default and walks **the
      degrees of the key** from the note you played — not a fixed scale
      transposed onto it, which is what "in key" actually means. In C major,
      playing E now gives E-F-G-A-B rather than E-F#-G#-A-B.
- [x] Committed. 8 tests, plus two regressions the suite caught and that were
      right to fire: a test inheriting the old default scale, and the guard that
      every shipped preset carries a measured energy level.

## 6. Arp pattern editor ✅ DONE

`src/notefx/arp-steps.ts`, plus a sixth `ArpPattern` — `steps` — and a text
field on the arp card that appears only when it is chosen. 20 tests.

Steps are **pool indices, not notes**: "the third of the pool", never "G#", so
the pattern survives a transpose, a change of key and a change of scale. An
absolute-note editor already exists and it is the piano roll.

Three things settled differently from the sketch above:

- **The rest is `.`, not `-1`.** `-1` is a real index — indices wrap by
  floor-mod, so it names the top of the pool, an octave below where the walk
  starts. Spending it on a rest would have removed the only way to reach it. A
  dot is also how a tracker writes one.
- **A rest keeps its SLOT.** The pattern is a grid, so a hole stays a hole;
  splicing rests out would turn a written rhythm into the same notes played
  faster. `generateArpSequence` returns `(number | null)[]` for all six patterns
  rather than special-casing this one — the caller then has one thing to handle
  instead of a question about which pattern it asked for.
- **The default IS the upward walk, written out** (`"0 1 2 3"`). Switching
  PATTERN to `steps` changes nothing until you edit it: you are handed what you
  already had rather than an empty box.

The string encoding was taken over widening the type: `NoteFxState.params`
already accepts `string`, and widening it to carry arrays drags serialisation,
the save format and undo along for one control. Indices wrap, so a pattern
written against a five-note pool still plays against a seven-note one.

Worth keeping in view, because it was nearly a reason not to build this:
**Karst has no pattern editor anywhere.** It answers the same need with
per-trigger modulation, which is piece 3 and shipped as `plugins/pernote`, and
Loom now has a third answer in the generator's CADENCE. What this one adds that
neither has is saying exactly what you want.

---

## Order from here

**~~2c~~ → ~~4b~~ → ~~4, all seven stages~~ → ~~6~~. The port is DONE.**

All six pieces are built, and two of them turned out not to be what the plan
said they were (1 dissolved into a preset; 5 was never in the plan and carried a
real bug). Nothing is merged: the whole port lives on `feat/karst-port`, stacked
on `feat/kick-like-karst`.

What is left is not port work:

- **Review and merge.** Two branches, unreviewed, and `main` has not moved.
- **The wheel.** `core/knob` moves half its range per wheel notch, and the
  generator's row of nineteen knobs sits in a panel that scrolls — so scrolling
  past retunes it. The behaviour is the app's, everywhere, long before this.
  Raised 2026-08-26 and NOT fixed: the cure touches every knob in Loom and that
  is a decision, not a step.
- **A weaving lane still ignores its clip** (see CLAUDE.md). Known, reported,
  undecided — and now a generating lane does the same, deliberately.
