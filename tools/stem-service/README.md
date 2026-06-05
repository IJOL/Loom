# Loom Stem Service (local)

The headless engine behind UVR (via [`audio-separator`](https://github.com/nomadkaraoke/python-audio-separator))
exposed as a tiny local HTTP service. Loom's "Stems…" button talks to it. Runs on
**your machine** — GitHub Pages can only serve Loom's UI, not run Python.

## Install

Requires Python 3.10+ and **ffmpeg** on PATH.

```bash
cd tools/stem-service
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app:app --port 8765
```

First separation downloads the Demucs `htdemucs` model (hundreds of MB) automatically.
CPU works; it takes ~1–2 min/song. GPU (if your torch build sees one) is much faster.

## Use from Loom

- Local Loom (`npm run dev` → http://localhost:5173) talking to this service is the
  lowest-friction setup.
- The GitHub Pages Loom (https://ijol.github.io/Loom) can also call `http://localhost:8765`,
  but Chrome's *Private Network Access* may add a preflight/permission. CORS for these
  origins is already configured in `app.py`.
- Override the URL in Loom by setting `localStorage.loomStemServiceUrl` in the browser
  console (e.g. for a Codespaces forwarded HTTPS URL).

## Run it in a GitHub Codespace (optional)

A Codespace is a Linux VM that *can* run Python. Inside one: `pip install -r requirements.txt`,
`uvicorn app:app --port 8765`, then forward port 8765 (GitHub gives an HTTPS URL) and set
`localStorage.loomStemServiceUrl` to that URL in Loom. CPU-only, slower, but no local setup.

## Tests

```bash
python -m pytest test_app.py -v
```

Separation is stubbed — no real Demucs runs. These tests are **not** part of `npm test`.

## Manual smoke

Start the service, open Loom, click **Stems…**, pick a short song, watch the 4 lanes
appear, hit Play.
