# Follower lanes — accompaniment derived from a leading lane

Date: 2026-08-15
Status: approved design, not yet planned

## The problem

Loom has five ways to produce something chord-like, and none of them is
auto-accompaniment:

| Road | Where | What it actually does |
| --- | --- | --- |
| `arp` note-FX | `src/notefx/arp-processor.ts` | Breaks up in time what you play. Knows nothing about harmony. |
| `chord` note-FX | `src/notefx/chord-processor.ts` | Stacks a FIXED interval set on each note. Ignores key, scale and bar. |
| `random` note-FX | `src/notefx/random-processor.ts` | Controlled noise. Does not claim to accompany. |
| WEAVE progression | `src/arranger/progression.ts`, `chord-track.ts` | The user WRITES the chords (or picks a catalogue entry). The harmony is an input, not an output. |
| "Chords" button | `src/session/session-inspector.ts:596` → `src/core/harmony.ts` | The only melody→chords road: a per-bar frequency vote, a diatonic triad, voice-leading, written once into another lane. |

The last one is the closest and it still misses on four counts, all four
confirmed by the user:

1. **The harmony is crude.** `melodyToChordRoots` counts scale-degree
   occurrences per bar and takes the winner. A short passing note off the beat
   weighs exactly as much as the tonic on beat one, and there is no inertia, so
   the chord can flip every bar on a one-vote margin.
2. **It is a block, not a part.** One triad per bar over a five-entry rhythm
   table (`src/core/chord-rhythms.ts`). No bass, no pianistic register, no
   anticipation.
3. **It is dead.** A button that writes notes once. Edit the melody and the
   accompaniment is silently stale.
4. **The flow is wrong.** Buried in an inspector button, over one clip, behind
   a destination dialog.

## The decision

A **follower lane**: a lane that plays nothing of its own and derives its notes,
every scheduling iteration, from what a leading lane is about to play.

Two choices were made explicitly and are load-bearing.

**It reads AHEAD, it does not react.** The follower reads the notes the leader
*will* play in the coming iteration, not the ones that already sounded. This is
what makes cadences possible at all — you cannot prefer V in the last bar of a
phrase if you have not yet heard the phrase. It also keeps the feature
deterministic and alive in the offline render, which a reactive design
(hooking `trigger-dispatch`) cannot be. The cost is accepted: playing the leader
live from a keyboard produces no accompaniment, because there is no clip to read.

**"Alive" means derived, not reactive.** A follower is never stale: edit the
melody and the accompaniment changes on the next iteration, with nothing to
regenerate. That is complaint (3) fixed, and it is fixed by reading ahead, not
by reacting.

## What is reused

Almost every concept already exists. This design adds no new vocabulary:

- `LaneRole` is already `bass | comp | pad | arp | melody`
  (`src/session/lane-role.ts:23`), and `laneRoleOf` already resolves it
  ("the user's mark wins, the engine's `defaultRole` is the fallback"). A
  percussion lane answers `undefined` by design, which is exactly the rule that
  stops a drum lane from following.
- `Chord` is already `{ degree, bars }` in scale degrees
  (`src/arranger/progression.ts:34`), and `activeProgression`
  (`src/arranger/chord-track.ts:67`) already implements "the written one wins
  over the picked one".
- `nearestVoicing` and `inversions` (`src/core/harmony.ts`) already voice-lead.
- `metricWeight` (`src/weave/metric-weight.ts`) already knows which positions in
  a bar carry weight. It is simply not consulted by the current analysis.
- `notesFor(laneId) → WeaveSource | undefined` (`src/app/weave-wiring.ts:44`) is
  already the single resolver feeding `ctx.notes`
  (`src/core/lane-scheduler.ts:74`).

## Components

### 1. The data — `lane.follow`

```ts
follow?: { leaderId: string };
```

One field on `SessionLane`. **The part is not stored here**: the lane already
has its `role`, and `laneRoleOf` already resolves it. A follower marked *Bass*
plays the bass; marked *Pad*, the pad.

Persisted in `SavedStateV3`. A save whose `leaderId` names a lane that no longer
exists resolves to "not following" rather than erroring — the same tolerance
`session-migration.ts` applies elsewhere.

### 2. Analysis — `src/harmony/infer-chords.ts` (pure)

`inferChords(notes, { key, scale, barTicks, bars }) → Chord[]`

Notes in, a progression out — the *same* `Chord[]` a hand-written progression
uses. That identity is the point: an inferred progression can feed the WEAVE
fold, be drawn in the chord bar, and be corrected by hand without translation.

Three changes against the current frequency vote, one per failure:

- **Metric weight and duration.** A note scores by where it falls and how long
  it lasts, not by existing. This is what separates a short off-beat passing
  note from the tonic on beat one.
- **Inertia.** Holding the previous chord carries a bonus, so the harmony stops
  flipping every bar on a one-vote margin.
- **Cadence.** With the phrase in view, the final bar prefers V or I.

Scoring is per candidate diatonic degree: how much of the bar's weighted
material that degree's triad explains, minus a penalty for material it does not
— a penalty discounted for short, off-beat notes, which are passing tones rather
than evidence of a different chord.

### 3. Arrangement — `src/harmony/parts/`

One renderer per role, `(progression, opts) → NoteEvent[]`:

- **bass** — root and fifth in the low register, on the style's rhythm.
- **comp** — chords voiced with `nearestVoicing`, plus **anticipation**: when the
  chord changes, the entry lands half a beat before the bar. This is the detail
  that makes it sound played rather than quantised.
- **pad** — long notes, one per chord change, no rhythm of its own.
- **arp** — walks the chord tones.

`renderChordComp` is not used by any of this. Its only caller is the "Chords"
button, so its fate is that button's fate (see Open).

### 4. The hook — `src/harmony/follow-source.ts`

`createFollowSource(cfg, deps): WeaveSource`

The **same shape** as `createWeaveSource`, and the same cache-by-key discipline,
because this runs on the scheduler tick (`src/weave/weave-runtime.ts:51` is the
pattern to copy: round the inputs, key on them, refold only on change).

It resolves through the existing `notesFor` in `weave-wiring.ts`: when a lane
follows, `notesFor` returns the follow source; when it weaves, the weave source.
One door, one answer.

Reading the leader: its launched clip's notes, or — if the leader is itself
weaving — the leader's own source, so a follower tracks a woven leader correctly.

### 5. Weave and follow are exclusive

Choosing one turns the other off in the UI. Both write through the same door and
chaining them would require deciding which overrides which — a question with no
good answer, paid for later in strange bugs. Both configurations survive in the
save; only one is resolved.

### 6. The inferred progression is visible and editable

Drawn in the chord bar. Touch it and it becomes a **written** progression —
which is exactly the precedence `activeProgression` already implements. When the
analysis gets a chord wrong, the fix is two seconds rather than a fight.

### 7. UI

A Follow section on the lane in the session inspector: a leader dropdown (melodic
lanes only, the lane itself excluded, and no cycles) and the existing role
control. Choosing a leader turns off that lane's weave.

## Testing

Three layers, per the project's testing rule (relative assertions only):

1. **Pure analysis** — a known melody in A minor infers i-VI-III-VII; a passing
   note does not move the chord; an ambiguous bar holds the previous chord
   (inertia); a phrase ending prefers V or I.
2. **Part renderers** — shape per role: the bass stays in its register, the pad
   emits one note per chord change, the comp's anticipated entry precedes the
   bar line.
3. **Through the real transport** — counting triggers, the way
   `src/app/weave-scheduling.test.ts` does. This is not optional:
   `weave-runtime.ts:6` records that WEAVE's first shape passed every isolated
   test while the lane fell silent in the real transport. A follower lane can
   fail in exactly that way.

## Constraints

- New files stay under the project's 300-line target (500 hard cap), measured in
  code lines.
- `src/harmony/` is pure: no DOM, no `AudioContext`, no module state.
- No `engineId === '…'` anywhere. Whether a lane can lead or follow is asked
  through `src/plugins/capabilities.ts` and `laneRoleOf`.

## Open — decided after listening, not now

**What happens to the "Chords" button.** The follower supersedes
`session-inspector.ts:596` entirely, but the call to retire it is deferred until
the follower has been heard. The three note-FX (`arp`, `chord`, `random`) stay
regardless: they transform what you play and do not compete with this.

## Out of scope

- Reacting to live keyboard/MIDI input. If it is ever wanted, it is a separate
  phase with its own spec.
- Sevenths and extensions. `diatonicTriad` builds triads; `inversions` documents
  where a fourth position would go when sevenths arrive.
- Modulation / key changes within a session.
