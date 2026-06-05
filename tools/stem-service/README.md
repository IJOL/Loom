# Loom Stem Service (local)

The headless engine behind UVR (via [`audio-separator`](https://github.com/nomadkaraoke/python-audio-separator))
exposed as a tiny local HTTP service. Loom's **Stems…** button talks to it. Runs on
**your machine** — GitHub Pages can only serve Loom's UI, not run Python.

It wraps **Demucs `htdemucs`** (4 stems: vocals / drums / bass / other) and speaks a
small job + poll HTTP contract that the Loom client (`src/stems/`) drives.

---

## Requirements

- **Python 3.10+**
- **ffmpeg** on `PATH` (audio-separator decodes/encodes through it)
- For GPU: an **NVIDIA** card + recent driver (CUDA support comes from the Torch wheel, not a system CUDA install)

### Installing ffmpeg

- **Windows:** `winget install --id=Gyan.FFmpeg -e` (adds `ffmpeg`/`ffprobe` shims to
  `%LOCALAPPDATA%\Microsoft\WinGet\Links`, which is on your user `PATH`). Open a **new**
  shell afterwards so it's picked up.
- **macOS:** `brew install ffmpeg`
- **Debian/Ubuntu:** `sudo apt install ffmpeg`

Verify: `ffmpeg -version`.

---

## Install

> **Windows note:** the working launcher is `py` (the bare `python` may be the Microsoft
> Store stub). Use `py` to create the venv; inside the venv, `python`/`pip` resolve to it.

```bash
cd tools/stem-service
py -m venv .venv                      # Windows         (Linux/macOS: python -m venv .venv)
.venv\Scripts\activate                # Windows         (Linux/macOS: . .venv/bin/activate)
pip install -r requirements.txt       # fastapi, uvicorn, python-multipart, audio-separator
```

### Choose a Torch backend (Demucs runs on PyTorch)

`audio-separator` runs `htdemucs` on PyTorch, so you must install a Torch build. Pick one:

**GPU — NVIDIA (recommended if you have one):**

```bash
# cu128 = CUDA 12.8 wheels. REQUIRED for RTX 50-series / Blackwell (sm_120).
# Older cards can use cu124 or cu121 instead.
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
```

Verify the GPU is visible:

```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no-cuda')"
# e.g. -> 2.11.0+cu128 True NVIDIA GeForce RTX 5070 Ti
```

> Pick the `cuXYZ` index that matches your card/driver: run `nvidia-smi` to see the
> driver's max CUDA version. Blackwell (RTX 50xx) needs **cu128 or newer**; Ada/Ampere
> work on cu121+.

**CPU (no NVIDIA GPU, or you don't care about speed):**

```bash
pip install torch torchaudio          # default PyPI wheels are CPU-only
```

---

## Run

```bash
uvicorn app:app --port 8765
# or, without activating the venv (Windows):
#   .\.venv\Scripts\python -m uvicorn app:app --port 8765 --app-dir .
```

The **first** separation downloads the Demucs `htdemucs` model (~80 MB) automatically and
caches it. After that, separation is fast — on an RTX 5070 Ti an 8 s clip returns its 4
stems in ~16 s end-to-end (first run, model download included); subsequent runs are
seconds. CPU works too, at roughly 1–2 min per full song.

---

## Use from Loom

- **Local Loom** (`npm run dev`) talking to this service is the lowest-friction setup.
  Vite serves on `http://localhost:5173`, or **5174+ if 5173 is busy** — the service's
  CORS accepts **any `localhost`/`127.0.0.1` port**, so whichever Vite picks just works.
- **GitHub Pages Loom** (`https://ijol.github.io/Loom`) can also call `http://localhost:8765`,
  but Chrome's *Private Network Access* may add a preflight/permission prompt the first
  time. CORS for the Pages origin is already configured in `app.py`.
- **Override the service URL** from Loom (e.g. a Codespaces forwarded HTTPS URL): in the
  browser console set `localStorage.loomStemServiceUrl = 'https://your-host'`.

Then click **Stems…** in Loom's transport bar, pick a song, and the 4 Sampler lanes
appear when it finishes.

### Run it in a GitHub Codespace (optional)

A Codespace is a Linux VM that *can* run Python. Inside one: `pip install -r requirements.txt`,
install a Torch backend (CPU, or GPU if the Codespace has one), `uvicorn app:app --port 8765`,
then forward port 8765 (GitHub gives an HTTPS URL) and point Loom at it via
`localStorage.loomStemServiceUrl`.

---

## HTTP contract

| Method & path | Purpose |
|---|---|
| `GET /health` | `{ ok, model }` — liveness; Loom checks this before uploading |
| `POST /jobs` (multipart `file`) | `201 { jobId }` — start a background separation |
| `GET /jobs/{id}` | `{ status, progress, stems?, error? }` — `status` ∈ queued/running/done/error; `stems` = `[{ name, url }]` when done |
| `GET /jobs/{id}/stems/{name}` | WAV bytes of one stem |
| `DELETE /jobs/{id}` | cancel + free the job |

Jobs live in memory with a 1-hour TTL; the service does not persist across restarts.

---

## Tests

```bash
pip install pytest httpx     # test-only deps (not needed to run the service)
python -m pytest test_app.py -v
```

Separation is **stubbed** in the tests — no real Demucs runs, no GPU needed. These tests
are **not** part of the repo's `npm test`.

---

## Troubleshooting

- **Loom says "No encuentro el servicio de stems en localhost:8765"** — the service isn't
  running, or it's on another port. Start `uvicorn … --port 8765` (or set
  `localStorage.loomStemServiceUrl`).
- **`torch.cuda.is_available()` is `False`** — you installed the CPU Torch wheel, or the
  `cuXYZ` index doesn't match your card. Reinstall from the right index
  (`pip install torch torchaudio --index-url …/cu128 --force-reinstall`).
- **`RuntimeError: ... sm_120 ... not compatible`** (or a similar kernel error on RTX 50xx)
  — your Torch is built for an older CUDA. Use the **cu128** (or newer) wheels.
- **ffmpeg not found at separation time** — it must be on the `PATH` of the process that
  runs `uvicorn`. On Windows, open a fresh shell after `winget install`, or prepend
  `%LOCALAPPDATA%\Microsoft\WinGet\Links` to `PATH`.
- **First separation is slow / "stuck"** — it's downloading the `htdemucs` model the first
  time. Watch the uvicorn console; subsequent runs are fast.

---

## Manual smoke test

```bash
# generate an 8 s test clip and run it through the service
ffmpeg -y -f lavfi -i "sine=frequency=220:duration=8" -ac 2 -ar 44100 test.wav
curl -s -F "file=@test.wav" http://localhost:8765/jobs        # -> {"jobId":"..."}
curl -s http://localhost:8765/jobs/<jobId>                    # poll until {"status":"done", "stems":[...]}
```
