# Modulation & Note FX

Every lane has two signal-processing layers that sit *before* its engine's audio output and *around* its note stream: **Modulators** shape sounds over time by continuously driving engine parameters, and **Note FX** transform the note events before they reach the engine. Both are per-lane and saved with the session.

![FM engine editor showing the MODULATORS and NOTE FX sections](images/engine-fm.png)
*The FM engine editor. The MODULATORS section (LFO1 + ADSR1) and the NOTE FX row are visible at the bottom of the panel.*

---

## Modulators

Open any lane's engine editor and scroll to the **MODULATORS** section. Press **+ LFO** or **+ ADSR** to add a modulator; you can add as many as you need. Each modulator appears as a card with its own controls, an **ON / OFF** toggle, and a **×** remove button.

### LFO

An LFO generates a periodic waveform that you route to one or more target parameters.

| Control | Description |
|---------|-------------|
| WAVE | Waveform shape: Sine, Tri, Sqr, or Saw |
| RATE | Free rate in Hz (0.01–40 Hz, default 4 Hz) |
| RATIO | Musical division for BPM-sync mode (e.g. 1/4, 1/8, 1/8T, 1/16.) |
| FREE / SYNC | Toggles between free-running Hz rate and BPM-locked ratio. In FREE mode the RATE knob is shown; in SYNC mode the RATIO selector replaces it. |
| POLARITY | **-1..+1** (bipolar, default) oscillates symmetrically around the param's centre. **0..1** (unipolar) only pushes the parameter upward. |
| TRIG | **Free** — the LFO phase runs continuously regardless of note triggers, like a classic analogue LFO. **Note** — phase resets on every note-on, so the LFO peak always lands at the start of each note. Hidden when scope is PER-VOICE (see below). |
| SCOPE | **Shared** — one LFO voice runs for the whole lane. **PerVoice** — an independent LFO is spawned for each played note and lives for the duration of that note. |

**Musical difference between Shared and PerVoice:** a shared LFO on a polyphonic lane makes all voices wobble together in phase — the whole chord breathes as one. PerVoice gives each note its own independent modulation cycle, so fast staccato chords shimmer individually rather than in unison.

### ADSR

An ADSR produces a classic Attack–Decay–Sustain–Release envelope that fires once on each note trigger and follows the note's gate duration. Its default scope is **PerVoice**, which is almost always what you want: every note gets its own independent envelope.

| Control | Range | Default |
|---------|-------|---------|
| A (Attack) | 1 ms – 2 s | 10 ms |
| D (Decay) | 1 ms – 4 s | 300 ms |
| S (Sustain) | 0 – 100 % | 70 % |
| R (Release) | 1 ms – 8 s | 300 ms |

You can switch an ADSR to **Shared** scope if you want a single envelope that re-triggers on each note but whose shape is not tied to any individual voice. In practice PerVoice is the natural choice for most envelopes.

### Destinations and depth

Below each modulator card's controls is a destination list. To route the modulator:

1. Select a target from the dropdown — it lists all automatable parameters for the lane's engine, plus any lane inserts, master inserts, and master sends (reverb, delay).
2. Press **+ Destination**. A new row appears showing the target name and a **DEPTH** knob (range –1 to +1, default 0.5).

The depth knob scales the modulator's effect. A value of 1.0 means the full output range of the modulator sweeps the full range of the destination parameter (in the parameter's native units). –1.0 inverts the modulation direction. Multiple destinations can share the same modulator at different depth values.

Remove a destination with its **×** button. Remove the whole modulator with the **×** on the card header.

---

## Note FX

The **NOTE FX** section sits directly below MODULATORS. Note FX processors intercept the lane's note stream before it reaches the engine, transforming which notes are played and when. Add a processor with **+ Arp** or **+ Chord**. Each processor shows an **ON / OFF** button and a **×** remove button.

Note FX are per-lane and persist with the lane's engine state. Loading a demo resets them to the demo's configuration.

### Arpeggiator

The Arp takes each held note and generates a rapid sequence of notes from it according to a scale and direction pattern.

| Control | Options / Range | Description |
|---------|-----------------|-------------|
| PATTERN | up, down, updown, random, cosmic | Direction of the arpeggio. **cosmic** adds occasional octave jumps and random steps for an unpredictable feel. |
| SCALE | major, minor, pentMinor, phrygian, chromatic | Scale from which arp notes are drawn, starting from the held root note. |
| RATE | free, 1/4, 1/8, 1/8t, 1/16, 1/16t, 1/32 | Step rate in musical divisions (BPM-synced), or free Hz. |
| OCT | 1–4 | Number of octaves the arp spans. Higher values cycle the scale across more octaves before repeating. |
| GATE | 0.05–1.0 | Fraction of the step interval during which each arp note is held. Lower values create a more staccato feel. |
| FREE Hz | 0.5–32 Hz | Rate used when RATE is set to *free*. |

The Arp fires as many notes as fit inside the original note's gate duration, so longer notes produce longer runs.

### Chord

The Chord processor replaces each incoming note with a chord built on that note as the root.

| Control | Options | Description |
|---------|---------|-------------|
| CHORD | maj, min, maj7, min7, sus2, sus4, dim | Chord voicing to generate |
| OCT | –2 to +2 | Octave offset applied to all notes in the chord |

All notes in the chord share the original note's timing and gate length.

---

## Automation

Loom records parameter automation in two ways:

**Real-time knob recording (Performance view):** in the session/I-O header row, make sure the REC mode selector beside **● REC** is set to **🎛 take** (the default), then press **● REC** to arm recording and press Play. While recording in take mode, every knob you move *and* every clip launch is captured as automation in the current take. Automation is written at a sub-step resolution derived from the BPM. Press **● REC** again to disarm. (The other two REC modes — **⏱ live** and **⚡ offline** — export WAV audio instead of recording automation; see [Transport](02-transport.md) for the unified REC group.)

**Per-clip envelopes (Session view):** each clip can carry automation lanes independent of the Performance take system. Open the inspector for a clip and scroll below the note editor to the automation section. Select a parameter from the dropdown and click the add button to create an envelope lane for that clip. The envelope draws a curve over the clip's length (in bars) and plays back each time the clip loops. Envelopes are stored alongside the clip's notes in the session file.

When you move a clip to a lane running a different engine, envelopes whose parameter ID no longer exists in the new engine are disabled automatically (they remain in the clip but do not play back until re-enabled or deleted).

---

*See also: [Engines](04-engines.md) for the parameters you can modulate, [Mixing & FX](07-mixing-and-fx.md) for lane inserts and master FX whose parameters also appear as modulation destinations, and [Transport](02-transport.md) for the REC button and Performance view.*
