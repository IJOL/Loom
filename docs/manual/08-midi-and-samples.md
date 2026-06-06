# MIDI & Samples

This chapter covers two ways to bring external material into a Loom session: importing a Standard MIDI File to populate lanes and clips automatically, and loading audio samples into the Sampler engine to build melodic instruments or drum kits.

---

## MIDI Import

![MIDI Import panel](images/midi-import.png)

The MIDI Import panel lives in the toolbar at the top of the screen, next to the demo picker. Click **MIDI Import** to expand it.

### Loading a file

Click the file picker and choose a `.mid` or `.midi` file. Loom reads the file immediately — no server, no upload. The parser extracts every track's name, General MIDI programme number, and all note-on/note-off pairs (converted to start tick, duration, MIDI note, velocity, and channel). Only the first tempo event in the file is used; if no tempo is present, the session BPM stays as it is.

Empty tracks (those with no note events) are silently skipped.

### The track list

After parsing, a row appears for each non-empty track showing:

- A **checkbox** to include or exclude that track from the import.
- The **track index**, track name (cleaned of control characters), note count, pitch range, and programme number.
- A **preset dropdown**. The GM programme number is looked up against every engine's preset catalogue, and the matching presets are offered at the top of the list (e.g. programme 33 "Acoustic Bass" will surface TB-303 and Subtractive bass presets). Below a divider, every preset from every engine is available so you can override the suggestion freely.
- A **▶ audition button** that plays a short three-note arpeggio through the currently selected preset without touching the session. Use this to compare options before committing.

### Importing

Click **Import MIDI**. A confirmation dialog asks whether to **Add** or **Replace**:

- **OK (Add)** appends the imported lanes and a new scene to the current session. The new clips are placed on the new scene row so they line up correctly with the scene's launch button.
- **Cancel (Replace)** clears the session and seeds it with only the imported content.

Loom creates one lane per selected track. The lane's name is taken from the matched preset (e.g. "TB Bass"), while the clip inside it keeps the original track name. If the file contained a tempo, the session BPM is updated to match. The import launches the new scene immediately.

The conversion scales MIDI ticks to Loom's internal grid (based on quarter notes divided into four 16th steps), so the notes land on the correct beats regardless of the file's tick resolution.

See [Engines](04-engines.md) for what each engine sounds like, and [Sessions, Lanes, Clips & Scenes](03-sessions-lanes-clips-scenes.md) for how to rearrange lanes and scenes after import.

---

## Sampler

![Sampler engine editor](images/engine-sampler.png)

The Sampler is a polyphonic playback engine that maps audio files across the keyboard and plays them back at the correct pitch per note. It has three **families**, chosen from an **Instrument** selector: **Melodic** (one or more zones spanning a range of keys), **Percussion** (single-note pads at GM drum notes — a drum kit), and **Loop** (a sliced loop played as notes). The inspector shows **GAIN** and **VOICES** knobs, a **Keymap** section, the **Instrument** family selector, and **Import samples…** / **Import loop…** controls.

### Loading samples

Click **Import samples…** and pick one or more audio files (the picker is multi-select). Loom decodes each file and stores it in IndexedDB, so the samples persist across browser reloads — you do not need to re-import them each session.

Each imported file becomes a keymap entry that spans the full keyboard (MIDI 0–127) with the root note set to middle C (MIDI 60) by default. When you import several at once they stack full-range — last match wins, so only the last sounds until you narrow the ranges. Set each zone's root and low/high boundary in the keymap list, and remove an entry with the **✕** button.

### Keymap and repitch

A **keymap entry** has a root note, a low-note boundary, and a high-note boundary. When a note falls within the range, the sample plays at a playback rate of `2^((midi − rootNote) / 12)`, giving equal-temperament repitching. Multiple entries can cover different key ranges — last match wins — so you can build multi-sample instruments by importing several files and adjusting their boundaries.

### Per-pad / per-zone parameters

Every keymap entry (pad in drumkit mode, zone in melodic mode) has its own set of parameters, all read at trigger time:

| Parameter | Range | Default | Description |
| --- | --- | --- | --- |
| TUNE | −24 to +24 st | 0 | Pitch offset in semitones, applied on top of keymap repitch |
| CUTOFF | 0–1 | 1 | Lowpass filter cutoff (0 ≈ 60 Hz, 1 = fully open) |
| RES | 0–1 | 0 | Filter resonance |
| ATTACK | 0.001–2 s | 0.005 s | Amplitude envelope attack time |
| DECAY | 0.005–4 s | 0.08 s | Release tail after the gate closes |
| LEVEL | 0–1.5 | 1 | Pad output level |
| PAN | −1 to +1 | 0 | Stereo pan position |
| REV | 0–1 | 0 | Send level to the lane's reverb insert |
| DLY | 0–1 | 0 | Send level to the lane's delay insert |
| LOOP | Off / On | Off | When On, the sample loops while the gate is held |
| LSTART | 0–1 | 0 | Loop start point as a fraction of sample duration |
| RETRIG | Poly / Mono | Poly | Mono cuts the previous hit on re-trigger; Poly layers them |

In drumkit mode these appear in the per-pad rack (the same eight-column layout used by the Drum Machine engine). In melodic mode they appear as a knob row below each keymap entry.

### Percussion family (drum kits)

Pick the **Percussion** family in the **Instrument** selector and choose a kit ("— none (own keymap) —" leaves the lane on its own keymap). Loom fetches the kit's manifest, downloads each voice's WAV, stores them in IndexedDB, and maps every sample to its canonical General MIDI drum note (kick on 36, snare on 38, and so on). The keymap is rebuilt fresh from the manifest on each session load, so you do not need to re-import the kit files manually.

In addition to any kits you build yourself by loading samples, Loom ships three **ready-made sample drum kits** that appear directly in the Percussion family: **TR-808 (samples)**, **Acoustic / Dirt (samples)**, and **Dirt (samples)**. These are curated one-shot WAVs bundled with the app, so they work on the live GitHub Pages deploy without any manual file import. Simply pick one from the dropdown and the lane is ready to play.

Once a kit is loaded the lane switches to the drum-grid editor (the same grid used by the Drum Machine engine). You get per-pad mute and solo buttons, and the full per-pad parameter rack. To return to a melodic keymap, pick the **Melodic** family.

See [Editing Clips](05-editing-clips.md) for how to draw patterns in the drum grid, and [Engines](04-engines.md) for a comparison with the Drum Machine engine (which lists all available kits, including the synth kits, in a unified preset table).

---

## Audio channel

The **audio channel** is the first-class way to bring a finished loop into a Loom session: drop a WAV and it plays **tempo-locked to the project without changing pitch**, with its waveform shown as a header above the clip editor. It stays a pure audio loop; to chop a loop into individually editable note slices, load it through the Sampler's **Loop** family instead (see [Sampler](#sampler)).

![The + Audio control in the session tab bar](images/audio-channel-add.png)

### Creating an audio channel

There are two ways to add one:

- **+ Audio button** — at the end of the lane tab row, next to the engine picker, sits a **+ Audio** button. Click it and pick a WAV. Loom decodes the file, stores it in IndexedDB (so it survives a reload), estimates its original tempo, and creates a **new audio lane** holding the loop as an audio clip. The clip opens automatically in the inspector.
- **Drag onto an audio-lane cell** — once an audio lane exists, you can drag another WAV directly onto one of its grid cells to place a second audio clip there.

Each new audio lane gets a launch button on its scene row, so it is immediately playable alongside the rest of the session.

### The audio-clip editor

![The audio-clip editor: the Warp toggle and the waveform header](images/audio-clip-editor.png)

An audio clip has no note grid. Clicking it opens the **audio-clip editor** — a **♺ Warp ON / OFF** toggle (tempo-locking, see below) above a **waveform header**.

The waveform header shows a peak view of the buffer with a bar/beat ruler, any detected slice markers (orange), and a live playhead while the clip plays. This same header also appears **above** the normal piano-roll or drum-grid for any clip that references a buffer, so you always see the audio you are editing against.

### Tempo-lock (Warp)

With **Warp ON** (the default), the audio channel plays in time with the project BPM using a pitch-preserving WSOLA time-stretch:

- **At the loop's native BPM** the stretch ratio is ≈ 1, so playback is essentially identical to the source file.
- **At any other project BPM** the buffer is time-stretched to fit — faster or slower — **without changing pitch**. The stretched buffer is cached and re-rendered automatically whenever you change the project tempo, so the loop stays locked as you experiment.

With **Warp OFF** the loop plays at its natural speed with no tempo sync — useful when you want the audio exactly as recorded.

> First-play note: on the very first loop iteration after import (before the stretch cache is warm) playback briefly falls back to a varispeed render — a slight pitch shift that self-heals from the next iteration. At the loop's native tempo the ratio is ≈ 1, so even that first pass is near-identical.

### Slicing a loop into notes

The audio channel itself is a pure WAV loop. To chop a loop into individually editable hits, load it through the Sampler's **Loop** family (see [Sampler](#sampler)) rather than the audio channel. Loom detects slice points (from embedded **Acid / `cue` / AIFF** markers when present, or by onset detection plus a tempo estimate), stores one short sample per slice in IndexedDB, and creates a **note clip** that triggers the slices in order on a piano-roll — so the groove plays back identically, now as discrete, editable notes. Move, mute, repitch, or re-order the hits in the piano-roll, and tweak each pad's tune/cutoff/decay/level/pan in the per-pad rack (see [Per-pad / per-zone parameters](#per-pad--per-zone-parameters)); the clip keeps the original waveform as its header. *(Earlier builds did this from a **✂ Slice → pads** button on the audio channel; that moved to the Sampler's Loop family.)*

---

## Stem separation (optional, local service)

Stem separation lets you drop a finished song into Loom and get it back as four separate Sampler lanes — **Vocals**, **Drums**, **Bass**, and **Other** — so you can mute, solo, and remix each part inside the existing session.

![Stems modal](images/stems-modal.png)

### How it works

Click **☰ Stems…** in the session bar (the second header row, alongside Save / Load / MIDI). A dialog titled "Separate into stems" opens and immediately checks whether the local helper service is reachable:

- **Service found** — the hint line reads "4 tracks (Vocals / Drums / Bass / Other) via the local service." and the **Separate** button becomes active once you pick a file.
- **Service not found** — the hint reads "Can't find the stems service at localhost:8765. Is it running?" and Separate stays disabled. Start the service (see below), then re-open the dialog.

To separate a track: pick an audio file with the file picker, then click **Separate**. The dialog shows a progress bar:

1. **"Uploading…"** — the file is being uploaded to the local service.
2. **"Separating… m:ss"** — the service is running Demucs; the counter shows elapsed time. The bar may be indeterminate if the model does not report fine-grained progress.
3. On success the dialog closes automatically and four new Sampler lanes appear in the session — one per stem, each holding a full-length one-shot clip sized to the song. Hitting Play reconstructs the original mix; mute or solo any lane to isolate parts.

The entire lane-creation is a **single undo step**, so you can undo all four lanes at once.

**Cancelar** aborts a running job and frees the temporary files on the service. **Cerrar** closes the dialog (only available when no job is running).

### Opt-in nature

The feature is entirely opt-in. If you never start the service, nothing else in Loom changes — the ☰ Stems… button is the only touch point, and it degrades gracefully to a clear "service not found" message.

Stems land in IndexedDB as ordinary sample assets: they survive browser reloads just like any other sample you import.

### Setting up the local service

The separation runs on your machine via a small Python service in `tools/stem-service/`. It requires **Python 3.10+** and **ffmpeg** on your PATH.

```bash
cd tools/stem-service
python -m venv .venv
# macOS / Linux:
. .venv/bin/activate
# Windows:
.venv\Scripts\activate

pip install -r requirements.txt
uvicorn app:app --port 8765
```

The first time you separate a track the service downloads the Demucs `htdemucs` model automatically (several hundred MB). Subsequent runs skip the download. Separation takes roughly **1–2 minutes per song** on CPU; a GPU-enabled PyTorch build is much faster.

### Codespaces and custom service URL

If you want to run the service in a GitHub Codespace (a Linux VM with Python), start it there with the same commands above, forward port 8765, and paste the resulting HTTPS URL into the browser console:

```js
localStorage.loomStemServiceUrl = 'https://your-codespace-url-8765.preview.app.github.dev'
```

The same override works for any non-default host. CORS for `localhost:5173` (dev), `localhost:4173` (preview), and the GitHub Pages origin is already configured in the service.

> Note: Chrome's *Private Network Access* policy may add a preflight request when the Pages version of Loom calls `http://localhost:8765`. The lowest-friction setup is running Loom locally (`npm run dev`) alongside the service.

For full notes on CORS, the HTTP contract, and the Codespaces workflow, see [`tools/stem-service/README.md`](../../tools/stem-service/README.md).
