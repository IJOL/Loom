# Stem Separation via Local Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stems…" feature to Loom that uploads a song to a local Python backend (Demucs `htdemucs`, 4 stems), polls for progress, and creates one full-length Sampler lane per stem so Play reconstructs the song.

**Architecture:** Two cooperating pieces. (1) `tools/stem-service/` — a self-contained FastAPI backend wrapping `audio-separator`, with a job+poll HTTP contract; NOT bundled, NOT in JS CI, started manually by the user. (2) `src/stems/` — a Loom client subsystem: a pure HTTP client, a pure poll loop, a pure lane-plan mapper, an orchestrator that decodes returned WAVs into `SampleAsset`s and creates 4 Sampler lanes through the existing `SessionHost` allocation path, and a transport-bar modal. localhost-only; base URL is configurable.

**Tech Stack:** Backend: Python 3, FastAPI, uvicorn, `audio-separator`, ffmpeg. Client: TypeScript, Vitest (mocked `fetch` + fake timers), existing Web Audio sampler/session infra. Reference spec: `docs/superpowers/specs/2026-06-05-stem-separation-local-service-design.md`.

---

## File Structure

```
tools/stem-service/
  requirements.txt        # fastapi, uvicorn[standard], audio-separator, python-multipart
  separation.py           # separate_file(in_path, out_dir) -> {stem_name: wav_path}  (wraps audio-separator)
  jobs.py                 # Job dataclass + JobRegistry (in-memory) + background runner + TTL cleanup
  app.py                  # FastAPI app: /health, POST /jobs, GET /jobs/{id}, GET /jobs/{id}/stems/{name}, DELETE /jobs/{id}, CORS
  test_app.py             # pytest over the app with separation stubbed (NOT in JS CI)
  README.md               # install (pip + ffmpeg), run, CORS notes, Codespaces note, manual smoke

src/stems/
  stem-config.ts          # base URL (default http://localhost:8765) + localStorage override
  stem-client.ts          # pure fetch wrapper: health, createJob, getJob, stemUrl, cancelJob (+ typed errors)
  stem-client.test.ts
  stem-poll.ts            # pollJob(getJob, {onProgress, signal, intervalMs}) loop
  stem-poll.test.ts
  stem-lane-plan.ts       # PURE: stem manifest -> ordered, labelled lane plan
  stem-lane-plan.test.ts
  stem-import.ts          # orchestrator: createJob -> poll -> decode -> assets -> sessionHost.onAddStemLanes
  stem-dialog.ts          # modal UI: file picker, progress, status, cancel; calls stem-import
  stem-dialog-wiring.ts   # wires the transport-bar "Stems…" button to open the modal

Modified:
  index.html                       # add "Stems…" button + modal markup
  src/session/session-host.ts      # add onAddStemLanes(stems) method
  src/session/session-host.ts      # export type for the host method / deps as needed
  src/main.ts                      # build StemDialogDeps and wire the button
```

---

## Phase A — Backend (`tools/stem-service/`)

> The backend is a personal localhost tool. Its `pytest` is run manually inside that folder; it is **not** part of `npm test`. Real Demucs is never run in tests — separation is stubbed.

### Task A1: Backend dependencies + separation wrapper

**Files:**
- Create: `tools/stem-service/requirements.txt`
- Create: `tools/stem-service/separation.py`

- [ ] **Step 1: Write `requirements.txt`**

```
fastapi
uvicorn[standard]
audio-separator
python-multipart
```

- [ ] **Step 2: Write the separation wrapper**

`separation.py`:

```python
"""Wraps audio-separator (the headless engine behind UVR) to split a file into
4 Demucs stems. Kept tiny and import-light so the FastAPI app and tests can import
the module without loading Demucs until separate_file() is actually called."""
from __future__ import annotations
import os

MODEL_FILENAME = "htdemucs.yaml"  # Demucs 4-stem (vocals/drums/bass/other)

# Map a stem to substrings audio-separator puts in output filenames (case-insensitive).
_STEM_MATCHERS = {
    "vocals": ("vocals", "vocal"),
    "drums": ("drums", "drum"),
    "bass": ("bass",),
    "other": ("other", "instrumental", "no vocals"),
}


def _classify(filename: str) -> str | None:
    low = filename.lower()
    for stem, needles in _STEM_MATCHERS.items():
        if any(n in low for n in needles):
            return stem
    return None


def separate_file(in_path: str, out_dir: str) -> dict[str, str]:
    """Run Demucs htdemucs and return {stem_name: absolute_wav_path}.
    Imports audio-separator lazily so importing this module is cheap."""
    from audio_separator.separator import Separator  # lazy, heavy

    os.makedirs(out_dir, exist_ok=True)
    sep = Separator(output_dir=out_dir, output_format="WAV")
    sep.load_model(model_filename=MODEL_FILENAME)
    outputs = sep.separate(in_path)  # list of output file paths (or names in out_dir)

    result: dict[str, str] = {}
    for path in outputs:
        abs_path = path if os.path.isabs(path) else os.path.join(out_dir, path)
        stem = _classify(os.path.basename(abs_path))
        if stem and stem not in result:
            result[stem] = abs_path
    return result
```

- [ ] **Step 3: Commit**

```bash
git add tools/stem-service/requirements.txt tools/stem-service/separation.py
git commit -m "feat(stem-service): deps + audio-separator wrapper (Demucs 4-stem)"
```

---

### Task A2: Job registry + background runner

**Files:**
- Create: `tools/stem-service/jobs.py`
- Test: `tools/stem-service/test_app.py` (created here, extended in A3)

- [ ] **Step 1: Write the failing test**

`test_app.py`:

```python
import time
from jobs import JobRegistry


def fake_separate(in_path, out_dir):
    return {"vocals": "/tmp/v.wav", "drums": "/tmp/d.wav",
            "bass": "/tmp/b.wav", "other": "/tmp/o.wav"}


def test_job_runs_to_done():
    reg = JobRegistry(separate=fake_separate)
    job_id = reg.create(in_path="/tmp/in.wav", out_dir="/tmp/out")
    # poll until terminal (runner is a background thread)
    for _ in range(50):
        job = reg.get(job_id)
        if job.status in ("done", "error"):
            break
        time.sleep(0.02)
    job = reg.get(job_id)
    assert job.status == "done"
    assert set(job.stems.keys()) == {"vocals", "drums", "bass", "other"}


def test_job_error_is_captured():
    def boom(in_path, out_dir):
        raise RuntimeError("model download failed")
    reg = JobRegistry(separate=boom)
    job_id = reg.create(in_path="/tmp/in.wav", out_dir="/tmp/out")
    for _ in range(50):
        if reg.get(job_id).status in ("done", "error"):
            break
        time.sleep(0.02)
    job = reg.get(job_id)
    assert job.status == "error"
    assert "model download failed" in job.error
```

- [ ] **Step 2: Run it to verify it fails**

Run (inside `tools/stem-service/`, in a venv with deps installed):
```bash
python -m pytest test_app.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'jobs'`.

- [ ] **Step 3: Implement `jobs.py`**

```python
"""In-memory job registry with a background thread runner. Separation is injected
so tests can stub it (never runs real Demucs in CI)."""
from __future__ import annotations
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

SeparateFn = Callable[[str, str], dict[str, str]]


@dataclass
class Job:
    id: str
    in_path: str
    out_dir: str
    status: str = "queued"          # queued | running | done | error
    progress: Optional[float] = None  # 0..1 or None (indeterminate)
    stems: dict[str, str] = field(default_factory=dict)  # stem -> wav path
    error: str = ""
    created_at: float = field(default_factory=time.time)


class JobRegistry:
    def __init__(self, separate: SeparateFn, ttl_sec: float = 3600.0):
        self._separate = separate
        self._ttl = ttl_sec
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, in_path: str, out_dir: str) -> str:
        job = Job(id=uuid.uuid4().hex, in_path=in_path, out_dir=out_dir)
        with self._lock:
            self._gc_locked()
            self._jobs[job.id] = job
        threading.Thread(target=self._run, args=(job.id,), daemon=True).start()
        return job.id

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def delete(self, job_id: str) -> bool:
        with self._lock:
            return self._jobs.pop(job_id, None) is not None

    def _run(self, job_id: str) -> None:
        job = self.get(job_id)
        if job is None:
            return
        job.status = "running"
        try:
            stems = self._separate(job.in_path, job.out_dir)
            job.stems = stems
            job.status = "done"
            job.progress = 1.0
        except Exception as exc:  # noqa: BLE001 — surface any failure to the client
            job.error = str(exc)
            job.status = "error"

    def _gc_locked(self) -> None:
        now = time.time()
        stale = [jid for jid, j in self._jobs.items() if now - j.created_at > self._ttl]
        for jid in stale:
            self._jobs.pop(jid, None)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_app.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add tools/stem-service/jobs.py tools/stem-service/test_app.py
git commit -m "feat(stem-service): in-memory job registry + background runner (tested, stubbed)"
```

---

### Task A3: FastAPI app (endpoints + CORS)

**Files:**
- Create: `tools/stem-service/app.py`
- Modify: `tools/stem-service/test_app.py`

- [ ] **Step 1: Write the failing endpoint test**

Append to `test_app.py`:

```python
import io
import app as app_module
from fastapi.testclient import TestClient


def _client_with_stub(monkeypatch):
    # Stub separation so no real Demucs runs; write tiny wav files on demand.
    import os, tempfile

    def fake_separate(in_path, out_dir):
        os.makedirs(out_dir, exist_ok=True)
        out = {}
        for stem in ("vocals", "drums", "bass", "other"):
            p = os.path.join(out_dir, f"{stem}.wav")
            with open(p, "wb") as f:
                f.write(b"RIFF....WAVEfmt ")  # not a valid wav; only the bytes matter for the test
            out[stem] = p
        return out

    app_module.registry._separate = fake_separate  # type: ignore[attr-defined]
    return TestClient(app_module.app)


def test_health(monkeypatch):
    client = _client_with_stub(monkeypatch)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_post_job_then_poll_to_done(monkeypatch):
    client = _client_with_stub(monkeypatch)
    r = client.post("/jobs", files={"file": ("song.wav", io.BytesIO(b"data"), "audio/wav")})
    assert r.status_code == 201
    job_id = r.json()["jobId"]
    status = None
    for _ in range(50):
        body = client.get(f"/jobs/{job_id}").json()
        status = body["status"]
        if status in ("done", "error"):
            break
        time.sleep(0.02)
    assert status == "done"
    names = {s["name"] for s in client.get(f"/jobs/{job_id}").json()["stems"]}
    assert names == {"vocals", "drums", "bass", "other"}
    # stem bytes are downloadable
    assert client.get(f"/jobs/{job_id}/stems/vocals").status_code == 200


def test_delete_job(monkeypatch):
    client = _client_with_stub(monkeypatch)
    job_id = client.post(
        "/jobs", files={"file": ("song.wav", io.BytesIO(b"data"), "audio/wav")}
    ).json()["jobId"]
    assert client.delete(f"/jobs/{job_id}").status_code == 200
    assert client.get(f"/jobs/{job_id}").status_code == 404
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest test_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'`.

- [ ] **Step 3: Implement `app.py`**

```python
"""Local stem-separation service (the headless engine behind UVR, via audio-separator).
Personal/localhost tool — no auth. Start with:  uvicorn app:app --port 8765"""
from __future__ import annotations
import os
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from jobs import JobRegistry
from separation import separate_file, MODEL_FILENAME

WORK_ROOT = os.path.join(tempfile.gettempdir(), "loom-stem-service")
ALLOWED_ORIGINS = [
    "http://localhost:5173",   # vite dev
    "http://localhost:4173",   # vite preview / e2e
    "https://ijol.github.io",  # GitHub Pages
]

app = FastAPI(title="Loom Stem Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

registry = JobRegistry(separate=separate_file)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_FILENAME}


@app.post("/jobs", status_code=201)
async def create_job(file: UploadFile = File(...)):
    job_root = os.path.join(WORK_ROOT, "in")
    os.makedirs(job_root, exist_ok=True)
    in_path = os.path.join(job_root, f"{os.urandom(6).hex()}-{file.filename or 'input'}")
    with open(in_path, "wb") as f:
        f.write(await file.read())
    out_dir = os.path.join(WORK_ROOT, "out", os.urandom(6).hex())
    job_id = registry.create(in_path=in_path, out_dir=out_dir)
    return {"jobId": job_id}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = registry.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    body = {"status": job.status, "progress": job.progress}
    if job.status == "done":
        body["stems"] = [{"name": name, "url": f"/jobs/{job_id}/stems/{name}"}
                         for name in job.stems]
    if job.status == "error":
        body["error"] = job.error
    return JSONResponse(body)


@app.get("/jobs/{job_id}/stems/{name}")
def get_stem(job_id: str, name: str):
    job = registry.get(job_id)
    if job is None or name not in job.stems:
        raise HTTPException(status_code=404, detail="stem not found")
    return FileResponse(job.stems[name], media_type="audio/wav", filename=f"{name}.wav")


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    if not registry.delete(job_id):
        raise HTTPException(status_code=404, detail="job not found")
    return {"ok": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_app.py -v`
Expected: PASS (all tests, including A2's two).

- [ ] **Step 5: Commit**

```bash
git add tools/stem-service/app.py tools/stem-service/test_app.py
git commit -m "feat(stem-service): FastAPI job+poll endpoints + CORS (tested, stubbed)"
```

---

### Task A4: Backend README

**Files:**
- Create: `tools/stem-service/README.md`

- [ ] **Step 1: Write the README**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add tools/stem-service/README.md
git commit -m "docs(stem-service): install/run/Codespaces/CORS README"
```

---

## Phase B — Client contract (`src/stems/`)

### Task B1: Config (base URL + override)

**Files:**
- Create: `src/stems/stem-config.ts`
- Test: `src/stems/stem-config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { stemServiceBaseUrl, STEM_SERVICE_DEFAULT_URL } from './stem-config';

describe('stemServiceBaseUrl', () => {
  afterEach(() => { try { localStorage.removeItem('loomStemServiceUrl'); } catch { /* no DOM */ } });

  it('returns the default when nothing is overridden', () => {
    expect(stemServiceBaseUrl({})).toBe(STEM_SERVICE_DEFAULT_URL);
  });

  it('prefers an explicit override', () => {
    expect(stemServiceBaseUrl({ override: 'http://x:1' })).toBe('http://x:1');
  });

  it('strips a trailing slash', () => {
    expect(stemServiceBaseUrl({ override: 'http://x:1/' })).toBe('http://x:1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-config.test.ts`
Expected: FAIL — cannot find module `./stem-config`.

- [ ] **Step 3: Implement `stem-config.ts`**

```typescript
// Base URL for the local stem service. Default is localhost; overridable via
// localStorage (e.g. a Codespaces HTTPS URL) without touching code.
export const STEM_SERVICE_DEFAULT_URL = 'http://localhost:8765';
const LS_KEY = 'loomStemServiceUrl';

function readLocalStorage(): string | undefined {
  try { return localStorage.getItem(LS_KEY) ?? undefined; } catch { return undefined; }
}

/** Resolve the base URL (no trailing slash). `override` wins over localStorage. */
export function stemServiceBaseUrl(opts: { override?: string } = {}): string {
  const raw = opts.override ?? readLocalStorage() ?? STEM_SERVICE_DEFAULT_URL;
  return raw.replace(/\/+$/, '');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stems/stem-config.ts src/stems/stem-config.test.ts
git commit -m "feat(stems): configurable stem-service base URL"
```

---

### Task B2: HTTP client (typed contract over fetch)

**Files:**
- Create: `src/stems/stem-client.ts`
- Test: `src/stems/stem-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { StemClient, StemServiceUnreachable } from './stem-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

describe('StemClient', () => {
  const base = 'http://svc:8765';

  it('health() returns true on ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, model: 'htdemucs' }));
    const c = new StemClient(base, fetchFn);
    expect(await c.health()).toEqual({ ok: true, model: 'htdemucs' });
    expect(fetchFn).toHaveBeenCalledWith(`${base}/health`, expect.anything());
  });

  it('health() maps a network error to StemServiceUnreachable', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const c = new StemClient(base, fetchFn);
    await expect(c.health()).rejects.toBeInstanceOf(StemServiceUnreachable);
  });

  it('createJob() POSTs multipart and returns the jobId', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ jobId: 'abc' }, 201));
    const c = new StemClient(base, fetchFn);
    const file = new File([new Uint8Array([1, 2, 3])], 'song.wav', { type: 'audio/wav' });
    expect(await c.createJob(file)).toBe('abc');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${base}/jobs`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('getJob() returns a parsed running status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'running', progress: null }));
    const c = new StemClient(base, fetchFn);
    expect(await c.getJob('abc')).toEqual({ status: 'running', progress: null });
  });

  it('getJob() returns done with stems', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      status: 'done', progress: 1,
      stems: [{ name: 'vocals', url: '/jobs/abc/stems/vocals' }],
    }));
    const c = new StemClient(base, fetchFn);
    const s = await c.getJob('abc');
    expect(s.status).toBe('done');
    expect(s.stems?.[0]).toEqual({ name: 'vocals', url: '/jobs/abc/stems/vocals' });
  });

  it('stemUrl() resolves a relative stem url against the base', () => {
    const c = new StemClient(base, vi.fn());
    expect(c.stemUrl('/jobs/abc/stems/vocals')).toBe(`${base}/jobs/abc/stems/vocals`);
    expect(c.stemUrl('http://other/x')).toBe('http://other/x');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-client.test.ts`
Expected: FAIL — cannot find module `./stem-client`.

- [ ] **Step 3: Implement `stem-client.ts`**

```typescript
// Pure-ish typed wrapper over the stem-service HTTP contract. All network calls
// go through an injected fetch so it is unit-testable. Network failures (service
// not running) surface as StemServiceUnreachable so the UI can show a clear hint.

export type StemName = 'vocals' | 'drums' | 'bass' | 'other';

export interface StemRef { name: string; url: string; }

export interface JobStatus {
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number | null;
  stems?: StemRef[];
  error?: string;
}

export class StemServiceUnreachable extends Error {
  constructor(public readonly baseUrl: string, cause?: unknown) {
    super(`Stem service unreachable at ${baseUrl}`);
    this.name = 'StemServiceUnreachable';
    (this as { cause?: unknown }).cause = cause;
  }
}

type FetchFn = typeof fetch;

export class StemClient {
  constructor(private readonly baseUrl: string, private readonly fetchFn: FetchFn = fetch) {}

  private async req(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, init ?? {});
    } catch (cause) {
      throw new StemServiceUnreachable(this.baseUrl, cause);
    }
  }

  async health(): Promise<{ ok: boolean; model: string }> {
    const r = await this.req('/health');
    if (!r.ok) throw new StemServiceUnreachable(this.baseUrl);
    return r.json();
  }

  async createJob(file: File): Promise<string> {
    const body = new FormData();
    body.append('file', file, file.name);
    const r = await this.req('/jobs', { method: 'POST', body });
    if (!r.ok) throw new Error(`createJob failed: HTTP ${r.status}`);
    return (await r.json()).jobId as string;
  }

  async getJob(jobId: string): Promise<JobStatus> {
    const r = await this.req(`/jobs/${jobId}`);
    if (!r.ok) throw new Error(`getJob failed: HTTP ${r.status}`);
    return r.json() as Promise<JobStatus>;
  }

  async cancelJob(jobId: string): Promise<void> {
    try { await this.req(`/jobs/${jobId}`, { method: 'DELETE' }); } catch { /* best-effort */ }
  }

  /** Resolve a (possibly relative) stem url returned by the service against the base. */
  stemUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `${this.baseUrl}${url}`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stems/stem-client.ts src/stems/stem-client.test.ts
git commit -m "feat(stems): typed HTTP client over the job+poll contract"
```

---

### Task B3: Poll loop

**Files:**
- Create: `src/stems/stem-poll.ts`
- Test: `src/stems/stem-poll.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { pollJob } from './stem-poll';
import type { JobStatus } from './stem-client';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('pollJob', () => {
  it('polls until done, forwarding progress, and resolves with the final status', async () => {
    const seq: JobStatus[] = [
      { status: 'queued', progress: null },
      { status: 'running', progress: 0.5 },
      { status: 'done', progress: 1, stems: [{ name: 'vocals', url: '/u' }] },
    ];
    let i = 0;
    const getJob = vi.fn(async () => seq[Math.min(i++, seq.length - 1)]);
    const onProgress = vi.fn();

    const final = await pollJob(getJob, { onProgress, intervalMs: 0 });

    expect(final.status).toBe('done');
    expect(final.stems?.length).toBe(1);
    expect(onProgress).toHaveBeenCalledWith('queued', null);
    expect(onProgress).toHaveBeenCalledWith('running', 0.5);
  });

  it('rejects when the job errors', async () => {
    const getJob = vi.fn(async (): Promise<JobStatus> => ({ status: 'error', progress: null, error: 'boom' }));
    await expect(pollJob(getJob, { intervalMs: 0 })).rejects.toThrow('boom');
  });

  it('stops polling when the signal aborts', async () => {
    const ctrl = new AbortController();
    const getJob = vi.fn(async (): Promise<JobStatus> => ({ status: 'running', progress: null }));
    const p = pollJob(getJob, { intervalMs: 0, signal: ctrl.signal });
    await tick();
    ctrl.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-poll.test.ts`
Expected: FAIL — cannot find module `./stem-poll`.

- [ ] **Step 3: Implement `stem-poll.ts`**

```typescript
import type { JobStatus } from './stem-client';

export interface PollOptions {
  onProgress?: (status: JobStatus['status'], progress: number | null) => void;
  signal?: AbortSignal;
  intervalMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

/** Poll getJob() until the job reaches a terminal state. Resolves with the `done`
 *  status, rejects on `error` (message = backend error) or on abort. */
export async function pollJob(
  getJob: () => Promise<JobStatus>,
  opts: PollOptions = {},
): Promise<JobStatus> {
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const status = await getJob();
    opts.onProgress?.(status.status, status.progress);
    if (status.status === 'done') return status;
    if (status.status === 'error') throw new Error(status.error || 'separation failed');
    await sleep(interval, opts.signal);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-poll.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stems/stem-poll.ts src/stems/stem-poll.test.ts
git commit -m "feat(stems): abortable poll loop with progress callback"
```

---

### Task B4: Lane plan (pure mapping)

**Files:**
- Create: `src/stems/stem-lane-plan.ts`
- Test: `src/stems/stem-lane-plan.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { planStemLanes } from './stem-lane-plan';

describe('planStemLanes', () => {
  it('orders known stems and labels them in Spanish', () => {
    const plan = planStemLanes([
      { name: 'other', url: '/o' },
      { name: 'vocals', url: '/v' },
      { name: 'bass', url: '/b' },
      { name: 'drums', url: '/d' },
    ]);
    expect(plan.map((p) => p.label)).toEqual(['Voz', 'Batería', 'Bajo', 'Otros']);
    expect(plan.map((p) => p.url)).toEqual(['/v', '/d', '/b', '/o']);
  });

  it('keeps unknown stems at the end with a capitalised fallback label', () => {
    const plan = planStemLanes([
      { name: 'vocals', url: '/v' },
      { name: 'guitar', url: '/g' },
    ]);
    expect(plan.map((p) => p.label)).toEqual(['Voz', 'Guitar']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-lane-plan.test.ts`
Expected: FAIL — cannot find module `./stem-lane-plan`.

- [ ] **Step 3: Implement `stem-lane-plan.ts`**

```typescript
import type { StemRef } from './stem-client';

const LABELS: Record<string, string> = {
  vocals: 'Voz', drums: 'Batería', bass: 'Bajo', other: 'Otros',
};
const ORDER = ['vocals', 'drums', 'bass', 'other'];

export interface StemLanePlan { name: string; url: string; label: string; }

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Map a stem manifest to an ordered, labelled lane plan: known stems first in
 *  canonical order with Spanish labels, unknown stems appended in input order. */
export function planStemLanes(stems: StemRef[]): StemLanePlan[] {
  const known = ORDER
    .map((n) => stems.find((s) => s.name === n))
    .filter((s): s is StemRef => Boolean(s))
    .map((s) => ({ name: s.name, url: s.url, label: LABELS[s.name] }));
  const unknown = stems
    .filter((s) => !ORDER.includes(s.name))
    .map((s) => ({ name: s.name, url: s.url, label: cap(s.name) }));
  return [...known, ...unknown];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/stems/stem-lane-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stems/stem-lane-plan.ts src/stems/stem-lane-plan.test.ts
git commit -m "feat(stems): pure stem->lane plan mapper (labels + order)"
```

---

## Phase C — Session integration

### Task C1: `onAddStemLanes` on SessionHost

**Files:**
- Modify: `src/session/session-host.ts` (add the method next to `onAddLane`, ~line 577; add `audioClip` to the import from `./session`)

> This mirrors `onAddLane` exactly (the canonical allocation + render path — see
> `src/session/session-host.ts:551-577`) but builds a full-length `audioClip`
> (mode `'song'`) per stem, and creates all stems as ONE undoable action.

- [ ] **Step 1: Add `audioClip` to the existing `./session` import**

Find the import that already brings in `emptyLane`, `emptyClip` from `'./session'` and add `audioClip`:

```typescript
import { /* …existing… */ emptyLane, emptyClip, audioClip } from './session';
```

(If `emptyLane`/`emptyClip` are imported individually, just add `audioClip` alongside.)

- [ ] **Step 2: Add the method after `onAddLane` (after line 577)**

```typescript
      /** Create one full-length Sampler lane per separated stem, as a single
       *  undoable action. Each `stems[i].sampleId` must already be in the sample
       *  store AND decoded into sampleCache by the caller (stem-import). */
      onAddStemLanes(stems: { label: string; sampleId: string; durationSec: number }[]) {
        const hd = self.deps.historyDeps;
        const run = () => {
          for (const stem of stems) {
            const used = new Set(self.state.lanes.map((l) => l.id));
            const newId = nextLaneSlug(used, 'sampler');
            const lane = emptyLane(newId, 'sampler');
            lane.name = stem.label;

            const rowCount = Math.max(self.state.scenes.length, 1);
            const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
            const clip = audioClip({
              name: stem.label,
              sampleId: stem.sampleId,
              durationSec: stem.durationSec,
              bpm: seq.bpm,
              mode: 'song',
            });
            for (let r = 0; r < rowCount; r++) {
              lane.clips.push(r === 0 ? clip : emptyClip(defaultLen));
            }
            self.state.lanes.push(lane);
            self.laneStates.set(newId, emptyLanePlayState(newId));
            self.deps.ensureLaneResource?.(newId, 'sampler');
          }
          self.renderWithMixer();
        };
        if (hd) withUndo(hd, run); else run();
      },
```

> `seq.bpm`, `seq.length`, `seq.meter` and `stepsPerBar` are already in scope here
> (the same ones `onAddLane` uses). `bpm` only sets `lengthBars`; mode `'song'` plays
> at natural speed regardless, and all 4 stems share the same bpm+duration so they
> get identical `lengthBars` and re-trigger in lockstep.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If the host has a declared interface type for these methods, add `onAddStemLanes` to it with the same signature.)

- [ ] **Step 4: Build to confirm the bundle is clean**

Run: `npm run build`
Expected: typecheck + bundle succeed.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts
git commit -m "feat(session): onAddStemLanes — full-length Sampler lane per stem (one undo)"
```

---

### Task C2: Import orchestrator

**Files:**
- Create: `src/stems/stem-import.ts`

> Browser-only (real `fetch`, `decodeAudioData`, IndexedDB). Not unit-tested; the
> pure pieces it composes (client/poll/lane-plan) are already covered. Exercised by
> the optional e2e (Task E1) and manual smoke.

- [ ] **Step 1: Implement `stem-import.ts`**

```typescript
import { StemClient } from './stem-client';
import { pollJob } from './stem-poll';
import { planStemLanes } from './stem-lane-plan';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { sampleStore } from '../samples/store-singleton';
import { sampleCache } from '../samples/sample-cache';

export interface StemImportDeps {
  ctx: AudioContext;
  client: StemClient;
  addStemLanes: (stems: { label: string; sampleId: string; durationSec: number }[]) => void;
}

export interface StemImportCallbacks {
  onProgress?: (status: string, progress: number | null) => void;
  signal?: AbortSignal;
}

/** Full flow: upload -> poll -> decode all stems -> create lanes (all-or-nothing). */
export async function importStems(
  deps: StemImportDeps,
  file: File,
  cb: StemImportCallbacks = {},
): Promise<void> {
  const jobId = await deps.client.createJob(file);
  let done;
  try {
    done = await pollJob(() => deps.client.getJob(jobId), {
      onProgress: cb.onProgress, signal: cb.signal,
    });
  } catch (err) {
    if (cb.signal?.aborted) await deps.client.cancelJob(jobId);
    throw err;
  }

  const plan = planStemLanes(done.stems ?? []);

  // Decode ALL stems before creating any lane (all-or-nothing).
  const decoded = await Promise.all(plan.map(async (p) => {
    const res = await fetch(deps.client.stemUrl(p.url));
    if (!res.ok) throw new Error(`stem download failed: ${p.name} (HTTP ${res.status})`);
    const bytes = await res.arrayBuffer();
    const buffer = await deps.ctx.decodeAudioData(bytes.slice(0));
    return { plan: p, bytes, buffer };
  }));

  const lanes = decoded.map(({ plan: p, bytes, buffer }) => {
    const asset = buildSampleAsset({
      id: newSampleId(), name: p.label, mime: 'audio/wav',
      bytes, buffer, createdAt: Date.now(),
    });
    sampleCache.put(asset.id, buffer);          // so the sampler finds it immediately
    void sampleStore.put(asset);                // persist for reload (fire-and-forget)
    return { label: p.label, sampleId: asset.id, durationSec: buffer.duration };
  });

  deps.addStemLanes(lanes);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stems/stem-import.ts
git commit -m "feat(stems): import orchestrator (upload->poll->decode->lanes, all-or-nothing)"
```

---

## Phase D — UI

### Task D1: Modal markup + the "Stems…" button

**Files:**
- Modify: `index.html` (add the button inside the existing `.export-menu-wrap` area near `id="export-scene"`, ~line 66; add the modal markup near the save-manager modal, ~line 327)

- [ ] **Step 1: Add the transport-bar button**

Next to the export button (`index.html:66`), add:

```html
<button id="stems-open" class="io" title="Separar una canción en stems (servicio local)">&#9776; Stems&#8230;</button>
```

- [ ] **Step 2: Add the modal markup** (mirror the save-manager modal at `index.html:327`)

```html
<div id="stems-modal" class="save-manager-modal" hidden>
  <div class="save-manager-backdrop" id="stems-backdrop"></div>
  <div class="save-manager-dialog">
    <h3>Separar en stems</h3>
    <p class="stems-hint" id="stems-hint">4 pistas (voz / batería / bajo / otros) vía el servicio local.</p>
    <input type="file" id="stems-file" accept="audio/*" />
    <div class="stems-progress" id="stems-progress" hidden>
      <progress id="stems-bar" max="1"></progress>
      <span id="stems-status"></span>
    </div>
    <div class="stems-actions">
      <button id="stems-run" class="io" disabled>Separar</button>
      <button id="stems-cancel" class="io" hidden>Cancelar</button>
      <button id="stems-close" class="io">Cerrar</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Build to confirm the markup parses / bundle is clean**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(stems): transport-bar button + separation modal markup"
```

---

### Task D2: Dialog behaviour

**Files:**
- Create: `src/stems/stem-dialog.ts`

- [ ] **Step 1: Implement `stem-dialog.ts`**

```typescript
import { StemClient, StemServiceUnreachable } from './stem-client';
import { importStems } from './stem-import';

export interface StemDialogDeps {
  ctx: AudioContext;
  client: StemClient;
  addStemLanes: (stems: { label: string; sampleId: string; durationSec: number }[]) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtElapsed = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Wire the Stems modal. Call once at boot after deps exist. */
export function wireStemDialog(deps: StemDialogDeps): void {
  const modal = $('stems-modal');
  const fileInput = $<HTMLInputElement>('stems-file');
  const runBtn = $<HTMLButtonElement>('stems-run');
  const cancelBtn = $<HTMLButtonElement>('stems-cancel');
  const progress = $('stems-progress');
  const bar = $<HTMLProgressElement>('stems-bar');
  const statusEl = $('stems-status');
  const hint = $('stems-hint');

  let controller: AbortController | null = null;
  let startedAt = 0;

  const close = () => { if (!controller) modal.hidden = true; };
  const setStatus = (msg: string) => { statusEl.textContent = msg; };

  const open = async () => {
    modal.hidden = false;
    progress.hidden = true;
    cancelBtn.hidden = true;
    runBtn.disabled = true;
    fileInput.value = '';
    setStatus('');
    hint.textContent = 'Comprobando el servicio…';
    try {
      await deps.client.health();
      hint.textContent = '4 pistas (voz / batería / bajo / otros) vía el servicio local.';
      runBtn.disabled = !fileInput.files?.length;
    } catch (err) {
      hint.textContent = err instanceof StemServiceUnreachable
        ? 'No encuentro el servicio de stems en localhost:8765. ¿Está arrancado? (ver tools/stem-service/README.md)'
        : 'No se pudo contactar el servicio de stems.';
      runBtn.disabled = true;
    }
  };

  fileInput.addEventListener('change', () => { runBtn.disabled = !fileInput.files?.length; });

  runBtn.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    controller = new AbortController();
    startedAt = performance.now();
    runBtn.disabled = true;
    cancelBtn.hidden = false;
    progress.hidden = false;
    bar.removeAttribute('value'); // indeterminate until we get a number
    setStatus('Subiendo…');

    try {
      await importStems(deps, file, {
        signal: controller.signal,
        onProgress: (status, p) => {
          const elapsed = Math.floor((performance.now() - startedAt) / 1000);
          if (typeof p === 'number') bar.value = p; else bar.removeAttribute('value');
          setStatus(status === 'done' ? 'Listo' : `Separando… ${fmtElapsed(elapsed)}`);
        },
      });
      controller = null;
      modal.hidden = true; // success: lanes are created, close
    } catch (err) {
      controller = null;
      cancelBtn.hidden = true;
      progress.hidden = true;
      runBtn.disabled = false;
      setStatus((err as Error)?.message ?? 'Error en la separación.');
      hint.textContent = (err as Error)?.message ?? 'Error en la separación.';
    }
  });

  cancelBtn.addEventListener('click', () => { controller?.abort(); controller = null; });

  $('stems-open').addEventListener('click', open);
  $('stems-close').addEventListener('click', close);
  $('stems-backdrop').addEventListener('click', close);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stems/stem-dialog.ts
git commit -m "feat(stems): separation modal behaviour (health check, progress, cancel)"
```

---

### Task D3: Wire it into the app

**Files:**
- Modify: `src/main.ts` (after `ctx`, `sessionHost`, and `historyDeps`/`_discreteHistoryDeps` exist)

- [ ] **Step 1: Import at the top of `main.ts`**

```typescript
import { StemClient } from './stems/stem-client';
import { stemServiceBaseUrl } from './stems/stem-config';
import { wireStemDialog } from './stems/stem-dialog';
```

- [ ] **Step 2: Wire after the session host + history deps are built** (near the other UI wiring, e.g. after the export wiring around `src/main.ts:621`)

```typescript
wireStemDialog({
  ctx,
  client: new StemClient(stemServiceBaseUrl()),
  addStemLanes: (stems) => sessionHost.onAddStemLanes(stems),
});
```

> `sessionHost` is the session host instance created earlier in `main.ts`; if the
> method is exposed under a different accessor, call it through the same object that
> exposes `onAddLane`. The undo wrapping happens inside `onAddStemLanes` (it reads
> `self.deps.historyDeps`), so no extra `withUndo` is needed here.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: typecheck + bundle succeed.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(stems): wire Stems modal into app boot"
```

---

## Phase E — End-to-end (optional, stubbed)

### Task E1: e2e flow with a stubbed service

**Files:**
- Create: `tests/e2e/stems.spec.ts`

> Stubs the service via Playwright route interception so the full UI flow runs
> without Python. Generates a tiny valid WAV for the stem downloads. Remember:
> `npm run build` before e2e — it serves `dist/`.

- [ ] **Step 1: Write the e2e test**

```typescript
import { test, expect } from '@playwright/test';

// Minimal valid 1-frame mono 8-bit WAV (44 header bytes + 1 sample).
function tinyWavBase64(): string {
  const bytes = new Uint8Array([
    0x52,0x49,0x46,0x46, 0x25,0,0,0, 0x57,0x41,0x56,0x45, 0x66,0x6d,0x74,0x20,
    0x10,0,0,0, 1,0, 1,0, 0x44,0xac,0,0, 0x44,0xac,0,0, 1,0, 8,0,
    0x64,0x61,0x74,0x61, 1,0,0,0, 0x80,
  ]);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

test('separates a song into 4 sampler lanes (service stubbed)', async ({ page }) => {
  const wav = Buffer.from(tinyWavBase64(), 'base64');

  await page.route('**/health', (r) => r.fulfill({ json: { ok: true, model: 'htdemucs' } }));
  await page.route('**/jobs', (r) => r.fulfill({ status: 201, json: { jobId: 'e2e' } }));
  await page.route('**/jobs/e2e', (r) => r.fulfill({
    json: { status: 'done', progress: 1, stems: [
      { name: 'vocals', url: '/jobs/e2e/stems/vocals' },
      { name: 'drums',  url: '/jobs/e2e/stems/drums' },
      { name: 'bass',   url: '/jobs/e2e/stems/bass' },
      { name: 'other',  url: '/jobs/e2e/stems/other' },
    ] },
  }));
  await page.route('**/jobs/e2e/stems/**', (r) =>
    r.fulfill({ contentType: 'audio/wav', body: wav }));

  await page.goto('/');
  await page.locator('#stems-open').click();
  await page.locator('#stems-file').setInputFiles({
    name: 'song.wav', mimeType: 'audio/wav', buffer: wav,
  });
  await page.locator('#stems-run').click();

  // Modal closes on success and 4 new lanes are named after the stems.
  await expect(page.locator('#stems-modal')).toBeHidden({ timeout: 15000 });
  for (const label of ['Voz', 'Batería', 'Bajo', 'Otros']) {
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
  }
});
```

- [ ] **Step 2: Build, then run the e2e**

```bash
npm run build
npm run test:e2e -- stems.spec.ts
```
Expected: PASS. (If the lane-label assertion is too loose for the session grid, target the lane tab/list selector the session UI uses — inspect `session-host` render output.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/stems.spec.ts
git commit -m "test(e2e): stem separation flow with stubbed service"
```

---

## Final verification

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run test:unit` — green (re-run once if `ERR_IPC_CHANNEL_CLOSED` on teardown)
- [ ] `npm run build` — clean
- [ ] `npm run test:e2e -- stems.spec.ts` — green (after build)
- [ ] Manual smoke (documented in README): start `uvicorn app:app --port 8765`, open Loom, Stems… → pick a short song → 4 lanes appear → Play reconstructs it.

## Notes for the implementer

- **Worktree first.** Per the repo owner's rules, this whole plan runs inside a git
  worktree on a feature branch; rebase onto `main` often and `merge --ff-only` at the end.
- **Backend is opt-in.** If the service isn't running, Loom behaves exactly as today
  (the modal shows the "service not found" hint). Nothing else changes.
- **No `decodeAudioData` in unit tests.** The browser-only orchestrator/dialog are
  covered by e2e + manual; the pure client/poll/lane-plan units carry the unit coverage.
- **`audio-separator` output filenames vary by version.** `separation.py:_classify`
  matches on substrings; if a future version changes them, extend `_STEM_MATCHERS`.
