# Stem Separation via Local Service (UVR-style) — Design

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan
**Branch:** `worktree-stem-separation` (to be created)

## Goal

Let the user drop a finished song into Loom and get it back as **4 separated Sampler
lanes** (Voz / Batería / Bajo / Otros), reconstructing the track so they can mute,
solo and remix each part inside the existing session model.

The separation itself is **not** done in the browser (no Python/PyTorch in a static
GitHub Pages app). Instead Loom talks to a **small local backend** the user runs on
their own machine, which wraps the same models UVR uses.

User's phrasing (paraphrased from the brainstorm): *"cómo integramos
ultimatevocalremovergui … usar UVR como servicio … local solo para mí … una lane
Sampler por stem … solo 4 stems (Demucs) … trabajo + sondeo con progreso … solo
localhost documentado."*

## What "integrating UVR" actually means here

`ultimatevocalremovergui` is a **desktop GUI** (PyQt) with **no API**; it is a
front-end that downloads and runs separation models (MDX-Net, MDXC, VR, Demucs).
We cannot embed it. We integrate its **capability and its models** by wrapping the
headless library **`audio-separator`** (pip), which runs the *same* model families
and the *same* model files as UVR, but driven from code. Result: same quality/models
as UVR, called from Loom instead of clicked in a window.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Where does separation run? | A **local backend** the user starts on their machine; Loom (browser) calls it over HTTP. Not in the browser, not on GitHub Pages. |
| Backend engine | `audio-separator` (headless, same models as UVR). Not the UVR GUI (no API). |
| Stem modes | **Fixed 4-stem Demucs `htdemucs`** → vocals / drums / bass / other. **No model selector** in v1. |
| What Loom builds | **One Sampler lane per stem** (4 lanes), each stem a **full-length one-shot clip**, triggered together so Play reconstructs the song. |
| Request lifecycle | **Job + poll**: `POST /jobs` → `jobId`; backend separates in background; Loom polls `GET /jobs/{id}` and shows a **progress bar**; on `done` it downloads the stems. |
| Hosting | **localhost only**, documented in a README. Base URL is **configurable** so a remote/Codespaces backend is a URL change, not a code change — but only localhost is in scope. |
| Tempo mapping | **None.** Stems are one-shots that play start-to-finish; the scene is sized to the song length so the 4 loop in lockstep. (The "loops tempo-sync" path was explicitly *not* chosen.) |
| UI entry point | A **"Stems…"** button in the **transport bar** (next to Export), opening a small dialog. |
| Persistence | Stems become ordinary `SampleAsset`s in IndexedDB; the 4 lanes are ordinary session state. Reload behaves like any other sampler content. |
| Undo | Creating the 4 lanes is a **single undoable action** (wrapped via the existing `withUndo` history wiring). |

## Why these tradeoffs

- **Backend in-repo, not a separate repo.** It is the user's personal tool; keeping
  `tools/stem-service/` versioned with Loom lets the client↔service contract evolve
  together. It is **opt-in**: if the service is not running, Loom behaves exactly as
  today — the feature degrades to a clear "service not found" message.
- **`audio-separator`, not the UVR GUI.** The GUI has no API; the headless library is
  purpose-built for programmatic use and ships the same models. Same result, callable.
- **Fixed 4-stem.** The user wants the remix set (voz/batería/bajo/otros). Dropping the
  model selector removes a whole UI/contract surface (YAGNI); the base URL and the
  contract still leave room to add modes later.
- **Job + poll, not a blocking POST.** Demucs on CPU takes 1–2 minutes; a single
  long-lived request risks proxy/browser timeouts and gives no progress. A job id +
  polling survives long runs and drives a real progress bar.
- **No tempo mapping.** Per the user's explicit choice of "una lane Sampler por stem"
  over "loops tempo-sync": we don't know an arbitrary song's BPM, so we play the stems
  as full-length one-shots kept in sync by the scene length, not beat-matched slices.

## Architecture

Two cooperating pieces. The browser side is an isolated subsystem; the backend is a
self-contained tool folder.

```
tools/stem-service/            # local Python backend (NOT in CI, NOT bundled)
  app.py                       # FastAPI app: endpoints + CORS + in-memory job registry
  separation.py                # wraps audio-separator (Demucs htdemucs, 4 stems)
  jobs.py                      # Job model + background runner + per-job temp dir + TTL cleanup
  requirements.txt             # fastapi, uvicorn, audio-separator, python-multipart
  README.md                    # install (pip + ffmpeg), run (uvicorn --port 8765), CORS notes, Codespaces note

src/stems/                     # Loom client subsystem (TS)
  stem-config.ts               # baseUrl (default http://localhost:8765) + localStorage override
  stem-client.ts               # pure fetch wrapper over the contract; typed results + errors
  stem-poll.ts                 # poll loop: injected getJob + onProgress + AbortSignal (fake-timer testable)
  stem-import.ts               # orchestrator: createJob -> poll -> decode -> assets -> 4 Sampler lanes
  stem-lane-plan.ts            # PURE: stem manifest -> ordered lane plan (label/colour/order); unit-tested
  stem-dialog.ts               # modal UI: file picker, progress bar, status, cancel
  (mount point)                # a "Stems…" button added to the transport bar
```

The only touch to existing app code is: (1) a transport-bar button that opens the
dialog, and (2) using the **existing** lane allocation path (`ensureLaneResource` /
`swapLaneEngine` via the session host) to create the Sampler lanes — **no parallel
render path** (per CLAUDE.md the session UI is rebuilt by `session-host`). Asset
creation reuses [`buildSampleAsset`](../../../src/samples/import.ts) and the sample
store unchanged.

## HTTP contract (job + poll)

Base URL configurable; default `http://localhost:8765`.

- `GET /health` → `{ ok: true, model: "htdemucs" }` — used to detect "is the service up?"
- `POST /jobs` — multipart body, field `file` (the audio). → `201 { jobId }`. Kicks off
  background separation.
- `GET /jobs/{id}` → `{ status, progress, stems?, error? }`
  - `status`: `"queued" | "running" | "done" | "error"`
  - `progress`: `0..1` (best-effort; coarse stage-based if the library gives no fine
    callback — see below). The client bar falls back to indeterminate when progress is
    `null`/unknown.
  - on `done`: `stems: [{ name: "vocals"|"drums"|"bass"|"other", url: string }]`
  - on `error`: `error: string` (human-readable backend message).
- `GET /jobs/{id}/stems/{name}` → WAV bytes (`audio/wav`).
- `DELETE /jobs/{id}` → cancel a running job and free its temp dir. (Best-effort; used by
  the dialog's Cancel and on dialog close.)

**CORS:** `CORSMiddleware` allows `http://localhost:5173` (dev), `http://localhost:4173`
(vite preview / e2e) and `https://ijol.github.io` (Pages). The README notes Chrome's
Private Network Access may add a preflight when calling localhost from the Pages origin;
the lowest-friction setup is running Loom locally too.

**Progress honesty:** `audio-separator`/Demucs do not expose smooth per-percent
progress easily. The backend reports **stage-based** progress (`queued`→`running`
≈ indeterminate →`done`); if the library surfaces a fractional callback it is forwarded,
otherwise `progress` may be `null` and the UI shows an indeterminate bar with elapsed
time. The spec does **not** promise a smooth percentage.

## Data flow

1. User clicks **Stems…** → dialog opens. Dialog first calls `GET /health`.
   - unreachable → "No encuentro el servicio de stems en `localhost:8765`. ¿Está
     arrancado?" + pointer to the README. (No upload attempted.)
2. User picks a file → `POST /jobs` (multipart) → `jobId`.
3. `stem-poll` polls `GET /jobs/{id}` every ~1 s, calling `onProgress(status, progress)`;
   the dialog renders a progress bar + status text. Cancel → `DELETE /jobs/{id}` + abort.
4. On `done`: for each of the 4 stems → `fetch` WAV bytes → `ctx.decodeAudioData` →
   `buildSampleAsset` → save to the sample store.
5. `stem-import` builds a **lane plan** (`stem-lane-plan.ts`, pure) ordering the 4 stems
   into labelled lanes (Voz/Batería/Bajo/Otros with stable colours), then creates the 4
   Sampler lanes through the session host's allocation path, assigning each stem sample
   and a single full-length one-shot clip. The whole creation is one `withUndo` action.
6. The scene is sized so the 4 one-shots trigger together at launch and loop in lockstep
   (full song length). Play reconstructs the song. The dialog closes.

Mapping a full-length sample onto a clip reuses the **same handling the loop importer
already uses** for arbitrary-length audio (a long sample placed on a clip); the exact
step/length math is an implementation detail for the plan, but **no beat-matching /
slicing** is applied.

## UI

A transport-bar **"Stems…"** button (next to the Export button added recently). It opens
a small modal:

- File input (accepts `audio/*`).
- A **Separar** action (disabled until a file is chosen and `/health` is OK).
- While running: a progress bar (or indeterminate) + status text (`Separando… 0:42`) +
  **Cancelar**.
- On success: closes itself; the 4 new lanes appear in the session grid.
- On error / unreachable: an inline message (not a silent failure), with the README hint
  for the unreachable case.

## Error handling (degrade gracefully; never break the session)

- **Service unreachable** (not started / wrong URL) → detected up front via `/health`;
  clear message + README pointer. Nothing is created.
- **Job `error`** (unsupported format, OOM, model download failed) → surface the
  backend's `error` string in the dialog. No partial lanes.
- **Cancel / dialog closed mid-run** → abort polling and `DELETE` the job.
- **A stem fails to decode** client-side → report it and create **none** of the lanes
  (all-or-nothing) so the session never ends up half-built; the user can retry.
- All paths leave the existing session untouched on failure.

## Testing (four layers, per repo convention)

1. **Pure** —
   - `stem-client.test.ts`: mocked `fetch` — `createJob` success/parse, each job
     `status` shape, `done` with stems, `error` mapping, **network-unreachable → typed
     error**, `stemUrl` building, base-URL override.
   - `stem-poll.test.ts`: fake timers — advances through `queued→running→done`, calls
     `onProgress`, stops on `done`/`error`, aborts on signal.
   - `stem-lane-plan.test.ts`: stem manifest → ordered, labelled lane plan (Voz/Batería/
     Bajo/Otros, stable colours/order; unexpected stem names handled).
2. **Integration (in-memory)** — `stem-import` mapping against `sample-store-mem` and a
   session fixture: asserts 4 lanes are planned with the right engine/sample assignment
   and that creation goes through the session-host allocation path (one undo entry).
   Browser-only parts (`decodeAudioData`, DOM, real `fetch`) are **not** unit-tested.
3. **Backend contract (optional, Python)** — a tiny `pytest` over the FastAPI app with
   the separation **stubbed** (no real Demucs): `POST /jobs` → `GET /jobs/{id}` reaches
   `done` with a fake manifest, `DELETE` cleans up, CORS headers present. Lives under
   `tools/stem-service/`, **not** in the JS CI.
4. **e2e (Playwright, optional)** — stub the service via **route interception**
   (`/health`, `/jobs`, `/jobs/{id}`, stem WAV → a tiny generated WAV) so the full
   dialog→progress→4-lanes flow is exercised **without Python**. (Remember: `npm run
   build` before e2e — it serves `dist/`.)

The real round-trip against the live Python backend is a **manual** check documented in
the README (not in CI, since Python/Demucs is not part of the JS test pipeline).

Assertions are always **relative** where DSP is involved, per repo convention.

## Out of scope (v1)

- Model/stem-count selector; 2-stem and 6-stem; MDX/VR/ensembles (fixed 4-stem Demucs).
- Remote/hosted backend and any Codespaces automation (README *documents* it; no code).
- Beat-matching / tempo-sync / BPM detection of stems (explicitly not chosen).
- Job persistence across backend restarts (in-memory registry + temp dirs + TTL).
- Running the separation on GitHub Pages or GitHub Actions (not possible / not
  interactive — only the UI runs on Pages; the backend runs on the user's machine).
- Auth on the backend (it is a personal localhost tool).
