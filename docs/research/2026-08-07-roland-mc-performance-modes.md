# Roland MC series — performance modes, read against Loom

**Date:** 2026-08-07
**Why:** WEAVE ([spec](../superpowers/archive/specs/2026-08-07-weave-panel-dinamico-design.md)) and the
arranger ([spec](../superpowers/archive/specs/2026-08-10-auto-accompaniment-design.md)) are both about
making a scene move while it plays. Roland's groovebox line has been solving that exact problem
since 1996, and its answers are a catalogue of *primitives*, not of features. This report
extracts the primitives and marks, for each, what Loom already has and what is missing.

Sources are listed at the end. Where a claim could not be verified from a primary source it is
marked **[unverified]** rather than smoothed over.

## The four generations in one line each

| Machine | Year | The live idea it added |
| --- | --- | --- |
| **MC-303** | 1996 | Everything is changeable *while it plays*: pattern, key, feel, filter, who is muted |
| **MC-505 / D2** | 1998 | Fire a phrase *over* the running pattern (RPS), and a gestural controller (D-Beam) |
| **MC-909** | 2003 | Note generators as first-class: arpeggiator, chord memory, a 440-phrase RPS library |
| **MC-707 / MC-101** | 2019 | Clips and scenes (Ableton-shaped), plus momentary destruction (Scatter, Step Loop) |

The through-line: **each generation moved more of the arrangement out of "decided beforehand"
and into "decided now, with your hands, without stopping".** That is the same sentence as WEAVE's
problem statement.

## The primitives

### 1 · Instant recall of material

MC-303 **PATTERN SET**: 16 patterns assigned to the keyboard pads, 30 such sets stored. One
keypress selects the next pattern. MC-707: 8 tracks × 16 clips = 128 clips, one pad per clip.

**Loom today:** the Session grid is this, and better — clips are per-lane and launchable
individually. Nothing missing.

### 2 · Switch timing — the "NEXT" display

On the MC-303, turning the VALUE dial during playback puts the choice in the **NEXT** display;
when the current pattern finishes, NEXT becomes CURRENT and playback switches. You always see
what is coming before it arrives. On the MC-707 this became a quantize *value*: per-clip
quantize 0–100%, per-clip swing, and a master quantize that **overrides the clip's when it is
higher**.

**Loom today:** stronger than the MC-303 and comparable to the 707 —
`effectiveQuantize(state, lane, clip)` resolves clip → lane → global
([session-runtime.ts:104](../../src/session/session-runtime.ts#L104)), and the countdown ring
shows the wait. The one difference is direction: the 707's master overrides the clip when
*higher*; Loom's clip always wins. Neither is obviously right.

### 3 · A scene is a snapshot, not a row

This is the sharpest architectural difference. On the MC-707 a Scene is a snapshot of *which
clips are playing together* — and, crucially, **they need not all be on the same row**. Eight
scenes, captured by long-pressing a scene button at any time, running or stopped.

**Loom today:** a scene *is* a row. You cannot capture "lane 1's clip 3 + lane 2's clip 7" as a
launchable unit without duplicating clips into a common row.

**Gap, and it is a real one.** Loom's Capture Scene exists but writes a row. A snapshot-shaped
scene would make WEAVE's **Fijar** cheaper (it would capture references, not print notes) and
would let the arranger's sections be re-mixed across each other.

### 4 · Chaining — the machine advances by itself

MC-303 **Song mode**: a sequence of up to 999 patterns, switching on measure boundaries,
recordable in realtime simply by switching patterns while it plays. MC-707 added **Clip Chain**
(v1.30) and **Scene Chain** (v1.07) as firmware updates — the sequence of scenes to walk
through. **[unverified: the exact step semantics of Scene Chain — how many steps, whether a
step declares a repeat count, and what happens when you launch manually mid-chain. The Roland
update PDFs did not yield text.]**

**Loom today:** the Performance/arrangement view records and replays clip launches, which is
Song mode by another name. What it does **not** have is the short, hand-built, looping chain —
"intro once, A four times, B twice, back to A" as a small editable list rather than a recorded
timeline.

**This is the answer to the Fill problem** the arranger spec cut. See §11.

### 5 · Subtractive performance: mute is an instrument

MC-303 has two tiers. **Part Mute** silences melodic parts 1–7 or the whole rhythm part. Then,
*inside* the rhythm part, a second tier mutes by **instrument type** — kicks, snares, hats,
claps, cymbals, toms/perc, hits, other — storable with the pattern or thrown live.

**Loom today:** per-lane mute/solo only (`createMuteSolo`,
[src/app/mute-solo.ts](../../src/app/mute-solo.ts)).

**Gap:** there is no way to drop just the hats of a drum lane while it plays. Loom has the data
for it — `DRUM_LANES` in [src/core/drums.ts](../../src/core/drums.ts) already names the voices —
so this is a small, high-value feature that is independent of both WEAVE and the arranger.

### 6 · Continuous hands, and recording them

MC-303 **Realtime Modify (RTM)**: LEVEL, PANPOT, LFO RATE, LFO MOD, CUTOFF, RESONANCE, ENV
ATTACK/DECAY/RELEASE — turned during playback, and the movements are recordable as "modify
data". MC-707 **Motion**: the same idea, but capped at **three parameters per track** (the ones
assigned to the knobs), with an editable event list afterwards.

**Loom today:** ahead of both. Any destination in the registry can be automated, recorded and
painted, and the cap does not exist. Worth noting only because the 707's three-knob limit is a
*deliberate* interface choice — the constraint is what makes it playable. WEAVE's six macros are
the same bet.

### 7 · Feel as a live knob

MC-303 **Play Quantize**, adjustable per part *during playback*: **grid** (snap to a
resolution), **shuffle** (swing amount) and **groove** (preset feel templates), with STRENGTH
and VELOCITY amounts. Turning one knob re-feels a running pattern.

**Loom today:** global swing on the transport. Groove templates and per-lane, live, strength-
scaled quantize do not exist.

**Direct feed into WEAVE:** its metric-weight table
([src/weave/metric-weight.ts](../../src/weave/metric-weight.ts)) is the same kind of object as a
groove template — a per-position weighting. A "Groove" macro is nearly free once that table is
shared.

### 8 · Global transpose, live

MC-303: press TRANSPOSE, shift −24…+24 semitones, freely, during playback.

**Loom today:** absent as a live control. The arranger spec adds `transposeNotes` as an *edit*;
a live transpose that offsets everything at schedule time is a different, cheaper thing, and it
composes with the degree-based chord track for free.

### 9 · Momentary destruction — the primitive Loom does not have at all

MC-707: **Scatter** (16 stored combinations of step-loop, pitch-shift, reverse and insert FX,
triggered *momentarily* from pads, and assignable to individual steps within a measure);
**Step Loop** (hold SEL + a step button and that step repeats); held shortcuts that momentarily
reverse or randomise the sequence.

Every one of these is **held, not toggled**. You break the music, and letting go restores it
exactly. There is no state to undo, so there is nothing to be afraid of — which is precisely why
they are playable.

**Loom today: nothing is momentary.** Every performance gesture is a state change: launch a
clip, set a knob, mute a lane. This is the single biggest missing primitive in the whole report,
and it is missing at the *architecture* level rather than as a feature gap.

### 10 · Note generators over a running pattern

- **MC-303 arpeggiator** — 34 styles (note-value styles plus PORTAMENTO, GLISSANDO, SYN BASS,
  RHYTHM GTR, PIANO BACKING…), tempo-synced to the pattern, with ACCENT RATE (0–127) and OCTAVE
  RANGE (−4…+4).
- **MC-505 / MC-909 RPS** (Realtime Phrase Sequence) — trigger a stored phrase from a pad and it
  plays *in sync with* the running pattern. The 909 ships 440 factory phrases and lets you assign
  16 to pads; the phrase's playback timing is specified so it aligns rather than starting raw.
- **MC-909 Chord Memory** — 64 preset + 128 user chord shapes; one key plays a voicing.

**Loom today:** the arpeggiator exists as a per-lane note-FX, and `chord` is one too. **RPS does
not exist**: there is no way to fire a one-shot phrase *over* what is playing without it becoming
the lane's clip.

Note the 909's constraint, which is a design lesson rather than a limitation: **Chord Memory and
the Arpeggiator cannot be used at the same time as Pattern Call or RPS.** Roland shipped mutually
exclusive note generators rather than defining what their combination means. Loom's note-FX chain
does compose them, which is more general — but it is worth knowing that the people who shipped
this decided the combination was not worth defining.

## What to steal, ranked

| # | Steal | For | Cost | Why it is worth it |
| --- | --- | --- | --- | --- |
| 1 | **Momentary gestures** (§9) | WEAVE | Medium — needs a "hold" concept in the scheduler | Turns WEAVE from a set of sliders into an instrument. Nothing else on this list changes the feel as much |
| 2 | **A short looping section chain** (§4) | Arranger | Small | Solves the Fill auto-return that the spec cut. See §11 |
| 3 | **Live Play Quantize / groove templates** (§7) | WEAVE | Small — the weight table already exists | A seventh macro, almost free, and it is the one that makes a loop sound human |
| 4 | **Per-drum-voice mute** (§5) | Loom generally | Small | Independent of both specs; the data is already there |
| 5 | **Snapshot scenes** (§3) | Both | Medium–large | Makes WEAVE's Fijar cheap and lets sections be recombined. Touches the session model, so not first |
| 6 | **Live global transpose** (§8) | Both | Small | Composes with the degree-based chord track |
| 7 | **RPS — one-shot phrase over the mix** (§10) | WEAVE | Medium | The natural home for the arranger's Fill material |

## §11 · The Fill problem, solved by the MC

The arranger spec cut auto-return-after-a-Fill because Loom's scene runtime has no "launch B,
then come back". The MC line solved it twice, in two different registers, and **the second answer
is better than the one I cut**:

- **As a chain (§4):** the Fill is a step in a list that declares how many bars it lasts, and the
  chain moves on by itself. This is the arranger's structure playback.
- **As a momentary gesture (§9):** the Fill is not a scene at all. You *hold* it, the fill plays,
  you let go and the groove is exactly where it was. No return logic, because nothing ever left.

The second framing is the one to build. A momentary fill needs no state machine, no "previous
scene" memory, and no interaction with the queued-launch path — which is precisely why the MC-707
put Scatter and Step Loop on held buttons rather than on toggles.

## What not to steal

- **The three-parameters-per-track motion cap.** It is a hardware knob count, not a design
  insight. Loom's destination registry is strictly better.
- **Mutual exclusion between note generators** (§10). Loom's note-FX chain already composes them;
  going backwards would be a regression.
- **Pattern-set banks.** The Session grid already does this with fewer keypresses.
- **The D-Beam.** A gestural sensor has no browser equivalent worth faking; the XY pad is the
  honest translation and it exists.

## Open questions for a later pass

- Scene Chain / Clip Chain exact semantics on the MC-707 (§4) — needs the update manuals in a
  readable format, or the machine.
- Whether the MC-707's "master quantize overrides when higher" rule beats Loom's "clip always
  wins" (§2). Worth a decision, not a guess.
- How RPS phrases handle a phrase longer than the bar it was fired in — does it truncate, or
  overhang? Relevant to §10 and to any Loom equivalent.

## Sources

- [Roland MC-303 Owner's Manual (archive.org full text)](https://archive.org/stream/synthmanual-roland-mc-303-owners-manual/rolandmc-303ownersmanual_djvu.txt)
- [Roland MC-303 Quick Start Guide (archive.org full text)](https://archive.org/stream/synthmanual-roland-mc-303-quick-start-guide/rolandmc-303quickstartguide_djvu.txt)
- [Sound On Sound — Roland MC303 review](https://www.soundonsound.com/reviews/roland-mc303)
- [Roland support — MC-303: Modifying a Sound in Realtime](https://support.roland.com/hc/en-us/articles/201940359-MC-303-Modifying-a-Sound-in-Realtime)
- [Roland MC-505 product page](https://www.roland.com/us/products/mc-505/)
- [Roland MC-505 external-control PDF](http://cdn.roland.com/assets/media/pdf/MC505ext.pdf)
- [Sound On Sound — Roland MC-909 review](https://www.soundonsound.com/reviews/roland-mc909)
- [Roland MC-909 Owner's Manual (PDF)](http://cdn.roland.com/assets/media/pdf/MC-909_OM.pdf)
- [Sound On Sound — Roland MC-101 & MC-707 review (p.2)](https://www.soundonsound.com/reviews/roland-mc-101-mc-707?page=2)
- [MusicTech — Roland MC-707 review](https://musictech.com/reviews/hardware-instruments/roland-mc-707/)
- [Roland — MC-707 Scene Chain update (PDF)](https://static.roland.com/assets/media/pdf/MC-707_update_eng07_W.pdf)
- [Roland — MC-707 Clip Chain update, v1.30 (PDF)](https://static.roland.com/assets/media/pdf/MC-707_update_eng03_W.pdf)
