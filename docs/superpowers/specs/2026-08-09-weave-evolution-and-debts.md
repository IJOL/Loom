# WEAVE: evolution switch, and the debts around it

**Status:** approved in conversation 2026-08-09. Plan: [2026-08-09-weave-evolution-and-debts.md](../plans/2026-08-09-weave-evolution-and-debts.md).

## Why

WEAVE has two jobs that were never separated, and the confusion between them is
the whole of this round.

One is **arranging by hand**: you pick two loops per lane, you move the master
fader, and the scene goes where you put it. Nothing moves unless you move it.

The other is **letting it run**: you set a speed and the scene keeps travelling
on its own, picking new material as it goes.

Today the panel does half of each. The master fader **folds 1 back to 0**, so
dragging it to the far end snaps every lane back to the loop it started from —
you arrive at scene 2 and land on scene 1. That fold exists for the second job
(a lap that never ends) and it is wrong for the first.

Worse, the two callers of the position writer disagree. The clock passes a
re-hook callback so that arriving promotes B to A and draws a fresh B; the
panel's own gesture passes five arguments where the clock passes six, so a hand
on the fader wraps **without** the promotion. That is the worst of both: you go
back to the start AND the pair never advances.

## What we are building

### 1. An EVOLVE switch, off by default

A two-state control in the flow row, beside Drift and Speed.

**STATIC (default).** The pair you chose is the pair you keep. The master fader
travels 0..1 and **stops at each end**. Nothing re-hooks, ever — not by hand,
not on the clock. This is what the panel does today minus the fold, and it is
the state a session is saved in unless the user says otherwise.

**EVOLVE.** Arriving at the far end is a handover: what was on the right becomes
the left, and new material arrives on the right. Arriving counts whether the
clock moved it or a hand did — the far end is the far end.

### 2. What EVOLVE draws, and in what order

- **Clips advance IN ORDER.** Clip 1 → 2, then 2 → 3, then 3 → 4, wrapping back
  to the lane's first clip. Never shuffled: a session's clips are an
  arrangement, and shuffling them is not evolution, it is noise.
- **Library loops are drawn AT RANDOM**, as they are today.
- **Empty clips are skipped.** This is why the current re-hook excluded clips
  entirely — the carrier clip a weaving track is born with has no notes, and
  landing the journey on it is silence with no way to tell why. Skipping the
  empty ones is the narrower rule that keeps the useful clips in.
- A lane whose clips run out falls through to the library, so a lane with one
  usable clip still has somewhere to go.

### 3. The debts this round also clears

**×2 and ÷2 per lane in WEAVE.** Asked for earlier and delivered to the clip
editor instead, which already had them. WEAVE gets the same two buttons on each
lane row, acting on the lane's carrier clip through `applyClipLength` — the same
function the editor calls, never a second implementation.

**Motion lands somewhere.** The macro writes to destinations whose id ends in
`.depth`, and the destination catalogue emits none: a modulator's depth is not
automatable in Loom at all. It becomes one. The depth knob already exists with
the id `<lane>.mod.<modId>.conn.<connId>.depth`; what is missing is the
catalogue entry and the apply branch. Every surface gains it at once — the XY
pad, clip automation, MIDI mapping, and Motion.

**The SOLO suspicion.** Soloing one lane appeared to take the master to silence,
twice, while measuring something else. Either it is real and it is a Loom bug
that has nothing to do with WEAVE, or the measurement was wrong. It gets
established one way or the other, and only fixed if real.

**One fix for short loops, not two.** A library pattern is one bar and a clip is
often two, so the fold left the clip's later bars empty. There are currently two
answers in the tree: a tiling pass inside `blendLoops` (committed) and passing
`clipBars` through to `patternNotes`, which has taken that argument since it was
written and whose own doc names this exact failure (stashed). The second is the
one to keep; the first is a second implementation of a solved problem, and it
infers a loop's length from its notes, which duplicates a two-bar clip that
deliberately has notes only in its first bar.

## What we are NOT doing

- Not touching Space, the step row, or the send rename. They shipped this
  morning and they stay.
- Not adding a third flow mode. Drift keeps its three.
- Not changing what the loop dropdowns offer: `weaveLoopChoices` already lists
  the lane's own clips first, under "This lane". That part was already right.

## Acceptance

Stated as things a person can check, not as tests passing.

1. Master fader hard right, STATIC, three lanes on Clip 1 / Clip 2: sounds the
   same as stopping WEAVE and launching scene 2. Measured by master peak and RMS
   in both cases, and listened to.
2. The same fader at 1.00 reads 1.00 on every lane, and the pair still reads
   `Clip 1 and Clip 2`. Today it reads 0 and snaps back.
3. EVOLVE on, arriving with clips: the pair becomes `Clip 2 and Clip 3`, then
   `Clip 3 and Clip 4`. With library loops: the arriving loop is never the one
   just left.
4. STATIC with a speed set: the scene travels and never re-hooks.
5. A lane row's ×2 doubles its clip's length; ÷2 halves it; the clip editor
   shows the same result.
6. Motion, moved off zero, changes the depth of every modulator in the session,
   and the modulation panel's own depth knob follows.
7. Soloing a lane leaves that lane audible. If it does not, that is a separate
   finding with its own fix.
