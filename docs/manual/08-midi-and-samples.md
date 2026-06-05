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

The Sampler is a polyphonic playback engine that maps audio files across the keyboard and plays them back at the correct pitch per note. It has two modes: **melodic** (one or more zones spanning a range of keys) and **drumkit** (single-note pads at GM drum notes). The inspector shows **GAIN** and **VOICES** knobs, a **Keymap** section, a **Drumkit** dropdown, a file picker, and a drop zone.

### Loading samples

Drag an audio file onto the drop zone labelled "Drop an audio file, or use the picker above", or use the **Choose File** picker. Loom decodes the file and stores it in IndexedDB, so the sample persists across browser reloads — you do not need to re-import it each session.

Each imported file becomes a keymap entry that spans the full keyboard (MIDI 0–127) with the root note set to middle C (MIDI 60) by default. You can change the root note in the keymap list, and remove an entry with the **✕** button.

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

### Drumkit mode

Select a kit from the **Drumkit** dropdown ("— none (melodic) —" means melodic mode). Loom fetches the kit's manifest, downloads each voice's WAV, stores them in IndexedDB, and maps every sample to its canonical General MIDI drum note (kick on 36, snare on 38, and so on). The keymap is rebuilt fresh from the manifest on each session load, so you do not need to re-import the kit files manually.

In addition to any kits you build yourself by loading samples, Loom ships three **ready-made sample drum kits** that appear directly in the Drumkit dropdown: **TR-808 (samples)**, **Acoustic / Dirt (samples)**, and **Dirt (samples)**. These are curated one-shot WAVs bundled with the app, so they work on the live GitHub Pages deploy without any manual file import. Simply pick one from the dropdown and the lane is ready to play.

Once a kit is loaded the lane switches to the drum-grid editor (the same grid used by the Drum Machine engine). You get per-pad mute and solo buttons, and the full per-pad parameter rack. To return to melodic mode, choose "— none (melodic) —" from the dropdown.

See [Editing Clips](05-editing-clips.md) for how to draw patterns in the drum grid, and [Engines](04-engines.md) for a comparison with the Drum Machine engine (which lists all available kits, including the synth kits, in a unified preset table).

### Import as loop

The **Import as loop** picker (below the drop zone) takes an audio file and creates a tempo-synced slice clip on the lane instead of adding a keymap entry. Loom reads any embedded tempo/slice metadata from the file (Acid chunks, cue markers, or AIFF markers) first; if none is found, it runs onset detection and autocorrelation to estimate the original BPM and slice points. The result is a clip whose slices are mapped to drum-grid steps — playing it triggers each slice at the right moment to keep the loop in time with the session BPM. The status line confirms how many slices were found and the detected tempo.

The loop import path bypasses the keymap and the per-pad parameters; the slice clip plays each region at its natural pitch with short anti-click fades and no amp envelope.

---

## Stem separation (optional, local service)

Stem separation lets you drop a finished song into Loom and get it back as four separate Sampler lanes — **Voz** (vocals), **Batería** (drums), **Bajo** (bass), and **Otros** (other) — so you can mute, solo, and remix each part inside the existing session.

![Stems modal](images/stems-modal.png)

### How it works

Click **☰ Stems…** in the transport bar. A dialog titled "Separar en stems" opens and immediately checks whether the local helper service is reachable:

- **Service found** — the hint line reads "4 pistas (voz / batería / bajo / otros) vía el servicio local." and the **Separar** button becomes active once you pick a file.
- **Service not found** — the hint reads "No encuentro el servicio de stems en localhost:8765. ¿Está arrancado?" and Separar stays disabled. Start the service (see below), then re-open the dialog.

To separate a track: pick an audio file with the file picker, then click **Separar**. The dialog shows a progress bar:

1. **"Subiendo…"** — the file is being uploaded to the local service.
2. **"Separando… m:ss"** — the service is running Demucs; the counter shows elapsed time. The bar may be indeterminate if the model does not report fine-grained progress.
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
