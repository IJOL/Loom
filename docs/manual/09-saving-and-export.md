# Saving & Export

Loom keeps everything in the browser. There is no account, no cloud, and no server upload — your sessions live in your browser's `localStorage` and on your own filesystem when you export them. This chapter covers how to save and restore sessions, undo your work, and render a scene to a WAV file.

---

## Sessions in the browser

Every parameter, every lane, every clip, and every scene is part of the current session. Changes take effect immediately; nothing is auto-committed to disk. When you close the tab, the browser preserves the last-saved state via an autosave entry in `localStorage`, so reopening Loom typically drops you back where you left off.

Three buttons on the session bar (the second header row) drive session management:

| Button | What it does |
| --- | --- |
| **🗋 New** | Discards the current session and starts a blank, empty one (tooltip "Nueva sesión vacía"). |
| **Save** | Opens the Save Manager with the name field ready to type. |
| **Load** | Opens the Save Manager to browse and restore a saved session. |

See [Transport](02-transport.md) for the full two-row header layout (transport & tempo on top, session & I/O below).

---

## Save Manager

![Save Manager dialog](images/save-manager.png)

Clicking **Save** or **Load** opens the Save Manager modal. It is the single place where all session persistence happens.

### Saving a session

Type a name in the text field at the top and click **Save current** (or press Enter). Loom writes the full session state — BPM, time signature, every lane's engine + inserts + clips + scenes, the mixer state, and the arrangement take if one exists — into `localStorage` under a unique key, and also updates the autosave slot. The entry appears in the list immediately.

The save format is versioned (`schemaVersion: 3`). When you load an older file Loom migrates it automatically; saves with an unrecognised schema version are rejected with a warning rather than loading broken state.

### The saved-session list

Each row in the list shows the session name, date/time, and size in KB. Per entry you can:

- **Load** — restores the session and closes the modal.
- **⤓** (download) — exports the entry as a `.json` file to your filesystem without closing the modal.
- **✎** (rename) — prompts for a new name in place.
- **🗑** (delete) — confirms and removes the entry.

The topmost row is **Auto-save (latest)**, which always reflects the state at the time of the last named save.

### Load from file…

Imports a `.json` file you previously downloaded (or received from someone else). Loom validates the schema before applying it; an invalid file shows an alert.

### Clear all saves

Removes every named entry from `localStorage`. The autosave slot is preserved. A confirmation dialog appears before anything is deleted.

### Storage readout

The footer shows the total size of all named saves, so you can keep an eye on `localStorage` usage.

---

## Undo / redo

Loom keeps a global undo history that covers **every** session mutation: adding or removing lanes, clips and scenes, editing notes in the piano roll or drum grid, moving or tempo-scaling clips, changing engine parameters via knobs and faders, and inline renames. You can step backwards and forwards from the header buttons or from the keyboard.

**Header buttons.** A pair of **↺ Undo / ↻ Redo** buttons sits in the transport bar, just to the right of the Play / Stop controls. Each reflects the current state of the history — it is disabled (greyed out) when there is nothing to undo or redo — so you can see at a glance whether a step is available. Click ↺ to undo the last change, ↻ to redo it.

**Keyboard shortcuts.**

| Action | Shortcut |
| --- | --- |
| Undo | Ctrl+Z / Cmd+Z |
| Redo | Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y |

Capture is automatic — Loom snapshots the session after each interaction and coalesces a continuous gesture (a knob or fader drag, a note drag, a marquee move) into a **single** undo step, so one drag undoes in one click. The shortcuts are inactive while a text input has focus, so typing a save name — or an inline rename — never accidentally undoes your work. Loading a session, loading a demo, or starting a new session clears the undo history.

---

## WAV export

![The REC group on the session bar — REC button plus the take / live / offline mode selector](images/rec-group.png)

WAV export is part of the unified **REC** group on the session bar (second header row), not a separate button. The **● REC** button (tooltip "Grabar — el modo se elige al lado") records using whichever mode is selected in the adjacent **mode selector** (`#rec-mode`):

- **🎛 take** (default) — records knob moves and clip launches into a performance take (not a WAV).
- **⏱ live** — records the live master output in real time to a stereo 16-bit WAV file.
- **⚡ offline** — renders the current scene to a WAV file offline (faster than real time).

To export audio, pick **⏱ live** or **⚡ offline** and press **● REC**. The two WAV backends behave as described below.

### ⏱ live (real-time WAV)

The real-time backend is the ground-truth render, and it works like a tape machine: **arm → play → stop**.

Pressing **● REC** in this mode does not start anything — it only **arms** the recorder, and the button reads `● ARMED`. Capture begins on the next downbeat, whichever way you start the transport (the ▶ button, a clip launch, a scene launch), and the button changes to `● Recording…`. It then records **open-ended** until *you* press Stop.

That is the important difference from the offline render: it is not one pass of one scene. It captures **the whole performance, including scene changes** — launch scene A, let it run, switch to B, drop a clip, then stop, and all of it is in the file. It taps the live master output after every insert, the master compression and the master FX, so what you hear is exactly what lands in the file, including any random variation from a voice that uses it.

A 2-second tail is appended after you stop so reverb and delay repeats are not cut off.

### ⚡ offline (fast WAV render)

The offline backend rebuilds the full audio graph — lanes, inserts, master bus — inside an `OfflineAudioContext`, applies every lane's current sound state, batch-schedules all note events, and renders faster than real time without touching the live session. It shares the same encoder and download step as the real-time path, so the output format is identical.

**It loops seamlessly.** The offline renderer deliberately renders **two cycles of the scene and gives you the second one**. The first cycle is thrown away because it starts from silence — no reverb tail from the previous bar, no delay repeats in flight. The second cycle inherits all of that, so the file loops without a seam. This is the reason to prefer the offline render for loop material.

For the same reason it appends **no** FX tail: the render is exactly the musical, bar-aligned length. A trailing tail would round up to an extra bar and the loop would drift.

**Where it differs from the live sound.** The divergence is structural, not random: per-pad FX sends and per-voice drum-strip sends/EQ are dropped offline, and sample-mode drum kits render through the sampler path. Both are approximations of the live per-voice mix, so a kit that leans on per-voice sends will not sound identical. Everything else — presets, clip automation, the worklet engines — is applied exactly as live.

### What gets exported

- **One pass of the scene (offline only).** The offline export captures one full iteration of the longest clip across all sounding lanes; shorter clips loop to fill that window. The **live** take has no such window — it runs until you stop it.
- **A scene must be playing (offline only).** Press **● REC** in ⚡ offline mode with nothing playing and Loom shows a brief notice and does nothing; launch a scene first. In ⏱ live mode arming with nothing playing is normal — that is the point, since it starts capturing from the downbeat of whatever you launch next.
- **Switching mode disarms.** Changing between take / live / offline clears whatever the previous mode had armed.

### Where the recording goes

When a render finishes — live or offline — Loom asks what to do with it:

- **Download a WAV**, named `loom-take-<timestamp>.wav`; or
- **Insert it back into the session** as a new audio channel, tempo-locked to the project BPM. This is how you bounce a busy scene down to a single audio lane and keep building on top of it.

Cancelling the dialog discards the take and writes nothing.

---

## Live build and GitHub Pages

The public instance of Loom is deployed automatically to [https://ijol.github.io/Loom/](https://ijol.github.io/Loom/) — every push to `main` triggers a GitHub Actions workflow that runs `vite build --base=/Loom/` and deploys the result to GitHub Pages. The standard `npm run build` (base `/`) is for local development or self-hosting on any other path.
