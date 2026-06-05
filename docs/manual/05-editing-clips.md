# Editing Clips

Every clip in Loom holds a sequence of notes. To edit those notes, click the **body** of any filled cell in the session grid (anywhere except the ▶ play icon). The inspector panel opens below the grid and the editor renders inside it. Closing the inspector does not stop playback — launching and editing are independent.

Melodic lanes (TB-303, Subtractive, FM, Wavetable, Karplus, Sampler) open the **piano-roll**. Drum-machine lanes and sampler lanes that have a drum kit loaded open the **drum-grid**. If you want to switch between the two views for a given clip, click the **↔ Editor** button in the inspector toolbar.

See [Sessions, Lanes, Clips & Scenes](03-sessions-lanes-clips-scenes.md) for how clips are organised, and [Engines](04-engines.md) for the controls each engine exposes.

---

## Piano-roll

![Piano-roll editor](images/inspector-piano-roll.png)

The piano-roll is a two-axis canvas: time runs left-to-right, pitch runs bottom-to-top. A vertical keyboard on the left names the rows; a time ruler at the top marks bars and beats.

### Zoom and pan

Scrub **vertically on the time ruler** to zoom the time axis; scrub **horizontally** on the ruler to pan. Scrub the **keyboard strip** vertically to zoom the pitch axis. The native scroll bars pan both axes. Zoom state is saved per clip and restored when you reopen it.

### Draw mode (pencil)

The default tool is **Draw**. Click an empty area of the grid to place a note at the snap resolution (default: 16th notes). Drag right while placing to extend its duration. Click and drag an existing note's right edge to resize it. Click and drag the body of a note to move it. Alt-click or right-click a note to delete it.

### Select mode

Click the **Select** tool button in the toolbar to switch. In Select mode, click a note to select it. **Drag on the grid background** to draw a marquee rectangle; every note whose body intersects the rectangle is selected. Click empty space to deselect all.

With notes selected you can:

- **Move as a group** — drag any selected note; the whole selection moves together and is clamped to the clip boundaries.
- **Delete** — press Delete or Backspace.
- **Nudge** — use the arrow keys to shift the selection one snap unit left/right or one semitone up/down.
- **Cut / Copy / Paste** — Ctrl+X / Ctrl+C / Ctrl+V (Cmd on Mac). Paste anchors the earliest clipboard note at the mouse cursor position, so move the pointer where you want the paste to land before pressing Ctrl+V.

The tool choice and clipboard contents persist across clip re-opens and across clips, so you can copy from one clip and paste into another.

### Computer-keyboard note input

When the piano-roll has focus you can record notes directly from the computer keyboard:

| Key row | Notes |
| ------- | ----- |
| `a s d f g h j k` (home row) — white keys | C D E F G A B C |
| `w e t y u` (upper row) — black keys | C# D# F# G# A# |
| `z` / `x` | Shift input octave down / up |

Pressing a key **auditions the note** immediately so you can hear it, advances the input cursor by one snap step, and **records the note into the clip** at the cursor position. Duration equals one snap step (quantised on key-up). This lets you step-enter a melody quickly without a MIDI controller.

---

## Drum-grid

![Drum-grid editor](images/inspector-drum-grid.png)

The drum-grid is a canvas editor where rows correspond to drum voices (kick, snare, hi-hat, etc.) and columns correspond to time positions. Each hit is placed at a precise tick within the clip.

### Grid resolution

A resolution selector at the top of the editor sets the snap and the column width. Available resolutions are:

| Value | Description |
|-------|-------------|
| 1/4   | Quarter notes |
| 1/8   | Eighth notes |
| 1/8T  | Eighth-note triplets |
| 1/16  | Sixteenth notes (default) |
| 1/16T | Sixteenth-note triplets |
| 1/32  | Thirty-second notes |
| free  | No snap — place hits at any tick |

You can mix resolutions across clips; each clip stores its own `gridResolution` setting.

### Placing and removing hits

Click an empty cell to place a hit. Click an existing hit to remove it. In **free** mode, click anywhere in the row — the hit lands at the exact tick under the pointer with no snapping.

### Selection and group operations

Drag on the canvas background to draw a marquee rectangle. Hits whose row and time position intersect the rectangle are selected. With a selection active:

- **Move** — drag horizontally to shift selected hits in time; the group is clamped to the clip length.
- **Move rows** — drag vertically to reassign hits to different drum voices; the relative row offsets are preserved and clamped to the available voice list.
- **Delete** — press Delete or Backspace.
- **Cut / Copy / Paste** — Ctrl+X / Ctrl+C / Ctrl+V. Paste anchors the earliest hit at the click position (tick × row), preserving relative offsets within the group.

Selection, clipboard, and group-move all operate on **row indices**, not MIDI numbers, so patterns copy cleanly even between kits that map voices to different MIDI notes.

### Playhead

A vertical playhead line moves across the canvas in real time while the clip is playing, driven by the sequencer's look-ahead clock. It updates on every redraw tick and resets to the left edge when the clip stops.

---

## Loop regions

A **loop brace** sits above every clip editor — piano-roll, drum-grid, and sample/slice editors — as a narrow strip spanning the full clip length. It lets you mark an A–B sub-region and repeat just that portion while the clip plays.

### Setting the loop region

The brace strip has two drag handles (left = A, right = B) and a **Loop** toggle button. To use it:

1. Click **Loop** to enable the loop region. The region highlights between the A and B handles; if no region was set before, it defaults to the full clip length.
2. Drag the **left handle** to move the start point (A). Drag the **right handle** to move the end point (B). Both handles snap to 16th-note grid positions.
3. While the clip is playing, the scheduler repeats only the A–B sub-region — the rest of the clip is skipped.

Click **Loop** again to disable it. The clip reverts to playing its full length; the A and B positions are remembered so you can re-enable the same region later.

### What the loop brace affects

The loop region works the same way for all clip types:

- **Note clips (piano-roll)** — only notes whose start falls within the A–B range are triggered; the period of repetition equals the duration of that range.
- **Drum clips (drum-grid)** — same: only hits inside the sub-region fire.
- **Audio / slice clips (Sampler)** — the corresponding fraction of the audio buffer plays, still tempo-locked and pitch-preserving.

The loop region is **per-clip** and saved with the session. Two clips in the same lane or scene can each have their own independent A–B region, or none at all.

All loop-region edits (moving handles, toggling) are part of the global undo history (Ctrl+Z / Cmd+Z).

For how to use an arrangement-wide A–B loop brace that repeats a section across all lanes at once, see [Performance & Arrangement](10-performance-and-arrangement.md).

---

## Loop / slice editor

When you import an audio file using **Import as loop** in the Sampler engine (see [MIDI & Samples](08-midi-and-samples.md)), Loom creates a special slice clip on the lane. Clicking the body of that clip opens the **loop / slice editor** instead of the piano-roll or drum-grid.

### When the editor appears

The loop editor opens for any Sampler clip that was imported as a loop and has at least one slice region. Clips imported via the normal drag-and-drop or file picker (keymap mode) continue to open the piano-roll.

### The waveform and slice grid

The editor shows two main areas stacked vertically:

- **Waveform strip** — a peak-waveform view of the full audio buffer. Orange vertical lines mark each slice boundary, so you can see at a glance where the loop is divided.
- **Slice grid** — one row per slice, labelled S1, S2, … Each row represents one region of the audio. A note event in the grid triggers that slice region at the right moment during playback; notes can be moved, copied, or deleted just like drum-grid hits (draw mode by default; switch to select mode with the **2** key, back to draw with **1**).

A live playhead line scrolls across both areas while the clip is playing.

### How slices are detected

When the file is imported, Loom reads any embedded tempo and slice metadata first — **Acid chunks**, WAV **cue markers**, or **AIFF MARK markers**. If none is found, it falls back to onset detection (energy-based peak picking) followed by an autocorrelation tempo estimate that is snapped to the nearest whole-bar interpretation, keeping the result in the 70–180 BPM range. The toolbar shows the detected (or embedded) **BPM** and the **bar count** for the clip, plus how many slices were found. You can click the BPM readout to correct it manually if the detection was wrong.

### Tempo-lock (slice-and-retrigger)

By default the loop plays in **slice** mode: each slice region is retriggered on the sequencer grid at the project BPM. Because the timing is driven by note events on the grid rather than by stretching the audio, pitch is completely unchanged regardless of how far the project BPM is from the loop's original tempo. The **Grid resolution** selector sets the snap for placing and moving notes in the slice grid.

### Warp mode toggle

The **Warp ON / OFF** button and the adjacent mode selector let you switch between the two playback strategies:

- **Warp OFF** — the loop plays as a normal one-shot sample (no tempo sync). Use this if you want the audio at its natural speed with no grid interaction.
- **Warp ON, mode = slice** (default) — slice-and-retrigger as described above. Best for rhythmic loops (drums, percussion, arpeggiated bass) where you want crisp, pitch-stable playback and the freedom to edit individual hits.
- **Warp ON, mode = stretch** — the entire buffer is time-stretched offline (OLA / WSOLA) to match the project BPM and played as a single region. Use this for sustained material (pads, vocals, melodic loops) where maintaining the continuous texture matters more than edit access to individual slices. The stretched buffer is cached; it is re-rendered automatically when the project BPM changes.

All changes in the loop editor are undoable (Ctrl+Z / Cmd+Z).

---

## Velocity & dynamics

![Piano-roll with velocity lane](images/inspector-piano-roll.png)

Above: piano-roll editor. The strip beneath the note grid is the velocity lane — one vertical bar per note, height proportional to velocity.

Every note in Loom carries a **velocity** value from 0 to 127. Velocity is set when you draw a note (default: **90**), adjusted in the velocity lane, and captured automatically from MIDI import. It affects the sound in two complementary ways:

- **Loudness** — velocity scales the note's output gain continuously via a smooth curve (`velToGain`). A velocity of 1 is near-silent; 127 is the loudest a note can be. Notes at the default of 90 sit just above the mid-point of the range, so there is clear headroom in both directions.
- **Accent character** — notes with velocity **≥ 100** are accented. On top of the continuous gain, accent adds character to the sound: on bass-style engines (TB-303, Subtractive) it brightens the filter envelope and raises the resonance Q; on drums it increases brightness. This is the same accent model that the 303 bassline and drum sequencer have always used, now unified into the velocity scale.

### Reading velocity visually

Each note's **fill colour** shifts along a **blue → yellow** ramp as its velocity increases. Low-velocity notes are deep blue; high-velocity notes are warm yellow. The transition is weighted so the blue half of the range covers roughly velocities 0–64 and the yellow half covers 64–127. Accented notes (≥ 100) are additionally outlined with a **white border** — colour alone does not distinguish accent from non-accent.

### The velocity lane

Below the note grid (piano-roll) or the drum-voice rows (drum-grid) is the **velocity lane**: a row of vertical bars, one per note, anchored at the note's start position. Bar height is proportional to velocity. A **dashed horizontal line** across the lane marks the accent threshold (velocity 100) so you can see at a glance which notes are accented. The lane scrolls horizontally in sync with the grid.

### Editing velocities

You interact with the velocity lane by dragging the bars:

- **Set a single note** — drag a bar up or down. The velocity updates live; the note colour and audible gain change as soon as you release.
- **Adjust a group** — if you have notes selected (marquee selection in the main grid), dragging any bar that belongs to the selection applies the **same delta** to all selected notes. Notes that would go out of range are clamped to 1–127.
- **Paint a ramp** — drag horizontally across multiple bars. Each bar you pass over is set to the velocity corresponding to the current vertical position of the pointer, writing a smooth velocity ramp across the passage in a single gesture.

When several notes share the same start position (a chord), their bars are fanned a few pixels apart in the lane so each one remains individually grabbable.

All velocity edits are undoable (Ctrl+Z / Cmd+Z) in the same undo history as note placement and movement.
