# Loom

**A browser-based, session music workstation built on the Web Audio API.**

🎛️ **Live demo → [ijol.github.io/Loom](https://ijol.github.io/Loom/)**

📖 **Manual → [ijol.github.io/Loom/manual](https://ijol.github.io/Loom/manual/)** — also a downloadable [PDF](docs/manual/Loom-Manual.pdf) or browse the [Markdown source](docs/manual/README.md).

Loom grew out of a Roland TB-303 bass synth + drum machine and still has those at its core, but is now a multi-engine instrument host. Everything runs **live in the browser** — the core has no backend, uploads nothing to a server, and needs no plugins installed. Make a beat, tweak knobs, and it plays. *(One opt-in extra — **stem separation** — talks to a small helper you run locally; see [below](#stem-separation-optional-local-service).)*

---

## Features

- **7 instrument engines** — TB-303, Subtractive, FM, Wavetable, Karplus-Strong, a **Sampler**, and a **Drum machine** (synth kits *and* sample kits).
- **Tempo-locked loops & slicing** — drop an audio loop into the Sampler and it's auto-sliced and locked to the project tempo **without changing pitch**: slices retrigger on the grid REX-style (pitch-perfect, free-following the tempo), with an optional pitch-preserving time-stretch for sustained material. Tempo and slice points are read from embedded **Acid / `cue` / AIFF** markers when present, or estimated by onset + beat detection. Tweak it all in a unified **waveform + slice-grid editor**.
- **Audio channel** — drop a WAV via **+ Audio** (or drag it onto an audio-lane cell) and it plays **tempo-locked without pitch change** (WSOLA pitch-preserving time-stretch). The waveform appears as a header above the clip editor. Hit **Slice → pads** to chop the loop into individual transient slices, stored as a bank of one-shots on a new Sampler lane with an auto-built one-note-per-slice clip — so the groove plays identically but the slices are now individually editable and remixable.
- **Session workflow** — arrange **lanes** that play **clips** in **scenes**, with per-clip piano-roll and drum-rack editors.
- **Clip loop regions** — loop just a slice of a clip: drag an A–B brace over a clip's editor to repeat, say, bars 2–3 while it plays, independent of every other clip. Works for note clips *and* audio clips (the Sampler plays only the matching slice of the buffer, still tempo-locked and pitch-preserving).
- **Playable arrangement** — flatten the whole session into a linear song: hit **⇉ Copy to Performance** (or import a MIDI) and every lane's clips become timeline bands that play start-to-finish and **stop at the end**. Drag an **A–B loop brace** on the ruler to repeat a section across all lanes at once.
- **Velocity & dynamics** — every note carries a velocity that drives its loudness continuously (and is captured from MIDI import). Edit it in an **Ableton-style velocity lane** under each editor — drag a bar, nudge a whole selection, or sweep to paint a ramp — and read it at a glance: notes shade **blue → yellow** with velocity, and accented hits (the loud ones) are ringed white.
- **TB-303 behaviors** — authentic slide (glide into the next step) and per-step accent, shared across engines.
- **Per-lane modulation** — LFO and ADSR modulators routable to any parameter.
- **FX & mixer** — multifilter, distortion, reverb, delay as per-lane inserts or master sends, plus a mixer with **sidechain compression**.
- **MIDI import** — drop a `.mid` file and it's transformed into a session, with General MIDI instrument matching.
- **Stem separation (optional)** — drop a finished song and Loom splits it into **4 Sampler lanes** (vocals / drums / bass / other) so you can mute, solo and remix the parts. Separation runs on a **small local helper you start yourself** (Demucs — the models behind [UVR](https://github.com/anjok07/ultimatevocalremovergui)); the app itself stays 100% browser. Setup below / [`tools/stem-service/`](tools/stem-service/README.md).
- **Presets** — 20+ per engine, GM-tagged.
- **Global undo/redo** and session save/load (stored locally in your browser).
- **Plugin architecture** — engines, FX, and modulators are discovered at build time; adding one is dropping a file, not editing the core.

## Manual

A full user + developer manual ships with the app:

- **Read online:** [ijol.github.io/Loom/manual](https://ijol.github.io/Loom/manual/) (in-app too — the **Manual ↗** link beside the title).
- **PDF:** [`docs/manual/Loom-Manual.pdf`](docs/manual/Loom-Manual.pdf).
- **Markdown source:** [`docs/manual/`](docs/manual/README.md) — 11 chapters (Getting Started → Performance & Arrangement) plus a Developer Guide.

It's generated from the Markdown chapters with `npm run build:manual` (Playwright captures the screenshots, then the chapters render to the PDF and the single-page web build); the Vite build copies it into `dist/manual/` so it deploys to Pages.

## Tech

TypeScript · [Vite](https://vitejs.dev/) · Web Audio API · IndexedDB (sample storage). Pure client-side — any modern browser with Web Audio works.

## Run locally

```bash
npm install
npm run dev      # Vite dev server with hot reload → http://localhost:5173
```

## Build

```bash
npm run build    # typecheck (tsc) + bundle to dist/  (base path "/")
npm run preview  # serve the production build locally
```

`dist/` is a fully static bundle — serve it from any static host (Apache, nginx, Netlify, S3, GitHub Pages…).

## Tests

```bash
npm test         # full suite: Vitest unit + Playwright e2e
npm run test:unit
npm run test:fast   # everything except the slower real-DSP renders
```

Four test layers: pure logic, scheduling (fake clock), real-DSP renders through `OfflineAudioContext`, and modulation wiring.

## Stem separation (optional local service)

Loom can split a finished track into 4 stems and load each as a Sampler lane (**Stems…** in the transport bar). Because separation needs Python + ML models (Demucs, via [`audio-separator`](https://github.com/nomadkaraoke/python-audio-separator) — the same models as [UVR](https://github.com/anjok07/ultimatevocalremovergui)), it runs in a **small local service you start on your own machine** — not in the browser, and not on GitHub Pages (which only serves the UI).

```bash
cd tools/stem-service
python -m venv .venv && . .venv/bin/activate   # Windows: py -m venv .venv ; .venv\Scripts\activate
pip install -r requirements.txt                 # needs ffmpeg on PATH
# then a Torch backend (Demucs runs on PyTorch) — pick one:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128   # NVIDIA GPU (cu128 = RTX 50xx/Blackwell)
# pip install torch torchaudio                                                    # …or CPU-only
uvicorn app:app --port 8765
```

Then click **Stems…**, pick a song, and the 4 lanes appear when it finishes. The feature is **entirely opt-in**: if the service isn't running the button just says so, and nothing else changes. Full setup — CPU vs GPU/CUDA, Windows/ffmpeg, Codespaces, CORS / Chrome Private Network Access, troubleshooting — lives in [`tools/stem-service/README.md`](tools/stem-service/README.md).

## Deployment

This repo auto-deploys to **GitHub Pages** on every push to `main` via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). Because Pages serves a project site from a sub-path, the CI build uses a dedicated script that sets the base accordingly:

```bash
npm run build:pages   # tsc + vite build --base=/Loom/
```

The standard `npm run build` (base `/`) is left untouched for local preview and other hosts.

## Credits — sample sources

The synth drum kits (808 / 909 / 606 / 78 / Linn) are **100% generated DSP** — no samples.
The three *sample* kits bundled under [`public/drumkits/`](public/drumkits/) (`tr808`, `acoustic`,
`dirt`) are small one-shots curated from freely-circulated, community-redistributed sources:

- **`acoustic` ("Acoustic / Dirt")** and most of **`tr808`** — the [**Dirt-Samples**](https://github.com/tidalcycles/Dirt-Samples)
  collection that ships with [TidalCycles](https://tidalcycles.org/), plus a couple of generic acoustic one-shots.
- **`tr808` ("TR-808")** — the classic Roland **TR-808** sounds (the widely-distributed
  *Michael Fischer 808* set and equivalents). "TR-808" is a trademark of Roland Corporation;
  the bundled samples are decades-old, freely-circulated one-shots used here for educational/demo purposes.
- **`tr808/ride`** uses a TR-808 crash; the acoustic ride is from Dirt-Samples.

These are bundled so the sampled kits work on the live deploy. They're a tiny curated subset, not a
redistribution of any full commercial library. **If you hold rights to any sound here and want it
removed or re-credited, open an issue and it'll be swapped immediately.**

## Architecture

See [CLAUDE.md](CLAUDE.md) for a tour of the subsystems (engine/FX/modulator registry, the `SessionState` data model, the per-lane scheduler, and the source layout under `src/`).
