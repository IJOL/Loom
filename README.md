# Loom

**A browser-based, session music workstation built on the Web Audio API.**

🎛️ **Live demo → [ijol.github.io/Loom](https://ijol.github.io/Loom/)**

Loom grew out of a Roland TB-303 bass synth + drum machine and still has those at its core, but is now a multi-engine instrument host. Everything runs **live in the browser** — there is no backend, no audio uploads to a server, no plugins to install. Make a beat, tweak knobs, and it plays.

---

## Features

- **7 instrument engines** — TB-303, Subtractive, FM, Wavetable, Karplus-Strong, a **Sampler**, and a **Drum machine** (synth kits *and* sample kits).
- **Tempo-locked loops & slicing** — drop an audio loop into the Sampler and it's auto-sliced and locked to the project tempo **without changing pitch**: slices retrigger on the grid REX-style (pitch-perfect, free-following the tempo), with an optional pitch-preserving time-stretch for sustained material. Tempo and slice points are read from embedded **Acid / `cue` / AIFF** markers when present, or estimated by onset + beat detection. Tweak it all in a unified **waveform + slice-grid editor**.
- **Session workflow** — arrange **lanes** that play **clips** in **scenes**, with per-clip piano-roll and drum-rack editors.
- **TB-303 behaviors** — authentic slide (glide into the next step) and per-step accent, shared across engines.
- **Per-lane modulation** — LFO and ADSR modulators routable to any parameter.
- **FX & mixer** — multifilter, distortion, reverb, delay as per-lane inserts or master sends, plus a mixer with **sidechain compression**.
- **MIDI import** — drop a `.mid` file and it's transformed into a session, with General MIDI instrument matching.
- **Presets** — 20+ per engine, GM-tagged.
- **Global undo/redo** and session save/load (stored locally in your browser).
- **Plugin architecture** — engines, FX, and modulators are discovered at build time; adding one is dropping a file, not editing the core.

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

## Deployment

This repo auto-deploys to **GitHub Pages** on every push to `main` via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). Because Pages serves a project site from a sub-path, the CI build uses a dedicated script that sets the base accordingly:

```bash
npm run build:pages   # tsc + vite build --base=/Loom/
```

The standard `npm run build` (base `/`) is left untouched for local preview and other hosts.

## Architecture

See [CLAUDE.md](CLAUDE.md) for a tour of the subsystems (engine/FX/modulator registry, the `SessionState` data model, the per-lane scheduler, and the source layout under `src/`).
