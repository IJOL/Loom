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
