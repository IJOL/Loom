# WEAVE — transport, locks, and what a print keeps

**Date:** 2026-08-10
**Status:** approved in conversation, not yet planned.
**Source:** field feedback from a real session with the panel — the first round of notes written
while playing it rather than while building it.

## The one idea

Six of the seven notes below turn out to be the same complaint said six ways: **nobody decided
what WEAVE and the transport are to each other.** Play starts a clock but not the weaving; the
panel's off switch reveals a scene the user had forgotten was under there; a lock freezes some
things and not others with no stated rule; and there is no readout saying where the journey is,
so none of the above can be seen happening.

So this round is not six features. It is one invariant, stated once and applied everywhere:

> **WEAVE and the transport are one machine. A lock freezes MATERIAL, never HARMONY.**

Everything below follows from that sentence.

## 1 · Play starts what weaves

**Today:** ▶ starts the clock. A weaving lane whose carrier clip was never launched contributes
nothing, so the panel looks broken until you go and launch clips by hand. Stop does stop
everything, so the asymmetry is the surprise.

**Change:** ▶ launches the carrier clip of every lane that has a `LaneSelection`, then starts the
clock. `seq.start` is already wrapped at [main.ts:709](../../../src/main.ts#L709) for the
performance bookkeeping, so there is one place to add it and no second door.

A lane the user muted stays muted — launching is not unmuting, and conflating them would make ▶
undo a deliberate act.

## 2 · WEAVE off stops everything

**Today:** `WeaveState.bypass` means "unplugged: contributes no notes, does not travel, and
everything else in Loom carries on exactly as it does with this panel closed". Pressing it
therefore uncovers whatever the session scene was playing, which arrives as a surprise because
the user has been listening to the weave for ten minutes and has no memory of what is underneath.

**Change:** bypass also stops the transport.

Note what this does **not** revive. Muting the driven lanes was tried and reverted, correctly:
*"a switch that unplugs one thing must not reach for another"* — it reached into the mixer and it
left a session saved silent. Stopping the transport is a different act: it touches no mixer
state, saves nothing, and is undone by pressing ▶.

## 3 · A lock freezes material, never harmony

**Today:** `LaneWeaveConfig.locked` freezes which loop plays while the general macros still reach
the lane — deliberately, because a locked lane that ignored a rise in Energy would pull the mix
apart on its own. There is no master lock at all.

**Change, in two parts:**

- **A master lock** in the header: every lane's position stops advancing, the flow stops
  travelling, and no lane re-hooks. One switch that says "keep what I have".
- **Neither lock touches the progression.** The chord walk keeps going under both. This is the
  invariant, and it is not a special case: the progression is *perpendicular* to the weave — it
  decides where the material sits, not which material plays. Freezing the loops and freezing the
  harmony are two different wishes and only one of them is being expressed by a lock on the loops.

Concretely, in [weave-wiring.ts](../../../src/app/weave-wiring.ts): a locked lane still passes
through `withProgression`; what a lock removes is `applyFlow` and `rehook`.

## 4 · The journey is visible

**Today:** nothing on screen says where the flow is, which bar of the progression is sounding, or
how far a lane is between its two loops. With §3 shipped this becomes worse, not better: you
freeze something and cannot see what stopped.

**Change:** an evolution bar in the flow row showing the master position 0..1 and, beside it, the
current chord as `2/4 · VI`. The bar reads state that already exists (`flowAt`, `chordAtBar`) and
computes nothing of its own — the same rule the scene countdown ring follows, and for the same
reason.

## 5 · A print keeps the whole lap

**Today:** `printScene(state, notesByLane, name, lengthBars = 1)` writes **one bar of the current
instant**. Under a four-bar progression that is a quarter of what the user is listening to, and
the quarter they happened to be on.

**Change:** print `progressionBars(prog)` bars — fold each bar with the bar cursor set to that
bar, concatenate, and write a clip of that length. With `static` selected the result is exactly
today's behaviour, which is the right degenerate case.

Acceptance is the one the WEAVE spec already demands, extended to the lap: **playing the printed
scene sounds like what was heard**, measured across the whole progression rather than at one
instant.

## 6 · The step rack — diagnose before building

Reported: a row switched on, pointed at a sub's cutoff, and nothing heard. Tried several times.

This was reported once before and the whole chain was pinned then
([weave-steps-chain.test.ts](../../../src/app/weave-steps-chain.test.ts)), so the join is
unlikely to be where it breaks. Two findings from re-reading it, either of which explains the
report without a defect in the chain:

- **The rack only moves while the transport is playing.** `advance()` is driven from
  `onAfterTick` — the audio scheduling tick — so with the clock stopped the row is inert by
  design. Nothing on screen says so.
- **The knob does not move even when the sound does.** The write goes through the *unmounted*
  door (`applyPlaybackUnmountedWrite`), which is correct — the row owns the value and must not
  stamp it into the lane's saved sound — but it means a mounted cutoff knob sits still while the
  filter sweeps. A user watching the knob concludes nothing happened.

**So the first task is to establish which of these it was, with the transport running and the
master tap measuring.** Only then is there something to fix.

Either way, one thing ships regardless: **the panel must say when a row cannot run.** A row that
is on, with a destination, and a stopped clock is a state the user cannot distinguish from a
broken feature.

## 7 · Presets that evolve

**Wanted:** mark a lane's preset *from* and *to*, and have it travel between them like the loops
do.

**The constraint that shapes it:** a preset cannot be crossfaded wholesale. Cutoff and resonance
have midpoints; waveform, filter model and unison size do not, and envelope *times* do not either
— this codebase already learned that one, since re-reading an attack mid-note steps the amplitude.

**Design:** continuous parameters interpolate across the journey; structural ones switch once, at
the halfway point. It reads as a sweep with one change of character in the middle, which is
honest about what is happening rather than pretending a square wave can be 40% sawtooth.

The continuous/structural split must have **one owner**. The manifest already carries a
`structural` notion and the live-params rule already depends on the same distinction; whichever of
those is the real source, this reads it rather than writing a third list.

Source of values: `snapshotEngineParams`, which walks the parameters the engine *declares* rather
than a hardcoded list, and already skips the strip params because level and pan are the desk and
not the patch.

## Deliberately after this round

Ideas from the Ableton pass, parked whole rather than half-built. They are worth doing and none of
them is worth doing before the seven above, because every one of them adds surface to a panel
whose transport rules are not yet settled.

- **A `Voices` macro** — one control from monophonic to full chord, per lane. Seed's most useful
  parameter and WEAVE has no equivalent.
- **Chord Learn** — play the progression in on a keyboard and capture it. The input method that
  was declined before the chord track existed; cheap now that it does.
- **Per-role generators** — the `STYLE_KITS` of the arranger spec, which is what Live's Sting and
  Patterns amount to.
- **A four-control reduction** of the panel for playing rather than editing.

## Acceptance

Things a person checks, not tests passing.

1. ▶ on a session with three weaving lanes: all three sound, without touching a clip.
2. WEAVE off: silence. Not "the scene underneath".
3. Master lock on, flow at speed: nothing moves — except the chords, which keep walking. Same with
   a single lane's lock.
4. The evolution bar moves with the flow and reads the right chord; it stops when the lock is on.
5. Print under a four-bar progression: the printed clip is four bars and replays the lap.
6. A step row on a cutoff, transport running: the master spectrum moves on the step boundaries.
   With the transport stopped, the panel says why nothing is happening.
7. A lane with preset A → B: the sound travels, and the one structural jump lands mid-journey.
