# Getting Started

## Open the app

Loom runs entirely in the browser — no installation, no account, no plugins.

- **Live demo:** <https://ijol.github.io/Loom/>
- **Run locally:** clone the repository, then run `npm install` followed by `npm run dev`. The app is available at <http://localhost:5173>.

## Make your first sound

When the app opens it loads the *Minimal Techno* demo automatically, so there is already a full arrangement ready to play.

1. Click the **▶ Play** button in the transport bar. The first click resumes the browser's AudioContext — this is a browser requirement; audio cannot start without a user gesture, so nothing plays until you press Play.
2. Sound starts immediately. Use the **Volume** slider in the transport to adjust the output level.
3. Want to hear a different demo? Select one from the **— load a demo —** dropdown (Minimal Techno, Acid Rain, Cordillera, Neon Drive). The session loads and begins at the first scene.

![Loom with the Minimal Techno demo loaded and the session grid visible](images/app-overview.png)

*The full Loom interface. Transport across the top; coloured clips in the session grid; per-lane channel strips below.*

## The menu bar

Across the very top sits a desktop-style menu bar. Most of what it offers also has a button somewhere in the interface — the menu is the tidy, discoverable route to the same things, and the place to look when you can't remember where a control lives.

**File**

| Item | Shortcut | What it does |
| --- | --- | --- |
| New Session | `Ctrl+N` | Empties the session and starts fresh |
| Open… | `Ctrl+O` | Opens the save manager to load a stored session |
| Save | `Ctrl+S` | Opens the save manager to store the current session |
| Save As… | | Same panel, for storing under a new name |
| Project Options… | | Project-wide settings, including the name and the musical key/scale |
| Open Demo ▸ | | A submenu of the bundled demos; picking one loads it |
| Import MIDI… | | Opens the MIDI import flow ([chapter 8](08-midi-and-samples.md)) |
| Separate into Stems… | | Opens stem separation ([chapter 8](08-midi-and-samples.md)) |
| Preferences… | `Ctrl+,` | **Not yet available** — greyed out, planned for a later release |

**Edit** — **Undo** (`Ctrl+Z`) and **Redo** (`Ctrl+Shift+Z`, or `Ctrl+Y`). Both grey out when there is nothing to undo or redo, so the menu doubles as an indicator of whether your last action was recorded.

**View** — switches between the **Session** and **Performance** views, with a tick marking the current one, and toggles the **Performance diagnostics (PERF)** overlay (audio load, scheduler lag, FPS, voice counts).

**Tools** — opens the **MIDI Controller** panel, runs **Capture Scene** (`Ctrl+I`, snapshots the currently playing clips into a new scene) and **Copy Scenes → Performance**.

**Help** — opens this **Manual** in a new tab, and **About Loom**.

Sessions are stored in your browser, not as files on disk: "Open" and "Save" mean the in-browser save manager, described in [chapter 9](09-saving-and-export.md).

## The mental model

Loom organises music in three nested concepts:

- A **lane** is an instrument track. Each lane runs one engine — six melodic ones (TB-303, Subtractive, FM, Wavetable, Karplus-Strong, West Coast), the Sampler, the Drum Machine, or an Audio channel for playing a recording — and has its own mixer strip with EQ, sends, pan, and fader.
- A **clip** is a pattern of notes that lives in a lane. A lane can hold multiple clips — one per scene row.
- A **scene** is a horizontal row across all lanes. Launching a scene fires the clip in each lane at that row simultaneously, so scenes work like song sections or loop variations.

![The session clip grid showing four lanes across four scenes with coloured clips](images/session-grid.png)

*The session grid: lanes run left to right as columns, scenes top to bottom as rows. Click a clip to select it; click the scene launch button on the right to fire the whole row.*

Click any clip cell to open its editor in the inspector below the grid. The editor shows a piano roll for melodic lanes and a drum grid for drum lanes.

## Next steps

- [Transport](02-transport.md) — BPM, meter, swing, and the unified REC controls (take / live-WAV / offline-WAV).
- [Sessions, Lanes, Clips & Scenes](03-sessions-lanes-clips-scenes.md) — how to build and arrange your own session from scratch.
