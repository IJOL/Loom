# Loom

**A browser-based, session music workstation built on the Web Audio API.**

🎛️ **Live demo → [ijol.github.io/Loom](https://ijol.github.io/Loom/)**

📖 **Manual → [ijol.github.io/Loom/manual](https://ijol.github.io/Loom/manual/)** — also a downloadable [PDF](docs/manual/Loom-Manual.pdf) or browse the [Markdown source](docs/manual/README.md).

Loom grew out of a Roland TB-303 bass synth + drum machine and still has those at its core, but is now a multi-engine instrument host. Everything runs **live in the browser** — the core has no backend, uploads nothing to a server, and needs no plugins installed. Make a beat, tweak knobs, and it plays. *(One opt-in extra — **stem separation** — talks to a small helper you run locally; see [below](#stem-separation-optional-local-service).)*

---

## Features

- **8 instrument engines** — TB-303, Subtractive, FM, Wavetable, Karplus-Strong, **West Coast**, a **Sampler**, and a **Drum machine** (synth kits *and* sample kits).
- **Audio channel** — drop a WAV via **+ Audio** (or onto an audio-lane cell) and it plays **tempo-locked without pitch change** (WSOLA pitch-preserving time-stretch; at the loop's native BPM it's essentially the source untouched). The waveform shows as a header above the clip editor. It stays a pure audio loop — to chop a loop into individually editable note slices, load it through the **Sampler's Loop family** instead: it slices the loop at its transients (embedded **Acid / `cue` / AIFF** markers when present, otherwise onset + beat detection) into a note-per-slice clip on a piano-roll, retriggered on the grid REX-style with the source waveform kept above the notes.
- **Session workflow** — arrange **lanes** that play **clips** in **scenes**, with per-clip piano-roll and drum-rack editors, in-place **track/scene rename** (double-click), **Duplicate track/scene** context actions, and **Capture scene** (toolbar button or **Ctrl+I**) to snapshot what's currently playing into a new scene.
- **Clip loop regions** — loop just a slice of a clip: drag an A–B brace over a clip's editor to repeat, say, bars 2–3 while it plays, independent of every other clip, or drag the region's interior to slide that window along the timeline. The brace lives on note and drum editors (including sliced loops, where only the hits inside the region fire); a pure audio channel plays whole, so bring the loop in through the **Sampler's Loop family** first when you want per-region control. Flip the brace's **Global** toggle to share one A–B region across every clip in the scene, and **click a clip editor's time ruler to seek** playback anywhere while it runs.
- **Playable arrangement** — flatten the whole session into a linear song: hit **⇉ Copy to Performance** (or import a MIDI) and every lane's clips become timeline bands that play start-to-finish and **stop at the end**. Drag an **A–B loop brace** on the ruler to repeat a section across all lanes at once.
- **Velocity & dynamics** — every note carries a velocity that drives its loudness continuously (and is captured from MIDI import). Edit it in an **Ableton-style velocity lane** under each editor — drag a bar, nudge a whole selection, or sweep to paint a ramp — and read it at a glance: notes shade **blue → yellow** with velocity, and accented hits (the loud ones) are ringed white.
- **Musical assistance** — set a **project key & scale** plus an editing **style** (Acid / Techno, House, Synthwave, Lo-fi, Breakbeat / Big Beat) from the tonality bar; the piano-roll highlights in-key notes, and a one-click **🎲 generator**, an **examples gallery**, pattern transforms (**Vary / Mirror / Reverse**), and a **chord maker** all stay in key. An optional **scale lock** — **off by default**, toggled from the tonality bar or the piano-roll's 🔒 button — snaps every note you place into the key when you want a safety net.
- **TB-303 behaviors** — authentic slide (glide into the next step) and per-step accent, shared across engines.
- **Per-lane modulation** — LFO and ADSR modulators routable to any parameter.
- **FX & mixer** — one unified effect picker with **11 inserts** (multifilter, distortion, reverb, delay, compressor, limiter, **tremolo**, **chorus**, **flanger**, **phaser**, **bitcrusher**) insertable on any rack: per lane (audio included), on the master, or on the two general-purpose **Send A / Send B** return buses (seeded A = delay, B = reverb). Inserts are built from native Web Audio nodes (the synthesis itself runs in the AudioWorklet). Plus a mixer with **sidechain compression**. Any insert's params are modulation and Performance-automation destinations.
- **MIDI import** — drop a `.mid` file and it's transformed into a session, with General MIDI instrument matching.
- **Hardware MIDI control** — drive Loom live from an **Akai APC Key 25** (or any MIDI keyboard) over USB: play the active lane with **held, velocity-sensitive, polyphonic** notes, launch clips on the **8×5 pad grid with LED feedback**, tweak params with the 8 knobs, and fire scenes / STOP ALL. Auto-detects mk1/mk2 and falls back to a generic keyboard; see [below](#hardware-midi-control-apc-key-25).
- **Stem separation (optional)** — drop a finished song and Loom splits it into **4 audio lanes** (vocals / drums / bass / other) so you can mute, solo and remix the parts. Optional note transcription can also generate editable note/drum lanes from stems or from an audio clip's **Transcribe loop** action. Separation/transcription run on a **small local helper you start yourself** (Demucs + transcription models; Demucs models are the same family behind [UVR](https://github.com/anjok07/ultimatevocalremovergui)); the app itself stays 100% browser. Setup below / [`tools/stem-service/`](tools/stem-service/README.md).
- **Computer keyboard as MIDI** — the **⌨ Keys** toggle turns the typing keyboard into a live instrument: ASDFG… play the **active lane** through the same path a hardware MIDI keydown takes (so chord note-FX and loop-record apply), `z`/`x` shift the octave. Off by default.
- **MIDI live-record** — arm **● Rec** and play (hardware keyboard, pads, or ⌨ Keys) to capture held notes straight into a clip, merged or replacing, with the notes appearing on the grid as you play.
- **XY pad** — a floating, Kaoss-style controller: pick any two automatable params from the X and Y dropdowns (the same destinations an LFO targets) and drag the surface to sweep both live; the on-screen knobs follow.
- **Presets** — 20+ per engine, GM-tagged.
- **Global undo/redo** and session save/load (stored locally in your browser).
- **AudioWorklet synthesis** — the melodic engines don't build a Web Audio node graph per note; they render sample-by-sample inside a single **AudioWorklet** (`src/audio-worklet/loom-processor.ts`) with a per-renderer registry, voice manager, look-ahead scheduler queue and modulation runtime under [`src/audio-dsp/`](src/audio-dsp/). That's what keeps dense, high-polyphony material free of the dropouts a node-per-note graph produces. Inserts, mixer and sends stay on native Web Audio nodes downstream.
- **Plugin architecture** — FX and modulators are discovered at build time by a glob scan: adding one really is dropping a file in [`src/plugins/`](src/plugins/), no core edit. **Engines are not a pure drop-in yet** — a new engine file registers itself and shows up in the lane selector, but to actually make sound it must also be added to `WORKLET_ENGINE_IDS` in [`src/app/lane-allocator.ts`](src/app/lane-allocator.ts) and its renderer side-effect-imported in [`src/audio-worklet/loom-processor.ts`](src/audio-worklet/loom-processor.ts). Skip either and the engine is selectable but silent at note time.

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

Four test layers: pure logic, scheduling (fake clock), real-DSP renders through `OfflineAudioContext`, and an objective per-engine modulation render (an LFO/ADSR on each engine, measured to confirm it changes the sound).

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

## Hardware MIDI control (APC Key 25)

Loom can be played from a hardware controller over **Web MIDI** (Chrome / Edge — Firefox needs the flag). Open the **MIDI Control** panel and click **Enable**; the status shows the detected device, e.g. `APC Key 25 (mk2) ✓`. Plug-and-play: unplug/replug re-binds, and the choice is remembered across reloads.

It's built around an **Akai APC Key 25** (both **mk1** and **mk2** auto-detect), but any class-compliant keyboard works as a generic fallback (notes + CC knobs, no LEDs). Adding support for another controller is dropping one **profile** file in [`src/control/profiles/`](src/control/profiles/) — it's discovered at build time, just like FX and modulator plugins.

Surface map:

- **Keyboard** → plays the **active lane**'s engine as **held notes**: hold for sustain, release to stop, chords are polyphonic, velocity drives loudness, and the sustain pedal holds.
- **8×5 pads** → launch the clips of the visible lanes, with **LED feedback**: green = playing, amber = stopped, off = empty (mk1); clip colours on mk2.
- **8 knobs** → tweak parameters; the bank buttons switch between **VOLUME / PAN / SEND (= EQ) / DEVICE** (the active lane's first engine params). Values jump to the knob position (no pickup).
- **Scene buttons** → launch scenes; **STOP ALL** stops everything.
- **LEFT / RIGHT** → change the active lane — and the on-screen UI follows (the active lane is a single source of truth, synced both ways).

## Deployment

This repo auto-deploys to **GitHub Pages** on every push to `main` via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). Because Pages serves a project site from a sub-path, the CI build uses a dedicated script that sets the base accordingly:

```bash
npm run build:pages   # tsc + vite build --base=/Loom/
```

The standard `npm run build` (base `/`) is left untouched for local preview and other hosts.

## Credits — sample sources

The synth drum kits (808 / 909 / 606 / 78 / Linn) are **100% generated DSP** — no samples.

Beyond those, this repo bundles **68 sample drum kits** under [`public/drumkits/`](public/drumkits/)
(**486 audio files** in total), plus a handful of sampler instruments under
[`public/instruments/`](public/instruments/). Their provenance:

- **64 of the 68 kits** (the "Drum Machines" preset group — `rolandtr808`, `linndrum`, `akaimpc60`,
  `oberheimdmx`, …) are generated by [`tools/build-drumkits-from-tidal.mjs`](tools/build-drumkits-from-tidal.mjs),
  which downloads one one-shot per Loom drum voice from
  [**ritchse/tidal-drum-machines**](https://github.com/ritchse/tidal-drum-machines) — the same packs
  [Strudel](https://codeberg.org/uzu/strudel) loads in its default prebake. As the generator's own header
  records, that collection carries **no explicit licence**; it is community-distributed.
- **3 hand-curated kits** (`tr808`, `acoustic`, `dirt`, 8 one-shots each) come from freely-circulated,
  community-redistributed sources — mainly the [**Dirt-Samples**](https://github.com/tidalcycles/Dirt-Samples)
  collection that ships with [TidalCycles](https://tidalcycles.org/), plus classic Roland **TR-808**
  one-shots. "TR-808" is a trademark of Roland Corporation.
- **`gm-percussion`** (31 files) is the one kit with a clear licence: [VCSL](https://github.com/sgossner/VCSL) (**CC0**).
- **[`public/instruments/amen-175/`](public/instruments/amen-175/)** ships an **"Amen Break"** loop.
  Its rights are **not cleared**.

To be explicit about what this means: **the bundled audio is not covered by Loom's AGPL grant.** The
AGPL applies to the source code; each sample keeps whatever terms its own source carries. For most of
the files above those terms are **unresolved** — the upstream collections state no licence, and the
samples have **not been individually cleared** for redistribution. They are bundled so the sampled kits
work on the live demo deploy.

**If you hold rights to any sound here and want it removed or re-credited, open an issue and it'll be
swapped immediately.**

## Architecture

See [CLAUDE.md](CLAUDE.md) for a tour of the subsystems (engine/FX/modulator registry, the `SessionState` data model, the per-lane scheduler, and the source layout under `src/`).

## License

**[GNU AGPL-3.0-or-later](LICENSE)** — Copyright (C) 2026 Nacho Ortega.

Loom is free software: run it, study it, change it and redistribute it, as long as you pass those
same freedoms on. If you modify Loom and let other people use it over a network, AGPL section 13
requires you to offer them your modified source too.

The licence is inherited, not chosen: Loom's worklet DSP adapts code from
[**Strudel**](https://codeberg.org/uzu/strudel)'s `dough.mjs` (AGPL-3.0-or-later) in
[`src/audio-dsp/filter.ts`](src/audio-dsp/filter.ts) and [`src/audio-dsp/osc.ts`](src/audio-dsp/osc.ts),
so the whole work is AGPL-3.0-or-later. Those files carry their own attribution headers.

Bundled audio samples are **not** covered by the AGPL — they keep the terms of their own sources, and
for most of them those terms are unresolved. See [Credits — sample sources](#credits--sample-sources) above.
