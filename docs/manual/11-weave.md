# WEAVE

**WEAVE** is a third view, beside Session and Performance. Where the Session grid launches clips you wrote, WEAVE **crossfades between loops** — and keeps crossfading, on its own, for as long as you let it. A scene made in WEAVE is not a fixed arrangement; it is one that keeps finding new material while you steer it.

Open it from the view toggle in the transport bar. WEAVE is a **panel plugin**: it ships in `plugins/weave/` and is loaded at runtime like any engine or insert, which means it can be absent from a build without the rest of the app noticing.

---

## The idea in one paragraph

Every track in WEAVE plays a **blend of two or more loops** instead of its own clip. Where the blend sits is a position you can move by hand or leave to the master flow. The two loops never simply alternate: what they SHARE stays put — that shared skeleton is what holds the bar together — and what differs hands over gradually. Melodic material is blended in **scale degrees**, so a crossfade cannot detune; it can only move between notes that are in the key.

You are never editing the loops. WEAVE is a tool that sits ON TOP of the session: switch a track's weave off and its clip is exactly as you left it.

---

## The track row

Each track is one row, split into two lines. The top line is what a hand reaches for while the music runs; the second line is what you set once and leave.

**Top line, left to right:**

- **VU meter** — what the track is putting out, the same meter the mixer column shows. It keeps reading with the transport stopped, because a held note or a reverb tail is still sound.
- **Loop ring** — where this track is in its bar, and how long is left of a queued change.
- **Name**, then **▶ ■ M S 🔒** — launch, stop, mute, solo, and **lock**. A locked track holds the loops it has while everything else travels. Mute and solo are the mixer's own, not a second pair.
- **Level** — the same gain as the mixer column, with its percentage beside it.
- **Topology** — how this track weaves. See below. The blank entry, `— off —`, returns the track to simply playing its clip.
- **The weaving control itself** — a dial, a queue or a square, depending on the topology.
- **◐ Sound** — off by default. See *Playing one part on several instruments*.

**Second line:** the note bar this track is about to play, then which slot (on a rack), instrument, preset, part, style shelf, half/double time, and octave.

---

## Topologies — how a track weaves

Pick one per track from the dropdown.

### A→B

Two loops and a dial between them. When the dial reaches the far end, **B becomes the new A and a fresh loop is drawn for B** — so the journey never ends and never returns to where it began.

The control is an **endless dial**, not a fader, and it is dragged **up and down**. A dial rather than a fader because a fader promises two ends, and with the scene evolving there are none.

The names sit either side as *from → to*.

### Cloud

Four loops, one in each corner of a square, and a dot you drag. An edge behaves like a plain two-loop crossfade; the middle is the one place all four sound at once.

A cloud walks its lap along a **path**, because the master flow is one number and a square is two:

- **RIM** — the four sides. The dot spends its whole lap on an edge, so every corner arrives as a clean handover.
- **CROSS** — side, diagonal, side, diagonal. The same four corners, but it crosses the middle twice a lap, alternating clean handovers with everything piling up.

A cloud evolves too: each lap swaps out **the corner the dot is furthest from** — the one nobody is hearing — so four laps renew the whole square, one corner at a time.

### Queue

An ordered list with a cursor, always crossfading between the two entries it sits between. Finite where A→B is endless, but walkable backwards. It is no longer offered in the dropdown; a saved track already on it keeps working.

---

## The master flow

The header controls move every unlocked track at once.

- **Flow** — the master dial, and a readout of where the scene is.
- **Drift** — whether the tracks travel together or fan out.
- **Speed** — how long one full journey takes, in bars. **Off** by default: a panel that started travelling the moment you opened it would change a session you had not touched.
- **EVOLVE / STATIC** — what happens at the END of a lap. **STATIC** is a scene you place by hand and it stays placed. **EVOLVE** draws fresh material on arrival, which is what makes a scene keep moving.
- **Journey** — **One way**, or **⇄ N laps**: how many laps out before the journey turns round and comes back. Going out it draws new loops; coming back it walks the ones it already played, so the way home is the same journey in reverse rather than a different one.
- **🔒 HOLD** — freeze the arrangement. The chord walk keeps going and the step rack keeps writing; only the loops stop moving.
- **SURGE** — held, not toggled: a momentary push that restores itself when you let go.
- **⟳ Reshuffle** — **tap** to re-deal only the loop you are NOT hearing, which is why it is safe mid-phrase; **hold** it to re-deal every loop at once. A locked track ignores both.

---

## What each track PLAYS — parts and shelves

A track's **part** decides which material it draws and in which register: **Bass**, **Comp**, **Pad**, **Arp** or **Melody**. Leave it unset and the track behaves as it always did. An engine can declare its own default — a TB-303 lane comes out as bass whether or not you mark it.

- **Bass** and **Melody** read the pattern library, at their own octave.
- **Comp**, **Pad** and **Arp** read **no** library at all. Their material is GENERATED as chords, because a chord written as fixed semitones cannot stay in key across the eight scales a session may be in. What you pick for them is a **shape** — the rhythm and the voicing — and the notes follow the session's key, scale and chord progression.
- Marking a track **Arp** also gives it an arpeggiator. Unmarking it does not take the arpeggiator away: by then it is a card with your settings on it.

**Style** picks which shelf of the library this track draws from, independent of the session's own style. A style change lands on the **next** loop drawn, not the one playing — changing it mid-phrase would be a splice, not an evolution.

**Half and double time** (`×2` / `÷2`) and the **octave** (`− +`) both live on the weave, never on the clip. The phrase is always delivered whole: half time stretches it and takes the room it needs.

---

## Playing one part on several instruments

The **◐** button is a second axis: the weave decides which NOTES play, this decides **what they are played on**.

Turning it on builds what it needs — the track becomes a **rack** of instruments, its own sound in the first slot and others alongside, each on its own preset. The control then wears the shape of that track's loop control: a **fader** on A→B, a **square** on a cloud. Off, it collapses back to just the button.

Without it, each note plays on the instrument of the loop it came from. With it, every note reaches every instrument and the control balances them. Either the loop chooses the instrument or you do — never both.

The `1 2` buttons on the second line pick which slot the instrument and preset dropdowns are pointing at.

---

## The chord progression

Every chordal track follows one progression, walked across the session's bars and shown as a bar with the current chord in Roman numerals. Pick a catalogue entry, or edit the strip and it becomes yours — the catalogue is never written to. "Stay home" is a single chord and no journey.

---

## The macros

Six knobs colour everything at once. **Density** and **Energy** rewrite notes; **Space** and **Motion** move parameters; **Darkness** chooses the scale the blends walk, and **Style mix** decides how far a track may stray from the session's style. At their neutral positions they say nothing at all.

---

## PRINT — keeping what you heard

**PRINT** freezes what the weave is playing into a new scene: a full lap of the chord progression, laid end to end, as ordinary clips you can edit. It is an output, never the goal — the weave carries on folding either way.

> **Known limitation.** A track that is still weaving plays its weave, not its clips — so launching a printed scene on a track that is still weaving plays the weave. Switch that track's topology to `— off —` to hear what was printed.

---

## Two things worth knowing

**A scene does not choose what a weaving track plays.** On a track with loops chosen, launching a scene decides only *whether* it sounds. What it sounds is the weave's own selection, the same in every scene — including a scene of empty clips.

**Nothing here is undoable.** A weave move is deliberately not an undo entry; it is a performance, not an edit. It IS saved with the session, and it nudges the autosave when it moves.
