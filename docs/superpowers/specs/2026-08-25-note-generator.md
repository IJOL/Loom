# The note generator — spec

A third producer of `WeaveSource`: what a lane plays when it is neither reading
its clips nor following another lane, but generating.

Comes out of the Karst research ([docs/research/karst/README.md](../../research/karst/README.md)
§7, §4a) and its work log ([TODO.md](../../research/karst/TODO.md) piece 4).
Scope agreed 2026-08-24: **the full control surface**, not a subset.

---

## 1. The finding that shapes everything

Reading Karst's `event_core` (research §4a) showed it is **not** an invent-notes
machine. It is `Pattern Gen 1`: a `piano_roll` holding material, a `Tick Wrap
Hanh` folding the tick into the pattern's length, and a `Pattern Modulation`
holding two nested displacers — `Bar Mod` and `Loop Mod` — that move WHERE the
read head lands. Four streams then decide what comes out.

So the shape is **a read head over material, displaced by nested moduli, with a
per-parameter decision on each note.** That is much closer to what Loom already
does than "a generator" suggests.

## 2. Most of this already exists here, under other names

This is the important table. Piece 1 was nearly built twice because the research
described Karst precisely and had not read Loom with the same care; that is not
happening again.

| Karst calls it | Loom already has | where |
|---|---|---|
| METER | the session time signature | `core/meter` |
| Bar Mod / Loop Mod (MULTIPLE, CYCLE, %) | co-prime wheels — "small wheels, long music" | `harmony/cycle` |
| PATTERN + MOD, per parameter | `frac(n × pattern + skew)` | `plugins/pernote` (piece 3) |
| Trigger Count | the lane's note ordinal | `VoiceManager.triggerIndex` (piece 3) |
| CADENCE | which positions in a bar are strong | `weave/metric-weight` |
| PHRASE | where a bar sits in the phrase, as a FLOOR on metric weight | `harmony/phrase` |
| CHORD → the note it lands on | chord tones + snapping | `chordTonesOf`, `snapToPitchClasses` (2b) |
| which chord is sounding | one tonal authority | `musicality.progression` (2c) |
| where the notes go | `SchedulerContext.notes` | `WeaveSource` |

**Genuinely new: four things.** Pattern length (`REPEATS`, `^2`), the read head
itself, `DIV` (the division a stream runs at), and `OFFSET` (step displacement).
Everything else is assembly and adaptation.

`harmony/cycle` deserves a second look in particular: its comment already
argues Karst's case in Loom's words — *"The lever is co-primality. Three wheels
of 3, 4 and 5 phrases share no divisor, so the pattern of where all three stand
does not come round until 60 phrases have passed. Small wheels, long music."*
That is Bar Mod and Loop Mod, reasoned out independently and already shipped.

## 3. The model

```
                    ┌── grid ──────────────────────────────┐
  transport tick →  │ tick mod (repeats × 2^pow2 bars)     │ → position
                    └──────────────────────────────────────┘
                                     │
                    ┌── displacement ─────────────────────┐
                    │  Bar Mod   (within the bar)          │
                    │  Loop Mod  (across the loop)         │  → read head
                    └──────────────────────────────────────┘
                                     │
         ┌───────────┬───────────────┼───────────────┬──────────────┐
      CADENCE      OFFSET          CHORD           LENGTH
    does it fire?  where exactly?  which pitch?    how long?
         └───────────┴───────────────┴───────────────┴──────────────┘
                                     │
                              NoteEvent[]
```

Four streams, each carrying the same five controls where they apply:
`PATTERN`, `MOD`, `DIV`, `PHRASE`, `OFFSET`. `PATTERN`/`MOD` is the per-trigger
formula from piece 3 — the same maths, used at generation time instead of at
param time, which means extracting it from `plugins/pernote` into a shared pure
function rather than writing it twice.

### Purity

`src/generator/` follows `src/weave/`: no DOM, no `AudioContext`, no module
state. A generated bar must be a pure function of (tick, params, tonality), or
the offline render will not match what was heard — the same rule the modulator
kernels live under, and for the same reason.

## 4. The parameter surface

Karst's, in full, with our reading of each.

**Grid**
| control | range | what it does |
|---|---|---|
| `meter` | from the session | beats per bar |
| `repeats` | 1–16 | bars before the pattern repeats |
| `pow2` | 0–3 | ×1, ×2, ×4, ×8 on that length |

**Displacement** — twice, as `bar.*` and `loop.*`
| control | range | what it does |
|---|---|---|
| `multiple` | 1–16 | how far one step of the wheel moves the head |
| `cycle` | 1–32 | the wheel's period |
| `percent` | 0–1 | how much of the displacement is applied |

**Streams** — `cadence`, `offset`, `chord`, `length`
| control | range | what it does |
|---|---|---|
| `pattern` | 0–1 | the multiplier in `frac(n × pattern + skew)` |
| `mod` | 0–1 | depth |
| `div` | 1–16 | the division this stream decides on |
| `phrase` | 0–1 | how much the phrase position floors it |
| `offset` | 0–15 | steps of displacement |

Plus each stream's own value: `cadence.amount`, `offset.amount`,
`chord.pitch`, `length.length`.

## 5. Decisions that need making, not assuming

### ⛔ CONFIRMAR 1 — what does it read?

Karst's generator reads a `piano_roll` it owns. Ours has three options:

- **(a) The lane's own clip.** Coherent with the weave, and the generator
  becomes "a read head over material you wrote". But CLAUDE.md already flags
  "a weaving lane IGNORES its clip" as a known, undecided problem, and this
  would be a second lane type with the same ambiguity.
- **(b) Nothing — pitches from the chord and scale.** Truly generative; no
  material to go stale. But then CHORD is doing all the melodic work and there
  is no way to make it play *your* idea.
- **(c) The weave's shelf.** The library of loops the weave already draws from.

**Recommendation: (a), with the clip read as MATERIAL rather than as timing** —
its pitches are the pool, its rhythm is ignored. That makes the clip meaningful
(unlike a weaving lane, where it is inert) without pretending the generator is
playing it.

### ⛔ CONFIRMAR 2 — is CADENCE floored by metric weight?

`harmony/phrase` is deliberately expressed as a floor on metric weight rather
than as patterns of its own, and says why: *"Inventing separate rhythms per bar
would be a second rhythm system arguing with the first."*

The same argument applies here. **Recommendation: CADENCE is a floor on
`metricWeight`,** so it thins and thickens an existing sense of the bar rather
than inventing a rhythm that disagrees with the meter. The alternative — a free
step sequencer — is piece 6, the arp pattern editor, and should stay there.

### ⛔ CONFIRMAR 3 — one lane or the session?

The generator is per lane (a `WeaveSource` is). But `Bar Mod`/`Loop Mod` and
the phrase are arrangement-scale ideas. Two generating lanes with independent
wheels will drift apart, which may be the point or may be chaos.

**Recommendation: per lane, seeded from the session.** The wheels run per lane;
the phrase and the progression come from the session, so lanes drift in texture
while agreeing on where the music is.

## 6. What it deliberately does not do

- **It is not an engine.** An engine would have to invent notes inside the
  worklet, which is the second "what does this lane play" hook that `WeaveSource`
  exists to prevent.
- **It does not transcribe Karst's graph.** Their document is public and
  readable (research §4a) and copying it node by node would be derivative work
  from a paid product. The vocabulary and the shape of the problem are what is
  being used; every implementation here is ours.
- **It does not add a second tonal authority.** Key, scale and progression come
  from `musicality` — settled in 2c.
- **It does not own a step editor.** That is piece 6.

## 7. Staging

Each stage ends green and committed, and each is worth having on its own.

1. **The grid and the read head.** `tick → position`, pattern length, no
   displacement, no streams. A lane generates its clip's pitches on the beat.
   Proves the `WeaveSource` seam end to end.
2. **The shared per-trigger formula.** Extract `frac(n × pattern + skew)` out of
   `plugins/pernote` into `src/generator/` (or `core/`) so both use one copy.
3. **CADENCE + PHRASE.** The rhythm decision, floored by metric weight. This is
   the stage where it starts sounding like music rather than a metronome.
4. **CHORD.** Pitch through `chordTonesOf` + the progression.
5. **LENGTH and OFFSET.**
6. **Bar Mod and Loop Mod.** Last, because they are the ones that make it
   evolve — and evolution is worth nothing until the thing being evolved is
   already musical.
7. **The panel.** A `kind: 'panel'` plugin, like WEAVE.

Stage 6 should reuse `harmony/cycle` rather than reimplementing displacement,
or there will be two answers to "how does this get long" in one codebase.

## 8. Testing

Same four layers as the rest of the project.

- **Pure** — the grid, the displacement, each stream, as numbers in / numbers
  out. The bulk of it.
- **Scheduling** — the generator through the real transport, counting triggers,
  the way `app/weave-scheduling.test.ts` caught the weave's per-note-predicate
  mistake that every isolated test had passed.
- **Determinism** — the same bar generated twice is identical, and a render
  from bar 5 matches a render from bar 1 fast-forwarded. This is the one that
  protects the offline export, and it is not optional.
- **Musical floors** — every generated note is in key; a phrase's first bar is
  never emptier than its middle; CADENCE at 0 is silence and at 1 is not a
  machine gun.

Assertions relative, never absolute magnitudes.

## 9. Size

Rough, and to be treated as a guess rather than a plan: stages 1–5 are each a
few hundred lines of pure code plus tests. Stage 6 is small if `harmony/cycle`
fits and a rewrite if it does not. Stage 7 is a panel plugin, which WEAVE has
already shown the cost of.

The honest comparison: Karst spends ~90 modules on this per instrument, built
from fifteen primitives and two templates. Ours reuses nine existing modules and
writes four new ideas. That ratio is the whole argument for having read their
document rather than copied it.
