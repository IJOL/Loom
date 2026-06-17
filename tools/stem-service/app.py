"""Local stem-separation service (the headless engine behind UVR, via audio-separator).
Personal/localhost tool — no auth. Start with:  uvicorn app:app --port 8765"""
from __future__ import annotations
import os
import tempfile

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from jobs import JobRegistry
from separation import separate_file, MODEL_FILENAME

WORK_ROOT = os.path.join(tempfile.gettempdir(), "loom-stem-service")
# GitHub Pages origin plus ANY localhost/127.0.0.1 port — Vite falls back to
# 5174+ when 5173 is busy, so a fixed port list is brittle for local dev.
ALLOWED_ORIGINS = ["https://ijol.github.io"]
LOCALHOST_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

app = FastAPI(title="Loom Stem Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=LOCALHOST_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

registry = JobRegistry(separate=separate_file)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_FILENAME}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    kind: str = Form("auto"),
    # Melodic (basic-pitch) tuning — all optional; omitted ⇒ transcribe_file defaults.
    onset_threshold: float | None = Form(None),
    frame_threshold: float | None = Form(None),
    min_note_length_ms: float | None = Form(None),
    min_freq: float | None = Form(None),
    max_freq: float | None = Form(None),
):
    """Audio → notes. `kind` = 'drums' | 'melodic' | 'auto' (caller should pass the
    known stem role). Melodic uses basic-pitch; the bp_* form fields tune it.
    Synchronous detection is far quicker than separation, and FastAPI runs this in
    a threadpool so it won't block the loop."""
    from starlette.concurrency import run_in_threadpool
    from transcribe import transcribe_file

    job_root = os.path.join(WORK_ROOT, "transcribe")
    os.makedirs(job_root, exist_ok=True)
    safe_name = os.path.basename(file.filename or "input") or "input"
    in_path = os.path.join(job_root, f"{os.urandom(6).hex()}-{safe_name}")
    with open(in_path, "wb") as f:
        f.write(await file.read())
    bp = {k: v for k, v in {
        "onset_threshold": onset_threshold,
        "frame_threshold": frame_threshold,
        "min_note_length_ms": min_note_length_ms,
        "min_freq": min_freq,
        "max_freq": max_freq,
    }.items() if v is not None}
    try:
        return await run_in_threadpool(transcribe_file, in_path, kind, **bp)
    finally:
        try:
            os.remove(in_path)
        except OSError:
            pass


@app.post("/jobs", status_code=201)
async def create_job(file: UploadFile = File(...)):
    job_root = os.path.join(WORK_ROOT, "in")
    os.makedirs(job_root, exist_ok=True)
    # basename-only: never let a crafted upload name escape job_root (path traversal).
    safe_name = os.path.basename(file.filename or "input") or "input"
    in_path = os.path.join(job_root, f"{os.urandom(6).hex()}-{safe_name}")
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
